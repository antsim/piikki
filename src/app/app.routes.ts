import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'piikki',
    loadComponent: () => import('./features/ledger/ledger-page').then((m) => m.LedgerPage),
  },
  {
    path: 'settings',
    title: 'Settings · piikki',
    loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: '' },
];
