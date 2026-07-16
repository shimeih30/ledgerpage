import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

/**
 * The exact type Drizzle's own `.transaction()` callback receives —
 * extracted directly from that method's signature rather than
 * hand-written, so it can never drift from what Drizzle actually
 * provides. Used where a function must only ever be called from inside
 * an active, caller-controlled transaction (e.g. numberingService's
 * allocateNext) — passing the top-level database instead is a
 * compile-time error, not just a documented convention.
 */
export type AppTransaction = Parameters<Parameters<BetterSQLite3Database['transaction']>[0]>[0]

/**
 * Anything Drizzle-query-capable: either the top-level database or an
 * active transaction. Used by services (e.g. companyService) that may
 * reasonably be called standalone or composed into a larger transaction,
 * where the stricter AppTransaction-only typing isn't required.
 */
export type AppDb = BetterSQLite3Database | AppTransaction
