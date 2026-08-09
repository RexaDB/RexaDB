"use client";

import { apiFetch } from "@/lib/api-base";
import type { StoredAiChat, StoredAiChatMessage } from "@/lib/ai/types";

export async function listStudioChats(connectionId: number): Promise<{ success: boolean; data?: StoredAiChat[]; error?: string }> {
  try {
    const res = await apiFetch(`/api/studio/chats?connectionId=${connectionId}`);
    const body = await res.json();
    return body;
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Failed to list chats" };
  }
}

export async function getStudioChatMessages(chatId: string, connectionId: number): Promise<{ success: boolean; data?: StoredAiChatMessage[]; error?: string }> {
  try {
    const res = await apiFetch(`/api/studio/chats/${encodeURIComponent(chatId)}?connectionId=${connectionId}`);
    const body = await res.json();
    if (body.success && body.data) {
      return { success: true, data: body.data.messages };
    }
    return body;
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Failed to load chat messages" };
  }
}

export async function saveStudioChatMessages(
  chatId: string,
  connectionId: number,
  title: string,
  messages: StoredAiChatMessage[],
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await apiFetch(`/api/studio/chats/${encodeURIComponent(chatId)}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId, title, messages }),
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Failed to save chat" };
  }
}

export async function deleteStudioChat(chatId: string, connectionId: number): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await apiFetch(`/api/studio/chats/${encodeURIComponent(chatId)}?connectionId=${connectionId}`, {
      method: "DELETE",
    });
    return await res.json();
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Failed to delete chat" };
  }
}
