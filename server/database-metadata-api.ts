import { Effect } from "effect";
import { DbError } from "./effect/errors";

const actionNames = [
  "fetchTableSecurityInfo", "fetchExtensions", "fetchTriggers", "fetchEnums", "fetchIndexes",
  "fetchPackages", "fetchSequences", "fetchSynonyms", "fetchDbLinks", "fetchMaterializedViews",
  "fetchRlsPolicies", "fetchPostgresRoles", "fetchSupabaseAuthUsers", "fetchSessions", "killSession",
  "cancelSessionQuery", "fetchLocks", "runAdvisorChecks", "fetchExplainPlan", "runDbBackup",
  "fetchViews", "fetchRedisKeys", "fetchFunctions",
] as const;

type MetadataActionName = typeof actionNames[number];
type MetadataActions = Pick<typeof import("../lib/db/actions-core"), MetadataActionName>;

function fromMetadataAction<A>(operation: string, evaluate: () => Promise<A>) {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new DbError({
      message: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
      status: 500,
    }),
  });
}

/** Effect facade for database metadata, session, advisor, and backup actions. */
export function createDatabaseMetadataEffects(actions: MetadataActions) {
  return Object.fromEntries(actionNames.map((name) => [name, (...args: any[]) =>
    fromMetadataAction(`Failed to ${name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}`, () =>
      (actions[name] as (...values: any[]) => Promise<unknown>)(...args),
    ),
  ])) as {
    [Name in MetadataActionName]: (...args: Parameters<MetadataActions[Name]>) => Effect.Effect<Awaited<ReturnType<MetadataActions[Name]>>, DbError>
  };
}
