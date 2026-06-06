import {
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenStore } from './token.store';

const SPOTIFY_AUTH_BASE = 'https://accounts.spotify.com';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

const SCOPES = [
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-read-private',
  'user-read-email',
  // Web Playback SDK + remote control (requires Spotify Premium).
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
];

export interface SpotifyPlaylist {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  trackCount: number;
  owner: string;
  url: string;
}

export interface SpotifyProfile {
  displayName: string;
  imageUrl: string | null;
  product: string;
}

export interface SpotifyTrack {
  id: string;
  uri: string;
  name: string;
  artists: string;
  album: string;
  albumImageUrl: string | null;
  durationMs: number;
}

@Injectable()
export class SpotifyService {
  constructor(
    private readonly config: ConfigService,
    private readonly tokenStore: TokenStore,
  ) {}

  private get clientId(): string {
    return this.config.getOrThrow<string>('SPOTIFY_CLIENT_ID');
  }

  private get clientSecret(): string {
    return this.config.getOrThrow<string>('SPOTIFY_CLIENT_SECRET');
  }

  private get redirectUri(): string {
    return this.config.getOrThrow<string>('SPOTIFY_REDIRECT_URI');
  }

  /** Build the Spotify authorize URL the user is redirected to for login. */
  buildAuthorizeUrl(state: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      scope: SCOPES.join(' '),
      redirect_uri: this.redirectUri,
      state,
    });
    return `${SPOTIFY_AUTH_BASE}/authorize?${params.toString()}`;
  }

  /** Exchange the authorization code from the callback for tokens. */
  async exchangeCodeForTokens(code: string): Promise<void> {
    const res = await fetch(`${SPOTIFY_AUTH_BASE}/api/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${this.basicAuthHeader()}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new InternalServerErrorException(
        `Token exchange failed (${res.status}): ${detail}`,
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    this.tokenStore.setTokens({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    });
  }

  /** Returns a valid access token, refreshing it if it has expired. */
  private async getValidAccessToken(): Promise<string> {
    const tokens = this.tokenStore.getTokens();
    if (!tokens) {
      throw new UnauthorizedException('Not connected to Spotify. Visit /login.');
    }

    // Refresh a minute before actual expiry to avoid races.
    if (Date.now() < tokens.expiresAt - 60_000) {
      return tokens.accessToken;
    }

    const res = await fetch(`${SPOTIFY_AUTH_BASE}/api/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${this.basicAuthHeader()}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: tokens.refreshToken,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new InternalServerErrorException(
        `Token refresh failed (${res.status}): ${detail}`,
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    this.tokenStore.setTokens({
      accessToken: data.access_token,
      // Spotify may or may not return a new refresh token.
      refreshToken: data.refresh_token ?? tokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    });

    return data.access_token;
  }

  private async apiGet<T>(path: string): Promise<T> {
    const token = await this.getValidAccessToken();
    const res = await fetch(`${SPOTIFY_API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 401) {
      this.tokenStore.clear();
      throw new UnauthorizedException('Spotify session expired. Visit /login.');
    }
    if (!res.ok) {
      const detail = await res.text();
      // Pass the real upstream status through (e.g. 403 = dev-mode restriction,
      // 429 = rate limited) instead of masking everything as a 500.
      throw new HttpException(
        `Spotify API error (${res.status}): ${detail}`,
        res.status,
      );
    }
    return (await res.json()) as T;
  }

  /** Public accessor used by the Web Playback SDK token endpoint. */
  async getAccessToken(): Promise<string> {
    return this.getValidAccessToken();
  }

  async getProfile(): Promise<SpotifyProfile> {
    const data = await this.apiGet<{
      display_name: string | null;
      images: { url: string }[] | null;
      product: string | null;
    }>('/me');
    return {
      displayName: data.display_name ?? 'Spotify user',
      imageUrl: data.images?.[0]?.url ?? null,
      product: data.product ?? 'unknown',
    };
  }

  /** Fetch ALL playlists for the current user, paging through results. */
  async getAllPlaylists(): Promise<SpotifyPlaylist[]> {
    const playlists: SpotifyPlaylist[] = [];
    let url: string | null = '/me/playlists?limit=50';

    while (url) {
      const page: SpotifyPlaylistPage = await this.apiGet<SpotifyPlaylistPage>(url);
      for (const item of page.items) {
        if (!item) continue;
        playlists.push({
          id: item.id,
          name: item.name,
          description: item.description || null,
          imageUrl: item.images?.[0]?.url ?? null,
          trackCount: item.tracks?.total ?? 0,
          owner: item.owner?.display_name ?? 'Unknown',
          url: item.external_urls?.spotify ?? '#',
        });
      }
      // `next` is an absolute URL; strip the base so apiGet can reuse it.
      url = page.next ? page.next.replace(SPOTIFY_API_BASE, '') : null;
    }

    return playlists;
  }

  /** Fetch ALL tracks for a playlist, paging through results. */
  async getPlaylistTracks(playlistId: string): Promise<SpotifyTrack[]> {
    const tracks: SpotifyTrack[] = [];
    const fields =
      'items(track(id,uri,name,duration_ms,artists(name),album(name,images))),next';
    let url: string | null = `/playlists/${playlistId}/tracks?limit=100&fields=${encodeURIComponent(fields)}`;

    while (url) {
      const page: SpotifyTrackPage = await this.apiGet<SpotifyTrackPage>(url);
      for (const item of page.items) {
        const t = item?.track;
        if (!t || !t.uri) continue; // skip null / local / unavailable tracks
        tracks.push({
          id: t.id,
          uri: t.uri,
          name: t.name,
          artists: (t.artists ?? []).map((a) => a.name).join(', '),
          album: t.album?.name ?? '',
          albumImageUrl: t.album?.images?.[0]?.url ?? null,
          durationMs: t.duration_ms ?? 0,
        });
      }
      url = page.next ? page.next.replace(SPOTIFY_API_BASE, '') : null;
    }

    return tracks;
  }

  /** Search the Spotify catalogue for tracks. */
  async search(query: string): Promise<SpotifyTrack[]> {
    // Dev-mode quirks: passing `limit` triggers 400 "Invalid limit", and each
    // page is capped to ~5 results — but `offset` works, so we walk pages to
    // gather more, stopping at `next === null` or a sensible page cap.
    const tracks: SpotifyTrack[] = [];
    const seen = new Set<string>();
    const MAX_PAGES = 8;
    let offset = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        q: query,
        type: 'track',
        market: 'from_token',
        offset: String(offset),
      });
      const data = await this.apiGet<{
        tracks: { items: SpotifyApiTrack[]; next: string | null };
      }>(`/search?${params.toString()}`);

      const items = data.tracks?.items ?? [];
      if (!items.length) break;
      offset += items.length;

      for (const t of items) {
        if (!t || !t.uri) continue;
        const mapped = this.mapTrack(t);
        // De-dupe by title+artist so the same song on different releases
        // doesn't appear multiple times.
        const key = `${mapped.name}|${mapped.artists}`.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tracks.push(mapped);
      }
      if (!data.tracks?.next) break;
    }

    return tracks;
  }

  private mapTrack(t: SpotifyApiTrack): SpotifyTrack {
    return {
      id: t.id,
      uri: t.uri,
      name: t.name,
      artists: (t.artists ?? []).map((a) => a.name).join(', '),
      album: t.album?.name ?? '',
      albumImageUrl: t.album?.images?.[0]?.url ?? null,
      durationMs: t.duration_ms ?? 0,
    };
  }

  /** Start playback of given track URIs on a specific Web Playback SDK device. */
  async play(deviceId: string, uris: string[], positionMs = 0): Promise<void> {
    const token = await this.getValidAccessToken();
    const res = await fetch(
      `${SPOTIFY_API_BASE}/me/player/play?device_id=${encodeURIComponent(deviceId)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uris, position_ms: positionMs }),
      },
    );

    // 204 = success (no body). 403 usually means "not Premium".
    if (res.status === 403) {
      throw new ForbiddenException(
        'Playback requires Spotify Premium (Web Playback SDK).',
      );
    }
    if (!res.ok && res.status !== 204) {
      const detail = await res.text();
      throw new InternalServerErrorException(
        `Failed to start playback (${res.status}): ${detail}`,
      );
    }
  }

  private basicAuthHeader(): string {
    return Buffer.from(`${this.clientId}:${this.clientSecret}`).toString(
      'base64',
    );
  }
}

interface SpotifyPlaylistPage {
  items: Array<{
    id: string;
    name: string;
    description: string | null;
    images: { url: string }[] | null;
    tracks: { total: number } | null;
    owner: { display_name: string | null } | null;
    external_urls: { spotify: string } | null;
  } | null>;
  next: string | null;
}

interface SpotifyApiTrack {
  id: string;
  uri: string;
  name: string;
  duration_ms: number;
  artists: { name: string }[] | null;
  album: { name: string; images: { url: string }[] | null } | null;
}

interface SpotifyTrackPage {
  items: Array<{ track: SpotifyApiTrack | null } | null>;
  next: string | null;
}
