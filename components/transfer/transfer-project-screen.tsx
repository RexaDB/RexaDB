"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { TransferWizard } from "./transfer-wizard";
import type { Connection } from "@/lib/db/schema";

interface TransferProjectScreenProps {
  connections: Connection[];
  onBack: () => void;
  onComplete: () => void;
}

export function TransferProjectScreen({ connections, onBack, onComplete }: TransferProjectScreenProps) {
  const handleComplete = (result: { success: boolean; stats?: Record<string, number> }) => {
    if (result.success) {
      onComplete();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onBack();
      }}
    >
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogTitle className="sr-only">Transfer Project</DialogTitle>
        <TransferWizard
          connections={connections.map(conn => ({
            id: String(conn.id),
            name: conn.name,
            connectionString: conn.connectionString,
            connectionType: conn.connectionType || "unknown",
          }))}
          onComplete={handleComplete}
          onCancel={onBack}
        />
      </DialogContent>
    </Dialog>
  );
}
