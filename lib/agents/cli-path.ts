import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/** Finder/desktop launches often omit the directories used by CLI installers. */
export function localCliPath(path = process.env.PATH || "", home = homedir()): string {
  const common = process.platform === "win32"
    ? [join(home, ".local", "bin"), join(home, ".bun", "bin"), ...(process.env.APPDATA ? [join(process.env.APPDATA, "npm")] : [])]
    : [join(home, ".local", "bin"), join(home, ".bun", "bin"), join(home, ".npm-global", "bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  return [...new Set([...path.split(delimiter).filter(Boolean), ...common])].join(delimiter);
}
