"use client";

import { DataTable, type TableColumn } from "@/components/data-table/components/data-table";
import type { ReactNode } from "react";
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
  toolbar: ReactNode;
  footer: ReactNode;
  emptyState: ReactNode;
}

export function NeonAuthUsersTable({ rows, loading, toolbar, footer, emptyState }: NeonAuthUsersTableProps) {
  return (
    <DataTable<NeonAuthUser>
      data={rows}
      columns={columns}
      getRowId={(user) => user.UID}
      defaultSort={{ key: "__created_at_raw", direction: "desc" }}
      height={440}
      loading={loading}
      toolbar={toolbar}
      footer={footer}
      emptyState={emptyState}
    />
  );
}
