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

interface LyricTab {
  id: number;
  text: string;
  lineIndex: number;
  x: number; // left %
  y: number; // top %
  w: number; // width px
}

@Component({
  selector: 'app-lyrics',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.fs]': 'fullscreen()',
    '[class.fs-out]': 'fsClosing()',
  },
  template: `
    <section class="lyrics-stage">
      <div class="reel">
        @if (!tabMode()) {
          <div class="reel-beam" aria-hidden="true"></div>
        }

        <div class="reel-actions">
          <button class="reel-btn" (click)="toggleTabMode()"
            [title]="tabMode() ? 'Switch to karaoke view' : 'Switch to tab view'">
            {{ tabMode() ? '≡' : '⊞' }}
          </button>
          <button class="reel-btn" (click)="toggleFullscreen()"
            [title]="fullscreen() ? 'Exit fullscreen' : 'Fullscreen'">
            {{ fullscreen() ? '[×]' : '[+]' }}
          </button>
        </div>

        @if (tabMode()) {
          <div class="tab-view">
            <div class="tab-toolbar">
              <span class="tab-count">
                {{ tabs().length ? tabs().length + ' LINES' : 'WAITING FOR PLAYBACK…' }}
              </span>
              @if (tabs().length) {
                <button class="tab-clear-btn" (click)="clearTabs()">CLEAR ALL</button>
              }
            </div>
            <div class="tab-grid">
              @for (tab of tabs(); track tab.id) {
                <div class="lyric-tab"
                  [class.active]="tab.lineIndex === svc.activeLine()"
                  [style.left.%]="tab.x"
                  [style.top.%]="tab.y"
                  [style.width.px]="tab.w"
                  [style.z-index]="tab.lineIndex === svc.activeLine() ? 9999 : tab.id + 1">
                  <button class="tab-x" (click)="closeTab(tab.id)" title="Close">×</button>
                  <div class="tab-text">{{ tab.text }}</div>
                </div>
              }
            </div>
          </div>
        } @else {
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
        }

        <div class="reel-source">{{ svc.lyrics().source ? 'lyrics · lrclib.net' : '' }}</div>
      </div>
    </section>
  `,
})
export class LyricsComponent {
  svc = inject(PlayerService);

  fullscreen = signal(false);
  fsClosing = signal(false);
  tabMode = signal(false);
  tabs = signal<LyricTab[]>([]);

  private lines = viewChildren<ElementRef<HTMLElement>>('line');
  private viewport = viewChild<ElementRef<HTMLElement>>('viewport');

  translate = signal(0);
  isPlain = computed(
    () => this.svc.lyrics().synced.length === 0 && !!this.svc.lyrics().plain,
  );
  plainLines = computed(() => this.svc.lyrics().plain?.split('\n') ?? []);

  private tabIdCounter = 0;
  private lastTabLineIndex = -1;

  words(text: string): string[] {
    const t = (text || '').trim();
    return t ? t.split(/\s+/) : ['♪'];
  }

  toggleFullscreen(): void {
    if (this.fullscreen()) {
      this.fsClosing.set(true);
      setTimeout(() => {
        this.fullscreen.set(false);
        this.fsClosing.set(false);
      }, 280);
    } else {
      this.fullscreen.set(true);
    }
  }

  toggleTabMode(): void {
    if (!this.tabMode()) {
      // Start fresh from the current line when enabling
      this.tabs.set([]);
      this.lastTabLineIndex = this.svc.activeLine() - 1;
    }
    this.tabMode.update(v => !v);
  }

  closeTab(id: number): void {
    this.tabs.update(tabs => tabs.filter(t => t.id !== id));
  }

  clearTabs(): void {
    this.tabs.set([]);
  }

  constructor() {
    // Reset karaoke scroll and tab state when a new song's lyrics load.
    effect(() => {
      this.svc.lyrics();
      this.translate.set(0);
      this.tabs.set([]);
      this.lastTabLineIndex = -1;
    });

    // Push a new tab card each time the active line advances (tab mode only).
    effect(() => {
      const active = this.svc.activeLine();
      const synced = this.svc.lyrics().synced;
      if (!this.tabMode() || active < 0 || active <= this.lastTabLineIndex) return;
      const line = synced[active];
      // Advance the pointer even for empty/instrumental lines so we don't
      // retroactively flood the grid if tab mode is toggled mid-song.
      this.lastTabLineIndex = active;
      if (!line?.text?.trim()) return;
      const w = 115 + Math.floor(Math.random() * 60);  // 115–175 px wide
      const x = 3 + Math.random() * 60;               // 3–63 % from left
      const y = 3 + Math.random() * 58;               // 3–61 % from top
      this.tabs.update(tabs => [
        ...tabs,
        { id: this.tabIdCounter++, text: line.text.trim(), lineIndex: active, x, y, w },
      ]);
    });

    // Karaoke depth grading + centering effect.
    effect(() => {
      const active = this.svc.activeLine();
      const els = this.lines();
      if (this.isPlain() || !els.length) return;

      for (let i = 0; i < els.length; i++) {
        els[i].nativeElement.style.setProperty(
          '--d',
          String(Math.min(6, Math.abs(i - active))),
        );
      }
      if (active < 0) return;
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
