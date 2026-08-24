import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { MoneyFormatter } from '../../../core/format/money-formatter';
import { LedgerStore } from '../../../core/state/ledger-store';

/** The headline: who owes whom right now, across every month. */
@Component({
  selector: 'app-balance-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="hero"
      [class.hero--positive]="balance() > 0"
      [class.hero--negative]="balance() < 0">
      <span class="hero__glow hero__glow--a" aria-hidden="true"></span>
      <span class="hero__glow hero__glow--b" aria-hidden="true"></span>

      <p class="hero__label">{{ headline() }}</p>
      <p class="hero__amount numeric">{{ money.absolute(balance()) }}</p>
      <p class="hero__meta">{{ subtitle() }}</p>
      @if (balance() !== 0) {
        <button type="button" class="btn btn--primary hero__action" (click)="settleUp.emit()">
          Settle up
        </button>
      }
    </section>
  `,
  styles: `
    .hero {
      position: relative;
      isolation: isolate;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: var(--space-6) var(--space-5);
      border-radius: var(--radius-lg);
      background: var(--surface);
      border: 1px solid var(--border);
      box-shadow: var(--shadow-md);
      text-align: center;
    }

    .hero__glow {
      position: absolute;
      z-index: -1;
      width: 240px;
      height: 240px;
      border-radius: 50%;
      filter: blur(60px);
      opacity: 0.28;
      pointer-events: none;
    }

    .hero__glow--a {
      top: -110px;
      left: -70px;
      background: var(--accent);
    }

    .hero__glow--b {
      bottom: -120px;
      right: -80px;
      background: var(--accent-2);
    }

    .hero__label {
      font-size: 14px;
      font-weight: 650;
      color: var(--text-muted);
    }

    .hero__amount {
      font-size: clamp(40px, 12vw, 56px);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.1;
    }

    .hero--positive .hero__amount {
      color: var(--positive);
    }

    .hero--negative .hero__amount {
      color: var(--negative);
    }

    .hero__meta {
      font-size: 13px;
      color: var(--text-faint);
    }

    .hero__action {
      margin-top: var(--space-4);
    }
  `,
})
export class BalanceSummary {
  readonly settleUp = output<void>();

  private readonly store = inject(LedgerStore);
  protected readonly money = inject(MoneyFormatter);

  protected readonly balance = this.store.balanceCents;

  protected readonly headline = computed(() => {
    const balance = this.balance();
    const { partnerName } = this.store.settings();
    if (balance === 0) {
      return this.store.transactions().length ? 'All square' : 'Nothing tracked yet';
    }
    return balance > 0 ? `${partnerName} owes you` : `You owe ${partnerName}`;
  });

  protected readonly subtitle = computed(() => {
    const count = this.store.transactions().length;
    if (!count) {
      return 'Add your first purchase to get started';
    }
    const months = this.store.months().length;
    return `${count} ${count === 1 ? 'transaction' : 'transactions'} over ${months} ${months === 1 ? 'month' : 'months'}`;
  });
}
