export function DiffTableHeader({ cols }: { cols: string[] }) {
  return (
    <thead>
      <tr className="bg-table-header-bg border-b border-studio-border">
        <th className="w-6 px-1 py-1 border-r border-studio-border/40" />
        {cols.map((c) => (
          <th
            key={c}
            className="text-left px-1.5 py-1 text-muted-foreground font-medium whitespace-nowrap border-r border-studio-border/40"
          >
            {c}
          </th>
        ))}
      </tr>
    </thead>
  );
}

export function DiffCell({
  value,
  highlight,
}: {
  value: unknown;
  highlight?: boolean;
}) {
  return (
    <td
      className="px-1.5 py-1 whitespace-nowrap overflow-hidden text-ellipsis max-w-[180px] border-r border-studio-border/30"
      style={{
        backgroundColor: highlight
          ? "rgba(239, 68, 68, 0.12)"
          : "transparent",
      }}
    >
      {value === null || value === undefined ? (
        <span className="text-muted-foreground/40 italic">NULL</span>
      ) : (
        String(value)
      )}
    </td>
  );
}
