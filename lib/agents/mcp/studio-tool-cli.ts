/**
 * Shell bridge to the studio tools for local CLIs without MCP support.
 *
 * Takes a tool name as its last argument and the tool's JSON arguments on stdin.
 * Env: REXADB_STUDIO_ARTIFACT_FILE, REXADB_DB_TYPE
 */
import { appendFileSync } from "node:fs";
import { z } from "zod";
import { describeStudioArtifact } from "../../ai/studio-artifacts";
import { STUDIO_TOOLS } from "./studio-artifact-tools";

export async function runStudioToolCli(): Promise<void> {
  const name = process.argv.at(-1) || "";
  const artifactFile = process.env.REXADB_STUDIO_ARTIFACT_FILE;
  try {
    if (!artifactFile) throw new Error("REXADB_STUDIO_ARTIFACT_FILE is required.");
    const tool = Object.hasOwn(STUDIO_TOOLS, name) ? STUDIO_TOOLS[name] : undefined;
    if (!tool) throw new Error(`Unknown tool "${name}". Use one of: ${Object.keys(STUDIO_TOOLS).join(", ")}.`);
    const args = z.object(tool.shape).parse(JSON.parse(await Bun.stdin.text()));
    const artifact = tool.prepare(args, process.env.REXADB_DB_TYPE || "unknown");
    appendFileSync(artifactFile, `${JSON.stringify(artifact)}\n`);
    console.log(describeStudioArtifact(artifact));
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await runStudioToolCli();
