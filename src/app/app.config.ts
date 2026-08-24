import {
  ApplicationConfig,
  inject,
  Injector,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  runInInjectionContext,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
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
    provideAppInitializer(() => {
      const injector = inject(Injector);
      const configStore = inject(AppConfigStore);
      return (async () => {
        await configStore.load();
        const ledgerStore = runInInjectionContext(injector, () => inject(LedgerStore));
        await ledgerStore.load();
      })();
    }),
  ],
};
