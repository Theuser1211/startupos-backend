export interface Startup {
  id: string;
  name: string;
  description: string | null;
  logo: string | null;
  industry: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStartupPayload {
  name: string;
  industry?: string;
  description?: string;
  logo?: string;
}

export interface StartupResponse {
  startup: Startup;
}

export interface StartupsResponse {
  startups: Startup[];
}
