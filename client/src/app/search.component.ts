import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PlayerService } from './player.service';

@Component({
  selector: 'app-search',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <aside class="crate">
      <div class="crate-head">
        <h2>The Catalogue</h2>
        <div class="search-box">
          <span class="search-ico">⌕</span>
          <input
            #box
            class="search-input"
            type="text"
            placeholder="Search for a record…"
            [value]="svc.query()"
            (input)="onInput(box.value)"
            (keydown.enter)="onEnter(box.value)"
            autocomplete="off"
            spellcheck="false"
          />
        </div>
      </div>

      <div class="crate-list">
        @if (svc.searching()) {
          <div class="lyric-note pad">Cranking through the catalogue…</div>
        } @else if (svc.tracks().length) {
          @for (t of svc.tracks(); track t.uri; let i = $index) {
            <button
              class="crate-item track"
              [class.playing]="t.uri === svc.currentUri()"
              (click)="svc.playFrom(i)"
            >
              <span class="idx">{{ i + 1 }}</span>
              @if (t.albumImageUrl) {
                <img [src]="t.albumImageUrl" alt="" />
              } @else {
                <span class="thumb">♪</span>
              }
              <span class="meta">
                <span class="nm">{{ t.name }}</span>
                <span class="sub">{{ t.artists }}</span>
              </span>
            </button>
          }
        } @else if (svc.searched()) {
          <div class="lyric-note pad">No records found under that name.</div>
        } @else {
          <div class="lyric-note pad">
            Search Spotify's catalogue, then drop a record on the turntable to
            read along.
          </div>
        }
      </div>
    </aside>
  `,
})
export class SearchComponent {
  svc = inject(PlayerService);
  private timer: ReturnType<typeof setTimeout> | null = null;

  onInput(value: string): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.svc.search(value), 350);
  }

  onEnter(value: string): void {
    if (this.timer) clearTimeout(this.timer);
    this.svc.search(value);
  }
}
