/**
 * Sidebar view ids for extensions.
 * - `"extensions"` → all extension views
 * - `"extensions:<containerId>"` → views of one container (rail target)
 */
export function parseExtensionsSidebarView(
  view: string | null | undefined,
): { active: boolean; containerId?: string } {
  if (!view) return { active: false };
  if (view === "extensions") return { active: true };
  const prefix = "extensions:";
  if (view.startsWith(prefix) && view.length > prefix.length) {
    return { active: true, containerId: view.slice(prefix.length) };
  }
  return { active: false };
}

export function extensionsSidebarViewFor(containerId?: string): string {
  return containerId ? `extensions:${containerId}` : "extensions";
}
