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

## Current status: M1, Slice 9

The application shell (Slice 1) is hardened (Slice 2) and bootstraps its
local SQLite database on startup (Slice 3, with a single-instance lock).
Slice 4 added the first permanent reference-data tables. Slice 5 added the
first company-owned tables — a database-and-service-enforced singleton
company profile and document-numbering configuration. Slice 6 added tax
configuration: company-scoped tax codes and their effective-dated rate
history. Slice 7 added authentication and authorization primitives —
password hashing, users, roles, sessions, and an owner recovery-credential
ceremony — with no renderer screens or IPC endpoints yet. Slice 8 put those
primitives to first use: a first-run setup wizard that atomically creates
the real company profile, the real numbering rules, and the application's
one initial Owner account, with a mandatory one-time recovery-key
ceremony. Slice 9 is where the application becomes usable session to
session: an ordinary login/lock/logout flow for the Owner and any
additional users the Owner creates, and a minimal, Owner-only Users &
Roles settings screen — reusing every Slice 7 primitive as-is
(`authenticate`, `sessionManager`, `can`/`assertCan`) rather than
duplicating any of it.

**Intentionally absent at this stage:** fine-grained (per-field)
permissions (roles stay coarse-grained, per the confirmed decision), SSO,
any way to change an existing user's role once created, audit logging,
products, inventory, customers, suppliers, orders, recipes, production,
expenses, accounts, exchange rates, unit conversions, persistent sessions
across app restarts, and any database or filesystem access exposed to the
renderer beyond the sixteen narrow, typed methods described below.

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

### First-run setup wizard

The M1 implementation plan describes Slice 8 as the point where the real
`company` row and the real `numbering_rules` rows are actually inserted —
not Slice 5, despite Slice 5 introducing their tables. Confirmed directly
from Slice 5/7's own doc comments (`companyService.createCompany`:
"Intended for use by Slice 8's first-run transaction"; `numberingDefaults.ts`:
"Slice 8's first-run transaction is what actually inserts these rows") before
writing a line of this slice's code. First-run status is therefore
determined by whether any `users` row exists — not by whether a `company`
row exists — and the wizard's first two stages collect exactly the data
that gets inserted atomically alongside the Owner at the end.

**First-run detection (`firstRunStatusService.ts`).** One central,
main-process-only function, computed fresh from durable database state on
every call, never cached, never influenced by anything renderer-local:

- `setup_required` — the setup-owned durable state is genuinely
  **pristine**: zero `users`, zero `user_roles`, zero
  `owner_recovery_credentials`, no `company` row, and zero
  `numbering_rules` for the primary company. An earlier version of this
  check treated "zero users" alone as sufficient, which silently treated
  a partially-completed or corrupted setup attempt (a `company` row
  inserted but the Owner-creation transaction never finished, for
  instance) as an ordinary fresh start — exactly the kind of
  silent-repair-by-omission this codebase's "fail closed, never
  auto-repair" posture forbids. Reference-data rows and the four fixed
  role seeds may already exist (they're seeded by ordinary startup, not
  by setup) and never make this non-pristine.
- `setup_complete` — the primary `company` exists, all 10 approved
  `numbering_rules` rows exist, exactly one `role_owner` assignment
  identifies the initial Owner, that Owner's user row exists, and that
  Owner has exactly one active recovery credential. **Additional
  non-Owner users are explicitly permitted** and never affect this — an
  earlier version of this check treated any second `users` row as
  inconsistent, which would have made every correctly-running
  installation start reporting itself as broken the moment Slice 9 adds
  its first ordinary user.
- `inconsistent_state` — every other combination, fail-closed: a
  non-pristine zero-user state (company and/or numbering rows already
  present with no user to match — including a defensively-checked
  "numbering rules with no company row" case, only reachable at all by
  bypassing the numbering-to-company foreign key), no Owner assignment
  once users exist, more than one Owner assignment, an Owner assignment
  referencing a missing user, an orphaned `user_roles` or
  `owner_recovery_credentials` row (checked defensively even though the
  relevant foreign key already prevents both under normal operation), an
  Owner with zero or more than one active recovery credential, or missing
  company/numbering rows. Never auto-repaired anywhere in this codebase —
  the renderer gets a fixed, generic "setup could not be verified"
  screen, and the specific internal reason never crosses the IPC
  boundary.

