#!/usr/bin/env bun
// Build bridge.jar + minimal JRE for the JDBC bridge (resources/java-bridge/dist).
// Skips when artifacts already exist unless --force is passed.
// Tauri validates `bundle.resources` at compile time, so `tauri dev` /
// `tauri build` hard-fail when dist/ is missing (it is gitignored).
import { spawnSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, realpathSync } from "fs";

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

// Resolve a JDK root from the javac on PATH: <root>/bin/javac.
// Returns null when it cannot be determined or has no jmods (build.sh then
// reports the problem itself).
function resolveJavaHome() {
  try {
    let raw = "";
    if (isWindows) {
      const found = spawnSync("where", ["javac"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      raw = (typeof found.stdout === "string" ? found.stdout : "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0 && !line.startsWith("INFO: ")) || "";
    } else {
      const found = spawnSync("sh", ["-c", "command -v javac"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      raw = typeof found.stdout === "string" ? found.stdout.trim() : "";
    }
    if (!raw) return null;
    const home = dirname(dirname(realpathSync(raw)));
    return existsSync(join(home, "jmods")) ? home : null;
  } catch {
    return null;
  }
}

let args;
let extraEnv = {};
if (process.platform === "linux" && have("docker")) {
  // The --docker build runs inside a Linux container, so its JRE only runs
  // on Linux. Native JDKs are used everywhere else.
  console.log("[build-java-bridge] Building via docker...");
  args = ["--docker"];
} else if (have("javac")) {
  console.log("[build-java-bridge] Building via local JDK...");
  args = [];
  // build.sh falls back to the macOS-only /usr/libexec/java_home when
  // JAVA_HOME is unset, which fails on Linux/Windows despite a working JDK.
  // Resolve it from the javac on PATH (its grandparent dir). macOS keeps
  // the java_home fallback, where /usr/bin/javac is a wrapper whose
  // resolved path is not a JDK root.
  if (!process.env.JAVA_HOME && process.platform !== "darwin") {
    const derived = resolveJavaHome();
    if (derived) {
      console.log(`[build-java-bridge] Using JAVA_HOME=${derived}`);
      extraEnv = { JAVA_HOME: derived };
    }
  }
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

const build = spawnSync("bash", [BUILD_SH, ...args], {
  stdio: "inherit",
  cwd: ROOT,
  env: { ...process.env, ...extraEnv },
});
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
