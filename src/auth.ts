import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionState } from "./types.js";

const BASE_URL = "https://peoplelikeus.world";
const CACHE_PATH = join(homedir(), ".peoplelikeus-mcp-session.json");
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const SESSION_TTL_MS = 60 * 60 * 1000;

export class Auth {
  private session: SessionState | null = null;
  private pendingCookies: string | null = null;

  constructor() {
    this.loadFromEnvSync();
    if (!this.session) this.loadFromCache();
  }

  async ensureAuthenticated(): Promise<void> {
    if (this.pendingCookies) {
      const cookies = this.pendingCookies;
      this.pendingCookies = null;
      await this.setCookies(cookies);
      return;
    }
    if (this.isValid()) return;
    const email = process.env.PLU_EMAIL;
    const password = process.env.PLU_PASSWORD;
    if (email && password) { await this.login(email, password); return; }
    throw new Error("Not authenticated. Provide PLU_EMAIL + PLU_PASSWORD, or PLU_COOKIES, or call plu_login.");
  }

  async login(email: string, password: string): Promise<void> {
    const loginPage = await fetch(`${BASE_URL}/en/login`, { headers: { "user-agent": USER_AGENT }, redirect: "manual" });
    const cookies = this.extractSetCookies(loginPage);
    const html = await loginPage.text();
    const csrfToken = this.extractCsrfToken(html);
    if (!csrfToken) throw new Error("Failed to extract CSRF token from login page");

    const body = new URLSearchParams({ _token: csrfToken, email, password, remember: "on" });
    const loginResp = await fetch(`${BASE_URL}/login`, {
      method: "POST",
      headers: { "user-agent": USER_AGENT, "content-type": "application/x-www-form-urlencoded", cookie: cookies.join("; "), referer: `${BASE_URL}/en/login`, accept: "text/html,application/xhtml+xml" },
      body: body.toString(), redirect: "manual",
    });
    if (loginResp.status !== 302) throw new Error("Login failed \u2014 invalid credentials");

    const allCookies = [...cookies, ...this.extractSetCookies(loginResp)];
    const newCsrf = this.extractCsrfFromCookies(allCookies) ?? csrfToken;
    const redirectUrl = loginResp.headers.get("location") || `${BASE_URL}/en/dashboard`;
    const dashResp = await fetch(redirectUrl.startsWith("/") ? `${BASE_URL}${redirectUrl}` : redirectUrl, { headers: { "user-agent": USER_AGENT, cookie: allCookies.join("; ") }, redirect: "manual" });
    const dashCookies = [...allCookies, ...this.extractSetCookies(dashResp)];
    const dashHtml = await dashResp.text();
    const userId = this.extractUserId(dashHtml);
    const finalCsrf = this.extractCsrfToken(dashHtml) ?? newCsrf;

    this.session = { cookies: this.deduplicateCookies(dashCookies), csrfToken: finalCsrf, userId, authenticatedAt: new Date(), source: "login" };
    this.saveToCache();
    console.error(`[auth] Logged in as user ${userId}`);
  }

  async setCookies(cookieString: string): Promise<void> {
    this.session = { cookies: [cookieString], csrfToken: "", userId: null, authenticatedAt: new Date(), source: "cookies" };
    try {
      const resp = await fetch(`${BASE_URL}/en/dashboard`, { headers: { "user-agent": USER_AGENT, cookie: cookieString }, redirect: "manual" });
      const location = resp.headers.get("location") ?? "";
      if (resp.status === 302 && location.includes("login")) { this.session = null; throw new Error("Cookies invalid"); }
      const html = await resp.text();
      const csrfToken = this.extractCsrfToken(html);
      const userId = this.extractUserId(html);
      if (!csrfToken) { this.session = null; throw new Error("Failed to extract CSRF token"); }
      const newCookies = this.extractSetCookies(resp);
      const allCookies = this.deduplicateCookies([cookieString, ...newCookies]);
      this.session = { cookies: allCookies, csrfToken, userId, authenticatedAt: new Date(), source: "cookies" };
      this.saveToCache();
      console.error(`[auth] Cookies validated, user ${userId}`);
    } catch (e) { if (!this.session?.csrfToken) this.session = null; throw e; }
  }

