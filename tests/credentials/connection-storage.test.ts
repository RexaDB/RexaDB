import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

for (const schema of ["fresh", "legacy", "legacy-concurrent"]) {
  test(`saved credentials reach PostgreSQL after reloading ${schema} SQLite storage`, async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "rexadb-credential-test-"));
    try {
      const child = Bun.spawn([process.execPath, "run", new URL("./fixtures/saved-connection.ts", import.meta.url).pathname, schema], {
        cwd: new URL("../../", import.meta.url).pathname,
        env: { ...process.env, REXADB_USER_DATA_DIR: dataDirectory },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, output, errors] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect(errors).toBe("");
      expect(exitCode).toBe(0);
      expect(output).toContain("Saved connection credentials survive SQLite reload");
    } finally {
      await rm(dataDirectory, { recursive: true, force: true });
    }
  }, 15_000);
}
