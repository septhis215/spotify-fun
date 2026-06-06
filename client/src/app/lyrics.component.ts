import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
  viewChildren,
} from '@angular/core';
import { PlayerService } from './player.service';

@Component({
  selector: 'app-lyrics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="lyrics-stage">
      <div class="reel">
        <div class="reel-beam" aria-hidden="true"></div>
        <div class="lyrics-viewport" #viewport [class.scrollable]="isPlain()">
          <div class="lyrics-scroll" [class.plain]="isPlain()" [style.transform]="'translateY(' + translate() + 'px)'">
            @if (svc.lyrics().synced.length) {
              @for (l of svc.lyrics().synced; track $index; let i = $index) {
                <div class="lyric-line" #line [class.active]="i === svc.activeLine()" [class.past]="i < svc.activeLine()">
                  @for (w of words(l.text); track $index; let wi = $index) {
                    <span class="w" [style.--i]="wi">{{ w }}</span>
                  }
                </div>
              }
            } @else if (svc.lyrics().plain) {
              @for (line of plainLines(); track $index) {
                <div class="lyric-line static">{{ line || ' ' }}</div>
              }
            } @else if (svc.lyricsLoading()) {
              <div class="lyric-note pulse">Finding the words…</div>
            } @else if (svc.currentUri()) {
              <div class="lyric-note">No lyrics found for this record.</div>
            } @else {
              <div class="lyric-empty">Drop a record to read along…</div>
            }
          </div>
        </div>
        <div class="reel-source">{{ svc.lyrics().source ? 'lyrics · lrclib.net' : '' }}</div>
      </div>
    </section>
  `,
})
export class LyricsComponent {
  svc = inject(PlayerService);

  private lines = viewChildren<ElementRef<HTMLElement>>('line');
  private viewport = viewChild<ElementRef<HTMLElement>>('viewport');

  translate = signal(0);
  isPlain = computed(
    () => this.svc.lyrics().synced.length === 0 && !!this.svc.lyrics().plain,
  );
  plainLines = computed(() => this.svc.lyrics().plain?.split('\n') ?? []);

  words(text: string): string[] {
    const t = (text || '').trim();
    return t ? t.split(/\s+/) : ['♪'];
  }

  constructor() {
    // Reset scroll when a new song's lyrics load.
    effect(() => {
      this.svc.lyrics();
      this.translate.set(0);
    });

    // On every line change: re-grade depth across all lines and re-center.
    effect(() => {
      const active = this.svc.activeLine();
      const els = this.lines();
      if (this.isPlain() || !els.length) return;

      // Depth: each line's distance from the focus drives scale/opacity/blur.
      for (let i = 0; i < els.length; i++) {
        els[i].nativeElement.style.setProperty(
          '--d',
          String(Math.min(6, Math.abs(i - active))),
        );
      }
      if (active < 0) return;
      // Measure after the active styles (bigger size) have applied.
      requestAnimationFrame(() => this.center(active));
    });
  }

  private center(idx: number): void {
    const el = this.lines()[idx]?.nativeElement;
    const vp = this.viewport()?.nativeElement;
    if (!el || !vp) return;
    const vpr = vp.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    this.translate.update((t) => t + (vpr.top + vpr.height / 2 - (r.top + r.height / 2)));
  }
}
