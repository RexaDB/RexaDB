/** Reject internal placeholder values before a driver interprets them as DB URLs. */
export function assertUsableDatabaseConnectionString(connectionString: string): void {
  const value = String(connectionString || "").trim();
  if (/^dev:\/\/local(?:\/|$)/i.test(value)) {
    throw new Error(
      "This is an internal placeholder, not a database connection. Return to Connections and reopen a saved connection.",
    );
  }
}