**Owner-creation transaction (`firstRunSetupService.ts`).** One call to
the approved `runAppTransaction`, synchronous throughout: creates the
`company` row, all 10 `numbering_rules` rows, the Owner `users` row, its
`role_owner` assignment, and commits the confirmed recovery credential —
all four failing atomically together via SQLite's own transaction
mechanics if any one write fails, verified directly by simulating a late
failure and confirming zero partial rows remain. `hashPassword` (the one
genuinely async step) runs before the transaction opens, never inside it.
First-run status is checked twice — once before hashing, to avoid paying
for an Argon2id computation needlessly, and once more inside the live
transaction, which is what actually closes the race between two
concurrent completion attempts (verified directly: two concurrent
`completeSetup` calls with the same confirmed capability produce exactly
one Owner, not zero, not two).

The Owner's `users.id` has to be chosen _before_ the recovery ceremony is
prepared — `RecoveryCeremonyService.prepareCeremony(userId)` binds a
userId into its private state that `commitCredential` later uses as the
credential row's foreign key, which can only insert successfully once a
matching `users` row already exists. This required one small,
backward-compatible extension to Slice 7's `userService.createUser`: an
optional precomputed `id` field, defaulting to the previous random
generation when omitted (every existing caller and test is unaffected).

That id, its ceremony token, and (once confirmed) its commit token are
bound together in exactly one bounded `ActiveAttempt` object — not a
per-request map, not ever exposed to the renderer. Two earlier versions of
this design left narrower gaps, both since closed:

- **Ownership is decided synchronously**, via a monotonically increasing
  generation counter bumped the instant `prepareRecoveryKey()` is called —
  before its one `await` — so which of several concurrently-resolving
  preparations is "the real one" has a deterministic answer regardless of
  which finishes its own async work (a real Argon2id hash) first; verified
  directly with two preparations resolved in reversed call order, leaving
  only the later call active either way.
- **Supersession is immediate, not deferred until the new preparation
  resolves.** The moment a new `prepareRecoveryKey()` call begins, the
  previous `activeAttempt` is cleared and its ceremony cancelled
  synchronously — verified directly (via a spy) that this cancellation
  happens before the new preparation's own async work has even completed,
  not only by the time the whole call finishes. An earlier version left
  the previous attempt fully usable for the entire duration of the new
  one's async preparation, a real window (one real Argon2id hash,
  ~300-800ms) during which the stale attempt could otherwise still
  confirm or complete. If the new preparation itself fails, nothing is
  restored — there is no active attempt at all until a fresh prepare
  succeeds. A stale preparation result (superseded while its own async
  work was in flight) is cancelled and returns `{ success: false }` —
  never a ceremonyToken/plaintextRecoveryKey pair that looks usable but
  already isn't.
- **`completeSetup` revalidates ownership a second time, after hashing.**
  generation, ownerId, ceremonyToken, and commitToken are all captured
  before the one genuinely async step (`hashPassword`, another real
  Argon2id computation) and re-checked against the live `activeAttempt`
  the instant it resolves — since `runAppTransaction` itself is fully
  synchronous, that same check is also "immediately before the
  transaction begins," with no further gap for anything to change in
  between. An earlier version captured ownerId before hashing but never
  re-checked it afterward, so a `prepareRecoveryKey()` call arriving
  during the hash could supersede the in-flight completion without it
  ever noticing. The `afterCommit` cleanup itself only clears
  `activeAttempt` if its generation still matches the attempt that
  actually committed.
- **The generation field is an enforced invariant on every gate**
  (`confirmRecoveryKey`, `cancelRecoveryKey`, `completeSetup`), checked
  explicitly alongside token equality, not inferred from it.

