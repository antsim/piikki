import {
  ApplicationConfig,
  inject,
  Injector,
  isDevMode,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  runInInjectionContext,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { AuthStore } from './core/auth/auth.store';
import { AppConfigStore } from './core/config/app-config.store';
import { LedgerStore } from './core/state/ledger-store';
import { provideLedgerStorage } from './core/storage/ledger-storage.provider';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideLedgerStorage(),
    // config.json must be loaded before anything first injects LedgerStorage
    // (LedgerStore's constructor does), because the storage factory reads the
    // resolved config synchronously to decide local vs. Supabase. `inject()`
    // only works synchronously, so the LedgerStore injection — which has to
    // happen *after* the `await` below — is wrapped in
    // `runInInjectionContext` using an injector captured up front.
    //
    // LedgerStore itself is always constructed (cheap: it only wires up its
    // storage subscription and an auth-gated effect — see its constructor),
    // but its data is only awaited here when we already know it's safe to
    // read: local mode, or cloud mode with an existing signed-in session.
    // Cloud mode with no session yet renders straight to a login screen
    // instead of blocking on data nothing is authorized to return; once
    // sign-in succeeds, LedgerStore's own effect notices the gate open and
    // loads reactively.
    provideAppInitializer(() => {
      const injector = inject(Injector);
      const configStore = inject(AppConfigStore);
      const authStore = inject(AuthStore);
      return (async () => {
        await configStore.load();
        const config = configStore.config();
        if (config) {
          await authStore.init(config);
        } else {
          authStore.disable();
        }

        const ledgerStore = runInInjectionContext(injector, () => inject(LedgerStore));
        if (authStore.readyToLoad()) {
          await ledgerStore.load();
        }
      })();
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
