import { DEFAULT_SPACETIMEDB_CLOUD_HOST } from "./client";
import { decodeSpacetimeDbIdentity } from "./identity";

const ACCOUNTS_KEY = "rexadb-spacetimedb-mgmt-accounts";

export interface SpacetimeDbMgmtAccount {
  id: string;
  token: string;
  /** Decoded identity hex string from the JWT `identity` claim. */
  identity?: string | null;
  /** Cloud/server host the databases are listed from. */
  host?: string | null;
  createdAt: number;
}

function readRawAccounts(): SpacetimeDbMgmtAccount[] | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as SpacetimeDbMgmtAccount[];
  } catch {
    return null;
  }
}

function writeAccounts(accounts: SpacetimeDbMgmtAccount[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // ignore quota / security errors
  }
}

export function getSpacetimeDbMgmtAccounts(): SpacetimeDbMgmtAccount[] {
  const accounts = readRawAccounts();
  if (!accounts) return [];
  let changed = false;
  for (const account of accounts) {
    if (
      typeof account?.token === "string" &&
      account.token.length > 0 &&
      !account.identity
    ) {
      const identity = decodeSpacetimeDbIdentity(account.token);
      if (identity) {
        account.identity = identity;
        changed = true;
      }
    }
  }
  if (changed) writeAccounts(accounts);
  return accounts
    .filter((a) => typeof a?.token === "string" && a.token.length > 0)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function addSpacetimeDbMgmtAccount(
  token: string,
  opts?: { host?: string | null },
): SpacetimeDbMgmtAccount {
  const trimmed = token.trim();
  const accounts = getSpacetimeDbMgmtAccounts();
  const existing = accounts.find((a) => a.token === trimmed);
  if (existing) {
    if (opts?.host && existing.host !== opts.host) {
      existing.host = opts.host;
      writeAccounts(accounts);
    }
    return existing;
  }
  const identity = decodeSpacetimeDbIdentity(trimmed);
  const account: SpacetimeDbMgmtAccount = {
    id: crypto.randomUUID(),
    token: trimmed,
    identity,
    host: opts?.host || DEFAULT_SPACETIMEDB_CLOUD_HOST,
    createdAt: Date.now(),
  };
  writeAccounts([...accounts, account]);
  return account;
}

export function removeSpacetimeDbMgmtAccount(id: string): void {
  const accounts = getSpacetimeDbMgmtAccounts();
  const next = accounts.filter((a) => a.id !== id);
  if (next.length === accounts.length) return;
  writeAccounts(next);
}

export function clearSpacetimeDbMgmtAccounts(): void {
  writeAccounts([]);
}