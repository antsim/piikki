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
import { BalanceInput, balanceDeltaCents, signedSharePercent } from '../../core/domain/ledger';
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
  protected readonly personalMineText = signal('');
  protected readonly personalPartnerText = signal('');
  /** Collapsed until asked for, so the common all-shared receipt stays a short form. */
  protected readonly personalOpen = signal(false);

  protected readonly editing = computed(() => this.request().transaction !== undefined);
  protected readonly isSettlement = computed(() => this.category()?.kind === 'settlement');
  protected readonly isOpeningBalance = computed(
    () => this.category()?.id === OPENING_BALANCE_CATEGORY_ID,
  );
  protected readonly amountCents = computed(() => parseAmountToCents(this.amountText()) ?? 0);

  /** Splitting part of a receipt off only makes sense for a shared cost. */
  protected readonly supportsPersonal = computed(() => this.category()?.kind === 'expense');

  protected readonly personalMineCents = computed(() => positiveCents(this.personalMineText()));
  protected readonly personalPartnerCents = computed(() =>
    positiveCents(this.personalPartnerText()),
  );
  protected readonly personalTotalCents = computed(
    () => this.personalMineCents() + this.personalPartnerCents(),
  );
  protected readonly hasPersonal = computed(
    () => this.supportsPersonal() && this.personalTotalCents() > 0,
  );
  protected readonly sharedCents = computed(() =>
    Math.max(0, this.amountCents() - (this.hasPersonal() ? this.personalTotalCents() : 0)),
  );
  /** Blocks the save rather than silently clamping something the user can still see and fix. */
  protected readonly personalExceedsAmount = computed(
    () => this.hasPersonal() && this.personalTotalCents() > this.amountCents(),
  );

  /** What gets saved, and what the live preview below does its arithmetic on. */
  private readonly personalDraft = computed(() =>
    this.hasPersonal()
      ? { mineCents: this.personalMineCents(), partnerCents: this.personalPartnerCents() }
      : undefined,
  );

  protected readonly valid = computed(
    () => this.amountCents() > 0 && !!this.category() && !this.personalExceedsAmount(),
  );

  protected readonly category = computed<SplitCategory | undefined>(() =>
    this.categories().find((item) => item.id === this.categoryId()),
  );

  /** How this entry would move the balance, recalculated as the form is filled. */
  protected readonly deltaCents = computed(() => {
    const category = this.category();
    if (!category) {
      return 0;
    }
    return balanceDeltaCents(this.balanceInput(category));
  });

  protected readonly percent = computed(() => {
    const category = this.category();
    return category ? signedSharePercent(this.balanceInput(category)) : 0;
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

  /** The half-filled form, in the shape the accounting rule takes. */
  private balanceInput(category: SplitCategory): BalanceInput {
    return {
      amountCents: this.amountCents(),
      payer: this.payer(),
      split: { kind: category.kind, myShare: category.myShare },
      personal: this.personalDraft(),
    };
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
      personal: this.personalDraft(),
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

    const personal = source?.personal;
    this.personalMineText.set(personal?.mineCents ? centsToInputValue(personal.mineCents) : '');
    this.personalPartnerText.set(
      personal?.partnerCents ? centsToInputValue(personal.partnerCents) : '',
    );
    // Reopening a receipt that has personal items should show them, not hide
    // them behind a disclosure the user has to remember to open.
    this.personalOpen.set(!!personal);
  }
}

/** Blank, unparseable and negative input all mean "nothing personal here". */
function positiveCents(text: string): number {
  return Math.max(0, parseAmountToCents(text) ?? 0);
}
