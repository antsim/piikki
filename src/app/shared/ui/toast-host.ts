import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastStore } from '../../core/state/toast-store';

@Component({
  selector: 'app-toast-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (toasts.current(); as toast) {
      <div class="toast" role="status">
        <span class="toast__message">{{ toast.message }}</span>
        @if (toast.action; as action) {
          <button type="button" class="toast__action" (click)="run(action.run)">
            {{ action.label }}
          </button>
        }
      </div>
    }
  `,
  styles: `
    :host {
      position: fixed;
      inset: auto 0 calc(16px + env(safe-area-inset-bottom)) 0;
      display: flex;
      justify-content: center;
      pointer-events: none;
      z-index: 60;
    }

    .toast {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      max-width: min(560px, calc(100vw - 32px));
      padding: 12px 12px 12px 18px;
      border-radius: 999px;
      background: var(--text);
      color: var(--bg);
      box-shadow: var(--shadow-lg);
      pointer-events: auto;
      animation: toast-in 160ms ease-out;
    }

    .toast__message {
      font-size: 14px;
    }

    .toast__action {
      border: none;
      border-radius: 999px;
      background: color-mix(in srgb, var(--bg) 18%, transparent);
      color: inherit;
      padding: 6px 14px;
      font-size: 14px;
      font-weight: 650;
    }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }
  `,
})
export class ToastHost {
  protected readonly toasts = inject(ToastStore);

  protected run(action: () => void): void {
    action();
    this.toasts.dismiss();
  }
}
