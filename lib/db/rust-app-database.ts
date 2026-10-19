import { isDesktopRuntime } from "@/lib/desktop";

/** Read the app-owned connection records through Tauri's Rust backend. */
export async function rustListAppConnections(): Promise<Record<string, any>[] | undefined> {
  if (!isDesktopRuntime()) return undefined;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<Record<string, any>[]>("app_database_list_connections");
  } catch {
    return undefined;
  }
}
