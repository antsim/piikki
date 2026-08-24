import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { todayIso } from '../../core/domain/dates';
import { balanceDeltaCents, signedSharePercent } from '../../core/domain/ledger';
import { centsToInputValue, parseAmountToCents } from '../../core/domain/money';
import { OPENING_BALANCE_CATEGORY_ID, SplitCategory } from '../../core/domain/split-category.model';
import { Payer, Transaction, TransactionDraft } from '../../core/domain/transaction.model';
import { MoneyFormatter } from '../../core/format/money-formatter';
import { LedgerStore } from '../../core/state/ledger-store';
import { ToastStore } from '../../core/state/toast-store';

/** What the ledger page asks the dialog to open with. */
export interface TransactionFormRequest {
  /** Present when editing an existing row. */
  readonly transaction?: Transaction;
  /** Field values to start from when adding (used by "settle up"). */
  readonly prefill?: Partial<TransactionDraft>;
  readonly title?: string;
}

@Component({
  selector: 'app-transaction-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './transaction-form.html',
  styleUrl: './transaction-form.scss',
})
export class TransactionForm {
  readonly request = input.required<TransactionFormRequest>();
  readonly closed = output<void>();

  private readonly store = inject(LedgerStore);
  private readonly toasts = inject(ToastStore);
  protected readonly money = inject(MoneyFormatter);

  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  /**
   * The opening-balance chip disappears once it's been used — there should
   * only ever be one such entry — except while editing that exact
   * transaction, where it needs to stay selected.
   */
  protected readonly categories = computed(() => {
    const all = this.store.selectableCategories();
    const editingId = this.request().transaction?.categoryId;
    if (!this.store.hasOpeningBalance() || editingId === OPENING_BALANCE_CATEGORY_ID) {
      return all;
    }
    return all.filter((category) => category.id !== OPENING_BALANCE_CATEGORY_ID);
  });
  protected readonly settings = this.store.settings;
  protected readonly knownDescriptions = this.store.knownDescriptions;
  protected readonly saving = signal(false);

  protected readonly amountText = signal('');
  protected readonly description = signal('');
  protected readonly date = signal(todayIso());
  protected readonly categoryId = signal('');
  protected readonly payer = signal<Payer>('me');

  protected readonly editing = computed(() => this.request().transaction !== undefined);
  protected readonly isSettlement = computed(() => this.category()?.kind === 'settlement');
  protected readonly isOpeningBalance = computed(
    () => this.category()?.id === OPENING_BALANCE_CATEGORY_ID,
  );
  protected readonly amountCents = computed(() => parseAmountToCents(this.amountText()) ?? 0);
  protected readonly valid = computed(() => this.amountCents() > 0 && !!this.category());

  protected readonly category = computed<SplitCategory | undefined>(() =>
    this.categories().find((item) => item.id === this.categoryId()),
  );

  /** How this entry would move the balance, recalculated as the form is filled. */
  protected readonly deltaCents = computed(() => {
    const category = this.category();
    if (!category) {
      return 0;
    }
    return balanceDeltaCents({
      amountCents: this.amountCents(),
      payer: this.payer(),
      split: { kind: category.kind, myShare: category.myShare },
    });
  });

  protected readonly percent = computed(() => {
    const category = this.category();
    return category
      ? signedSharePercent({
          payer: this.payer(),
          split: { kind: category.kind, myShare: category.myShare },
        })
      : 0;
  });

  /** Balance after saving, so the number in the hero card is never a surprise. */
  protected readonly resultingBalanceCents = computed(() => {
    const existing = this.request().transaction;
    const withoutThisOne = existing
      ? this.store.balanceCents() - balanceDeltaCents(existing)
      : this.store.balanceCents();
    return withoutThisOne + this.deltaCents();
  });

  constructor() {
    afterNextRender(() => {
      this.reset(this.request());
      this.dialog().nativeElement.showModal();
    });
  }

  protected close(): void {
    this.dialog().nativeElement.close();
  }

  protected onDialogClose(): void {
    this.closed.emit();
  }

  protected async save(): Promise<void> {
    const category = this.category();
    if (!this.valid() || !category || this.saving()) {
      return;
    }
    this.saving.set(true);

    const draft: TransactionDraft = {
      date: this.date(),
      description: this.description().trim() || category.label,
      amountCents: this.amountCents(),
      payer: this.payer(),
      categoryId: category.id,
      split: { kind: category.kind, myShare: category.myShare },
    };

    const existing = this.request().transaction;
    if (existing) {
      await this.store.updateTransaction(existing.id, draft);
    } else {
      await this.store.addTransaction(draft);
      this.store.showMonth(draft.date.slice(0, 7));
    }
    this.saving.set(false);
    this.close();
  }

  protected async remove(): Promise<void> {
    const existing = this.request().transaction;
    if (!existing) {
      return;
    }
    await this.store.deleteTransaction(existing.id);
    this.toasts.show(`Deleted "${existing.description}"`, {
      label: 'Undo',
      run: () => void this.store.restoreTransaction(existing),
    });
    this.close();
  }

  /** Clicking the dark area outside the sheet closes it, like a native sheet. */
  protected onBackdropClick(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) {
      this.close();
    }
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    void this.save();
  }

  protected readValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  private reset(request: TransactionFormRequest): void {
    const source = request.transaction ?? request.prefill;
    const fallbackCategory =
      this.categories().find((item) => item.id === this.settings().defaultCategoryId) ??
      this.categories()[0];

    this.amountText.set(source?.amountCents ? centsToInputValue(source.amountCents) : '');
    this.description.set(source?.description ?? '');
    this.date.set(source?.date ?? todayIso());
    this.categoryId.set(source?.categoryId ?? fallbackCategory?.id ?? '');
    this.payer.set(source?.payer ?? 'me');
  }
}
