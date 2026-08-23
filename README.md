# piikki

A small household ledger for two people, replacing the spreadsheet where every
shared purchase was typed in by hand with a split percentage.

You record **what was bought, how much it cost, which split applies and who
paid**. The app works out the rest: the balance between you, month by month,
carried forward automatically.

- **Balance convention** — positive means your partner owes you, negative means
  you owe them. Same as the spreadsheet.
- **No backend.** It is a plain Angular single-page app; the data lives in the
  browser's IndexedDB and is exported/imported as a JSON file.

## The split rules

Two default rules plus direct payments, all configurable in Settings:

| Rule | Who paid | Balance change | Old spreadsheet column |
| --- | --- | --- | --- |
| Household (60 % mine) | me | `+40 %` of the amount | `60 %` |
| Household (60 % mine) | partner | `−60 %` of the amount | `-40 %` |
| Shared 50/50 | me | `+50 %` of the amount | `50 %` |
| Shared 50/50 | partner | `−50 %` of the amount | `-50 %` |
| Settlement | partner pays me | `−` the full amount | `-100 %` |
| Settlement | I pay partner | `+` the full amount | — |

The signed percentage is still shown on every row, so the ledger reads the way
the spreadsheet did.

**Settle up** on the balance card pre-fills a settlement for the whole
outstanding balance in the right direction — the once-a-month payment, in two
taps.

Split rules are **snapshotted onto each transaction when it is saved**. Changing
"Household" from 60 % to 55 % later affects new entries only; history never
silently rewrites itself.

## Months

There are no manual "carry over" rows. A month's opening balance is simply the
running total of everything before it, so the closing balance of one month is
the opening balance of the next, always.

## Where the data lives

| | |
| --- | --- |
| Primary store | IndexedDB in the browser (database `piikki`) |
| Saved | on every add / edit / delete, immediately |
| Backup | JSON file, exported from Settings |
| Sync between devices | export on one device, import on the other |

Because the data is device-local, **the JSON export is the only copy that
survives clearing browser data**. The app reminds you when the last export is
getting old. Importing a backup replaces everything currently in the app.

If a browser blocks IndexedDB entirely (some private-browsing modes), the app
still runs but warns that nothing will be saved.

## Architecture

Layered, with dependencies pointing inwards — `features` → `core/state` →
`core/storage` → `core/domain`. The domain layer is plain TypeScript with no
Angular imports, which is what makes the money rules cheap to test.

```
src/app/
├── core/
│   ├── domain/      money, dates, transactions, split rules, the balance rules
│   ├── storage/     LedgerStorage port + IndexedDB / in-memory adapters
│   ├── state/       LedgerStore (signals), ToastStore
│   ├── backup/      JSON export / import
│   └── format/      currency + percentage formatting
├── features/
│   ├── ledger/      balance card, month switcher, transaction list
│   ├── transaction-form/  add / edit dialog
│   └── settings/    names, split rules, backup, formatting
└── shared/ui/       toast host
```

Notable choices:

- **Angular 21, standalone, zoneless, signal-based.** No NgModules, no RxJS in
  application code, `OnPush` everywhere.
- **Money is integer cents.** Floats only exist at the parse/format boundary.
- **`LedgerStorage` is an abstract class used as a DI token.** Swapping
  IndexedDB for a hosted API later is a one-file change plus a provider.
- **Writes are optimistic** — the UI updates immediately and rolls back with an
  error message if the write fails.
- Routes are lazy-loaded; the initial bundle is ~68 kB compressed.

## Development

```bash
npm install
npm start          # dev server on http://localhost:4200
npm test           # unit tests (vitest)
npm run build      # production build -> dist/piikki/browser
```

## Hosting

The build output is static files — any static host works, and the app is a good
fit for hosting-level password protection (HTTP basic auth, Cloudflare Access,
Netlify password protection), which is why there is no login inside the app.

Publish the contents of `dist/piikki/browser`. Because it is a single-page app,
the host must serve `index.html` for unknown paths:

- **Netlify / Cloudflare Pages** — `public/_redirects` is included and handles it.
- **GitHub Pages** — copy `index.html` to `404.html` after building, and build
  with `ng build --base-href /<repo-name>/`.
- **nginx** — `try_files $uri $uri/ /index.html;`

## Licence

MIT — see [LICENSE](LICENSE).
