import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { AppConfigStore } from './core/config/app-config.store';
import { LedgerStore } from './core/state/ledger-store';
import { ToastHost } from './shared/ui/toast-host';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, ToastHost],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly store = inject(LedgerStore);
  protected readonly appConfig = inject(AppConfigStore);
}
