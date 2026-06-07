import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { PlayerService } from './player.service';

@Component({
  selector: 'app-deck',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="deck">
      <div class="disc" [class.spinning]="svc.isPlaying()">
        <div class="disc-ring"></div>
        <div class="disc-art" [style.background-image]="artImage()"></div>
        <div class="disc-hole"></div>
      </div>

      <div class="eq" [class.live]="svc.isPlaying()">
        @for (b of bars; track $index) {
          <span class="eq-bar" [style.--i]="$index" [style.--h]="svc.vuBands()[$index]"></span>
        }
      </div>

      <div class="lcd">
        <div class="lcd-title">{{ svc.nowPlaying()?.title ?? 'NO SIGNAL' }}</div>
        <div class="lcd-artist">{{ svc.nowPlaying()?.artist ?? '— — —' }}</div>
      </div>

      <div class="seek">
        <span class="t">{{ fmt(svc.progressMs()) }}</span>
        <div class="seekbar" (click)="seek($event)">
          <div class="seekfill" [style.width.%]="fillPct()"></div>
        </div>
        <span class="t">{{ fmt(svc.playback().durationMs) }}</span>
      </div>

      <div class="transport">
        <button class="dbtn" title="Previous" (click)="svc.prev()">⏮</button>
        <button class="dbtn play" title="Play / Pause" (click)="svc.togglePlay()">
          {{ svc.playback().paused ? '▶' : '❚❚' }}
        </button>
        <button class="dbtn" title="Next" (click)="svc.next()">⏭</button>
      </div>

      <div class="volume">
        <span class="vol-ico">VOL</span>
        <input
          class="vol"
          type="range"
          min="0"
          max="100"
          [value]="vol()"
          [style.background]="volBg()"
          (input)="onVol($event)"
        />
      </div>
    </aside>
  `,
})
export class DeckComponent {
  svc = inject(PlayerService);
  vol = signal(70);
  bars = Array.from({ length: 18 });

  artImage = computed(() => {
    const url = this.svc.nowPlaying()?.imageUrl;
    return url ? `url("${url}")` : 'none';
  });

  fillPct = computed(() => {
    const dur = this.svc.playback().durationMs;
    return dur ? Math.min(100, (this.svc.progressMs() / dur) * 100) : 0;
  });

  volBg = computed(
    () =>
      `linear-gradient(90deg, var(--cyan) 0%, var(--cyan) ${this.vol()}%, #060b18 ${this.vol()}%)`,
  );

  fmt(ms: number): string {
    if (!ms || ms < 0) ms = 0;
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  seek(e: MouseEvent): void {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    this.svc.seekRatio(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  }

  onVol(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    this.vol.set(v);
    this.svc.setVolume(v);
  }
}