`confirmRecoveryKey` only ever accepts the current attempt's ceremony
token; `cancelRecoveryKey` clears state only when its token matches the
current attempt (cancelling a superseded token is a safe no-op, never
disturbing whatever has since become active); and `completeSetup` only
ever accepts the commit token bound to the current attempt, rejected
before any hashing or transaction if it doesn't match — which is what
makes "a stale commit token can create the wrong user or hit a
foreign-key failure" structurally impossible rather than merely unlikely.
The active attempt is cleared only once a commit truly succeeds (via
`runAppTransaction`'s `afterCommit`), so a rolled-back attempt remains
valid and retryable with the exact same commit token.

**IPC surface (`src/shared/ipc/setup.ts`, `registerSetupHandlers.ts`).**
Five channels, all under `setup:`, added to the preload bridge alongside
Slice 2's `getAppInfo`: `get-status`, `prepare-recovery-key`,
`confirm-recovery-key`, `cancel-recovery-key`, `complete`. Every handler
re-validates the sender frame and its own input shape independently of
whatever the renderer already checked; `prepare-recovery-key` and
`confirm-recovery-key` additionally re-check first-run status before doing
anything (`cancel-recovery-key` deliberately does not — cancelling an
in-memory ceremony is harmless in every database state). Errors crossing
this boundary are always one of four fixed codes
(`setup_already_complete` / `invalid_input` / `recovery_confirmation_invalid`
/ `unexpected_error`) — never a raw exception message, matching this
codebase's established defense-in-depth posture for every other trust
boundary.

**Renderer (`src/renderer/src/setup/`).** `App.tsx` asks the main process
for first-run status on mount and renders exactly one of three things: the
setup wizard, the existing Slice 1 shell (only once `setup_complete`), or
a plain `InconsistentStateScreen` with no developer/database terminology
— a failed status check is treated the same as `inconsistent_state`,
failing closed rather than guessing. The wizard itself is six stages
(company details, currency confirmation, Owner account, recovery-key
display, recovery-key confirmation, completion) driven by plain React
state in one `SetupWizard` component — no new state-management dependency.
Currency confirmation is a read-only confirmation that USD is the
functional currency (a frozen architectural decision, now exported as
`FUNCTIONAL_CURRENCY_ID`), not a picker among the other seeded reference
currencies. The recovery key's plaintext exists in renderer state only
between preparation and the moment the person checks "I have saved this
key" — discarded from state at that exact point, never written to
`localStorage`/`sessionStorage`/the URL/the console, and re-entry is
verified server-side only, never by a client-side string comparison
(confirmed directly against a real, unmocked Electron renderer: the
plaintext is genuinely absent from the DOM by the confirmation stage, not
merely hidden). Setup ends on a completion screen confirming success —
deliberately no automatic session or login, since the plan's own flow ends
at "completion" and ordinary login/navigation belongs to Slice 9.

### Users, roles & login

**Reuses every Slice 7 primitive unchanged** — `authenticate`,
`createSessionManager`, `can`/`assertCan`, `userService`'s
create/deactivate/reactivate functions — none of them modified for this
slice. `src/main/users/loginService.ts` and `userManagementService.ts` are
new, narrow orchestration layers on top, matching the plan's own
description ("`loginService` wraps Slice 7's primitives"). One detail
worth flagging explicitly, since it's easy to get backward: `roles.id`
(the stable `'role_owner'`-shaped primary key used only for the
`user_roles.role_id` foreign key) and `roles.code` (the lower-case value
`authorizationService.ROLE_CODES` actually expects, e.g. `'owner'`) are
two different columns — every authorization-relevant read in this slice
goes through one shared helper, `getFreshRoleCodesForUser`, that reads
`roles.code` specifically, confirmed directly against a real database
before relying on it anywhere else.

**No session id ever reaches the renderer.** `sessionManager`'s sessions
are keyed by an opaque id, but nothing in this slice's IPC surface accepts
or returns one — `loginService` tracks exactly one bounded
`currentSessionId` internally (mirroring `firstRunSetupService`'s
`ActiveAttempt` pattern from Slice 8) and every operation
(`getSessionState`, `unlock`, `logout`, `touch`) implicitly targets
"whatever the current session is." This removes an entire class of
"supply someone else's session id" risk by construction, not convention —
there is no parameter for it to forge.

An approval round after the initial implementation identified six gaps,
each fixed and independently verified by reverting the fix and confirming
the specific new test failed before restoring it:

1. **Exactly-one-Owner invariant preserved.** `createAdditionalUser`'s
   `roleCode` is typed `'executive' | 'operations' | 'finance'` at the
   service layer — `'owner'` is not a representable value, not merely a
   runtime-rejected one. `deactivateAdditionalUser` checks the _target's_
   fresh role codes and refuses if they include `'owner'` — one check that
   covers both "cannot deactivate the Owner" and "the Owner cannot
   deactivate themselves," since only the Owner can ever reach that code
   path at all. There is deliberately no "change an existing user's role"
   operation anywhere in this slice — the simplest way to guarantee the
   Owner's role can never change, and not something the approved plan
   asked for.
2. **Deactivation invalidates every session for that user, and every
   session read rechecks the user is still active.** `loginService`
   resolves "is there a current, genuinely usable session" through one
   function, `resolveLiveSession`, on every single call — never a cached
   field: it re-fetches the user from SQLite and requires `isActive`,
   tearing down stale state immediately if not. Verified this is _not_
   redundant with the explicit `sessionManager.invalidateAllForUser` call
   `userManagementService` makes after a successful deactivation: the
   first version of that test checked `loginService.getSessionState`,
   which passed even with the explicit call removed (because
   `resolveLiveSession`'s own independent recheck already produced the
   same visible result) — a genuinely isolating test had to bypass
   `loginService` entirely and check `sessionManager`'s raw session data
   directly.
3. **Every users/roles authorization check reads role codes fresh from
   SQLite** — never `sessionManager`'s own cached `roleCodes` (set once at
   login) — via the same `getFreshRoleCodesForUser` helper `loginService`
   uses for `isOwner`. Verified by mutating `user_roles` directly (there is
   no legitimate way to change a role once assigned) and confirming the
   very next authorization check reflects it immediately.
