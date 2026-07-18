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

## Current status: M1, Slice 7

The application shell (Slice 1) is hardened (Slice 2) and bootstraps its
local SQLite database on startup (Slice 3, with a single-instance lock).
Slice 4 added the first permanent reference-data tables. Slice 5 added the
first company-owned tables — a database-and-service-enforced singleton
company profile and document-numbering configuration. Slice 6 added tax
configuration: company-scoped tax codes and their effective-dated rate
history. Slice 7 adds authentication and authorization primitives —
password hashing, users, roles, sessions, and an owner recovery-credential
ceremony — with no renderer screens or IPC endpoints yet.

**Intentionally absent at this stage:** any _seeded_ company, numbering,
tax, or user data (the four fixed roles are the one exception — see
below), authentication IPC, products, inventory, customers, suppliers,
orders, recipes, production, expenses, accounts, exchange rates, unit
conversions, any UI management screens, and any database or filesystem
access exposed to the renderer. The only renderer-facing API remains the
single `window.ledgerpage.getAppInfo()` call from Slice 2.

### Authentication foundations

Password hashing uses **Argon2id via `hash-wasm`**, deliberately chosen
over a native-binding Argon2 package: `hash-wasm` has zero native
compilation (no `binding.gyp`, no postinstall step, the compiled WASM is
embedded directly in its JS), which sidesteps entirely the Node-ABI-vs-
Electron-ABI class of problem this project has had with `better-sqlite3`
throughout — confirmed by building it into the actual main-process bundle
and inspecting the output. Parameters are explicit (64 MiB memory, 3
iterations, 1-way parallelism, ~280ms per hash on typical hardware) —
stronger than OWASP's baseline, since LedgerPage only ever hashes once
per login on the user's own machine, never under concurrent server load.

`users`/`roles`/`user_roles`/`owner_recovery_credentials`/`login_events`
are added but not seeded — except `roles`, which (like Slice 4's
reference data) is fixed, idempotently-seeded application data: `owner`,
`executive`, `operations`, `finance`. The real `users` row and its role
assignment are Slice 8's job, as part of first-run setup.

**Anti-enumeration:** `authenticationService.authenticate` runs the same
password-verification step for every case — nonexistent identifier, wrong
password, inactive user, locked user — using a fixed precomputed dummy
Argon2id hash when no real user is found, so there is no code path that
returns early based on whether an account exists. `login_events` never
records an unmatched login identifier (`user_id` is `NULL` instead), and
a failed attempt increments a real user's `failed_login_count` only when
the password itself was wrong — not when a correct password was blocked
by an inactive/locked gate.

Sessions are in-memory only (no session table — see
`src/main/auth/sessionManager.ts`); the owner recovery-credential ceremony
generates a 160-bit key in Crockford Base32 (grouped for transcription),
stores only its hash during the pending ceremony, and commits the
rotation (revoke prior active credential + insert the new one) atomically
via a caller-controlled transaction, matching the pattern already
established by `numberingService`/`taxRateVersionService`. Authorization
is a single central `can`/`assertCan` service with a fixed action set and
role matrix; both fail closed on an unrecognized role or action.

**Security patch applied before freezing, in four passes:**

1. **Session unlock requires proof, not a comment — and the verified-unlock
   operation itself is the only door, not a separately exported one.**
   `SessionManager` has no public `unlock` method. The only way to clear a
   session's lock flag is the `unlockWithCredentials(db, sessionId, password, now?)`
   method on the manager itself, defined inside the same closure that owns
   the session records — not a separately exported function reachable by
   any other main-process module. An earlier version of this fix exported
   a `applyVerifiedUnlock(manager, sessionId, now?)` function as the "door"
   into a `WeakMap`-gated private mutator; that export was itself an
   unrestricted, credential-free way to clear the lock flag, since nothing
   stopped another module from importing and calling it directly. Folding
   the whole verified-unlock operation into `sessionManager.ts` — calling
   `authenticate(db, ..., 'session_unlock', now)` internally and only then
   touching the closure-private records — removes that gap entirely: there
   is no exported symbol, anywhere, capable of clearing `isLocked` without
   real credential verification.
2. **Recovery confirmation is an unforgeable capability, consumed exactly
   when the database commit truly happens.** `confirmCeremony` returns only
   `{ commitToken }` — an opaque string — never `userId`/`recoveryKeyHash`.
   `commitCredential` is a method on the same service instance and looks
   the token up against private, per-instance state; a fabricated,
   unconfirmed, expired, or wrong-instance token is rejected. Consumption
   uses a small, general-purpose transaction wrapper
   (`src/main/db/appTransaction.ts`'s `runAppTransaction`, used narrowly —
   only here) that runs a real SQLite transaction and, only once it has
   actually returned instead of throwing, invokes any `afterCommit`
   callbacks registered during it; `commitCredential` registers its own
   capability-deletion as one such callback. A rolled-back attempt never
   runs that callback, so the capability remains for a retry with the same
   token; a genuinely committed attempt removes it immediately, so reuse
   fails at the initial in-memory lookup, not a second database query. An
   earlier version of this fix instead left the capability in memory and
   relied on checking whether the eventual credential row already existed
   in the database before writing — technically preventing a duplicate
   insert, but never actually _consuming_ the capability at the moment of
   a successful commit, as required. Both versions were verified end-to-end
   against a real transaction before being relied on, not merely assumed.
