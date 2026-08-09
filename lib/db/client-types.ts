export type QueryResult<T = any> = {
  rows: T[];
  fields: Array<{ name: string; dataTypeID: number; dataTypeName: string }>;
  rowCount: number;
};
