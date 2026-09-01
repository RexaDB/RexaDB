// Server-only. GUI apps on macOS/Linux (Tauri prod builds included) are
// launched by launchd/the desktop session, not a terminal — they inherit a
// minimal PATH (typically just /usr/bin:/bin:/usr/sbin:/sbin) that never
// sources the user's shell profile. That's why CLI-detection (Neon, agent
// CLIs, etc.) that works fine in `bun run dev` (started from a terminal, full
// PATH) silently fails to find binaries installed via Homebrew, nvm, volta,
// or `npm i -g` in a packaged build. Fix it once, globally, at sidecar
// startup by asking the user's actual login shell what its PATH is.
import { execSync } from "child_process";
import os from "os";
import path from "path";

const COMMON_EXTRA_DIRS = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  path.join(os.homedir() || "", ".local/bin"),
  path.join(os.homedir() || "", ".bun/bin"),
  path.join(os.homedir() || "", ".volta/bin"),
  path.join(os.homedir() || "", ".npm-global/bin"),
  path.join(os.homedir() || "", ".yarn/bin"),
];

function getLoginShellPath(): string | null {
  if (process.platform === "win32") return null;
  const shell = process.env.SHELL || "/bin/zsh";
  try {
    // -i (interactive) + -l (login) sources the user's actual shell profile
    // (.zshrc/.zprofile/.bashrc/.bash_profile), where Homebrew/nvm/volta/etc.
    // usually append themselves to PATH. Short timeout so a misbehaving
    // profile script can't hang server startup.
    const out = execSync(`${shell} -ilc 'echo -n "$PATH"'`, {
      encoding: "utf-8",
      timeout: 4000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

let applied = false;

/** Merges the login shell's PATH (plus common install dirs) into process.env.PATH. Idempotent, call once at startup. */
export function ensureEnrichedPath(): void {
  if (applied) return;
  applied = true;

  const seen = new Set<string>();
  const merged: string[] = [];
  const add = (entries: string | undefined | null) => {
    if (!entries) return;
    for (const dir of entries.split(path.delimiter)) {
      const trimmed = dir.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        merged.push(trimmed);
      }
    }
  };

  add(process.env.PATH);
  add(getLoginShellPath());
  if (process.platform !== "win32") {
    for (const dir of COMMON_EXTRA_DIRS) add(dir);
  }

  process.env.PATH = merged.join(path.delimiter);
}
