"use client";

import { Badge } from "@/components/ui/badge";
import {
  DataTable,
  type TableColumn,
} from "@/components/data-table/components/data-table";
import type { AuthProviderConfig } from "@/lib/studio/auth-provider-types";

interface AuthCustomProvidersTableProps {
  providers: AuthProviderConfig[];
  onManage: (provider: AuthProviderConfig) => void;
}

const columns: TableColumn<AuthProviderConfig>[] = [
  {
    key: "name",
    header: "Name",
    sortable: true,
    width: "1.2fr",
    cell: (provider) => (
      <span className="block truncate font-medium" title={provider.name}>
        {provider.name}
      </span>
    ),
  },
  {
    key: "identifier",
    header: "Identifier",
    sortable: true,
    width: "1.2fr",
    cell: (provider) => (
      <span className="block truncate text-muted-foreground" title={provider.identifier}>
        {provider.identifier}
      </span>
    ),
  },
  {
    key: "provider_type",
    header: "Type",
    sortable: true,
    width: "0.8fr",
    cell: (provider) => (
      <span className="block truncate text-muted-foreground">
        {provider.provider_type}
      </span>
    ),
  },
  {
    key: "enabled",
    header: "Enabled",
    width: "0.7fr",
    cell: (provider) => (
      <Badge variant={provider.enabled ? "success" : "outline"}>
        {provider.enabled ? "Enabled" : "Disabled"}
      </Badge>
    ),
    sortValue: (provider) => (provider.enabled ? 1 : 0),
  },
];

export function AuthCustomProvidersTable({
  providers,
  onManage,
}: AuthCustomProvidersTableProps) {
  if (!providers.length) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        No custom providers yet.
      </div>
    );
  }

  return (
    <div className="p-6">
      <DataTable<AuthProviderConfig>
        data={providers}
        columns={columns}
        getRowId={(provider) => provider.id}
        onRowClick={(provider) => onManage(provider)}
      />
    </div>
  );
}