3. **`createUser`/`changePassword` validate the actual hash before
   persisting it**, not just "is this a non-empty string" —
   `validatePasswordHashForStorage` requires the literal `argon2id`
   variant, version 19, and the currently-approved m/t/p parameters
   exactly, rejecting plaintext, malformed strings, argon2i/argon2d, and
   outdated-parameter hashes. `hashPassword`'s return type is branded
   (`PasswordHash`) as a compile-time nudge only — every persistence
   point re-validates at runtime regardless, since branding alone isn't
   a security boundary.
4. **Session snapshots clone every mutable value, both directions.**
   `createdAt`/`lastActivityAt` are cloned `Date` objects on every
   returned snapshot (JS `Date`s are mutable references — returning the
   original let a caller silently corrupt internal state through what
   looked like a read-only snapshot), and a `Date` from the injectable
   clock is cloned before being stored too. `idleTimeoutMs` and
   `randomId()`'s output are validated; a colliding session ID is
   retried up to a bounded limit before failing closed with
   `SessionManagerError` — a live session is never silently overwritten.
5. **Authentication state transitions are serialized**, closing a real
   TOCTOU race: two concurrent `authenticate()` calls could previously
   both read the same `failed_login_count` before either call's Argon2id
   verification resolved, then both write the same incremented value,
   undercounting attempts. Every `authenticate()` call (normal login and
   session unlock alike, since unlock calls `authenticate()` internally)
   now runs through one single, process-global, non-per-username queue
   (`authenticationQueue.ts` — global rather than per-identifier
   specifically to avoid the unbounded-growth risk a per-username lock
   map would introduce), plus a fresh re-read of the user's lockout state
   immediately before computing the final write, as a second, independent
   layer of protection.

A third pass closed three narrower gaps left by the two passes above:

6. **`unlockWithCredentials` re-validates the live session after the
   `authenticate()` await, never trusting what it captured beforehand.**
   The method used to capture the session record before awaiting
   verification and then mutate that same captured object afterward —
   during real Argon2id verification (a genuine yield point), the
   session could be destroyed, expired, or invalidated by an unrelated
   caller, and the stale object reference would still look valid even
   though it was no longer the live, current session. It now captures
   only the `userId` before the await, and — only after `authenticate()`
   reports success — re-reads the session fresh through the same
   expiry-aware lookup every other method uses, confirming it still
   exists, still belongs to the authenticated user, and is still
   locked, before ever touching `isLocked`. If any of that has changed
   during verification, the ordinary failure result is returned instead
   — proven by tests using a manually-controlled deferred promise in
   place of `verifyPassword` (deterministic, not dependent on real
   Argon2id timing), including a sanity check that destroying,
   invalidating, or expiring the session during a genuinely buggy
   version of this code is what those same tests actually catch.
7. **Recovery ceremony and commit tokens are generated with the same
   collision protection sessions already had.** `prepareCeremony`/
   `confirmCeremony` used to call the injected `randomToken()` and
   insert directly, so a duplicate (only reachable via a misbehaving
   injected generator, never the default CSPRNG) could silently
   overwrite an existing pending ceremony or confirmed capability. Both
   now go through a shared, bounded-retry generator checked against
   _both_ maps — a ceremony token and a commit token must never collide
   with each other either, since they are distinct capabilities — and
   exhausting the retry budget throws a controlled `RecoveryCeremonyError`
   without ever touching what was already stored.
8. **`runAppTransaction` rejects an async callback both at compile time
   and at runtime.** better-sqlite3's transaction callback is fully
   synchronous; passing an async function would let SQLite consider the
   transaction "finished" before any awaited work inside it actually
   ran. A `NotAPromise<T>` conditional type in the callback's signature
   rejects an async (or otherwise Promise-returning) callback at compile
   time — verified directly with `@ts-expect-error` fixtures compiled as
   part of `pnpm typecheck` — and, since that alone can be bypassed by
   an untyped caller, a runtime check inside the still-open transaction
   throws a controlled `AsyncTransactionCallbackError` the instant the
   callback returns anything thenable, rolling the transaction back
   exactly like any other error (writes made before the callback's
   first `await` do not survive) and running no `afterCommit` callback.

A fourth pass closed four narrower edge cases:

