/**
 * Mechanical edge-function ports between Supabase (Deno) and Neon (Node),
 * rendered as git-style unified diffs for human review.
 *
 * These transforms are SYNTACTIC, not semantic: runtime APIs differ, so
 * every diff ships with notes/TODOs and must be eyeballed before deploy.
 * Nothing here deploys anything on its own.
 */

import type { FunctionCompatDiff, FunctionFile, ProviderType } from "./transfer-types";

const REVIEW_HEADER = "// AUTO-PORT DRAFT — mechanical transform, REVIEW REQUIRED before deploy.";

/** Supabase (Deno) sources → Neon (Node) shape. */
export function transformSupabaseToNeon(files: FunctionFile[]): { files: FunctionFile[]; notes: string[] } {
  const notes = new Set<string>();
  const out = files.map((f) => {
    let body = f.content;
    // Drop the Deno serve import; the handler becomes the default export.
    const serveImport = /import\s*\{[^}]*\bserve\b[^}]*\}\s*from\s*["']https:\/\/deno\.land[^"']*["'];?\s*\n?/;
    if (serveImport.test(body)) {
      body = body.replace(serveImport, "");
      notes.add("Removed Deno serve import; handler is now the default export.");
    }
    body = body.replace(/serve\(\s*(async\s*)?\(/g, (_m, a: string) => {
      notes.add("Rewrote serve(handler) to `export default handler`.");
      return `export default ${a || ""}(`;
    });
    // Deno.env.get("X") -> process.env["X"]
    if (/Deno\.env\.get\(/.test(body)) {
      body = body.replace(/Deno\.env\.get\(([^)]+)\)/g, "process.env[$1]");
      notes.add("Rewrote Deno.env.get(x) to process.env[x].");
    }
    // Other Deno.* namespace uses have no Node equivalent.
    body = body.replace(/Deno\.([A-Za-z_]+)/g, (_m, prop: string) => {
      notes.add(`Deno.${prop} has no Node equivalent — manual port required (marked TODO).`);
      return `/* TODO(port): Deno.${prop} has no Node equivalent */ Deno.${prop}`;
    });
    // deno.land/x/* and jsr: imports -> npm with verification TODO.
    body = body.replace(/from\s*(["'])https:\/\/deno\.land\/x\/([^"']+)\1/g, (_m, q: string, mod: string) => {
      notes.add("Rewrote deno.land/x imports to npm specifiers — verify equivalents exist.");
      return `from ${q}npm:${mod.split("@")[0]}${q} /* TODO(port): verify npm equivalent of deno.land/x/${mod} */`;
    });
    body = body.replace(/from\s*(["'])jsr:([^"']+)\1/g, (_m, q: string, mod: string) => {
      notes.add("Rewrote jsr: imports to npm specifiers — verify equivalents exist.");
      return `from ${q}npm:${mod}${q} /* TODO(port): verify npm equivalent of jsr:${mod} */`;
    });
    // esm.sh CDN imports of supabase-js -> bare npm specifier.
    if (/from\s*["']https:\/\/esm\.sh\/@supabase\//.test(body)) {
      body = body.replace(/from\s*["']https:\/\/esm\.sh\/(@supabase\/[^"']+)["']/g, 'from "$1"');
      notes.add("Rewrote esm.sh supabase-js imports to bare npm specifiers.");
    }
    return { path: f.path, content: body };
  });
  const header = `${REVIEW_HEADER}\n// Source: Supabase Edge Function (Deno). Target: Neon Functions (Node).\n`;
  return {
    files: out.map((f) => ({ ...f, content: f.content.startsWith("// AUTO-PORT") ? f.content : `${header}${f.content}` })),
    notes: [...notes],
  };
}

/** Neon (Node) sources → Supabase (Deno) shape. */
export function transformNeonToSupabase(files: FunctionFile[]): { files: FunctionFile[]; notes: string[] } {
  const notes = new Set<string>();
  const out = files.map((f) => {
    let body = f.content;
    // Default-exported handler -> serve() wrapper.
    if (/export\s+default\s+(async\s*)?\(/.test(body)) {
      body = body.replace(/export\s+default\s+(async\s*)?\(/, (_m, a: string) => `serve(${a || ""}(`);
      // close the serve( call: append one closing paren at end of file body
      body = `${body.replace(/\s*$/, "")}\n);`;
      body = `import { serve } from "https://deno.land/std@0.208.0/http/server.ts";\n${body}`;
      notes.add("Wrapped default export in Deno serve().");
    } else {
      notes.add("No default-exported handler found — entrypoint may need manual wiring with serve().");
    }
    // process.env["X"] / process.env.X -> Deno.env.get("X")
    if (/process\.env\[/.test(body)) {
      body = body.replace(/process\.env\[([^\]]+)\]/g, "Deno.env.get($1)");
      notes.add("Rewrote process.env[x] to Deno.env.get(x).");
    }
    if (/process\.env\.[A-Za-z_][A-Za-z0-9_]*/.test(body)) {
      body = body.replace(/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, 'Deno.env.get("$1")');
      notes.add("Rewrote process.env.X to Deno.env.get(\"X\").");
    }
    // npm: specifiers -> esm.sh CDN for Deno.
    body = body.replace(/from\s*(["'])npm:([^"']+)\1/g, (_m, q: string, mod: string) => {
      notes.add("Rewrote npm: specifiers to esm.sh CDN imports — verify they work under Deno.");
      return `from ${q}https://esm.sh/${mod}${q}`;
    });
    if (/\brequire\s*\(/.test(body)) {
      notes.add("CommonJS require() has no Deno equivalent — convert to ESM imports manually (marked TODO).");
      body = body.replace(/\brequire\s*\(/g, "/* TODO(port): convert require to ESM import */ require(");
    }
    return { path: f.path, content: body };
  });
  const header = `${REVIEW_HEADER}\n// Source: Neon Function (Node). Target: Supabase Edge Function (Deno).\n`;
  return {
    files: out.map((f) => ({ ...f, content: f.content.startsWith("// AUTO-PORT") ? f.content : `${header}${f.content}` })),
    notes: [...notes],
  };
}

type DiffOp = { type: " " | "-" | "+"; text: string };

function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // Cap quadratic behavior on huge files; caller falls back to full replace.
  if (n * m > 4_000_000) return [];
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: " ", text: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "-", text: a[i] });
      i++;
    } else {
      ops.push({ type: "+", text: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "-", text: a[i++] });
  while (j < m) ops.push({ type: "+", text: b[j++] });
  return ops;
}

/** Git-style unified diff (--- / +++ / @@ hunks, 3 lines context). */
export function unifiedDiff(path: string, original: string, transformed: string, fromLabel = "a", toLabel = "b"): string {
  const a = original.split("\n");
  const b = transformed.split("\n");
  let ops = lcsDiff(a, b);
  if (ops.length === 0 && (a.join("\n") !== b.join("\n"))) {
    // Too large for LCS: whole-file replace as a single hunk.
    ops = [...a.map((text) => ({ type: "-" as const, text })), ...b.map((text) => ({ type: "+" as const, text }))];
  }
  if (ops.every((o) => o.type === " ")) return "";
  const out: string[] = [`--- ${fromLabel}/${path}`, `+++ ${toLabel}/${path}`];
  const CONTEXT = 3;
  // Walk ops once tracking line numbers, then split into hunks.
  const numbered: Array<DiffOp & { aNo: number; bNo: number }> = [];
  {
    let ai = 1;
    let bi = 1;
    for (const op of ops) {
      if (op.type === " ") {
        numbered.push({ ...op, aNo: ai++, bNo: bi++ });
      } else if (op.type === "-") {
        numbered.push({ ...op, aNo: ai++, bNo: bi });
      } else {
        numbered.push({ ...op, aNo: ai, bNo: bi++ });
      }
    }
  }
  // Re-split numbered ops into hunks with context.
  const h2: Array<Array<DiffOp & { aNo: number; bNo: number }>> = [];
  let cur: Array<DiffOp & { aNo: number; bNo: number }> = [];
  let trail: Array<DiffOp & { aNo: number; bNo: number }> = [];
  const flush2 = () => {
    if (cur.length > 0) {
      h2.push([...cur, ...trail.slice(0, CONTEXT)]);
      cur = [];
    }
    trail = [];
  };
  for (const op of numbered) {
    if (op.type === " ") {
      trail.push(op);
      if (cur.length > 0 && trail.length > CONTEXT * 2) {
        cur.push(...trail.slice(0, CONTEXT));
        flush2();
        const carry = trail.slice(CONTEXT);
        cur.push(...carry);
        trail = [];
      } else if (cur.length === 0 && trail.length > CONTEXT) {
        trail.splice(0, trail.length - CONTEXT);
      } else if (cur.length > 0) {
        cur.push(op);
      }
    } else {
      if (cur.length === 0) cur.push(...trail);
      else cur.push(...trail);
      trail = [];
      cur.push(op);
    }
  }
  flush2();
  for (const hunk of h2) {
    const aCount = hunk.filter((o) => o.type !== "+").length;
    const bStart = hunk[0].bNo;
    const bCount = hunk.filter((o) => o.type !== "-").length;
    out.push(`@@ -${hunk[0].aNo},${aCount} +${bStart},${bCount} @@`);
    for (const op of hunk) out.push(`${op.type}${op.text}`);
  }
  return out.join("\n");
}

/**
 * Build compat diffs from `from` toward every OTHER supported provider.
 * Same-family ports produce no diff (identical runtime).
 */
export function buildCompatDiffs(
  slug: string,
  from: ProviderType,
  files: FunctionFile[],
): FunctionCompatDiff[] {
  void slug;
  const targets: ProviderType[] = (["supabase", "neon"] as ProviderType[]).filter((t) => t !== from);
  const diffs: FunctionCompatDiff[] = [];
  for (const target of targets) {
    const { files: transformed, notes } =
      from === "supabase" && target === "neon"
        ? transformSupabaseToNeon(files)
        : from === "neon" && target === "supabase"
          ? transformNeonToSupabase(files)
          : { files, notes: [] as string[] };
    const parts = files.map((f, i) => {
      const t = transformed[i] ?? { path: f.path, content: f.content };
      return unifiedDiff(f.path, f.content, t.content, `${from}/${f.path}`, `${target}/${f.path}`);
    });
    const diff = parts.filter(Boolean).join("\n");
    if (!diff) continue;
    diffs.push({
      targetProvider: target,
      diff,
      transformedFiles: transformed,
      notes: [
        "Mechanical draft only — runtime APIs differ (Deno vs Node). Review every hunk before deploying.",
        ...notes,
      ],
    });
  }
  return diffs;
}
