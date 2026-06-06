export interface Profile {
  displayName: string;
  imageUrl: string | null;
  product: string;
}

export interface Playlist {
  id: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  trackCount: number;
  owner: string;
  url: string;
}

export interface Track {
  id: string;
  uri: string;
  name: string;
  artists: string;
  album: string;
  albumImageUrl: string | null;
  durationMs: number;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface Lyrics {
  synced: LyricLine[];
  plain: string | null;
  source: 'lrclib' | null;
}

export interface NowPlaying {
  title: string;
  artist: string;
  imageUrl: string | null;
}

export interface Playback {
  positionMs: number;
  durationMs: number;
  paused: boolean;
  /** performance.now() when positionMs was captured, for live interpolation. */
  updatedAt: number;
}
