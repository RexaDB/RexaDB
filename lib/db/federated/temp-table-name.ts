export function getFederatedTempTableName(alias: string, table: string) {
  const base = `${alias}__${table}`.replace(/[^a-zA-Z0-9_]/g, "_");
  return `federated_${base}`;
}
