import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectProvider } from "../../lib/agents/detect-providers";
import type { AgentProvider } from "../../lib/agents/provider-types";

const dir = mkdtempSync(join(tmpdir(), "rexa-provider-probe-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function fixture(name: string, code: string): AgentProvider {
  const binaryPath = join(dir, `${name} cli`);
  writeFileSync(binaryPath, `#!/usr/bin/env node\n${code}\n`, { mode: 0o700 });
  return { id: "claude-code", name: "Claude Code", icon: "", description: "", available: true, status: "installed", binaryPath };
}
async function waitForFile(path: string) {
  const deadline = Date.now() + 3000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error("Probe did not start");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("a cached CLI path avoids lookup and rechecks login instead of trusting cached status", async () => {
  const cached = fixture("cached", 'if (process.argv.slice(2).join(" ") !== "auth status") process.exit(2); console.log(JSON.stringify({loggedIn:true}))');
  cached.status = "auth-required";
  const result = await detectProvider("claude-code", { cached });
  expect(result.binaryPath).toBe(cached.binaryPath);
  expect(result.status).toBe("installed");
  const signedOut = fixture("signed-out", 'console.log(JSON.stringify({loggedIn:false}))');
  expect((await detectProvider("claude-code", { cached: signedOut })).status).toBe("auth-required");
});

test("slow auth leaves HTTP requests responsive and can be cancelled while probing", async () => {
  const ready = join(dir, "ready");
  const pidFile = join(dir, "pid");
  const cached = fixture("slow", `const fs = require("node:fs"); fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); fs.writeFileSync(${JSON.stringify(ready)}, "ready"); setInterval(()=>{},1000);`);
  const controller = new AbortController();
  let settled = false;
  const checking = detectProvider("claude-code", { cached, signal: controller.signal });
  const outcome = checking.then((value) => { settled = true; return { value, error: undefined }; }, (error: Error) => { settled = true; return { value: undefined, error }; });
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("healthy") });
  try {
    await waitForFile(ready);
    expect(await (await fetch(`http://127.0.0.1:${server.port}`)).text()).toBe("healthy");
    // A synchronous implementation times out first, so this assertion fails.
    expect(settled).toBe(false);
    controller.abort();
    const result = await outcome;
    expect(result.error?.name).toBe("AbortError");
    const pid = Number(readFileSync(pidFile, "utf8"));
    const deadline = Date.now() + 1000;
    let exited = false;
    while (Date.now() < deadline) {
      try { process.kill(pid, 0); } catch { exited = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(exited).toBe(true);
  } finally {
    controller.abort();
    await outcome;
    server.stop(true);
  }
}, 8000);

test("Codex reads stderr and rejects nonzero login checks; pi recognizes missing login", async () => {
  const codex = { ...fixture("codex", 'console.error("Logged in using ChatGPT")'), id: "codex" as const };
  expect((await detectProvider("codex", { cached: codex })).status).toBe("installed");
  const failed = { ...fixture("failed-codex", 'console.error("Logged in"); process.exit(1)'), id: "codex" as const };
  expect((await detectProvider("codex", { cached: failed })).status).toBe("auth-required");
  const pi = { ...fixture("pi", 'console.log("No models available. Use /login")'), id: "pi" as const };
  expect((await detectProvider("pi", { cached: pi })).status).toBe("auth-required");
});

test("a cancelled request never starts a cached CLI", async () => {
  const marker = join(dir, "must-not-start");
  const cached = fixture("cancelled", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "started")`);
  const controller = new AbortController();
  controller.abort();
  await expect(detectProvider("claude-code", { cached, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(existsSync(marker)).toBe(false);
});
