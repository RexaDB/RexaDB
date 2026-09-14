"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRight, Loader2 } from "@/lib/icon-theme/lucide-react";
import { useExtensions } from "@/lib/extensions/react";
import { ExtensionWebview } from "./extension-webview";
import type { RexaTreeItem } from "@/lib/extensions/types";
import { cn } from "@/lib/utils";

function TreeNode({
  viewId,
  item,
  depth,
}: {
  viewId: string;
  item: RexaTreeItem;
  depth: number;
}) {
  const { expandTree, executeCommand } = useExtensions();
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<RexaTreeItem[] | null>(item.children ?? null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (!item.collapsible) {
      if (item.command) await executeCommand(item.command.command, ...(item.command.args ?? []));
      return;
    }
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (children === null) {
      setLoading(true);
      const next = await expandTree(viewId, item.id);
      setChildren(next);
      setLoading(false);
    }
  }, [children, executeCommand, expandTree, item, open, viewId]);

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[12px] hover:bg-muted/60"
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {item.collapsible ? (
          <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
        ) : (
          <span className="w-3" />
        )}
        <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
        {item.description && (
          <span className="truncate text-[11px] text-muted-foreground">{item.description}</span>
        )}
        {loading && <Loader2 className="size-3 animate-spin" />}
      </button>
      {open && (children ?? []).map((child) => (
        <TreeNode key={child.id} viewId={viewId} item={child} depth={depth + 1} />
      ))}
    </div>
  );
}

/** VS Code-like sidebar view: tree (TreeDataProvider) or webview. */
export function ExtensionView({ viewId }: { viewId: string }) {
  const { views, treeNodes, webviewHtml, expandTree } = useExtensions();
  const view = views.find((v) => v.viewId === viewId);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (view?.type === "tree" && !treeNodes[viewId]) {
      setLoading(true);
      expandTree(viewId, undefined).finally(() => setLoading(false));
    }
  }, [view?.type, viewId, treeNodes, expandTree]);

  if (!view) return <div className="p-3 text-xs text-muted-foreground">Unknown view: {viewId}</div>;
  if (view.type === "webview") {
    const html = webviewHtml[viewId] ?? view.html ?? "<html><body style='font-family:sans-serif;padding:12px'>Empty webview</body></html>";
    // Sidebar webviews are compact, bounded-height content (like VS Code's
    // sidebar WebviewViews) — never full-height. Full-height rendering lives
    // in editor tabs (`ExtensionTabView`) and floating panels
    // (`ExtensionPanelHost`), which is where tab content belongs.
    return (
      <div className="h-64 overflow-hidden">
        <ExtensionWebview viewId={viewId} html={html} extensionId={view.extensionId} />
      </div>
    );
  }
  const roots = treeNodes[viewId] ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1">
      {loading && roots.length === 0 ? (
        <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> Loading…
        </div>
      ) : roots.length === 0 ? (
        <div className="p-3 text-xs text-muted-foreground">No items.</div>
      ) : (
        roots.map((item) => <TreeNode key={item.id} viewId={viewId} item={item} depth={0} />)
      )}
    </div>
  );
}
