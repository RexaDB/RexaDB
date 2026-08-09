import React from "react";
import { DataGrid } from "./data-grid";

type DataGridAgProps = React.ComponentProps<typeof DataGrid>;

export const DataGridAg = React.memo(function DataGridAg(props: DataGridAgProps) {
  return <DataGrid {...props} />;
});
