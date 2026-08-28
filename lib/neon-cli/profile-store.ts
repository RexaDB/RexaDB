// Browser-safe. Tracks which `neon` CLI profiles RexaDB has linked, purely
// for UI display — the actual credential lives entirely in the CLI's own
// store (OS keyring or a profile file it manages), never here.
const PROFILES_KEY = "rexadb-neon-cli-profiles";

export interface NeonCliAccount {
  id: string;
  profileName: string;
  label?: string | null;
  createdAt: number;
}

function readRaw(): NeonCliAccount[] | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(PROFILES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as NeonCliAccount[]) : null;
  } catch {
    return null;
  }
}

function write(accounts: NeonCliAccount[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(PROFILES_KEY, JSON.stringify(accounts));
  } catch {
    // ignore quota / security errors
  }
}

export function getNeonCliAccounts(): NeonCliAccount[] {
  const accounts = readRaw();
  if (!accounts) return [];
  return accounts
    .filter((a) => typeof a?.profileName === "string" && a.profileName.length > 0)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function addNeonCliAccount(profileName: string, label?: string | null): NeonCliAccount {
  const accounts = getNeonCliAccounts();
  const existing = accounts.find((a) => a.profileName === profileName);
  if (existing) return existing;
  const account: NeonCliAccount = {
    id: crypto.randomUUID(),
    profileName,
    label: label ?? null,
    createdAt: Date.now(),
  };
  write([...accounts, account]);
  return account;
}

export function removeNeonCliAccount(id: string): void {
  const accounts = getNeonCliAccounts();
  const next = accounts.filter((a) => a.id !== id);
  if (next.length === accounts.length) return;
  write(next);
}
