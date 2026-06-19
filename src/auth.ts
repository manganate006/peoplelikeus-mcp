import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionState } from "./types.js";

const BASE_URL = "https://peoplelikeus.world";
const CACHE_PATH = join(homedir(), ".peoplelikeus-mcp-session.json");
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/** Session considered valid for 1 hour after login */
const SESSION_TTL_MS = 60 * 60 * 1000;

export class Auth {
  private session: SessionState | null = null;
  private pendingCookies: string | null = null;

  constructor() {
    this.loadFromEnvSync();
    if (!this.session) this.loadFromCache();
  }

  // ── Public ───────────────────────────────────────────────────────────────

  /** Ensure we have an active session, login if needed. */
  async ensureAuthenticated(): Promise<void> {
    // If we have pending cookies from env, validate them now
    if (this.pendingCookies) {
      const cookies = this.pendingCookies;
      this.pendingCookies = null;
      await this.setCookies(cookies);
      return;
    }

    if (this.isValid()) return;

    // Try login with env credentials
    const email = process.env.PLU_EMAIL;
    const password = process.env.PLU_PASSWORD;
    if (email && password) {
      await this.login(email, password);
      return;
    }

    throw new Error(
      "Not authenticated. Provide PLU_EMAIL + PLU_PASSWORD, or PLU_COOKIES, or call plu_login."
    );
  }

  /** Login with email/password. */
  async login(email: string, password: string): Promise<void> {
    // Step 1: GET /login to obtain CSRF token + session cookie
    const loginPage = await fetch(`${BASE_URL}/en/login`, {
      headers: { "user-agent": USER_AGENT },
      redirect: "manual",
    });
    const cookies = this.extractSetCookies(loginPage);
    const html = await loginPage.text();
    const csrfToken = this.extractCsrfToken(html);
    if (!csrfToken) throw new Error("Failed to extract CSRF token from login page");

    // Step 2: POST /login
    const body = new URLSearchParams({
      _token: csrfToken,
      email,
      password,
      remember: "on",
    });

    const loginResp = await fetch(`${BASE_URL}/login`, {
      method: "POST",
      headers: {
        "user-agent": USER_AGENT,
        "content-type": "application/x-www-form-urlencoded",
        cookie: cookies.join("; "),
        referer: `${BASE_URL}/en/login`,
        accept: "text/html,application/xhtml+xml",
      },
      body: body.toString(),
      redirect: "manual",
    });

    // Laravel redirects on success (302), stays on /login on failure
    if (loginResp.status !== 302) {
      throw new Error("Login failed — invalid credentials");
    }

    const allCookies = [...cookies, ...this.extractSetCookies(loginResp)];
    const newCsrf = this.extractCsrfFromCookies(allCookies) ?? csrfToken;

    // Step 3: Follow redirect to get user ID
    const redirectUrl = loginResp.headers.get("location") || `${BASE_URL}/en/dashboard`;
    const dashResp = await fetch(
      redirectUrl.startsWith("/") ? `${BASE_URL}${redirectUrl}` : redirectUrl,
      {
        headers: { "user-agent": USER_AGENT, cookie: allCookies.join("; ") },
        redirect: "manual",
      }
    );
    const dashCookies = [...allCookies, ...this.extractSetCookies(dashResp)];
    const dashHtml = await dashResp.text();
    const userId = this.extractUserId(dashHtml);
    const finalCsrf = this.extractCsrfToken(dashHtml) ?? newCsrf;

    this.session = {
      cookies: this.deduplicateCookies(dashCookies),
      csrfToken: finalCsrf,
      userId,
      authenticatedAt: new Date(),
      source: "login",
    };
    this.saveToCache();
    console.error(`[auth] Logged in as user ${userId}`);
  }

  /** Inject raw cookies (from browser DevTools) and validate them. */
  async setCookies(cookieString: string): Promise<void> {
    // Store cookies temporarily to make a validation request
    this.session = {
      cookies: [cookieString],
      csrfToken: "",
      userId: null,
      authenticatedAt: new Date(),
      source: "cookies",
    };

    // Validate by fetching dashboard to get CSRF token + user ID
    try {
      const resp = await fetch(`${BASE_URL}/en/dashboard`, {
        headers: { "user-agent": USER_AGENT, cookie: cookieString },
        redirect: "manual",
      });

      // If redirected to login, cookies are invalid
      const location = resp.headers.get("location") ?? "";
      if (resp.status === 302 && location.includes("login")) {
        this.session = null;
        throw new Error("Cookies invalid — redirected to login");
      }

      const html = await resp.text();
      const csrfToken = this.extractCsrfToken(html);
      const userId = this.extractUserId(html);

      if (!csrfToken) {
        this.session = null;
        throw new Error("Failed to extract CSRF token — cookies may be expired");
      }

      // Merge any new Set-Cookie headers
      const newCookies = this.extractSetCookies(resp);
      const allCookies = this.deduplicateCookies([cookieString, ...newCookies]);

      this.session = {
        cookies: allCookies,
        csrfToken,
        userId,
        authenticatedAt: new Date(),
        source: "cookies",
      };
      this.saveToCache();
      console.error(`[auth] Cookies validated, user ${userId}`);
    } catch (e) {
      if (!this.session?.csrfToken) this.session = null;
      throw e;
    }
  }

