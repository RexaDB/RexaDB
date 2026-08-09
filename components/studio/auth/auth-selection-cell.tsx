"use client";
import { useState } from "react";
import { User } from "@/lib/icon-theme/lucide-react";

export function AuthSelectionCell({ row }: { row: any }) {
  const url = row?.__avatar_url as string | undefined;
  const [imgError, setImgError] = useState(false);
  return (
    <span className="h-6 w-6 rounded-full border border-studio-border bg-muted/20 flex items-center justify-center overflow-hidden">
      {url && !imgError ? (
        <img
          src={url}
          alt="avatar"
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
        />
      ) : (
        <User className="h-3 w-3 text-muted-foreground" />
      )}
    </span>
  );
}
