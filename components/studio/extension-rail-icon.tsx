"use client";

import { Puzzle as PuzzleIcon } from "@/lib/icon-theme/lucide-react";
import { resolveExtensionIconKind } from "@/lib/extensions/rail-icon";
import { cn } from "@/lib/utils";

/** Activity-rail icon for extensions: inline SVG, emoji/text glyph, or puzzle fallback. */
export function ExtensionRailIcon({ icon, className }: { icon?: string; className?: string }) {
  const kind = resolveExtensionIconKind(icon);
  if (kind === "svg") {
    return (
      <span
        className={cn("flex h-5 w-5 shrink-0 items-center justify-center [&_svg]:h-5 [&_svg]:w-5", className)}
        dangerouslySetInnerHTML={{ __html: icon! }}
      />
    );
  }
  if (kind === "text") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[15px] leading-none select-none">
        {icon!.trim()}
      </span>
    );
  }
  return <PuzzleIcon className={cn("h-5 w-5 shrink-0", className)} />;
}
