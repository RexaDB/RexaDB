"use client";

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { TransferWizard } from "./transfer-wizard";
import type { Connection } from "@/lib/db/schema";

interface TransferProjectScreenProps {
  connections: Connection[];
  initialSourceConnectionId?: string | null;
  onBack: () => void;
  onComplete: () => void;
}

export function TransferProjectScreen({ connections, initialSourceConnectionId, onBack, onComplete }: TransferProjectScreenProps) {
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
      <DialogContent
        hideCloseButton
        className="max-h-[88vh] overflow-y-auto p-4 sm:max-w-[472px]"
        overlayClassName="bg-black/40"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Transfer Project</DialogTitle>
        <TransferWizard
          connections={connections.map(conn => ({
            id: String(conn.id),
            name: conn.name,
            connectionString: conn.connectionString,
            connectionType: conn.connectionType || "unknown",
          }))}
          initialSourceConnectionId={initialSourceConnectionId}
          onComplete={handleComplete}
          onCancel={onBack}
        />
      </DialogContent>
    </Dialog>
  );
}
