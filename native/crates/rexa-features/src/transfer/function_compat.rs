//! Port of lib/transfer/function-compat.ts: mechanical edge-function ports
//! between Supabase (Deno) and Neon (Node), rendered as git-style unified
//! diffs for human review. Syntactic only — nothing here deploys.

use super::types::{FunctionCompatDiff, FunctionFile, ProviderType};
use regex::{Captures, Regex};

const REVIEW_HEADER: &str = "// AUTO-PORT DRAFT — mechanical transform, REVIEW REQUIRED before deploy.";

fn re(s: &str) -> Regex {
    Regex::new(s).expect("static regex")
}

struct Notes(Vec<String>);
impl Notes {
    fn add(&mut self, n: impl Into<String>) {
        let n = n.into();
        if !self.0.contains(&n) {
            self.0.push(n);
        }
    }
}

fn with_header(files: Vec<FunctionFile>, header: &str) -> Vec<FunctionFile> {
    files
        .into_iter()
        .map(|f| FunctionFile { content: if f.content.starts_with("// AUTO-PORT") { f.content } else { format!("{header}{}", f.content) }, path: f.path })
        .collect()
}

/// `transformSupabaseToNeon`
pub fn transform_supabase_to_neon(files: &[FunctionFile]) -> (Vec<FunctionFile>, Vec<String>) {
    let mut notes = Notes(Vec::new());
    let out: Vec<FunctionFile> = files
        .iter()
        .map(|f| {
            let mut body = f.content.clone();
            let serve_import = re(r#"import\s*\{[^}]*\bserve\b[^}]*\}\s*from\s*["']https://deno\.land[^"']*["'];?\s*\n?"#);
            if serve_import.is_match(&body) {
                body = serve_import.replacen(&body, 1, "").into_owned();
                notes.add("Removed Deno serve import; handler is now the default export.");
            }
            let serve_call = re(r"serve\(\s*(async\s*)?\(");
            let rewrote = serve_call.is_match(&body);
            if rewrote {
                body = serve_call
                    .replace_all(&body, |c: &Captures| format!("export default {}(", c.get(1).map_or("", |m| m.as_str())))
                    .into_owned();
                notes.add("Rewrote serve(handler) to `export default handler`.");
            }
            if rewrote && re(r"=>[\s\S]*\}\s*\)\s*;?\s*$").is_match(&body) {
                body = re(r"\}\s*\)\s*;?\s*$").replacen(&body, 1, "}\n;").into_owned();
                notes.add("Removed serve() wrapper closing paren from ported handler.");
            }
            if body.contains("Deno.env.get(") {
                body = re(r"Deno\.env\.get\(([^)]+)\)").replace_all(&body, "process.env[$1]").into_owned();
                notes.add("Rewrote Deno.env.get(x) to process.env[x].");
            }
            body = re(r"Deno\.([A-Za-z_]+)")
                .replace_all(&body, |c: &Captures| {
                    notes.add(format!("Deno.{} has no Node equivalent — manual port required (marked TODO).", &c[1]));
                    format!("/* TODO(port): Deno.{0} has no Node equivalent */ Deno.{0}", &c[1])
                })
                .into_owned();
            body = re(r#"from\s*(["'])https://deno\.land/x/([^"']+)["']"#)
                .replace_all(&body, |c: &Captures| {
                    notes.add("Rewrote deno.land/x imports to npm specifiers — verify equivalents exist.");
                    let (q, m) = (&c[1], &c[2]);
                    format!("from {q}npm:{}{q} /* TODO(port): verify npm equivalent of deno.land/x/{m} */", m.split('@').next().unwrap_or(m))
                })
                .into_owned();
            body = re(r#"from\s*(["'])jsr:([^"']+)["']"#)
                .replace_all(&body, |c: &Captures| {
                    notes.add("Rewrote jsr: imports to npm specifiers — verify equivalents exist.");
                    let (q, m) = (&c[1], &c[2]);
                    format!("from {q}npm:{m}{q} /* TODO(port): verify npm equivalent of jsr:{m} */")
                })
                .into_owned();
            let esm = re(r#"from\s*["']https://esm\.sh/(@supabase/[^"']+)["']"#);
            if esm.is_match(&body) {
                body = esm.replace_all(&body, "from \"$1\"").into_owned();
                notes.add("Rewrote esm.sh supabase-js imports to bare npm specifiers.");
            }
            FunctionFile { path: f.path.clone(), content: body }
        })
        .collect();
    let header = format!("{REVIEW_HEADER}\n// Source: Supabase Edge Function (Deno). Target: Neon Functions (Node).\n");
    (with_header(out, &header), notes.0)
}

/// `transformNeonToSupabase`
pub fn transform_neon_to_supabase(files: &[FunctionFile]) -> (Vec<FunctionFile>, Vec<String>) {
    let mut notes = Notes(Vec::new());
    let out: Vec<FunctionFile> = files
        .iter()
        .map(|f| {
            let mut body = f.content.clone();
            if re(r"export\s+default\s+(async\s+)?(function\b|\(|[\w$]+\s*=>)").is_match(&body) {
                body = re(r"export\s+default\s+(async\s+)?")
                    .replacen(&body, 1, |c: &Captures| format!("serve({}", c.get(1).map_or("", |m| m.as_str())))
                    .into_owned();
                body = format!("{}\n);", re(r"[;\s]*$").replace(&body, ""));
                body = format!("import {{ serve }} from \"https://deno.land/std@0.208.0/http/server.ts\";\n{body}");
                notes.add("Wrapped default export in Deno serve().");
            } else {
                notes.add("No default-exported handler found — entrypoint may need manual wiring with serve().");
            }
            if body.contains("process.env[") {
                body = re(r"process\.env\[([^\]]+)\]").replace_all(&body, "Deno.env.get($1)").into_owned();
                notes.add("Rewrote process.env[x] to Deno.env.get(x).");
            }
            let dot = re(r"process\.env\.([A-Za-z_][A-Za-z0-9_]*)");
            if dot.is_match(&body) {
                body = dot.replace_all(&body, "Deno.env.get(\"$1\")").into_owned();
                notes.add("Rewrote process.env.X to Deno.env.get(\"X\").");
            }
            body = re(r#"from\s*(["'])npm:([^"']+)["']"#)
                .replace_all(&body, |c: &Captures| {
                    notes.add("Rewrote npm: specifiers to esm.sh CDN imports — verify they work under Deno.");
                    format!("from {0}https://esm.sh/{1}{0}", &c[1], &c[2])
                })
                .into_owned();
            let req = re(r"\brequire\s*\(");
            if req.is_match(&body) {
                notes.add("CommonJS require() has no Deno equivalent — convert to ESM imports manually (marked TODO).");
                body = req.replace_all(&body, "/* TODO(port): convert require to ESM import */ require(").into_owned();
            }
            FunctionFile { path: f.path.clone(), content: body }
        })
        .collect();
    let header = format!("{REVIEW_HEADER}\n// Source: Neon Function (Node). Target: Supabase Edge Function (Deno).\n");
    (with_header(out, &header), notes.0)
}

#[derive(Clone, Copy, PartialEq)]
enum Op {
    Same,
    Del,
    Add,
}

fn lcs_diff<'a>(a: &[&'a str], b: &[&'a str]) -> Vec<(Op, &'a str)> {
    let (n, m) = (a.len(), b.len());
    if n * m > 4_000_000 {
        return Vec::new();
    }
    let mut dp = vec![vec![0u32; m + 1]; n + 1];
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            dp[i][j] = if a[i] == b[j] { dp[i + 1][j + 1] + 1 } else { dp[i + 1][j].max(dp[i][j + 1]) };
        }
    }
    let mut ops = Vec::new();
    let (mut i, mut j) = (0, 0);
    while i < n && j < m {
        if a[i] == b[j] {
            ops.push((Op::Same, a[i]));
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            ops.push((Op::Del, a[i]));
            i += 1;
        } else {
            ops.push((Op::Add, b[j]));
            j += 1;
        }
    }
    ops.extend(a[i..].iter().map(|t| (Op::Del, *t)));
    ops.extend(b[j..].iter().map(|t| (Op::Add, *t)));
    ops
}

/// `unifiedDiff` (3 lines of context).
pub fn unified_diff(path: &str, original: &str, transformed: &str, from: &str, to: &str) -> String {
    let a: Vec<&str> = original.split('\n').collect();
    let b: Vec<&str> = transformed.split('\n').collect();
    let mut ops = lcs_diff(&a, &b);
    if ops.is_empty() && original != transformed {
        ops = a.iter().map(|t| (Op::Del, *t)).chain(b.iter().map(|t| (Op::Add, *t))).collect();
    }
    if ops.iter().all(|o| o.0 == Op::Same) {
        return String::new();
    }
    #[derive(Clone, Copy)]
    struct N<'a> {
        op: Op,
        text: &'a str,
        a_no: usize,
        b_no: usize,
    }
    let (mut ai, mut bi) = (1, 1);
    let numbered: Vec<N> = ops
        .iter()
        .map(|&(op, text)| {
            let n = N { op, text, a_no: ai, b_no: bi };
            match op {
                Op::Same => {
                    ai += 1;
                    bi += 1;
                }
                Op::Del => ai += 1,
                Op::Add => bi += 1,
            }
            n
        })
        .collect();
    // Hunks: every change plus 3 lines of context; changes closer than
    // 2×context share a hunk. (The original's splitter duplicated context
    // lines; this emits the intended standard unified diff.)
    const CONTEXT: usize = 3;
    let changes: Vec<usize> = numbered.iter().enumerate().filter(|(_, o)| o.op != Op::Same).map(|(i, _)| i).collect();
    let mut hunks: Vec<Vec<N>> = Vec::new();
    let mut k = 0;
    while k < changes.len() {
        let start = changes[k].saturating_sub(CONTEXT);
        let mut last = changes[k];
        while k + 1 < changes.len() && changes[k + 1] - last <= CONTEXT * 2 + 1 {
            k += 1;
            last = changes[k];
        }
        let end = (last + CONTEXT + 1).min(numbered.len());
        hunks.push(numbered[start..end].to_vec());
        k += 1;
    }
    let mut out = vec![format!("--- {from}/{path}"), format!("+++ {to}/{path}")];
    for h in hunks {
        let a_count = h.iter().filter(|o| o.op != Op::Add).count();
        let b_count = h.iter().filter(|o| o.op != Op::Del).count();
        out.push(format!("@@ -{},{a_count} +{},{b_count} @@", h[0].a_no, h[0].b_no));
        for o in h {
            let c = match o.op {
                Op::Same => ' ',
                Op::Del => '-',
                Op::Add => '+',
            };
            out.push(format!("{c}{}", o.text));
        }
    }
    out.join("\n")
}

/// `buildCompatDiffs`
pub fn build_compat_diffs(from: ProviderType, files: &[FunctionFile]) -> Vec<FunctionCompatDiff> {
    let mut diffs = Vec::new();
    for target in [ProviderType::Supabase, ProviderType::Neon].into_iter().filter(|t| *t != from) {
        let (transformed, notes) = match (from, target) {
            (ProviderType::Supabase, ProviderType::Neon) => transform_supabase_to_neon(files),
            (ProviderType::Neon, ProviderType::Supabase) => transform_neon_to_supabase(files),
            _ => (files.to_vec(), Vec::new()),
        };
        let parts: Vec<String> = files
            .iter()
            .enumerate()
            .map(|(i, f)| {
                let t = transformed.get(i).map_or(f.content.as_str(), |t| t.content.as_str());
                unified_diff(&f.path, &f.content, t, &format!("{}/{}", from.as_str(), f.path), &format!("{}/{}", target.as_str(), f.path))
            })
            .filter(|d| !d.is_empty())
            .collect();
        let diff = parts.join("\n");
        if diff.is_empty() {
            continue;
        }
        let mut all_notes = vec!["Mechanical draft only — runtime APIs differ (Deno vs Node). Review every hunk before deploying.".to_string()];
        all_notes.extend(notes);
        diffs.push(FunctionCompatDiff { target_provider: target, diff, transformed_files: transformed, notes: all_notes });
    }
    diffs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ports_supabase_to_neon() {
        let src = "import { serve } from \"https://deno.land/std@0.168.0/http/server.ts\";\nserve(async (req) => {\n  const k = Deno.env.get(\"KEY\");\n  return new Response(k);\n});";
        let (files, notes) = transform_supabase_to_neon(&[FunctionFile { path: "index.ts".into(), content: src.into() }]);
        assert!(files[0].content.contains("export default async (req) =>"));
        assert!(files[0].content.contains("process.env[\"KEY\"]"));
        assert!(files[0].content.starts_with("// AUTO-PORT"));
        assert!(!notes.is_empty());
        let diffs = build_compat_diffs(ProviderType::Supabase, &[FunctionFile { path: "index.ts".into(), content: src.into() }]);
        assert_eq!(diffs.len(), 1);
        assert!(diffs[0].diff.starts_with("--- supabase/index.ts/index.ts"));
        assert!(diffs[0].diff.contains("@@ -1,"));
    }
}