9.  **`unlockWithCredentials` never falls back to the caller-supplied
    `sessionId` as a dummy login identifier.** A missing/expired session's
    `sessionId` is caller-controlled input, not a value this module
    generates and trusts — it could coincidentally equal a real user's
    normalized login identifier, which would have let an unlock attempt
    against a nonexistent session silently increment or lock that
    unrelated real account. A fixed, private `DUMMY_UNLOCK_LOGIN_IDENTIFIER`
    constant is used instead, deliberately containing a space so
    `normalizeLoginIdentifier` structurally rejects it — guaranteed,
    not merely unlikely, to never resolve to a real account — while
    still running the full `authenticate()` verification step and
    recording a `user_id = NULL` event, exactly like any other
    nonexistent-identifier case.
10. **Recovery ceremony confirmation is one-time even under concurrent
    calls.** `confirmCeremony` used to delete the pending ceremony only
    after awaiting `verifyPassword`, so two concurrent calls for the
    same token could both verify and both mint a confirmed capability.
    A `confirmationInProgress` flag, checked and set synchronously
    before that await, closes this the same way `authenticationQueue`
    closes the equivalent login race — verified directly, empirically,
    that JavaScript's run-to-completion semantics make a synchronous
    check-and-set before the first `await` race-free for two calls
    invoked back to back. A second concurrent call returns the same
    ordinary `undefined` a wrong key would. The ceremony's state after
    the await is re-read fresh — cancellation or expiry during
    verification is treated as failure, one documented rule either way
    — and a wrong key or a thrown verification error correctly clears
    the flag so the ceremony remains retryable, never permanently
    stuck in progress.
11. **Commit-token generation happens before any pending-ceremony
    mutation.** `confirmCeremony` used to delete the pending ceremony
    and only then generate the commit token — if that generation
    exhausted its retry budget, the ceremony was already gone with no
    confirmed capability to show for it. The unique commit token is now
    generated and validated first; only once that succeeds does the
    pending-to-confirmed transition happen, with no `await` between
    removing the old entry and inserting the new one. If generation
    fails, the original pending ceremony — including being retryable,
    not stuck in-progress — remains completely untouched.
12. **`runAppTransaction`'s thenable check now also catches
    function-shaped thenables.** A plain JavaScript function can carry
    its own callable `.then` property (`typeof` such a value is
    `'function'`, not `'object'`), which the previous object-only check
    silently missed — confirmed directly: without this fix, a
    function-shaped thenable callback fell through to better-sqlite3's
    own internal guard instead, throwing a generic `TypeError` rather
    than the documented, controlled `AsyncTransactionCallbackError`.

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

### Tax configuration

`tax_codes` are company-scoped identities (`standard` / `zero_rated` /
`exempt` / `other`), normalized on creation (trimmed, upper-cased) and
retired by deactivation, never deletion — a tax code may be referenced by
historical rate versions and, later, historical transactions. No tax
codes are seeded; Farmer Ben's remains non-VAT-registered by default, and
`company.vat_registered` is never changed automatically by this slice.

**Category is immutable once a rate version exists.** Resolution reads a
tax code's _current_ category, so changing it after a rate version has
been created would silently rewrite already-resolved history (a
`standard` code's 15% versions would start resolving as zero if it were
switched to `zero_rated`). `taxCodeService.updateTaxCode` checks this
inside the same transaction as the update — never a separate check that
could diverge from the write — and requires a caller-provided
transaction (`AppTransaction`) for exactly that reason. Changing to the
same category remains a no-op even after versions exist; name,
description, and activation stay freely editable always.

`tax_rate_versions` holds effective-dated rate history per code, so
changing today's rate can never alter the rate that applied to an older
transaction. Rates are stored as integer parts-per-million — **15% is
exactly 150,000 ppm** (`percent × 10,000`) — never a float.
**`zero_rated`/`exempt` canonically store `null`**: omitting the rate,
supplying `null`, or supplying exactly `0` all normalize to `null`;
supplying any other non-zero value is rejected outright rather than
stored as contradictory data. `standard`/`other` always require a
non-null rate — `taxRateVersionService` revalidates the _final_ proposed
value against the tax code's category on every create and every update,
even when an update never touches `ratePpm`, so a previously-stored value
can never be silently carried forward without being checked again.

Effective dates are ISO `YYYY-MM-DD` calendar dates, validated by a
hand-written calendar checker rather than `new Date()`, which was
confirmed empirically to silently roll an invalid date like `2026-02-30`
forward to March 2nd instead of rejecting it. Both `effective_from` and
`effective_to` are inclusive; `taxRateVersionService.createTaxRateVersion`
and `updateTaxRateVersion` reject any date range that overlaps an
existing version of the same code (checked inside the same transaction as
the write).

`taxRateResolutionService.resolveTaxRate` is a pure, read-only lookup
that never mutates data and resolves deterministically regardless of the
tax code's current active state or the machine's local timezone. A
`{ code }` lookup is normalized with the same function `taxCodeService`
uses, and both lookup paths (`{ taxCodeId }` and `{ code }`) are scoped to
the singleton company. `zero_rated`/`exempt` always resolve to exactly
zero; `standard`/`other` require a non-null stored rate — if a matched
version's rate is somehow null (data corruption, since the write path no
longer permits this), resolution throws `TaxResolutionIntegrityError`
rather than silently substituting zero.

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
