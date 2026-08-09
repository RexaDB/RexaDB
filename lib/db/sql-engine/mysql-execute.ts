type MysqlExecutor = (connectionString: string, query: string, params?: any[]) => Promise<any>;

export function getMysqlExecutor() {
  const override = (globalThis as { __mysqlExecuteTestState?: { executeMysqlQuery?: MysqlExecutor } })
    .__mysqlExecuteTestState?.executeMysqlQuery;
  if (override) return override;
  return import("../mysql-client").then((mod) => mod.executeMysqlQuery);
}

export async function executeMysqlSqlEngineQuery(
  connectionString: string,
  query: string,
  params: any[] = []
) {
  const executeMysqlQuery = await getMysqlExecutor();
  return await executeMysqlQuery(connectionString, query, params);
}
