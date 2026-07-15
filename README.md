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

## Current status: M1, Slice 3

The application shell (Slice 1) is hardened (Slice 2: `contextIsolation`,
disabled `nodeIntegration`, `sandbox`, CSP, restricted navigation, an
allow-listed preload API) and now bootstraps its local SQLite database on
startup (Slice 3).

**Intentionally absent at this stage:** any business tables (products,
inventory, accounts, users, etc.), authentication, and any database or
filesystem access exposed to the renderer. The only renderer-facing API
remains the single `window.ledgerpage.getAppInfo()` call from Slice 2.

### Application data

On startup, LedgerPage resolves Electron's per-OS application-data
directory (`app.getPath('userData')`) and creates four managed
subdirectories there — never inside the source tree or install directory:

- `database/` — the live SQLite database (`ledgerpage.db`, WAL mode) — the
  only one actually used in Slice 3
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
