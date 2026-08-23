import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MonthKey, monthLabel, shiftMonth } from '../../../core/domain/dates';

/** Month-by-month navigation, mirroring the one-tab-per-month spreadsheet. */
@Component({
  selector: 'app-month-switcher',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="switcher">
      <button type="button" class="switcher__arrow" (click)="step(-1)" aria-label="Previous month">
        ‹
      </button>

      <div class="switcher__current">
        <span class="switcher__label">{{ label() }}</span>
        <select
          class="switcher__select"
          aria-label="Jump to month"
          [value]="month()"
          (change)="onSelect($event)">
          @for (option of options(); track option.value) {
            <option [value]="option.value">{{ option.label }}</option>
          }
        </select>
      </div>

      <button type="button" class="switcher__arrow" (click)="step(1)" aria-label="Next month">›</button>
    </div>
  `,
  styles: `
    .switcher {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
      margin: var(--space-5) 0 var(--space-3);
    }

    .switcher__arrow {
      width: 36px;
      height: 36px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--text-muted);
      font-size: 20px;
      line-height: 1;
    }

    .switcher__current {
      position: relative;
      flex: 1;
      text-align: center;
    }

    .switcher__label {
      font-size: 16px;
      font-weight: 650;
      letter-spacing: -0.01em;
    }

    .switcher__select {
      position: absolute;
      inset: 0;
      width: 100%;
      opacity: 0;
      border: none;
      background: none;
      cursor: pointer;
    }
  `,
})
export class MonthSwitcher {
  readonly month = input.required<MonthKey>();
  readonly months = input.required<readonly MonthKey[]>();
  readonly monthChange = output<MonthKey>();

  protected readonly label = computed(() => monthLabel(this.month()));

  /** Months with activity, plus the selected one even when it is empty. */
  protected readonly options = computed(() => {
    const all = new Set<MonthKey>([...this.months(), this.month()]);
    return [...all]
      .sort()
      .reverse()
      .map((value) => ({ value, label: monthLabel(value) }));
  });

  protected step(delta: number): void {
    this.monthChange.emit(shiftMonth(this.month(), delta));
  }

  protected onSelect(event: Event): void {
    this.monthChange.emit((event.target as HTMLSelectElement).value);
  }
}
