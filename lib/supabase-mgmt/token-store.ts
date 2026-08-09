const LEGACY_TOKEN_KEY = "rexadb-supabase-mgmt-token";
const ACCOUNTS_KEY = "rexadb-supabase-mgmt-accounts";

export interface SupabaseMgmtAccount {
  id: string;
  token: string;
  email?: string | null;
  name?: string | null;
  createdAt: number;
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const normalized = pad ? padded + "=".repeat(4 - pad) : padded;
  try {
    return decodeURIComponent(
      atob(normalized)
        .split("")
        .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(""),
    );
  } catch {
    return atob(normalized);
  }
}

function decodeMgmtAccountMeta(token: string): {
  email?: string | null;
  name?: string | null;
} {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return {};
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<
      string,
      unknown
    >;
    const email =
      typeof payload.email === "string" ? payload.email : undefined;
    const name =
      typeof payload.name === "string"
        ? payload.name
        : typeof payload.user_name === "string"
          ? payload.user_name
          : undefined;
    return { email, name };
  } catch {
    return {};
  }
}

function readRawAccounts(): SupabaseMgmtAccount[] | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as SupabaseMgmtAccount[];
  } catch {
    return null;
  }
}

function writeAccounts(accounts: SupabaseMgmtAccount[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // ignore quota / security errors
  }
}

function migrateLegacyToken(): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    if (window.localStorage.getItem(ACCOUNTS_KEY)) return;
    const legacy = window.localStorage.getItem(LEGACY_TOKEN_KEY);
    if (!legacy) return;
    const accounts: SupabaseMgmtAccount[] = [
      {
        id: crypto.randomUUID(),
        token: legacy.trim(),
        createdAt: Date.now(),
        ...decodeMgmtAccountMeta(legacy),
      },
    ];
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function getMgmtAccounts(): SupabaseMgmtAccount[] {
  migrateLegacyToken();
  const accounts = readRawAccounts();
  if (!accounts) return [];
  return accounts
    .filter((a) => typeof a?.token === "string" && a.token.length > 0)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// Returns the oldest-registered account's token (first in createdAt order),
// NOT the UI's active account.
export function getFirstMgmtToken(): string | null {
  const accounts = getMgmtAccounts();
  return accounts[0]?.token ?? null;
}

export function getMgmtToken(): string | null {
  return getFirstMgmtToken();
}

export function addMgmtAccount(token: string): SupabaseMgmtAccount {
  const trimmed = token.trim();
  const accounts = getMgmtAccounts();
  const existing = accounts.find((a) => a.token === trimmed);
  if (existing) return existing;
  const account: SupabaseMgmtAccount = {
    id: crypto.randomUUID(),
    token: trimmed,
    createdAt: Date.now(),
    ...decodeMgmtAccountMeta(trimmed),
  };
  writeAccounts([...accounts, account]);
  return account;
}

export function removeMgmtAccount(id: string): void {
  const accounts = getMgmtAccounts();
  const next = accounts.filter((a) => a.id !== id);
  if (next.length === accounts.length) return;
  writeAccounts(next);
}

export function clearMgmtTokens(): void {
  writeAccounts([]);
}

// Kept as aliases for any stragglers using the old single-token API.
export function saveMgmtToken(token: string): void {
  addMgmtAccount(token);
}

export function clearMgmtToken(): void {
  clearMgmtTokens();
}
