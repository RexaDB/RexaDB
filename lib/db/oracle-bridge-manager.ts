import path from "path";
import fs from "fs";
import {
  buildOracleNetConnectString,
  parseOracleConnectionString,
  type OracleConnectionParts,
} from "./oracle-connection";

function log(...args: any[]) {
  try {
    console.error("[oracle-bridge]", ...args);
  } catch {}
}

let bridgeProcess: any = null;
let bridgeChild: any = null;
let bridgeReady = false;
let bridgeStarting: Promise<void> | null = null;
let shuttingDown = false;
let requestIdCounter = 0;
const pendingRequests = new Map<
  string,
  { resolve: (v: any) => void; reject: (e: any) => void }
>();
let buffer = "";
let lastStderr = "";
let lastExitCode: number | null = null;

export type OracleBridgeConfig = {
  connectString: string;
  username: string;
  password: string;
};

export type OracleBridgeResponse = {
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

function normalizePath(p: string): string {
  if (process.platform === "win32" && p.startsWith("\\\\?\\")) {
    return p.slice(4);
  }
  return p;
}

function bridgeBinaryName(): string {
  return process.platform === "win32"
    ? "rexadb-oracle-bridge.exe"
    : "rexadb-oracle-bridge";
}

function candidateBridgePaths(): string[] {
  const name = bridgeBinaryName();
  const out: string[] = [];
  if (process.env.REXADB_ORACLE_BRIDGE) {
    out.push(normalizePath(process.env.REXADB_ORACLE_BRIDGE));
  }
  if (process.env.RESOURCEDIR) {
    const base = normalizePath(process.env.RESOURCEDIR);
    out.push(path.join(base, name));
    out.push(path.join(base, "bin", name));
  }
  try {
    const exeDir = path.dirname(process.execPath);
    out.push(
      path.resolve(exeDir, name),
      path.resolve(exeDir, "../Resources", name),
      path.resolve(exeDir, "../../Resources", name),
      path.resolve(exeDir, "../Resources/bin", name),
    );
  } catch {}
  const cwd = process.cwd();
  out.push(
    path.join(cwd, name),
    path.join(cwd, "src-tauri", "oracle-bridge", "target", "debug", name),
    path.join(cwd, "src-tauri", "oracle-bridge", "target", "release", name),
    path.join(cwd, "src-tauri", "binaries", name),
    path.join(cwd, "resources", "oracle-bridge", name),
  );
  return out;
}

export function findOracleBridgeBinary(): string | null {
  for (const candidate of candidateBridgePaths()) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {}
  }
  return null;
}

function isTauri(): boolean {
  return typeof window !== "undefined" && !!(window as any).__TAURI_INTERNALS__;
}

async function ensureBridge() {
  if (bridgeReady && bridgeChild) return;
  if (bridgeStarting) {
    await bridgeStarting;
    if (bridgeReady && bridgeChild) return;
    throw new Error("Oracle bridge failed to start");
  }

  bridgeStarting = startBridge();
  try {
    await bridgeStarting;
  } finally {
    bridgeStarting = null;
  }
}

async function startBridge() {
  const binary = findOracleBridgeBinary();
  if (!binary) {
    throw new Error(
      "rexadb-oracle-bridge not found. Build it with: cargo build --manifest-path src-tauri/oracle-bridge/Cargo.toml",
    );
  }
  log("Spawning oracle bridge:", binary);

  if (isTauri()) {
    const mod = (await import("@tauri-apps/plugin-shell")) as any;
    const command = mod.Command.create(binary, []);
    bridgeProcess = command;
    command.stdout.on("data", (data: string) => {
      buffer += typeof data === "string" ? data : new TextDecoder().decode(data);
      processBuffer();
    });
    command.stderr.on("data", (data: string) => {
      const text = typeof data === "string" ? data : new TextDecoder().decode(data);
      lastStderr += text;
      log("stderr:", text);
    });
    command.on("close", (event: any) => {
      lastExitCode = event?.code ?? event;
      log(`process exited with code ${lastExitCode}`);
      cleanup();
    });
    try {
      bridgeChild = await command.spawn();
    } catch (e: any) {
      throw new Error(`Failed to spawn oracle bridge: ${e.message}`);
    }
    bridgeReady = true;
  } else {
    const { spawn } = (await Function('pkg', 'return import(pkg)')("bun")) as any;
    let proc: any;
    try {
      proc = spawn([binary], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch (e: any) {
      throw new Error(`Failed to spawn oracle bridge (${binary}): ${e.message}`);
    }
    bridgeProcess = proc;
    bridgeChild = proc;
    bridgeReady = true;

    const reader = proc.stdout.getReader();
    const pumpStdout = async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += new TextDecoder().decode(value);
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
          lastStderr += text;
          log("stderr:", text);
        }
      } catch (e: any) {
        if (!shuttingDown) log("stderr read error:", e);
      }
    })();

    proc.exited.then(async (code: number) => {
      lastExitCode = code;
      log(`process exited with code ${code}`);
      await stderrDone;
      cleanup();
    });
  }
}

function cleanup() {
  for (const [, p] of pendingRequests) {
    let errMsg = "Oracle bridge process terminated";
    if (lastExitCode !== null) errMsg += ` (exit code: ${lastExitCode})`;
    if (lastStderr) errMsg += `. Stderr: ${lastStderr.trim()}`;
    p.reject(new Error(errMsg));
  }
  pendingRequests.clear();
  bridgeReady = false;
  bridgeProcess = null;
  bridgeChild = null;
  lastStderr = "";
  lastExitCode = null;
}

