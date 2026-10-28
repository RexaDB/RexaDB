import { Effect } from "effect";
import { DbError } from "./effect/errors";

type ConnectionActionNames =
  | "addConnection" | "getConnections" | "getConnection" | "deleteConnectionsByPrefix"
  | "deleteConnection" | "updateConnection" | "listConnectionGroups" | "addConnectionGroup"
  | "renameConnectionGroup" | "deleteConnectionGroup" | "reorderConnections"
  | "listConnectionTags" | "saveConnectionTag" | "deleteConnectionTag"
  | "getConnectionWorkspaceId" | "saveConnectionWorkspaceId" | "testConnection";
type ConnectionActions = Pick<typeof import("../lib/db/actions-core"), ConnectionActionNames>;

function fromConnectionAction<A>(operation: string, evaluate: () => Promise<A>) {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new DbError({
      message: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
      status: 500,
    }),
  });
}

export function createConnectionActionEffects(actions: ConnectionActions) {
  const wrap = <Name extends ConnectionActionNames>(name: Name) =>
    (...args: Parameters<ConnectionActions[Name]>) => fromConnectionAction(
      `Failed to ${name.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}`,
      () => (actions[name] as (...values: Parameters<ConnectionActions[Name]>) => Promise<Awaited<ReturnType<ConnectionActions[Name]>>>)(...args),
    );
  return {
    addConnection: wrap("addConnection"),
    getConnections: wrap("getConnections"),
    getConnection: wrap("getConnection"),
    deleteConnectionsByPrefix: wrap("deleteConnectionsByPrefix"),
    deleteConnection: wrap("deleteConnection"),
    updateConnection: wrap("updateConnection"),
    listConnectionGroups: wrap("listConnectionGroups"),
    addConnectionGroup: wrap("addConnectionGroup"),
    renameConnectionGroup: wrap("renameConnectionGroup"),
    deleteConnectionGroup: wrap("deleteConnectionGroup"),
    reorderConnections: wrap("reorderConnections"),
    listConnectionTags: wrap("listConnectionTags"),
    saveConnectionTag: wrap("saveConnectionTag"),
    deleteConnectionTag: wrap("deleteConnectionTag"),
    getConnectionWorkspaceId: wrap("getConnectionWorkspaceId"),
    saveConnectionWorkspaceId: wrap("saveConnectionWorkspaceId"),
    testConnection: wrap("testConnection"),
  };
}
