export interface AuthUser {
  id: string;
  email: string;
  name?: string;
}

export interface JwtPayload {
  userId: string;
  email: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  name: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}
