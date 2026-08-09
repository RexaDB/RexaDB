"use client";

import {
  Activity as LucideActivity,
  AlertCircle as LucideAlertCircle,
  AlertTriangle as LucideAlertTriangle,
  ArrowDown as LucideArrowDown,
  ArrowDownNarrowWide as LucideArrowDownNarrowWide,
  ArrowDownWideNarrow as LucideArrowDownWideNarrow,
  ArrowLeft as LucideArrowLeft,
  ArrowRight as LucideArrowRight,
  ArrowRightLeft as LucideArrowRightLeft,
  ArrowUp as LucideArrowUp,
  ArrowUpDown as LucideArrowUpDown,
  BarChart2 as LucideBarChart2,
  BarChart3 as LucideBarChart3,
  Bell as LucideBell,
  BellIcon as LucideBellIcon,
  BluetoothIcon as LucideBluetoothIcon,
  BookOpen as LucideBookOpen,
  Briefcase as LucideBriefcase,
  Bot as LucideBot,
  Box as LucideBox,
  Bug as LucideBug,
  Calendar as LucideCalendar,
  Camera as LucideCamera,
  CalendarDays as LucideCalendarDays,
  Check as LucideCheck,
  CheckCircle2 as LucideCheckCircle2,
  ClipboardCheck as LucideClipboardCheck,
  CheckIcon as LucideCheckIcon,
  CheckSquare as LucideCheckSquare,
  ChevronDown as LucideChevronDown,
  ChevronDownIcon as LucideChevronDownIcon,
  ChevronLeft as LucideChevronLeft,
  ChevronRight as LucideChevronRight,
  ChevronRightIcon as LucideChevronRightIcon,
  ChevronUp as LucideChevronUp,
  ChevronUpIcon as LucideChevronUpIcon,
  ChevronsUpDown as LucideChevronsUpDown,
  Clock as LucideClock,
  Code as LucideCode,
  Clock4 as LucideClock4,
  Cloud as LucideCloud,
  CloudOff as LucideCloudOff,
  Code2 as LucideCode2,
  Columns2 as LucideColumns2,
  Columns3 as LucideColumns3,
  Command as LucideCommand,
  Copy as LucideCopy,
  CopyPlus as LucideCopyPlus,
  CornerDownLeft as LucideCornerDownLeft,
  Cpu as LucideCpu,
  CreditCardIcon as LucideCreditCardIcon,
  Database as LucideDatabase,
  Diamond as LucideDiamond,
  Download as LucideDownload,
  DownloadIcon as LucideDownloadIcon,
  Edit2 as LucideEdit2,
  EllipsisVertical as LucideEllipsisVertical,
  Eraser as LucideEraser,
  ExternalLink as LucideExternalLink,
  Eye as LucideEye,
  EyeIcon as LucideEyeIcon,
  EyeOff as LucideEyeOff,
  File as LucideFile,
  FileCode as LucideFileCode,
  Flame as LucideFlame,
  FileCode2 as LucideFileCode2,
  FileCodeIcon as LucideFileCodeIcon,
  FileIcon as LucideFileIcon,
  FileJson as LucideFileJson,
  FileText as LucideFileText,
  FileTextIcon as LucideFileTextIcon,
  FileUp as LucideFileUp,
  Files as LucideFiles,
  Filter as LucideFilter,
  Fingerprint as LucideFingerprint,
  Folder as LucideFolder,
  FolderIcon as LucideFolderIcon,
  FolderOpen as LucideFolderOpen,
  FolderOpenIcon as LucideFolderOpenIcon,
  FolderPlus as LucideFolderPlus,
  FolderSearchIcon as LucideFolderSearchIcon,
  FunctionSquare as LucideFunctionSquare,
  Gauge as LucideGauge,
  GitBranch as LucideGitBranch,
  GitCommitHorizontal as LucideGitCommitHorizontal,
  GitCompare as LucideGitCompare,
  GitFork as LucideGitFork,
  GitGraph as LucideGitGraph,
  Globe as LucideGlobe,
  GripVertical as LucideGripVertical,
  GripVerticalIcon as LucideGripVerticalIcon,
  HardDrive as LucideHardDrive,
  Hash as LucideHash,
  HelpCircleIcon as LucideHelpCircleIcon,
  History as LucideHistory,
  House as LucideHouse,
  ImageIcon as LucideImageIcon,
  Key as LucideKey,
  KeyRound as LucideKeyRound,
  Keyboard as LucideKeyboard,
  KeyboardIcon as LucideKeyboardIcon,
  LanguagesIcon as LucideLanguagesIcon,
  Laptop as LucideLaptop,
  Layers as LucideLayers,
  Layout as LucideLayout,
  LayoutDashboard as LucideLayoutDashboard,
  LayoutGrid as LucideLayoutGrid,
  LayoutIcon as LucideLayoutIcon,
  Link as LucideLink,
  Link2 as LucideLink2,
  List as LucideList,
  Loader2 as LucideLoader2,
  Loader2Icon as LucideLoader2Icon,
  Lock as LucideLock,
  LogOut as LucideLogOut,
  LogOutIcon as LucideLogOutIcon,
  Mail as LucideMail,
  MailIcon as LucideMailIcon,
  Maximize2 as LucideMaximize2,
  Minimize2 as LucideMinimize2,
  Minus as LucideMinus,
  MonitorIcon as LucideMonitorIcon,
  Moon as LucideMoon,
  MoonIcon as LucideMoonIcon,
  MoreHorizontal as LucideMoreHorizontal,
  MoreHorizontalIcon as LucideMoreHorizontalIcon,
  MoreVertical as LucideMoreVertical,
  MoreVerticalIcon as LucideMoreVerticalIcon,
  MusicIcon as LucideMusicIcon,
  Palette as LucidePalette,
  PaletteIcon as LucidePaletteIcon,
  PanelLeft as LucidePanelLeft,
  PanelLeftDashed as LucidePanelLeftDashed,
  PanelRightClose as LucidePanelRightClose,
  Pencil as LucidePencil,
  PencilLine as LucidePencilLine,
  Pin as LucidePin,
  Play as LucidePlay,
  Plus as LucidePlus,
  PlusIcon as LucidePlusIcon,
  PlusSquare as LucidePlusSquare,
  RefreshCcw as LucideRefreshCcw,
  RefreshCw as LucideRefreshCw,
  RotateCcw as LucideRotateCcw,
  RotateCw as LucideRotateCw,
  Rows3 as LucideRows3,
  Save as LucideSave,
  SaveIcon as LucideSaveIcon,
  Search as LucideSearch,
  Send as LucideSend,
  Server as LucideServer,
  Settings as LucideSettings,
  Settings2 as LucideSettings2,
  SettingsIcon as LucideSettingsIcon,
  Shield as LucideShield,
  ShieldCheck as LucideShieldCheck,
  ShieldIcon as LucideShieldIcon,
  SlidersHorizontal as LucideSlidersHorizontal,
  Sparkles as LucideSparkles,
   Square as LucideSquare,
  SquarePen as LucideSquarePen,
  SquarePlus as LucideSquarePlus,
  SquareTerminal as LucideSquareTerminal,
  Star as LucideStar,
  Sun as LucideSun,
  SunIcon as LucideSunIcon,
  Table2 as LucideTable2,
  Tag as LucideTag,
  Terminal as LucideTerminal,
  TestTube as LucideTestTube,
  Timer as LucideTimer,
  Trash2 as LucideTrash2,
  TrendingDownIcon as LucideTrendingDownIcon,
  TrendingUp as LucideTrendingUp,
  TrendingUpIcon as LucideTrendingUpIcon,
  Type as LucideType,
  Undo2 as LucideUndo2,
  Unlock as LucideUnlock,
  Upload as LucideUpload,
  UploadCloud as LucideUploadCloud,
  User as LucideUser,
  UserIcon as LucideUserIcon,
  Users as LucideUsers,
  VideoIcon as LucideVideoIcon,
  Wand2 as LucideWand2,
  WandSparkles as LucideWandSparkles,
  Workflow as LucideWorkflow,
  X as LucideX,
  XCircle as LucideXCircle,
  XIcon as LucideXIcon,
  Zap as LucideZap,
  Ban as LucideBan,
  Brain as LucideBrain,
  FileArchive as LucideFileArchive,
  ScrollText as LucideScrollText,
  Circle as LucideCircle,
  UserPlus as LucideUserPlus,
  Building2 as LucideBuilding2,
  Menu as LucideMenu,
  Table as LucideTable,
  Pause as LucidePause,
  Info as LucideInfo,
  SearchX as LucideSearchX,

} from "lucide-react/dist/esm/lucide-react.js";

