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

## Current status: M1, Slice 1

This repository currently contains **only the runnable application shell**:
an Electron window that loads a static React screen.

**Intentionally absent at this stage:** IPC beyond an empty preload stub,
database access, authentication, and all business logic. These are
introduced in later slices of Milestone 1, in the order defined in the
project's implementation plan.

The current Electron window configuration is **explicitly temporary**.
Slice 2 will harden it with `contextIsolation`, disabled `nodeIntegration`,
`sandbox`, an allow-listed `preload`/`contextBridge` boundary, a Content
Security Policy, and navigation restrictions, before any real capability is
added.

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
