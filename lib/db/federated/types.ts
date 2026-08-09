export type FederatedSource = {
  alias: string;
  connectionId: number;
  namespace?: string;
};

export type FederatedConfig = {
  version: 1;
  sources: FederatedSource[];
};

export type FederatedTableRef = {
  alias: string;
  inputSchema: string;
  table: string;
  namespace: string;
  tempTable: string;
};
