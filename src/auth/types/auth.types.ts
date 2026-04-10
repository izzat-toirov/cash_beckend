export interface GoogleProfile {
    googleId: string;
    email: string;
    displayName: string;
    accessToken: string;
  }
  
  export interface JwtPayload {
    sub: string;     
    email: string;
    sheetId: string;
  }
  
  export interface AuthenticatedUser {
    googleId: string;
    email: string;
    displayName: string;
    sheetId: string;
  }