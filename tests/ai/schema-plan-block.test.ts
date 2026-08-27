import { test, expect } from "bun:test";
import { parseSchemaPlanBlock } from "../../lib/ai/chat-blocks";

test("parseSchemaPlanBlock parses added/removed columns", () => {
  const source = `Here is a plan:
\`\`\`schema-plan
{
  "title": "Add profile",
  "mode": "plan",
  "tables": [
    {
      "schema": "public",
      "table": "users",
      "action": "alter",
      "columns": [
        { "name": "id", "type": "uuid", "change": "unchanged" },
        { "name": "display_name", "type": "text", "change": "added" },
        { "name": "legacy_flag", "type": "boolean", "change": "removed" }
      ]
    }
  ],
  "applySql": "ALTER TABLE public.users ADD COLUMN display_name text;"
}
\`\`\`
`;
  const plan = parseSchemaPlanBlock(source);
  expect(plan).not.toBeNull();
  expect(plan?.title).toBe("Add profile");
  expect(plan?.tables).toHaveLength(1);
  expect(plan?.tables[0].columns.map((c) => c.change)).toEqual([
    "unchanged",
    "added",
    "removed",
  ]);
  expect(plan?.applySql).toContain("ADD COLUMN");
});

test("parseSchemaPlanBlock accepts agent-style ```json with column maps", () => {
  const source = `Proposed improvements:

\`\`\`json
{
  "tables": [
    {
      "name": "saved_queries",
      "columns": {
        "id": "unchanged",
        "connection_id": "unchanged",
        "updated_at": "added"
      }
    },
    {
      "name": "users",
      "columns": { "email": "modified" },
      "note": "email: modified = add UNIQUE index"
    },
    { "name": "roles", "columns": { "*": "unchanged" }, "note": "add UNIQUE(name)" }
  ],
  "applySql": [
    "ALTER TABLE saved_queries ADD COLUMN updated_at TEXT;",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);"
  ]
}
\`\`\`
`;
  const plan = parseSchemaPlanBlock(source);
  expect(plan).not.toBeNull();
  expect(plan?.tables).toHaveLength(3);
  expect(plan?.tables[0].table).toBe("saved_queries");
  expect(plan?.tables[0].action).toBe("alter");
  expect(plan?.tables[0].columns.find((c) => c.name === "updated_at")?.change).toBe(
    "added",
  );
  expect(plan?.tables[1].columns[0]?.change).toBe("modified");
  expect(plan?.applySql).toContain("ALTER TABLE saved_queries");
  expect(plan?.notes?.some((n) => n.includes("UNIQUE"))).toBe(true);
});

test("parseSchemaPlanBlock rejects empty tables", () => {
  const source = "```schema-plan\n{\"tables\":[]}\n```";
  expect(parseSchemaPlanBlock(source)).toBeNull();
});

test("parseSchemaPlanBlock accepts a real fenced json payload with newlines", () => {
  const json = JSON.stringify({
    tables: [
      {
        name: "saved_queries",
        columns: { id: "unchanged", updated_at: "added" },
      },
    ],
    applySql: ["ALTER TABLE saved_queries ADD COLUMN updated_at TEXT;"],
  });
  const source = "Proposed:\n\n```json\n" + json + "\n```\n";
  const plan = parseSchemaPlanBlock(source);
  expect(plan?.tables[0].table).toBe("saved_queries");
  expect(plan?.tables[0].columns.find((c) => c.change === "added")?.name).toBe(
    "updated_at",
  );
});
