"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { DataTable, type TableColumn } from "@/components/data-table/components/data-table";
import {
  NeonAuthUserCreated,
  NeonAuthUserIdentity,
  NeonAuthUserStatus,
  type NeonAuthUser,
} from "./neon-auth-user-row";

const columns: TableColumn<NeonAuthUser>[] = [
  { key: "Display name", header: "User", sortable: true, width: "1.5fr", cell: (user) => <NeonAuthUserIdentity user={user} /> },
  { key: "__confirmed", header: "Status", sortable: true, width: "0.8fr", cell: (user) => <NeonAuthUserStatus user={user} />, sortValue: (user) => Number(user.__confirmed) },
  { key: "Providers", header: "Sign-in method", sortable: true, width: "0.9fr", cell: (user) => user.Providers || "Email" },
  { key: "__created_at_raw", header: "Created", sortable: true, align: "right", width: "0.8fr", cell: (user) => <NeonAuthUserCreated user={user} />, sortValue: (user) => user.__created_at_raw ?? "" },
];

interface NeonAuthUsersTableProps {
  rows: NeonAuthUser[];
  loading: boolean;
  emptyState: ReactNode;
}

export function NeonAuthUsersTable({ rows, loading, emptyState }: NeonAuthUsersTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setHeight(Math.floor(container.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="h-full min-h-0">
      <DataTable<NeonAuthUser>
        data={rows}
        columns={columns}
        getRowId={(user) => user.UID}
        defaultSort={{ key: "__created_at_raw", direction: "desc" }}
        height={height}
        loading={loading}
        emptyState={emptyState}
        className="h-full min-h-0"
      />
    </div>
  );
}
