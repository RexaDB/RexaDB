import { spawn } from "child_process";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { parseExtendedConnection as _parseExtendedConnection } from "./ssh-tunnel-common";

export type TunnelHandle = { connectionString: string; close: () => Promise<void> };

function parseExtendedConnection(connectionString: string, normalizeFn: (s: string) => string) {
  return _parseExtendedConnection(connectionString, normalizeFn) as ReturnType<typeof _parseExtendedConnection>;
}

function withHostPort(connectionString: string, host: string, port: number, normalizeFn: (s: string) => string) {
  const url = new URL(normalizeFn(connectionString));
  url.hostname = host;
  url.port = String(port);
  return url.toString();
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close(() => {
        if (!port) reject(new Error("Unable to allocate local tunnel port."));
        else resolve(port);
      });
    });
  });
}

export async function startSshTunnelIfNeeded(
  connectionString: string,
  defaultPort: number,
  normalizeFn: (s: string) => string,
): Promise<TunnelHandle> {
  const parsed = parseExtendedConnection(connectionString, normalizeFn);
  if (parsed.sshConfig.mode !== "ssh") {
    return {
      connectionString: parsed.baseConnectionString,
      close: async () => {},
    };
  }

  const target = new URL(parsed.baseConnectionString);
  const targetHost = target.hostname;
  const targetPort = Number(target.port || String(defaultPort)) || defaultPort;
  if (!parsed.sshConfig.host || !parsed.sshConfig.username) {
    throw new Error("SSH host and username are required when SSH tunnel is enabled.");
  }

  const localPort = await getFreePort();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rexadb-ssh-"));
  const cleanupPaths: string[] = [];

  // Register cleanup on process exit to prevent private key leaks
  const cleanupOnExit = () => {
    for (const p of cleanupPaths) {
      try { fs.unlinkSync(p); } catch {}
    }
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  };
  process.once('exit', cleanupOnExit);
  process.once('SIGINT', cleanupOnExit);
  process.once('SIGTERM', cleanupOnExit);
  const args = [
    "-N",
    "-L",
    `${localPort}:${targetHost}:${targetPort}`,
    "-p",
    String(parsed.sshConfig.port),
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "LogLevel=ERROR",
    `${parsed.sshConfig.username}@${parsed.sshConfig.host}`,
  ];
  const env = { ...process.env } as NodeJS.ProcessEnv;

  if (parsed.sshConfig.authMode === "private-key") {
    if (!parsed.sshConfig.privateKey.trim()) {
      throw new Error("SSH private key is required for private-key authentication.");
    }
    const keyPath = path.join(tmpDir, "id_key");
    fs.writeFileSync(keyPath, parsed.sshConfig.privateKey, { mode: 0o600 });
    cleanupPaths.push(keyPath);
    args.unshift("-i", keyPath);
  } else {
    if (!parsed.sshConfig.password) {
      throw new Error("SSH password is required for password authentication.");
    }
    const askPassPath = path.join(tmpDir, "askpass.sh");
    fs.writeFileSync(askPassPath, "#!/bin/sh\nprintf %s \"$REXADB_SSH_PASSWORD\"\n", { mode: 0o700 });
    cleanupPaths.push(askPassPath);
    env.SSH_ASKPASS = askPassPath;
    env.SSH_ASKPASS_REQUIRE = "force";
    env.DISPLAY = env.DISPLAY || ":0";
    env.REXADB_SSH_PASSWORD = parsed.sshConfig.password;
  }

  const proc = spawn("ssh", args, {
    stdio: ["ignore", "ignore", "pipe"],
    env,
  });

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, 1400);

    const fail = (msg: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(msg));
    };

    proc.once("exit", (code, signal) => {
      fail(`SSH tunnel failed to start (${String(code ?? signal ?? "unknown")}).`);
    });

    proc.stderr.on("data", (chunk) => {
      const msg = String(chunk || "").trim();
      if (!msg) return;
      if (/permission denied|could not resolve hostname|connection refused|host key verification failed|no such identity|operation timed out/i.test(msg)) {
        fail(`SSH: ${msg}`);
      }
    });
  });

  return {
    connectionString: withHostPort(parsed.baseConnectionString, "127.0.0.1", localPort, normalizeFn),
    close: async () => {
      try {
        proc.kill("SIGTERM");
      } catch {}
      for (const p of cleanupPaths) {
        try {
          fs.unlinkSync(p);
        } catch {}
      }
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {}
    },
  };
}
