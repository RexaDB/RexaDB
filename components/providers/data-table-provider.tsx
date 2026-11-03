"use client";

import type { ReactNode } from "react";
import {
  DataTableProvider,
  type DataTableComponentOverrides,
} from "@rexadbapp/data-table";
import {
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InfoIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  StudioSheet,
  StudioSheetFooter,
  StudioSheetHeader,
  StudioSheetTitle,
} from "@/components/common/studio-sheet";
import { DeleteConfirmDialog } from "@/components/studio/shared/delete-confirm-dialog";
import { JsonCodeEditor } from "@/components/studio/json-code-editor";
import {
  Calendar as CalendarIcon,
  CornerDownLeft,
  ExternalLink,
  Maximize2,
  Plus,
  Table2,
  X,
} from "@/lib/icon-theme/lucide-react";

/**
 * The app's own UI for every `@rexadbapp/data-table` table and grid, so they
 * render with the same components, icons and editors as the rest of the app.
 */
const REXA_DATA_TABLE_COMPONENTS: DataTableComponentOverrides = {
  Button,
  Input,
  Checkbox,
  Skeleton,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Popover,
  PopoverAnchor,
  PopoverContent,
  Calendar,
  Sheet: StudioSheet,
  SheetHeader: StudioSheetHeader,
  SheetTitle: StudioSheetTitle,
  SheetFooter: StudioSheetFooter,
  ConfirmDialog: DeleteConfirmDialog,
  CodeEditor: JsonCodeEditor,
  icons: {
    ArrowUp: ArrowUpIcon,
    Info: InfoIcon,
    ChevronLeft: ChevronLeftIcon,
    ChevronRight: ChevronRightIcon,
    X,
    ExternalLink,
    Table: Table2,
    Plus,
    CornerDownLeft,
    Maximize: Maximize2,
    Calendar: CalendarIcon,
  },
};

export function RexaDataTableProvider({ children }: { children: ReactNode }) {
  return (
    <DataTableProvider components={REXA_DATA_TABLE_COMPONENTS}>
      {children}
    </DataTableProvider>
  );
}
