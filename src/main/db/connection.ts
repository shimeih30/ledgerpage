import Database from 'better-sqlite3'

/**
 * Busy timeout for SQLite's own lock-wait behavior. LedgerPage is a
 * single-writer desktop app (one connection per running instance), so
 * this only matters for the brief window around a WAL checkpoint or a
 * future backup-in-progress read; 5 seconds is a generous, standard
 * default for that case without risking the app appearing to hang.
 */
const BUSY_TIMEOUT_MS = 5000

export interface DatabaseConnectionOptions {
  busyTimeoutMs?: number
}

function isValidBusyTimeout(value: number): boolean {
  // Number.isInteger already excludes NaN and +/-Infinity, so this covers
  // "finite, non-negative integer" in one check; the non-negative check
  // is separate since a negative integer is still an integer.
  return Number.isInteger(value) && value >= 0
}

/**
 * Opens (creating if necessary) the single managed SQLite connection for
 * this app instance, with every required pragma applied before it is
 * handed back.
 *
 * - journal_mode = WAL: required by the approved architecture.
 * - foreign_keys = ON: SQLite disables this by default per connection;
 *   it must be set explicitly every time a connection is opened.
 * - busy_timeout: avoids an immediate "database is locked" error during
 *   the brief windows where SQLite itself needs to wait.
 *
 * busyTimeoutMs is validated before anything is opened — an invalid value
 * throws immediately and never creates a database file. If the file opens
 * successfully but applying any of the required pragmas fails (e.g. the
 * file exists but isn't a valid SQLite database), the connection is
 * closed before the error is rethrown, rather than handing back a
 * half-configured connection.
 *
 * Takes an explicit file path rather than resolving one itself, so it has
 * no Electron dependency and can be exercised directly in tests against a
 * disposable temporary file.
 */
export function createDatabaseConnection(
  databaseFilePath: string,
  options: DatabaseConnectionOptions = {}
): Database.Database {
  const busyTimeoutMs = options.busyTimeoutMs ?? BUSY_TIMEOUT_MS
  if (!isValidBusyTimeout(busyTimeoutMs)) {
    throw new RangeError(
      `busyTimeoutMs must be a finite, non-negative integer; received ${String(busyTimeoutMs)}`
    )
  }

  const db = new Database(databaseFilePath)

  try {
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma(`busy_timeout = ${busyTimeoutMs}`)
  } catch (error) {
    db.close()
    throw error
  }

  return db
}
