"use client";

import {
  SettingsMinimalistic as SolarSettingsMinimalistic,
  AltArrowRight as SolarAltArrowRight,
  AltArrowDown as SolarAltArrowDown,
  AltArrowLeft as SolarAltArrowLeft,
  AddCircle as SolarAddCircle,
  Database as SolarDatabase,
  Chart as SolarChart,
  ClockCircle as SolarClockCircle,
  BranchingPathsDown as SolarBranchingPathsDown,
  MinimalisticMagnifier as SolarMinimalisticMagnifier,
  PenNewSquare as SolarPenNewSquare,
  House as SolarHouse,
  Layers as SolarLayers,
  Moon as SolarMoon,
  CodeSquare as SolarCodeSquare,
  Sun as SolarSun,
  UsersGroupRounded as SolarUsers,
  CheckCircle as SolarCheckCircle,
  Code2 as SolarCode2,
  Shield as SolarShield,
  CloseCircle as SolarCloseCircle,
  User as SolarUser,
  History as SolarHistory,
  Widget as SolarWidget,
  Filter as SolarFilter,
  Tuning2 as SolarTuning2,
  Restart as SolarRestart,
  LockUnlocked as SolarLockUnlocked,
  DownloadMinimalistic as SolarDownload,
  Copy as SolarCopy,
  TrashBinMinimalistic2 as SolarTrash,
  CodeFile as SolarCodeFile,
  File as SolarFile,
  DangerCircle as SolarDangerCircle,
  WalletMoney as SolarWalletMoney,
} from "@solar-icons/react";

import { HugeiconsIcon } from "@hugeicons/react";
import { LayoutTable02Icon } from "@hugeicons/core-free-icons";
import { forwardRef } from "react";

import { createThemedLucideIcon } from "@/lib/icon-theme/runtime";

const HugeTableIcon = forwardRef<SVGSVGElement, Record<string, unknown>>(
  (props, ref) => {
    const { className, size, color, ...rest } = props;
    void rest;
    void ref;
    return (
      <HugeiconsIcon
        icon={LayoutTable02Icon}
        className={className as string | undefined}
        size={(size as number) || 24}
        color={(color as string) || "currentColor"}
      />
    );
  },
);

// --- Named exports under solar-specific names ---

export const SettingsMinimalistic = createThemedLucideIcon(
  "Settings",
  SolarSettingsMinimalistic as any,
);
export const AltArrowRight = createThemedLucideIcon(
  "ChevronRight",
  SolarAltArrowRight as any,
);
export const AltArrowDown = createThemedLucideIcon(
  "ChevronDown",
  SolarAltArrowDown as any,
);
export const AltArrowLeft = createThemedLucideIcon(
  "ChevronLeft",
  SolarAltArrowLeft as any,
);
export const AddCircle = createThemedLucideIcon(
  "Plus",
  SolarAddCircle as any,
);
export const DatabaseIcon = createThemedLucideIcon(
  "Database",
  SolarDatabase as any,
);
export const Chart = createThemedLucideIcon(
  "BarChart3",
  SolarChart as any,
);
export const ClockCircle = createThemedLucideIcon(
  "Clock",
  SolarClockCircle as any,
);
export const BranchingPathsDown = createThemedLucideIcon(
  "Workflow",
  SolarBranchingPathsDown as any,
);
export const MinimalisticMagnifier = createThemedLucideIcon(
  "Search",
  SolarMinimalisticMagnifier as any,
);
export const PenNewSquare = createThemedLucideIcon(
  "SquarePen",
  SolarPenNewSquare as any,
);

// --- Named exports under lucide-compatible names (maps to solar icons) ---

export const Settings = SettingsMinimalistic;
export const ChevronRight = AltArrowRight;
export const ChevronDown = AltArrowDown;
export const ChevronLeft = AltArrowLeft;
export { Plus } from "./lucide-react";
export const Database = createThemedLucideIcon("Database", SolarDatabase as any);
export const Search = MinimalisticMagnifier;
export const SquarePen = PenNewSquare;
export const Workflow = BranchingPathsDown;
export const BarChart3 = Chart;
export const Clock = ClockCircle;
export const Filter = createThemedLucideIcon("Filter", SolarFilter as any);
export const ArrowUpDown = createThemedLucideIcon("ArrowUpDown", SolarTuning2 as any);
export const RefreshCw = createThemedLucideIcon("RefreshCw", SolarRestart as any);
export const Unlock = createThemedLucideIcon("Unlock", SolarLockUnlocked as any);
export const Download = createThemedLucideIcon("Download", SolarDownload as any);
export const Copy = createThemedLucideIcon("Copy", SolarCopy as any);
export const Trash2 = createThemedLucideIcon("Trash2", SolarTrash as any);
export const FileJson = createThemedLucideIcon("FileJson", SolarCodeFile as any);
export const FileText = createThemedLucideIcon("FileText", SolarFile as any);
export const AlertCircle = createThemedLucideIcon("AlertCircle", SolarDangerCircle as any);

// --- New studio sidebar icons ---

export const House = createThemedLucideIcon(
  "House",
  SolarHouse as any,
);
export const Layers = createThemedLucideIcon(
  "Layers",
  SolarLayers as any,
);
export const Moon = createThemedLucideIcon(
  "Moon",
  SolarMoon as any,
);
export const SquareTerminal = createThemedLucideIcon(
  "SquareTerminal",
  SolarCodeSquare as any,
);
export const Sun = createThemedLucideIcon(
  "Sun",
  SolarSun as any,
);
export const Users = createThemedLucideIcon(
  "Users",
  SolarUsers as any,
);
export const Check = createThemedLucideIcon(
  "Check",
  SolarCheckCircle as any,
);
export const Code2 = createThemedLucideIcon(
  "Code2",
  SolarCode2 as any,
);
export const Shield = createThemedLucideIcon(
  "Shield",
  SolarShield as any,
);
export const X = createThemedLucideIcon(
  "X",
  SolarCloseCircle as any,
);
export const User = createThemedLucideIcon(
  "User",
  SolarUser as any,
);
export const History = createThemedLucideIcon(
  "History",
  SolarHistory as any,
);
export const LayoutDashboard = createThemedLucideIcon(
  "LayoutDashboard",
  SolarWidget as any,
);
export const Table2 = createThemedLucideIcon(
  "Table2",
  HugeTableIcon as any,
);
export const GitGraph = createThemedLucideIcon(
  "GitGraph",
  SolarBranchingPathsDown as any,
);
export const WalletMoney = createThemedLucideIcon(
  "WalletMoney",
  SolarWalletMoney as any,
);

// --- Re-export custom icons (not solar/lucide) ---
export { AuthIcon, TableEditorIcon } from "./lucide-react";
