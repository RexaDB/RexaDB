import { DEFAULT_SPACETIMEDB_CLOUD_HOST } from "./client";
import { decodeSpacetimeDbIdentity } from "./identity";
import {
  filterSortLocalAccounts,
  readLocalAccounts,
  removeLocalAccount,
  writeLocalAccounts,
} from "@/lib/mgmt/local-account-store";

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

export function getSpacetimeDbMgmtAccounts(): SpacetimeDbMgmtAccount[] {
  const accounts = readLocalAccounts<SpacetimeDbMgmtAccount>(ACCOUNTS_KEY);
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
  if (changed) writeLocalAccounts(ACCOUNTS_KEY, accounts);
  return filterSortLocalAccounts(accounts);
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
      writeLocalAccounts(ACCOUNTS_KEY, accounts);
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
  writeLocalAccounts(ACCOUNTS_KEY, [...accounts, account]);
  return account;
}

export function removeSpacetimeDbMgmtAccount(id: string): void {
  const accounts = getSpacetimeDbMgmtAccounts();
  removeLocalAccount(ACCOUNTS_KEY, accounts, id);
}

export function clearSpacetimeDbMgmtAccounts(): void {
  writeLocalAccounts(ACCOUNTS_KEY, []);
}