// fallow-ignore-file code-duplication
"use client";

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  type MouseEvent,
} from "react";
import { useRouter } from "next/navigation";
import { useToggleHandlers } from "@/hooks/use-selection-utils";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { ConnectionsHeader } from "@/components/connections/connections-header";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Kbd } from "@/components/ui/kbd";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  getDefaultKeybindings,
  getKeybindingCombo,
  formatShortcutForPlatform,
} from "@/lib/studio/keybindings";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Connection } from "@/lib/db/schema";

import { detectConnectionDbType } from "@/lib/db/connection-type";
import {
  buildConnectionStringFromFields,
  parseFieldsFromConnectionString,
  emptyFieldValues,
  isFieldBasedProvider,
  sslModeOptionsForProvider,
  type FieldProviderId,
  type ConnectionFieldValues,
  type PlanetScaleProtocol,
} from "@/lib/db/connection-fields";
import {
  Trash2,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Edit2,
  Copy,
  CopyPlus,
  MoreVertical,
  GripVertical,
  LogOut,
  ArrowLeft,
  ArrowRightLeft,
  Eye,
  EyeOff,
  ShieldCheck,
  KeyRound,
  ExternalLink,
  Database,
  Sparkles,
  Star,
  Folder,
  ChevronsUpDown,
  User as UserIcon,
  Square,
  Check,
  List,
  ArrowUpDown,
  SlidersHorizontal,
  Settings,
} from "@/lib/icon-theme/lucide-react";
import Link from "next/link";
import Image from "next/image";
import {
  SpacetimeDbLogo,
  SupabaseLogo,
  NeonLogo,
  ProviderLogo,
  getProviderLogoUrl,
} from "@/components/shared/provider-logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { NavUser } from "@/components/navigation/nav-user";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase/client";
import { getConnections, getStoredUserProfile } from "@/lib/api/actions-client";
import {
  activateLocalUserProfile,
  loadStoredDisplayName,
  LOCAL_NAME_STORAGE_KEY,
  syncAuthenticatedUserProfile,
} from "@/lib/auth/user-profile";
import { useEntitlementState } from "@/hooks/use-entitlement-state";
import {
  encryptConnectionString,
  decryptConnectionString,
} from "@/lib/crypto/connection-encryption";
import { mergeConnections } from "@/lib/studio/connection-merge";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { FederatedConnectionForm } from "@/components/federated/federated-connection-form";
import { getFederatedDraftError } from "@/components/federated/federated-connection-utils";

import { JdbcDatabasePickerScreen } from "@/components/studio/jdbc-picker-screen";
import { DriverInstallPrompt } from "@/components/studio/jdbc-driver-install-prompt";
import { JdbcDriverManager } from "@/components/studio/jdbc-driver-manager";
import {
  type JdbcDriverTemplate,
  detectDriverClass,
} from "@/lib/db/jdbc-templates";
import { loadInstalledDrivers } from "@/lib/db/jdbc-install-utils";
import {
  buildFederatedConnectionString,
  parseFederatedConnectionString,
} from "@/lib/db/federated/connection-string";
import { useGlobalAppFontFamily } from "@/hooks/use-global-app-font-family";
import { useGlobalAppTheme } from "@/hooks/use-global-app-theme";
import { useGlobalStudioSettings } from "@/hooks/use-global-studio-settings";
import { ConnectionSchemaCompareScreen } from "@/components/connections/connection-schema-compare-screen";
import { AppSettingsView } from "@/components/app-settings-view";
import { ThemeCreatorPanel } from "@/components/studio/theme-creator/theme-creator-panel";
import { IconThemeCreatorPanel } from "@/components/studio/theme-creator/icon-theme-creator-panel";
import {
  BUILTIN_APP_THEMES,
  type CustomAppTheme,
} from "@/lib/studio/app-themes";
import type { CustomIconTheme } from "@/lib/icon-theme/types";
import { SectionHeader } from "@/components/shared/section-header";
import { useDesktopWindow } from "@/hooks/use-desktop-window";
import { openExternalUrl } from "@/lib/desktop";
import { API_BASE } from "@/lib/api-base";
import {
  initStudioAuth,
  loadStudioAuth,
  clearAllStudioData,
  getStudioUrl,
  disconnectStudioWorkspace,
} from "@/lib/studio-backend/auth-store";
import { studioApi, StudioApiError } from "@/lib/studio-backend/api-client";
import type {
  Role,
  ConnectionAccess,
  AccessType,
} from "@/lib/studio-backend/types";
import { SupabaseLoginDialog } from "@/components/supabase/supabase-login-dialog";
import { SupabaseAccountsScreen } from "@/components/supabase/supabase-account-screen";
import {
  getMgmtAccounts,
  removeMgmtAccount,
  type SupabaseMgmtAccount,
} from "@/lib/supabase-mgmt/token-store";
import {
  canAddSupabaseAccount,
} from "@/lib/supabase-mgmt/limits";
import {
  registerActiveSupabaseProjects,
} from "@/lib/supabase-mgmt/register";
import { listProjects } from "@/lib/supabase-mgmt/client";
import { SpacetimeDbLoginDialog } from "@/components/spacetimedb/spacetimedb-login-dialog";
import { SpacetimeDbAccountsScreen } from "@/components/spacetimedb/spacetimedb-account-screen";
import {
  getSpacetimeDbMgmtAccounts,
  removeSpacetimeDbMgmtAccount,
  type SpacetimeDbMgmtAccount,
} from "@/lib/spacetimedb-mgmt/token-store";
import {
  canAddSpacetimeDbAccount,
} from "@/lib/spacetimedb-mgmt/limits";
import {
  registerSpacetimeDbDatabases,
} from "@/lib/spacetimedb-mgmt/register";
import { listSpacetimeDbDatabases } from "@/lib/spacetimedb-mgmt/client";
import { NeonLoginDialog } from "@/components/neon/neon-login-dialog";
import { NeonAccountsScreen } from "@/components/neon/neon-account-screen";
import {
  getNeonCliAccounts,
  removeNeonCliAccount,
  type NeonCliAccount,
} from "@/lib/neon-cli/profile-store";
import { canAddNeonAccount } from "@/lib/neon-cli/limits";
import { detectNeonCli } from "@/lib/neon-cli/detect";
import { PlanetscaleLoginDialog } from "@/components/planetscale/planetscale-login-dialog";
import { PlanetscaleAccountsScreen } from "@/components/planetscale/planetscale-account-screen";
import {
  getPlanetscaleAccounts,
  removePlanetscaleAccount,
  type PlanetscaleAccount,
} from "@/lib/planetscale/token-store";
import { canAddPlanetscaleAccount } from "@/lib/planetscale/limits";
import { PLANETSCALE_LOGIN_ENABLED } from "@/lib/planetscale/auth";

// Removed Pattern import

function fmtErr(error: unknown, fallback: string): string {
  return error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : JSON.stringify(error);
}

type ConnectionScreen =
  | "list"
  | "new-select"
  | "new-form"
  | "edit-form"
  | "cloud-sync"
  | "compare"
  | "settings"
  | "jdbc-picker"
  | "supabase"
  | "spacetimedb"
  | "spacetimedb-account"
  | "neon-cli"
  | "planetscale-account";

type PlanCode = "free" | "pro" | "team" | "enterprise" | "otl";
type PlanEntitlements = {
  code: PlanCode;
  label: string;
  cloudEnabled: boolean;
  maxConnections: number | null;
  updatesUntil: number | null;
};

const REXADB_UPGRADE_URL =
  process.env.NEXT_PUBLIC_REXADB_UPGRADE_URL?.trim() ||
  "https://rexadb.app/pricing";

// openExternalUrl imported from @/lib/desktop

