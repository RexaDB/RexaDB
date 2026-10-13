#!/usr/bin/env bun
// Build bridge.jar + minimal JRE for the JDBC bridge (resources/java-bridge/dist).
// Skips when artifacts already exist unless --force is passed.
// Tauri validates `bundle.resources` at compile time, so `tauri dev` /
// `tauri build` hard-fail when dist/ is missing (it is gitignored).
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const BRIDGE_JAR = join(ROOT, "resources", "java-bridge", "dist", "bridge.jar");
const JRE_JAVA = join(ROOT, "resources", "java-bridge", "dist", "jre", "bin", "java");
const BUILD_SH = join(ROOT, "resources", "java-bridge", "build.sh");

const force = process.argv.includes("--force");

if (!force && existsSync(BRIDGE_JAR) && existsSync(JRE_JAVA)) {
  console.log("[build-java-bridge] Already built (bridge.jar + JRE found)");
  process.exit(0);
}

function have(cmd) {
  const r = spawnSync(process.platform === "win32" ? "where" : "command", ["-v", cmd], { stdio: "ignore" });
  return r.status === 0;
}

let args = [];
if (have("docker")) {
  console.log("[build-java-bridge] Building via docker...");
  args = ["--docker"];
} else if (have("javac")) {
  console.log("[build-java-bridge] Building via local JDK...");
  args = [];
} else {
  console.error("[build-java-bridge] Need docker or a JDK to build the Java bridge.");
  console.error("  - Install docker, or");
  console.error("  - Install a JDK 21+ (e.g. `brew install openjdk@21`)");
  process.exit(1);
}

const build = spawnSync("bash", [BUILD_SH, ...args], { stdio: "inherit", cwd: ROOT });
if (build.status !== 0) {
  console.error(`[build-java-bridge] build.sh failed (${build.status})`);
  process.exit(build.status ?? 1);
}

if (!existsSync(BRIDGE_JAR)) {
  console.error(`[build-java-bridge] Missing output: ${BRIDGE_JAR}`);
  process.exit(1);
}
if (!existsSync(JRE_JAVA)) {
  console.error(`[build-java-bridge] Missing output: ${JRE_JAVA} (jlink JRE incomplete?)`);
  console.error("  Re-run with a full JDK (needs jmods) or via docker.");
  process.exit(1);
}
console.log("[build-java-bridge] OK — dist/bridge.jar + dist/jre");
