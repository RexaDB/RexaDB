import { DEFAULT_TEMPLATES, type JdbcDriverTemplate } from "./jdbc-templates";
import path from "path";
import fs from "fs";

function log(...args: any[]) {
  try { console.error("[jdbc-bridge]", ...args); } catch {}
}

let bridgeProcess: any = null;
let bridgeChild: any = null;
let bridgeInitialized = false;
let shuttingDown = false;
let requestIdCounter = 0;
const pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
let buffer = "";
let jdbcLastStderr = "";
let jdbcLastExitCode: number | null = null;

export type JdbcConfig = {
  jdbcUrl: string;
  driverClass: string;
  jarPaths: string[];
  username?: string;
  password?: string;
};

type JdbcResponse = {
  ok: boolean;
  session: number;
  reqId: string | null;
  data: {
    error?: string;
    columns?: Array<{ name: string; type: string }>;
    rows?: any[][];
    rowCount?: number | null;
    affectedRows?: number;
  };
};

export { DEFAULT_TEMPLATES, type JdbcDriverTemplate };

function resolveJdbcUrl(template: JdbcDriverTemplate, opts: Record<string, string>): string {
  let url = template.urlTemplate;
  for (const [k, v] of Object.entries(opts)) {
    url = url.replace(`\${${k}}`, encodeURIComponent(v || ""));
  }
  url = url.replace(/\$\{[^}]+\}/g, "");
  return url;
}

export function buildJdbcUrl(template: JdbcDriverTemplate, opts: Record<string, string>): string {
  return resolveJdbcUrl(template, opts);
}

function normalizePath(p: string): string {
  if (process.platform === "win32" && p.startsWith("\\\\?\\")) {
    return p.slice(4);
  }
  return p;
}

function findResourceBase(): string | null {
  if (process.env.RESOURCEDIR) {
    const p = normalizePath(process.env.RESOURCEDIR);
    if (fs.existsSync(path.join(p, "bridge.jar"))) {
      log("resource base via RESOURCEDIR env:", p);
      return p;
    }
    log("RESOURCEDIR set but bridge.jar not found there:", p);
  }
  try {
    const exeDir = path.dirname(process.execPath);
    const candidates = [
      path.resolve(exeDir, "../Resources"),
      path.resolve(exeDir, "../../Resources"),
      path.resolve(exeDir, "../share/rexa-db"),
      path.resolve(exeDir, "../lib/RexaDB"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(path.join(c, "bridge.jar"))) {
        log("resource base via execPath:", c);
        return c;
      }
    }
  } catch {}
  const cwd = process.cwd();
  const cwdCandidates = [
    cwd,
    path.join(cwd, "resources/java-bridge/dist"),
  ];
  for (const c of cwdCandidates) {
    if (fs.existsSync(path.join(c, "bridge.jar"))) {
      log("resource base via cwd:", c);
      return c;
    }
  }
  return null;
}

async function invokeRust(cmd: string, args?: any): Promise<any> {
  if (typeof window === "undefined") throw new Error("no window");
  const ti = (window as any).__TAURI_INTERNALS__;
  if (!ti || typeof ti.invoke !== "function") {
    log("invoke:", cmd, "- no __TAURI_INTERNALS__.invoke");
    throw new Error("no invoke");
  }
  try {
    const r = await ti.invoke(cmd, args);
    log("invoke:", cmd, "->", typeof r === "string" ? r : JSON.stringify(r));
    return r;
  } catch (e: any) {
    log("invoke:", cmd, "FAILED:", e?.message || String(e));
    throw e;
  }
}

async function getJavaPath(): Promise<string> {
  const jreBin = process.platform === "win32" ? "jre/bin/java.exe" : "jre/bin/java";
  const base = findResourceBase();
  if (base) {
    const jrePath = path.join(base, jreBin);
    if (fs.existsSync(jrePath)) {
      log("Java path:", jrePath);
      return jrePath;
    }
    log("JRE not found at:", jrePath);
  }
  try {
    const resourceDir = await invokeRust("get_resource_dir");
    const jrePath = resourceDir + "/" + jreBin;
    log("Java path (invoke):", jrePath);
    return jrePath;
  } catch (e) {
    log("Java path invoke fallback failed:", e);
  }
  log("Java path: java (system)");
  return "java";
}

