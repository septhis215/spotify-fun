import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { LyricsService } from './lyrics.service';
import { SpotifyService } from './spotify.service';
import { TokenStore } from './token.store';

interface PlayBody {
  deviceId?: string;
  uris?: string[];
  positionMs?: number;
}

@Controller('api')
export class ApiController {
  constructor(
    private readonly spotify: SpotifyService,
    private readonly lyrics: LyricsService,
    private readonly tokenStore: TokenStore,
  ) {}

  /** Lightweight connection check used by the frontend on load. */
  @Get('status')
  status() {
    return { connected: this.tokenStore.isConnected() };
  }

  /** Access token for the browser-side Web Playback SDK. */
  @Get('token')
  async token() {
    return { accessToken: await this.spotify.getAccessToken() };
  }

  @Get('me')
  async me() {
    return this.spotify.getProfile();
  }

  @Get('playlists')
  async playlists() {
    return this.spotify.getAllPlaylists();
  }

  @Get('playlists/:id/tracks')
  async tracks(@Param('id') id: string) {
    return this.spotify.getPlaylistTracks(id);
  }

  @Get('search')
  async search(@Query('q') q?: string) {
    if (!q || !q.trim()) return [];
    return this.spotify.search(q.trim());
  }

  @Get('lyrics')
  async getLyrics(
    @Query('artist') artist?: string,
    @Query('title') title?: string,
    @Query('album') album?: string,
    @Query('duration') duration?: string,
  ) {
    if (!artist || !title) {
      throw new BadRequestException('artist and title are required');
    }
    return this.lyrics.getLyrics(
      artist,
      title,
      album ?? '',
      Number(duration) || 0,
    );
  }

  @Put('play')
  async play(@Body() body: PlayBody) {
    if (!body.deviceId || !body.uris?.length) {
      throw new BadRequestException('deviceId and uris are required');
    }
    await this.spotify.play(body.deviceId, body.uris, body.positionMs ?? 0);
    return { ok: true };
  }
}