import { createThemedLucideIcon } from "@/lib/icon-theme/runtime";
import { AuthIcon as CustomAuthIcon } from "@/components/studio/AuthIcon";
import { TableEditorIcon as CustomTableEditorIcon } from "@/components/studio/TableEditorIcon";
import { DatabaseIcon as CustomDatabaseIcon } from "@/components/studio/database-icon";

export const Activity = createThemedLucideIcon("Activity", LucideActivity);
export const AlertCircle = createThemedLucideIcon("AlertCircle", LucideAlertCircle);
export const AlertTriangle = createThemedLucideIcon("AlertTriangle", LucideAlertTriangle);
export const ArrowDown = createThemedLucideIcon("ArrowDown", LucideArrowDown);
export const ArrowDownNarrowWide = createThemedLucideIcon("ArrowDownNarrowWide", LucideArrowDownNarrowWide);
export const ArrowDownWideNarrow = createThemedLucideIcon("ArrowDownWideNarrow", LucideArrowDownWideNarrow);
export const ArrowLeft = createThemedLucideIcon("ArrowLeft", LucideArrowLeft);
export const ArrowRight = createThemedLucideIcon("ArrowRight", LucideArrowRight);
export const ArrowRightLeft = createThemedLucideIcon("ArrowRightLeft", LucideArrowRightLeft);
export const ArrowUp = createThemedLucideIcon("ArrowUp", LucideArrowUp);
export const ArrowUpDown = createThemedLucideIcon("ArrowUpDown", LucideArrowUpDown);
export const BarChart3 = createThemedLucideIcon("BarChart3", LucideBarChart3);
export const Bell = createThemedLucideIcon("Bell", LucideBell);
export const BellIcon = createThemedLucideIcon("BellIcon", LucideBellIcon);
export const BluetoothIcon = createThemedLucideIcon("BluetoothIcon", LucideBluetoothIcon);
export const BookOpen = createThemedLucideIcon("BookOpen", LucideBookOpen);
export const Briefcase = createThemedLucideIcon("Briefcase", LucideBriefcase);
export const Bot = createThemedLucideIcon("Bot", LucideBot);
export const Box = createThemedLucideIcon("Box", LucideBox);
export const Bug = createThemedLucideIcon("Bug", LucideBug);
export const Camera = createThemedLucideIcon("Camera", LucideCamera);
export const Calendar = createThemedLucideIcon("Calendar", LucideCalendar);
export const CalendarDays = createThemedLucideIcon("CalendarDays", LucideCalendarDays);
export const Check = createThemedLucideIcon("Check", LucideCheck);
export const CheckCircle2 = createThemedLucideIcon("CheckCircle2", LucideCheckCircle2);
export const CheckIcon = createThemedLucideIcon("CheckIcon", LucideCheckIcon);
export const ClipboardCheck = createThemedLucideIcon("ClipboardCheck", LucideClipboardCheck);
export const CheckSquare = createThemedLucideIcon("CheckSquare", LucideCheckSquare);
export const ChevronDown = createThemedLucideIcon("ChevronDown", LucideChevronDown);
export const ChevronDownIcon = createThemedLucideIcon("ChevronDownIcon", LucideChevronDownIcon);
export const ChevronLeft = createThemedLucideIcon("ChevronLeft", LucideChevronLeft);
export const ChevronRight = createThemedLucideIcon("ChevronRight", LucideChevronRight);
export const ChevronRightIcon = createThemedLucideIcon("ChevronRightIcon", LucideChevronRightIcon);
export const ChevronUp = createThemedLucideIcon("ChevronUp", LucideChevronUp);
export const ChevronUpIcon = createThemedLucideIcon("ChevronUpIcon", LucideChevronUpIcon);
export const ChevronsUpDown = createThemedLucideIcon("ChevronsUpDown", LucideChevronsUpDown);
export const Clock = createThemedLucideIcon("Clock", LucideClock);
export const Clock4 = createThemedLucideIcon("Clock4", LucideClock4);
export const Cloud = createThemedLucideIcon("Cloud", LucideCloud);
export const CloudOff = createThemedLucideIcon("CloudOff", LucideCloudOff);
export const Code = createThemedLucideIcon("Code", LucideCode);
export const Code2 = createThemedLucideIcon("Code2", LucideCode2);
export const Columns2 = createThemedLucideIcon("Columns2", LucideColumns2);
export const Columns3 = createThemedLucideIcon("Columns3", LucideColumns3);
export const Command = createThemedLucideIcon("Command", LucideCommand);
export const Copy = createThemedLucideIcon("Copy", LucideCopy);
export const CopyPlus = createThemedLucideIcon("CopyPlus", LucideCopyPlus);
export const CornerDownLeft = createThemedLucideIcon("CornerDownLeft", LucideCornerDownLeft);
export const Cpu = createThemedLucideIcon("Cpu", LucideCpu);
export const CreditCardIcon = createThemedLucideIcon("CreditCardIcon", LucideCreditCardIcon);
export const Database = createThemedLucideIcon("Database", LucideDatabase);
export const Diamond = createThemedLucideIcon("Diamond", LucideDiamond);
export const Download = createThemedLucideIcon("Download", LucideDownload);
export const DownloadIcon = createThemedLucideIcon("DownloadIcon", LucideDownloadIcon);
export const Edit2 = createThemedLucideIcon("Edit2", LucideEdit2);
export const EllipsisVertical = createThemedLucideIcon("EllipsisVertical", LucideEllipsisVertical);
export const Eraser = createThemedLucideIcon("Eraser", LucideEraser);
export const ExternalLink = createThemedLucideIcon("ExternalLink", LucideExternalLink);
export const Eye = createThemedLucideIcon("Eye", LucideEye);
export const EyeIcon = createThemedLucideIcon("EyeIcon", LucideEyeIcon);
export const EyeOff = createThemedLucideIcon("EyeOff", LucideEyeOff);
export const File = createThemedLucideIcon("File", LucideFile);
export const FileCode = createThemedLucideIcon("FileCode", LucideFileCode);
export const FileCode2 = createThemedLucideIcon("FileCode2", LucideFileCode2);
export const FileCodeIcon = createThemedLucideIcon("FileCodeIcon", LucideFileCodeIcon);
export const FileIcon = createThemedLucideIcon("FileIcon", LucideFileIcon);
export const FileJson = createThemedLucideIcon("FileJson", LucideFileJson);
export const FileText = createThemedLucideIcon("FileText", LucideFileText);
export const FileTextIcon = createThemedLucideIcon("FileTextIcon", LucideFileTextIcon);
export const FileUp = createThemedLucideIcon("FileUp", LucideFileUp);
export const Files = createThemedLucideIcon("Files", LucideFiles);
export const Filter = createThemedLucideIcon("Filter", LucideFilter);
export const Fingerprint = createThemedLucideIcon("Fingerprint", LucideFingerprint);
export const Flame = createThemedLucideIcon("Flame", LucideFlame);
export const Folder = createThemedLucideIcon("Folder", LucideFolder);
export const FolderIcon = createThemedLucideIcon("FolderIcon", LucideFolderIcon);
export const FolderOpen = createThemedLucideIcon("FolderOpen", LucideFolderOpen);
export const FolderOpenIcon = createThemedLucideIcon("FolderOpenIcon", LucideFolderOpenIcon);
export const FolderPlus = createThemedLucideIcon("FolderPlus", LucideFolderPlus);
export const FolderSearchIcon = createThemedLucideIcon("FolderSearchIcon", LucideFolderSearchIcon);
export const FunctionSquare = createThemedLucideIcon("FunctionSquare", LucideFunctionSquare);
export const Gauge = createThemedLucideIcon("Gauge", LucideGauge);
export const GitBranch = createThemedLucideIcon("GitBranch", LucideGitBranch);
export const GitCommitHorizontal = createThemedLucideIcon("GitCommitHorizontal", LucideGitCommitHorizontal);
export const GitCompare = createThemedLucideIcon("GitCompare", LucideGitCompare);
export const GitFork = createThemedLucideIcon("GitFork", LucideGitFork);
export const GitGraph = createThemedLucideIcon("GitGraph", LucideGitGraph);
export const Globe = createThemedLucideIcon("Globe", LucideGlobe);
export const GripVertical = createThemedLucideIcon("GripVertical", LucideGripVertical);
export const GripVerticalIcon = createThemedLucideIcon("GripVerticalIcon", LucideGripVerticalIcon);
export const HardDrive = createThemedLucideIcon("HardDrive", LucideHardDrive);
export const Hash = createThemedLucideIcon("Hash", LucideHash);
export const HelpCircleIcon = createThemedLucideIcon("HelpCircleIcon", LucideHelpCircleIcon);
export const History = createThemedLucideIcon("History", LucideHistory);
export const House = createThemedLucideIcon("House", LucideHouse);
export const ImageIcon = createThemedLucideIcon("ImageIcon", LucideImageIcon);
export const Key = createThemedLucideIcon("Key", LucideKey);
export const KeyRound = createThemedLucideIcon("KeyRound", LucideKeyRound);
export const Keyboard = createThemedLucideIcon("Keyboard", LucideKeyboard);
export const KeyboardIcon = createThemedLucideIcon("KeyboardIcon", LucideKeyboardIcon);
export const LanguagesIcon = createThemedLucideIcon("LanguagesIcon", LucideLanguagesIcon);
export const Laptop = createThemedLucideIcon("Laptop", LucideLaptop);
export const Layers = createThemedLucideIcon("Layers", LucideLayers);
export const Layout = createThemedLucideIcon("Layout", LucideLayout);
export const LayoutDashboard = createThemedLucideIcon("LayoutDashboard", LucideLayoutDashboard);
export const LayoutGrid = createThemedLucideIcon("LayoutGrid", LucideLayoutGrid);
export const LayoutIcon = createThemedLucideIcon("LayoutIcon", LucideLayoutIcon);
export const Link = createThemedLucideIcon("Link", LucideLink);
export const Link2 = createThemedLucideIcon("Link2", LucideLink2);
export const List = createThemedLucideIcon("List", LucideList);
export const Loader2 = createThemedLucideIcon("Loader2", LucideLoader2);
export const Loader2Icon = createThemedLucideIcon("Loader2Icon", LucideLoader2Icon);
export const Lock = createThemedLucideIcon("Lock", LucideLock);
export const LogOut = createThemedLucideIcon("LogOut", LucideLogOut);
export const LogOutIcon = createThemedLucideIcon("LogOutIcon", LucideLogOutIcon);
export const Mail = createThemedLucideIcon("Mail", LucideMail);
export const MailIcon = createThemedLucideIcon("MailIcon", LucideMailIcon);
export const Maximize2 = createThemedLucideIcon("Maximize2", LucideMaximize2);
export const Minimize2 = createThemedLucideIcon("Minimize2", LucideMinimize2);
export const Minus = createThemedLucideIcon("Minus", LucideMinus);
export const MonitorIcon = createThemedLucideIcon("MonitorIcon", LucideMonitorIcon);
export const Moon = createThemedLucideIcon("Moon", LucideMoon);
export const MoonIcon = createThemedLucideIcon("MoonIcon", LucideMoonIcon);
export const MoreHorizontal = createThemedLucideIcon("MoreHorizontal", LucideMoreHorizontal);
export const MoreHorizontalIcon = createThemedLucideIcon("MoreHorizontalIcon", LucideMoreHorizontalIcon);
export const MoreVertical = createThemedLucideIcon("MoreVertical", LucideMoreVertical);
export const MoreVerticalIcon = createThemedLucideIcon("MoreVerticalIcon", LucideMoreVerticalIcon);
export const MusicIcon = createThemedLucideIcon("MusicIcon", LucideMusicIcon);
export const Palette = createThemedLucideIcon("Palette", LucidePalette);
export const PaletteIcon = createThemedLucideIcon("PaletteIcon", LucidePaletteIcon);
export const PanelLeft = createThemedLucideIcon("PanelLeft", LucidePanelLeft);
export const PanelLeftDashed = createThemedLucideIcon("PanelLeftDashed", LucidePanelLeftDashed);
export const PanelRightClose = createThemedLucideIcon("PanelRightClose", LucidePanelRightClose);
export const Pencil = createThemedLucideIcon("Pencil", LucidePencil);
export const PencilLine = createThemedLucideIcon("PencilLine", LucidePencilLine);
export const Pin = createThemedLucideIcon("Pin", LucidePin);
export const Play = createThemedLucideIcon("Play", LucidePlay);
export const Plus = createThemedLucideIcon("Plus", LucidePlus);
export const PlusIcon = createThemedLucideIcon("PlusIcon", LucidePlusIcon);
export const PlusSquare = createThemedLucideIcon("PlusSquare", LucidePlusSquare);
export const RefreshCcw = createThemedLucideIcon("RefreshCcw", LucideRefreshCcw);
export const RefreshCw = createThemedLucideIcon("RefreshCw", LucideRefreshCw);
export const RotateCcw = createThemedLucideIcon("RotateCcw", LucideRotateCcw);
export const RotateCw = createThemedLucideIcon("RotateCw", LucideRotateCw);
export const Rows3 = createThemedLucideIcon("Rows3", LucideRows3);
export const Save = createThemedLucideIcon("Save", LucideSave);
export const SaveIcon = createThemedLucideIcon("SaveIcon", LucideSaveIcon);
export const Search = createThemedLucideIcon("Search", LucideSearch);
export const Send = createThemedLucideIcon("Send", LucideSend);
export const Server = createThemedLucideIcon("Server", LucideServer);
export const Settings = createThemedLucideIcon("Settings", LucideSettings);
export const Settings2 = createThemedLucideIcon("Settings2", LucideSettings2);
export const SettingsIcon = createThemedLucideIcon("SettingsIcon", LucideSettingsIcon);
export const Shield = createThemedLucideIcon("Shield", LucideShield);
export const ShieldCheck = createThemedLucideIcon("ShieldCheck", LucideShieldCheck);
export const ShieldIcon = createThemedLucideIcon("ShieldIcon", LucideShieldIcon);
export const SlidersHorizontal = createThemedLucideIcon("SlidersHorizontal", LucideSlidersHorizontal);
export const Sparkles = createThemedLucideIcon("Sparkles", LucideSparkles);
export const Square = createThemedLucideIcon("Square", LucideSquare);
export const SquarePen = createThemedLucideIcon("SquarePen", LucideSquarePen);
export const SquarePlus = createThemedLucideIcon("SquarePlus", LucideSquarePlus);
export const SquareTerminal = createThemedLucideIcon("SquareTerminal", LucideSquareTerminal);
export const Star = createThemedLucideIcon("Star", LucideStar);
export const Sun = createThemedLucideIcon("Sun", LucideSun);
export const SunIcon = createThemedLucideIcon("SunIcon", LucideSunIcon);
export const Table2 = createThemedLucideIcon("Table2", LucideTable2);
export const Tag = createThemedLucideIcon("Tag", LucideTag);
export const Terminal = createThemedLucideIcon("Terminal", LucideTerminal);
export const TestTube = createThemedLucideIcon("TestTube", LucideTestTube);
export const Timer = createThemedLucideIcon("Timer", LucideTimer);
export const Trash2 = createThemedLucideIcon("Trash2", LucideTrash2);
export const TrendingDownIcon = createThemedLucideIcon("TrendingDownIcon", LucideTrendingDownIcon);
export const TrendingUp = createThemedLucideIcon("TrendingUp", LucideTrendingUp);
export const TrendingUpIcon = createThemedLucideIcon("TrendingUpIcon", LucideTrendingUpIcon);
export const Type = createThemedLucideIcon("Type", LucideType);
export const Undo2 = createThemedLucideIcon("Undo2", LucideUndo2);
export const Unlock = createThemedLucideIcon("Unlock", LucideUnlock);
export const Upload = createThemedLucideIcon("Upload", LucideUpload);
export const UploadCloud = createThemedLucideIcon("UploadCloud", LucideUploadCloud);
export const User = createThemedLucideIcon("User", LucideUser);
export const UserIcon = createThemedLucideIcon("UserIcon", LucideUserIcon);
export const Users = createThemedLucideIcon("Users", LucideUsers);
export const VideoIcon = createThemedLucideIcon("VideoIcon", LucideVideoIcon);
export const Wand2 = createThemedLucideIcon("Wand2", LucideWand2);
export const WandSparkles = createThemedLucideIcon("WandSparkles", LucideWandSparkles);
export const Workflow = createThemedLucideIcon("Workflow", LucideWorkflow);
export const X = createThemedLucideIcon("X", LucideX);
export const XCircle = createThemedLucideIcon("XCircle", LucideXCircle);
export const XIcon = createThemedLucideIcon("XIcon", LucideXIcon);
export const Zap = createThemedLucideIcon("Zap", LucideZap);

export const Ban = createThemedLucideIcon("Ban", LucideBan);
export const Brain = createThemedLucideIcon("Brain", LucideBrain);
export const FileArchive = createThemedLucideIcon("FileArchive", LucideFileArchive);
export const ScrollText = createThemedLucideIcon("ScrollText", LucideScrollText);
export const Circle = createThemedLucideIcon("Circle", LucideCircle);
export const UserPlus = createThemedLucideIcon("UserPlus", LucideUserPlus);
export const Building2 = createThemedLucideIcon("Building2", LucideBuilding2);
export const Menu = createThemedLucideIcon("Menu", LucideMenu);
export const Table = createThemedLucideIcon("Table", LucideTable);
export const Pause = createThemedLucideIcon("Pause", LucidePause);
export const Info = createThemedLucideIcon("Info", LucideInfo);
export const SearchX = createThemedLucideIcon("SearchX", LucideSearchX);
export const AuthIcon = createThemedLucideIcon("AuthIcon", CustomAuthIcon);
export const TableEditorIcon = createThemedLucideIcon("TableEditorIcon", CustomTableEditorIcon);
export const DatabaseIcon = createThemedLucideIcon("DatabaseIcon", CustomDatabaseIcon);
