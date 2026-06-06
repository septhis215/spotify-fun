import { Module } from '@nestjs/common';
import { ApiController } from './api.controller';
import { AuthController } from './auth.controller';
import { LyricsService } from './lyrics.service';
import { SpotifyService } from './spotify.service';
import { TokenStore } from './token.store';

@Module({
  controllers: [ApiController, AuthController],
  providers: [SpotifyService, LyricsService, TokenStore],
})
export class SpotifyModule {}