async function getBridgeJarPath(): Promise<string> {
  const base = findResourceBase();
  if (base) {
    const jarPath = path.join(base, "bridge.jar");
    if (fs.existsSync(jarPath)) {
      log("bridge.jar:", jarPath);
      return jarPath;
    }
  }
  try {
    const resourceDir = await invokeRust("get_resource_dir");
    const bridgeJar = resourceDir + "/bridge.jar";
    log("bridge.jar (invoke):", bridgeJar);
    return bridgeJar;
  } catch (e) {
    log("bridge.jar invoke failed:", e);
  }
  log("bridge.jar: not found");
  return "";
}

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

async function ensureBridge() {
  if (bridgeInitialized) {
    log("bridge already initialized, reusing");
    return;
  }
  bridgeInitialized = true;

  let javaPath = await getJavaPath();
  let bridgeJar = await getBridgeJarPath();

  log(`Spawning: ${javaPath} -cp ${bridgeJar} Bridge`);

  if (!bridgeJar) {
    bridgeInitialized = false;
    throw new Error("bridge.jar not found. Run resources/java-bridge/build.sh first.");
  }

  if (isTauri()) {
    const mod = await import("@tauri-apps/plugin-shell") as any;
    const command = mod.Command.create(javaPath, ["-cp", bridgeJar, "Bridge"]);
    bridgeProcess = command;

    command.stdout.on("data", (data: string) => {
      buffer += typeof data === "string" ? data : new TextDecoder().decode(data);
      processBuffer();
    });

    command.stderr.on("data", (data: string) => {
      log("stderr:", typeof data === "string" ? data : new TextDecoder().decode(data));
    });

    command.on("close", (event: any) => {
      const code = event?.code ?? event;
      log(`process exited with code ${code}`);
      cleanup();
    });

    try {
      bridgeChild = await command.spawn();
      log("Java bridge spawned successfully (Tauri)");
    } catch (e: any) {
      bridgeInitialized = false;
      log("Tauri spawn failed:", e);
      throw new Error(`Failed to spawn Java bridge: ${e.message}`);
    }
  } else {
    const { spawn, spawnSync } = await Function('pkg', 'return import(pkg)')("bun") as any;

    log("RESOURCEDIR:", process.env.RESOURCEDIR || "(not set)");
    log("javaPath:", javaPath, "exists:", fs.existsSync(javaPath));
    log("bridgeJar:", bridgeJar, "exists:", fs.existsSync(bridgeJar));

    // JRE integrity diagnostics
    const jreDir = javaPath.replace(/[\\/]bin[\\/]java(\.exe)?$/, "");
    log("jreDir:", jreDir, "exists:", fs.existsSync(jreDir));
    const modulesPath = path.join(jreDir, "lib", "modules");
    const modulesExists = fs.existsSync(modulesPath);
    if (modulesExists) {
      const stat = fs.statSync(modulesPath);
      log("jre/lib/modules: size", stat.size, "bytes");
    } else {
      log("jre/lib/modules: MISSING");
      log("jre/lib/ contents:", fs.readdirSync(path.join(jreDir, "lib"), { withFileTypes: true }).map(e => e.name + (e.isDirectory() ? "/" : "")).join(", "));
      log("jre/ contents:", fs.readdirSync(jreDir, { withFileTypes: true }).map(e => e.name + (e.isDirectory() ? "/" : "")).join(", "));
    }
    const releasePath = path.join(jreDir, "release");
    log("jre/release:", fs.existsSync(releasePath) ? "exists" : "MISSING");
    if (fs.existsSync(releasePath)) {
      log("jre/release content:", fs.readFileSync(releasePath, "utf-8").trim());
    }

    // verify JRE works before spawning bridge
    try {
      const ver = spawnSync([javaPath, "-version"], { stderr: "pipe" });
      log("java -version exit:", ver.exitCode, "stderr:", ver.stderr.toString().trim());
    } catch (e: any) {
      log("java -version check error:", e);
    }

    // if jre/lib/modules is missing, fall back to system Java
    if (!modulesExists) {
      log("jre/lib/modules missing, falling back to system Java");
      const sysJava = "java";
      const sysVer = spawnSync([sysJava, "-version"], { stderr: "pipe" });
      log("system java -version exit:", sysVer.exitCode, "stderr:", sysVer.stderr.toString().trim());
      if (sysVer.exitCode === 0) {
        javaPath = sysJava;
        bridgeJar = await getBridgeJarPath();
      } else {
        throw new Error("Bundled JRE is broken (missing lib/modules) and system Java is not available.");
      }
    }

    let proc: any;
    try {
      proc = spawn([javaPath, "-cp", bridgeJar, "Bridge"], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      log("Java bridge spawned successfully (Bun)");
    } catch (e: any) {
      bridgeInitialized = false;
      log("Bun spawn failed:", e);
      throw new Error(`Failed to spawn Java (${javaPath}): ${e.message}. Ensure Java is installed.`);
    }
    bridgeProcess = proc;
    bridgeChild = proc;

    const reader = proc.stdout.getReader();
    const pumpStdout = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            log("stdout stream ended");
            break;
          }
          const text = new TextDecoder().decode(value);
          log("stdout:", text.trim());
          buffer += text;
          processBuffer();
        }
      } catch (e: any) {
        if (!shuttingDown) log("stdout read error:", e);
      }
    };
    pumpStdout();

    const errReader = proc.stderr.getReader();
    const stderrDone = (async () => {
      try {
        while (true) {
          const { done, value } = await errReader.read();
          if (done) break;
          const text = new TextDecoder().decode(value);
          jdbcLastStderr += text;
          log("stderr:", text);
        }
      } catch (e: any) {
        if (!shuttingDown) log("stderr read error:", e);
      }
    })();

    proc.exited.then(async (code: number) => {
      jdbcLastExitCode = code;
      log(`process exited with code ${code}`);
      await stderrDone;
      cleanup();
    });
  }
}

