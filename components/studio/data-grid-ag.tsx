import React from "react";
import { DataGrid as DomDataGrid } from "./data-grid";
import { DataGrid as GlideDataGrid } from "./grid-glide/data-grid";
import type { DataGridProps } from "./grid-glide/types";

/**
 * Dev-only rollout switch for the Glide Data Grid rewrite (see
 * /Users/virus/.claude/plans/nifty-noodling-mochi.md). Every consumer in
 * the app reaches the grid through this file (or `sql-editor.tsx`'s direct
 * import), so flipping `localStorage["studio:grid-engine"]` to "glide" lets
 * any of them be A/B-tested against the legacy DOM grid with no per-consumer
 * code changes. Remove this switch once the Glide implementation is
 * validated end-to-end and cut over as the sole path.
 */
function useGridEngine(): "dom" | "glide" {
  const [engine, setEngine] = React.useState<"dom" | "glide">("dom");
  React.useEffect(() => {
    try {
      setEngine(
        window.localStorage.getItem("studio:grid-engine") === "glide"
          ? "glide"
          : "dom",
      );
    } catch {
      // localStorage unavailable — stay on the legacy grid.
    }
  }, []);
  return engine;
}

export const DataGridAg = React.memo(function DataGridAg(
  props: DataGridProps,
) {
  const engine = useGridEngine();
  return engine === "glide" ? (
    <GlideDataGrid {...props} />
  ) : (
    <DomDataGrid {...props} />
  );
});