4. **User creation hashes outside SQLite, then revalidates immediately
   before the transaction.** Mirrors Slice 8's `firstRunSetupService`
   pattern exactly: validate → resolve caller + assert `users.manage`
   (fresh) → `await hashPassword(...)` (a real ~300-800ms Argon2id
   computation, outside any transaction) → re-resolve caller + re-assert
   (fresh, again) → only then `runAppTransaction`. Verified directly with
   a paused-hash test: deactivating the calling Owner while their own
   `createAdditionalUser` hash is still in flight correctly rejects the
   completion and writes no row.
5. **Main-process idle locking is visible in the renderer via polling, not
   a push event.** `AuthenticatedApp` polls `getSessionState()` on a fixed
   interval (5s) — deliberately the same request/response `invoke` style
   every existing IPC channel already uses, rather than introducing a
   first push-event channel for this alone. `getSessionState` is a pure
   read (`sessionManager.get`, never `.touch`); a separate renderer
   activity listener calls `touchSession()`, explicitly throttled (10s)
   independent of how often the underlying DOM events fire — verified with
   a fake-timer test that the poll alone never touches the idle clock, and
   a second test (reverting the polling `setInterval` entirely and
   confirming the specific test then fails) that the poll is what actually
   surfaces an autonomous main-process lock with zero user action.
   `SessionState`'s `locked` variant always carries `displayName`, so the
   lock screen never needs a second round-trip.
6. **Explicit session lifecycle mechanics.** `login()` destroys any
   existing `currentSessionId` before creating a new one — one-current-
   session replacement, never two sessions simultaneously "current."
   `resolveLiveSession` clears `currentSessionId` the moment
   `sessionManager.get` reports hard-expiry (the existing, untouched 30-
   minute `idleTimeoutMs` safety net), so that cleanup is visible to this
   slice's own state, not silently ignored. `loginService.dispose()` calls
   `clearInterval` on the idle-lock timer — wired into `main/index.ts`'s
   `before-quit` handler and every test's teardown — and
   `startIdleLockTimer` is idempotent (disposing any previous timer before
   installing a new one), verified directly by spying on the global
   `clearInterval`.

**IPC surface.** Ten channels total, `login:*` (five: `attempt`,
`get-session-state`, `unlock`, `logout`, `touch`) and `users:*`/`roles:*`
(five: `list`, `create`, `deactivate`, `reactivate`,
`list-assignable`). There is deliberately no `login:lock` channel — no
manual "lock now" button is in this slice's scope, so locking stays a
purely internal, main-process-timer-driven operation, one fewer renderer-
invocable mutation. Every `users:*` mutation is re-authorized fresh,
server-side, from live SQLite role data on every call — the preload layer
itself carries no `isOwner` flag and grants nothing by itself, satisfying
"enforced in the main process regardless of what the renderer shows" at
the letter as well as the spirit.

**Renderer.** `App.tsx`'s `setup_complete` branch now renders
`AuthenticatedApp` (not the old placeholder shell directly), which owns
its own small state machine — `logged_out` → `LoginScreen`, `locked` →
`LockScreen` (only ever the signed-in user's name and a password field,
never a way to switch accounts), `active` → `AuthenticatedShell` (a thin
header — signed-in name, a Users & Roles link shown only when
`isOwner`, a logout control — wrapping the still-unchanged Slice 1
placeholder content and, when navigated to, `UsersAndRolesScreen`).

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
