// Minimal typings for the Spotify Web Playback SDK global.
interface SpotifyPlayer {
  connect(): Promise<boolean>;
  disconnect(): void;
  addListener(event: string, cb: (payload: any) => void): boolean;
  togglePlay(): Promise<void>;
  nextTrack(): Promise<void>;
  previousTrack(): Promise<void>;
  seek(ms: number): Promise<void>;
  setVolume(v: number): Promise<void>;
  activateElement?(): Promise<void>;
}

interface SpotifyNamespace {
  Player: new (opts: {
    name: string;
    volume?: number;
    getOAuthToken: (cb: (token: string) => void) => void;
  }) => SpotifyPlayer;
}

interface Window {
  Spotify: SpotifyNamespace;
  onSpotifyWebPlaybackSDKReady: () => void;
}
