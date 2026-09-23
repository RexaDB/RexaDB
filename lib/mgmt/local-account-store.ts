export interface LocalAccountBase {
  id: string;
  token: string;
  createdAt: number;
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function readLocalAccounts<T extends LocalAccountBase>(
  storageKey: string,
): T[] | null {
  if (!canUseLocalStorage()) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed as T[];
  } catch {
    return null;
  }
}

export function writeLocalAccounts<T extends LocalAccountBase>(
  storageKey: string,
  accounts: T[],
): void {
  if (!canUseLocalStorage()) return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(accounts));
  } catch {
    // ignore quota / security errors
  }
}

export function getSortedLocalAccounts<T extends LocalAccountBase>(
  storageKey: string,
): T[] {
  const accounts = readLocalAccounts<T>(storageKey);
  if (!accounts) return [];
  return filterSortLocalAccounts(accounts);
}

export function filterSortLocalAccounts<T extends LocalAccountBase>(
  accounts: T[],
): T[] {
  return accounts
    .filter((a) => typeof a?.token === "string" && a.token.length > 0)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function removeLocalAccount<T extends LocalAccountBase>(
  storageKey: string,
  accounts: T[],
  id: string,
): T[] | null {
  const next = accounts.filter((a) => a.id !== id);
  if (next.length === accounts.length) return null;
  writeLocalAccounts(storageKey, next);
  return next;
}
