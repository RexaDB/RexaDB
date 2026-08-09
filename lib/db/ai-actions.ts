import type { GlobalAiSettings, StoredAiChatMessage } from "./actions-core";

export type { StoredAiChatMessage };

import {
  getGlobalAiSettings as _getGlobalAiSettings,
  getAiChatMessages as _getAiChatMessages,
  ensureAiChat as _ensureAiChat,
  appendAiChatMessage as _appendAiChatMessage,
  updateAiChatMessageContent as _updateAiChatMessageContent,
  deleteAiChatMessagesAfter as _deleteAiChatMessagesAfter,
} from "./actions-core";

export async function getGlobalAiSettings(ensureCoreTables: () => Promise<void>) {
  await ensureCoreTables();
  return _getGlobalAiSettings();
}

export async function getAiChatMessages(chatId: string, ensureCoreTables: () => Promise<void>) {
  await ensureCoreTables();
  return _getAiChatMessages(chatId);
}

export async function ensureAiChat(
  payload: { chatId: string; connectionId: number; userId?: string | null; title?: string; sourcePrompt?: string },
  ensureCoreTables: () => Promise<void>,
  ensureConnectionExists: (connectionId: number) => Promise<void>,
) {
  await ensureCoreTables();
  await ensureConnectionExists(payload.connectionId);
  return _ensureAiChat(payload);
}

export async function appendAiChatMessage(payload: StoredAiChatMessage, ensureCoreTables: () => Promise<void>) {
  await ensureCoreTables();
  return _appendAiChatMessage(payload);
}

export async function updateAiChatMessageContent(
  payload: { id: string; chatId: string; content: string; timestamp?: number },
  ensureCoreTables: () => Promise<void>,
) {
  await ensureCoreTables();
  return _updateAiChatMessageContent(payload);
}

export async function deleteAiChatMessagesAfter(payload: { chatId: string; timestamp: number }, ensureCoreTables: () => Promise<void>) {
  await ensureCoreTables();
  return _deleteAiChatMessagesAfter(payload);
}
