import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Lyrics, NowPlaying, Playback, Profile, Track } from './models';

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private http = inject(HttpClient);

  // ---- reactive state ----
  readonly connected = signal<boolean | null>(null); // null = still checking
  readonly profile = signal<Profile | null>(null);
  readonly canPlay = signal(false);
  readonly notice = signal<string | null>(null);

  // Search-to-play (Spotify dev-mode blocks listing playlist tracks, but
  // catalogue search + playback are allowed).
  readonly tracks = signal<Track[]>([]); // current search results
  readonly query = signal('');
  readonly searching = signal(false);
  readonly searched = signal(false); // has a search completed at least once

  readonly nowPlaying = signal<NowPlaying | null>(null);
  readonly currentUri = signal<string | null>(null);
  readonly playback = signal<Playback>({
    positionMs: 0,
    durationMs: 0,
    paused: true,
    updatedAt: 0,
  });

  readonly lyrics = signal<Lyrics>({ synced: [], plain: null, source: null });
  readonly lyricsLoading = signal(false);
  readonly activeLine = signal<number>(-1);

  // throttled UI clocks (updated by the rAF loop)
  readonly progressMs = signal(0);
  readonly vu = signal<{ l: number; r: number }>({ l: -38, r: -38 });

  readonly isPlaying = computed(
    () => !this.playback().paused && this.playback().durationMs > 0,
  );

  private player: SpotifyPlayer | null = null;
  private deviceId: string | null = null;
  private sdkReady = false;
  private lyricsToken = 0;
  private lastProg = 0;
  private lastVu = 0;
  /** The track the user just selected and is loading; the SDK keeps playing the
   *  old track meanwhile, so onPlayerState must ignore it until this clears. */
  private pendingUri: string | null = null;
  /** Monotonic id so only the most recent selection wins a fast switch. */
  private selectionSeq = 0;

  constructor() {
    window.onSpotifyWebPlaybackSDKReady = () => {
      this.sdkReady = true;
      this.maybeInitPlayer();
    };
  }

  /** Called once from the root component. */
  async init(): Promise<void> {
    let status: { connected: boolean };
    try {
      status = await firstValueFrom(
        this.http.get<{ connected: boolean }>('/api/status'),
      );
    } catch {
      status = { connected: false };
    }
    this.connected.set(status.connected);
    if (!status.connected) return;

    try {
      const me = await firstValueFrom(this.http.get<Profile>('/api/me'));
      this.profile.set(me);
      this.canPlay.set(me.product === 'premium');
      if (!this.canPlay()) {
        this.notice.set(
          'Your Spotify is not Premium — songs can’t stream, but you can browse your crates and read synced lyrics. ♪',
        );
      }
    } catch {
      /* leave profile null */
    }

    this.maybeInitPlayer();
    requestAnimationFrame(this.loop);
  }

  // ---- Web Playback SDK ----
  private maybeInitPlayer(): void {
    if (this.player || !this.sdkReady || !this.canPlay()) return;

    const player = new window.Spotify.Player({
      name: 'The Gramophone',
      volume: 0.7,
      getOAuthToken: (cb) =>
        firstValueFrom(this.http.get<{ accessToken: string }>('/api/token'))
          .then((d) => cb(d.accessToken))
          .catch(() => {}),
    });
    this.player = player;

    player.addListener('ready', (p: { device_id: string }) => {
      this.deviceId = p.device_id;
    });
    player.addListener('not_ready', () => (this.deviceId = null));
    player.addListener('player_state_changed', (s) => this.onPlayerState(s));
    player.addListener('account_error', () =>
      this.notice.set('Spotify Premium is required for in-browser playback.'),
    );
    player.addListener('authentication_error', () =>
      window.location.assign('/login'),
    );
    player.connect();
  }

  private onPlayerState(s: any): void {
    if (!s) return;
    const cur = s.track_window.current_track;
    this.playback.set({
      positionMs: s.position,
      durationMs: s.duration,
      paused: s.paused,
      updatedAt: performance.now(),
    });

    // A user selection is in flight: the SDK is still on the OLD track while we
    // load the new one. Ignore everything until the SDK reaches the pending
    // track (or playFrom clears it), so we don't clobber the pending load.
    if (this.pendingUri && cur?.uri !== this.pendingUri) return;

    // Genuine track change driven by the SDK itself (next/prev/auto-advance).
    if (cur && cur.uri !== this.currentUri()) {
      this.currentUri.set(cur.uri);
      const artist = cur.artists.map((a: any) => a.name).join(', ');
      this.nowPlaying.set({
        title: cur.name,
        artist,
        imageUrl: cur.album.images?.[0]?.url ?? null,
      });
      this.loadLyrics(
        artist.split(',')[0].trim(),
        cur.name,
        cur.album.name,
        cur.duration_ms,
      );
    }
  }

  // ---- search ----
  private searchSeq = 0;

  async search(q: string): Promise<void> {
    this.query.set(q);
    const term = q.trim();
    if (!term) {
      this.tracks.set([]);
      this.searched.set(false);
      return;
    }
    const seq = ++this.searchSeq;
    this.searching.set(true);
    try {
      const results = await firstValueFrom(
        this.http.get<Track[]>(`/api/search?q=${encodeURIComponent(term)}`),
      );
      if (seq !== this.searchSeq) return; // a newer search superseded this one
      this.tracks.set(results);
    } catch (e: any) {
      if (seq === this.searchSeq) {
        this.notice.set(`Search failed: ${e.error?.message ?? e.message ?? e}`);
        this.tracks.set([]);
      }
    } finally {
      if (seq === this.searchSeq) {
        this.searching.set(false);
        this.searched.set(true);
      }
    }
  }

  // ---- playback control ----
  async playFrom(index: number): Promise<void> {
    const list = this.tracks();
    const t = list[index];
    if (!t) return;

    // Claim this selection. A newer click bumps the seq and pendingUri,
    // superseding this one.
    const seq = ++this.selectionSeq;
    this.pendingUri = t.uri;
    this.currentUri.set(t.uri);
    this.nowPlaying.set({
      title: t.name,
      artist: t.artists,
      imageUrl: t.albumImageUrl,
    });

    const lyricsReady = this.loadLyrics(
      t.artists.split(',')[0].trim(),
      t.name,
      t.album,
      t.durationMs,
    );

    if (!this.canPlay()) {
      await lyricsReady;
      if (seq === this.selectionSeq) this.pendingUri = null;
      return; // preview mode: lyrics only, no audio
    }

    if (!this.deviceId) {
      this.notice.set('The turntable is still warming up — try again in a moment.');
      if (seq === this.selectionSeq) this.pendingUri = null;
      return;
    }

    // Unlock audio inside the click gesture, then hold playback until the
    // lyrics have finished loading so the song starts in sync with them.
    try {
      if (this.player?.activateElement) await this.player.activateElement();
    } catch {
      /* ignore */
    }

    await lyricsReady;
    if (seq !== this.selectionSeq) return; // a newer selection took over

    try {
      const uris = list.slice(index).map((x) => x.uri);
      await firstValueFrom(
        this.http.put('/api/play', { deviceId: this.deviceId, uris }),
      );
    } catch (e: any) {
      this.notice.set(`Couldn’t start playback: ${e.message ?? e}`);
    } finally {
      // Clear pending only if we're still the latest selection, so the SDK's
      // events for the now-playing track resume normal handling.
      if (seq === this.selectionSeq) this.pendingUri = null;
    }
  }

  togglePlay(): void {
    this.player?.togglePlay();
  }
  next(): void {
    this.player?.nextTrack();
  }
  prev(): void {
    this.player?.previousTrack();
  }
  seekRatio(ratio: number): void {
    const dur = this.playback().durationMs;
    if (this.player && dur) this.player.seek(Math.floor(ratio * dur));
  }
  setVolume(percent: number): void {
    this.player?.setVolume(percent / 100);
  }

  // ---- lyrics ----
  private async loadLyrics(
    artist: string,
    title: string,
    album: string,
    durationMs: number,
  ): Promise<void> {
    const token = ++this.lyricsToken;
    this.lyrics.set({ synced: [], plain: null, source: null });
    this.activeLine.set(-1);
    this.lyricsLoading.set(true);

    let data: Lyrics;
    try {
      const params = new URLSearchParams({
        artist,
        title,
        album: album || '',
        duration: String(durationMs || 0),
      });
      data = await firstValueFrom(
        this.http.get<Lyrics>(`/api/lyrics?${params.toString()}`),
      );
    } catch {
      data = { synced: [], plain: null, source: null };
    }
    if (token !== this.lyricsToken) return; // a newer track took over
    this.lyrics.set(data);
    this.lyricsLoading.set(false);
  }

  // ---- live clock ----
  /** Interpolated current playback position in ms (smooth, per-frame safe). */
  livePositionMs(): number {
    const { positionMs, durationMs, paused, updatedAt } = this.playback();
    if (paused) return positionMs;
    return Math.min(
      positionMs + (performance.now() - updatedAt),
      durationMs || Number.POSITIVE_INFINITY,
    );
  }

  private positionMs(): number {
    return this.livePositionMs();
  }

  private loop = (): void => {
    const pos = this.positionMs();

    // active synced lyric line
    const syn = this.lyrics().synced;
    if (syn.length) {
      let idx = -1;
      for (let i = 0; i < syn.length; i++) {
        if (syn[i].timeMs <= pos + 120) idx = i;
        else break;
      }
      if (idx !== this.activeLine()) this.activeLine.set(idx);
    }

    const now = performance.now();
    if (now - this.lastProg > 200) {
      this.lastProg = now;
      this.progressMs.set(pos);
    }
    if (now - this.lastVu > 110) {
      this.lastVu = now;
      const playing = this.isPlaying();
      const j = () => (playing ? -8 - Math.random() * 30 : -38);
      this.vu.set({ l: j(), r: j() });
    }

    requestAnimationFrame(this.loop);
  };
}
