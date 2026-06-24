import jwt from "jsonwebtoken";
import { env } from "./env.js";
import type { JwtPayload } from "@startupos/shared";

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as string | number,
  } as jwt.SignOptions);
}

export function verifyToken(token: string, ignoreExpiration = false): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET, {
    ignoreExpiration,
  } as jwt.VerifyOptions) as JwtPayload;
}