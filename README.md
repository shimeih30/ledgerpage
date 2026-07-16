# LedgerPage

LedgerPage is a manufacturing and business-management application for small
and growing manufacturers. It tracks purchasing, inventory, production
costing, sales, and basic double-entry accounting, and answers the questions
a manufacturer needs to run day to day: what to produce next, whether
materials and cash are available, what a batch actually cost, and the
current health of the business.

LedgerPage is being built first for Farmer Ben's (a chilli sauce
manufacturer) but is designed as a configurable product, not a
single-company tool.

## Current status: M1, Slice 5

The application shell (Slice 1) is hardened (Slice 2) and bootstraps its
local SQLite database on startup (Slice 3, with a single-instance lock).
Slice 4 added the first permanent reference-data tables. Slice 5 adds the
first company-owned tables — a database-and-service-enforced singleton
company profile and the document-numbering configuration later modules
will allocate numbers from.

**Intentionally absent at this stage:** any _seeded_ company data (the
`company` and `numbering_rules` tables exist but are empty — see below),
users, roles, authentication, products, inventory, customers, suppliers,
orders, recipes, production, expenses, accounts, taxes, exchange rates,
unit conversions, any UI management screens, and any database or
filesystem access exposed to the renderer. The only renderer-facing API
remains the single `window.ledgerpage.getAppInfo()` call from Slice 2.

### Company profile & document numbering

