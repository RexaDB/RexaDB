import { type FormEvent } from "react";
import { setStudioConfig } from "@/lib/studio-backend/auth-store";
import { studioApi } from "@/lib/studio-backend/api-client";

export function trimStudioUrl(url: string): string | null {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed || null;
}

function onSetStudioUrl(
  e: FormEvent,
  studioUrl: string,
  setStudioUrl: (v: string) => void,
  onValid: () => void,
) {
  e.preventDefault();
  const trimmed = trimStudioUrl(studioUrl);
  if (!trimmed) return;
  setStudioUrl(trimmed);
  onValid();
}

export async function acceptInvite(
  studioUrl: string,
  token: string,
  name: string,
  email: string,
) {
  const res = await studioApi.post<{
    data: { userId: string; studioToken: string };
  }>("/invites/accept", {
    token: token.trim(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
  });
  await setStudioConfig({
    studioUrl,
    userId: res.data.userId,
    studioToken: res.data.studioToken,
  });
  return res.data;
}