function processBuffer() {
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const resp: OracleBridgeResponse = JSON.parse(line);
      if (resp.reqId && pendingRequests.has(resp.reqId)) {
        const pending = pendingRequests.get(resp.reqId)!;
        pendingRequests.delete(resp.reqId);
        if (resp.ok) pending.resolve(resp);
        else pending.reject(new Error(resp.data?.error || "Oracle bridge error"));
      }
    } catch (e) {
      log("Failed to parse response:", line, e);
    }
  }
}

async function sendCommand(cmd: Record<string, any>): Promise<OracleBridgeResponse> {
  await ensureBridge();
  if (!bridgeChild) {
    throw new Error("Oracle bridge is not running");
  }
  return new Promise((resolve, reject) => {
    const reqId = String(++requestIdCounter);
    cmd.reqId = reqId;
    pendingRequests.set(reqId, { resolve, reject });
    const line = JSON.stringify(cmd) + "\n";
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

export function partsToBridgeConfig(parts: OracleConnectionParts): OracleBridgeConfig {
  return {
    connectString: buildOracleNetConnectString(parts),
    username: parts.username,
    password: parts.password,
  };
}

export function connectionStringToBridgeConfig(
  connectionString: string,
): OracleBridgeConfig {
  return partsToBridgeConfig(parseOracleConnectionString(connectionString));
}

async function withSession<T>(
  config: OracleBridgeConfig,
  fn: (session: number) => Promise<T>,
): Promise<T> {
  const connectResp = await sendCommand({ action: "connect", config });
  if (!connectResp.ok || !connectResp.session) {
    throw new Error(connectResp.data?.error || "Failed to connect to Oracle");
  }
  const session = connectResp.session;
  try {
    return await fn(session);
  } finally {
    await sendCommand({ action: "disconnect", session }).catch(() => {});
  }
}

export async function oracleTestConnection(config: OracleBridgeConfig): Promise<boolean> {
  const resp = await sendCommand({ action: "connect", config });
  if (resp.ok && resp.session) {
    await sendCommand({ action: "disconnect", session: resp.session });
    return true;
  }
  return false;
}

export async function oracleExecuteQuery(
  config: OracleBridgeConfig,
  sql: string,
  params: any[] = [],
): Promise<{ columns: any[]; rows: any[][]; rowCount?: number }> {
  return withSession(config, async (session) => {
    const queryResp = await sendCommand({
      action: "query",
      session,
      sql,
      params,
    });
    if (!queryResp.ok) throw new Error(queryResp.data?.error || "Query failed");
    return {
      columns: queryResp.data.columns || [],
      rows: queryResp.data.rows || [],
      rowCount: queryResp.data.rowCount ?? queryResp.data.affectedRows ?? undefined,
    };
  });
}

export async function oracleGetSchemas(config: OracleBridgeConfig): Promise<string[]> {
  return withSession(config, async (session) => {
    const resp = await sendCommand({ action: "schemas", session });
    if (!resp.ok) throw new Error(resp.data?.error || "Failed to get schemas");
    return (resp.data.rows || []).map((r: any) => String(r[0]));
  });
}

export async function oracleGetTables(
  config: OracleBridgeConfig,
  schema: string,
): Promise<Array<{ name: string; type: string; schema: string }>> {
  return withSession(config, async (session) => {
    const resp = await sendCommand({ action: "tables", session, schema });
    if (!resp.ok) throw new Error(resp.data?.error || "Failed to get tables");
    return (resp.data.rows || []).map((r: any) => ({
      name: String(r[0]),
      type: String(r[1]),
      schema: String(r[2]),
    }));
  });
}

export async function oracleGetTableStructure(
  config: OracleBridgeConfig,
  schema: string,
  table: string,
): Promise<
  Array<{
    name: string;
    type: string;
    size: number;
    nullable: boolean;
    default: string;
    ordinal: number;
  }>
> {
  return withSession(config, async (session) => {
    const resp = await sendCommand({
      action: "structure",
      session,
      schema,
      table,
    });
    if (!resp.ok) throw new Error(resp.data?.error || "Failed to get structure");
    return (resp.data.rows || []).map((r: any) => ({
      name: String(r[0]),
      type: String(r[1]),
      size: Number(r[2] ?? 0),
      nullable: Boolean(Number(r[3])),
      default: r[4] == null ? "" : String(r[4]),
      ordinal: Number(r[5] ?? 0),
    }));
  });
}

export async function oracleGetForeignKeys(
  config: OracleBridgeConfig,
  schema: string,
  table: string,
): Promise<Array<{ fkColumn: string; pkTable: string; pkSchema: string; pkColumn: string }>> {
  return withSession(config, async (session) => {
    const resp = await sendCommand({
      action: "foreign-keys",
      session,
      schema,
      table,
    });
    if (!resp.ok) throw new Error(resp.data?.error || "Failed to get foreign keys");
    return (resp.data.rows || []).map((r: any) => ({
      fkColumn: String(r[0]),
      pkTable: String(r[1]),
      pkSchema: String(r[2]),
      pkColumn: String(r[3]),
    }));
  });
}

export function shutdownOracleBridge() {
  shuttingDown = true;
  try {
    if (bridgeChild) {
      if (typeof bridgeChild.kill === "function") bridgeChild.kill();
      else if (bridgeProcess?.kill) bridgeProcess.kill();
    }
  } catch {}
  cleanup();
  shuttingDown = false;
}
