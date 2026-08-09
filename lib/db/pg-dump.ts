function findLatestPgVersion(versions: string[]): string | null {
  const parsed = versions
    .map((version) => ({
      version,
      parts: version.split(".").map((part) => Number(part)),
    }))
    .filter((item) => item.parts.every((part) => Number.isFinite(part)));
  parsed.sort((a, b) => {
    const len = Math.max(a.parts.length, b.parts.length);
    for (let i = 0; i < len; i += 1) {
      const left = a.parts[i] ?? 0;
      const right = b.parts[i] ?? 0;
      if (left !== right) return left - right;
    }
    return 0;
  });
  return parsed.at(-1)?.version ?? null;
}

export async function resolvePgDumpBinary() {
  const explicit =
    String(process.env.REXADB_PG_DUMP_PATH || "").trim() ||
    String(process.env.PG_DUMP_PATH || "").trim();
  if (explicit) return { binary: explicit, candidates: [explicit] };

  const { existsSync, statSync, readdirSync } = await import("fs");
  const path = await import("path");

  const isWin = process.platform === "win32";
  const exe = `pg_dump${isWin ? ".exe" : ""}`;
  const candidates: string[] = [];

  const addCandidate = (value?: string) => {
    if (value) candidates.push(value);
  };

  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
  if (resourcesPath) {
    const platform = process.platform;
    const arch = process.arch;
    const platformDirs = [
      `${platform}-${arch}`,
      platform,
    ];
    for (const dir of platformDirs) {
      addCandidate(path.join(resourcesPath, "pg", dir, "bin", exe));
      addCandidate(path.join(resourcesPath, "app.asar.unpacked", "pg", dir, "bin", exe));
    }
    addCandidate(path.join(resourcesPath, "pg", "bin", exe));
    addCandidate(path.join(resourcesPath, "app.asar.unpacked", "pg", "bin", exe));
  }

  if (process.platform === "darwin") {
    addCandidate("/opt/homebrew/bin/pg_dump");
    addCandidate("/usr/local/bin/pg_dump");
    addCandidate("/usr/bin/pg_dump");
    const pgAppRoot = "/Applications/Postgres.app/Contents/Versions";
    try {
      if (existsSync(pgAppRoot)) {
        const versions = readdirSync(pgAppRoot).filter((entry) => entry && !entry.startsWith("."));
        const latest = findLatestPgVersion(versions);
        if (latest) {
          addCandidate(path.join(pgAppRoot, latest, "bin", "pg_dump"));
        }
      }
    } catch {}
  } else if (process.platform === "linux") {
    addCandidate("/usr/local/bin/pg_dump");
    addCandidate("/usr/bin/pg_dump");
  } else if (isWin) {
    const roots = [
      process.env.ProgramFiles,
      process.env["ProgramFiles(x86)"],
      "C:\\Program Files",
      "C:\\Program Files (x86)",
    ].filter(Boolean) as string[];
    for (const root of roots) {
      const pgRoot = path.join(root, "PostgreSQL");
      try {
        if (!existsSync(pgRoot)) continue;
        const versions = readdirSync(pgRoot).filter((entry) => entry && !entry.startsWith("."));
        const latest = findLatestPgVersion(versions);
        if (latest) {
          addCandidate(path.join(pgRoot, latest, "bin", exe));
        }
      } catch {}
    }
  }

  for (const candidate of candidates) {
    try {
      const stat = statSync(candidate);
      if (stat.isFile()) return { binary: candidate, candidates };
    } catch {}
  }

  return { binary: "pg_dump", candidates };
}
