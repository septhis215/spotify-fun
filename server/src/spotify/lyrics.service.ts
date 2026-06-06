import { Injectable, Logger } from '@nestjs/common';

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface LyricsResult {
  /** Time-synced lines (empty if only plain lyrics or none found). */
  synced: LyricLine[];
  /** Plain unsynced lyrics, or null. */
  plain: string | null;
  source: 'lrclib' | null;
}

const LRCLIB_BASE = 'https://lrclib.net/api';
const USER_AGENT = 'spotify-fun (vintage player demo)';
const REQUEST_TIMEOUT_MS = 9000;
const CACHE_MAX = 300;

/**
 * Spotify has no public lyrics API, so we use lrclib.net — a free, key-less
 * community database of time-synced (LRC) lyrics. Proxied here to avoid CORS.
 *
 * lrclib can be slow (several seconds), so we (a) fire the exact `get` and the
 * fuzzy `search` in parallel and keep whichever yields synced lyrics first,
 * (b) cache results in memory, and (c) time each request out.
 */
@Injectable()
export class LyricsService {
  private readonly logger = new Logger(LyricsService.name);
  private readonly cache = new Map<string, LyricsResult>();

  async getLyrics(
    artist: string,
    title: string,
    album: string,
    durationMs: number,
  ): Promise<LyricsResult> {
    const durationSec = Math.round(durationMs / 1000);
    const key = `${artist}|${title}|${durationSec}`.toLowerCase();

    const cached = this.cache.get(key);
    if (cached) return cached;

    // Run the exact-signature lookup and the fuzzy search concurrently.
    const [exact, searched] = await Promise.all([
      this.tryGet(artist, title, album, durationSec),
      this.trySearch(artist, title),
    ]);

    const result = this.pickBest(exact, searched);
    if (result.source) this.cacheSet(key, result); // don't cache empty misses
    return result;
  }

  /** Prefer a result with synced lyrics, then any plain, else empty. */
  private pickBest(
    ...candidates: (LyricsResult | null)[]
  ): LyricsResult {
    const synced = candidates.find((r) => r && r.synced.length);
    if (synced) return synced;
    const plain = candidates.find((r) => r && r.plain);
    if (plain) return plain;
    return { synced: [], plain: null, source: null };
  }

  private cacheSet(key: string, value: LyricsResult): void {
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, value);
  }

  private async tryGet(
    artist: string,
    title: string,
    album: string,
    durationSec: number,
  ): Promise<LyricsResult | null> {
    const params = new URLSearchParams({
      artist_name: artist,
      track_name: title,
      album_name: album,
      duration: String(durationSec),
    });
    return this.fetchAndParse(`${LRCLIB_BASE}/get?${params.toString()}`);
  }

  private async trySearch(
    artist: string,
    title: string,
  ): Promise<LyricsResult | null> {
    const params = new URLSearchParams({
      track_name: title,
      artist_name: artist,
    });
    const list = await this.fetchJson<RawLyrics[]>(
      `${LRCLIB_BASE}/search?${params.toString()}`,
    );
    if (!Array.isArray(list)) return null;
    const best =
      list.find((r) => r.syncedLyrics) ?? list.find((r) => r.plainLyrics);
    return best ? this.toResult(best) : null;
  }

  private async fetchAndParse(url: string): Promise<LyricsResult | null> {
    const raw = await this.fetchJson<RawLyrics>(url);
    return raw ? this.toResult(raw) : null;
  }

  private async fetchJson<T>(url: string): Promise<T | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      if (!res.ok) return null; // 404 = not found in db
      return (await res.json()) as T;
    } catch (err) {
      this.logger.warn(`Lyrics request failed (${url}): ${String(err)}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private toResult(raw: RawLyrics): LyricsResult {
    return {
      synced: raw.syncedLyrics ? this.parseLrc(raw.syncedLyrics) : [],
      plain: raw.plainLyrics ?? null,
      source: 'lrclib',
    };
  }

  /** Parse LRC text ("[mm:ss.xx] line") into sorted, timed lines. */
  private parseLrc(lrc: string): LyricLine[] {
    const lines: LyricLine[] = [];
    const tagRe = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

    for (const rawLine of lrc.split('\n')) {
      const text = rawLine.replace(tagRe, '').trim();
      tagRe.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = tagRe.exec(rawLine)) !== null) {
        const min = parseInt(match[1], 10);
        const sec = parseInt(match[2], 10);
        const frac = match[3] ? parseInt(match[3].padEnd(3, '0'), 10) : 0;
        const timeMs = min * 60_000 + sec * 1000 + frac;
        lines.push({ timeMs, text });
      }
    }

    return lines.sort((a, b) => a.timeMs - b.timeMs);
  }
}

interface RawLyrics {
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
}
