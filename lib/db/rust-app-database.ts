import { isDesktopRuntime } from "@/lib/desktop";

export type RustAppConnectionRead =
  | { available: false }
  | { available: true; success: true; connections: Record<string, any>[] }
  | { available: true; success: false; error: string };

/** Read app-owned connection rows through Tauri and preserve backend errors. */
export async function rustListAppConnections(): Promise<RustAppConnectionRead> {
  if (!isDesktopRuntime()) return { available: false };
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const connections = await invoke<Record<string, any>[]>("app_database_list_connections");
    return { available: true, success: true, connections };
  } catch (cause) {
    return {
      available: true,
      success: false,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  }
}
