import { Injectable, signal } from '@angular/core';

/**
 * The browser's own `navigator.onLine` / `online` / `offline` signal,
 * exposed as a store so components can show "you're offline" without each
 * one wiring up its own event listener. Purely presentational — the actual
 * offline-write handling lives in OfflineQueueLedgerStorage, which detects
 * failed writes directly rather than trusting this ahead of time (see its
 * isOfflineError doc comment for why `navigator.onLine` alone isn't enough
 * to rely on there).
 */
@Injectable({ providedIn: 'root' })
export class ConnectivityStore {
  private readonly onlineSignal = signal(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  readonly online = this.onlineSignal.asReadonly();

  constructor() {
    if (typeof window === 'undefined') {
      return;
    }
    window.addEventListener('online', () => this.onlineSignal.set(true));
    window.addEventListener('offline', () => this.onlineSignal.set(false));
  }
}