export function ConnectionManager({
  hideHeader = false,
  embedded = false,
  isAnalyticsEnabled,
  onAnalyticsToggle,
  onViewAnalytics,
  editConnectionId = null,
  newConnectionTrigger = 0,
  initialScreen = "list",
  onOpenSupabaseAccounts,
  onOpenSpacetimedbAccounts,
  onOpenNeonAccounts,
  onOpenPlanetscaleAccounts,
}: {
  hideHeader?: boolean;
  /** When `true`, renders as a content pane nested inside an external shell
   *  (ModernUIShell) that owns the header/sidebar/rail. When `false` (the
   *  default), renders as a standalone, full-viewport connection manager
   *  with no ModernUIShell chrome around it. */
  embedded?: boolean;
  isAnalyticsEnabled?: boolean;
  onAnalyticsToggle?: (enabled: boolean) => void;
  onViewAnalytics?: (connectionId: number) => void;
  editConnectionId?: number | null;
  newConnectionTrigger?: number;
  initialScreen?: ConnectionScreen;
  onOpenSupabaseAccounts?: () => void;
  onOpenSpacetimedbAccounts?: () => void;
  onOpenNeonAccounts?: () => void;
  onOpenPlanetscaleAccounts?: () => void;
}) {
  useGlobalAppFontFamily();
  const isStandalone = !embedded;
  const isSupabaseMode = initialScreen === "supabase";
  const isSpacetimeDbMode = initialScreen === "spacetimedb-account";
  const isNeonCliMode = initialScreen === "neon-cli";
  const isPlanetscaleMode = initialScreen === "planetscale-account";
  const appTheme = useGlobalAppTheme(false);
  const {
    sleekLayout,
    hideWindowActions,
    setCustomIconThemes,
    customIconThemes,
    setIconThemeId,
    iconThemeId,
  } = useGlobalStudioSettings();
  const router = useRouter();
  useEffect(() => {
    if (typeof window === "undefined" || !window.localStorage) return;
    const root = document.documentElement;
    const storedMode = window.localStorage.getItem("rexa-db-tui-mode") === "1";
    const storedTheme =
      window.localStorage.getItem("rexa-db-tui-theme") || "auto";

    if (!storedMode) {
      root.classList.remove("tui-mode");
      delete root.dataset.tuiTheme;
      return;
    }

    root.classList.add("tui-mode");
    const resolveTheme = () => {
      if (storedTheme === "auto") {
        return root.classList.contains("dark") ? "dark" : "light";
      }
      return storedTheme;
    };
    root.dataset.tuiTheme = resolveTheme();

  // fallow-ignore-next-line code-duplication
    if (storedTheme !== "auto") return;
    const observer = new MutationObserver(() => {
      root.dataset.tuiTheme = resolveTheme();
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  type ConnectionProvider =
    | "postgresql"
    | "timescale"
    | "supabase"
    | "neon"
    | "planetscale"
    | "cockroachdb"
    | "yugabytedb"
    | "redshift"
    | "mongodb"
    | "sqlite"
    | "turso"
    | "mysql"
    | "mariadb"
    | "mssql"
    | "clickhouse"
    | "redis"
    | "duckdb"
    | "federated"
    | "spacetimedb"
    | "jdbc"
    | "supabase-mgmt";
  type PgSslMode =
    | "disable"
    | "prefer"
    | "require"
    | "verify-ca"
    | "verify-full";
  type PgSshMode = "off" | "ssh";
  type PgSshAuthMode = "password" | "private-key";
  type ConnectionFailureDialogState = {
    open: boolean;
    title: string;
    connectionName: string;
    message: string;
    error: string;
  };

  useEffect(() => {
    void loadConnections();
  }, []);

  const providerCards: Array<{
    id: ConnectionProvider;
    label: string;
    logoSrc: string;
    placeholder: string;
    hint: string;
  }> = [
    {
      id: "postgresql",
      label: "PostgreSQL",
      logoSrc: "/providers/postgres.png",
      placeholder: "postgresql://user:password@host:5432/database",
      hint: "Standard PostgreSQL",
    },
    {
      id: "timescale",
      label: "TimescaleDB",
      logoSrc: "/providers/timescale.png",
      placeholder: "postgresql://user:password@host:5432/database",
      hint: "Time-series on Postgres",
    },
    {
      id: "supabase",
      label: "Supabase",
      logoSrc: "/providers/supabase.png",
      placeholder:
        "postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres",
      hint: "Hosted Postgres",
    },
    {
      id: "neon",
      label: "Neon",
      logoSrc: "/providers/neon.png",
      placeholder:
        "postgresql://user:password@ep-*.aws.neon.tech/db?sslmode=require",
      hint: "Serverless Postgres",
    },
    {
      id: "planetscale",
      label: "PlanetScale",
      logoSrc: "/providers/planetscale.png",
      placeholder:
        "postgresql://user:password@aws.connect.psdb.cloud/database?sslmode=require",
      hint: "PlanetScale Postgres • Available now",
    },
    {
      id: "cockroachdb",
      label: "CockroachDB",
      logoSrc: "/providers/cockroachdb.png",
      placeholder:
        "postgresql://user:password@cluster-id.cockroachlabs.cloud:26257/database?sslmode=verify-full",
      hint: "Postgres-compatible",
    },
    {
      id: "yugabytedb",
      label: "YugabyteDB",
      logoSrc: "/providers/yogabyte.png",
      placeholder:
        "postgresql://user:password@host:5433/database?sslmode=require",
      hint: "Distributed Postgres-compatible",
    },
    {
      id: "redshift",
      label: "Redshift",
      logoSrc: "/providers/redshift.png",
      placeholder:
        "postgresql://user:password@cluster-id.region.redshift.amazonaws.com:5439/database?sslmode=require",
      hint: "AWS data warehouse (Postgres wire)",
    },
    {
      id: "mongodb",
      label: "MongoDB",
      logoSrc: "/providers/MongoDB.png",
      placeholder:
        "mongodb+srv://user:password@cluster0.example.mongodb.net/app",
      hint: "Document database",
    },
    {
      id: "redis",
      label: "Redis",
      logoSrc: "/providers/redis.png",
      placeholder: "redis://user:password@host:6379/0",
      hint: "In-memory key-value store",
    },
    {
      id: "mysql",
      label: "MySQL",
      logoSrc: "/providers/mysql.png",
      placeholder: "mysql://user:password@host:3306/database",
      hint: "MySQL database",
    },
    {
      id: "mariadb",
      label: "MariaDB",
      logoSrc: "/providers/mariadb.png",
      placeholder: "mariadb://user:password@host:3306/database",
      hint: "MariaDB server",
    },
    {
      id: "mssql",
      label: "SQL Server",
      logoSrc: "/providers/sqlserver.png",
      placeholder: "sqlserver://user:password@host:1433/database",
      hint: "Microsoft SQL Server",
    },
    {
      id: "clickhouse",
      label: "ClickHouse",
      logoSrc: "/providers/clickhouse.png",
      placeholder: "clickhouse://user:password@host:8123/database",
      hint: "Columnar analytics DB",
    },
    {
      id: "sqlite",
      label: "SQLite",
      logoSrc: "/providers/sqlite.png",
      placeholder: "sqlite:///absolute/path/to/database.db",
      hint: "Single-file SQL database",
    },
    {
      id: "turso",
      label: "Turso",
      logoSrc: "/providers/Turso.png",
      placeholder: "libsql://your-db-your-org.turso.io?authToken=YOUR_TOKEN",
      hint: "Hosted SQLite (libSQL)",
    },
    {
      id: "duckdb",
      label: "DuckDB",
      logoSrc: "/providers/duckdb-logo.svg",
      placeholder: "duckdb:///path/to/database.duckdb",
      hint: "Embedded analytics database",
    },
    {
      id: "federated",
      label: "Federated",
      logoSrc: "/providers/federated.svg",
      placeholder: "federated://...",
      hint: "Join saved SQL connections",
    },
    {
      id: "spacetimedb",
      label: "SpacetimeDB",
      logoSrc: "/providers/spacetimedb.svg",
      placeholder: "spacetimedb://localhost:3000/my-database?token=xxx",
      hint: "Real-time relational DB",
    },
    {
      id: "jdbc",
      label: "Other Databases…",
      logoSrc: "/providers/jdbc.svg",
      placeholder: "jdbc:postgresql://host:5432/database",
      hint: "Any JDBC-accessible database",
    },
  ];

  const getProviderInfo = useCallback((conn: Connection) => {
    const provider =
      detectProvider(conn.connectionString, (conn as any).connectionType) ??
      "postgresql";
    const providerCard = providerCards.find((card) => card.id === provider);
    const env = (conn as any).environment;
    return {
      provider,
      providerCard,
      providerLogo: getProviderLogoUrl(provider),
      env,
    };
  }, []);

  const fillPgForm = useCallback(
    (parsed: NonNullable<ReturnType<typeof parsePostgresConnectionString>>) => {
      setPgHost(parsed.host);
      setPgPort(parsed.port);
      setPgDatabase(parsed.database);
      setPgUsername(parsed.username);
      setPgPassword(parsed.password);
      setPgSslMode(parsed.sslMode);
      setPgSshMode(parsed.sshMode);
      setPgSshHost(parsed.sshHost);
      setPgSshPort(parsed.sshPort);
      setPgSshUsername(parsed.sshUsername);
      setPgSshAuthMode(parsed.sshAuthMode);
      setPgSshPassword(parsed.sshPassword);
      setPgSshPrivateKey(parsed.sshPrivateKey);
    },
    [],
  );

  const detectProvider = (
    conn: string,
    savedType?: string | null,
  ): ConnectionProvider | null => {
    if (savedType) {
      if (savedType === "postgres") return "postgresql";
      if (savedType === "sqlserver") return "mssql";
      return savedType as ConnectionProvider;
    }
    const normalized = conn.trim().toLowerCase();
    if (!normalized) return null;
    if (normalized.startsWith("federated://")) return "federated";
    const hasExplicitProtocol = normalized.includes("://");
    if (
      normalized.startsWith("mongodb://") ||
      normalized.startsWith("mongodb+srv://")
    )
      return "mongodb";
    if (normalized.startsWith("redis://") || normalized.startsWith("rediss://"))
      return "redis";
    if (
      normalized.startsWith("duckdb://") ||
      normalized.endsWith(".duckdb") ||
      normalized.endsWith(".ddb")
    )
      return "duckdb";
    if (
      normalized.startsWith("clickhouse://") ||
      normalized.startsWith("clickhouses://") ||
      normalized.startsWith("clickhouse+http://") ||
      normalized.startsWith("clickhouse+https://")
    )
      return "clickhouse";
    if (
      normalized.startsWith("spacetimedb://") ||
      normalized.startsWith("spacetimedbs://")
    )
      return "spacetimedb";
    if (normalized.startsWith("mysql://") || normalized.startsWith("mysql:/"))
      return "mysql";
    if (
      normalized.startsWith("mariadb://") ||
      normalized.startsWith("mariadb:/")
    )
      return "mariadb";
    if (
      normalized.startsWith("mssql://") ||
      normalized.startsWith("sqlserver://") ||
      normalized.startsWith("sqlserver:/")
    )
      return "mssql";
    if (
      normalized.includes("server=") &&
      (normalized.includes("database=") ||
        normalized.includes("initial catalog="))
    )
      return "mssql";
    if (
      normalized === ":memory:" ||
      normalized.startsWith("sqlite:") ||
      normalized.startsWith("file:") ||
      normalized.startsWith("/") ||
      /^[a-z]:[\\\/]/i.test(normalized) ||
      normalized.startsWith("./") ||
      normalized.startsWith("../") ||
      normalized.startsWith("~") ||
      (!hasExplicitProtocol &&
        normalized.length > 0 &&
        !normalized.includes("=") &&
        !normalized.includes("@"))
    )
      return "sqlite";
    if (normalized.startsWith("libsql://") || normalized.includes(".turso.io"))
      return "turso";
    if (
      normalized.includes("tsdb.cloud") ||
      normalized.includes("timescale.com") ||
      normalized.includes("timescaledb.com") ||
      normalized.includes("timescale")
    ) {
      return "timescale";
    }
    if (normalized.includes("supabase.co")) return "supabase";
    if (normalized.includes("neon.tech")) return "neon";
    if (
      normalized.includes("psdb.cloud") ||
      normalized.includes("planetscale.com")
    )
      return "planetscale";
    if (
      normalized.startsWith("cockroachdb://") ||
      normalized.includes("cockroachlabs.cloud") ||
      normalized.includes("cockroachdb.cloud")
    ) {
      return "cockroachdb";
    }
    if (
      normalized.startsWith("yugabytedb://") ||
      normalized.includes("yugabytecloud.com") ||
      normalized.includes("yugabyte.com")
    ) {
      return "yugabytedb";
    }
    if (
      normalized.startsWith("redshift://") ||
      normalized.includes("redshift.amazonaws.com") ||
      normalized.includes("redshift-serverless.amazonaws.com")
    ) {
      return "redshift";
    }
    if (normalized.startsWith("spacetimedb://")) return "spacetimedb";
    if (normalized.startsWith("jdbc:")) return "jdbc";
    if (
      normalized.startsWith("postgres://") ||
      normalized.startsWith("postgresql://") ||
      normalized.startsWith("postgres:/") ||
      normalized.startsWith("postgresql:/")
    )
      return "postgresql";
    return null;
  };

  const normalizePgConnectionString = (conn: string) => {
    const trimmed = conn.trim();
    if (/^postgres(?:ql)?:\/(?!\/)/i.test(trimmed)) {
      return trimmed.replace(/^((?:postgres(?:ql)?):)\/(?!\/)/i, "$1//");
    }
    return trimmed;
  };

  const normalizeMysqlConnectionString = (
    conn: string,
    provider?: ConnectionProvider | null,
  ) => {
    const trimmed = conn.trim();
    if (!trimmed) return trimmed;
    if (/^(mysql|mariadb):\/(?!\/)/i.test(trimmed)) {
      return trimmed.replace(/^((?:mysql|mariadb):)\/(?!\/)/i, "$1//");
    }
    if (/^(mysql|mariadb):\/\//i.test(trimmed)) {
      return trimmed;
    }
    if (!trimmed.includes("://")) {
      const prefix = provider === "mariadb" ? "mariadb://" : "mysql://";
      return `${prefix}${trimmed}`;
    }
    return trimmed;
  };

  const parsePostgresConnectionString = (conn: string) => {
    const trimmed = normalizePgConnectionString(conn);
    if (!trimmed) return null;
    try {
      // Force it to use http:// protocol temporarily for parsing authority (host, port, username, password)
      const parseableString = trimmed.replace(
        /^postgres(?:ql)?:\/\//i,
        "http://",
      );
      let parsed = new URL(parseableString);
      if (!parsed.hostname) {
        const pathCandidate = decodeURIComponent(
          String(parsed.pathname || "").replace(/^\/+/, ""),
        );
        const match = pathCandidate.match(
          /^([^:/]+):([^@]*)@([^:/]+):(\d+)\/(.+)$/,
        );
        if (match) {
          parsed = new URL(
            `http://${encodeURIComponent(match[1])}:${encodeURIComponent(match[2])}@${match[3]}:${match[4]}/${encodeURIComponent(match[5])}`,
          );
        }
      }
      if (!parsed.hostname) return null;
      const ssl = (
        parsed.searchParams.get("sslmode") || "prefer"
      ).toLowerCase();
      const allowedSsl: PgSslMode[] = [
        "disable",
        "prefer",
        "require",
        "verify-ca",
        "verify-full",
      ];
      return {
        host: parsed.hostname || "localhost",
        port: parsed.port || "5432",
        database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
        username: decodeURIComponent(parsed.username || "postgres"),
        password: decodeURIComponent(parsed.password || ""),
        sslMode: allowedSsl.includes(ssl as PgSslMode)
          ? (ssl as PgSslMode)
          : "prefer",
        sshMode: (parsed.searchParams.get("rexadb_ssh_mode") === "ssh"
          ? "ssh"
          : "off") as PgSshMode,
        sshHost: parsed.searchParams.get("rexadb_ssh_host") || "192.168.1.1",
        sshPort: parsed.searchParams.get("rexadb_ssh_port") || "22",
        sshUsername: parsed.searchParams.get("rexadb_ssh_user") || "ubuntu",
        sshAuthMode: (parsed.searchParams.get("rexadb_ssh_auth") ===
        "private-key"
          ? "private-key"
          : "password") as PgSshAuthMode,
        sshPassword: parsed.searchParams.get("rexadb_ssh_password") || "",
        sshPrivateKey: parsed.searchParams.get("rexadb_ssh_private_key") || "",
      };
    } catch {
      return null;
    }
  };

  const parseTursoConnectionString = (conn: string) => {
    const trimmed = conn.trim();
    if (!trimmed) return null;
    try {
      const parseableString = trimmed.replace(/^libsql:\/\//i, "http://");
      const parsed = new URL(parseableString);
      const pathname =
        parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
      return {
        endpoint: `${parsed.host}${pathname}`,
        authToken:
          parsed.searchParams.get("authToken") ||
          parsed.searchParams.get("auth_token") ||
          "",
      };
    } catch {
      return null;
    }
  };

  const getTrinoDisplayUrl = (connectionString: string) => {
    try {
      const parsed = new URL(connectionString);
      const pathname = parsed.pathname || "";
      if (parsed.protocol === "trino+https:") {
        if (pathname.startsWith("//")) {
          return `https://${pathname.replace(/^\/+/, "")}`;
        }
        return `https://${parsed.host}${pathname}`;
      }
      if (parsed.protocol === "trino+http:") {
        if (pathname.startsWith("//")) {
          return `http://${pathname.replace(/^\/+/, "")}`;
        }
        return `http://${parsed.host}${pathname}`;
      }
      if (parsed.protocol === "trino:") {
        if (pathname.startsWith("//")) {
          return `http://${pathname.replace(/^\/+/, "")}`;
        }
        return `http://${parsed.host}${pathname}`;
      }
    } catch {}
    return connectionString;
  };

  const buildConnectionName = (
    conn: string,
    selectedProvider: ConnectionProvider | null,
  ): string => {
    const providerLabel =
      providerCards.find((card) => card.id === selectedProvider)?.label ??
      "PostgreSQL";
    return providerLabel;
  };

  const buildConnectionNameFromDetails = (
    conn: string,
    selectedProvider: ConnectionProvider | null,
  ): string => {
    const providerLabel =
      providerCards.find((card) => card.id === selectedProvider)?.label ??
      "PostgreSQL";
    const trimmed = conn.trim();
    if (!trimmed) return providerLabel;
    if (selectedProvider === "sqlite") {
      if (trimmed === ":memory:") return "SQLite • :memory:";
      const normalized = trimmed
        .replace(/^sqlite:\/*/i, "")
        .replace(/^file:\/*/i, "");
      const parts = normalized.split("/").filter(Boolean);
      const fileName = parts[parts.length - 1] || "database.db";
      return `SQLite • ${fileName}`;
    }
    if (selectedProvider === "turso") {
      try {
        const parsed = new URL(trimmed.replace(/^libsql:\/\//i, "http://"));
        return `Turso • ${parsed.hostname || "database"}`;
      } catch {
        return "Turso Connection";
      }
    }
    if (selectedProvider === "federated") {
      try {
        const parsed = parseFederatedConnectionString(trimmed);
        return `Federated • ${parsed.sources.length} source${parsed.sources.length === 1 ? "" : "s"}`;
      } catch {
        return "Federated Connection";
      }
    }
    if (selectedProvider === "jdbc") {
      try {
        const parsed = new URL(trimmed);
        const jdbcUrl = parsed.searchParams.get("jdbcUrl") || "";
        const driverClass = parsed.searchParams.get("driverClass") || "";
        const dbMatch = jdbcUrl.match(/\/([^/?]+)(\?|$)/);
        const dbName = dbMatch ? dbMatch[1] : "database";
        const driverShort = driverClass.split(".").pop() || driverClass;
        return `JDBC • ${dbName} (${driverShort})`;
      } catch {
        return "JDBC Connection";
      }
    }
    try {
      const httpEquivalent = trimmed.replace(
        /^[a-zA-Z0-9+.-]+:\/\//i,
        "http://",
      );
      const parsed = new URL(httpEquivalent);
      const host = parsed.hostname.replace(/^db\./, "");
      const db = parsed.pathname.replace("/", "") || "database";
      return `${providerLabel} • ${host}/${db}`;
    } catch {
      return providerLabel;
    }
  };

  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionGroups, setConnectionGroups] = useState<any[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [name, setName] = useState("");
  const [connectionString, setConnectionString] = useState("");
  const [environment, setEnvironment] = useState<
    "production" | "staging" | "local" | null
  >(null);
  const [color, setColor] = useState<string | null>(null);
  const [groups, setGroups] = useState<string[]>([]);
  const [folderPopoverOpen, setFolderPopoverOpen] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [lastActive, setLastActive] = useState<number | null>(null);
  const [selectedProvider, setSelectedProvider] =
    useState<ConnectionProvider | null>(null);
  const [loading, setLoading] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionFailureDialog, setConnectionFailureDialog] =
    useState<ConnectionFailureDialogState>({
      open: false,
      title: "Connection failed",
      connectionName: "",
      message: "",
      error: "",
    });
  const [showPassword, setShowPassword] = useState(false);
  const [pgHost, setPgHost] = useState("localhost");
  const [pgPort, setPgPort] = useState("5432");
  const [pgDatabase, setPgDatabase] = useState("");
  const [pgUsername, setPgUsername] = useState("postgres");
  const [pgPassword, setPgPassword] = useState("");
  const [pgSslMode, setPgSslMode] = useState<PgSslMode>("disable");
  const [pgEnableKeychain, setPgEnableKeychain] = useState(true);
  const [pgSshMode, setPgSshMode] = useState<PgSshMode>("off");
  const [pgSshHost, setPgSshHost] = useState("192.168.1.1");
  const [pgSshPort, setPgSshPort] = useState("22");
  const [pgSshUsername, setPgSshUsername] = useState("ubuntu");
  const [pgSshAuthMode, setPgSshAuthMode] = useState<PgSshAuthMode>("password");
  const [pgSshPassword, setPgSshPassword] = useState("");
  const [pgSshPrivateKey, setPgSshPrivateKey] = useState("");
  const [pgSshEnableKeychain, setPgSshEnableKeychain] = useState(true);
  const [showSshPassword, setShowSshPassword] = useState(false);
  const [tursoEndpoint, setTursoEndpoint] = useState("");
  const [tursoAuthToken, setTursoAuthToken] = useState("");
  const [federatedSources, setFederatedSources] = useState<
    Array<{ alias: string; connectionId: number; namespace: string }>
  >([]);
  const [fieldValues, setFieldValues] = useState<ConnectionFieldValues | null>(
    null,
  );

  const [jdbcUrl, setJdbcUrl] = useState("");
  const [jdbcDriverClass, setJdbcDriverClass] = useState("");
  const [jdbcUsername, setJdbcUsername] = useState("");
  const [jdbcPassword, setJdbcPassword] = useState("");
  const [jdbcJarPaths, setJdbcJarPaths] = useState<string[]>([]);
  const [jdbcDriverManagerOpen, setJdbcDriverManagerOpen] = useState(false);
  const [pendingInstallDriver, setPendingInstallDriver] =
    useState<JdbcDriverTemplate | null>(null);
  const [installPromptOpen, setInstallPromptOpen] = useState(false);

  const [viewMode, setViewMode] = useState<"card" | "table">("card");
  const [searchQuery, setSearchQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState<string[]>([]);
  const [folderFilter, setFolderFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"name" | "recent">("name");
  const commandShortcut = useMemo(() => {
    const combo = getKeybindingCombo(getDefaultKeybindings(), "TOGGLE_COMMAND_MENU");
    return combo ? formatShortcutForPlatform(combo) : "⌘K";
  }, []);
  const [connectionScreen, setConnectionScreen] = useState<ConnectionScreen>(
    initialScreen ?? "list",
  );
  const [openingConnectionId, setOpeningConnectionId] = useState<number | null>(
    null,
  );
  const [editingConnection, setEditingConnection] = useState<Connection | null>(
    null,
  );
  const [selectedConnectionIndex, setSelectedConnectionIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const connectionFormRef = useRef<HTMLFormElement | null>(null);
  const connectionStringInputRef = useRef<HTMLInputElement | null>(null);
  const [providerFocusIndex, setProviderFocusIndex] = useState(0);
  const connectionsListRef = useRef<HTMLDivElement | null>(null);
  const [draggingConnectionId, setDraggingConnectionId] = useState<
    number | null
  >(null);
  const [dragOverConnectionId, setDragOverConnectionId] = useState<
    number | null
  >(null);
  const dragReorderActiveRef = useRef(false);
  const [commandMenuOpen, setCommandMenuOpen] = useState(false);
  const [commandMenuQuery, setCommandMenuQuery] = useState("");
  const commandMenuInputRef = useRef<HTMLInputElement | null>(null);
  const [supabaseLoginOpen, setSupabaseLoginOpen] = useState(false);
  const [supabaseAccounts, setSupabaseAccounts] = useState<SupabaseMgmtAccount[]>(
    () => (typeof window === "undefined" ? [] : getMgmtAccounts()),
  );
  const [activeSupabaseAccountId, setActiveSupabaseAccountId] = useState<
    string | null
  >(
    () =>
      typeof window === "undefined"
        ? null
        : (getMgmtAccounts()[0]?.id ?? null),
  );
  const [spacetimedbLoginOpen, setSpacetimedbLoginOpen] = useState(false);
  const [spacetimedbAccounts, setSpacetimedbAccounts] = useState<
    SpacetimeDbMgmtAccount[]
  >(
    () =>
      typeof window === "undefined" ? [] : getSpacetimeDbMgmtAccounts(),
  );
  const [activeSpacetimeDbAccountId, setActiveSpacetimeDbAccountId] = useState<
    string | null
  >(
    () =>
      typeof window === "undefined"
        ? null
        : (getSpacetimeDbMgmtAccounts()[0]?.id ?? null),
  );
  const [neonLoginOpen, setNeonLoginOpen] = useState(false);
  const [neonAccounts, setNeonAccounts] = useState<NeonCliAccount[]>(
    () => (typeof window === "undefined" ? [] : getNeonCliAccounts()),
  );
  const [activeNeonAccountId, setActiveNeonAccountId] = useState<
    string | null
  >(
    () =>
      typeof window === "undefined" ? null : (getNeonCliAccounts()[0]?.id ?? null),
  );
  const [neonCliInstalled, setNeonCliInstalled] = useState<boolean | null>(null);
  const [neonCliChecking, setNeonCliChecking] = useState(false);
  const [neonReconnectProfile, setNeonReconnectProfile] = useState<string | null>(null);
  const [neonReloadSignal, setNeonReloadSignal] = useState(0);
  const [planetscaleLoginOpen, setPlanetscaleLoginOpen] = useState(false);
  const [planetscaleAccounts, setPlanetscaleAccounts] = useState<PlanetscaleAccount[]>(
    () => (typeof window === "undefined" ? [] : getPlanetscaleAccounts()),
  );
  const [activePlanetscaleAccountId, setActivePlanetscaleAccountId] = useState<
    string | null
  >(
    () =>
      typeof window === "undefined" ? null : (getPlanetscaleAccounts()[0]?.id ?? null),
  );
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [authResolved, setAuthResolved] = useState(false);
  const [localMode, setLocalMode] = useState(false);
  const cloudSyncEnabledKey = "rexa-db-cloud-sync-enabled";
  const cloudSyncKeyStorage = "rexa-db-cloud-sync-key";

  const reportRendererError = useCallback((context: string, error: unknown) => {
    const payload = {
      context,
      error:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : error,
    };
    try {
      console.error("[cloud-sync]", payload);
    } catch {
      // ignore
    }
    try {
      console.log("[debug:renderer]", payload);
    } catch {
      // ignore
    }
  }, []);
  const [localDisplayName, setLocalDisplayName] = useState("");
  const [manageMenuOpen, setManageMenuOpen] = useState(false);
  const [reorderMode, setReorderMode] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [roles, setRoles] = useState<Role[]>([]);
  const [formAccess, setFormAccess] = useState<Record<string, AccessType>>({});
  const [isFolderDeleteDialogOpen, setIsFolderDeleteDialogOpen] =
    useState(false);
  const [isFolderPromptOpen, setIsFolderPromptOpen] = useState(false);
  const [folderPromptMode, setFolderPromptMode] = useState<"add" | "rename">(
    "add",
  );
  const [folderPromptValue, setFolderPromptValue] = useState("");
  const [folderToManage, setFolderToManage] = useState<string | null>(null);
  const [deleteOption, setDeleteOption] = useState<
    "with-connections" | "keep-connections"
  >("keep-connections");
  const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
  const [cloudSyncLoading, setCloudSyncLoading] = useState(false);
  const [cloudSyncError, setCloudSyncError] = useState<string | null>(null);
  const [cloudSyncKey, setCloudSyncKey] = useState<string | null>(null);
  const [cloudSyncKeyInput, setCloudSyncKeyInput] = useState("");
  const [lastCloudSyncAt, setLastCloudSyncAt] = useState<number | null>(null);
  const cloudSyncTimerRef = useRef<number | null>(null);
  const supabaseImportReloadTimerRef = useRef<number | null>(null);
  const cloudSyncInFlightRef = useRef(false);
  const [isThemeCreatorOpen, setIsThemeCreatorOpen] = useState(false);

  const selectedAppTheme = useMemo(() => {
    if (appTheme.appThemeId === "system") return null;
    return (
      appTheme.customAppThemes.find((t) => t.id === appTheme.appThemeId) ||
      BUILTIN_APP_THEMES.find((t) => t.id === appTheme.appThemeId) ||
      null
    );
  }, [appTheme.appThemeId, appTheme.customAppThemes]);

  const [handleOpenThemeCreator, handleCloseThemeCreator] = useToggleHandlers(setIsThemeCreatorOpen);

  const handleSaveTheme = useCallback(
    (theme: CustomAppTheme) => {
      appTheme.setCustomAppThemes([...appTheme.customAppThemes, theme]);
      appTheme.setAppThemeId(theme.id);
    },
    [appTheme],
  );

  useEffect(() => {
    if (!selectedAppTheme && isThemeCreatorOpen) {
      setIsThemeCreatorOpen(false);
    }
  }, [selectedAppTheme, isThemeCreatorOpen]);

  const [isIconThemeCreatorOpen, setIsIconThemeCreatorOpen] = useState(false);

  const [handleOpenIconThemeCreator, handleCloseIconThemeCreator] = useToggleHandlers(setIsIconThemeCreatorOpen);

  const handleSaveIconTheme = useCallback(
    (theme: CustomIconTheme) => {
      setCustomIconThemes([...customIconThemes, theme]);
      setIconThemeId(theme.id);
    },
    [setCustomIconThemes, customIconThemes, setIconThemeId],
  );

  const [workspaceMode, setWorkspaceMode] = useState(false);
  const [workspaceAuthLoaded, setWorkspaceAuthLoaded] = useState(false);
  const [workspacePermissions, setWorkspacePermissions] = useState<string[]>(
    [],
  );
  const [credentialsDialog, setCredentialsDialog] = useState<{
    open: boolean;
    conn: Connection | null;
    data: {
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
      connectionString: string;
    } | null;
    loading: boolean;
  }>({ open: false, conn: null, data: null, loading: false });

  const connectionsRef = useRef<Connection[]>([]);
  const cloudSyncKeyRef = useRef<string | null>(null);
  const can = useCallback(
    (permission: string): boolean => {
      if (!workspaceMode) return true;
      return workspacePermissions.includes(permission);
    },
    [workspaceMode, workspacePermissions],
  );
  const {
    isMaximized,
    sendWindowAction,
    canUseDesktop,
    isMac: isMacDesktopApp,
  } = useDesktopWindow();
  const {
    entitlement,
    loading: planLoading,
    refreshIfStale,
  } = useEntitlementState({
    userId: isSessionActive ? (user?.id ?? null) : null,
    accessToken,
    isSessionActive,
  });
  const plan: PlanEntitlements = {
    code: (entitlement.effectivePlanCode || "free") as PlanCode,
    label: entitlement.label || "Free",
    cloudEnabled: entitlement.cloudEnabled,
    maxConnections: entitlement.maxConnections,
    updatesUntil: entitlement.updatesUntil,
  };
  const sidecarFetch = useCallback(
    async (path: string, options?: RequestInit) => {
      try {
        const res = await fetch(`${API_BASE}${path}`, {
          headers: { "Content-Type": "application/json" },
          ...options,
        });
        return await res.json();
      } catch {
        return { success: false, error: "Sidecar unavailable." };
      }
    },
    [],
  );

  // fallow-ignore-next-line code-duplication
  const PRIVATE_HOST_PATTERNS = [
    (s: string) => s === "localhost",

    (s: string) => s === "::1",
    (s: string) => /^127\./.test(s),
    (s: string) => /^10\./.test(s),
    (s: string) => /^192\.168\./.test(s),
    (s: string) => /^172\.(1[6-9]|2\d|3[0-1])\./.test(s),
    (s: string) => s.endsWith(".local"),
  ] as const;

  // fallow-ignore-next-line code-duplication
  const PRIVATE_STR_PATTERNS = [
    (s: string) => s.includes("localhost"),

    (s: string) => s.includes("::1"),
    (s: string) => /\b127\./.test(s),
    (s: string) => /\b10\./.test(s),
    (s: string) => /\b192\.168\./.test(s),
    (s: string) => /172\.(1[6-9]|2\d|3[0-1])\./.test(s),
    (s: string) => s.includes(".local"),
  ] as const;

  const isLocalOrPrivateHost = useCallback((host: string) => {
    const normalized = host
      .trim()
      .toLowerCase()
      .replace(/^\[|\]$/g, "");
    if (!normalized) return false;
    return PRIVATE_HOST_PATTERNS.some((fn) => fn(normalized));
  }, []);

  const extractHostFromConnection = useCallback(
    (conn: string, provider: ConnectionProvider | null) => {
      if (!conn || !provider) return "";
      let normalized = conn;
      if (
        provider === "postgresql" ||
        provider === "timescale" ||
        provider === "supabase" ||
        provider === "neon" ||
        provider === "planetscale" ||
        provider === "cockroachdb" ||
        provider === "yugabytedb" ||
        provider === "redshift"
      ) {
        normalized = normalizePgConnectionString(conn);
      } else if (provider === "mysql" || provider === "mariadb") {
        normalized = normalizeMysqlConnectionString(conn, provider);
      }

      const match = normalized.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
      if (!match?.[1]) return "";
      let hostPort = match[1];
      if (hostPort.includes("@")) {
        hostPort = hostPort.split("@").pop() || hostPort;
      }
      if (hostPort.startsWith("[")) {
        const end = hostPort.indexOf("]");
        if (end !== -1) return hostPort.slice(1, end);
      }
      if (hostPort.includes(":")) return hostPort.split(":")[0];
      return hostPort;
    },
    [],
  );

  const inferLocalHostFromString = useCallback((conn: string) => {
    const normalized = conn.trim().toLowerCase();
    if (!normalized) return false;
    return PRIVATE_STR_PATTERNS.some((fn) => fn(normalized));
  }, []);

  const enforceConnectionEntitlements = useCallback(
    async (
      candidateConn: string,
      provider: ConnectionProvider | null,
      opts?: { enforceLimit?: boolean },
    ) => {
      const shouldEnforceLimit = opts?.enforceLimit ?? true;
      const currentEntitlement = await refreshIfStale("premium-action");
      if (
        shouldEnforceLimit &&
        currentEntitlement.maxConnections !== null &&
        connections.length >= currentEntitlement.maxConnections
      ) {
        toast.error(
          `Your ${currentEntitlement.label} plan allows up to ${currentEntitlement.maxConnections} saved connections.`,
        );
        return false;
      }
      return true;
    },
    [connections.length, refreshIfStale],
  );

  useEffect(() => {
    document.title = "Manage Connections";
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedName = loadStoredDisplayName();
    if (storedName) {
      setLocalDisplayName(storedName);
    }
  }, []);

  useEffect(() => {
    if (!workspaceMode) return;
    (async () => {
      try {
        const res = await studioApi.get<{ data: Role[] }>("/roles");
        setRoles(res.data || []);
      } catch {
        // workspace mode not available
      }
    })();
  }, [workspaceMode]);

  const fetchConnections = useCallback(async (): Promise<Connection[]> => {
    if (workspaceMode) {
      try {
        const res = await studioApi.get<{
          data: Array<{
            id: string;
            name: string;
            type: string;
            host: string;
            port: number;
            database: string;
            username: string;
          }>;
        }>("/connections");
        return (res.data || []).map((c) => {
          const connStr = `workspace:${c.id}`;
          return {
            id: c.id as unknown as number,
            name: c.name,
            connectionString: connStr,
            connectionType: c.type,
            createdAt: new Date(),
            sortOrder: null,
            environment: null,
            color: null,
            group: null,
            isFavorite: null,
            lastActive: null,
          } as Connection;
        });
      } catch {
        return [];
      }
    }
    try {
      const local = (await getConnections()) ?? [];
      return local.filter(
        (c: any) => !c.connectionString?.startsWith("workspace:"),
      );
    } catch {
      return [];
    }
  }, [workspaceMode]);

  const fetchConnectionGroups = useCallback(async (): Promise<any[]> => {
    if (workspaceMode) return [];
    try {
      const res = await sidecarFetch("/api/connections/groups");
      if (res.success && Array.isArray(res.groups)) return res.groups;
    } catch {
      /* ignore */
    }
    return [];
  }, [workspaceMode]);

  const createConnection = async (payload: {
    name: string;
    connectionString: string;
    connectionType?: string;
    maxConnections?: number | null;
    environment?: string | null;
    color?: string | null;
    group?: string | null;
    groups?: string[];
    isFavorite?: boolean;
    lastActive?: number | null;
    host?: string;
    port?: string;
    database?: string;
    username?: string;
    password?: string;
    sslMode?: string;
    authToken?: string;
  }) => {
    if (workspaceMode) {
      try {
        const type =
          payload.connectionType === "mysql"
            ? "mysql"
            : payload.connectionType === "jdbc"
              ? "jdbc"
              : "postgres";
        const parsed = parsePostgresConnectionString(payload.connectionString);
        const host = parsed?.host || pgHost || "localhost";
        const port =
          parsed?.port || pgPort || (type === "mysql" ? "3306" : "5432");
        const database = parsed?.database || pgDatabase || "postgres";
        const username = parsed?.username || pgUsername || "postgres";
        const password = parsed?.password || pgPassword || "";
        const ssl = pgSslMode === "require" || pgSslMode === "verify-full";
        const createdRes = await studioApi.post("/connections", {
          name: payload.name,
          type,
          host,
          port: Number(port),
          database,
          username,
          password,
          ssl,
        });
        const createdId =
          (createdRes as any)?.data?.id ?? (createdRes as any)?.id;
        return { success: true, id: createdId };
      } catch (err) {
        return {
          success: false,
          error:
            err instanceof Error ? err.message : "Failed to create connection",
        };
      }
    }
    return await sidecarFetch("/api/connections", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  };

  const updateConnection = async (
    id: number,
    payload: Partial<{
      name: string;
      connectionString: string;
      connectionType?: string;
      environment?: string | null;
      color?: string | null;
      group?: string | null;
      groups?: string[];
      isFavorite?: boolean;
      lastActive?: number | null;
      host?: string;
      port?: string;
      database?: string;
      username?: string;
      password?: string;
      sslMode?: string;
      authToken?: string;
    }>,
  ) => {
    if (workspaceMode) {
      try {
        const updates: Record<string, unknown> = {};
        if (payload.name) updates.name = payload.name;
        if (payload.connectionString) {
          const parsed = parsePostgresConnectionString(
            payload.connectionString,
          );
          updates.host = parsed?.host || pgHost || "localhost";
          updates.port = Number(parsed?.port || pgPort || 5432);
          updates.database = parsed?.database || pgDatabase || "postgres";
          updates.username = parsed?.username || pgUsername || "postgres";
        }
        await studioApi.put(`/connections/${id}`, updates);
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error:
            err instanceof Error ? err.message : "Failed to update connection",
        };
      }
    }
    return await sidecarFetch(`/api/connections/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  };

  const removeConnection = async (id: number) => {
    if (workspaceMode) {
      try {
        await studioApi.del(`/connections/${id}`);
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error:
            err instanceof Error ? err.message : "Failed to delete connection",
        };
      }
    }
    return await sidecarFetch(`/api/connections/${id}`, { method: "DELETE" });
  };

  const updateConnectionOrder = async (orderedIds: number[]) => {
    return await sidecarFetch("/api/connections/reorder", {
      method: "POST",
      body: JSON.stringify({ orderedIds }),
    });
  };

  const testConnection = async (payload: {
    connectionString: string;
    connectionType?: string;
  }) => {
    return await sidecarFetch("/api/connections/test", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  };

  const buildPostgresConnectionString = useCallback(() => {
    const host = pgHost.trim() || "localhost";
    const port = pgPort.trim() || "5432";
    const username = pgUsername.trim();
    const password = pgPassword;
    const database = pgDatabase.trim();
    const auth = username
      ? `${encodeURIComponent(username)}${password ? `:${encodeURIComponent(password)}` : ""}@`
      : "";
    const pathname = database ? `/${encodeURIComponent(database)}` : "";
    const searchParams = new URLSearchParams();
    searchParams.set("uselibpqcompat", "true");
    searchParams.set("sslmode", pgSslMode);
    searchParams.set("rexadb_keychain_db", pgEnableKeychain ? "1" : "0");
    searchParams.set("rexadb_ssh_mode", pgSshMode);
    if (pgSshMode === "ssh") {
      searchParams.set("rexadb_ssh_host", pgSshHost.trim());
      searchParams.set("rexadb_ssh_port", pgSshPort.trim() || "22");
      searchParams.set("rexadb_ssh_user", pgSshUsername.trim());
      searchParams.set("rexadb_ssh_auth", pgSshAuthMode);
      searchParams.set("rexadb_ssh_keychain", pgSshEnableKeychain ? "1" : "0");
      if (pgSshAuthMode === "password") {
        searchParams.set("rexadb_ssh_password", pgSshPassword);
      } else {
        searchParams.set("rexadb_ssh_private_key", pgSshPrivateKey);
      }
    }
    return `postgresql://${auth}${host}:${port}${pathname}?${searchParams.toString()}`;
  }, [
    pgDatabase,
    pgEnableKeychain,
    pgHost,
    pgPassword,
    pgPort,
    pgSshAuthMode,
    pgSshEnableKeychain,
    pgSshHost,
    pgSshMode,
    pgSshPassword,
    pgSshPort,
    pgSshPrivateKey,
    pgSshUsername,
    pgSslMode,
    pgUsername,
  ]);

  const buildTursoConnectionString = useCallback(() => {
    const endpoint = tursoEndpoint
      .trim()
      .replace(/^libsql:\/\//i, "")
      .replace(/^https?:\/\//i, "");
    const token = tursoAuthToken.trim();
    if (!endpoint) return "";
    const base = `libsql://${endpoint}`;
    if (!token) return base;
    const searchParams = new URLSearchParams();
    searchParams.set("authToken", token);
    return `${base}?${searchParams.toString()}`;
  }, [tursoAuthToken, tursoEndpoint]);

  const buildGenericConnectionString = useCallback(() => {
    if (!selectedProvider || !isFieldBasedProvider(selectedProvider)) {
      return "";
    }
    if (!fieldValues) return "";
    return buildConnectionStringFromFields(
      selectedProvider as FieldProviderId,
      fieldValues,
    );
  }, [fieldValues, selectedProvider]);

  const getCandidateConnectionString = useCallback(() => {
    if (selectedProvider === "postgresql") {
      return buildPostgresConnectionString().trim();
    }
    if (selectedProvider === "turso") {
      return buildTursoConnectionString().trim() || connectionString.trim();
    }
    if (selectedProvider === "federated") {
      try {
        return buildFederatedConnectionString({
          version: 1,
          sources: federatedSources,
        });
      } catch {
        return "";
      }
    }
    if (selectedProvider === "jdbc") {
      if (!jdbcUrl) return "";
      const raw = jdbcUrl.trim();
      const jdbcUrlFinal = raw.startsWith("jdbc:") ? raw : `jdbc:${raw}`;
      const detected = detectDriverClass(jdbcUrlFinal);
      const dc = jdbcDriverClass || detected;
      const params = new URLSearchParams();
      params.set("jdbcUrl", jdbcUrlFinal);
      if (dc) params.set("driverClass", dc);
      if (jdbcUsername) params.set("user", jdbcUsername);
      if (jdbcPassword) params.set("password", jdbcPassword);
      if (jdbcJarPaths.length > 0)
        params.set("jarPaths", jdbcJarPaths.join(","));
      return `jdbc://?${params.toString()}`;
    }
    if (selectedProvider && isFieldBasedProvider(selectedProvider)) {
      const built = buildGenericConnectionString().trim();
      return built || connectionString.trim();
    }
    return connectionString.trim();
  }, [
    buildPostgresConnectionString,
    buildTursoConnectionString,
    connectionString,
    federatedSources,
    selectedProvider,
    jdbcUrl,
    jdbcDriverClass,
    jdbcUsername,
    jdbcPassword,
    jdbcJarPaths,
    buildGenericConnectionString,
  ]);

  const resetConnectionDraft = () => {
    setEditingConnection(null);
    setName("");
    setConnectionString("");
    setEnvironment(null);
    setColor(null);
    setGroups([]);
    setIsFavorite(false);
    setLastActive(null);
    setSelectedProvider(null);
    setShowPassword(false);
    setPgHost("localhost");
    setPgPort("5432");
    setPgDatabase("");
    setPgUsername("postgres");
    setPgPassword("");
    setPgSslMode("prefer");
    setPgEnableKeychain(true);
    setPgSshMode("off");
    setPgSshHost("192.168.1.1");
    setPgSshPort("22");
    setPgSshUsername("ubuntu");
    setPgSshAuthMode("password");
    setPgSshPassword("");
    setPgSshPrivateKey("");
    setPgSshEnableKeychain(true);
    setShowSshPassword(false);
    setTursoEndpoint("");
    setTursoAuthToken("");
    setFederatedSources([]);
    setFieldValues(null);
    setJdbcUrl("");
    setJdbcDriverClass("");
    setJdbcUsername("");
    setJdbcPassword("");
    setJdbcJarPaths([]);
    setJdbcDriverManagerOpen(false);
    setFormAccess({});
  };

  const federatedConfigError =
    selectedProvider === "federated"
      ? federatedSources.map(getFederatedDraftError).find(Boolean) ||
        (() => {
          try {
            buildFederatedConnectionString({
              version: 1,
              sources: federatedSources,
            });
            return "";
          } catch (error) {
            return error instanceof Error
              ? error.message
              : "Federated sources are invalid.";
          }
        })()
      : "";

  const loadConnections = async () => {
    setConnectionsLoading(true);
    try {
      const [conns, groups] = await Promise.all([
        fetchConnections(),
        fetchConnectionGroups(),
      ]);
      setConnections(conns);
      setConnectionGroups(groups);
    } finally {
      // Always clear the loading gate, even on an unexpected failure —
      // otherwise the whole page hangs on the loading state forever.
      setConnectionsLoading(false);
    }
  };

  const canUseCloudSync = Boolean(user && plan.cloudEnabled && !localMode);

  const listCloudConnections = useCallback(async () => {
    const { data, error } = await supabase
      .from("cloud_connections")
      .select("id, name, encrypted_connection, iv, salt, sort_order")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }, []);

  const tryBeginCloudSync = (): boolean => {
    if (!canUseCloudSync || !cloudSyncKeyRef.current) return false;
    if (cloudSyncInFlightRef.current) return false;
    cloudSyncInFlightRef.current = true;
    setCloudSyncLoading(true);
    setCloudSyncError(null);
    return true;
  };

  const pushLocalConnectionsToCloud = useCallback(async () => {
    if (!tryBeginCloudSync()) return;
    try {
      const localConnections = connectionsRef.current;
      const cloudConnections = await listCloudConnections();
      const localNames = new Set(localConnections.map((conn) => conn.name));
      await Promise.all(
        cloudConnections
          .filter((row: any) => !localNames.has(row.name))
          .map((row: any) =>
            supabase.rpc("delete_cloud_connection", { p_id: row.id }),
          ),
      );

      for (let i = 0; i < localConnections.length; i += 1) {
        const conn = localConnections[i];
        const { encrypted, iv, salt } = await encryptConnectionString(
          cloudSyncKeyRef.current!,
          conn.connectionString,
        );
        const { error } = await supabase.rpc("save_cloud_connection", {
          p_id: null,
          p_name: conn.name,
          p_encrypted_connection: encrypted,
          p_iv: iv,
          p_salt: salt,
          p_sort_order: i,
        });
        if (error) throw error;
      }
      setLastCloudSyncAt(Date.now());
    } catch (error: any) {
      reportRendererError("pushLocalConnectionsToCloud", error);
      setCloudSyncError(fmtErr(error, "Failed to sync connections."));
    } finally {
      cloudSyncInFlightRef.current = false;
      setCloudSyncLoading(false);
    }
  }, [canUseCloudSync, listCloudConnections]);

  const pullCloudConnections = useCallback(async () => {
    if (!tryBeginCloudSync()) return;
    try {
      const cloudConnections = await listCloudConnections();
      const localConnections = connectionsRef.current;
      const localNames = new Set(localConnections.map((conn) => conn.name));
      let created = 0;
      for (const row of cloudConnections) {
        if (localNames.has(row.name)) continue;
        const connectionString = await decryptConnectionString(
          cloudSyncKeyRef.current!,
          row.encrypted_connection,
          row.iv,
          row.salt,
        );
        const res = await createConnection({
          name: row.name,
          connectionString,
          connectionType: detectProvider(connectionString, null) ?? undefined,
          maxConnections: plan.maxConnections,
        });
        if (res.success) {
          created += 1;
        }
      }
      if (created > 0) {
        await loadConnections();
      }
      setLastCloudSyncAt(Date.now());
    } catch (error: any) {
      reportRendererError("pullCloudConnections", error);
      setCloudSyncError(fmtErr(error, "Failed to sync connections."));
    } finally {
      cloudSyncInFlightRef.current = false;
      setCloudSyncLoading(false);
    }
  }, [canUseCloudSync, listCloudConnections, plan.maxConnections]);

  const runInitialCloudSync = useCallback(async () => {
    if (!canUseCloudSync || !cloudSyncKeyRef.current) return;
    setCloudSyncLoading(true);
    setCloudSyncError(null);
    try {
      const cloudConnections = await listCloudConnections();
      const localConnections = connectionsRef.current;
      if (localConnections.length === 0 && cloudConnections.length > 0) {
        await pullCloudConnections();
      } else if (localConnections.length > 0 && cloudConnections.length === 0) {
        await pushLocalConnectionsToCloud();
      } else if (localConnections.length > 0 && cloudConnections.length > 0) {
        await pullCloudConnections();
        await pushLocalConnectionsToCloud();
      }
    } catch (error: any) {
      reportRendererError("runInitialCloudSync", error);
      setCloudSyncError(fmtErr(error, "Failed to sync connections."));
    } finally {
      setCloudSyncLoading(false);
    }
  }, [
    canUseCloudSync,
    listCloudConnections,
    pullCloudConnections,
    pushLocalConnectionsToCloud,
  ]);

  const queueCloudPush = useCallback(() => {
    if (!canUseCloudSync || !cloudSyncKeyRef.current) return;
    if (cloudSyncTimerRef.current) {
      window.clearTimeout(cloudSyncTimerRef.current);
    }
    cloudSyncTimerRef.current = window.setTimeout(() => {
      void pushLocalConnectionsToCloud();
    }, 600);
  }, [canUseCloudSync, pushLocalConnectionsToCloud]);

  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);

  useEffect(() => {
    cloudSyncKeyRef.current = cloudSyncKey;
  }, [cloudSyncKey]);

  useEffect(() => {
    initStudioAuth()
      .then(() => {
        const auth = loadStudioAuth();
        const active =
          typeof window !== "undefined" &&
          window.sessionStorage.getItem("workspace:active") === "1";
        setWorkspaceMode(!!auth && active);
      })
      .catch(() => {
        // Fall through to non-workspace mode rather than hanging the whole
        // page's loading gate forever on a failed/unavailable auth check.
        setWorkspaceMode(false);
      })
      .finally(() => {
        setWorkspaceAuthLoaded(true);
      });
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.connected !== undefined) {
        setWorkspaceMode(!!detail.connected);
        setConnectionScreen("list");
        if (typeof window !== "undefined") {
          if (detail.connected) {
            window.sessionStorage.setItem("workspace:active", "1");
          } else {
            window.sessionStorage.removeItem("workspace:active");
            sidecarFetch("/api/connections/workspace", {
              method: "DELETE",
            }).catch(() => {});
          }
        }
      }
    };
    window.addEventListener("workspace:changed", handler);
    return () => window.removeEventListener("workspace:changed", handler);
  }, []);

  useEffect(() => {
    if (workspaceAuthLoaded) {
      void loadConnections();
      if (workspaceMode) {
        studioApi
          .get<{
            data: { permissions: Array<{ code: string; name: string }> };
          }>("/auth/me")
          .then((res) => {
            setWorkspacePermissions(
              (res.data?.permissions || []).map((p) => p.code),
            );
          })
          .catch(() => {
            setWorkspacePermissions([]);
          });
      } else {
        setWorkspacePermissions([]);
      }
    }
  }, [workspaceMode, workspaceAuthLoaded]);

  useEffect(() => {
    if (
      (connectionScreen === "new-form" || connectionScreen === "edit-form") &&
      selectedProvider === "postgresql"
    ) {
      setConnectionString((prev) =>
        prev.trim() ? prev : buildPostgresConnectionString(),
      );
    }
    if (
      (connectionScreen === "new-form" || connectionScreen === "edit-form") &&
      selectedProvider === "turso"
    ) {
      setConnectionString((prev) =>
        prev.trim() ? prev : buildTursoConnectionString(),
      );
    }
  }, [
    buildPostgresConnectionString,
    buildTursoConnectionString,
    connectionScreen,
    selectedProvider,
  ]);

  useEffect(() => {
    let mounted = true;

    const applyLocalFallback = async () => {
      const profileRes = await getStoredUserProfile();
      if (!mounted) return;

      setUser(null);
      setAccessToken(null);
      setIsSessionActive(false);
      setLocalMode(true);

      if (profileRes.success && profileRes.data) {
        const fallbackName = profileRes.data.name || "User";
        setLocalDisplayName(fallbackName);
        return;
      }

      const defaultLocalName =
        (typeof window !== "undefined" &&
          window.localStorage.getItem(LOCAL_NAME_STORAGE_KEY)?.trim()) ||
        "User";

      setLocalDisplayName(defaultLocalName);
      void activateLocalUserProfile(defaultLocalName).then((localResult) => {
        if (!mounted) return;
        if (!localResult.result.success) {
          console.error(
            "[AUTH TRACE] failed to activate local profile:",
            localResult.result.error,
          );
        }
      });
    };

    const applySessionUser = (sessionUser: User, token?: string | null) => {
      setUser(sessionUser);
      setAccessToken(token ?? null);
      setIsSessionActive(true);
      setLocalMode(false);
      void syncAuthenticatedUserProfile(sessionUser).then((syncedProfile) => {
        if (!mounted) return;
        if (!syncedProfile.result.success) {
          console.error(
            "[AUTH TRACE] failed to sync authenticated profile:",
            syncedProfile.result.error,
          );
          return;
        }
        setUser(syncedProfile.user);
      });
    };

    const hydrateUser = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!mounted) return;
        console.log(
          "[AUTH TRACE] getSession resolved, session:",
          !!data.session,
          "user:",
          data.session?.user?.email || "null",
        );

        if (data.session?.user) {
          applySessionUser(
            data.session.user,
            data.session.access_token ?? null,
          );
        } else {
          // Retry once after a short delay to allow async storage to settle
          console.log(
            "[AUTH TRACE] getSession returned null, retrying after delay...",
          );
          await new Promise((resolve) => setTimeout(resolve, 800));
          if (!mounted) return;
          const { data: retryData } = await supabase.auth.getSession();
          console.log(
            "[AUTH TRACE] getSession retry resolved, session:",
            !!retryData.session,
          );

          if (retryData.session?.user) {
            applySessionUser(
              retryData.session.user,
              retryData.session.access_token ?? null,
            );
          } else {
            await applyLocalFallback();
          }
        }
      } catch (error) {
        console.error("[AUTH TRACE] getSession failed:", error);
        await applyLocalFallback();
      } finally {
        if (mounted) {
          setAuthResolved(true);
        }
      }
    };

    void hydrateUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log(
        "[AUTH TRACE] onAuthStateChange fired, event:",
        _event,
        "hasSession:",
        !!session,
        "user:",
        session?.user?.email || "null",
      );
      if (!mounted) return;
      if (session?.user) {
        applySessionUser(session.user, session.access_token ?? null);
      } else {
        await applyLocalFallback();
      }
      if (mounted) {
        setAuthResolved(true);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!canUseCloudSync) {
      setCloudSyncEnabled(false);
      setCloudSyncKey(null);
      return;
    }
    if (typeof window === "undefined") return;
    const enabled = window.sessionStorage.getItem(cloudSyncEnabledKey) === "1";
    const storedKey = window.sessionStorage.getItem(cloudSyncKeyStorage);
    if (enabled && storedKey) {
      setCloudSyncEnabled(true);
      setCloudSyncKey(storedKey);
    }
  }, [canUseCloudSync, cloudSyncEnabledKey, cloudSyncKeyStorage]);

  useEffect(() => {
    if (!cloudSyncEnabled || !cloudSyncKey || !canUseCloudSync) return;
    void runInitialCloudSync();
    const intervalId = window.setInterval(() => {
      void pullCloudConnections();
    }, 60_000);
    return () => window.clearInterval(intervalId);
  }, [
    cloudSyncEnabled,
    cloudSyncKey,
    canUseCloudSync,
    pullCloudConnections,
    runInitialCloudSync,
  ]);

  const validateTursoCandidate = (candidate: string): boolean => {
    if (selectedProvider !== "turso") return true;
    const parsed = parseTursoConnectionString(candidate);
    if (!parsed?.endpoint) {
      toast.error("Turso endpoint is required.");
      return false;
    }
    if (!parsed.authToken.trim()) {
      toast.error("Turso auth token is required.");
      return false;
    }
    return true;
  };

  const getCloudSyncKeyOrWarn = (): string | null => {
    if (!canUseCloudSync) {
      toast.error("Upgrade to Pro or Team to enable cloud sync.");
      return null;
    }
    const key = cloudSyncKeyInput.trim();
    if (!key) {
      toast.error("Enter your encryption key.");
      return null;
    }
    return key;
  };

  const handleEnableCloudSync = async () => {
    const key = getCloudSyncKeyOrWarn();
    if (!key) return;
    try {
      setCloudSyncKey(key);
      setCloudSyncEnabled(true);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(cloudSyncEnabledKey, "1");
        window.sessionStorage.setItem(cloudSyncKeyStorage, key);
      }
      await runInitialCloudSync();
    } catch (error: any) {
      reportRendererError("handleEnableCloudSync", error);
      setCloudSyncError(fmtErr(error, "Failed to enable sync."));
    }
  };

  const handleFetchCloudConnections = async () => {
    const key = getCloudSyncKeyOrWarn();
    if (!key) return;
    setCloudSyncError(null);
    setCloudSyncKey(key);
    cloudSyncKeyRef.current = key;
    try {
      await pullCloudConnections();
    } catch (error: any) {
      reportRendererError("handleFetchCloudConnections", error);
      setCloudSyncError(fmtErr(error, "Failed to fetch connections."));
    }
  };

  const handleDisableCloudSync = () => {
    setCloudSyncEnabled(false);
    setCloudSyncKey(null);
    setCloudSyncKeyInput("");
    setCloudSyncError(null);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(cloudSyncEnabledKey);
      window.sessionStorage.removeItem(cloudSyncKeyStorage);
    }
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error(error.message);
      return;
    }

    const localResult = await activateLocalUserProfile(
      localDisplayName.trim() || "User",
    );
    if (!localResult.result.success) {
      toast.error(
        localResult.result.error ||
          "Signed out, but failed to restore local mode.",
      );
      return;
    }

    setUser(null);
    setIsSessionActive(false);
    setLocalMode(true);
    setLocalDisplayName(localResult.name);
    toast.success("Signed out.");
  };

  const handleOpenSettings = () => {
    setConnectionScreen("settings");
  };

  const handleUpgradeClick = () => {
    openExternalUrl(REXADB_UPGRADE_URL);
  };

  const handleAddSupabaseAccount = useCallback(() => {
    const check = canAddSupabaseAccount(
      entitlement.premiumActive,
      supabaseAccounts.length,
    );
    if (!check.allowed) {
      toast.error(
        "Free plan allows 1 linked Supabase account. Upgrade to Pro to link more.",
      );
      openExternalUrl(REXADB_UPGRADE_URL);
      return;
    }
    setSupabaseLoginOpen(true);
  }, [entitlement.premiumActive, supabaseAccounts.length]);

  const handleRemoveSupabaseAccount = useCallback((id: string) => {
    removeMgmtAccount(id);
    const next = getMgmtAccounts();
    setSupabaseAccounts(next);
    setActiveSupabaseAccountId((cur) => {
      if (cur !== id) return cur;
      return next[0]?.id ?? null;
    });
    if (next.length === 0) {
      if (onOpenSupabaseAccounts) onOpenSupabaseAccounts();
      else setConnectionScreen("supabase");
    }
  }, [onOpenSupabaseAccounts]);

  const handleSupabaseConnectProject = async (
    payload: {
      name: string;
      connectionString: string;
      connectionType: string;
    },
    opts?: { silent?: boolean },
  ) => {
    const res = await createConnection({
      name: payload.name,
      connectionString: payload.connectionString,
      connectionType: payload.connectionType,
    });
    if (res.success) {
      if (opts?.silent) {
        if (supabaseImportReloadTimerRef.current) {
          window.clearTimeout(supabaseImportReloadTimerRef.current);
        }
        supabaseImportReloadTimerRef.current = window.setTimeout(() => {
          supabaseImportReloadTimerRef.current = null;
          void loadConnections();
        }, 300);
      } else {
        await loadConnections();
        if (!isSupabaseMode) {
          setConnectionScreen("list");
        }
        toast.success(`Connected to ${payload.name}`);
      }
    } else if (!opts?.silent) {
      toast.error((res as any).error ?? "Failed to create connection.");
    }
    return res;
  };

  const handleAddSpacetimeDbAccount = useCallback(() => {
    const check = canAddSpacetimeDbAccount(
      entitlement.premiumActive,
      spacetimedbAccounts.length,
    );
    if (!check.allowed) {
      toast.error(
        "Free plan allows 1 linked SpacetimeDB account. Upgrade to Pro to link more.",
      );
      openExternalUrl(REXADB_UPGRADE_URL);
      return;
    }
    setSpacetimedbLoginOpen(true);
  }, [entitlement.premiumActive, spacetimedbAccounts.length]);

  const handleRemoveSpacetimeDbAccount = useCallback((id: string) => {
    removeSpacetimeDbMgmtAccount(id);
    const next = getSpacetimeDbMgmtAccounts();
    setSpacetimedbAccounts(next);
    setActiveSpacetimeDbAccountId((cur) => {
      if (cur !== id) return cur;
      return next[0]?.id ?? null;
    });
    if (next.length === 0) {
      if (onOpenSpacetimedbAccounts) onOpenSpacetimedbAccounts();
      else setConnectionScreen("spacetimedb-account");
    }
  }, [onOpenSpacetimedbAccounts]);

  const handleSpacetimeDbConnectDatabase = async (
    payload: {
      name: string;
      connectionString: string;
      connectionType: string;
    },
    opts?: { silent?: boolean },
  ) => {
    const res = await createConnection({
      name: payload.name,
      connectionString: payload.connectionString,
      connectionType: payload.connectionType,
    });
    if (res.success) {
      if (opts?.silent) {
        if (supabaseImportReloadTimerRef.current) {
          window.clearTimeout(supabaseImportReloadTimerRef.current);
        }
        supabaseImportReloadTimerRef.current = window.setTimeout(() => {
          supabaseImportReloadTimerRef.current = null;
          void loadConnections();
        }, 300);
      } else {
        await loadConnections();
        if (!isSpacetimeDbMode) {
          setConnectionScreen("list");
        }
        toast.success(`Connected to ${payload.name}`);
      }
    } else if (!opts?.silent) {
      toast.error((res as any).error ?? "Failed to create connection.");
    }
    return res;
  };

  const checkNeonCli = useCallback(async () => {
    setNeonCliChecking(true);
    try {
      const result = await detectNeonCli();
      setNeonCliInstalled(result.installed);
      return result.installed;
    } finally {
      setNeonCliChecking(false);
    }
  }, []);

  useEffect(() => {
    void checkNeonCli();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddNeonAccount = useCallback(async () => {
    const check = canAddNeonAccount(entitlement.premiumActive, neonAccounts.length);
    if (!check.allowed) {
      toast.error(
        "Free plan allows 1 linked Neon account. Upgrade to Pro to link more.",
      );
      openExternalUrl(REXADB_UPGRADE_URL);
      return;
    }
    const installed = neonCliInstalled ?? (await checkNeonCli());
    if (!installed) {
      if (onOpenNeonAccounts) onOpenNeonAccounts();
      else setConnectionScreen("neon-cli");
      return;
    }
    setNeonReconnectProfile(null);
    setNeonLoginOpen(true);
  }, [entitlement.premiumActive, neonAccounts.length, neonCliInstalled, checkNeonCli, onOpenNeonAccounts]);

  const handleReconnectNeonAccount = useCallback(async (profileName: string) => {
    const installed = neonCliInstalled ?? (await checkNeonCli());
    if (!installed) {
      if (onOpenNeonAccounts) onOpenNeonAccounts();
      else setConnectionScreen("neon-cli");
      return;
    }
    setNeonReconnectProfile(profileName);
    setNeonLoginOpen(true);
  }, [neonCliInstalled, checkNeonCli, onOpenNeonAccounts]);

  const handleRemoveNeonAccount = useCallback((id: string) => {
    removeNeonCliAccount(id);
    const next = getNeonCliAccounts();
    setNeonAccounts(next);
    setActiveNeonAccountId((cur) => {
      if (cur !== id) return cur;
      return next[0]?.id ?? null;
    });
    if (next.length === 0) {
      if (onOpenNeonAccounts) onOpenNeonAccounts();
      else setConnectionScreen("neon-cli");
    }
  }, [onOpenNeonAccounts]);

  const handleNeonConnectDatabase = async (
    payload: { name: string; connectionString: string; connectionType: string },
    opts?: { silent?: boolean },
  ) => {
    const res = await createConnection({
      name: payload.name,
      connectionString: payload.connectionString,
      connectionType: payload.connectionType,
    });
    if (res.success) {
      if (opts?.silent) {
        if (supabaseImportReloadTimerRef.current) {
          window.clearTimeout(supabaseImportReloadTimerRef.current);
        }
        supabaseImportReloadTimerRef.current = window.setTimeout(() => {
          supabaseImportReloadTimerRef.current = null;
          void loadConnections();
        }, 300);
      } else {
        await loadConnections();
        if (!isNeonCliMode) {
          setConnectionScreen("list");
        }
        toast.success(`Connected to ${payload.name}`);
      }
    } else if (!opts?.silent) {
      toast.error((res as any).error ?? "Failed to create connection.");
    }
    return res;
  };

  const handleAddPlanetscaleAccount = useCallback(() => {
    const check = canAddPlanetscaleAccount(
      entitlement.premiumActive,
      planetscaleAccounts.length,
    );
    if (!check.allowed) {
      toast.error(
        "Free plan allows 1 linked PlanetScale account. Upgrade to Pro to link more.",
      );
      openExternalUrl(REXADB_UPGRADE_URL);
      return;
    }
    setPlanetscaleLoginOpen(true);
  }, [entitlement.premiumActive, planetscaleAccounts.length]);

  const handleRemovePlanetscaleAccount = useCallback((id: string) => {
    removePlanetscaleAccount(id);
    const next = getPlanetscaleAccounts();
    setPlanetscaleAccounts(next);
    setActivePlanetscaleAccountId((cur) => {
      if (cur !== id) return cur;
      return next[0]?.id ?? null;
    });
    if (next.length === 0) {
      if (onOpenPlanetscaleAccounts) onOpenPlanetscaleAccounts();
      else setConnectionScreen("planetscale-account");
    }
  }, [onOpenPlanetscaleAccounts]);

  const handlePlanetscaleConnectDatabase = async (
    payload: { name: string; connectionString: string; connectionType: string },
    opts?: { silent?: boolean },
  ) => {
    const res = await createConnection({
      name: payload.name,
      connectionString: payload.connectionString,
      connectionType: payload.connectionType,
    });
    if (res.success) {
      if (opts?.silent) {
        if (supabaseImportReloadTimerRef.current) {
          window.clearTimeout(supabaseImportReloadTimerRef.current);
        }
        supabaseImportReloadTimerRef.current = window.setTimeout(() => {
          supabaseImportReloadTimerRef.current = null;
          void loadConnections();
        }, 300);
      } else {
        await loadConnections();
        if (!isPlanetscaleMode) {
          setConnectionScreen("list");
        }
        toast.success(`Connected to ${payload.name}`);
      }
    } else if (!opts?.silent) {
      toast.error((res as any).error ?? "Failed to create connection.");
    }
    return res;
  };

  function terminalLog(
    type: "log" | "group" | "groupEnd" | "warn" | "error",
    ...args: any[]
  ) {
    if (type === "log") console.log(...args);
    else if (type === "group") console.group(...args);
    else if (type === "groupEnd") console.groupEnd();
    else if (type === "warn") console.warn(...args);
    else if (type === "error") console.error(...args);
  }

  async function syncAccessRules(connectionId: number) {
    if (!workspaceMode || !formAccess || Object.keys(formAccess).length === 0) return;
    let accessErrors = 0;
    const entries = Object.entries(formAccess) as [string, AccessType][];
    for (const [roleId, accessType] of entries) {
      try {
        await studioApi.put(`/connections/${connectionId}/access`, {
          roleId: Number(roleId),
          accessType,
        });
      } catch {
        accessErrors++;
      }
    }
    if (accessErrors > 0) {
      toast.error(`${accessErrors} access rule(s) failed to save.`);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();

    const candidateConnectionString = getCandidateConnectionString();

    terminalLog("group", "[handleAdd] Start saving connection");
    terminalLog("log", "Selected Provider:", selectedProvider);
    terminalLog("log", "Editing Connection:", editingConnection?.id ?? null);
    terminalLog(
      "log",
      "Candidate Connection String:",
      candidateConnectionString,
    );
    terminalLog("log", "Plan maxConnections:", plan.maxConnections);
    terminalLog("log", "Visible UI connections count:", connections.length);
    terminalLog(
      "log",
      "Visible connections:",
      connections.map((c) => ({ id: c.id, name: c.name })),
    );
    terminalLog("groupEnd");

    if (!selectedProvider) {
      toast.error("Select a provider first.");
      return;
    }

    if (!validateTursoCandidate(candidateConnectionString)) return;

    if (selectedProvider === "federated") {
      try {
        buildFederatedConnectionString({
          version: 1,
          sources: federatedSources,
        });
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Federated sources are invalid.",
        );
        return;
      }
    }

    if (!candidateConnectionString) return;

    // Log before entitlement check
    terminalLog("group", "[handleAdd] Checking entitlements");
    terminalLog("log", "Enforce limit:", !editingConnection);
    const entitlementAllowed = await enforceConnectionEntitlements(
      candidateConnectionString,
      selectedProvider,
      { enforceLimit: !editingConnection },
    );
    terminalLog("log", "Entitlement check result:", entitlementAllowed);
    terminalLog("groupEnd");

    if (!entitlementAllowed) {
      terminalLog("warn", "[handleAdd] Save blocked by entitlement check");
      return;
    }

    setLoading(true);
    try {
      const normalizedConnectionString = candidateConnectionString;
      const finalName =
        name.trim() ||
        buildConnectionNameFromDetails(
          normalizedConnectionString,
          selectedProvider,
        );

      terminalLog("group", "[handleAdd] About to create connection");
      terminalLog("log", "Final Connection Name:", finalName);
      terminalLog(
        "log",
        "Normalized Connection String:",
        normalizedConnectionString,
      );
      terminalLog("log", "Editing connection:", editingConnection?.id ?? null);
      terminalLog("groupEnd");

      const connectionFields: {
        host?: string;
        port?: string;
        database?: string;
        username?: string;
        password?: string;
        sslMode?: string;
        authToken?: string;
      } = {};
      if (selectedProvider && isFieldBasedProvider(selectedProvider) && fieldValues) {
        connectionFields.host = fieldValues.host;
        connectionFields.port = fieldValues.port;
        connectionFields.database = fieldValues.database;
        connectionFields.username = fieldValues.username;
        connectionFields.password = fieldValues.password;
        connectionFields.sslMode = fieldValues.sslMode;
        connectionFields.authToken = fieldValues.authToken;
      } else if (selectedProvider === "postgresql") {
        connectionFields.host = pgHost;
        connectionFields.port = pgPort;
        connectionFields.database = pgDatabase;
        connectionFields.username = pgUsername;
        connectionFields.password = pgPassword;
        connectionFields.sslMode = pgSslMode;
      } else if (selectedProvider === "turso") {
        connectionFields.host = tursoEndpoint.trim().replace(/^libsql:\/\//i, "").replace(/^https?:\/\//i, "");
        connectionFields.database = "";
        connectionFields.username = "";
        connectionFields.password = "";
        connectionFields.sslMode = "require";
        connectionFields.authToken = tursoAuthToken;
      }

      if (editingConnection) {
        terminalLog(
          "log",
          "[handleAdd] Updating connection id:",
          editingConnection.id,
        );
        const res = await updateConnection(editingConnection.id, {
          name: finalName,
          connectionString: normalizedConnectionString,
          connectionType: selectedProvider,
          environment,
          color,
          groups,
          isFavorite,
          lastActive,
          ...connectionFields,
        });
        terminalLog("log", "[handleAdd] updateConnection response:", res);
        if (res.success) {
          await syncAccessRules(editingConnection.id);
          resetConnectionDraft();
          setConnectionScreen("list");
          setEditingConnection(null);
          await loadConnections();
          queueCloudPush();
        } else {
          toast.error(res.error ?? "Failed to save connection.");
        }
      } else {
        const res = await createConnection({
          name: finalName,
          connectionString: normalizedConnectionString,
          connectionType: selectedProvider,
          maxConnections: plan.maxConnections,
          environment,
          color,
          groups,
          isFavorite,
          lastActive,
          ...connectionFields,
        });
        terminalLog("log", "[handleAdd] createConnection response:", res);
        if (res.success) {
          await syncAccessRules((res as any).id);
          resetConnectionDraft();
          setConnectionScreen("list");
          await loadConnections();
          queueCloudPush();
        } else {
          toast.error(res.error ?? "Failed to save connection.");
        }
      }
    } catch (error) {
      terminalLog("error", "[handleAdd] Failed to save connection:", error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : "Failed to save connection.",
      );
    } finally {
      setLoading(false);
      terminalLog("log", "[handleAdd] Done");
    }
  }

  const populateFormFromConnection = (
    conn: Connection,
    isDuplicate: boolean,
  ) => {
    if (isDuplicate) {
      setEditingConnection(null);
      setName(`${conn.name} (Copy)`);
      setLastActive(null);
    } else {
      setEditingConnection(conn);
      setName(conn.name);
      setLastActive((conn as any).lastActive || null);
    }
    setConnectionString(conn.connectionString);
    setEnvironment(((conn as any).environment as any) || null);
    setColor((conn as any).color || null);
    setGroups(
      (conn as any).groups ||
        ((conn as any).group ? [(conn as any).group] : []),
    );
    setIsFavorite((conn as any).isFavorite || false);
    const detected =
      detectProvider(conn.connectionString, (conn as any).connectionType) ??
      "postgresql";
    setSelectedProvider(detected);
    if (detected === "postgresql") {
      const parsed = parsePostgresConnectionString(conn.connectionString);
      if (parsed) fillPgForm(parsed);
    }
    if (isFieldBasedProvider(detected)) {
      const parsed = parseFieldsFromConnectionString(
        detected as FieldProviderId,
        conn.connectionString,
      );
      setFieldValues(parsed);
    }
    if (detected === "turso") {
      const parsed = parseTursoConnectionString(conn.connectionString);
      if (parsed) {
        setTursoEndpoint(parsed.endpoint);
        setTursoAuthToken(parsed.authToken);
      }
    }
    if (detected === "federated") {
      const parsed = parseFederatedConnectionString(conn.connectionString);
      setFederatedSources(
        parsed.sources.map((source) => ({
          alias: source.alias,
          connectionId: source.connectionId,
          namespace: source.namespace || "",
        })),
      );
    }
    if (detected === "jdbc") {
      try {
        const parsed = new URL(conn.connectionString);
        const url = parsed.searchParams.get("jdbcUrl") || "";
        setJdbcUrl(url);
        const driverClass = parsed.searchParams.get("driverClass") || "";
        setJdbcDriverClass(driverClass);
        setJdbcUsername(parsed.searchParams.get("user") || "");
        setJdbcPassword(parsed.searchParams.get("password") || "");
        const jars = parsed.searchParams.get("jarPaths");
        const savedPaths = jars ? jars.split(",").filter(Boolean) : [];
        const hasRelative =
          savedPaths.length > 0 && savedPaths.some((p) => !p.startsWith("/"));
        if (hasRelative && driverClass) {
          loadInstalledDrivers()
            .then((installed) => {
              const match = installed.find(
                (i) => i.driverClass === driverClass,
              );
              if (match && match.jarPaths.length > 0) {
                setJdbcJarPaths(match.jarPaths);
              } else {
                setJdbcJarPaths(savedPaths);
              }
            })
            .catch(() => {
              setJdbcJarPaths(savedPaths);
            });
        } else {
          setJdbcJarPaths(savedPaths);
        }
      } catch {
        setJdbcUrl(conn.connectionString);
        setJdbcDriverClass("");
        setJdbcJarPaths([]);
      }
    }
    setConnectionScreen(isDuplicate ? "new-form" : "edit-form");
  };

  const handleEdit = (conn: Connection) => {
    populateFormFromConnection(conn, false);
    if (
      workspaceMode &&
      can("connections.manage_access") &&
      conn.connectionString.startsWith("workspace:")
    ) {
      const wsId = conn.connectionString.replace("workspace:", "");
      (async () => {
        try {
          const res = await studioApi.get<{ data: ConnectionAccess[] }>(
            `/connections/${wsId}/access`,
          );
          const access: Record<string, AccessType> = {};
          for (const a of res.data || []) {
            access[a.roleId] = a.accessType;
          }
          setFormAccess(access);
        } catch {
          /* no access data */
        }
      })();
    }
  };
  const handleDuplicate = (conn: Connection) =>
    populateFormFromConnection(conn, true);

  const autoEditTriggeredRef = useRef(false);
  useEffect(() => {
    if (
      editConnectionId != null &&
      connections.length > 0 &&
      !autoEditTriggeredRef.current
    ) {
      const conn = connections.find((c) => c.id === editConnectionId);
      if (conn) {
        autoEditTriggeredRef.current = true;
        handleEdit(conn);
      }
    }
  }, [editConnectionId, connections]);

  const lastNewConnTriggerRef = useRef(newConnectionTrigger);
  useEffect(() => {
    if (newConnectionTrigger !== lastNewConnTriggerRef.current) {
      lastNewConnTriggerRef.current = newConnectionTrigger;
      resetConnectionDraft();
      setConnectionScreen("new-select");
    }
  }, [newConnectionTrigger, resetConnectionDraft]);

  const fetchConnectionCredentials = useCallback(
    async (
      connId: number,
    ): Promise<{
      host: string;
      port: number;
      database: string;
      username: string;
      password: string;
      connectionString: string;
    } | null> => {
      if (!workspaceMode) return null;
      try {
        const res = await studioApi.get<{
          data: {
            host: string;
            port: number;
            database: string;
            username: string;
            password: string;
            connectionString: string;
          };
        }>(`/connections/${connId}/credentials`);
        return res.data ?? null;
      } catch {
        return null;
      }
    },
    [workspaceMode],
  );

  const handleCopyDetails = async (conn: Connection) => {
    if (workspaceMode) {
      const creds = await fetchConnectionCredentials(conn.id);
      if (creds?.connectionString) {
        await navigator.clipboard.writeText(creds.connectionString);
        toast.success("Connection URI copied (with credentials)");
        return;
      }
    }
    navigator.clipboard.writeText(conn.connectionString);
  };

  const handleViewCredentials = async (conn: Connection) => {
    setCredentialsDialog({ open: true, conn, data: null, loading: true });
    const creds = await fetchConnectionCredentials(conn.id);
    setCredentialsDialog({ open: true, conn, data: creds, loading: false });
  };

  const openConnectionFailureDialog = useCallback(
    (params: {
      title?: string;
      connectionName: string;
      message?: string;
      error: string;
    }) => {
      setConnectionFailureDialog({
        open: true,
        title: params.title ?? "Connection failed",
        connectionName: params.connectionName,
        message:
          params.message ?? `Unable to connect to "${params.connectionName}".`,
        error: params.error,
      });
    },
    [],
  );

  const openConnection = async (conn: Connection) => {
    if (workspaceMode) {
      const connType = (conn as any).connectionType || "postgresql";
      const allLocal = await sidecarFetch("/api/connections");
      const existing = (allLocal?.data || []).find(
        (c: any) => c.connectionString === conn.connectionString,
      );
      let localSave: any;
      if (existing) {
        localSave = { success: true, id: existing.id };
      } else {
        localSave = await sidecarFetch("/api/connections", {
          method: "POST",
          body: JSON.stringify({
            name: conn.name,
            connectionString: conn.connectionString,
            connectionType: connType,
          }),
        });
      }
      if (localSave?.success && localSave.id) {
        // Store connection type for proxy SQL generation
        await sidecarFetch(`/api/studio/ws-type`, {
          method: "POST",
          body: JSON.stringify({
            wsId: (conn.connectionString || "").replace("workspace:", ""),
            connType:
              connType === "mysql"
                ? "mysql"
                : connType === "jdbc"
                  ? "jdbc"
                  : "postgres",
          }),
        }).catch(() => {});
        router.push(`/studio?id=${localSave.id}`);
      } else {
        openConnectionFailureDialog({
          connectionName: conn.name,
          error: localSave?.error || "Could not save connection locally",
          message: `Unable to open "${conn.name}".`,
        });
      }
      return;
    }
    if (openingConnectionId === conn.id) return;
    setOpeningConnectionId(conn.id);
    const provider = detectProvider(
      conn.connectionString,
      (conn as any).connectionType,
    );
    if (provider !== "federated") {
      if (provider === "jdbc") {
        try {
          const parsed = new URL(conn.connectionString);
          if (!parsed.searchParams.get("jarPaths")) {
            const driverClass = parsed.searchParams.get("driverClass") || "";
            if (driverClass) {
              const installed = await loadInstalledDrivers();
              const match = installed.find((i) => i.driverClass === driverClass);
              if (match && match.jarPaths.length > 0) {
                parsed.searchParams.set("jarPaths", match.jarPaths.join(","));
                const healed = parsed.toString();
                conn.connectionString = healed;
                await updateConnection(conn.id, { connectionString: healed }).catch(() => {});
              }
            }
          }
        } catch {}
      }
      try {
        const res = await testConnection({
          connectionString: conn.connectionString,
          connectionType: (conn as any).connectionType || provider,
        });
        if (!res.success) {
          openConnectionFailureDialog({
            connectionName: conn.name,
            error: res.error ?? "Connection failed.",
            message: `Unable to connect to "${conn.name}".`,
          });
          setOpeningConnectionId(null);
          return;
        }
      } catch (err) {
        openConnectionFailureDialog({
          connectionName: conn.name,
          error: err instanceof Error ? err.message : String(err),
          message: `Unable to connect to "${conn.name}".`,
        });
        setOpeningConnectionId(null);
        return;
      }
    }

    // Update lastActive before opening
    const now = Date.now();
    await updateConnection(conn.id, { lastActive: now });

    console.log(
      "[openConnection] navigating to studio, conn.id:",
      conn.id,
      "conn.type:",
      conn.connectionType,
    );
    router.push(`/studio?id=${conn.id}`);
  };

  const handleOpenStudio = async (
    event: MouseEvent<HTMLAnchorElement>,
    conn: Connection,
  ) => {
    event.preventDefault();
    await openConnection(conn);
  };

  async function handleDelete(id: number) {
    const res = await removeConnection(id);
    if (res.success) {
      await loadConnections();
      if (!workspaceMode) queueCloudPush();
    } else {
      toast.error(res.error ?? "Failed to delete connection.");
    }
  }

  const toggleFavorite = async (conn: Connection) => {
    const nextValue = !(conn as any).isFavorite;
    const res = await updateConnection(conn.id, { isFavorite: nextValue });
    if (res.success) {
      await loadConnections();
      if (!workspaceMode) queueCloudPush();
      toast.success(
        nextValue ? "Added to favorites" : "Removed from favorites",
      );
    } else {
      toast.error("Failed to update favorite status");
    }
  };

  const handleToggleFolder = async (conn: Connection, folderName: string) => {
    const current =
      (conn as any).groups ||
      ((conn as any).group ? [(conn as any).group] : []);
    const next = current.includes(folderName)
      ? current.filter((n: string) => n !== folderName)
      : [...current, folderName];
    const res = await updateConnection(conn.id, { groups: next });
    if (res.success) {
      await loadConnections();
      if (!workspaceMode) queueCloudPush();
    } else {
      toast.error(res.error ?? "Failed to update folders.");
    }
  };

  const renderFolderSubmenu = (conn: Connection, size: string = "3.5") => (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="gap-2 focus:bg-muted/50">
        <Folder className={`w-${size} h-${size}`} />
        Folders
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="bg-popover border-border text-foreground min-w-40">
        {connectionGroups.length === 0 && (
          <DropdownMenuItem disabled className="gap-2 text-xs text-muted-foreground">
            No folders yet
          </DropdownMenuItem>
        )}
        {connectionGroups.map((g) => {
          const connCurrent = (conn as any).groups || ((conn as any).group ? [(conn as any).group] : []);
          return (
            <DropdownMenuCheckboxItem
              key={g.name}
              checked={connCurrent.includes(g.name)}
              onCheckedChange={() => void handleToggleFolder(conn, g.name)}
              className="gap-2 focus:bg-muted/50 text-xs"
            >
              {g.name}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );

  // fallow-ignore-next-line code-duplication
  const handleExport = () => {
    const data = JSON.stringify(connections, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rexadb-connections-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Connections exported.");
  };

  const handleImport = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (re) => {
        try {
          const imported = JSON.parse(re.target?.result as string);
          if (!Array.isArray(imported)) throw new Error("Invalid format.");
          let count = 0;
          for (const conn of imported) {
            const res = await createConnection({
              name: conn.name || "Imported Connection",
              connectionString: conn.connectionString,
              connectionType: conn.connectionType || conn.connection_type,
              environment: conn.environment,
              color: conn.color,
              group: conn.group,
              groups: conn.groups,
              isFavorite: !!conn.isFavorite,
              maxConnections: plan.maxConnections,
            });
            if (res.success) count++;
          }
          await loadConnections();
          toast.success(`Imported ${count} connections.`);
        } catch (err) {
          toast.error("Import failed.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleRenameFolder = async (oldName: string, newName: string) => {
    if (!newName.trim() || oldName === newName) return;
    const apiRes = await sidecarFetch("/api/connections/groups/rename", {
      method: "POST",
      body: JSON.stringify({ oldName, newName }),
    });
    if (apiRes.success) {
      await loadConnections();
      toast.success(`Renamed folder to "${newName}".`);
    } else {
      toast.error(apiRes.error || "Failed to rename folder.");
    }
  };

  const handleDeleteFolder = async (
    folderName: string,
    option: "with-connections" | "keep-connections",
  ) => {
    const connsInFolder = connections.filter((c) =>
      ((c as any).groups || []).includes(folderName),
    );
    if (option === "with-connections") {
      for (const conn of connsInFolder) {
        await removeConnection(conn.id);
      }
    } else {
      for (const conn of connsInFolder) {
        const currentGroups = (conn as any).groups || [];
        const updated = currentGroups.filter((g: string) => g !== folderName);
        await updateConnection(conn.id, { groups: updated });
      }
    }

    const apiRes = await sidecarFetch("/api/connections/groups/delete", {
      method: "POST",
      body: JSON.stringify({ folderName }),
    });
    if (apiRes.success) {
      await loadConnections();
      toast.success(`Deleted folder "${folderName}".`);
    } else {
      toast.error(apiRes.error || "Failed to delete folder.");
    }
    setIsFolderDeleteDialogOpen(false);
    setFolderToManage(null);
  };

  const handleAddFolder = async (folderName: string) => {
    if (!folderName.trim()) return;
    const apiRes = await sidecarFetch("/api/connections/groups/add", {
      method: "POST",
      body: JSON.stringify({ folderName: folderName.trim() }),
    });
    if (apiRes.success) {
      await loadConnections();
      toast.success(`Folder "${folderName.trim()}" created.`);
    } else {
      toast.error(apiRes.error || "Failed to create folder.");
    }
  };

  const handleTestConnection = async () => {
    const candidate = getCandidateConnectionString().trim();
    if (!candidate) {
      toast.error("Connection URI is required.");
      return;
    }
    if (!validateTursoCandidate(candidate)) return;
    if (selectedProvider === "federated") {
      toast.message(
        "Federated connections are validated when you open them and run a query.",
      );
      return;
    }
    if (
      !(await enforceConnectionEntitlements(candidate, selectedProvider, {
        enforceLimit: false,
      }))
    ) {
      return;
    }

    setTestingConnection(true);
    const res = await testConnection({
      connectionString: candidate,
      connectionType: selectedProvider || undefined,
    });
    setTestingConnection(false);

    if (res.success) {
      toast.success("Connection successful.");
    } else {
      openConnectionFailureDialog({
        connectionName:
          name.trim() ||
          buildConnectionNameFromDetails(candidate, selectedProvider),
        error: res.error ?? "Connection failed.",
      });
    }
  };

  const filteredConnections = (() => {
    const filtered = connections.filter((conn) => {
      const matchesSearch =
        !searchQuery ||
        conn.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        conn.connectionString.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesFavorites = !showOnlyFavorites || !!(conn as any).isFavorite;
      const matchesProvider =
        providerFilter.length === 0 || providerFilter.includes((conn as any).connectionType);
      const matchesFolder =
        !folderFilter ||
        (
          (conn as any).groups ||
          ((conn as any).group ? [(conn as any).group] : [])
        ).includes(folderFilter);
      return (
        matchesSearch && matchesFavorites && matchesProvider && matchesFolder
      );
    });
    if (sortBy === "name") {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortBy === "recent") {
      filtered.sort((a, b) => {
        const at = (a as any).lastActive ?? 0;
        const bt = (b as any).lastActive ?? 0;
        return bt - at;
      });
    }
    return filtered;
  })();

  const commandMenuConnections = connections.filter(
    (conn) =>
      conn.name.toLowerCase().includes(commandMenuQuery.toLowerCase()) ||
      conn.connectionString
        .toLowerCase()
        .includes(commandMenuQuery.toLowerCase()),
  );

  const maxVisibleConnections =
    localMode && plan.maxConnections !== null ? plan.maxConnections : null;
  const visibleConnections =
    maxVisibleConnections !== null
      ? filteredConnections.slice(0, maxVisibleConnections)
      : filteredConnections;

  // Grouping logic
  const groupedConnections = visibleConnections.reduce(
    (acc, conn) => {
      const connGroups =
        (conn as any).groups ||
        ((conn as any).group ? [(conn as any).group] : []);
      const groupNames =
        Array.isArray(connGroups) && connGroups.length > 0
          ? connGroups
          : ["__unassigned__"];
      for (const groupName of groupNames) {
        if (!acc[groupName]) acc[groupName] = [];
        if (!acc[groupName].find((c) => c.id === conn.id)) {
          acc[groupName].push(conn);
        }
      }
      return acc;
    },
    {} as Record<string, Connection[]>,
  );

  // Use connectionGroups from DB + "__unassigned__"
  const groupNames = Array.from(
    new Set([...connectionGroups.map((g) => g.name), "__unassigned__"]),
  ).sort((a, b) => {
    if (a === "__unassigned__") return 1;
    if (b === "__unassigned__") return -1;
    return a.localeCompare(b);
  });
  const toggleGroupCollapse = (groupName: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  const visibleCommandMenuConnections =
    maxVisibleConnections !== null
      ? commandMenuConnections.slice(0, maxVisibleConnections)
      : commandMenuConnections;

  const dragReorderEnabled =
    connectionScreen === "list" &&
    reorderMode &&
    searchQuery.trim().length === 0 &&
    visibleConnections.length > 1;

  const persistConnectionOrder = useCallback(
    async (ordered: Connection[]) => {
      if (!dragReorderEnabled) return;
      const orderedIds = ordered.map((conn) => conn.id);
      const result = await updateConnectionOrder(orderedIds);
      if (!result.success) {
        toast.error(result.error ?? "Failed to save connection order.");
        return;
      }
      queueCloudPush();
    },
    [dragReorderEnabled, updateConnectionOrder, queueCloudPush],
  );

  const reorderConnections = useCallback(
    (sourceId: number, targetId: number) => {
      if (!dragReorderEnabled || sourceId === targetId) return;
      setConnections((prev) => {
        const fromIndex = prev.findIndex((conn) => conn.id === sourceId);
        const toIndex = prev.findIndex((conn) => conn.id === targetId);
        if (fromIndex < 0 || toIndex < 0) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        void persistConnectionOrder(next);
        return next;
      });
    },
    [dragReorderEnabled, persistConnectionOrder],
  );

  const moveConnectionToEnd = useCallback(
    (sourceId: number) => {
      if (!dragReorderEnabled) return;
      setConnections((prev) => {
        const fromIndex = prev.findIndex((conn) => conn.id === sourceId);
        if (fromIndex < 0 || fromIndex === prev.length - 1) return prev;
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.push(moved);
        void persistConnectionOrder(next);
        return next;
      });
    },
    [dragReorderEnabled, persistConnectionOrder],
  );

  useEffect(() => {
    if (!commandMenuOpen) return;
    setCommandMenuQuery("");
    requestAnimationFrame(() => {
      commandMenuInputRef.current?.focus();
    });
  }, [commandMenuOpen]);

  useEffect(() => {
    setSelectedConnectionIndex((prev) => {
      if (visibleConnections.length === 0) return 0;
      return Math.min(prev, visibleConnections.length - 1);
    });
  }, [visibleConnections.length]);

  useEffect(() => {
    if (connectionScreen !== "list") return;
    const list = connectionsListRef.current;
    if (!list) return;
    const item = list.querySelector<HTMLDivElement>(
      `[data-conn-index="${selectedConnectionIndex}"]`,
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [connectionScreen, selectedConnectionIndex]);

  useEffect(() => {
    if (connectionScreen !== "list") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (commandMenuOpen) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']"))
        return;
      if (visibleConnections.length === 0) return;

      if (event.key === "/") {
        event.preventDefault();
        setCommandMenuOpen(true);
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandMenuOpen(true);
        return;
      }

      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        if (!can("connections.create")) {
          toast.error("You don't have permission to create connections.");
          return;
        }
        setConnectionScreen("new-select");
        return;
      }

      if (event.key === "m" || event.key === "M") {
        event.preventDefault();
        setManageMenuOpen(true);
        return;
      }

      if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        setSelectedConnectionIndex(
          (prev) => (prev + 1) % visibleConnections.length,
        );
        return;
      }

      if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        setSelectedConnectionIndex(
          (prev) =>
            (prev - 1 + visibleConnections.length) % visibleConnections.length,
        );
        return;
      }

      if (event.metaKey && event.shiftKey && event.key === "Enter") {
        event.preventDefault();
        const conn = visibleConnections[selectedConnectionIndex];
        if (conn) void openConnection(conn);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    can,
    commandMenuOpen,
    connectionScreen,
    visibleConnections,
    selectedConnectionIndex,
  ]);

  useEffect(() => {
    if (connectionScreen === "list") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[contenteditable='true']")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!isSupabaseMode) {
          setConnectionScreen("list");
          resetConnectionDraft();
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        connectionFormRef.current?.requestSubmit();
      }

      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "t"
      ) {
        event.preventDefault();
        if (
          connectionScreen === "new-form" ||
          connectionScreen === "edit-form"
        ) {
          void handleTestConnection();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [connectionScreen, resetConnectionDraft, isSupabaseMode]);

  useEffect(() => {
    if (connectionScreen !== "new-select") return;
    setProviderFocusIndex(0);
  }, [connectionScreen]);

  useEffect(() => {
    if (connectionScreen !== "new-select") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']"))
        return;

      if (event.key === "/") {
        event.preventDefault();
        connectionStringInputRef.current?.focus();
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        setProviderFocusIndex((prev) => (prev + 1) % providerCards.length);
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        setProviderFocusIndex(
          (prev) => (prev - 1 + providerCards.length) % providerCards.length,
        );
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const card = providerCards[providerFocusIndex];
        selectProviderCard(card);
        return;
      }

      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault();
        const index = Number(event.key) - 1;
        const card = providerCards[index];
        selectProviderCard(card);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [connectionScreen, providerFocusIndex]);

  // fallow-ignore-next-line code-duplication
  const displayName =
    (typeof user?.user_metadata?.name === "string" &&
      user.user_metadata.name.trim()) ||
    (typeof user?.user_metadata?.full_name === "string" &&
      user.user_metadata.full_name.trim()) ||
    (typeof user?.user_metadata?.display_name === "string" &&
      user.user_metadata.display_name.trim()) ||
    localDisplayName.trim() ||
    user?.email?.split("@")[0] ||
    "User";
  const showUpgrade =
    !planLoading && plan.code === "free" && !!user && !localMode;

  const getConnectionTarget = useCallback((conn: Connection) => {
    const raw = conn.connectionString || "";
    if (!raw.trim()) return "untitled";
    const provider =
      detectProvider(raw, (conn as any).connectionType) ?? "postgresql";
    if (provider === "sqlite") {
      const trimmed = raw.trim();
      if (trimmed === ":memory:") return ":memory:";
      const normalized = trimmed
        .replace(/^sqlite:\/*/i, "")
        .replace(/^file:\/*/i, "");
      const parts = normalized.split("/").filter(Boolean);
      return parts[parts.length - 1] || "database.db";
    }
    if (provider === "turso") {
      try {
        const parsed = new URL(raw.replace(/^libsql:\/\//i, "http://"));
        const pathname =
          parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
        return `${parsed.host}${pathname}`;
      } catch {
        return raw;
      }
    }
    const normalized = normalizePgConnectionString(raw);
    if (!normalized) return raw;
    const httpEquivalent = normalized.replace(
      /^[a-zA-Z0-9+.-]+:\/\//i,
      "http://",
    );
    if (httpEquivalent.includes("://") && httpEquivalent.length > 10) {
      try {
        const parsed = new URL(httpEquivalent);
        const host = parsed.hostname || "localhost";
        const db = parsed.pathname.replace("/", "") || "database";
        return `${host}/${db}`;
      } catch {
        return raw;
      }
    }
    return raw;
  }, []);

  const updateGenericField = useCallback(
    (key: keyof ConnectionFieldValues) => (value: string) => {
      setFieldValues((prev) => (prev ? { ...prev, [key]: value } : prev));
    },
    [],
  );

  if (connectionsLoading || !authResolved || !workspaceAuthLoaded) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-studio-bg",
          isStandalone ? "h-screen" : "h-full",
        )}
      >
        <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const canDragReorder = (event: React.DragEvent): boolean => {
    if (!dragReorderEnabled || !draggingConnectionId) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  const selectProviderCard = (
    card: (typeof providerCards)[0] | undefined,
  ): void => {
    if (!card) return;
    setSelectedProvider(card.id);
    setConnectionScreen("new-form");
  };

  const renderAuthMenuItem = (label: string) => (
    <>
      <DropdownMenuItem
        onClick={() => {
          if (typeof window !== "undefined") {
            const redirectUrl = encodeURIComponent(
              window.location.pathname + window.location.search,
            );
            window.location.href = `/auth?redirect_to=${redirectUrl}`;
          }
        }}
        className="gap-2 text-xs cursor-pointer"
      >
        {label}
      </DropdownMenuItem>
      <DropdownMenuSeparator className="bg-studio-border" />
    </>
  );

  const memCode = (
    <code className="text-xs bg-muted px-1 rounded">:memory:</code>
  );

  const renderFilePickerSection = ({
    id,
    description,
  }: {
    id: string;
    description: React.ReactNode;
  }) => (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium">
        Database File
      </Label>
      <Input
        id={id}
        value={connectionString}
        onChange={(e) => setConnectionString(e.target.value)}
        placeholder="Enter file path..."
        className="font-mono text-sm"
      />
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );

  const renderGenericFieldForm = () => {
    if (
      !selectedProvider ||
      !fieldValues ||
      !isFieldBasedProvider(selectedProvider)
    ) {
      return null;
    }
    const provider = selectedProvider as FieldProviderId;
    const isRedis = provider === "redis";
    const isMongo = provider === "mongodb";
    const isPlanetScale = provider === "planetscale";
    const providerCard = providerCards.find(
      (card) => card.id === selectedProvider,
    );
    const switchPlanetScaleProtocol = (protocol: PlanetScaleProtocol) => {
      setFieldValues((prev) =>
        prev
          ? {
              ...prev,
              protocol,
              port: protocol === "mysql" ? "3306" : "5432",
              sslMode: "require",
            }
          : prev,
      );
    };

    return (
      <div className="space-y-4">
        {isPlanetScale && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Protocol</Label>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-border/60 bg-muted/40 p-1">
              <button
                type="button"
                onClick={() => switchPlanetScaleProtocol("mysql")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium",
                  fieldValues.protocol === "mysql"
                    ? "bg-background shadow-sm text-foreground border border-border/60"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Vitess (MySQL)
              </button>
              <button
                type="button"
                onClick={() => switchPlanetScaleProtocol("postgresql")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium",
                  fieldValues.protocol !== "mysql"
                    ? "bg-background shadow-sm text-foreground border border-border/60"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                PostgreSQL
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {fieldValues.protocol === "mysql"
                ? "Vitess (MySQL) is PlanetScale's original protocol."
                : "PlanetScale also supports the PostgreSQL wire protocol."}
            </p>
          </div>
        )}
        <div className="space-y-2 rounded-lg border border-border/60 bg-muted/40 p-3">
          <Label
            htmlFor="conn-uri-generic"
            className="text-sm font-medium flex items-center gap-2"
          >
            Connection String{" "}
            <span className="text-xs font-normal text-muted-foreground">
              (Optional fast-fill)
            </span>
          </Label>
          <Input
            id="conn-uri-generic"
            placeholder={
              providerCard?.placeholder ??
              "protocol://user:password@host:port/database"
            }
            className="font-mono text-sm bg-background border-border/60"
            value={connectionString}
            onChange={(e) => {
              const next = e.target.value;
              setConnectionString(next);
              const looksLikeUri = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(
                next.trim(),
              );
              if (looksLikeUri) {
                setFieldValues(
                  parseFieldsFromConnectionString(provider, next),
                );
              }
            }}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="f-host" className="text-sm font-medium">
              Host
            </Label>
            <Input
              id="f-host"
              value={fieldValues.host}
              onChange={(e) => updateGenericField("host")(e.target.value)}
              className="bg-background border-border/60 h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="f-port" className="text-sm font-medium">
              Port
            </Label>
            <Input
              id="f-port"
              value={fieldValues.port}
              onChange={(e) =>
                updateGenericField("port")(
                  e.target.value.replace(/[^\d]/g, ""),
                )
              }
              className="bg-background border-border/60 h-9"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="f-db" className="text-sm font-medium">
            {isRedis ? "Database Index" : "Database"}
          </Label>
          <Input
            id="f-db"
            value={fieldValues.database}
            onChange={(e) => updateGenericField("database")(e.target.value)}
            className="bg-background border-border/60 h-9"
          />
          {isRedis && (
            <p className="text-xs text-muted-foreground">
              Logical database number (e.g. 0, 1, 2).
            </p>
          )}
          {isMongo && (
            <p className="text-xs text-muted-foreground">
              Default database / auth source.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="f-user" className="text-sm font-medium">
              Username
            </Label>
            <Input
              id="f-user"
              value={fieldValues.username}
              onChange={(e) => updateGenericField("username")(e.target.value)}
              className="bg-background border-border/60 h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="f-password" className="text-sm font-medium">
              Password
            </Label>
            <PasswordInput
              id="f-password"
              value={fieldValues.password}
              onChange={updateGenericField("password")}
              show={showPassword}
              onToggleShow={() => setShowPassword((prev) => !prev)}
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="f-ssl" className="text-sm font-medium">
            SSL Mode
          </Label>
          <SearchableSelect
            value={fieldValues.sslMode}
            onValueChange={updateGenericField("sslMode")}
            placeholder="Select SSL mode"
            searchThreshold={0}
            className="h-8 w-full border-border/60 bg-background text-xs"
            options={sslModeOptionsForProvider(provider, fieldValues.protocol)}
          />
        </div>
      </div>
    );
  };

  return (
    <div
      className={cn(
        "flex",
        isStandalone ? "h-screen" : "h-full",
        "bg-studio-bg text-foreground overflow-hidden relative",
      )}
    >
      {/* Replaced Pattern with a gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-studio-row-hover/60 via-studio-bg to-studio-bg pointer-events-none" />

      <div className="relative z-10 flex flex-col w-full h-full">
        {!hideHeader && (
          <ConnectionsHeader
            displayName={displayName}
            showBackButton={
              connectionScreen === "settings" ||
              connectionScreen === "supabase" ||
              connectionScreen === "neon-cli"
            }
            onBack={() => setConnectionScreen("list")}
            onCommandSearchClick={() => setCommandMenuOpen(true)}
            showAnalyticsToggle={!!onAnalyticsToggle}
            isAnalyticsEnabled={isAnalyticsEnabled}
            onAnalyticsToggle={onAnalyticsToggle}
            settingsActive={connectionScreen === "settings"}
            onSettingsClick={() =>
              setConnectionScreen(
                connectionScreen === "settings" ? "list" : "settings",
              )
            }
            supabaseActive={connectionScreen === "supabase"}
            onSupabaseClick={() =>
              setConnectionScreen(
                connectionScreen === "supabase" ? "list" : "supabase",
              )
            }
            spacetimedbActive={connectionScreen === "spacetimedb-account"}
            onSpacetimedbClick={() =>
              setConnectionScreen(
                connectionScreen === "spacetimedb-account" ? "list" : "spacetimedb-account",
              )
            }
            neonActive={connectionScreen === "neon-cli"}
            onNeonClick={() =>
              setConnectionScreen(
                connectionScreen === "neon-cli" ? "list" : "neon-cli",
              )
            }
            avatarDropdownChildren={
              <>
                {!isSessionActive &&
                  user &&
                  renderAuthMenuItem("Sign In Again")}
                {localMode && !user && renderAuthMenuItem("Sign In")}
                {showUpgrade && user && (
                  <>
                    <DropdownMenuItem
                      onClick={handleUpgradeClick}
                      className="gap-2 text-xs cursor-pointer"
                    >
                      Upgrade to Pro
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="bg-studio-border" />
                  </>
                )}
              </>
            }
          />
        )}

        {/* Command Menu Dialog */}
        <Dialog open={commandMenuOpen} onOpenChange={setCommandMenuOpen}>
          <DialogContent
            hideCloseButton
            className="rounded-lg border border-studio-border bg-studio-bg p-2 pb-11 shadow-2xl"
          >
            <DialogTitle className="sr-only">Search Connections</DialogTitle>
            <DialogDescription className="sr-only">
              Search and open saved connections.
            </DialogDescription>
            <Command
              shouldFilter={false}
              className="rounded-none bg-transparent **:data-[slot=command-input-wrapper]:mb-0 **:data-[slot=command-input-wrapper]:h-9! **:data-[slot=command-input]:h-9! **:data-[slot=command-input-wrapper]:rounded-lg **:data-[slot=command-input-wrapper]:border **:data-[slot=command-input-wrapper]:border-studio-border **:data-[slot=command-input-wrapper]:bg-studio-bg/60 **:data-[slot=command-input]:py-0"
            >
              <CommandInput
                ref={commandMenuInputRef}
                value={commandMenuQuery}
                onValueChange={setCommandMenuQuery}
                autoFocus
                placeholder="Search connections..."
              />
              <CommandList className="no-scrollbar min-h-80 scroll-pt-2 scroll-pb-1.5">
                <CommandEmpty className="py-12 text-center text-muted-foreground text-sm">
                  No matching connections.
                </CommandEmpty>

                <CommandGroup
                  heading="Connections"
                  className="p-0! **:[[cmdk-group-heading]]:scroll-mt-16 **:[[cmdk-group-heading]]:p-3! **:[[cmdk-group-heading]]:pb-1!"
                >
                  {visibleCommandMenuConnections.map((conn) => (
                    <CommandItem
                      key={conn.id}
                      value={`${conn.name} ${conn.id}`}
                      keywords={[conn.name, conn.connectionString]}
                      onSelect={() => {
                        setCommandMenuOpen(false);
                        void openConnection(conn);
                      }}
                      className="px-3! h-9 rounded-lg border border-transparent font-medium hover:border-studio-border/80 hover:bg-studio-row-hover gap-3"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-studio-border bg-studio-bg/60">
                        <Search className="size-4" aria-hidden="true" />
                      </span>
                      {conn.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>

            <div className="absolute inset-x-0 bottom-0 z-20 flex h-10 items-center gap-2 rounded-b-xl border-t border-studio-border bg-studio-bg px-4 font-medium text-muted-foreground text-xs">
              <Kbd>Enter</Kbd>
              Select
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={connectionFailureDialog.open}
          onOpenChange={(open) =>
            setConnectionFailureDialog((prev) => ({ ...prev, open }))
          }
        >
          <DialogContent
            hideCloseButton
            className="border-studio-border bg-studio-bg/95 max-h-[80vh] w-[min(900px,calc(100%-2rem))] max-w-[900px] sm:max-w-[900px] !max-w-none overflow-y-auto"
          >
            <DialogHeader>
              <div className="min-w-0 space-y-1">
                <DialogTitle>{connectionFailureDialog.title}</DialogTitle>
                <DialogDescription className="break-words">
                  {connectionFailureDialog.message}
                </DialogDescription>
              </div>
            </DialogHeader>

            <div className="space-y-5">
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Check the connection details and make sure:
                </p>
                <ul className="space-y-1 text-sm text-foreground/85">
                  <li className="ml-4 list-disc">
                    The database server is running and reachable.
                  </li>
                  <li className="ml-4 list-disc">
                    The host, port, database, username, and password are
                    correct.
                  </li>
                  <li className="ml-4 list-disc">
                    Your network, VPN, SSH tunnel, or firewall is not blocking
                    the connection.
                  </li>
                </ul>
              </div>

              <div className="rounded-lg border border-destructive/25 bg-destructive/8 px-4 py-3">
                <p className="mb-1 text-xs font-mediumtracking-[0.14em] text-destructive/80">
                  Error details
                </p>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-destructive">
                  {connectionFailureDialog.error}
                </pre>
              </div>
            </div>

            <DialogFooter>
              <Button
                className="w-full"
                onClick={() =>
                  setConnectionFailureDialog((prev) => ({
                    ...prev,
                    open: false,
                  }))
                }
              >
                Got it
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Credentials Dialog */}
        <Dialog
          open={credentialsDialog.open}
          onOpenChange={(open) =>
            setCredentialsDialog((prev) => ({ ...prev, open }))
          }
        >
          <DialogContent className="sm:max-w-[500px] bg-studio-bg border-studio-border">
            <DialogHeader>
              <DialogTitle>
                Credentials: {credentialsDialog.conn?.name}
              </DialogTitle>
              <DialogDescription>
                {credentialsDialog.loading
                  ? "Fetching credentials..."
                  : "Real-time credentials fetched from workspace."}
              </DialogDescription>
            </DialogHeader>
            {credentialsDialog.loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="h-5 w-5 rounded-lg border-2 border-primary border-t-transparent" />
              </div>
            ) : credentialsDialog.data ? (
              <div className="space-y-3 py-2">
                <div className="rounded-lg border border-border/60 bg-muted/30 overflow-hidden">
                  <table className="w-full text-xs">
                    <tbody>
                      {[
                        { label: "Host", value: credentialsDialog.data.host },
                        { label: "Port", value: credentialsDialog.data.port },
                        {
                          label: "Database",
                          value: credentialsDialog.data.database,
                        },
                        {
                          label: "Username",
                          value: credentialsDialog.data.username,
                        },
                        {
                          label: "Password",
                          value: credentialsDialog.data.password,
                        },
                      ].map((row) => (
                        <tr
                          key={row.label}
                          className="border-b border-border/30 last:border-b-0"
                        >
                          <td className="px-3 py-2 text-muted-foreground font-medium w-24">
                            {row.label}
                          </td>
                          <td className="px-3 py-2 font-mono text-foreground">
                            {String(row.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-lg border border-border/60 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1 font-medium">
                    Connection String
                  </p>
                  <pre className="whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                    {credentialsDialog.data.connectionString}
                  </pre>
                </div>
                <Button
                  size="sm"
                  className="w-full gap-2 text-xs"
                  onClick={async () => {
                    await navigator.clipboard.writeText(
                      credentialsDialog.data!.connectionString,
                    );
                    toast.success("Connection URI copied");
                  }}
                >
                  <Copy className="w-3.5 h-3.5" /> Copy Connection String
                </Button>
              </div>
            ) : (
              <div className="py-6 text-center text-sm text-destructive">
                Failed to load credentials.
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Folder Delete Dialog */}
        <Dialog
          open={isFolderDeleteDialogOpen}
          onOpenChange={setIsFolderDeleteDialogOpen}
        >
          <DialogContent className="sm:max-w-[400px] bg-studio-bg border-studio-border">
            <DialogHeader>
              <DialogTitle>Delete Folder: {folderToManage}</DialogTitle>
              <DialogDescription>
                How would you like to handle the connections inside this folder?
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="flex flex-col gap-3">
                <div
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${deleteOption === "with-connections" ? "bg-destructive/5 border-destructive/30" : "bg-muted/30 border-border/40 hover:bg-muted/50"}`}
                  onClick={() => setDeleteOption("with-connections")}
                >
                  <div
                    className={`mt-1 h-4 w-4 rounded-lg border flex items-center justify-center ${deleteOption === "with-connections" ? "border-destructive bg-destructive" : "border-muted-foreground"}`}
                  >
                    {deleteOption === "with-connections" && (
                      <div className="h-1.5 w-1.5 rounded-lg bg-white" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium">
                      Delete folder and connections
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Permanently removes the folder and all its connections.
                    </p>
                  </div>
                </div>
                <div
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer ${deleteOption === "keep-connections" ? "bg-primary/5 border-primary/30" : "bg-muted/30 border-border/40 hover:bg-muted/50"}`}
                  onClick={() => setDeleteOption("keep-connections")}
                >
                  <div
                    className={`mt-1 h-4 w-4 rounded-lg border flex items-center justify-center ${deleteOption === "keep-connections" ? "border-primary bg-primary" : "border-muted-foreground"}`}
                  >
                    {deleteOption === "keep-connections" && (
                      <div className="h-1.5 w-1.5 rounded-lg bg-white" />
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium">Delete folder only</p>
                    <p className="text-xs text-muted-foreground">
                      Connections will be moved to the unassigned list.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="ghost"
                onClick={() => setIsFolderDeleteDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  folderToManage &&
                  handleDeleteFolder(folderToManage, deleteOption)
                }
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Folder Add/Rename Prompt Dialog */}
        <Dialog open={isFolderPromptOpen} onOpenChange={setIsFolderPromptOpen}>
          <DialogContent className="sm:max-w-[400px] bg-studio-bg border-studio-border">
            <DialogHeader>
              <DialogTitle>
                {folderPromptMode === "add" ? "Create Folder" : "Rename Folder"}
              </DialogTitle>
              <DialogDescription>
                {folderPromptMode === "add"
                  ? "Enter a name for the new folder."
                  : `Enter a new name for "${folderToManage}".`}
              </DialogDescription>
            </DialogHeader>
            <div className="py-4 space-y-4">
              <div className="space-y-2">
                <Label
                  htmlFor="folder-name"
                  className="text-xs font-mediumtracking-wider text-muted-foreground"
                >
                  Folder Name
                </Label>
                <Input
                  id="folder-name"
                  value={folderPromptValue}
                  onChange={(e) => setFolderPromptValue(e.target.value)}
                  placeholder="e.g. Work, Personal"
                  className="bg-muted/30 border-border/40"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && folderPromptValue.trim()) {
                      if (folderPromptMode === "add") {
                        void handleAddFolder(folderPromptValue);
                      } else if (folderToManage) {
                        void handleRenameFolder(
                          folderToManage,
                          folderPromptValue,
                        );
                      }
                      setIsFolderPromptOpen(false);
                      setFolderPromptValue("");
                    }
                  }}
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setIsFolderPromptOpen(false);
                  setFolderPromptValue("");
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={!folderPromptValue.trim()}
                onClick={() => {
                  if (folderPromptMode === "add") {
                    void handleAddFolder(folderPromptValue);
                  } else if (folderToManage) {
                    void handleRenameFolder(folderToManage, folderPromptValue);
                  }
                  setIsFolderPromptOpen(false);
                  setFolderPromptValue("");
                }}
              >
                {folderPromptMode === "add" ? "Create" : "Rename"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DriverInstallPrompt
          open={installPromptOpen}
          onOpenChange={setInstallPromptOpen}
          driver={pendingInstallDriver}
          onInstalled={(jarPaths) => {
            setJdbcJarPaths(jarPaths);
          }}
        />

        {/* Main Content */}
        <main
          className={cn(
            "flex-1 overflow-hidden no-drag flex flex-col",
            "border-t-0",
          )}
        >
          {connectionScreen === "list" ? (
            <div className="flex h-full w-full">
              <div className="flex flex-col h-full flex-1 max-w-5xl mx-auto px-6 py-8">
                {/* Top row — matches reference image: large title with avatar + settings on the right */}
                <div className="flex items-center justify-between mb-6">
                  <h1 className="text-[28px] font-semibold tracking-tight text-foreground">
                    Connections
                  </h1>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setConnectionScreen("settings")}
                      title="Settings"
                      aria-label="Settings"
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-studio-border bg-background/15 hover:bg-background/25 no-drag"
                    >
                      <Settings className="w-3.5 h-3.5 text-muted-foreground/60" />
                    </button>
                    <NavUser
                      name={displayName}
                      email={user?.email ?? undefined}
                      dropdownAlign="end"
                      dropdownSide="bottom"
                    />
                  </div>
                </div>

                {/* Second row — search (opens CMD+K) + Providers (dashed) + Sorted by name + New Connection — no select/animate effects */}
                <div className="flex items-center gap-2 mb-6">
                  <button
                    type="button"
                    onClick={() => setCommandMenuOpen(true)}
                    className="flex h-9 flex-1 max-w-sm items-center justify-between rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus-visible:outline-none"
                  >
                    <span className="flex items-center gap-2 text-muted-foreground">
                      <Search className="w-4 h-4 text-muted-foreground/60" />
                      Search connections...
                    </span>
                    <span className="ml-2 flex items-center gap-1">
                      <Kbd className="h-5 px-1.5 text-xs">{commandShortcut}</Kbd>
                    </span>
                  </button>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="h-9 px-3 rounded-lg border border-dashed border-border bg-background text-sm flex items-center gap-2 focus:outline-none">
                        <span className="text-foreground">Providers</span>
                        {providerFilter.length > 0 && (
                          <span className="flex -space-x-1.5">
                            {providerFilter.slice(0, 3).map((id) => {
                              const card = providerCards.find((x) => x.id === id);
                              if (!card) return null;
                              return (
                                <span
                                  key={id}
                                  className="h-5 w-5 rounded-full border border-background bg-background flex items-center justify-center overflow-hidden"
                                >
                                  {card.id === "spacetimedb" ? (
                                    <SpacetimeDbLogo className="h-3 w-3" />
                                  ) : card.id === "supabase" ? (
                                    <SupabaseLogo className="h-3 w-3" />
                                  ) : card.id === "neon" ? (
                                    <NeonLogo className="h-3 w-3" />
                                  ) : (
                                    <Image src={card.logoSrc} alt="" width={14} height={14} className="rounded-full object-contain" />
                                  )}
                                </span>
                              );
                            })}
                            {providerFilter.length > 3 && (
                              <span className="h-5 w-5 rounded-full border border-background bg-muted flex items-center justify-center text-[10px] font-medium">
                                +{providerFilter.length - 3}
                              </span>
                            )}
                          </span>
                        )}
                        <ChevronDown className="w-4 h-4 text-muted-foreground/60" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="bg-popover border-border min-w-[180px]">
                      <DropdownMenuItem
                        onSelect={(e) => {
                          e.preventDefault();
                          setProviderFilter([]);
                        }}
                        className="text-xs focus:bg-muted/50"
                      >
                        All providers
                        {providerFilter.length === 0 && <Check className="w-3 h-3 ml-auto" />}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {providerCards.map((c) => {
                        const checked = providerFilter.includes(c.id);
                        return (
                          <DropdownMenuItem
                            key={c.id}
                            onSelect={(e) => {
                              e.preventDefault();
                              setProviderFilter((prev) =>
                                prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id],
                              );
                            }}
                            className="gap-2 text-xs focus:bg-muted/50"
                          >
                            {c.id === "spacetimedb" ? (
                              <SpacetimeDbLogo className="h-4 w-4" />
                            ) : c.id === "supabase" ? (
                              <SupabaseLogo className="h-4 w-4" />
                            ) : c.id === "neon" ? (
                              <NeonLogo className="h-4 w-4" />
                            ) : (
                              <Image src={c.logoSrc} alt="" width={16} height={16} className="rounded-full" />
                            )}
                            {c.label}
                            {checked && <Check className="w-3 h-3 ml-auto" />}
                          </DropdownMenuItem>
                        );
                      })}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="h-9 px-3 rounded-lg border border-border bg-background text-sm flex items-center gap-2 focus:outline-none">
                        <SlidersHorizontal className="w-4 h-4 text-muted-foreground/70" />
                        Sorted by {sortBy === "name" ? "name" : "recent"}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="bg-popover border-border">
                      <DropdownMenuItem onClick={() => setSortBy("name")} className="text-xs gap-2 focus:bg-muted/50">
                        <ArrowUpDown className="w-3.5 h-3.5" /> Sorted by name
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setSortBy("recent")} className="text-xs gap-2 focus:bg-muted/50">
                        <ArrowUpDown className="w-3.5 h-3.5" /> Sorted by recent
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>

                  <div className="ml-auto">
                    {can("connections.create") && (
                      <button
                        onClick={() => {
                          resetConnectionDraft();
                          setConnectionScreen("new-select");
                        }}
                        className="h-9 px-3 rounded-lg border border-border bg-background text-sm flex items-center gap-2 focus:outline-none"
                      >
                        <Plus className="w-4 h-4 text-muted-foreground/70" />
                        New Connection
                      </button>
                    )}
                  </div>
                </div>

                {/* Search and Grid Area */}
                <div className="flex-1 overflow-y-auto scrollbar-hide -mx-6 px-6 pb-20">
                  {reorderMode && searchQuery.trim().length === 0 && (
                    <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="inline-flex h-2 w-2 rounded-lg bg-emerald-500/80" />
                      Drag cards to reorder.
                    </div>
                  )}
                  {visibleConnections.length > 0 ? (
                    <>
                      <div ref={connectionsListRef}>
                        {viewMode === "card" ? (
                          <div
                            className={cn(
                              "grid gap-4",
                              "grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
                            )}
                            onDragOver={(event) => {
                              if (!dragReorderEnabled || !draggingConnectionId)
                                return;
                              if (event.currentTarget !== event.target) return;
                              event.preventDefault();
                              setDragOverConnectionId(null);
                            }}
                            onDrop={(event) => {
                              if (!dragReorderEnabled || !draggingConnectionId)
                                return;
                              if (event.currentTarget !== event.target) return;
                              event.preventDefault();
                              moveConnectionToEnd(draggingConnectionId);
                              setDraggingConnectionId(null);
                              setDragOverConnectionId(null);
                              dragReorderActiveRef.current = false;
                            }}
                          >
                            {visibleConnections.map((conn) => {
                              const globalIndex = visibleConnections.findIndex(
                                (c) => c.id === conn.id,
                              );
                              const { provider, providerCard, providerLogo, env } =
                                getProviderInfo(conn);
                              const isFav = (conn as any).isFavorite;

                              return (
                                <div
                                  key={conn.id}
                                  onClick={() => {
                                    if (
                                      reorderMode ||
                                      dragReorderActiveRef.current
                                    )
                                      return;
                                    void openConnection(conn);
                                  }}
                                  data-conn-index={globalIndex}
                                  onDragOver={(event) => {
                                    if (!canDragReorder(event)) return;
                                    if (dragOverConnectionId !== conn.id) {
                                      setDragOverConnectionId(conn.id);
                                    }
                                  }}
                                  onDrop={(event) => {
                                    if (!canDragReorder(event)) return;
                                    reorderConnections(
                                      draggingConnectionId!,
                                      conn.id,
                                    );
                                    setDraggingConnectionId(null);
                                    setDragOverConnectionId(null);
                                    dragReorderActiveRef.current = false;
                                  }}
                                  className={cn(
                                    "group relative rounded-lg border border-studio-border/60 bg-card hover:bg-studio-row-hover hover:border-studio-border p-4 cursor-pointer",
                                    openingConnectionId === conn.id &&
                                      "opacity-50 pointer-events-none",
                                    draggingConnectionId === conn.id &&
                                      "opacity-60",
                                    dragOverConnectionId === conn.id &&
                                      "ring-1 ring-primary/40",
                                  )}
                                >
                                  <div className="flex items-start justify-between mb-3">
                                    <div className="flex items-center gap-3">
                                      <div className="relative">
                                        {provider === "spacetimedb" ? (
                                          <SpacetimeDbLogo className="h-[27px] w-[27px] text-foreground" />
                                        ) : (
                                          <Image
                                            src={
                                              providerCard?.logoSrc ??
                                              providerLogo
                                            }
                                            alt={
                                              providerCard?.label ??
                                              "PostgreSQL"
                                            }
                                            width={27}
                                            height={27}
                                            className="object-contain rounded-lg"
                                          />
                                        )}
                                        {!!isFav && (
                                          <div className="absolute -top-2 -right-2 bg-studio-bg rounded-lg p-0.5 shadow-sm border border-border/40">
                                            <Star className="w-2.5 h-2.5 text-amber-500 fill-amber-500" />
                                          </div>
                                        )}
                                      </div>

                                      <div>
                                        <div className="flex items-center gap-2">
                                          <h3 className="text-sm font-medium text-foreground truncate max-w-[120px]">
                                            {conn.name}
                                          </h3>
                                          {env &&
                                            (env === "production" ||
                                              env === "staging") && (
                                              <span
                                                className={`text-xs font-boldpx-1 rounded border ${env === "production" ? "bg-red-500/10 text-red-500 border-red-500/20" : "bg-amber-500/10 text-amber-500 border-amber-500/20"}`}
                                              >
                                                {env}
                                              </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-muted-foregroundtracking-tight">
                                          {providerCard?.label}
                                        </p>
                                      </div>
                                    </div>
                                    <div
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                      className="flex items-center gap-0.5"
                                    >
                                      {dragReorderEnabled && (
                                        <button
                                          type="button"
                                          draggable
                                          onDragStart={(event) => {
                                            if (!dragReorderEnabled) return;
                                            dragReorderActiveRef.current = true;
                                            setDraggingConnectionId(conn.id);
                                            setDragOverConnectionId(conn.id);
                                            event.dataTransfer.effectAllowed =
                                              "move";
                                            event.dataTransfer.setData(
                                              "text/plain",
                                              String(conn.id),
                                            );
                                          }}
                                          onDragEnd={() => {
                                            setDraggingConnectionId(null);
                                            setDragOverConnectionId(null);
                                            setTimeout(() => {
                                              dragReorderActiveRef.current = false;
                                            }, 0);
                                          }}
                                          onClick={(event) =>
                                            event.stopPropagation()
                                          }
                                          className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 cursor-grab active:cursor-grabbing opacity-70 hover:opacity-100 inline-flex items-center justify-center leading-none"
                                          title="Drag to reorder"
                                          aria-label="Drag to reorder"
                                        >
                                          <GripVertical className="w-3.5 h-3.5 block" />
                                        </button>
                                      )}
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"
                                          >
                                            <MoreVertical className="w-4 h-4" />
                                          </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                          align="end"
                                          className="bg-popover border-border text-foreground"
                                        >
                                          <DropdownMenuItem
                                            onClick={() =>
                                              void openConnection(conn)
                                            }
                                            className="gap-2 focus:bg-muted/50"
                                          >
                                            Open
                                          </DropdownMenuItem>
                                          {can("connections.update") && (
                                            <DropdownMenuItem
                                              onClick={() => handleEdit(conn)}
                                              className="gap-2 focus:bg-muted/50"
                                            >
                                              {" "}
                                              Edit
                                            </DropdownMenuItem>
                                          )}
                                          {can("connections.create") && (
                                            <DropdownMenuItem
                                              onClick={() =>
                                                handleDuplicate(conn)
                                              }
                                              className="gap-2 focus:bg-muted/50"
                                            >
                                              {" "}
                                              Duplicate
                                            </DropdownMenuItem>
                                          )}
                                          {can("connections.update") && (
                                            <DropdownMenuItem
                                              onClick={() =>
                                                void toggleFavorite(conn)
                                              }
                                              className="gap-2 focus:bg-muted/50"
                                            >
                                              {(conn as any).isFavorite
                                                ? "Remove from Favorites"
                                                : "Add to Favorites"}
                                            </DropdownMenuItem>
                                          )}
                                          <DropdownMenuItem
                                            onClick={() =>
                                              void handleCopyDetails(conn)
                                            }
                                            className="gap-2 focus:bg-muted/50"
                                          >
                                            {" "}
                                            Copy URI
                                          </DropdownMenuItem>
                                          {!workspaceMode && renderFolderSubmenu(conn)}
                                          {workspaceMode && (
                                            <>
                                              <DropdownMenuItem
                                                onClick={() =>
                                                  void handleViewCredentials(
                                                    conn,
                                                  )
                                                }
                                                className="gap-2 focus:bg-muted/50"
                                              >
                                                View Credentials
                                              </DropdownMenuItem>
                                            </>
                                          )}
                                          {onViewAnalytics && (
                                            <DropdownMenuItem
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                onViewAnalytics(conn.id);
                                              }}
                                              className="gap-2 focus:bg-muted/50"
                                            >
                                              View Analytics
                                            </DropdownMenuItem>
                                          )}
                                          {can("connections.delete") && (
                                            <>
                                              <DropdownMenuSeparator className="bg-border/60" />
                                              <DropdownMenuItem
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  void handleDelete(conn.id);
                                                }}
                                                className="gap-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                                              >
                                                Delete
                                              </DropdownMenuItem>
                                            </>
                                          )}
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => void openConnection(conn)}
                                    className="w-full text-left group/button"
                                  >
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground group-hover/button:text-foreground/70">
                                      <span className="font-mono truncate">
                                        {getConnectionTarget(conn)}
                                      </span>
                                    </div>
                                  </button>
                                  {openingConnectionId === conn.id && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-lg backdrop-blur-sm z-10">
                                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <div className="h-3 w-3 border-2 border-muted-foreground/30 border-t-muted-foreground/80 rounded-lg" />
                                        Connecting...
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="border border-studio-border/60 rounded-lg overflow-hidden">
                            <table className="w-full">
                              <thead>
                                <tr className="border-b border-studio-border/60 bg-studio-bg/40">
                                  <th className="text-left text-xs font-bold text-muted-foreground/60 px-3 py-2.5 tracking-wider">
                                    Name
                                  </th>
                                  <th className="text-left text-xs font-bold text-muted-foreground/60 px-3 py-2.5 tracking-wider">
                                    Provider
                                  </th>
                                  <th className="text-left text-xs font-bold text-muted-foreground/60 px-3 py-2.5 tracking-wider">
                                    Target
                                  </th>
                                  <th className="text-left text-xs font-bold text-muted-foreground/60 px-3 py-2.5 tracking-wider">
                                    Environment
                                  </th>
                                  <th className="text-left text-xs font-bold text-muted-foreground/60 px-3 py-2.5 tracking-wider">
                                    Folders
                                  </th>
                                  <th className="text-right text-xs font-bold text-muted-foreground/60 px-3 py-2.5 tracking-wider">
                                    Actions
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {visibleConnections.map((conn) => {
                                  const { provider, providerCard, providerLogo, env } =
                                    getProviderInfo(conn);
                                  const connGroups = (conn as any).groups || [];
                                  return (
                                    <tr
                                      key={conn.id}
                                      onClick={() => void openConnection(conn)}
                                      className="border-b border-studio-border/30 hover:bg-studio-row-hover/60 cursor-pointer last:border-b-0"
                                    >
                                      <td className="px-3 py-2.5">
                                        <div className="flex items-center gap-2.5">
                                          {provider === "spacetimedb" ? (
                                            <SpacetimeDbLogo className="h-[18px] w-[18px] text-foreground" />
                                          ) : (
                                            <Image
                                              src={
                                                providerCard?.logoSrc ??
                                                providerLogo
                                              }
                                              alt=""
                                              width={18}
                                              height={18}
                                              className="rounded-lg shrink-0"
                                            />
                                          )}
                                          <div className="flex items-center gap-1.5 min-w-0">
                                            <span className="text-sm font-medium text-foreground truncate max-w-[160px]">
                                              {conn.name}
                                            </span>
                                            {(conn as any).isFavorite && (
                                              <Star className="w-3 h-3 text-amber-500 fill-amber-500 shrink-0" />
                                            )}
                                          </div>
                                        </div>
                                      </td>
                                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                                        {providerCard?.label ?? "PostgreSQL"}
                                      </td>
                                      <td className="px-3 py-2.5 text-xs font-mono text-muted-foreground truncate max-w-[200px]">
                                        {getConnectionTarget(conn)}
                                      </td>
                                      <td className="px-3 py-2.5">
                                        {env ? (
                                          <span
                                            className={cn(
                                              "text-xs font-medium px-1.5 py-0.5 rounded border",
                                              env === "production"
                                                ? "bg-red-500/10 text-red-500 border-red-500/20"
                                                : env === "staging"
                                                  ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                                                  : "bg-blue-500/10 text-blue-500 border-blue-500/20",
                                            )}
                                          >
                                            {env}
                                          </span>
                                        ) : (
                                          <span className="text-xs text-muted-foreground/40">
                                            &mdash;
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-2.5">
                                        <div className="flex items-center gap-1 flex-wrap">
                                          {connGroups.length > 0 ? (
                                            connGroups.map((g: string) => (
                                              <span
                                                key={g}
                                                className="text-xs text-muted-foreground bg-muted/30 px-1.5 py-0.5 rounded border border-border/40"
                                              >
                                                {g}
                                              </span>
                                            ))
                                          ) : (
                                            <span className="text-xs text-muted-foreground/40">
                                              &mdash;
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                      <td className="px-3 py-2.5 text-right">
                                        <DropdownMenu>
                                          <DropdownMenuTrigger
                                            asChild
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <Button
                                              variant="ghost"
                                              size="icon"
                                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                            >
                                              <MoreVertical className="w-3.5 h-3.5" />
                                            </Button>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent
                                            align="end"
                                            className="bg-popover border-border text-foreground"
                                          >
                                            <DropdownMenuItem
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void openConnection(conn);
                                              }}
                                              className="gap-2 text-xs focus:bg-muted/50"
                                            >
                                              Open
                                            </DropdownMenuItem>
                                            {can("connections.update") && (
                                              <DropdownMenuItem
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleEdit(conn);
                                                }}
                                                className="gap-2 text-xs focus:bg-muted/50"
                                              >
                                                Edit
                                              </DropdownMenuItem>
                                            )}
                                            {can("connections.create") && (
                                              <DropdownMenuItem
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleDuplicate(conn);
                                                }}
                                                className="gap-2 text-xs focus:bg-muted/50"
                                              >
                                                Duplicate
                                              </DropdownMenuItem>
                                            )}
                                            {can("connections.update") && (
                                              <DropdownMenuItem
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  void toggleFavorite(conn);
                                                }}
                                                className="gap-2 text-xs focus:bg-muted/50"
                                              >
                                                {(conn as any).isFavorite
                                                  ? "Unfavorite"
                                                  : "Favorite"}
                                              </DropdownMenuItem>
                                            )}
                                            <DropdownMenuItem
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void handleCopyDetails(conn);
                                              }}
                                              className="gap-2 text-xs focus:bg-muted/50"
                                            >
                                              Copy URI
                                            </DropdownMenuItem>
                                            {!workspaceMode && renderFolderSubmenu(conn, "3")}
                                            {workspaceMode && (
                                              <DropdownMenuItem
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  void handleViewCredentials(
                                                    conn,
                                                  );
                                                }}
                                                className="gap-2 text-xs focus:bg-muted/50"
                                              >
                                                <Eye className="w-3 h-3" /> View
                                                Credentials
                                              </DropdownMenuItem>
                                            )}
                                            {can("connections.delete") && (
                                              <>
                                                <DropdownMenuSeparator className="bg-border/60" />
                                                <DropdownMenuItem
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    void handleDelete(conn.id);
                                                  }}
                                                  className="gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                                                >
                                                  Delete
                                                </DropdownMenuItem>
                                              </>
                                            )}
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center py-20">
                      <div className="w-12 h-12 rounded-lg bg-studio-bg border border-studio-border/60 flex items-center justify-center mb-4">
                        <Database className="w-6 h-6 text-muted-foreground" />
                      </div>
                      <h3 className="text-sm font-medium text-foreground mb-1">
                        No connections found
                      </h3>
                      <p className="text-xs text-muted-foreground max-w-xs mb-6">
                        {searchQuery
                          ? "Try a different search term."
                          : "Add a database connection to get started."}
                      </p>
                      {!searchQuery && can("connections.create") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="bg-transparent border-dashed border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50"
                          onClick={() => {
                            resetConnectionDraft();
                            setConnectionScreen("new-select");
                          }}
                        >
                          <Plus className="w-4 h-4 mr-2" /> Add Connection
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : connectionScreen === "cloud-sync" ? (
            <div className="flex flex-col h-full w-full max-w-3xl mx-auto px-6 py-8 text-foreground">
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-3">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-muted-foreground hover:text-foreground"
                    onClick={() => setConnectionScreen("list")}
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  <div>
                    <h2 className="text-sm font-bold tracking-tight">
                      Cloud Sync
                    </h2>
                    <p className="text-muted-foreground text-sm mt-1">
                      Encrypted sync across devices.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-studio-border/60 bg-studio-bg/40 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">
                      Cloud Sync (Encrypted)
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Connections stay local unless you enable encrypted sync.
                      We never store your key.
                    </p>
                  </div>
                  <Switch
                    checked={cloudSyncEnabled}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        void handleEnableCloudSync();
                      } else {
                        handleDisableCloudSync();
                      }
                    }}
                    disabled={!plan.cloudEnabled}
                  />
                </div>
                {!plan.cloudEnabled && (
                  <p className="text-xs text-muted-foreground">
                    Upgrade to Pro or Team to enable cloud sync.
                  </p>
                )}
                {plan.cloudEnabled && !cloudSyncEnabled && (
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                      type="password"
                      value={cloudSyncKeyInput}
                      onChange={(event) =>
                        setCloudSyncKeyInput(event.target.value)
                      }
                      placeholder="Encryption key"
                      className="h-9 text-sm border-border/60 bg-background"
                    />
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 border-border/60"
                        onClick={() => void handleFetchCloudConnections()}
                      >
                        Get Connections
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-9 bg-primary text-primary-foreground hover:bg-primary/90"
                        onClick={() => void handleEnableCloudSync()}
                      >
                        Enable Sync
                      </Button>
                    </div>
                  </div>
                )}
                {cloudSyncEnabled && (
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-muted-foreground">
                      {cloudSyncLoading
                        ? "Syncing..."
                        : lastCloudSyncAt
                          ? `Last synced ${new Date(lastCloudSyncAt).toLocaleTimeString()}`
                          : "Syncing enabled."}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs border-border/60"
                      onClick={() => void runInitialCloudSync()}
                    >
                      Sync now
                    </Button>
                  </div>
                )}
                {cloudSyncError && (
                  <p className="text-xs text-destructive">{cloudSyncError}</p>
                )}
              </div>
            </div>
          ) : connectionScreen === "compare" ? (
            <ConnectionSchemaCompareScreen
              connections={connections}
              onBack={() => setConnectionScreen("list")}
            />
          ) : connectionScreen === "settings" ? (
            <Dialog
              open={true}
              onOpenChange={(open) => {
                if (!open) setConnectionScreen("list");
              }}
            >
              <DialogContent
                hideCloseButton
                className="h-[80vh] w-[80vw] !max-w-[80vw] flex flex-col overflow-hidden p-0"
                overlayClassName="bg-black/40"
              >
                <DialogTitle className="sr-only">Settings</DialogTitle>
                <div className="flex h-full min-h-0">
                  <div className="flex-1 min-w-0">
                    <AppSettingsView
                      planCode={plan.code}
                      onOpenThemeCreator={handleOpenThemeCreator}
                      onOpenIconThemeCreator={handleOpenIconThemeCreator}
                    />
                  </div>
                  {isThemeCreatorOpen && (
                    <div className="w-[340px] shrink-0 overflow-hidden border-l border-studio-border">
                      <ThemeCreatorPanel
                        isOpen={isThemeCreatorOpen}
                        onClose={handleCloseThemeCreator}
                        activeTheme={selectedAppTheme}
                        customAppThemes={appTheme.customAppThemes}
                        builtInAppThemes={BUILTIN_APP_THEMES}
                        onSaveTheme={handleSaveTheme}
                      />
                    </div>
                  )}
                  {isIconThemeCreatorOpen && (
                    <div className="w-[340px] shrink-0 overflow-hidden border-l border-studio-border">
                      <IconThemeCreatorPanel
                        isOpen={isIconThemeCreatorOpen}
                        onClose={handleCloseIconThemeCreator}
                        iconThemeId={iconThemeId}
                        customIconThemes={customIconThemes}
                        onSaveIconTheme={handleSaveIconTheme}
                      />
                    </div>
                  )}
                </div>
              </DialogContent>
            </Dialog>
          ) : connectionScreen === "supabase" ? (
            <div className="h-full min-h-0 w-full overflow-y-auto scrollbar-hide">
              <div className="mx-auto w-full max-w-5xl px-6 py-6">
                <SupabaseAccountsScreen
                  accounts={supabaseAccounts}
                  activeAccountId={activeSupabaseAccountId}
                  onSwitchAccount={setActiveSupabaseAccountId}
                  onRemoveAccount={handleRemoveSupabaseAccount}
                  onAddAccount={handleAddSupabaseAccount}
                  canAddAccount={canAddSupabaseAccount(
                    entitlement.premiumActive,
                    supabaseAccounts.length,
                  ).allowed}
                  existingConnectionStrings={connections.map(
                    (c) => c.connectionString,
                  )}
                  maxConnections={plan.maxConnections}
                  onConnectProject={handleSupabaseConnectProject}
                />
              </div>
            </div>
          ) : connectionScreen === "spacetimedb-account" ? (
            <div className="h-full min-h-0 w-full overflow-y-auto scrollbar-hide">
              <div className="mx-auto w-full max-w-5xl px-6 py-6">
                <SpacetimeDbAccountsScreen
                  accounts={spacetimedbAccounts}
                  activeAccountId={activeSpacetimeDbAccountId}
                  onSwitchAccount={setActiveSpacetimeDbAccountId}
                  onRemoveAccount={handleRemoveSpacetimeDbAccount}
                  onAddAccount={handleAddSpacetimeDbAccount}
                  canAddAccount={canAddSpacetimeDbAccount(
                    entitlement.premiumActive,
                    spacetimedbAccounts.length,
                  ).allowed}
                  existingConnectionStrings={connections.map(
                    (c) => c.connectionString,
                  )}
                  maxConnections={plan.maxConnections}
                  onConnectDatabase={handleSpacetimeDbConnectDatabase}
                />
              </div>
            </div>
          ) : connectionScreen === "neon-cli" ? (
            <div className="h-full min-h-0 w-full overflow-y-auto scrollbar-hide">
              <div className="mx-auto w-full max-w-5xl px-6 py-6">
                <NeonAccountsScreen
                  accounts={neonAccounts}
                  activeAccountId={activeNeonAccountId}
                  onSwitchAccount={setActiveNeonAccountId}
                  onRemoveAccount={handleRemoveNeonAccount}
                  onAddAccount={() => void handleAddNeonAccount()}
                  canAddAccount={canAddNeonAccount(
                    entitlement.premiumActive,
                    neonAccounts.length,
                  ).allowed}
                  existingConnectionStrings={connections.map(
                    (c) => c.connectionString,
                  )}
                  cliInstalled={neonCliInstalled}
                  checkingCli={neonCliChecking}
                  onRecheckCli={() => void checkNeonCli()}
                  onConnectDatabase={handleNeonConnectDatabase}
                  onReconnectAccount={(profileName) => void handleReconnectNeonAccount(profileName)}
                  reloadSignal={neonReloadSignal}
                />
              </div>
            </div>
          ) : connectionScreen === "planetscale-account" ? (
            <div className="h-full min-h-0 w-full overflow-y-auto scrollbar-hide">
              <div className="mx-auto w-full max-w-5xl px-6 py-6">
                <PlanetscaleAccountsScreen
                  accounts={planetscaleAccounts}
                  activeAccountId={activePlanetscaleAccountId}
                  onSwitchAccount={setActivePlanetscaleAccountId}
                  onRemoveAccount={handleRemovePlanetscaleAccount}
                  onAddAccount={handleAddPlanetscaleAccount}
                  canAddAccount={canAddPlanetscaleAccount(
                    entitlement.premiumActive,
                    planetscaleAccounts.length,
                  ).allowed}
                  onConnectDatabase={handlePlanetscaleConnectDatabase}
                />
              </div>
            </div>
          ) : connectionScreen === "new-select" ? (
            <div className="h-full min-h-0 w-full overflow-y-auto scrollbar-hide">
              <div className="flex min-h-full w-full flex-col items-center px-6 py-6">
                <div className="w-full max-w-2xl space-y-6">
                  <div className="text-center">
                    <h2 className="text-sm font-bold">Add Connection</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Select a provider or paste connection string
                    </p>
                  </div>

                  <Input
                    placeholder="postgresql://user:password@host:5432/database"
                    className="h-11 rounded-lg border-border/60 bg-background font-mono text-sm focus:border-border"
                    value={connectionString}
                    onChange={(e) => {
                      const next = e.target.value;
                      setConnectionString(next);
                      const detected = detectProvider(next, null);
                      if (
                        detected &&
                        next.includes("://") &&
                        next.length > 16
                      ) {
                        setSelectedProvider(detected);
                        // Auto-fill logic...
                        if (detected === "postgresql") {
                          const parsed = parsePostgresConnectionString(next);
                          if (parsed) {
                            setPgHost(parsed.host);
                            setPgPort(parsed.port);
                            setPgDatabase(parsed.database);
                            setPgUsername(parsed.username);
                            setPgPassword(parsed.password);
                            setPgSslMode(parsed.sslMode);
                          }
                        }
                        setConnectionScreen("new-form");
                      }
                    }}
                    ref={connectionStringInputRef}
                  />

                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-studio-border/60" />
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className="bg-studio-bg px-2 text-muted-foreground">
                        or connect via account
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (supabaseAccounts.length > 0) {
                        if (onOpenSupabaseAccounts) onOpenSupabaseAccounts();
                        else setConnectionScreen("supabase");
                      } else {
                        handleAddSupabaseAccount();
                      }
                    }}
                    className="w-full flex items-center gap-3 rounded-lg border border-studio-border/60 bg-studio-bg/60 p-4 text-left hover:border-studio-border hover:bg-studio-row-hover/80"
                  >
                    <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-muted/60 flex items-center justify-center">
                      <SupabaseLogo className="h-7 w-7" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        Supabase Account
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {supabaseAccounts.length === 0
                          ? "Log in to browse and connect your projects"
                          : supabaseAccounts.length === 1
                            ? `Logged in as ${
                                supabaseAccounts[0]?.email ||
                                supabaseAccounts[0]?.name ||
                                "Supabase account"
                              }`
                            : `${supabaseAccounts.length} accounts linked`}
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (spacetimedbAccounts.length > 0) {
                        if (onOpenSpacetimedbAccounts) onOpenSpacetimedbAccounts();
                        else setConnectionScreen("spacetimedb-account");
                      } else {
                        handleAddSpacetimeDbAccount();
                      }
                    }}
                    className="w-full flex items-center gap-3 rounded-lg border border-studio-border/60 bg-studio-bg/60 p-4 text-left hover:border-studio-border hover:bg-studio-row-hover/80"
                  >
                    <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-muted/60 flex items-center justify-center">
                      <SpacetimeDbLogo className="h-[26px] w-[26px] text-foreground/80" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        SpacetimeDB Account
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {spacetimedbAccounts.length === 0
                          ? "Log in to browse and connect your databases"
                          : spacetimedbAccounts.length === 1
                            ? `Logged in as ${
                                spacetimedbAccounts[0]?.identity
                                  ? `${spacetimedbAccounts[0].identity.slice(0, 8)}…`
                                  : "SpacetimeDB account"
                              }`
                            : `${spacetimedbAccounts.length} accounts linked`}
                      </div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      if (neonAccounts.length > 0) {
                        if (onOpenNeonAccounts) onOpenNeonAccounts();
                        else setConnectionScreen("neon-cli");
                      } else {
                        void handleAddNeonAccount();
                      }
                    }}
                    className="w-full flex items-center gap-3 rounded-lg border border-studio-border/60 bg-studio-bg/60 p-4 text-left hover:border-studio-border hover:bg-studio-row-hover/80"
                  >
                    <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-muted/60 flex items-center justify-center">
                      <NeonLogo className="h-7 w-7" />
                    </div>
                    <div className="flex-1">
                      <div className="text-sm font-medium">
                        Neon Account
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {neonAccounts.length === 0
                          ? "Sign in (via Neon CLI) to browse and connect your projects"
                          : neonAccounts.length === 1
                            ? `Signed in as ${
                                neonAccounts[0]?.label || neonAccounts[0]?.profileName
                              }`
                            : `${neonAccounts.length} accounts linked`}
                      </div>
                    </div>
                  </button>

                  {PLANETSCALE_LOGIN_ENABLED && (
                    <button
                      type="button"
                      onClick={() => {
                        if (planetscaleAccounts.length > 0) {
                          if (onOpenPlanetscaleAccounts) onOpenPlanetscaleAccounts();
                          else setConnectionScreen("planetscale-account");
                        } else {
                          handleAddPlanetscaleAccount();
                        }
                      }}
                      className="w-full flex items-center gap-3 rounded-lg border border-studio-border/60 bg-studio-bg/60 p-4 text-left hover:border-studio-border hover:bg-studio-row-hover/80"
                    >
                      <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-muted/60 flex items-center justify-center">
                        <ProviderLogo type="planetscale" className="h-7 w-7" />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-medium">
                          PlanetScale Account
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {planetscaleAccounts.length === 0
                            ? "Log in to browse and connect your databases"
                            : planetscaleAccounts.length === 1
                              ? `Logged in as ${
                                  planetscaleAccounts[0]?.email ||
                                  planetscaleAccounts[0]?.name ||
                                  "PlanetScale account"
                                }`
                              : `${planetscaleAccounts.length} accounts linked`}
                        </div>
                      </div>
                    </button>
                  )}

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {providerCards.map((card) => (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => {
                          if (card.id === "jdbc") {
                            setConnectionScreen("jdbc-picker");
                          } else {
                            setSelectedProvider(card.id);
                            if (isFieldBasedProvider(card.id)) {
                              setFieldValues(
                                emptyFieldValues(card.id as FieldProviderId),
                              );
                            } else {
                              setFieldValues(null);
                            }
                            setConnectionScreen("new-form");
                          }
                        }}
                        className="group flex flex-col items-center justify-center rounded-lg border border-studio-border/60 bg-studio-bg/60 p-3.5 hover:border-studio-border hover:bg-studio-row-hover/80"
                      >
                        {card.id === "spacetimedb" ? (
                          <SpacetimeDbLogo className="mb-2 h-[26px] w-[26px] text-foreground opacity-80 group-hover:opacity-100" />
                        ) : card.id === "supabase" ? (
                          <SupabaseLogo className="mb-2 h-[26px] w-[26px] opacity-80 group-hover:opacity-100" />
                        ) : card.id === "neon" ? (
                          <NeonLogo className="mb-2 h-[26px] w-[26px] opacity-80 group-hover:opacity-100" />
                        ) : (
                          <Image
                            src={card.logoSrc}
                            alt={card.label}
                            width={26}
                            height={26}
                            className="mb-2 rounded-lg object-contain opacity-80 group-hover:opacity-100"
                          />
                        )}
                        <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">
                          {card.label}
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="text-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setConnectionScreen("list");
                        resetConnectionDraft();
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : connectionScreen === "jdbc-picker" ? (
            <JdbcDatabasePickerScreen
              onBack={() => {
                setConnectionScreen("new-select");
                resetConnectionDraft();
              }}
              onSelect={async (driver) => {
                setSelectedProvider("jdbc");
                setJdbcUrl(
                  driver.urlTemplate
                    .replace("${host}", "localhost")
                    .replace("${port}", String(driver.defaultPort || 5432))
                    .replace("${database}", "mydb"),
                );
                setJdbcDriverClass(driver.driverClass);
                setConnectionScreen("new-form");
                const installed = await loadInstalledDrivers();
                const existing = installed.find((i) => i.name === driver.name);
                if (existing) {
                  setJdbcJarPaths(existing.jarPaths);
                } else {
                  setPendingInstallDriver(driver);
                  setInstallPromptOpen(true);
                }
              }}
            />
          ) : (
            // Form Screen
            <div className="h-full w-full overflow-y-auto scrollbar-hide py-6">
              <div className="mx-auto max-w-6xl space-y-4 px-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setConnectionScreen(
                          connectionScreen === "edit-form"
                            ? "list"
                            : "new-select",
                        );
                        resetConnectionDraft();
                      }}
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </Button>
                    <h2 className="text-sm font-semibold">
                      Configure {selectedProvider}
                    </h2>
                  </div>
                  {selectedProvider === "spacetimedb" ? (
                    <SpacetimeDbLogo className="h-[22px] w-[22px] text-foreground/60" />
                  ) : selectedProvider === "supabase" || selectedProvider === "supabase-mgmt" ? (
                    <SupabaseLogo className="h-[22px] w-[22px] opacity-60" />
                  ) : selectedProvider === "neon" ? (
                    <NeonLogo className="h-[22px] w-[22px] opacity-60" />
                  ) : selectedProvider &&
                    providerCards.some((c) => c.id === selectedProvider) ? (
                    <Image
                      src={getProviderLogoUrl(selectedProvider)}
                      alt={selectedProvider}
                      width={22}
                      height={22}
                      className="opacity-60 rounded-full"
                    />
                  ) : null}
                </div>

                <form
                  ref={connectionFormRef}
                  onSubmit={handleAdd}
                  className="space-y-4"
                >
                  <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
                    <Card className="space-y-5 border-studio-border/60 bg-studio-bg/80 p-5 [&_input]:text-sm [&_textarea]:text-sm">
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold">Details</h3>
                        <p className="text-xs text-muted-foreground">
                          Name, environment, folder and favorite.
                        </p>
                      </div>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label
                            htmlFor="name-screen"
                            className="text-sm font-medium"
                          >
                            Connection Name
                          </Label>
                          <Input
                            id="name-screen"
                            placeholder={buildConnectionName(
                              getCandidateConnectionString(),
                              selectedProvider,
                            )}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="h-10 border-border/60 bg-background"
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">
                              Environment
                            </Label>
                            <SearchableSelect
                              value={environment || ""}
                              onValueChange={(value) =>
                                setEnvironment((value as any) || null)
                              }
                              placeholder="Select environment"
                              searchThreshold={0}
                              className="h-10 w-full border-border/60 bg-background"
                              options={[
                                { value: "", label: "None" },
                                { value: "production", label: "Production" },
                                { value: "staging", label: "Staging" },
                                { value: "local", label: "Local" },
                              ]}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">
                              Group / Folder
                            </Label>
                            <Popover
                              open={folderPopoverOpen}
                              onOpenChange={setFolderPopoverOpen}
                            >
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  className="h-10 w-full justify-between border-border/60 bg-background text-sm font-normal"
                                >
                                  {groups.length === 0 ? (
                                    <span className="text-muted-foreground">
                                      Select folders
                                    </span>
                                  ) : (
                                    <span className="truncate">
                                      {groups.join(", ")}
                                    </span>
                                  )}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent
                                className="w-[var(--radix-popover-trigger-width)] p-1 bg-popover"
                                align="start"
                              >
                                {connectionGroups.length === 0 ? (
                                  <div className="px-2 py-4 text-sm text-center text-muted-foreground">
                                    No folders found.
                                  </div>
                                ) : (
                                  <div className="max-h-60 overflow-y-auto space-y-0.5">
                                    {connectionGroups.map((g) => {
                                      const isSelected = groups.includes(
                                        g.name,
                                      );
                                      return (
                                        <div
                                          key={g.name}
                                          role="option"
                                          aria-selected={isSelected}
                                          className="flex items-center gap-2 px-2 py-1.5 text-sm cursor-pointer rounded hover:bg-accent aria-selected:bg-accent"
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            setGroups((prev) =>
                                              isSelected
                                                ? prev.filter(
                                                    (n) => n !== g.name,
                                                  )
                                                : [...prev, g.name],
                                            );
                                          }}
                                        >
                                          <div
                                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isSelected ? "bg-primary border-primary" : "border-border"}`}
                                          >
                                            {isSelected && (
                                              <Check className="h-3 w-3 text-primary-foreground" />
                                            )}
                                          </div>
                                          <span className="truncate">
                                            {g.name}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </PopoverContent>
                            </Popover>
                          </div>
                        </div>

                        <div className="flex items-center justify-between py-2 border-t border-border/40">
                          <div className="space-y-0.5">
                            <Label className="text-sm font-medium">
                              Favorite
                            </Label>
                            <p className="text-xs text-muted-foreground">
                              Pin to top of list
                            </p>
                          </div>
                          <Switch
                            checked={isFavorite}
                            onCheckedChange={setIsFavorite}
                          />
                        </div>

                        {workspaceMode &&
                          roles.length > 0 &&
                          can("connections.manage_access") && (
                            <div className="border-t border-border/40 pt-3 space-y-3">
                              <Label className="text-sm font-medium">
                                Role Access
                              </Label>
                              <p className="text-xs text-muted-foreground -mt-1">
                                Control which roles can access this connection
                              </p>
                              <div className="space-y-2">
                                {roles.map((role) => (
                                  <div
                                    key={role.id}
                                    className="flex items-center gap-3"
                                  >
                                    <span className="text-xs truncate w-24 shrink-0">
                                      {role.name}
                                    </span>
                                    <div className="relative flex-1">
                                      <SearchableSelect
                                        value={formAccess[role.id] || ""}
                                        onValueChange={(val) => {
                                          setFormAccess((prev) => {
                                            const next = { ...prev };
                                            if (val) {
                                              next[role.id] = val as AccessType;
                                            } else {
                                              delete next[role.id];
                                            }
                                            return next;
                                          });
                                        }}
                                        placeholder="No access"
                                        searchThreshold={0}
                                        className="h-10 w-full text-sm font-normal border-border/60"
                                        options={[
                                          { value: "", label: "No access" },
                                          {
                                            value: "READ_ONLY",
                                            label: "Read only",
                                          },
                                          {
                                            value: "READ_AND_REQUEST",
                                            label: "Read & request",
                                          },
                                          {
                                            value: "FULL_ACCESS",
                                            label: "Full access",
                                          },
                                        ]}
                                      />
                                      <ChevronsUpDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 shrink-0 opacity-50 pointer-events-none" />
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                    </Card>

                    <Card className="space-y-5 border-studio-border/60 bg-studio-bg/80 p-5 [&_input]:text-sm [&_textarea]:text-sm">
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold">
                          Database Connection
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          Connection string, host, port, credentials and SSL.
                        </p>
                      </div>
                      <div className="space-y-5">
                      {selectedProvider === "postgresql" ? (
                        <div className="space-y-4">
                          <div className="space-y-2 rounded-lg border border-border/60 bg-muted/40 p-3">
                            <Label
                              htmlFor="conn-uri"
                              className="text-sm font-medium flex items-center gap-2"
                            >
                              Connection String{" "}
                              <span className="text-xs font-normal text-muted-foreground">
                                (Optional fast-fill)
                              </span>
                            </Label>
                            <Input
                              id="conn-uri"
                              placeholder="postgresql://user:password@host:5432/database"
                              className="font-mono text-sm bg-background border-border/60"
                              value={connectionString}
                              onChange={(e) => {
                                const next = e.target.value;
                                setConnectionString(next);
                                const parsed =
                                  parsePostgresConnectionString(next);
                                if (parsed) fillPgForm(parsed);
                              }}
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label
                                htmlFor="pg-host"
                                className="text-sm font-medium"
                              >
                                Host
                              </Label>
                              <Input
                                id="pg-host"
                                value={pgHost}
                                onChange={(e) => setPgHost(e.target.value)}
                                className="bg-background border-border/60 h-9"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label
                                htmlFor="pg-port"
                                className="text-sm font-medium"
                              >
                                Port
                              </Label>
                              <Input
                                id="pg-port"
                                value={pgPort}
                                onChange={(e) =>
                                  setPgPort(
                                    e.target.value.replace(/[^\d]/g, ""),
                                  )
                                }
                                className="bg-background border-border/60 h-9"
                              />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label
                              htmlFor="pg-db"
                              className="text-sm font-medium"
                            >
                              Database
                            </Label>
                            <Input
                              id="pg-db"
                              value={pgDatabase}
                              onChange={(e) => setPgDatabase(e.target.value)}
                              className="bg-background border-border/60 h-9"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label
                                htmlFor="pg-user"
                                className="text-sm font-medium"
                              >
                                Username
                              </Label>
                              <Input
                                id="pg-user"
                                value={pgUsername}
                                onChange={(e) => setPgUsername(e.target.value)}
                                className="bg-background border-border/60 h-9"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label
                                htmlFor="pg-password"
                                className="text-sm font-medium"
                              >
                                Password
                              </Label>
                              <PasswordInput
                                id="pg-password"
                                value={pgPassword}
                                onChange={setPgPassword}
                                show={showPassword}
                                onToggleShow={() =>
                                  setShowPassword((prev) => !prev)
                                }
                              />
                              <button
                                type="button"
                                className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-1"
                                onClick={() => {
                                  setPgEnableKeychain((prev) => !prev);
                                  window.alert(
                                    "Changing keychain setting requires app restart to fully apply.",
                                  );
                                }}
                              >
                                <ShieldCheck className="w-3.5 h-3.5" />
                                <span>
                                  {pgEnableKeychain
                                    ? "Disable keychain"
                                    : "Enable keychain"}
                                </span>
                              </button>
                            </div>
                          </div>

                          <div className="border-t border-border/60 pt-4 space-y-4">
                            <div className="space-y-2">
                              <Label
                                htmlFor="pg-ssl"
                                className="text-sm font-medium"
                              >
                                SSL Mode
                              </Label>
                              <SearchableSelect
                                value={pgSslMode}
                                onValueChange={(value) =>
                                  setPgSslMode(value as PgSslMode)
                                }
                                placeholder="Select SSL mode"
                                searchThreshold={0}
                                className="h-8 w-full border-border/60 bg-background text-xs"
                                options={[
                                  { value: "disable", label: "Disabled" },
                                  { value: "prefer", label: "Prefer" },
                                  { value: "require", label: "Require" },
                                  { value: "verify-ca", label: "Verify CA" },
                                  {
                                    value: "verify-full",
                                    label: "Verify Full",
                                  },
                                ]}
                              />
                            </div>

                            <div className="border-t border-border/60 pt-2">
                              <div className="mb-3 mt-1 flex items-center justify-between">
                                <Label className="text-sm font-medium">
                                  SSH Tunnel
                                </Label>
                                <div className="inline-flex rounded-lg border border-border/60 bg-muted/40 p-0.5">
                                  <button
                                    type="button"
                                    onClick={() => setPgSshMode("off")}
                                    className={`rounded-lg px-3 py-1 text-xs font-medium ${pgSshMode === "off" ? "border border-border/60 bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                                  >
                                    Off
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPgSshMode("ssh")}
                                    className={`rounded-lg px-3 py-1 text-xs font-medium ${pgSshMode === "ssh" ? "border border-border/60 bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                                  >
                                    Enable SSH
                                  </button>
                                </div>
                              </div>

                              {pgSshMode === "ssh" && (
                                <div className="mt-3 space-y-4 rounded-lg border border-border/60 bg-muted/40 p-4">
                                  <div className="grid grid-cols-3 gap-3">
                                    <div className="space-y-2 col-span-2">
                                      <Label
                                        htmlFor="ssh-host"
                                        className="text-xs"
                                      >
                                        SSH Server
                                      </Label>
                                      <Input
                                        id="ssh-host"
                                        value={pgSshHost}
                                        onChange={(e) =>
                                          setPgSshHost(e.target.value)
                                        }
                                        placeholder="192.168.1.1"
                                        className="bg-background border-border/60 h-9"
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <Label
                                        htmlFor="ssh-port"
                                        className="text-xs"
                                      >
                                        Port
                                      </Label>
                                      <Input
                                        id="ssh-port"
                                        value={pgSshPort}
                                        onChange={(e) =>
                                          setPgSshPort(
                                            e.target.value.replace(
                                              /[^\d]/g,
                                              "",
                                            ),
                                          )
                                        }
                                        placeholder="22"
                                        className="bg-background border-border/60 h-9"
                                      />
                                    </div>
                                  </div>

                                  <div className="space-y-2">
                                    <Label
                                      htmlFor="ssh-user"
                                      className="text-xs"
                                    >
                                      SSH Username
                                    </Label>
                                    <Input
                                      id="ssh-user"
                                      value={pgSshUsername}
                                      onChange={(e) =>
                                        setPgSshUsername(e.target.value)
                                      }
                                      placeholder="ubuntu"
                                      className="bg-background border-border/60 h-9"
                                    />
                                  </div>

                                  <div className="space-y-3 pt-2">
                                    <Label className="text-xs">
                                      Authentication
                                    </Label>
                                    <div className="grid grid-cols-2 rounded-lg border border-border/60 bg-muted/40 p-0.5">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setPgSshAuthMode("password")
                                        }
                                        className={`rounded-lg py-1 text-xs font-medium ${pgSshAuthMode === "password" ? "border border-border/60 bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                                      >
                                        Password
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setPgSshAuthMode("private-key")
                                        }
                                        className={`inline-flex items-center justify-center gap-1 rounded-lg py-1 text-xs font-medium ${pgSshAuthMode === "private-key" ? "border border-border/60 bg-background text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                                      >
                                        <KeyRound className="w-3.5 h-3.5" />
                                        Private Key
                                      </button>
                                    </div>
                                  </div>

                                  {pgSshAuthMode === "password" ? (
                                    <div className="space-y-2">
                                      <Label
                                        htmlFor="ssh-password"
                                        className="text-xs"
                                      >
                                        SSH Password
                                      </Label>
                                      <PasswordInput
                                        id="ssh-password"
                                        value={pgSshPassword}
                                        onChange={setPgSshPassword}
                                        show={showSshPassword}
                                        onToggleShow={() =>
                                          setShowSshPassword((prev) => !prev)
                                        }
                                      />
                                    </div>
                                  ) : (
                                    <div className="space-y-2">
                                      <Label
                                        htmlFor="ssh-key"
                                        className="text-xs"
                                      >
                                        Private Key
                                      </Label>
                                      <Textarea
                                        id="ssh-key"
                                        value={pgSshPrivateKey}
                                        onChange={(e) =>
                                          setPgSshPrivateKey(e.target.value)
                                        }
                                        className="bg-background border-border/60 font-mono text-xs min-h-[120px]"
                                      />
                                      <button
                                        type="button"
                                        className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                                        onClick={() => {
                                          setPgSshEnableKeychain(
                                            (prev) => !prev,
                                          );
                                          window.alert(
                                            "Changing keychain setting requires app restart to fully apply.",
                                          );
                                        }}
                                      >
                                        <ShieldCheck className="w-3.5 h-3.5" />
                                        <span>
                                          {pgSshEnableKeychain
                                            ? "Disable keychain"
                                            : "Enable keychain"}
                                        </span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : selectedProvider === "turso" ? (
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label
                              htmlFor="turso-endpoint"
                              className="text-sm font-medium"
                            >
                              Database Endpoint
                            </Label>
                            <Input
                              id="turso-endpoint"
                              placeholder="your-db-your-org.turso.io"
                              value={tursoEndpoint}
                              onChange={(e) => {
                                setTursoEndpoint(e.target.value);
                                setConnectionString("");
                              }}
                              required
                              className="bg-background border-border/60"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label
                              htmlFor="turso-token"
                              className="text-sm font-medium"
                            >
                              Auth Token
                            </Label>
                            <Input
                              id="turso-token"
                              placeholder="turso-auth-token"
                              value={tursoAuthToken}
                              onChange={(e) => {
                                setTursoAuthToken(e.target.value);
                                setConnectionString("");
                              }}
                              required
                              className="bg-background border-border/60"
                            />
                          </div>
                        </div>
                      ) : selectedProvider === "federated" ? (
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">
                              Mapped Sources
                            </Label>
                            <FederatedConnectionForm
                              connections={connections.filter(
                                (conn) =>
                                  detectConnectionDbType(
                                    conn.connectionString,
                                  ) !== "federated" &&
                                  conn.id !== editingConnection?.id,
                              )}
                              value={federatedSources}
                              onChange={setFederatedSources}
                            />
                          </div>
                          <div className="space-y-1">
                            {federatedConfigError ? (
                              <p className="text-xs text-destructive">
                                {federatedConfigError}
                              </p>
                            ) : (
                              <p className="text-xs text-muted-foreground">
                                Use aliases like `sales.users` and `app.orders`
                                in federated SQL queries.
                              </p>
                            )}
                          </div>
                        </div>
                      ) : selectedProvider === "jdbc" ? (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <Label
                              htmlFor="jdbc-url"
                              className="text-sm font-medium"
                            >
                              Connection String
                            </Label>
                            <Input
                              id="jdbc-url"
                              placeholder="postgresql://user:pass@host:5432/database"
                              value={jdbcUrl}
                              onChange={(e) => {
                                const v = e.target.value;
                                setJdbcUrl(v);
                                if (v && !jdbcDriverClass) {
                                  const dc = detectDriverClass(v);
                                  if (dc) setJdbcDriverClass(dc);
                                }
                              }}
                              className="bg-background border-border/60 font-mono text-sm"
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label
                                htmlFor="jdbc-driver"
                                className="text-sm font-medium"
                              >
                                Driver Class
                              </Label>
                              <button
                                type="button"
                                className="text-xs text-muted-foreground hover:text-foreground underline"
                                onClick={() => setJdbcDriverManagerOpen(true)}
                              >
                                Browse Drivers
                              </button>
                            </div>
                            <div className="relative">
                              <Input
                                id="jdbc-driver"
                                placeholder="org.postgresql.Driver"
                                value={jdbcDriverClass}
                                onChange={(e) =>
                                  setJdbcDriverClass(e.target.value)
                                }
                                className="bg-background border-border/60 font-mono text-sm pr-8"
                              />
                              {jdbcJarPaths.length > 0 && (
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500">
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label
                                htmlFor="jdbc-user"
                                className="text-sm font-medium"
                              >
                                Username
                              </Label>
                              <Input
                                id="jdbc-user"
                                placeholder="user"
                                value={jdbcUsername}
                                onChange={(e) =>
                                  setJdbcUsername(e.target.value)
                                }
                                className="bg-background border-border/60 h-9"
                              />
                            </div>
                            <div className="space-y-2">
                              <Label
                                htmlFor="jdbc-password"
                                className="text-sm font-medium"
                              >
                                Password
                              </Label>
                              <PasswordInput
                                id="jdbc-password"
                                value={jdbcPassword}
                                onChange={setJdbcPassword}
                                show={showPassword}
                                onToggleShow={() =>
                                  setShowPassword((prev) => !prev)
                                }
                              />
                            </div>
                          </div>
                          {jdbcJarPaths.length > 0 && (
                            <div className="space-y-1">
                              <Label className="text-xs text-muted-foreground">
                                Driver JAR{jdbcJarPaths.length > 1 ? "s" : ""}
                              </Label>
                              <div className="text-xs text-muted-foreground truncate">
                                {jdbcJarPaths.join(", ")}
                              </div>
                            </div>
                          )}
                          <JdbcDriverManager
                            open={jdbcDriverManagerOpen}
                            onOpenChange={setJdbcDriverManagerOpen}
                            onSelectDriver={(driver) => {
                              setJdbcDriverClass(driver.driverClass);
                              setJdbcJarPaths(driver.jarPaths);
                              if (!jdbcUrl) {
                                const sample = driver.urlTemplate
                                  .replace("${host}", "localhost")
                                  .replace(
                                    "${port}",
                                    String(driver.defaultPort || 5432),
                                  )
                                  .replace("${database}", "mydb");
                                setJdbcUrl(sample);
                              }
                              setJdbcDriverManagerOpen(false);
                            }}
                          />
                        </div>
                      ) : selectedProvider === "sqlite" ? (
                        renderFilePickerSection({
                          id: "conn-sqlite-file",
                          description: (
                            <>
                              Select a SQLite database file, or type a path
                              manually. Use {memCode} for an in-memory database.
                            </>
                          ),
                        })
                      ) : selectedProvider === "duckdb" ? (
                        renderFilePickerSection({
                          id: "conn-duckdb-file",
                          description: (
                            <>
                              Select a DuckDB database file (
                              <code className="text-xs bg-muted px-1 rounded">
                                .duckdb
                              </code>{" "}
                              or{" "}
                              <code className="text-xs bg-muted px-1 rounded">
                                .ddb
                              </code>
                              ), or type a path manually. Use {memCode} for an
                              in-memory database.
                            </>
                          ),
                        })
                      ) : isFieldBasedProvider(selectedProvider) ? (
                        renderGenericFieldForm()
                      ) : (
                        <div className="space-y-2">
                          <Label
                            htmlFor="conn-uri-generic"
                            className="text-sm font-medium"
                          >
                            Connection URI
                          </Label>
                          <Input
                            id="conn-uri-generic"
                            placeholder={
                              providerCards.find(
                                (card) => card.id === selectedProvider,
                              )?.placeholder ??
                              "protocol://user:password@host:port/database"
                            }
                            value={connectionString}
                            onChange={(e) =>
                              setConnectionString(e.target.value)
                            }
                            required
                            className="bg-background border-border/60 font-mono text-sm"
                          />
                        </div>
                      )}
                        </div>
                    </Card>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        testingConnection ||
                        !getCandidateConnectionString().trim() ||
                        !selectedProvider
                      }
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleTestConnection();
                      }}
                      className="h-10 w-full gap-2"
                    >
                      {testingConnection ? "Testing..." : "Test Connection"}
                      <Kbd className="px-1.5 py-0.5 text-xs">⌘⇧T</Kbd>
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        loading ||
                        !getCandidateConnectionString().trim() ||
                        !selectedProvider
                      }
                      className="h-10 w-full gap-2"
                    >
                      {loading
                        ? "Saving..."
                        : connectionScreen === "edit-form"
                          ? "Save Changes"
                          : "Save Connection"}
                      <Kbd className="ml-1 px-1.5 py-0.5 text-xs">⌘↵</Kbd>
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </main>
      </div>

      <SupabaseLoginDialog
        open={supabaseLoginOpen}
        onOpenChange={setSupabaseLoginOpen}
        onLoginComplete={(token, account) => {
          setSupabaseAccounts((prev) => {
            const exists = prev.some((a) => a.id === account.id);
            return exists ? prev : [...prev, account];
          });
          setActiveSupabaseAccountId(account.id);
          if (onOpenSupabaseAccounts) onOpenSupabaseAccounts();
          else setConnectionScreen("supabase");
          void registerActiveSupabaseProjects(
            token,
            connectionsRef.current.map((c) => c.connectionString),
            plan.maxConnections,
            { listProjects, createConnection },
          ).then((result) => {
            const totalActive =
              result.imported +
              result.alreadyRegistered +
              result.skippedLimit;
            if (result.imported > 0) {
              void loadConnections();
              queueCloudPush();
              if (result.skippedLimit > 0) {
                toast.warning(
                  `Imported ${result.imported} of ${totalActive} active projects — upgrade for more connections`,
                );
              } else {
                toast.success(
                  `Imported ${result.imported} of ${totalActive} active projects`,
                );
              }
            } else if (result.skippedLimit > 0) {
              toast.warning("Upgrade to Pro for more connections");
            } else if (result.alreadyRegistered > 0) {
              toast.info("All active projects are already connected.");
            } else if (result.failed > 0) {
              toast.error("Failed to import projects.");
            } else {
              toast.info("No active projects to import.");
            }
          });
        }}
      />

      <SpacetimeDbLoginDialog
        open={spacetimedbLoginOpen}
        onOpenChange={setSpacetimedbLoginOpen}
        onLoginComplete={(token, account) => {
          setSpacetimedbAccounts((prev) => {
            const exists = prev.some((a) => a.id === account.id);
            return exists ? prev : [...prev, account];
          });
          setActiveSpacetimeDbAccountId(account.id);
          if (onOpenSpacetimedbAccounts) onOpenSpacetimedbAccounts();
          else setConnectionScreen("spacetimedb-account");
          void registerSpacetimeDbDatabases(
            token,
            account.host || "",
            connectionsRef.current.map((c) => c.connectionString),
            plan.maxConnections,
            { listDatabases: listSpacetimeDbDatabases, createConnection },
          ).then((result) => {
            const total =
              result.imported +
              result.alreadyRegistered +
              result.skippedLimit +
              result.skippedNameless;
            if (result.imported > 0) {
              void loadConnections();
              queueCloudPush();
              if (result.skippedLimit > 0) {
                toast.warning(
                  `Imported ${result.imported} of ${total} databases — upgrade for more connections`,
                );
              } else {
                toast.success(
                  `Imported ${result.imported} of ${total} databases`,
                );
              }
            } else if (result.skippedLimit > 0) {
              toast.warning("Upgrade to Pro for more connections");
            } else if (result.alreadyRegistered > 0) {
              toast.info("All databases are already connected.");
            } else if (result.failed > 0) {
              toast.error("Failed to import databases.");
            } else {
              toast.info("No databases to import.");
            }
          });
        }}
      />

      <NeonLoginDialog
        open={neonLoginOpen}
        reconnectProfile={neonReconnectProfile}
        onOpenChange={(nextOpen) => {
          setNeonLoginOpen(nextOpen);
          if (!nextOpen) setNeonReconnectProfile(null);
        }}
        onLoginComplete={(account) => {
          setNeonAccounts((prev) => {
            const exists = prev.some((a) => a.id === account.id);
            return exists ? prev : [...prev, account];
          });
          setActiveNeonAccountId(account.id);
          setNeonReconnectProfile(null);
          setNeonReloadSignal((n) => n + 1);
          if (onOpenNeonAccounts) onOpenNeonAccounts();
          else setConnectionScreen("neon-cli");
        }}
      />

      <PlanetscaleLoginDialog
        open={planetscaleLoginOpen}
        onOpenChange={setPlanetscaleLoginOpen}
        onLoginComplete={(account) => {
          setPlanetscaleAccounts((prev) => {
            const exists = prev.some((a) => a.id === account.id);
            return exists ? prev : [...prev, account];
          });
          setActivePlanetscaleAccountId(account.id);
          if (onOpenPlanetscaleAccounts) onOpenPlanetscaleAccounts();
          else setConnectionScreen("planetscale-account");
        }}
      />
    </div>
  );

  function renderManageDropdown() {
    return (
      <DropdownMenu open={manageMenuOpen} onOpenChange={setManageMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            className={cn(
              "gap-2 bg-primary text-primary-foreground hover:bg-primary/90",
              sleekLayout ? "h-8 text-xs" : "h-9",
            )}
          >
            Manage
            <ChevronDown
              className={cn(
                "w-4 ml-2 opacity-50",
                sleekLayout ? "w-3" : "w-4",
              )}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="bg-popover border-border text-foreground"
        >
          <DropdownMenuItem
            onClick={() => {
              setReorderMode((prev) => !prev);
              setManageMenuOpen(false);
            }}
            className="gap-2 focus:bg-muted/50"
          >
            {reorderMode ? "Done Reordering" : "Reorder Connections"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setShowOnlyFavorites((prev) => !prev);
              setManageMenuOpen(false);
            }}
            className="gap-2 focus:bg-muted/50"
          >
            {showOnlyFavorites ? (
              <Star className="w-4 h-4 fill-amber-500 text-amber-500" />
            ) : (
              <Star className="w-4 h-4" />
            )}
            {showOnlyFavorites ? "Show All Connections" : "Show Only Favorites"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setViewMode(viewMode === "card" ? "table" : "card");
              setManageMenuOpen(false);
            }}
            className="gap-2 focus:bg-muted/50"
          >
            {viewMode === "table" ? (
              <Square className="w-4 h-4" />
            ) : (
              <List className="w-4 h-4" />
            )}
            {viewMode === "table" ? "Card View" : "Table View"}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setFolderPromptMode("add");
              setFolderPromptValue("");
              setIsFolderPromptOpen(true);
              setManageMenuOpen(false);
            }}
            className="gap-2 focus:bg-muted/50"
          >
            <Plus className="w-4 h-4" /> Add Folder
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              setConnectionScreen("compare");
              setManageMenuOpen(false);
            }}
            className="gap-2 focus:bg-muted/50"
          >
            <ArrowRightLeft className="w-4 h-4" /> Compare Schemas
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border/60" />
          <DropdownMenuItem
            onClick={() => {
              setConnectionScreen("cloud-sync");
              setManageMenuOpen(false);
            }}
            className="gap-2 focus:bg-muted/50"
          >
            <ShieldCheck className="w-4 h-4" /> Cloud Sync
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-border/60" />
          <DropdownMenuItem
            onClick={() => {
              handleExport();
              setManageMenuOpen(false);
            }}
            className="gap-2 focus:bg-muted/50"
          >
            <ArrowRightLeft className="w-4 h-4 rotate-90" /> Export Connections
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              void handleImport();
              setManageMenuOpen(false);
            }}
            className="gap-2 focus:bg-muted/50"
          >
            <Plus className="w-4 h-4" /> Import Connections
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  function renderNewConnectionButton() {
    return (
      <Button
        size="sm"
        className="h-9 gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
        disabled={
          !planLoading &&
          plan.maxConnections !== null &&
          connections.length >= plan.maxConnections
        }
        onClick={() => {
          resetConnectionDraft();
          setConnectionScreen("new-select");
        }}
      >
        <Plus className="w-4 h-4" />
        New Connection
      </Button>
    );
  }
}
