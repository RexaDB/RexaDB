import fs from "fs";
import path from "path";
import { resolveDbPath } from "./db-utils";

interface StoredAiChat {
  id: string;
  connectionId: number;
  userId: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface StoredAiChatMessage {
  id: string;
  chatId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
  metaJson?: string | null;
}

type ChatIndexEntry = {
  id: string;
  connectionId: number;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessage: string;
  messageCount: number;
};

type ChatFile = {
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: StoredAiChatMessage[];
};

function getChatDir(connectionId: number): string {
  const base = resolveDbPath("chats");
  const dir = path.join(path.dirname(base), "chats", String(connectionId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function chatFilePath(connectionId: number, chatId: string): string {
  return path.join(getChatDir(connectionId), `${chatId}.json`);
}

function indexPath(connectionId: number): string {
  return path.join(getChatDir(connectionId), "_index.json");
}

function loadIndex(connectionId: number): ChatIndexEntry[] {
  try {
    const raw = fs.readFileSync(indexPath(connectionId), "utf-8");
    return JSON.parse(raw) as ChatIndexEntry[];
  } catch {
    return [];
  }
}

function saveIndex(connectionId: number, entries: ChatIndexEntry[]): void {
  fs.writeFileSync(indexPath(connectionId), JSON.stringify(entries, null, 2), "utf-8");
}

function buildIndexEntry(
  chatId: string,
  connectionId: number,
  title: string,
  messages: StoredAiChatMessage[],
): ChatIndexEntry {
  const lastMsg = messages.filter(m => m.role === "user" || m.role === "assistant").pop();
  return {
    id: chatId,
    connectionId,
    title,
    createdAt: messages.length > 0 ? messages[0].timestamp : Date.now(),
    updatedAt: Date.now(),
    lastMessage: lastMsg ? lastMsg.content.slice(0, 120) : "",
    messageCount: messages.length,
  };
}

export function saveChatMessages(
  chatId: string,
  connectionId: number,
  title: string,
  messages: StoredAiChatMessage[],
): { success: true } {
  const file: ChatFile = {
    title,
    createdAt: messages.length > 0 ? messages[0].timestamp : Date.now(),
    updatedAt: Date.now(),
    messages,
  };
  fs.writeFileSync(chatFilePath(connectionId, chatId), JSON.stringify(file, null, 2), "utf-8");

  const index = loadIndex(connectionId);
  const existing = index.findIndex(e => e.id === chatId);
  const entry = buildIndexEntry(chatId, connectionId, title, messages);
  if (existing >= 0) {
    index[existing] = entry;
  } else {
    index.push(entry);
  }
  index.sort((a, b) => b.updatedAt - a.updatedAt);
  saveIndex(connectionId, index);

  return { success: true };
}

export function loadChatMessages(
  chatId: string,
  connectionId: number,
): { success: true; data: { title: string; messages: StoredAiChatMessage[] } } | { success: false; error: string } {
  try {
    const raw = fs.readFileSync(chatFilePath(connectionId, chatId), "utf-8");
    const file = JSON.parse(raw) as ChatFile;
    return { success: true, data: { title: file.title, messages: file.messages } };
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Chat not found" };
  }
}

export function listChats(
  connectionId: number,
): { success: true; data: StoredAiChat[] } {
  const index = loadIndex(connectionId);
  const chats: StoredAiChat[] = index.map(e => ({
    id: e.id,
    connectionId: e.connectionId,
    userId: null,
    title: e.title,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
  return { success: true, data: chats };
}

export function deleteChat(
  chatId: string,
  connectionId: number,
): { success: true } | { success: false; error: string } {
  const fp = chatFilePath(connectionId, chatId);
  try {
    fs.unlinkSync(fp);
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Failed to delete chat" };
  }
  const index = loadIndex(connectionId);
  const filtered = index.filter(e => e.id !== chatId);
  saveIndex(connectionId, filtered);
  return { success: true };
}
