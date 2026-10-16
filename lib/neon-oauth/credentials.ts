// Server-only. Reads/writes Neon OAuth credentials in the same layout neonctl
// uses (~/.config/neon/credentials[.profile].json + profiles.json) so existing
// CLI sessions Continue to work and we never need the neonctl binary.
import { homedir } from "node:os";
import { join } from "node:path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  chmodSync,
  readdirSync,
} from "node:fs";
import { DEFAULT_PROFILE } from "./constants";

export interface NeonOAuthCredentials {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  /** Epoch milliseconds — same field neonctl writes. */
  expires_at: number;
  type?: "oauth";
  user_id?: string;
}

export interface NeonProfileMeta {
  name: string;
  label?: string;
  userId?: string;
  credentialsPath: string;
}

interface ProfilesFile {
  version: number;
  profiles: Record<
    string,
    {
      credentials: string;
      label?: string;
      userId?: string;
    }
  >;
}

function configDir(): string {
  const override = process.env.NEON_CONFIG_DIR?.trim();
  if (override) return override;
  return join(homedir(), ".config", "neon");
}

function ensureConfigDir(): string {
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function credentialsFileName(profile: string): string {
  return profile === DEFAULT_PROFILE ? "credentials.json" : `credentials.${profile}.json`;
}

function credentialsPath(profile: string): string {
  return join(configDir(), credentialsFileName(profile));
}

function profilesPath(): string {
  return join(configDir(), "profiles.json");
}

function readProfilesFile(): ProfilesFile {
  const path = profilesPath();
  if (!existsSync(path)) {
    return { version: 1, profiles: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as ProfilesFile;
    if (!parsed || typeof parsed !== "object" || !parsed.profiles) {
      return { version: 1, profiles: {} };
    }
    return {
      version: typeof parsed.version === "number" ? parsed.version : 1,
      profiles: parsed.profiles,
    };
  } catch {
    return { version: 1, profiles: {} };
  }
}

function writeProfilesFile(data: ProfilesFile): void {
  const dir = ensureConfigDir();
  const path = join(dir, "profiles.json");
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // best-effort on platforms that ignore mode
  }
}

function resolveCredentialsPath(profile: string): string {
  const profiles = readProfilesFile();
  const entry = profiles.profiles[profile];
  if (entry?.credentials) {
    const rel = entry.credentials;
    if (rel.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rel)) return rel;
    return join(configDir(), rel);
  }
  return credentialsPath(profile);
}

export function readCredentials(profile: string): NeonOAuthCredentials | null {
  const path = resolveCredentialsPath(profile);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as NeonOAuthCredentials;
    if (!parsed?.access_token || typeof parsed.expires_at !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCredentials(
  profile: string,
  credentials: NeonOAuthCredentials,
  meta?: { label?: string | null; userId?: string | null },
): void {
  const dir = ensureConfigDir();
  const fileName = credentialsFileName(profile);
  const path = join(dir, fileName);
  const payload: NeonOAuthCredentials = {
    ...credentials,
    type: "oauth",
  };
  writeFileSync(path, JSON.stringify(payload, null, 2) + "\n", { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    // ignore
  }

  const profiles = readProfilesFile();
  const prev = profiles.profiles[profile] ?? { credentials: fileName };
  profiles.profiles[profile] = {
    credentials: fileName,
    label: meta?.label ?? prev.label,
    userId: meta?.userId ?? prev.userId,
  };
  writeProfilesFile(profiles);
}

export function deleteCredentials(profile: string): void {
  const path = resolveCredentialsPath(profile);
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // ignore
  }
  const profiles = readProfilesFile();
  if (profiles.profiles[profile]) {
    delete profiles.profiles[profile];
    writeProfilesFile(profiles);
  }
}

export function listProfiles(): NeonProfileMeta[] {
  const profiles = readProfilesFile();
  const names = new Set<string>(Object.keys(profiles.profiles));

  // Also surface bare credential files that predate profiles.json entries.
  try {
    const dir = configDir();
    if (existsSync(dir)) {
      for (const name of readdirSync(dir)) {
        if (name === "credentials.json") names.add(DEFAULT_PROFILE);
        const match = /^credentials\.(.+)\.json$/.exec(name);
        if (match?.[1]) names.add(match[1]);
      }
    }
  } catch {
    // ignore
  }

  return [...names]
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const entry = profiles.profiles[name];
      return {
        name,
        label: entry?.label,
        userId: entry?.userId,
        credentialsPath: resolveCredentialsPath(name),
      };
    });
}

export function updateProfileMeta(
  profile: string,
  meta: { label?: string | null; userId?: string | null },
): void {
  const profiles = readProfilesFile();
  const prev = profiles.profiles[profile] ?? {
    credentials: credentialsFileName(profile),
  };
  profiles.profiles[profile] = {
    ...prev,
    credentials: prev.credentials || credentialsFileName(profile),
    label: meta.label ?? prev.label,
    userId: meta.userId ?? prev.userId,
  };
  writeProfilesFile(profiles);
}
