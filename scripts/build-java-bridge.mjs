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

const isWindows = process.platform === "win32";
const JAVA_BIN = isWindows ? "java.exe" : "java";
const BRIDGE_JAR = join(ROOT, "resources", "java-bridge", "dist", "bridge.jar");
const JRE_JAVA = join(ROOT, "resources", "java-bridge", "dist", "jre", "bin", JAVA_BIN);
const BUILD_SH = join(ROOT, "resources", "java-bridge", "build.sh");

const force = process.argv.includes("--force");

if (!force && existsSync(BRIDGE_JAR) && existsSync(JRE_JAVA)) {
  console.log("[build-java-bridge] Already built (bridge.jar + JRE found)");
  process.exit(0);
}

function have(cmd) {
  try {
    if (isWindows) {
      // `where` is a real binary; it takes no -v flag.
      return spawnSync("where", [cmd], { stdio: "ignore" }).status === 0;
    }
    // `command` is a shell builtin, so it must run through a shell —
    // spawning it directly always fails with ENOENT.
    return (
      spawnSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" }).status === 0
    );
  } catch {
    return false;
  }
}

let args;
if (process.platform === "linux" && have("docker")) {
  // The --docker build runs inside a Linux container, so its JRE only runs
  // on Linux. Native JDKs are used everywhere else.
  console.log("[build-java-bridge] Building via docker...");
  args = ["--docker"];
} else if (have("javac")) {
  console.log("[build-java-bridge] Building via local JDK...");
  args = [];
} else {
  console.error("[build-java-bridge] Need a JDK 21+ to build the Java bridge.");
  console.error("  - Install one, e.g. `brew install openjdk@21`");
  if (process.platform === "linux") {
    console.error("  - Or install docker for a containerized build");
  } else {
    console.error("  - (The docker build produces a Linux-only JRE, so it is");
    console.error("     not used on this platform)");
  }
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
  console.error("  Re-run with a full JDK (needs jmods) or via docker on Linux.");
  process.exit(1);
}
console.log("[build-java-bridge] OK — dist/bridge.jar + dist/jre");
