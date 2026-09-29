import { describe, it, expect } from "bun:test";
import {
  buildCompatDiffs,
  transformNeonToSupabase,
  transformSupabaseToNeon,
  unifiedDiff,
} from "@/lib/transfer/function-compat";

const SUPABASE_FN = `import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const key = Deno.env.get("SERVICE_KEY");
  const extra = Deno.readTextFile("./data.txt");
  return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
});
`;

describe("function-compat", () => {
  it("ports Supabase/Deno sources toward Neon/Node", () => {
    const { files, notes } = transformSupabaseToNeon([{ path: "index.ts", content: SUPABASE_FN }]);
    expect(files).toHaveLength(1);
    const body = files[0].content;
    expect(body).toContain("export default async (req");
    expect(body).not.toContain("deno.land/std");
    expect(body).toContain('process.env["SERVICE_KEY"]');
    expect(body).toContain("TODO(port)");
    expect(body).toContain('from "@supabase/supabase-js');
    expect(notes.length).toBeGreaterThan(0);
  });

  it("ports Neon/Node sources toward Supabase/Deno", () => {
    const src = `export default async (req) {\n  const key = process.env.SERVICE_KEY;\n  const fs = require("fs");\n  return new Response("ok");\n}\n`;
    const { files, notes } = transformNeonToSupabase([{ path: "index.ts", content: src }]);
    const body = files[0].content;
    expect(body).toContain('serve(async (req)');
    expect(body).toContain("deno.land/std");
    expect(body).toContain('Deno.env.get("SERVICE_KEY")');
    expect(body).toContain("TODO(port)");
    expect(notes.length).toBeGreaterThan(0);
  });

  it("renders git-style unified diffs with hunks", () => {
    const diff = unifiedDiff("index.ts", "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8", "line1\nline2\nCHANGED\nline4\nline5\nline6\nline7\nline8", "a", "b");
    expect(diff).toContain("--- a/index.ts");
    expect(diff).toContain("+++ b/index.ts");
    expect(diff).toContain("@@");
    expect(diff).toContain("-line3");
    expect(diff).toContain("+CHANGED");
    expect(diff).toContain(" line4");
  });

  it("returns empty diff for identical content", () => {
    expect(unifiedDiff("index.ts", "same\ncontent", "same\ncontent")).toBe("");
  });

  it("builds per-target compat diffs, skipping same-family ports", () => {
    const diffs = buildCompatDiffs("hello", "supabase", [{ path: "index.ts", content: SUPABASE_FN }]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].targetProvider).toBe("neon");
    expect(diffs[0].diff).toContain("export default");
    expect(diffs[0].notes.join(" ").toLowerCase()).toContain("review");
    expect(diffs[0].transformedFiles).toHaveLength(1);
  });
});
