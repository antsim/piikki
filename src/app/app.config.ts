import { ApplicationConfig, provideAppInitializer, inject, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { LedgerStore } from './core/state/ledger-store';
import { provideLedgerStorage } from './core/storage/ledger-storage.provider';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'top' })),
    provideLedgerStorage(),
    // The ledger is read from IndexedDB before the first render, so the UI never
    // flashes an empty state for data that is already on the device.
    provideAppInitializer(() => inject(LedgerStore).load()),
  ],
};
