"use client";

import Link from "next/link";
import { ArrowLeft } from "@/lib/icon-theme/lucide-react";

export function TeamHeader() {
  return (
    <div
      data-tauri-drag-region="deep"
      className="flex items-center gap-3 px-4 h-12 border-b border-studio-border shrink-0 bg-studio-bg/50"
    >
      <Link
        href="/"
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to App
      </Link>
    </div>
  );
}