function cleanup() {
  const pending = pendingRequests.size;
  log(`cleanup: rejecting ${pending} pending request(s)`);
  let errMsg = "JDBC bridge process terminated";
  if (jdbcLastExitCode !== null) errMsg += ` (exit code: ${jdbcLastExitCode})`;
  if (jdbcLastStderr) errMsg += `. Stderr: ${jdbcLastStderr.trim()}`;
  for (const [id, p] of pendingRequests) {
    p.reject(new Error(errMsg));
    pendingRequests.delete(id);
  }
  bridgeInitialized = false;
  bridgeProcess = null;
  bridgeChild = null;
  jdbcLastStderr = "";
  jdbcLastExitCode = null;
}

function processBuffer() {
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const resp: JdbcResponse = JSON.parse(line);
      log("response:", resp.ok ? "OK" : "FAIL", "reqId:", resp.reqId, "session:", resp.session);
      if (resp.reqId && pendingRequests.has(resp.reqId)) {
        const pending = pendingRequests.get(resp.reqId)!;
        pendingRequests.delete(resp.reqId);
        if (resp.ok) {
          pending.resolve(resp);
        } else {
          const errMsg = resp.data?.error || "JDBC bridge error";
          log("rejecting reqId", resp.reqId, "with:", errMsg);
          pending.reject(new Error(errMsg));
        }
      } else {
        log("response reqId not found in pending set (maybe already timed out):", resp.reqId);
      }
    } catch (e) {
      log("Failed to parse response:", line, e);
    }
  }
}

async function sendCommand(cmd: Record<string, any>): Promise<JdbcResponse> {
  await ensureBridge();
  return new Promise((resolve, reject) => {
    const reqId = String(++requestIdCounter);
    cmd.reqId = reqId;
    pendingRequests.set(reqId, { resolve, reject });
    const line = JSON.stringify(cmd) + "\n";
    const action = cmd.action;
    const logCmd = action === "connect"
      ? { action, ...(cmd.config ? { config: { ...cmd.config, password: "***" } } : {}) }
      : { action, reqId };
    log("sendCommand:", JSON.stringify(logCmd));
  if (isTauri()) {
      bridgeChild.write(line);
    } else if (typeof bridgeChild.stdin.getWriter === "function") {
      const writer = bridgeChild.stdin.getWriter();
      writer.write(new TextEncoder().encode(line));
      writer.releaseLock();
    } else {
      bridgeChild.stdin.write(line);
    }
  });
}

function redactJdbcUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    if (parsed.searchParams.has('password')) parsed.searchParams.set('password', '***');
    if (parsed.searchParams.has('user')) parsed.searchParams.set('user', '***');
    return parsed.toString();
  } catch {
    return url.replace(/password=[^&]+/gi, 'password=***').replace(/user=[^&]+/gi, 'user=***');
  }
}

