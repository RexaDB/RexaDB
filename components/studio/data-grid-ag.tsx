import React from "react";
import { DataGrid as GlideDataGrid } from "./grid-glide/data-grid";
import type { DataGridProps } from "./grid-glide/types";

/**
 * Every consumer in the app reaches the grid through this file, so this is
 * the single entry point for the Glide Data Grid. The legacy DOM grid
 * (components/studio/data-grid.tsx) has been removed; this wrapper previously
 * A/B-tested it against Glide via `localStorage["studio:grid-engine"]`.
 */
export const DataGridAg = React.memo(function DataGridAg(
  props: DataGridProps,
) {
  return <GlideDataGrid {...props} />;
});
