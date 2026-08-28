import { API_BASE } from "@/lib/api-base";

export interface NeonCliDetectResult {
  installed: boolean;
  version?: string;
  path?: string;
}

export async function detectNeonCli(): Promise<NeonCliDetectResult> {
  try {
    const res = await fetch(`${API_BASE}/api/neon-cli/detect`, { method: "POST" });
    if (!res.ok) return { installed: false };
    return (await res.json()) as NeonCliDetectResult;
  } catch {
    return { installed: false };
  }
}
