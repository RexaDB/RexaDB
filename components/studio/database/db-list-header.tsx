"use client";

interface DbListHeaderProps {
  columns: string[];
  gridTemplateColumns: string;
}

export function DbListHeader({ columns, gridTemplateColumns }: DbListHeaderProps) {
  return (
    <div
      className="grid bg-muted/30 border-b border-border py-3 px-4"
      style={{ gridTemplateColumns }}
    >
      {columns.map((label, i) => (
        <span
          key={i}
          className="text-xs font-bold text-foreground/80 tracking-widest"
        >
          {label}
        </span>
      ))}
      <span></span>
    </div>
  );
}
