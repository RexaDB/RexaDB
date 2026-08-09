export function dockerSetupNote() {
  return [
    "Docker containers are required for this test.",
    "Postgres:",
    "docker run --name rexadb-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=rexadb_test -p 5432:5432 -d postgres:16",
    "MySQL:",
    "docker run --name rexadb-mysql -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=rexadb_test -p 3306:3306 -d mysql:8",
  ].join("\n");
}

export async function requireDockerDbOrSkip(
  t: { skip: (message?: string) => void },
  sqlEngine: { executeSqlEngineQuery: (connectionString: string, query: string) => Promise<unknown> },
  connectionString: string,
  probeQuery: string
) {
  try {
    await sqlEngine.executeSqlEngineQuery(connectionString, probeQuery);
    return true;
  } catch (error) {
    const message = String((error as Error)?.message || error || "");
    t.skip(`${dockerSetupNote()}\n\nConnection error: ${message}`);
    return false;
  }
}
