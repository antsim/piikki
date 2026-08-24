import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { AuthStore } from '../../core/auth/auth.store';

/**
 * The only door into cloud mode. There is deliberately no sign-up here — the
 * two accounts are created ahead of time in the Supabase dashboard (see
 * README) — so this is just an email/password form and an error message.
 */
@Component({
  selector: 'app-login-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="login">
      <form class="login__card card" (submit)="submit($event)">
        <p class="login__brand">piikki</p>
        <h1 class="login__title">Sign in</h1>

        <div class="field">
          <label class="field-label" for="email">Email</label>
          <input
            id="email"
            class="text-input"
            type="email"
            autocomplete="username"
            required
            [value]="email()"
            (input)="email.set(readValue($event))" />
        </div>

        <div class="field">
          <label class="field-label" for="password">Password</label>
          <input
            id="password"
            class="text-input"
            type="password"
            autocomplete="current-password"
            required
            [value]="password()"
            (input)="password.set(readValue($event))" />
        </div>

        @if (auth.error(); as error) {
          <p class="login__error">{{ error }}</p>
        }

        <button type="submit" class="btn btn--primary login__submit" [disabled]="!canSubmit()">
          {{ submitting() ? 'Signing in…' : 'Sign in' }}
        </button>
      </form>
    </div>
  `,
  styles: `
    .login {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100dvh;
      padding: var(--space-4);
    }

    .login__card {
      display: flex;
      flex-direction: column;
      gap: var(--space-4);
      width: min(360px, 100%);
      padding: var(--space-6) var(--space-5);
    }

    .login__brand {
      font-size: 15px;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--text-muted);
    }

    .login__title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.02em;
      margin-bottom: var(--space-2);
    }

    .login__error {
      margin: 0;
      padding: 10px 12px;
      border-radius: var(--radius-sm);
      background: var(--negative-soft);
      color: var(--negative);
      font-size: 13px;
    }

    .login__submit {
      width: 100%;
      padding: 12px;
    }
  `,
})
export class LoginCard {
  protected readonly auth = inject(AuthStore);

  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly submitting = signal(false);

  protected readonly canSubmit = computed(
    () => !!this.email() && !!this.password() && !this.submitting(),
  );

  protected async submit(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canSubmit()) {
      return;
    }
    this.submitting.set(true);
    await this.auth.signIn(this.email().trim(), this.password());
    this.submitting.set(false);
  }

  protected readValue(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }
}
