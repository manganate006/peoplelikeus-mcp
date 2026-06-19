// ── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthCredentials {
  email: string;
  password: string;
}

export interface SessionState {
  /** Laravel session cookies (laravel_session + XSRF-TOKEN) */
  cookies: string[];
  /** CSRF token from meta[name="csrf-token"] */
  csrfToken: string;
  /** Authenticated user ID */
  userId: number | null;
  /** When the session was established */
  authenticatedAt: Date;
  /** Source: "login" | "cookies" | "cache" */
  source: string;
}

// ── Properties ───────────────────────────────────────────────────────────────

export interface Property {
  id: number;
  title: string;
  type: string;
  location: string;
  capacity: number;
  bedrooms: number;
  bathrooms: number;
  owner: { id: number; name: string };
  images: string[];
  description: string;
  exchangeTypes: string[];
  isPremium: boolean;
  isVerified: boolean;
}

export interface Availability {
  id: number;
  property_id: number;
  start_date: string;
  end_date: string;
  sim: boolean | null;
  non_sim: boolean | null;
  non_reciprocal: boolean | null;
  hospitality: boolean | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

// ── Conversations & Messages ─────────────────────────────────────────────────

export interface ConversationSummary {
  chatId: number;
  userId: number;
  userName: string;
  propertyId: number;
  lastMessage: string;
  date: string;
  isRead: boolean;
  isPremium: boolean;
  isVerified: boolean;
}

export interface Message {
  id: number;
  body: string;
  date: string;
  sender: "me" | "them";
}

// ── Exchanges ────────────────────────────────────────────────────────────────

export interface Exchange {
  id: number;
  status: string;
  type: string;
  propertyId: number;
  propertyTitle: string;
  partnerName: string;
  startDate: string;
  endDate: string;
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface SearchFilters {
  location?: string;
  country?: string;
  startDate?: string;
  endDate?: string;
  guests?: number;
  type?: string;
  page?: number;
}

// ── Notifications ────────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  type: string;
  message: string;
  read: boolean;
  created_at: string;
}
