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
      <div class="turntable">
        <div class="platter">
          <div class="vinyl" [class.spinning]="svc.isPlaying()">
            <div class="vinyl-sheen"></div>
            <div
              class="label"
              [style.background-image]="labelImage()"
            >
              <div class="label-hole"></div>
            </div>
          </div>
        </div>
        <div class="tonearm" [class.down]="svc.isPlaying()">
          <div class="tonearm-base"></div>
          <div class="tonearm-arm"><div class="tonearm-head"></div></div>
        </div>
      </div>

      <div class="vu">
        <div class="vu-meter">
          <div class="needle" [style.transform]="'rotate(' + svc.vu().l + 'deg)'"></div>
          <span>L</span>
        </div>
        <div class="vu-meter">
          <div class="needle" [style.transform]="'rotate(' + svc.vu().r + 'deg)'"></div>
          <span>R</span>
        </div>
      </div>

      <div class="nowplaying">
        <div class="np-title">{{ svc.nowPlaying()?.title ?? 'Nothing on the deck' }}</div>
        <div class="np-artist">{{ svc.nowPlaying()?.artist ?? '—' }}</div>
      </div>

      <div class="seek">
        <span class="t">{{ fmt(svc.progressMs()) }}</span>
        <div class="seekbar" (click)="seek($event)">
          <div class="seekfill" [style.width.%]="fillPct()"></div>
        </div>
        <span class="t">{{ fmt(svc.playback().durationMs) }}</span>
      </div>

      <div class="transport">
        <button class="brass-knob" title="Previous" (click)="svc.prev()">⏮</button>
        <button class="brass-knob big" title="Play / Pause" (click)="svc.togglePlay()">
          {{ svc.playback().paused ? '⏵' : '⏸' }}
        </button>
        <button class="brass-knob" title="Next" (click)="svc.next()">⏭</button>
      </div>

      <div class="volume">
        <span class="vol-ico">🔈</span>
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

  labelImage = computed(() => {
    const url = this.svc.nowPlaying()?.imageUrl;
    return url ? `url("${url}")` : 'none';
  });

  fillPct = computed(() => {
    const dur = this.svc.playback().durationMs;
    return dur ? Math.min(100, (this.svc.progressMs() / dur) * 100) : 0;
  });

  volBg = computed(
    () =>
      `linear-gradient(90deg, var(--brass) 0%, var(--brass) ${this.vol()}%, #2c1d10 ${this.vol()}%)`,
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
