import type { Auth } from "./auth.js";

const BASE = "https://peoplelikeus.world";
const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REQUEST_DELAY = parseInt(process.env.PLU_REQUEST_DELAY ?? "1000", 10);
let lastRequest = 0;
async function throttle(): Promise<void> { const now = Date.now(); const wait = REQUEST_DELAY - (now - lastRequest); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); lastRequest = Date.now(); }

interface GeoResult { lat: string; lng: string; country?: string; state?: string; city?: string; }
async function geocode(query: string): Promise<GeoResult | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&addressdetails=1&accept-language=en`;
    const resp = await fetch(url, { headers: { "user-agent": "peoplelikeus-mcp/1.0" } });
    if (!resp.ok) return null;
    const data = (await resp.json()) as Array<{ lat: string; lon: string; address?: { country?: string; state?: string; city?: string; town?: string; village?: string } }>;
    if (!data.length) return null;
    const item = data[0];
    return { lat: item.lat, lng: item.lon, country: item.address?.country, state: item.address?.state, city: item.address?.city ?? item.address?.town ?? item.address?.village };
  } catch { return null; }
}

export class Api {
  constructor(private auth: Auth) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { "user-agent": USER_AGENT, cookie: this.auth.getCookieHeader(), referer: `${BASE}/`, accept: "text/html,application/xhtml+xml,application/json", ...extra };
  }

  private async getJson(path: string): Promise<unknown> {
    await throttle(); const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const resp = await fetch(url, { headers: { ...this.headers(), accept: "application/json" } });
    this.auth.updateFromResponse(resp);
    if (resp.status === 419) { this.auth.invalidate(); throw new Error("CSRF token mismatch (419)"); }
    if (!resp.ok) throw new Error(`GET ${path} \u2192 ${resp.status}`); return resp.json();
  }

  private async getHtml(path: string): Promise<string> {
    await throttle(); const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const resp = await fetch(url, { headers: this.headers() });
    this.auth.updateFromResponse(resp);
    if (resp.status === 419) { this.auth.invalidate(); throw new Error("CSRF token mismatch (419)"); }
    if (!resp.ok) throw new Error(`GET ${path} \u2192 ${resp.status}`); return resp.text();
  }

  private async post(path: string, data: Record<string, string>, method = "POST"): Promise<unknown> {
    await this.auth.refreshCsrf(); await throttle();
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const body = new URLSearchParams({ _token: this.auth.getCsrfToken(), ...data });
    if (method !== "POST") body.set("_method", method);
    const resp = await fetch(url, { method: "POST", headers: { ...this.headers(), "content-type": "application/x-www-form-urlencoded", "x-xsrf-token": this.auth.getCsrfToken(), accept: "application/json, text/html" }, body: body.toString(), redirect: "manual" });
    this.auth.updateFromResponse(resp);
    if (resp.status === 419) { this.auth.invalidate(); throw new Error("CSRF token mismatch (419)"); }
    if (resp.status === 302) return { success: true, redirect: resp.headers.get("location") };
    const text = await resp.text(); try { return JSON.parse(text); } catch { if (!resp.ok) throw new Error(`POST ${path} \u2192 ${resp.status}: ${text.substring(0, 200)}`); return { success: true, status: resp.status }; }
  }

  private async ajaxPost(path: string, data: Record<string, string>): Promise<unknown> {
    await this.auth.refreshCsrf(); await throttle();
    const url = path.startsWith("http") ? path : `${BASE}${path}`;
    const body = new URLSearchParams({ _token: this.auth.getCsrfToken(), ...data });
    const resp = await fetch(url, { method: "POST", headers: { ...this.headers(), "content-type": "application/x-www-form-urlencoded", "x-requested-with": "XMLHttpRequest", "x-xsrf-token": this.auth.getCsrfToken(), accept: "application/json" }, body: body.toString() });
    this.auth.updateFromResponse(resp);
    if (resp.status === 419) { this.auth.invalidate(); throw new Error("CSRF token mismatch (419)"); }
    if (!resp.ok) { const text = await resp.text(); throw new Error(`POST ${path} \u2192 ${resp.status}: ${text.substring(0, 200)}`); }
    return resp.json();
  }

  async getProperty(propertyId: number): Promise<unknown> { return this.parsePropertyPage(await this.getHtml(`/en/properties/${propertyId}`), propertyId); }
  async getMyProperties(): Promise<unknown> { return this.parseMyPropertiesPage(await this.getHtml("/en/my-home-profile")); }
  async getAvailabilities(propertyId: number): Promise<unknown> { return this.getJson(`/api/availables/${propertyId}`); }
  async getUnavailabilities(propertyId: number): Promise<unknown> { return this.getJson(`/api/unavailables/${propertyId}`); }
  async addAvailability(propertyId: number, startDate: string, endDate: string, options: { sim?: boolean; non_sim?: boolean; non_reciprocal?: boolean; hospitality?: boolean } = {}): Promise<unknown> {
    const data: Record<string, string> = { property_id: String(propertyId), start_date: startDate, end_date: endDate };
    if (options.sim !== undefined) data.sim = options.sim ? "1" : "0";
    if (options.non_sim !== undefined) data.non_sim = options.non_sim ? "1" : "0";
    if (options.non_reciprocal !== undefined) data.non_reciprocal = options.non_reciprocal ? "1" : "0";
    if (options.hospitality !== undefined) data.hospitality = options.hospitality ? "1" : "0";
    return this.ajaxPost("/availables/store", data);
  }
  async deleteAvailability(availabilityId: number): Promise<unknown> { return this.post(`/availables/${availabilityId}`, {}, "DELETE"); }
  async addUnavailability(propertyId: number, startDate: string, endDate: string): Promise<unknown> { return this.ajaxPost("/unavailables/store", { property_id: String(propertyId), start_date: startDate, end_date: endDate }); }
  async deleteUnavailability(unavailabilityId: number): Promise<unknown> { return this.post(`/unavailables/${unavailabilityId}`, {}, "DELETE"); }
  async getConversations(filter?: string, page = 1): Promise<unknown> { let path = `/en/chats?user=${this.auth.getUserId()}&page=${page}`; if (filter) path += `&filter=${filter}`; return this.parseConversationsPage(await this.getHtml(path)); }
  async getMessages(userId: number, propertyId: number): Promise<unknown> { return this.parseMessagesPage(await this.getHtml(`/en/messages/user/${userId}/property/${propertyId}`), userId, propertyId); }
  async sendMessage(toUserId: number, body: string, propertyId: number, chatId?: number, exchangeId?: string): Promise<unknown> { return this.ajaxPost(`/messages/store/${toUserId}`, { body, property: String(propertyId), exchange: exchangeId ?? "", chat_id: chatId ? String(chatId) : "", welcome_message: "0", renewal_message: "0" }); }
  async deleteMessage(messageId: number): Promise<unknown> { return this.post(`/messages/${messageId}/destroy`, {}, "DELETE"); }
  async deleteConversation(chatId: number): Promise<unknown> { return this.post(`/chats/${chatId}/destroy`, {}, "DELETE"); }
  async getExchanges(): Promise<unknown> { return this.parseExchangesPage(await this.getHtml("/en/exchanges")); }
  async getExchange(exchangeId: number): Promise<unknown> { return this.parseExchangeDetailPage(await this.getHtml(`/en/exchanges/${exchangeId}/edit`), exchangeId); }
  async createExchange(userId: number, propertyId: number): Promise<unknown> { return this.post(`/exchanges/create/user/${userId}/property/${propertyId}`, {}); }
  async updateExchangeDates(exchangeId: number, startDate: string, endDate: string): Promise<unknown> { return this.post(`/exchanges/${exchangeId}/update/dates`, { start_date: startDate, end_date: endDate }, "PUT"); }
  async updateExchangeType(exchangeId: number, swapType: "simultaneous" | "non_simultaneous" | "non_reciprocal" | "hospitality"): Promise<unknown> { return this.post(`/exchanges/${exchangeId}/update/exchangetype`, { swap_type: swapType }, "PUT"); }
  async cancelExchange(exchangeId: number): Promise<unknown> { return this.post(`/exchanges/${exchangeId}/cancel`, {}, "PUT"); }

  async searchHomes(params: Record<string, string>): Promise<unknown> {
    if (params.search && !params.lat) {
      const geo = await geocode(params.search);
      if (geo) { params.lat = geo.lat; params.lng = geo.lng; if (geo.country && !params.country_long) params.country_long = geo.country; if (geo.state) params.administrative_area_level_1_long = geo.state; if (geo.city) params.locality_long = geo.city; }
    }
    return this.parseSearchResults(await this.getHtml(`/en/homes?${new URLSearchParams(params)}`));
  }
  async quickSearch(listingNumber: number): Promise<unknown> { return this.parseSearchResults(await this.getHtml(`/quicksearch?listing_number=${listingNumber}`)); }
  async getNotifications(): Promise<unknown> { return this.getJson("/notifications"); }
  async getAuthUser(): Promise<unknown> { return this.getJson("/authuser"); }

  private parsePropertyPage(html: string, propertyId: number): Record<string, unknown> {
    const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const description = html.match(/id="description"[^>]*>([\s\S]*?)<\/div>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const ownerName = html.match(/class="member-name[^"]*"[^>]*>([\s\S]*?)<\/(?:a|h|div|span)>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const images = [...html.matchAll(/data-flickity-lazyload="([^"]+)"/g)].map((m) => m[1]);
    const location = html.match(/class="[^"]*location[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
    const ownerIdMatch = html.match(/\/properties\?user=(\d+)/);
    const ownerId = ownerIdMatch ? parseInt(ownerIdMatch[1], 10) : null;
    const isPremium = html.includes("Premium"); const isVerified = html.includes("Verified") || html.includes("V\u00e9rifi\u00e9");
    const exchangeTypes: string[] = [];
    if (html.includes("Simultaneous") || html.includes("Simultan\u00e9")) exchangeTypes.push("simultaneous");
    if (html.includes("Non-Simultaneous") || html.includes("Non-Simultan\u00e9")) exchangeTypes.push("non_simultaneous");
    if (html.includes("Non-Reciprocal") || html.includes("Non-R\u00e9ciproque")) exchangeTypes.push("non_reciprocal");
    if (html.includes("Hospitality") || html.includes("Hospitalit\u00e9")) exchangeTypes.push("hospitality");
    return { id: propertyId, title, description: description.substring(0, 500), ownerId, ownerName, location, images: images.slice(0, 5), isPremium, isVerified, exchangeTypes };
  }

  private parseMyPropertiesPage(html: string): Record<string, unknown> {
    const ids = [...new Set([...html.matchAll(/\/properties\/(\d+)\/edit/g)].map((m) => parseInt(m[1], 10)))];
    const titles = [...html.matchAll(/<h5[^>]*>([\s\S]*?)<\/h5>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim()).filter((t) => t.length > 5);
    return { properties: ids.map((id, i) => ({ id, title: titles[i] ?? `Property #${id}`, editUrl: `/properties/${id}/edit` })) };
  }

  private parseConversationsPage(html: string): Record<string, unknown> {
    const received = html.match(/Messages re\u00e7us[^<]*?(\d+)/)?.[1] ?? html.match(/Messages received[^<]*?(\d+)/)?.[1];
    const sent = html.match(/Messages envoy\u00e9s[^<]*?(\d+)/)?.[1] ?? html.match(/Messages sent[^<]*?(\d+)/)?.[1];
    const responseRate = html.match(/Taux de r\u00e9ponse[^<]*?(\d+)%/)?.[1] ?? html.match(/response rate[^<]*?(\d+)%/)?.[1];
    const conversations: Record<string, unknown>[] = [];
    const blocks = html.split(/class="media\s+mb-3"/);
    for (let i = 1; i < blocks.length; i++) {
      const b = blocks[i];
      const userId = b.match(/\/properties\?user=(\d+)/)?.[1]; if (!userId) continue;
      const name = b.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1]?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().split(/\s{2,}/)[0] ?? "";
      const propIds = [...b.matchAll(/#(\d+)/g)].map((m) => parseInt(m[1], 10));
      const chatId = b.match(/chats\/(\d+)\/destroy/)?.[1];
      const lastMessage = b.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
      const date = b.match(/(\d{1,2}\s+\w+\s+\d{4}\s+\d{1,2}:\d{2})/)?.[1] ?? "";
      conversations.push({ chatId: chatId ? parseInt(chatId, 10) : null, userId: parseInt(userId, 10), name: name.substring(0, 60), propertyIds: propIds, lastMessage: lastMessage.substring(0, 150), date });
    }
    return { stats: { received, sent, responseRate }, count: conversations.length, conversations };
  }

  private parseMessagesPage(html: string, userId: number, propertyId: number): Record<string, unknown> {
    const chatId = html.match(/id="chat_id"[^>]*value="(\d+)"/)?.[1];
    const msgSection = html.match(/id="messagelist"([\s\S]*?)(?:<\/div>\s*<\/div>\s*<\/div>|$)/)?.[1] ?? html;
    const messages: Record<string, unknown>[] = [];
    for (const block of msgSection.split(/(?=\d{1,2}\s+\w{3,}\s+\d{4}\s+\d{1,2}:\d{2})/)) {
      const dateMatch = block.match(/(\d{1,2}\s+\w{3,}\s+\d{4}\s+\d{1,2}:\d{2})/); if (!dateMatch) continue;
      const msgId = block.match(/messages\/(\d+)\/destroy/)?.[1];
      const body = block.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      const isMe = block.includes("text-end") || block.includes("float-right") || block.includes("Toi:");
      messages.push({ id: msgId ? parseInt(msgId, 10) : null, date: dateMatch[1], sender: isMe ? "me" : "them", body: body.substring(0, 500) });
    }
    return { userId, propertyId, chatId, messageCount: messages.length, messages };
  }

  private parseExchangesPage(html: string): Record<string, unknown> {
    const exchanges: Record<string, unknown>[] = []; const cards = html.split(/class="card(?:\s|")/); 
    for (const match of html.matchAll(/\/exchanges\/(\d+)\/edit/g)) {
      const id = parseInt(match[1], 10); const card = cards.find((c) => c.includes(`exchanges/${id}/edit`)) ?? "";
      exchanges.push({ id, title: (card.match(/<h5[^>]*>([\s\S]*?)<\/h5>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "").substring(0, 100), location: (card.match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "").substring(0, 100), dates: card.match(/(\d{1,2}\s*[-\u2013]\s*\d{1,2}\s+\w+\s+\d{4}|\d{1,2}\s+\w+\s+\d{4}\s*[-\u2013]\s*\d{1,2}\s+\w+\s+\d{4})/)?.[1] ?? "", type: card.match(/(Simultaneous|Non-Simultaneous|Non-Reciprocal|Hospitality)/i)?.[1] ?? "", propertyRef: card.match(/#(\d+)/)?.[1] ? parseInt(card.match(/#(\d+)/)![1], 10) : null });
    }
    return { count: exchanges.length, exchanges: [...new Map(exchanges.map((e) => [e.id, e])).values()] };
  }

  private parseExchangeDetailPage(html: string, exchangeId: number): Record<string, unknown> {
    const status = html.includes("\u00c9change termin\u00e9") || html.includes("Exchange completed") ? "completed" : html.includes("Proposition") || html.includes("Proposal") ? "proposed" : html.includes("Accept\u00e9") || html.includes("Accepted") ? "accepted" : "unknown";
    return { id: exchangeId, status, startDate: html.match(/id="start_date"[^>]*value="([^"]+)"/)?.[1] ?? "", endDate: html.match(/id="end_date"[^>]*value="([^"]+)"/)?.[1] ?? "", adults: html.match(/id="adults"[^>]*value="(\d+)"/)?.[1] ?? "", children: html.match(/id="children"[^>]*value="(\d+)"/)?.[1] ?? "", swapType: html.match(/checked[^>]*id="(simultaneous|non_simultaneous|non_reciprocal|hospitality)"/)?.[1] ?? "", propertyId: html.match(/id="date_property_id"[^>]*value="(\d+)"/)?.[1] ?? "" };
  }

  private parseSearchResults(html: string): Record<string, unknown> {
    const results: Record<string, unknown>[] = []; const cards = html.split(/class="home-grid-item"/);
    for (let i = 1; i < cards.length && results.length < 30; i++) {
      const card = cards[i]; const idMatch = card.match(/\/properties\/(\d+)/); if (!idMatch) continue;
      const id = parseInt(idMatch[1], 10); if (id === 0) continue;
      const title = card.match(/<h2[^>]*class="card-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? `Property #${id}`;
      const owner = card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? "";
      const secs = [...card.matchAll(/class="card-secondary"[^>]*>([\s\S]*?)<\/div>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
      const image = card.match(/src="(https:\/\/assets\.pluhe\.com[^"]+)"/)?.[1] ?? "";
      const capacity = card.match(/property-capacity[^>]*value="(\d+)"/)?.[1];
      const bedrooms = card.match(/property-bedrooms[^>]*value="(\d+)"/)?.[1];
      results.push({ id, title, owner, type: secs[0] ?? "", location: secs[1] ?? "", image, isPremium: card.includes("Premium"), isVerified: card.includes("Verified") || card.includes("V\u00e9rifi\u00e9"), capacity: capacity ? parseInt(capacity, 10) : null, bedrooms: bedrooms ? parseInt(bedrooms, 10) : null });
    }
    const totalMatch = html.match(/Recherche?\s+([\d\s]+)\s+maisons/i) ?? html.match(/Search\s+([\d\s]+)\s+homes/i);
    const total = totalMatch ? parseInt(totalMatch[1].replace(/\s/g, ""), 10) : null;
    const lastPage = html.match(/page=(\d+)[^"]*"[^>]*>\s*\u203a\s*</)?.[1];
    return { total, lastPage: lastPage ? parseInt(lastPage, 10) : null, count: results.length, results };
  }
}
