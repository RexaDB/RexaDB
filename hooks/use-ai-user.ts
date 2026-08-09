"use client";

import { useAuthState } from "@/hooks/use-auth-state";

interface AiUserState {
  userId: string | null;
  userName: string;
}

export function useAiUser(): AiUserState {
  const { displayName, userId } = useAuthState();

  return {
    userId,
    userName: displayName,
  };
}
