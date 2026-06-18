export interface AuthCredentials {
  email: string;
  password: string;
}

export interface SessionState {
  cookies: string[];
  csrfToken: string;
  userId: number | null;
  authenticatedAt: Date;
  source: string;
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