`company` is a strict singleton: its `id` column has both a `PRIMARY KEY`
and a `CHECK (id = 'primary_company')` constraint, so SQLite itself
rejects a second row and any row with a different id — not just
`companyService`, which never accepts an `id` parameter from any caller
either. No company row is seeded by this slice; the real one (with Farmer
Ben's actual name, address, and details) is created by Slice 8's
first-run setup wizard.

`numbering_rules` holds one row per document type (quotation, sales
order, invoice, delivery note, purchase order, goods receipt, production
batch, customer, supplier, product), each with a prefix, six-digit
padding, and a reset behavior (`yearly`, restarting at 1 each UTC year,
or `never`, continuing indefinitely). `numberingService.allocateNext`
allocates atomically inside a caller-provided transaction — its type
signature requires an active transaction, making it a compile-time error
to call outside one. The 10 approved defaults are frozen in
`src/main/db/numberingDefaults.ts` but, like the company row, are only
ever inserted by Slice 8 — this slice ships the mechanism, not the data.

### Reference data

Four tables, seeded automatically on startup (after migrations, before the
window opens): `currencies`, `units_of_measure`, `payment_methods`,
`expense_categories`. Every row uses a stable, application-controlled text
id (e.g. `currency_usd`, `uom_kg`) — never a random id — so later tables
can reference them permanently. Seeding is idempotent and non-destructive:
it only inserts rows that don't already exist by id, and never overwrites
a row a user has since edited (name, description, sort order, active
state) or reactivates one they deactivated.

**Currencies seeded:** USD, ZAR, BWP, CNY, ZWG (Zimbabwe Gold, symbol
ZiG). ZWL (the former RTGS dollar) is not seeded — it was superseded by
ZWG in 2024 and is not the current official Zimbabwe currency.

Timestamps (`created_at`/`updated_at`) are stored as Unix epoch
milliseconds (SQLite `INTEGER`, Drizzle `timestamp_ms` mode) — the
convention this slice establishes for all future tables, since no prior
decision had pinned an exact unit.

### Application data

On startup, LedgerPage resolves Electron's per-OS application-data
directory (`app.getPath('userData')`) and creates four managed
subdirectories there — never inside the source tree or install directory:

- `database/` — the live SQLite database (`ledgerpage.db`, WAL mode) — the
  only one actually used so far
- `backups/`, `assets/`, `logs/` — reserved for later milestones

Typical locations: macOS
`~/Library/Application Support/LedgerPage/`, Windows
`%APPDATA%\LedgerPage\`, Linux `~/.config/LedgerPage/`.

### Database migrations

Schema changes are forward-only Drizzle migrations generated into
`migrations/` via `pnpm db:generate` and applied automatically on every
startup (tracked in a `schema_migrations` table — already-applied
migrations are never reapplied). There is no automatic schema
synchronization and no down-migrations; a correction is a new forward
migration. If migration or database initialization fails, the app shows a
native error dialog and quits rather than opening in a broken state.

### Single instance

Only one LedgerPage process may own and open the database at a time.
`app.requestSingleInstanceLock()` is acquired before any database
initialization; a second launch attempt quits immediately (no SQLite
touched, no window opened) and instead signals the already-running
instance, which restores (if minimized), shows, and focuses its existing
window — it never opens a second window or a second database connection.

### Native module rebuilds (better-sqlite3)

`better-sqlite3` is a native addon and must be compiled against whichever
runtime loads it — Electron's bundled Node differs from your system Node,
so the same compiled binary cannot serve both:

- **Tests use the Node ABI.** `pnpm test` automatically rebuilds
  `better-sqlite3` for plain Node first (via `pretest`), since Vitest runs
  under Node, not Electron.
- **`pnpm dev` and `pnpm preview` use the Electron ABI.** Each rebuilds
  `better-sqlite3` for Electron first (via `predev`/`prepreview`), since
  they actually launch the Electron binary.
- **`pnpm build` only bundles — it does not rebuild anything.** It runs
  `electron-vite build` directly, with no native-rebuild step, no
  Electron-header download, and no ABI change. Bundling doesn't execute
  the native module, so it doesn't need it to match any particular ABI.

This means switching between running the app (`dev`/`preview`) and running
tests triggers a short rebuild each time — expected, not a bug. The
rebuild scripts run `electron-rebuild` without `-f`, which avoids
unnecessary forced rebuild attempts when electron-rebuild determines the
module is already suitable for the target runtime — but this does not
guarantee preservation of the previous binary once a genuine rebuild has
started: if compilation or downloading fails partway through, the module
can still end up unusable, since a rebuild that actually runs may clean
existing build output regardless of the `-f` flag. If a rebuild fails,
rerun the appropriate command once the required network/toolchain access
is available — `pnpm rebuild:node` for tests, `pnpm rebuild:electron` for
dev/preview. A `NODE_MODULE_VERSION` mismatch error indicates the module
is currently built for the wrong runtime ABI; that's the signal to run
whichever of those two matches what you're about to do.

### Preload build format

`out/preload/index.js` is built as a single self-contained CommonJS file
(`require()`, no top-level `import`/`export`), never ES module syntax.
Electron's sandboxed preload loader (`sandbox: true`, which LedgerPage
always keeps enabled) evaluates the preload script as a classic script
regardless of this project's `package.json` `"type": "module"` — top-level
`import`/`export` there is a hard parse error
(`SyntaxError: Cannot use import statement outside a module`), even though
the identical file is valid as an ES module under plain Node. Main process
and renderer output both remain ES modules; only the preload build target
is affected.

### Development vs. production Content-Security-Policy

Two separate, explicit policies — never one function branching on a flag:

- **Production** (`buildProductionContentSecurityPolicy`): strict,
  `'self'`-only for scripts and connections, no inline scripts, no remote
  origins. This is what every packaged (`file://`) load runs under.
- **Development** (`buildDevelopmentContentSecurityPolicy`): additionally
  trusts exactly one already-validated loopback origin (never a wildcard,
  never a remote host) for both its HTTP and WebSocket forms, and adds
  `'unsafe-inline'` to `script-src` only — required because Vite's React
  plugin injects an inline `<script type="module">` "preamble" (sets up
  React Refresh globals) whose exact content is generated per dev session,
  with no static nonce/hash to allow instead. This trade-off never applies
  to the production policy.

### Common failure to recognize

If the Electron window is completely white with a `SyntaxError` about
`import` in the preload, or a CSP violation naming an inline script
followed by "`@vitejs/plugin-react` can't detect preamble" — that's this
exact preload-format / dev-CSP interaction. Both are covered by automated
tests (`tests/build/preloadOutput.test.ts`,
`tests/main/contentSecurityPolicy.test.ts`) so a regression here should
fail `pnpm test` before it ever reaches a real launch.

## Requirements

- Node.js `22.x` (LTS)
- pnpm `11.13.0` (see `packageManager` field in `package.json`)

```bash
corepack enable
corepack prepare pnpm@11.13.0 --activate
```

## Commands

```bash
pnpm install --frozen-lockfile   # install dependencies exactly as locked
pnpm dev                         # run the app in development mode
pnpm typecheck                   # TypeScript project checks (main + renderer)
pnpm lint                        # ESLint
pnpm format                      # Prettier — write formatting fixes
pnpm format:check                # Prettier — check only, no writes
pnpm test                        # Vitest test suite
pnpm build                       # production build of main, preload, renderer
pnpm db:generate                 # generate a new Drizzle migration from schema.ts
pnpm rebuild:electron            # rebuild native modules for Electron's ABI
pnpm rebuild:node                # rebuild native modules for plain Node's ABI
```

## Verification set

Before accepting any slice, all of the following must pass:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```
