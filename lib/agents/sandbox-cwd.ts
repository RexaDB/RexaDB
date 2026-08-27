import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LightSchemaContextTable } from "@/lib/ai/types";
import { renderSchemaContext } from "@/lib/ai/system-prompt";

/** Shared sandbox root for every RexaDB agent (sidebar + window, built-in + CLI). */
export const AGENT_SANDBOX_DIR_NAME = "rexadb-pi-agent";

/** Filename coding agents should read for the live DB schema. */
export const AGENT_SCHEMA_FILENAME = "SCHEMA.md";

/**
 * Isolated working directory outside the app / user project.
 * Prefer a per-connection subfolder so schemas never bleed across connections.
 */
export function getAgentSandboxCwd(connectionId?: number | string | null): string {
  const root = join(tmpdir(), AGENT_SANDBOX_DIR_NAME);
  const id =
    connectionId === null || connectionId === undefined || connectionId === ""
      ? null
      : String(connectionId).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  const cwd = id ? join(root, `conn-${id}`) : root;
  mkdirSync(cwd, { recursive: true });
  return cwd;
}

/** Env overrides so CLIs that read $PWD / $INIT_CWD don't inherit the host project. */
export function sandboxProcessEnv(cwd: string): Record<string, string> {
  return { PWD: cwd, INIT_CWD: cwd };
}

/**
 * Materialize connection + schema files into the agent sandbox so filesystem-
 * oriented CLIs find the LIVE database catalog when they explore cwd.
 */
export function materializeAgentSandbox(
  cwd: string,
  input: {
    dbType: string;
    connectionName?: string;
    connectionId?: number | string;
    selectedNamespace?: string;
    schemaContext?: LightSchemaContextTable[];
  },
): { schemaPath: string; readmePath: string } {
  mkdirSync(cwd, { recursive: true });

  const schemaBody = renderSchemaContext(input.schemaContext || []);
  const hasSchema =
    Array.isArray(input.schemaContext) && input.schemaContext.length > 0;
  const schemaPath = join(cwd, AGENT_SCHEMA_FILENAME);
  const schemaMarkdown = [
    `# Live database catalog (RexaDB connection)`,
    ``,
    `This is NOT a local project schema file.`,
    `It is a snapshot of the LIVE database RexaDB is connected to right now.`,
    `When the user says "this database" / "this schema", they mean THIS live connection.`,
    ``,
    `- **Hosted by:** RexaDB Agents`,
    `- **Database type:** ${input.dbType || "unknown"}`,
    input.connectionName ? `- **Connection name:** ${input.connectionName}` : null,
    input.connectionId != null ? `- **Connection id:** ${input.connectionId}` : null,
    input.selectedNamespace
      ? `- **Current namespace/schema:** ${input.selectedNamespace}`
      : null,
    `- **Tables captured:** ${hasSchema ? input.schemaContext!.length : 0}`,
    ``,
    `## Tables (columns:types)`,
    ``,
    hasSchema
      ? schemaBody
      : "_No tables were loaded for this connection. Ask the user to reconnect or check credentials._",
    ``,
  ]
    .filter((line) => line !== null)
    .join("\n");
  writeFileSync(schemaPath, schemaMarkdown, "utf8");

  const readmePath = join(cwd, "README.md");
  writeFileSync(
    readmePath,
    [
      `# RexaDB live connection workspace`,
      ``,
      `This temporary folder is only a scratch pad for the agent.`,
      `It is NOT the database and NOT the RexaDB application source tree.`,
      ``,
      `## What you are connected to`,
      ``,
      `- A **live** database connection managed by RexaDB.`,
      `- Database type: **${input.dbType || "unknown"}**`,
      input.connectionName ? `- Connection name: **${input.connectionName}**` : null,
      ``,
      `## Where the schema is`,
      ``,
      `Read \`${AGENT_SCHEMA_FILENAME}\` — it is a catalog dump of the live connection.`,
      `Answer questions about "this database" / "this schema" from that catalog and from DB tools, not by inventing a project.`,
      ``,
    ]
      .filter((line) => line !== null)
      .join("\n"),
    "utf8",
  );

  return { schemaPath, readmePath };
}
