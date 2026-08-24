# piikki

A small household ledger for two people, replacing the spreadsheet where every
shared purchase was typed in by hand with a split percentage.

You record **what was bought, how much it cost, which split applies and who
paid**. The app works out the rest: the balance between you, month by month,
carried forward automatically.

- **Balance convention** — positive means your partner owes you, negative means
  you owe them. Same as the spreadsheet.
- **Still no backend to write or run.** It is a plain Angular single-page app.
  By default the data lives in the browser's IndexedDB; optionally, point it at
  a [Supabase](https://supabase.com) project (a hosted Postgres database) and
  every device sees the same ledger live — no server code, just a config file.

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

There are two modes, chosen automatically by whether a `config.json` file is
present — no rebuild needed to switch, no code branches by environment.

### Local mode (default, nothing to set up)

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

### Cloud mode (optional — synced across devices)

Add a Supabase project and every write goes straight to Postgres; a Realtime
subscription pushes the other device's changes back within about a second, no
manual export/import needed.

**Setup, once:**

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run [`supabase/schema.sql`](supabase/schema.sql) —
   it creates the `transactions` and `settings` tables and the access
   policies. Safe to re-run.
3. In the project's **Settings → API** page, copy the **Project URL** and the
   **anon public** key.
4. Copy `public/config.example.json` to `public/config.json` (this file is
   gitignored — it's a personal, per-deployment file, not something to commit)
   and fill in those two values:

   ```json
   {
     "supabaseUrl": "https://your-project-ref.supabase.co",
     "supabaseAnonKey": "your-anon-public-key"
   }
   ```
5. `npm run build` — Angular's asset pipeline copies `public/config.json` into
   `dist/piikki/browser/config.json` automatically. Deploy as usual.

Settings shows which mode is active ("Cloud sync via Supabase" vs. "This
device only").

**Security model, and why it's fine here:** the Supabase anon key is not a
secret by Supabase's design — it ships in the browser bundle and is meant to.
The database is protected by Row Level Security policies, and
`supabase/schema.sql` sets those policies to allow anything, because there is
no login in the app (per the brief: password-protect the *page* at the
hosting level instead). That means the access boundary is the page, not the
database — **don't deploy cloud mode without hosting-level password
protection**, since anyone who can load the page can also read the anon key
out of it and query the database directly. If real login is added later
(Supabase Auth), tighten the policies in `supabase/schema.sql` to check
`auth.uid()` instead of allowing everything.

**A rare edge case:** importing a backup or "delete all" does a delete-then-
insert against Postgres rather than one atomic transaction (the Supabase JS
client doesn't expose multi-statement transactions), so a write from the other
device landing in that exact gap could be lost. Not a concern for routine
add/edit/delete, which are single-row writes.

## Architecture

Layered, with dependencies pointing inwards — `features` → `core/state` →
`core/storage` → `core/domain`. The domain layer is plain TypeScript with no
Angular imports, which is what makes the money rules cheap to test.

```
src/app/
├── core/
│   ├── domain/      money, dates, transactions, split rules, the balance rules
│   ├── config/      AppConfigStore — loads config.json, decides local vs. cloud
│   ├── storage/     LedgerStorage port + IndexedDB / in-memory / Supabase adapters
│   ├── state/       LedgerStore (signals), ToastStore
│   ├── backup/      JSON export / import
│   └── format/      currency + percentage formatting
├── features/
│   ├── ledger/      balance card, month switcher, transaction list
│   ├── transaction-form/  add / edit dialog
│   └── settings/    names, split rules, sync status, backup, formatting
└── shared/ui/       toast host
```

Notable choices:

- **Angular 21, standalone, zoneless, signal-based.** No NgModules, no RxJS in
  application code, `OnPush` everywhere.
- **Money is integer cents.** Floats only exist at the parse/format boundary.
- **`LedgerStorage` is an abstract class used as a DI token,** implemented by
  three adapters (IndexedDB, in-memory, Supabase) that the app can't tell
  apart — `LedgerStore` only ever calls the interface. `AppConfigStore` reads
  `config.json` once at boot and a small factory (`ledger-storage.provider.ts`)
  picks the adapter; everything above that line is unaware which one it got.
- **The Supabase SDK is lazy-loaded**, via a thin wrapper
  (`LazySupabaseLedgerStorage`) that dynamically `import()`s the real adapter.
  Local-only deployments never download it — it only ships to people who
  actually configure cloud mode.
- **Writes are optimistic** — the UI updates immediately and rolls back with an
  error message if the write fails, cloud or local alike.
- **Cloud mode syncs live**, not by polling: `SupabaseLedgerStorage` opens a
  Realtime subscription and `LedgerStore` re-fetches when it fires, coalescing
  a burst of remote changes into one refresh.
- Routes are lazy-loaded; the initial bundle is ~70 kB compressed (local
  mode never pays for the Supabase client at all).

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

Publish the contents of `dist/piikki/browser`. If you're using cloud mode,
`public/config.json` must exist *before* `npm run build` runs so the asset
pipeline picks it up (see the Cloud mode setup above) — nothing else to do
per-host, it's just another static file.

Because it is a single-page app, the host must serve `index.html` for unknown
paths:

- **Netlify / Cloudflare Pages** — `public/_redirects` is included and handles it.
- **GitHub Pages** — copy `index.html` to `404.html` after building, and build
  with `ng build --base-href /<repo-name>/`.
- **nginx** — `try_files $uri $uri/ /index.html;`

## Licence

MIT — see [LICENSE](LICENSE).