  /** Update session cookies from a response's Set-Cookie headers + refresh CSRF. */
  updateFromResponse(resp: Response): void {
    if (!this.session) return;
    const newCookies = this.extractSetCookies(resp);
    if (newCookies.length > 0) {
      this.session.cookies = this.deduplicateCookies([...this.session.cookies, ...newCookies]);
      // Update CSRF token from new XSRF-TOKEN cookie
      const newCsrf = this.extractCsrfFromCookies(newCookies);
      if (newCsrf) this.session.csrfToken = newCsrf;
    }
  }

  /** Refresh CSRF token by doing a GET (follows redirects to get actual page). */
  async refreshCsrf(): Promise<void> {
    if (!this.session) return;
    const resp = await fetch(`${BASE_URL}/en/chats`, {
      headers: { "user-agent": USER_AGENT, cookie: this.getCookieHeader() },
      // Follow redirects to reach the actual page with meta csrf-token
    });
    this.updateFromResponse(resp);
    const html = await resp.text();
    const metaCsrf = this.extractCsrfToken(html);
    if (metaCsrf && this.session) this.session.csrfToken = metaCsrf;
  }

  /** Get cookie header for requests. */
  getCookieHeader(): string {
    return this.session?.cookies.join("; ") ?? "";
  }

  /** Get CSRF token for POST requests. */
  getCsrfToken(): string {
    return this.session?.csrfToken ?? "";
  }

  /** Get authenticated user ID. */
  getUserId(): number | null {
    return this.session?.userId ?? null;
  }

  /** Set user ID (e.g. from /authuser when login didn't capture it). */
  setUserId(id: number): void {
    if (this.session) {
      this.session.userId = id;
      this.saveToCache();
      console.error(`[auth] userId updated to ${id}`);
    }
  }

  /** Auth status for tools. */
  getStatus(): Record<string, unknown> {
    return {
      authenticated: this.isValid(),
      userId: this.session?.userId,
      source: this.session?.source,
      authenticatedAt: this.session?.authenticatedAt?.toISOString(),
    };
  }

  /** Invalidate session (e.g. on 419 CSRF mismatch). */
  invalidate(): void {
    this.session = null;
    console.error("[auth] Session invalidated");
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private isValid(): boolean {
    if (!this.session) return false;
    const age = Date.now() - this.session.authenticatedAt.getTime();
    return age < SESSION_TTL_MS;
  }

  private loadFromEnvSync(): void {
    const cookies = process.env.PLU_COOKIES;
    if (cookies) {
      // Store for async validation on first ensureAuthenticated() call
      this.pendingCookies = cookies;
      return;
    }
  }

  private loadFromCache(): void {
    try {
      const raw = readFileSync(CACHE_PATH, "utf-8");
      const data = JSON.parse(raw);
      this.session = {
        ...data,
        authenticatedAt: new Date(data.authenticatedAt),
      };
      if (!this.isValid()) {
        this.session = null;
      } else {
        console.error("[auth] Loaded session from cache");
      }
    } catch {
      // No cache or invalid
    }
  }

  private saveToCache(): void {
    try {
      writeFileSync(CACHE_PATH, JSON.stringify(this.session, null, 2));
    } catch (e) {
      console.error("[auth] Failed to save cache:", e);
    }
  }

  private extractSetCookies(resp: Response): string[] {
    const result: string[] = [];
    const getSetCookie = (resp.headers as unknown as { getSetCookie?: () => string[] })
      .getSetCookie;
    if (typeof getSetCookie === "function") {
      for (const sc of getSetCookie.call(resp.headers)) {
        const name = sc.split("=")[0];
        const value = sc.split(";")[0];
        if (name && value) result.push(value);
      }
    } else {
      const raw = resp.headers.get("set-cookie");
      if (raw) {
        for (const part of raw.split(/,(?=\s*\w+=)/)) {
          const cookie = part.split(";")[0].trim();
          if (cookie) result.push(cookie);
        }
      }
    }
    return result;
  }

  private extractCsrfToken(html: string): string | null {
    const match = html.match(/meta\s+name="csrf-token"\s+content="([^"]+)"/);
    return match ? match[1] : null;
  }

  private extractUserId(html: string): number | null {
    // Tolère l'ordre/espaces des attributs et les guillemets simples/doubles.
    const match = html.match(/<meta[^>]*name=["']user-id["'][^>]*content=["'](\d+)["']/i);
    return match ? parseInt(match[1], 10) : null;
  }

  private extractCsrfFromCookies(cookies: string[]): string | null {
    for (const c of cookies) {
      const match = c.match(/XSRF-TOKEN=([^;]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
    return null;
  }

  private deduplicateCookies(cookies: string[]): string[] {
    const map = new Map<string, string>();
    for (const c of cookies) {
      const eqIndex = c.indexOf("=");
      if (eqIndex > 0) {
        const name = c.substring(0, eqIndex);
        // Keep last value (most recent Set-Cookie wins)
        map.set(name, c);
      }
    }
    return [...map.values()];
  }
}
