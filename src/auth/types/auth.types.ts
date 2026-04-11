// src/auth/types/auth.types.ts

export interface GoogleProfile {
  googleId: string;
  email: string;
  displayName: string;
  accessToken: string;
}

export interface AuthenticatedUser {
  googleId: string;
  email: string;
  displayName: string;
  sheetId: string;
}

export interface JwtPayload {
  sub: string;        // googleId
  email: string;
  sheetId: string;    // ← user'ning Google Sheet ID si
  displayName?: string;
}