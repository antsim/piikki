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
- **Installable and offline-capable.** It's a PWA — add it to your home
  screen and it works without a connection, syncing back up once you're
  online again. See [Installing it as an app, and working offline](#installing-it-as-an-app-and-working-offline).

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

## Moving from a spreadsheet: setting the starting balance

A fresh install always starts at €0.00 — the balance is just the sum of every
transaction, and there aren't any yet. To carry in whatever your old
spreadsheet last said, add one transaction using the **Opening balance**
category (add form → Type):

1. Enter the amount.
2. **Starting balance favors** — pick whichever the old tracker said. If it
   said your partner owed you money, choose yourself; the live preview at the
   bottom shows the resulting balance before you save, so you can check it
   against the spreadsheet's number first.
3. Set the date to the day the spreadsheet's number was as of — typically the
   day before you start entering new transactions here.

That's the whole migration: one transaction, then everything from here on
works normally. The chip disappears from the Type list after you use it (there
should only ever be one) and reappears if you delete that entry.

Under the hood this reuses the exact same arithmetic as a settlement — "favors
me" / "favors partner" maps onto the same `payer` field a real settlement
uses — so there's no separate balance rule for this case, only different
wording in the form (a settlement's "who sent the money?" doesn't make sense
for a number carried in from elsewhere).

## Months

There are no manual "carry over" rows. A month's opening balance is simply the
running total of everything before it, so the closing balance of one month is
the opening balance of the next, always.

## Installing it as an app, and working offline

piikki is a PWA: "Add to Home Screen" (or the install icon in a desktop
browser's address bar) puts it on your phone or dock like a real app, no
browser chrome, with its own icon.

That also means the app shell — the HTML/JS/CSS, not your data — is cached
by a service worker, so opening it doesn't need a connection once you've
loaded it at least once. What "offline" then does depends on which storage
mode you're in:

- **Local mode** — already fully offline by nature; every write goes
  straight to IndexedDB, connection or not. The service worker just makes
  the app itself launch instantly and without a network round trip too.
- **Cloud mode** — reads fall back to the last successfully synced snapshot
  instead of an error screen, and any add/edit/delete you make while offline
  is queued on-device and replayed automatically the moment the browser
  reports being back online — the ledger banner shows "N changes made while
  offline" for as long as that replay is pending. Backup import and "delete
  all" are the one exception: those bulk-replace the whole ledger and simply
  require a connection, the same as before.

Two devices editing the same row while one was offline resolves the way it
always does in cloud mode: whichever write reaches Postgres last wins, and
the Realtime subscription brings the other device's screen up to date within
about a second of reconnecting.

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

### Cloud mode (optional — synced across devices, with login)

Add a Supabase project and every write goes straight to Postgres; a Realtime
subscription pushes the other device's changes back within about a second, no
manual export/import needed. Cloud mode requires signing in — there are
exactly two accounts (you and your partner), created by hand ahead of time,
no public sign-up.

**Setup, once:**

1. Create a free project at [supabase.com](https://supabase.com).
2. Open the SQL editor and run [`supabase/schema.sql`](supabase/schema.sql) —
   it creates the `transactions` and `settings` tables and locks them to
   signed-in users. Safe to re-run.
3. Create the two accounts: **Authentication → Users → Add user**, once for
   each of you, with an email and password. Check **Auto Confirm User** so
   there's no email-verification link to click — you're creating these
   yourselves, so there's nothing to verify.
4. In the project's **Settings → API** page, copy the **Project URL** and the
   **anon public** key (this key is not a secret — see below).
5. Copy `public/config.example.json` to `public/config.json` (this file is
   gitignored — it's a personal, per-deployment file, not something to commit)
   and fill in those two values:

   ```json
   {
     "supabaseUrl": "https://your-project-ref.supabase.co",
     "supabaseAnonKey": "your-anon-public-key"
   }
   ```
6. `npm run build` — Angular's asset pipeline copies `public/config.json` into
   `dist/piikki/browser/config.json` automatically. Deploy as usual.

Opening the deployed app now shows a sign-in screen; each of you logs in once
per device (the session persists, so it's not a repeat-every-visit thing) and
can sign out again from Settings, which also shows which mode is active
("Cloud sync via Supabase" vs. "This device only").

**Security model:** Row Level Security (`supabase/schema.sql`) grants full
access only to the `authenticated` role — the `anon` role (nobody logged in)
gets nothing. That means the database itself requires a valid login, not just
the app's UI: even someone who extracts the anon key from the browser bundle
(which is normal — Supabase's anon key is not a secret and is meant to ship
in client code) cannot read or write anything without one of your two
accounts' credentials. Hosting-level password protection on top of this is
still worth keeping — it stops an unauthenticated visitor from even reaching
the login screen — but it's a second layer now, not the only one standing
between the internet and your data.

There's no in-app "forgot password" — with two known people, that path is
simpler handled from the Supabase dashboard directly (**Authentication →
Users**, reset either account's password there) than by building a recovery
flow into the app.

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
│   ├── auth/        AuthStore + the shared Supabase client (cloud mode only)
│   ├── storage/     LedgerStorage port + IndexedDB / in-memory / Supabase adapters,
│   │                plus OfflineQueueLedgerStorage (the offline cache + write queue)
│   ├── state/       LedgerStore (signals), ToastStore
│   ├── backup/      JSON export / import
│   └── format/      currency + percentage formatting
├── features/
│   ├── auth/        the login screen
│   ├── ledger/      balance card, month switcher, transaction list
│   ├── transaction-form/  add / edit dialog
│   └── settings/    names, split rules, sync + sign-out, backup, formatting
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
  (`LazySupabaseLedgerStorage`) that dynamically `import()`s the real adapter,
  plus a shared `getSupabaseClient()` factory that both it and `AuthStore` use
  — one client instance per page, as Supabase recommends, built only once
  something actually needs it. Local-only deployments never download it.
- **Writes are optimistic** — the UI updates immediately and rolls back with an
  error message if the write fails, cloud or local alike.
- **Cloud mode syncs live**, not by polling: `SupabaseLedgerStorage` opens a
  Realtime subscription and `LedgerStore` re-fetches when it fires, coalescing
  a burst of remote changes into one refresh.
- **`LedgerStore` gates its own load on `AuthStore.readyToLoad`** rather than
  bootstrap code deciding when it's safe to call — local mode is ready
  immediately, cloud mode with an existing session loads inline during
  startup, and cloud mode with no session yet renders the login screen and
  loads reactively the moment sign-in succeeds. One rule, three cases, instead
  of the call sites having to know which case they're in.
- Routes are lazy-loaded; the initial bundle is ~72 kB compressed (local
  mode never pays for the Supabase client at all).
- **Cloud mode's write path goes through `OfflineQueueLedgerStorage`**, a
  decorator around `LazySupabaseLedgerStorage` — `LedgerStore` still only
  knows about the `LedgerStorage` interface. It keeps its own small
  IndexedDB database (`IndexedDbOfflineStore`, separate from the main
  `piikki` one, with an in-memory fallback for browsers without IndexedDB)
  holding the last successfully loaded snapshot and a queue of writes that
  failed while offline. A write is judged "offline" heuristically
  (`navigator.onLine`, or the `TypeError` a `fetch()` throws on a network
  failure) so a real server error still surfaces immediately instead of
  disappearing into the queue; see its `isOfflineError` doc comment. The
  queue replays on the browser's `online` event and, on success, fires the
  same `onRemoteChange` notification a partner's write would — `LedgerStore`
  doesn't need to know the difference. Bulk replace (backup import, "start
  over") is intentionally not queued, for the same non-atomicity reason
  `SupabaseLedgerStorage.replaceAll` already documents.
- **The service worker (`@angular/service-worker`, configured in
  `ngsw-config.json`) caches app code lazily, not on install** — unlike the
  Angular CLI's default PWA scaffold, which prefetches every JS/CSS chunk
  up front. A blanket prefetch would silently defeat the lazy-loading point
  above: the Supabase SDK chunk would get downloaded in the background for
  local-only deployments the first time the service worker installs, even
  though nothing ever imports it. Lazy caching means a chunk is only ever
  fetched (and then cached for next time) when the app actually requests
  it, so a local-only deployment still never downloads it — offline support
  just costs one extra reload after the first successful visit before the
  full app shell is cached, versus prefetching it instantly at install
  time.

## Development

```bash
npm install
npm start          # dev server on http://localhost:4200
npm test           # unit tests (vitest)
npm run build      # production build -> dist/piikki/browser
```

## Hosting

The build output is static files — any static host works.

**On the deployed page being public:** the original plan was hosting-level
password protection (HTTP basic auth, Cloudflare Access, Netlify password
protection) because there was no login. Cloud mode has real login now (see
above), which changed the calculus:

- **Cloud mode** — the database requires a signed-in session; a public URL
  just means a stranger can see the login screen, not your data. Hosting-level
  password protection is still fine to add as an extra layer, but it's no
  longer the thing standing between the internet and your ledger.
- **Local mode** — there's no shared backend at all; every visitor gets their
  own empty browser-local instance. A stranger finding the URL sees a blank
  app, not your data, wherever they are.

Either way, publishing a public URL is a reasonable default now. Add hosting-level
protection on top if you'd still rather nobody unfamiliar even see the login
screen.

### GitHub Pages (automated)

`.github/workflows/deploy-pages.yml` builds and deploys on every push to
`main` — nothing to run by hand after the one-time setup:

1. **Settings → Pages → Build and deployment → Source → GitHub Actions.**
2. For cloud mode, add the two values from `public/config.json` as **Settings
   → Secrets and variables → Actions → Variables** (the *Variables* tab, not
   *Secrets* — see why above): `SUPABASE_URL` and `SUPABASE_ANON_KEY`. Skip
   this for local mode; the workflow deploys in local mode automatically when
   they're unset.
3. Push to `main` (or run the workflow manually from the Actions tab). The
   site publishes to `https://<your-username>.github.io/piikki/`.

The workflow handles what a manual GitHub Pages deploy otherwise needs by
hand: building with `--base-href /piikki/` (Pages serves a project site from
a subpath) and copying `index.html` to `404.html` (Pages has no server-side
rewrite rules, so a deep link — e.g. reloading on `/settings` — needs the
404 page to *be* the app; Angular's router takes it from there).

### Other static hosts

Publish the contents of `dist/piikki/browser`. If you're using cloud mode,
`public/config.json` must exist *before* `npm run build` runs so the asset
pipeline picks it up (see the Cloud mode setup above).

Because it is a single-page app, the host must serve `index.html` for unknown
paths:

- **Netlify / Cloudflare Pages** — `public/_redirects` is included and handles it.
- **nginx** — `try_files $uri $uri/ /index.html;`

## Licence

MIT — see [LICENSE](LICENSE).
