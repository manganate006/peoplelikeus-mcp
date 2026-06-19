import type { Auth } from "./auth.js";

const BASE = "https://peoplelikeus.world";
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_DELAY = parseInt(process.env.PLU_REQUEST_DELAY ?? "1500", 10);
const MAX_RETRIES = parseInt(process.env.PLU_MAX_RETRIES ?? "3", 10);
const RETRY_BASE_MS = parseInt(process.env.PLU_RETRY_BASE_MS ?? "2000", 10);
const MAX_RETRY_WAIT_MS = 30_000; // plafond sur Retry-After / backoff

let lastRequest = 0;

async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = REQUEST_DELAY - (now - lastRequest);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Parse le header Retry-After (secondes, ou date HTTP) → millisecondes, ou null.
function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

// ── Geocoding via Nominatim (OpenStreetMap) ────────────────────────────────

interface GeoResult {
  lat: string;
  lng: string;
  country?: string;
  state?: string;
  city?: string;
}

async function geocode(query: string): Promise<GeoResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1&accept-language=en`;
    const resp = await fetch(url, {
      headers: { "user-agent": "peoplelikeus-mcp/1.0 (MCP server)" },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Array<{
      lat: string;
      lon: string;
      address?: { country?: string; state?: string; city?: string; town?: string; village?: string };
    }>;
    if (!data.length) return null;
    const item = data[0];
    return {
      lat: item.lat,
      lng: item.lon,
      country: item.address?.country,
      state: item.address?.state,
      city: item.address?.city ?? item.address?.town ?? item.address?.village,
    };
  } catch {
    return null;
  }
}

export class Api {
  constructor(private auth: Auth) {}

  // ── HTTP helpers ─────────────────────────────────────────────────────────

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "user-agent": USER_AGENT,
      cookie: this.auth.getCookieHeader(),
      referer: `${BASE}/`,
      accept: "text/html,application/xhtml+xml,application/json",
      ...extra,
    };
  }

  // Wrapper fetch : throttle + retry sur 429/503 (respecte Retry-After, backoff exponentiel + jitter).
  private async fetchWithRetry(url: string, init: RequestInit, label: string): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      await throttle();
      const resp = await fetch(url, init);
      if ((resp.status !== 429 && resp.status !== 503) || attempt >= MAX_RETRIES) {
        return resp;
      }
      const retryAfter = parseRetryAfter(resp.headers.get("retry-after"));
      const backoff = RETRY_BASE_MS * 2 ** attempt;
      const wait = Math.min(retryAfter ?? backoff, MAX_RETRY_WAIT_MS) + Math.floor(Math.random() * 500);
      console.error(
        `[peoplelikeus-mcp] ${resp.status} on ${label}, retry ${attempt + 1}/${MAX_RETRIES} in ${wait}ms`
      );
      await sleep(wait);
    }
  }

  private async getJson(path: string): Promise<unknown> {
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const resp = await this.fetchWithRetry(url, {
      headers: { ...this.headers(), accept: "application/json" },
    }, `GET ${path}`);
    this.auth.updateFromResponse(resp);
    if (resp.status === 419) {
      this.auth.invalidate();
      throw new Error("CSRF token mismatch (419) — session expired, re-authenticate");
    }
    if (!resp.ok) throw new Error(`GET ${path} → ${resp.status}`);
    return resp.json();
  }

  private async getHtml(path: string): Promise<string> {
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const resp = await this.fetchWithRetry(url, { headers: this.headers() }, `GET ${path}`);
    this.auth.updateFromResponse(resp);
    if (resp.status === 419) {
      this.auth.invalidate();
      throw new Error("CSRF token mismatch (419) — session expired");
    }
    if (!resp.ok) throw new Error(`GET ${path} → ${resp.status}`);
    return resp.text();
  }

  private async post(
    path: string,
    data: Record<string, string>,
    method = "POST"
  ): Promise<unknown> {
    // Refresh CSRF before any POST
    await this.auth.refreshCsrf();
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const body = new URLSearchParams({
      _token: this.auth.getCsrfToken(),
      ...data,
    });
    if (method !== "POST") body.set("_method", method);

    const resp = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        ...this.headers(),
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json, text/html",
      },
      body: body.toString(),
      redirect: "manual",
    }, `POST ${path}`);
    this.auth.updateFromResponse(resp);
    if (resp.status === 419) {
      this.auth.invalidate();
      throw new Error("CSRF token mismatch (419) — session expired");
    }
    if (resp.status === 302) return { success: true, redirect: resp.headers.get("location") };
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      if (!resp.ok) throw new Error(`POST ${path} → ${resp.status}: ${text.substring(0, 200)}`);
      return { success: true, status: resp.status, body: text.substring(0, 500) };
    }
  }

  private async ajaxPost(path: string, data: Record<string, string>): Promise<unknown> {
    // Refresh CSRF before any AJAX POST
    await this.auth.refreshCsrf();
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const body = new URLSearchParams({
      _token: this.auth.getCsrfToken(),
      ...data,
    });
    const resp = await this.fetchWithRetry(url, {
      method: "POST",
      headers: {
        ...this.headers(),
        "content-type": "application/x-www-form-urlencoded",
        "x-requested-with": "XMLHttpRequest",
        accept: "application/json",
      },
      body: body.toString(),
    }, `POST ${path}`);
    this.auth.updateFromResponse(resp);
    if (resp.status === 419) {
      this.auth.invalidate();
      throw new Error("CSRF token mismatch (419)");
    }
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`POST ${path} → ${resp.status}: ${text.substring(0, 200)}`);
    }
    return resp.json();
  }

  // ── Properties (public) ──────────────────────────────────────────────────

  async getProperty(propertyId: number): Promise<unknown> {
    const html = await this.getHtml(`/en/properties/${propertyId}`);
    return this.parsePropertyPage(html, propertyId);
  }

  async getMyProperties(): Promise<unknown> {
    const html = await this.getHtml("/en/my-home-profile");
    return this.parseMyPropertiesPage(html);
  }

  // ── Calendar / Availability ──────────────────────────────────────────────

  async getAvailabilities(propertyId: number): Promise<unknown> {
    return this.getJson(`/api/availables/${propertyId}`);
  }

  async getUnavailabilities(propertyId: number): Promise<unknown> {
    return this.getJson(`/api/unavailables/${propertyId}`);
  }

  async addAvailability(
    propertyId: number,
    startDate: string,
    endDate: string,
    options: { sim?: boolean; non_sim?: boolean; non_reciprocal?: boolean; hospitality?: boolean } = {}
  ): Promise<unknown> {
    const data: Record<string, string> = {
      property_id: String(propertyId),
      start_date: startDate,
      end_date: endDate,
    };
    if (options.sim !== undefined) data.sim = options.sim ? "1" : "0";
    if (options.non_sim !== undefined) data.non_sim = options.non_sim ? "1" : "0";
    if (options.non_reciprocal !== undefined) data.non_reciprocal = options.non_reciprocal ? "1" : "0";
    if (options.hospitality !== undefined) data.hospitality = options.hospitality ? "1" : "0";
    return this.ajaxPost("/availables/store", data);
  }

  async deleteAvailability(availabilityId: number): Promise<unknown> {
    return this.post(`/availables/${availabilityId}`, {}, "DELETE");
  }

  async addUnavailability(
    propertyId: number,
    startDate: string,
    endDate: string
  ): Promise<unknown> {
    return this.ajaxPost("/unavailables/store", {
      property_id: String(propertyId),
      start_date: startDate,
      end_date: endDate,
    });
  }

  async deleteUnavailability(unavailabilityId: number): Promise<unknown> {
    return this.post(`/unavailables/${unavailabilityId}`, {}, "DELETE");
  }

  // ── Conversations & Messages ─────────────────────────────────────────────

  async getConversations(
    filter?: string,
    page = 1
  ): Promise<unknown> {
    let userId = this.auth.getUserId();
    if (!userId) {
      // Le login ne capture pas toujours l'userId (meta absente) — fallback /authuser.
      const authUser = (await this.getAuthUser()) as Array<{ id?: number }> | { id?: number };
      const resolved = Array.isArray(authUser) ? authUser[0]?.id : authUser?.id;
      if (resolved) {
        userId = Number(resolved);
        this.auth.setUserId(userId);
      }
    }
    if (!userId) throw new Error("Could not resolve authenticated user id (/authuser empty)");
    let path = `/en/chats?user=${userId}&page=${page}`;
    if (filter) path += `&filter=${filter}`;
    const html = await this.getHtml(path);
    return this.parseConversationsPage(html);
  }

  async getMessages(userId: number, propertyId: number): Promise<unknown> {
    const html = await this.getHtml(`/en/messages/user/${userId}/property/${propertyId}`);
    return this.parseMessagesPage(html, userId, propertyId);
  }

  async sendMessage(
    toUserId: number,
    body: string,
    propertyId: number,
    chatId?: number,
    exchangeId?: string
  ): Promise<unknown> {
    return this.ajaxPost(`/messages/store/${toUserId}`, {
      body,
      property: String(propertyId),
      exchange: exchangeId ?? "",
      chat_id: chatId ? String(chatId) : "",
      welcome_message: "0",
      renewal_message: "0",
    });
  }

  async deleteMessage(messageId: number): Promise<unknown> {
    return this.post(`/messages/${messageId}/destroy`, {}, "DELETE");
  }

  async deleteConversation(chatId: number): Promise<unknown> {
    return this.post(`/chats/${chatId}/destroy`, {}, "DELETE");
  }

  // ── Exchanges ────────────────────────────────────────────────────────────

  async getExchanges(): Promise<unknown> {
    const html = await this.getHtml("/en/exchanges");
    return this.parseExchangesPage(html);
  }

  async getExchange(exchangeId: number): Promise<unknown> {
    const html = await this.getHtml(`/en/exchanges/${exchangeId}/edit`);
    return this.parseExchangeDetailPage(html, exchangeId);
  }

  async createExchange(userId: number, propertyId: number): Promise<unknown> {
    return this.post(`/exchanges/create/user/${userId}/property/${propertyId}`, {});
  }

  async updateExchangeDates(
    exchangeId: number,
    startDate: string,
    endDate: string
  ): Promise<unknown> {
    return this.post(`/exchanges/${exchangeId}/update/dates`, {
      start_date: startDate,
      end_date: endDate,
    }, "PUT");
  }

  async updateExchangeType(
    exchangeId: number,
    swapType: "simultaneous" | "non_simultaneous" | "non_reciprocal" | "hospitality"
  ): Promise<unknown> {
    return this.post(`/exchanges/${exchangeId}/update/exchangetype`, {
      swap_type: swapType,
    }, "PUT");
  }

  async cancelExchange(exchangeId: number): Promise<unknown> {
    return this.post(`/exchanges/${exchangeId}/cancel`, {}, "PUT");
  }

  // ── Search ───────────────────────────────────────────────────────────────

  async searchHomes(params: Record<string, string>): Promise<unknown> {
    // If we have a search term but no lat/lng, geocode it
    if (params.search && !params.lat) {
      const geo = await geocode(params.search);
      if (geo) {
        params.lat = geo.lat;
        params.lng = geo.lng;
        if (geo.country && !params.country_long) params.country_long = geo.country;
        if (geo.state) params.administrative_area_level_1_long = geo.state;
        if (geo.city) params.locality_long = geo.city;
      }
    }
    const qs = new URLSearchParams(params).toString();
    const html = await this.getHtml(`/en/homes?${qs}`);
    return this.parseSearchResults(html);
  }

  async quickSearch(listingNumber: number): Promise<unknown> {
    const html = await this.getHtml(`/quicksearch?listing_number=${listingNumber}`);
    return this.parseSearchResults(html);
  }

  // ── Notifications ────────────────────────────────────────────────────────

  async getNotifications(): Promise<unknown> {
    return this.getJson("/notifications");
  }

  // ── User ─────────────────────────────────────────────────────────────────

  async getAuthUser(): Promise<unknown> {
    const data = await this.getJson("/authuser");
    if (Array.isArray(data) && data[0]?.id && !this.auth.getUserId()) {
      this.auth.setUserId(data[0].id);
    }
    return data;
  }

  // ── Favourites ───────────────────────────────────────────────────────────

  async getFavourites(): Promise<unknown> {
    const html = await this.getHtml("/en/favourites");
    return this.parseSearchResults(html);
  }

  // ── HTML Parsers ─────────────────────────────────────────────────────────

  private parsePropertyPage(html: string, propertyId: number): Record<string, unknown> {
    const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const description = html.match(/id="description"[^>]*>([\s\S]*?)<\/div>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const images = [...html.matchAll(/data-flickity-lazyload="([^"]+)"/g)].map((m) => m[1]);
    const location = html.match(/class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    // Owner user ID = le user du lien "contacter le propriétaire", scopé à CETTE propriété.
    // (Les liens /properties?user=N en tête de page sont des avis, pas le propriétaire.)
    const ownerIdMatch = html.match(new RegExp(`/messages/user/(\\d+)/property/${propertyId}\\b`));
    const ownerId = ownerIdMatch ? parseInt(ownerIdMatch[1], 10) : null;
    // Owner name = titre de la carte profil du propriétaire (card-profile).
    const ownerCard = html.match(/card-profile[\s\S]{0,2000}?<h2[^>]*card-title[^>]*>([\s\S]*?)<\/h2>/);
    const ownerName = ownerCard?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() ?? "";

    const isPremium = html.includes("Premium");
    const isVerified = html.includes("Verified") || html.includes("Vérifié");

    const exchangeTypes: string[] = [];
    if (html.includes("Simultaneous") || html.includes("Simultané")) exchangeTypes.push("simultaneous");
    if (html.includes("Non-Simultaneous") || html.includes("Non-Simultané")) exchangeTypes.push("non_simultaneous");
    if (html.includes("Non-Reciprocal") || html.includes("Non-Réciproque")) exchangeTypes.push("non_reciprocal");
    if (html.includes("Hospitality") || html.includes("Hospitalité")) exchangeTypes.push("hospitality");

    return { id: propertyId, title, description: description.substring(0, 500), ownerId, ownerName, location, images: images.slice(0, 5), isPremium, isVerified, exchangeTypes };
  }

  private parseMyPropertiesPage(html: string): Record<string, unknown> {
    const properties = [...html.matchAll(/\/properties\/(\d+)\/edit/g)].map((m) => parseInt(m[1], 10));
    const uniqueIds = [...new Set(properties)];
    const titles = [...html.matchAll(/<h5[^>]*>([\s\S]*?)<\/h5>/g)]
      .map((m) => m[1].replace(/<[^>]+>/g, "").trim())
      .filter((t) => t.length > 5);
    return {
      properties: uniqueIds.map((id, i) => ({
        id,
        title: titles[i] ?? `Property #${id}`,
        editUrl: `/properties/${id}/edit`,
      })),
    };
  }

  private parseConversationsPage(html: string): Record<string, unknown> {
    // Extract stats
    const received = html.match(/Messages reçus[^<]*?(\d+)/)?.[1] ?? html.match(/Messages received[^<]*?(\d+)/)?.[1];
    const sent = html.match(/Messages envoyés[^<]*?(\d+)/)?.[1] ?? html.match(/Messages sent[^<]*?(\d+)/)?.[1];
    const responseRate = html.match(/Taux de réponse[^<]*?(\d+)%/)?.[1] ?? html.match(/response rate[^<]*?(\d+)%/)?.[1];

    // Extract conversations
    const conversations: Record<string, unknown>[] = [];
    const mediaBlocks = html.split(/class="media\s+mb-3"/);
    for (let i = 1; i < mediaBlocks.length; i++) {
      const block = mediaBlocks[i];
      // User link: /properties?user=XXXXX
      const userMatch = block.match(/\/properties\?user=(\d+)/);
      const userId = userMatch ? parseInt(userMatch[1], 10) : null;
      // Name
      const nameMatch = block.match(/<h5[^>]*>([\s\S]*?)<\/h5>/);
      const name = nameMatch?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().split(/\s{2,}/)[0] ?? "";
      // Property IDs (badges)
      const propIds = [...block.matchAll(/#(\d+)/g)].map((m) => parseInt(m[1], 10));
      // Chat ID from destroy form
      const chatIdMatch = block.match(/chats\/(\d+)\/destroy/);
      const chatId = chatIdMatch ? parseInt(chatIdMatch[1], 10) : null;
      // Message preview
      const msgMatch = block.match(/(?:Toi:|You:)?\s*([\s\S]*?)(?:<\/p>|<\/div>|\d+\s+\w+\s+\d{4})/);
      const lastMessage = block.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
      // Date
      const dateMatch = block.match(/(\d{1,2}\s+\w+\s+\d{4}\s+\d{1,2}:\d{2})/);

      if (userId) {
        conversations.push({
          chatId,
          userId,
          name: name.substring(0, 60),
          propertyIds: propIds,
          lastMessage: lastMessage.substring(0, 150),
          date: dateMatch?.[1] ?? "",
        });
      }
    }

    return {
      stats: { received, sent, responseRate },
      count: conversations.length,
      conversations,
    };
  }

  private parseMessagesPage(
    html: string,
    userId: number,
    propertyId: number
  ): Record<string, unknown> {
    // Extract chat_id from hidden field
    const chatId = html.match(/id="chat_id"[^>]*value="(\d+)"/)?.[1];
    // Extract messages — they are in the #messagelist div
    const msgSection = html.match(/id="messagelist"([\s\S]*?)(?:<\/div>\s*<\/div>\s*<\/div>|$)/)?.[1] ?? html;
    const messages: Record<string, unknown>[] = [];

    // Messages are in alternating blocks — parse by date pattern
    const msgBlocks = msgSection.split(/(?=\d{1,2}\s+\w{3,}\s+\d{4}\s+\d{1,2}:\d{2})/);
    for (const block of msgBlocks) {
      const dateMatch = block.match(/(\d{1,2}\s+\w{3,}\s+\d{4}\s+\d{1,2}:\d{2})/);
      if (!dateMatch) continue;
      const msgIdMatch = block.match(/messages\/(\d+)\/destroy/);
      const body = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      // Determine if it's from me or them
      const isMe = block.includes("text-end") || block.includes("float-right") || block.includes("Toi:");

      messages.push({
        id: msgIdMatch ? parseInt(msgIdMatch[1], 10) : null,
        date: dateMatch[1],
        sender: isMe ? "me" : "them",
        body: body.substring(0, 500),
      });
    }

    return { userId, propertyId, chatId, messageCount: messages.length, messages };
  }

  private parseExchangesPage(html: string): Record<string, unknown> {
    const exchanges: Record<string, unknown>[] = [];
    const editLinks = [...html.matchAll(/\/exchanges\/(\d+)\/edit/g)];
    const cards = html.split(/class="card(?:\s|")/);

    for (const match of editLinks) {
      const id = parseInt(match[1], 10);
      // Find the card containing this exchange
      const card = cards.find((c) => c.includes(`exchanges/${id}/edit`)) ?? "";
      const title = card.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
      const location = card.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
      const dateMatch = card.match(/(\d{1,2}\s*[-–]\s*\d{1,2}\s+\w+\s+\d{4}|\d{1,2}\s+\w+\s+\d{4}\s*[-–]\s*\d{1,2}\s+\w+\s+\d{4})/);
      const typeMatch = card.match(/(Simultaneous|Non-Simultaneous|Non-Reciprocal|Hospitality|Simultané|Non-Simultané|Non-Réciproque|Hospitalité)/i);
      const refMatch = card.match(/#(\d+)/);

      exchanges.push({
        id,
        title: title.substring(0, 100),
        location: location.substring(0, 100),
        dates: dateMatch?.[1] ?? "",
        type: typeMatch?.[1] ?? "",
        propertyRef: refMatch ? parseInt(refMatch[1], 10) : null,
      });
    }

    return { count: exchanges.length, exchanges: [...new Map(exchanges.map((e) => [e.id, e])).values()] };
  }

  private parseExchangeDetailPage(html: string, exchangeId: number): Record<string, unknown> {
    const status = html.includes("Échange terminé") || html.includes("Exchange completed")
      ? "completed"
      : html.includes("Proposition") || html.includes("Proposal")
        ? "proposed"
        : html.includes("Accepté") || html.includes("Accepted")
          ? "accepted"
          : "unknown";
    const startDate = html.match(/id="start_date"[^>]*value="([^"]+)"/)?.[1] ?? "";
    const endDate = html.match(/id="end_date"[^>]*value="([^"]+)"/)?.[1] ?? "";
    const adults = html.match(/id="adults"[^>]*value="(\d+)"/)?.[1] ?? "";
    const children = html.match(/id="children"[^>]*value="(\d+)"/)?.[1] ?? "";
    const swapType = html.match(/checked[^>]*id="(simultaneous|non_simultaneous|non_reciprocal|hospitality)"/)?.[1] ?? "";
    const propertyId = html.match(/id="date_property_id"[^>]*value="(\d+)"/)?.[1] ?? "";

    return { id: exchangeId, status, startDate, endDate, adults, children, swapType, propertyId };
  }

  private parseSearchResults(html: string): Record<string, unknown> {
    const results: Record<string, unknown>[] = [];

    // Cards are split by "home-grid-item" or card-profile pattern
    const cards = html.split(/class="home-grid-item"/);
    for (let i = 1; i < cards.length && results.length < 30; i++) {
      const card = cards[i];
      // Property ID from link
      const idMatch = card.match(/\/properties\/(\d+)/);
      if (!idMatch) continue;
      const id = parseInt(idMatch[1], 10);
      if (id === 0) continue;

      // Title from <h2 class="card-title">
      const title = card.match(/<h2[^>]*class="card-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/)?.[1]?.replace(/<[^>]+>/g, "").trim()
        ?? `Property #${id}`;
      // Owner name from <h3>
      const owner = card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
      // Location from card-secondary divs
      const secondaries = [...card.matchAll(/class="card-secondary"[^>]*>([\s\S]*?)<\/div>/g)]
        .map((m) => m[1].replace(/<[^>]+>/g, "").trim());
      const type = secondaries[0] ?? "";
      const location = secondaries[1] ?? "";
      // Image
      const image = card.match(/src="(https:\/\/assets\.pluhe\.com[^"]+)"/)?.[1] ?? "";
      // Premium / Verified
      const isPremium = card.includes("Premium");
      const isVerified = card.includes("Verified") || card.includes("Vérifié");
      // Capacity from hidden inputs
      const capacity = card.match(/property-capacity[^>]*value="(\d+)"/)?.[1];
      const bedrooms = card.match(/property-bedrooms[^>]*value="(\d+)"/)?.[1];

      results.push({
        id, title, owner, type, location, image,
        isPremium, isVerified,
        capacity: capacity ? parseInt(capacity, 10) : null,
        bedrooms: bedrooms ? parseInt(bedrooms, 10) : null,
      });
    }

    // Pagination
    const totalMatch = html.match(/Recherche?\s+([\d\s]+)\s+maisons/i)
      ?? html.match(/Search\s+([\d\s]+)\s+homes/i);
    const total = totalMatch ? parseInt(totalMatch[1].replace(/\s/g, ""), 10) : null;
    const lastPage = html.match(/page=(\d+)[^"]*"[^>]*>\s*›\s*</)?.[1];

    return { total, lastPage: lastPage ? parseInt(lastPage, 10) : null, count: results.length, results };
  }
}
