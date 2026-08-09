import React from 'react';
import { X } from 'lucide-react';
import { Button } from "@/components/ui/button";

import type { ConnectionDbType } from "@/lib/db/connection-type";
import { getEditorLabel, getTableLabels } from "@/lib/studio/db-labels";

interface WelcomeScreenProps {
  onOpenSqlEditor: () => void;
  dbType: ConnectionDbType;
  onClosePane?: () => void;
}

export function WelcomeScreen({ onOpenSqlEditor, dbType, onClosePane }: WelcomeScreenProps) {
  const tableLabels = getTableLabels(dbType);
  const editorLabel = getEditorLabel(dbType);
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground bg-background relative overflow-hidden">
      {onClosePane && (
        <div className="absolute right-3 top-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClosePane}
            className="h-8 gap-1.5 px-2 text-muted-foreground/70 hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            <span>Close split</span>
          </Button>
        </div>
      )}
      <div className="max-w-xl px-8 text-center">
        <p className="text-sm text-foreground">
          Select a {tableLabels.singular.toLowerCase()} from the sidebar or open the {editorLabel.toLowerCase()} to start exploring your data.
        </p>
      </div>
    </div>
  );
}
