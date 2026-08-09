export type PgCompatTarget = "postgres" | "sqlite" | "mysql";

export type CompiledQuery = {
  query: string;
  params: any[];
};
