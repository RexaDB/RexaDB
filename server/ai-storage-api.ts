import { Effect } from "effect";
import { DbError } from "./effect/errors";

type AiStorageActionNames =
  | "getGlobalAiSettings"
  | "saveGlobalAiSettings"
  | "listAiChats"
  | "getAiChatMessages"
  | "ensureAiChat"
  | "appendAiChatMessage"
  | "updateAiChatMessageContent"
  | "updateAiChatMessageMeta"
  | "deleteAiChatMessagesAfter";

type AiStorageActions = Pick<typeof import("../lib/db/actions-core"), AiStorageActionNames>;

function fromAiStorage<A>(operation: string, evaluate: () => Promise<A>) {
  return Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new DbError({
      message: `${operation}: ${cause instanceof Error ? cause.message : String(cause)}`,
      status: 500,
    }),
  });
}

/** Effect facade for actions-core AI settings and chat persistence APIs. */
export function createAiStorageEffects(actions: AiStorageActions) {
  return {
    getSettings: (...args: Parameters<AiStorageActions["getGlobalAiSettings"]>) => fromAiStorage(
      "Failed to read AI settings",
      () => actions.getGlobalAiSettings(...args),
    ),
    saveSettings: (...args: Parameters<AiStorageActions["saveGlobalAiSettings"]>) => fromAiStorage(
      "Failed to save AI settings",
      () => actions.saveGlobalAiSettings(...args),
    ),
    listChats: (...args: Parameters<AiStorageActions["listAiChats"]>) => fromAiStorage(
      "Failed to list AI chats",
      () => actions.listAiChats(...args),
    ),
    getChatMessages: (...args: Parameters<AiStorageActions["getAiChatMessages"]>) => fromAiStorage(
      "Failed to fetch AI chat messages",
      () => actions.getAiChatMessages(...args),
    ),
    ensureChat: (...args: Parameters<AiStorageActions["ensureAiChat"]>) => fromAiStorage(
      "Failed to ensure AI chat",
      () => actions.ensureAiChat(...args),
    ),
    appendMessage: (...args: Parameters<AiStorageActions["appendAiChatMessage"]>) => fromAiStorage(
      "Failed to append AI chat message",
      () => actions.appendAiChatMessage(...args),
    ),
    updateMessageContent: (...args: Parameters<AiStorageActions["updateAiChatMessageContent"]>) => fromAiStorage(
      "Failed to update AI chat message content",
      () => actions.updateAiChatMessageContent(...args),
    ),
    updateMessageMeta: (...args: Parameters<AiStorageActions["updateAiChatMessageMeta"]>) => fromAiStorage(
      "Failed to update AI chat message metadata",
      () => actions.updateAiChatMessageMeta(...args),
    ),
    deleteMessagesAfter: (...args: Parameters<AiStorageActions["deleteAiChatMessagesAfter"]>) => fromAiStorage(
      "Failed to delete AI chat messages",
      () => actions.deleteAiChatMessagesAfter(...args),
    ),
  };
}
