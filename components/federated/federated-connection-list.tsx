"use client";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Connection } from "@/lib/db/schema";
import type { FederatedDraft } from "./federated-connection-types";
import {
  getFederatedConnectionLabel,
  isFederatedConnectionSelected,
  isFederatedSupportedConnection,
} from "./federated-connection-utils";

type Props = {
  connections: Connection[];
  value: FederatedDraft[];
  onToggle: (connection: Connection, checked: boolean) => void;
};

export function FederatedConnectionList({
  connections,
  value,
  onToggle,
}: Props) {
  const eligibleConnections = connections.filter(
    isFederatedSupportedConnection,
  );
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Choose the saved SQL connections to include in this federated
        connection.
      </p>
      {!eligibleConnections.length ? (
        <div className="rounded-lg border border-dashed border-border/60 px-3 py-4 text-sm text-muted-foreground">
          No supported saved SQL connections found. Add a Postgres, MySQL,
          SQLite, or libSQL connection first.
        </div>
      ) : null}
      <ScrollArea className="h-56 rounded-lg border border-border/60">
        <div className="space-y-2 p-2">
          {eligibleConnections.map((connection) => {
            const checked = isFederatedConnectionSelected(connection.id, value);
            return (
              <label
                key={connection.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-border/60 px-3 py-3 transition-colors hover:bg-muted/30"
              >
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) =>
                    onToggle(connection, next === true)
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {connection.name}
                    </span>
                    <Badge variant="outline" className="uppercase">
                      {getFederatedConnectionLabel(connection.connectionString)}
                    </Badge>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
