import { Injectable } from '@nestjs/common';

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

/**
 * In-memory token store. Fine for a single-user local dev app.
 * For multi-user / production you'd persist these per user instead.
 */
@Injectable()
export class TokenStore {
  private tokens: SpotifyTokens | null = null;
  /** CSRF state value for the in-flight OAuth login. */
  private pendingState: string | null = null;

  setTokens(tokens: SpotifyTokens): void {
    this.tokens = tokens;
  }

  getTokens(): SpotifyTokens | null {
    return this.tokens;
  }

  clear(): void {
    this.tokens = null;
  }

  isConnected(): boolean {
    return this.tokens !== null;
  }

  setPendingState(state: string): void {
    this.pendingState = state;
  }

  consumeState(state: string): boolean {
    const ok = this.pendingState !== null && this.pendingState === state;
    this.pendingState = null;
    return ok;
  }
}
