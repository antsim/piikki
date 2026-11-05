import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The animated "Loading…" placeholder shown while the ledger data is on its
 * way. Its styles are global and inline in index.html (not here) because the
 * very same markup doubles as the boot splash that is visible before Angular
 * — and therefore this component's styles — has loaded.
 */
@Component({
  selector: 'app-loading-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="loading-screen loading-screen--inline" role="status" aria-live="polite">
      <span class="loading-screen__brand">piikki</span>
      <span class="loading-screen__dots" aria-hidden="true"><span></span><span></span><span></span></span>
      <span class="loading-screen__label">Loading your ledger…</span>
    </div>
  `,
})
export class LoadingScreen {}
