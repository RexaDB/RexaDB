declare module "bun:sqlite" {
  interface DatabaseOptions {
    create?: boolean;
    readwrite?: boolean;
    strict?: boolean;
  }
  export class Database {
    constructor(path: string, options?: DatabaseOptions);
    run(sql: string, ...params: unknown[]): void;
    query(sql: string): { all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown };
    prepare(sql: string): { reader: boolean; all(...params: unknown[]): unknown[]; get(...params: unknown[]): unknown; run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }; finalize(): void };
    close(): void;
  }
}
