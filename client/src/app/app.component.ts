import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { PlayerService } from './player.service';
import { SearchComponent } from './search.component';
import { DeckComponent } from './deck.component';
import { LyricsComponent } from './lyrics.component';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SearchComponent, DeckComponent, LyricsComponent],
  template: `
    <div class="grain" aria-hidden="true"></div>
    <div class="vignette" aria-hidden="true"></div>

    @if (svc.connected() === false) {
      <div class="gate">
        <div class="gate-card">
          <div class="gate-emblem">▮▮▮</div>
          <h1>SOUNDWAVE</h1>
          <p>Tune in to your Spotify library.</p>
          <a class="brass-btn" href="/login">▶ Connect Spotify</a>
        </div>
      </div>
    }

    @if (svc.notice(); as note) {
      <div class="notice">{{ note }}</div>
    }

    @if (svc.connected()) {
      <div class="app">
        <header class="topbar">
          <div class="brand"><span class="brand-mark">▮▮▮</span> SOUNDWAVE</div>
          <div class="who">
            @if (svc.profile()?.imageUrl; as img) {
              <img class="avatar" [src]="img" alt="" />
            }
            <span>{{ svc.profile()?.displayName }}</span>
            <a class="brass-btn small" href="/logout">Eject</a>
          </div>
        </header>

        <main class="stage">
          <app-search />
          <app-lyrics />
          <app-deck />
        </main>
      </div>
    }
  `,
})
export class AppComponent implements OnInit {
  svc = inject(PlayerService);

  ngOnInit(): void {
    this.svc.init();
  }
}