  updateFromResponse(resp: Response): void {
    if (!this.session) return;
    const newCookies = this.extractSetCookies(resp);
    if (newCookies.length > 0) {
      this.session.cookies = this.deduplicateCookies([...this.session.cookies, ...newCookies]);
      const newCsrf = this.extractCsrfFromCookies(newCookies);
      if (newCsrf) this.session.csrfToken = newCsrf;
    }
  }

  async refreshCsrf(): Promise<void> {
    if (!this.session) return;
    const resp = await fetch(`${BASE_URL}/en/dashboard`, { headers: { "user-agent": USER_AGENT, cookie: this.getCookieHeader() }, redirect: "manual" });
    this.updateFromResponse(resp);
    const html = await resp.text();
    const metaCsrf = this.extractCsrfToken(html);
    if (metaCsrf && this.session) this.session.csrfToken = metaCsrf;
  }

  getCookieHeader(): string { return this.session?.cookies.join("; ") ?? ""; }
  getCsrfToken(): string { return this.session?.csrfToken ?? ""; }
  getUserId(): number | null { return this.session?.userId ?? null; }
  getStatus(): Record<string, unknown> { return { authenticated: this.isValid(), userId: this.session?.userId, source: this.session?.source, authenticatedAt: this.session?.authenticatedAt?.toISOString() }; }
  invalidate(): void { this.session = null; console.error("[auth] Session invalidated"); }

  private isValid(): boolean { if (!this.session) return false; return (Date.now() - this.session.authenticatedAt.getTime()) < SESSION_TTL_MS; }
  private loadFromEnvSync(): void { const cookies = process.env.PLU_COOKIES; if (cookies) { this.pendingCookies = cookies; } }
  private loadFromCache(): void { try { const raw = readFileSync(CACHE_PATH, "utf-8"); const data = JSON.parse(raw); this.session = { ...data, authenticatedAt: new Date(data.authenticatedAt) }; if (!this.isValid()) this.session = null; else console.error("[auth] Loaded session from cache"); } catch { /* no cache */ } }
  private saveToCache(): void { try { writeFileSync(CACHE_PATH, JSON.stringify(this.session, null, 2)); } catch (e) { console.error("[auth] Failed to save cache:", e); } }

  private extractSetCookies(resp: Response): string[] {
    const result: string[] = [];
    const getSetCookie = (resp.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof getSetCookie === "function") { for (const sc of getSetCookie.call(resp.headers)) { const value = sc.split(";")[0]; if (value) result.push(value); } }
    else { const raw = resp.headers.get("set-cookie"); if (raw) { for (const part of raw.split(/,(?=\s*\w+=)/)) { const cookie = part.split(";")[0].trim(); if (cookie) result.push(cookie); } } }
    return result;
  }
  private extractCsrfToken(html: string): string | null { return html.match(/meta\s+name="csrf-token"\s+content="([^"]+)"/)?.[1] ?? null; }
  private extractUserId(html: string): number | null { const m = html.match(/meta\s+name="user-id"\s+content="(\d+)"/); return m ? parseInt(m[1], 10) : null; }
  private extractCsrfFromCookies(cookies: string[]): string | null { for (const c of cookies) { const m = c.match(/XSRF-TOKEN=([^;]+)/); if (m) return decodeURIComponent(m[1]); } return null; }
  private deduplicateCookies(cookies: string[]): string[] { const map = new Map<string, string>(); for (const c of cookies) { const eq = c.indexOf("="); if (eq > 0) map.set(c.substring(0, eq), c); } return [...map.values()]; }
}
