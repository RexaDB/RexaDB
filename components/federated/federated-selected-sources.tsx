"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Connection } from "@/lib/db/schema";
import { Trash2 } from "@/lib/icon-theme/lucide-react";
import type { FederatedDraft } from "./federated-connection-types";
import {
  getFederatedDraftError,
  sanitizeFederatedAlias,
} from "./federated-connection-utils";

type Props = {
  connections: Connection[];
  value: FederatedDraft[];
  onChange: (next: FederatedDraft[]) => void;
};

export function FederatedSelectedSources({
  connections,
  value,
  onChange,
}: Props) {
  const updateRow = (index: number, patch: Partial<FederatedDraft>) => {
    onChange(
      value.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };
  const removeRow = (connectionId: number) =>
    onChange(value.filter((row) => row.connectionId !== connectionId));
  return (
    <div className="space-y-3">
      {value.map((row, index) => {
        const connection = connections.find(
          (item) => item.id === row.connectionId,
        );
        return (
          <div
            key={row.connectionId}
            className="space-y-2 rounded-lg border border-border/60 p-3"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {connection?.name || "Unknown connection"}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => removeRow(row.connectionId)}
                className="h-9 w-9"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-[1fr_1fr] gap-2">
              <Input
                placeholder="alias"
                value={row.alias}
                onChange={(e) =>
                  updateRow(index, {
                    alias: sanitizeFederatedAlias(e.target.value),
                  })
                }
                className="bg-background border-border/60"
              />
              <Input
                placeholder="default schema/db"
                value={row.namespace}
                onChange={(e) =>
                  updateRow(index, { namespace: e.target.value })
                }
                className="bg-background border-border/60"
              />
            </div>
            {getFederatedDraftError(row) ? (
              <p className="text-xs text-red-400">
                {getFederatedDraftError(row)}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
