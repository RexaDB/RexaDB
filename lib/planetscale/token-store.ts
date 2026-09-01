const ACCOUNTS_KEY = "rexadb-planetscale-accounts";

export interface PlanetscaleAccount {
  id: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string; // ISO timestamp
  email?: string | null;
  name?: string | null;
  createdAt: number;
}

function readRawAccounts(): PlanetscaleAccount[] | null {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as PlanetscaleAccount[];
  } catch {
    return null;
  }
}

function writeAccounts(accounts: PlanetscaleAccount[]): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    // ignore quota / security errors
  }
}

export function getPlanetscaleAccounts(): PlanetscaleAccount[] {
  const accounts = readRawAccounts();
  if (!accounts) return [];
  return accounts
    .filter((a) => typeof a?.accessToken === "string" && a.accessToken.length > 0)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function addPlanetscaleAccount(tokens: {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  email?: string | null;
  name?: string | null;
}): PlanetscaleAccount {
  const accounts = getPlanetscaleAccounts();
  const account: PlanetscaleAccount = {
    id: crypto.randomUUID(),
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: tokens.expires_at,
    email: tokens.email ?? null,
    name: tokens.name ?? null,
    createdAt: Date.now(),
  };
  writeAccounts([...accounts, account]);
  return account;
}

export function updatePlanetscaleAccountTokens(
  id: string,
  tokens: { access_token: string; refresh_token: string; expires_at: string },
): void {
  const accounts = getPlanetscaleAccounts();
  const next = accounts.map((a) =>
    a.id === id
      ? {
          ...a,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: tokens.expires_at,
        }
      : a,
  );
  writeAccounts(next);
}

export function updatePlanetscaleAccountProfile(
  id: string,
  profile: { email?: string | null; name?: string | null },
): void {
  const accounts = getPlanetscaleAccounts();
  const next = accounts.map((a) => (a.id === id ? { ...a, ...profile } : a));
  writeAccounts(next);
}

export function removePlanetscaleAccount(id: string): void {
  const accounts = getPlanetscaleAccounts();
  const next = accounts.filter((a) => a.id !== id);
  if (next.length === accounts.length) return;
  writeAccounts(next);
}