async function resolveDriverJars(config: JdbcConfig): Promise<JdbcConfig> {
  if (config.jarPaths && config.jarPaths.length > 0) return config;
  const driversDir =
    typeof process !== "undefined" ? process.env.REXADB_JDBC_DRIVERS_DIR : undefined;
  if (!driversDir || !fs.existsSync(driversDir)) {
    log("resolveDriverJars: no drivers dir, leaving jarPaths empty");
    return config;
  }
  try {
    const candidates: string[] = [];
    const entries = fs.readdirSync(driversDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const subDir = path.join(driversDir, e.name);
      const manifestPath = path.join(subDir, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        try {
          const m = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
          if (m.driver_class === config.driverClass) {
            const paths = Array.isArray(m.jar_paths) ? m.jar_paths : [];
            for (const p of paths) {
              if (typeof p === "string" && fs.existsSync(p)) candidates.push(p);
            }
          }
        } catch {}
      }
      if (candidates.length > 0) break;
    }
    if (candidates.length === 0) {
      const walk = (dir: string) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, f.name);
          if (f.isDirectory()) walk(p);
          else if (f.name.endsWith(".jar")) candidates.push(p);
        }
      };
      walk(driversDir);
    }
    if (candidates.length > 0) {
      log("resolveDriverJars: auto-attached", candidates.length, "jar(s)");
      return { ...config, jarPaths: candidates };
    }
  } catch (e: any) {
    log("resolveDriverJars error:", e?.message || String(e));
  }
  return config;
}

export async function jdbcTestConnection(config: JdbcConfig): Promise<boolean> {
  config = await resolveDriverJars(config);
  log("jdbcTestConnection:", {
    jdbcUrl: redactJdbcUrl(config.jdbcUrl),
    driverClass: config.driverClass,
    jarPaths: config.jarPaths,
    username: config.username,
  });
  const resp = await sendCommand({ action: "connect", config });
  if (resp.ok && resp.session) {
    log("connect OK, session:", resp.session);
    await sendCommand({ action: "disconnect", session: resp.session });
    return true;
  }
  log("connect returned not-ok");
  return false;
}

async function withJdbcSession<T>(config: JdbcConfig, fn: (session: number) => Promise<T>): Promise<T> {
  config = await resolveDriverJars(config);
  const connectResp = await sendCommand({ action: "connect", config });
  if (!connectResp.ok || !connectResp.session) {
    throw new Error(connectResp.data?.error || "Failed to connect");
  }
  const session = connectResp.session;
  try {
    return await fn(session);
  } finally {
    await sendCommand({ action: "disconnect", session }).catch(() => {});
  }
}

export async function jdbcExecuteQuery(config: JdbcConfig, sql: string): Promise<{ columns: any[]; rows: any[][] }> {
  return withJdbcSession(config, async (session) => {
    const queryResp = await sendCommand({ action: "query", session, sql });
    if (!queryResp.ok) throw new Error(queryResp.data?.error || "Query failed");
    return { columns: queryResp.data.columns || [], rows: queryResp.data.rows || [] };
  });
}

export async function jdbcGetSchemas(config: JdbcConfig): Promise<string[]> {
  return withJdbcSession(config, async (session) => {
    const resp = await sendCommand({ action: "schemas", session });
    if (!resp.ok) throw new Error(resp.data?.error || "Failed to get schemas");
    return (resp.data.rows || []).map((r: any) => String(r[0]));
  });
}

export async function jdbcGetTables(config: JdbcConfig, schema: string): Promise<Array<{ name: string; type: string; schema: string }>> {
  return withJdbcSession(config, async (session) => {
    const resp = await sendCommand({ action: "tables", session, schema });
    if (!resp.ok) throw new Error(resp.data?.error || "Failed to get tables");
    return (resp.data.rows || []).map((r: any) => ({ name: String(r[0]), type: String(r[1]), schema: String(r[2]) }));
  });
}

export async function jdbcGetTableStructure(config: JdbcConfig, schema: string, table: string): Promise<Array<{ name: string; type: string; size: number; nullable: boolean; default: string; ordinal: number }>> {
  return withJdbcSession(config, async (session) => {
    const resp = await sendCommand({ action: "structure", session, schema, table });
    if (!resp.ok) throw new Error(resp.data?.error || "Failed to get structure");
    return (resp.data.rows || []).map((r: any) => ({
      name: String(r[0]),
      type: String(r[1]),
      size: Number(r[2]),
      nullable: Boolean(r[3]),
      default: String(r[4]),
      ordinal: Number(r[5]),
    }));
  });
}

export async function jdbcGetForeignKeys(config: JdbcConfig, schema: string, table: string): Promise<Array<{ fkColumn: string; pkTable: string; pkColumn: string }>> {
  return withJdbcSession(config, async (session) => {
    const resp = await sendCommand({ action: "foreign-keys", session, schema, table });
    if (!resp.ok) throw new Error(resp.data?.error || "Failed to get foreign keys");
    return (resp.data.rows || []).map((r: any) => ({
      fkColumn: String(r[0]),
      pkTable: String(r[1]),
      pkColumn: String(r[3]),
    }));
  });
}
