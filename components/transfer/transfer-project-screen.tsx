"use client";

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
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b border-studio-border px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h2 className="text-lg font-semibold">Transfer Project</h2>
        </div>
      </div>
      
      <div className="flex-1 overflow-auto">
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
      </div>
    </div>
  );
}