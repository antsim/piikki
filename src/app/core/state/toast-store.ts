import { Injectable, signal } from '@angular/core';

export interface Toast {
  readonly id: number;
  readonly message: string;
  readonly action?: { readonly label: string; readonly run: () => void };
}

const VISIBLE_MS = 6000;

/** Minimal snackbar queue — used mainly to offer "undo" after a delete. */
@Injectable({ providedIn: 'root' })
export class ToastStore {
  private nextId = 1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly currentSignal = signal<Toast | null>(null);

  readonly current = this.currentSignal.asReadonly();

  show(message: string, action?: Toast['action']): void {
    this.clearTimer();
    this.currentSignal.set({ id: this.nextId++, message, action });
    this.timer = setTimeout(() => this.dismiss(), VISIBLE_MS);
  }

  dismiss(): void {
    this.clearTimer();
    this.currentSignal.set(null);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
