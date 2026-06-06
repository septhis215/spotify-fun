import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import type { Response } from 'express';
import { SpotifyService } from './spotify.service';
import { TokenStore } from './token.store';

@Controller()
export class AuthController {
  constructor(
    private readonly spotify: SpotifyService,
    private readonly tokenStore: TokenStore,
    private readonly config: ConfigService,
  ) {}

  /** Where to send the browser after auth completes (the Angular app). */
  private get clientUrl(): string {
    return this.config.get<string>('CLIENT_URL') ?? 'http://127.0.0.1:4200';
  }

  /** Kick off the OAuth login by redirecting to Spotify. */
  @Get('login')
  login(@Res() res: Response): void {
    const state = randomBytes(16).toString('hex');
    this.tokenStore.setPendingState(state);
    res.redirect(this.spotify.buildAuthorizeUrl(state));
  }

  /** Spotify redirects back here with a code; exchange it for tokens. */
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (error) {
      throw new BadRequestException(`Spotify authorization failed: ${error}`);
    }
    if (!code || !state) {
      throw new BadRequestException('Missing code or state in callback.');
    }
    if (!this.tokenStore.consumeState(state)) {
      throw new BadRequestException('State mismatch — possible CSRF. Try /login again.');
    }

    await this.spotify.exchangeCodeForTokens(code);
    res.redirect(this.clientUrl);
  }

  /** Log out by clearing stored tokens. */
  @Get('logout')
  logout(@Res() res: Response): void {
    this.tokenStore.clear();
    res.redirect(this.clientUrl);
  }
}
