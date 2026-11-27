//! Port of lib/ai/markdown-blocks.ts (`parseMarkdownBlocks`), the inline
//! renderer of components/studio/ai/ai-inline-markdown.tsx (backtick code +
//! `**bold**`), lib/ai/sql-highlight.tsx (token classes) and the
//! ```tasks / ```approval block parsers (lib/ai/task-block.ts, approval-block.ts).

use crate::agent::{parse_questions, ApprovalQuestion};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq)]
pub enum Block {
    Paragraph(String),
    Code { language: String, code: String },
    List(Vec<String>),
    Table { headers: Vec<String>, rows: Vec<Vec<String>> },
}

fn is_table_separator(line: &str) -> bool {
    let t = line.trim().trim_start_matches('|').trim_end_matches('|');
    let cells: Vec<&str> = t.split('|').collect();
    cells.len() >= 2
        && cells.iter().all(|c| {
            let c = c.trim().trim_start_matches(':').trim_end_matches(':');
            c.len() >= 3 && c.chars().all(|ch| ch == '-')
        })
}

fn split_row(line: &str) -> Vec<String> {
    let t = line.trim();
    let t = t.strip_prefix('|').unwrap_or(t);
    let t = t.strip_suffix('|').unwrap_or(t);
    t.split('|').map(|c| c.trim().to_string()).collect()
}

fn list_item(line: &str) -> Option<&str> {
    let t = line.trim();
    let rest = t.strip_prefix('-').or_else(|| t.strip_prefix('*'))?;
    rest.starts_with(char::is_whitespace).then(|| rest.trim_start())
}

/// `parseMarkdownBlocks`.
pub fn parse_blocks(source: &str) -> Vec<Block> {
    let src = source.replace("\r\n", "\n");
    let lines: Vec<&str> = src.split('\n').collect();
    let mut blocks = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let trimmed = lines[i].trim();
        if trimmed.is_empty() {
            i += 1;
            continue;
        }
        if let Some(lang) = trimmed.strip_prefix("```") {
            let language = lang.trim().to_string();
            let mut code = Vec::new();
            i += 1;
            while i < lines.len() && !lines[i].trim().starts_with("```") {
                code.push(lines[i]);
                i += 1;
            }
            i += 1;
            blocks.push(Block::Code { language, code: code.join("\n").trim().to_string() });
            continue;
        }
        let next = lines.get(i + 1).map(|l| l.trim()).unwrap_or("");
        if trimmed.contains('|') && is_table_separator(next) {
            let headers = split_row(trimmed);
            let mut rows = Vec::new();
            i += 2;
            while i < lines.len() && lines[i].trim().contains('|') {
                rows.push(split_row(lines[i]));
                i += 1;
            }
            blocks.push(Block::Table { headers, rows });
            continue;
        }
        if list_item(trimmed).is_some() {
            let mut items = Vec::new();
            while i < lines.len() {
                let Some(item) = list_item(lines[i]) else { break };
                items.push(item.to_string());
                i += 1;
            }
            blocks.push(Block::List(items));
            continue;
        }
        let mut para: Vec<&str> = Vec::new();
        while i < lines.len() && !lines[i].trim().is_empty() {
            if !para.is_empty() && lines[i].trim().starts_with("```") {
                break;
            }
            para.push(lines[i].trim());
            i += 1;
        }
        blocks.push(Block::Paragraph(para.join(" ")));
    }
    blocks
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InlineKind {
    Text,
    Bold,
    Code,
}

/// `renderInlineMarkdown`: split on `` `code` `` then `**bold**`.
pub fn inline_runs(text: &str) -> Vec<(InlineKind, String)> {
    let mut out = Vec::new();
    let mut rest = text;
    let push_bold = |s: &str, out: &mut Vec<(InlineKind, String)>| {
        let mut r = s;
        while let Some(a) = r.find("**") {
            let after = &r[a + 2..];
            match after.find("**") {
                Some(b) if b > 0 && !after[..b].contains('*') => {
                    if a > 0 {
                        out.push((InlineKind::Text, r[..a].to_string()));
                    }
                    out.push((InlineKind::Bold, after[..b].to_string()));
                    r = &after[b + 2..];
                }
                _ => {
                    out.push((InlineKind::Text, r[..a + 2].to_string()));
                    r = after;
                }
            }
        }
        if !r.is_empty() {
            out.push((InlineKind::Text, r.to_string()));
        }
    };
    while let Some(a) = rest.find('`') {
        let after = &rest[a + 1..];
        match after.find('`') {
            Some(b) if b > 0 => {
                push_bold(&rest[..a], &mut out);
                out.push((InlineKind::Code, after[..b].to_string()));
                rest = &after[b + 1..];
            }
            _ => break,
        }
    }
    push_bold(rest, &mut out);
    // Merge adjacent text runs.
    let mut merged: Vec<(InlineKind, String)> = Vec::new();
    for (k, s) in out {
        match merged.last_mut() {
            Some((InlineKind::Text, prev)) if k == InlineKind::Text => prev.push_str(&s),
            _ => merged.push((k, s)),
        }
    }
    merged
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SqlToken {
    Plain,
    Comment,
    String,
    Number,
    Keyword,
}

const SQL_KEYWORDS: &[&str] = &[
    "select", "from", "where", "insert", "into", "values", "update", "set", "delete", "join", "left", "right", "inner", "outer", "full", "on", "group",
    "by", "order", "limit", "offset", "having", "as", "and", "or", "not", "null", "is", "in", "exists", "create", "alter", "drop", "table", "view",
    "index", "primary", "key", "foreign", "references", "constraint", "unique", "default", "returning", "with", "union", "all", "distinct", "case",
    "when", "then", "else", "end", "like", "ilike",
];

/// `highlightSql` token ranges (byte offsets).
pub fn sql_tokens(src: &str) -> Vec<(std::ops::Range<usize>, SqlToken)> {
    let b = src.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        let start = i;
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        let kind = if c == b'-' && b.get(i + 1) == Some(&b'-') {
            while i < b.len() && b[i] != b'\n' {
                i += 1;
            }
            SqlToken::Comment
        } else if c == b'\'' || c == b'"' {
            i += 1;
            while i < b.len() && b[i] != c {
                i += 1;
            }
            if i < b.len() {
                i += 1;
                SqlToken::String
            } else {
                i = start + 1;
                SqlToken::Plain
            }
        } else if c.is_ascii_digit() {
            while i < b.len() && (b[i].is_ascii_digit() || b[i] == b'.') {
                i += 1;
            }
            SqlToken::Number
        } else if c.is_ascii_alphabetic() || c == b'_' {
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') {
                i += 1;
            }
            if SQL_KEYWORDS.contains(&src[start..i].to_ascii_lowercase().as_str()) {
                SqlToken::Keyword
            } else {
                SqlToken::Plain
            }
        } else {
            i += src[i..].chars().next().map_or(1, char::len_utf8);
            SqlToken::Plain
        };
        if kind != SqlToken::Plain {
            out.push((start..i, kind));
        }
    }
    out
}

// ---- ```tasks / ```approval -------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
pub struct Task {
    pub id: String,
    pub label: String,
    pub amount: Option<String>,
    /// pending | in_progress | completed | failed
    pub status: String,
    pub details: Vec<(String, String)>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TaskBlock {
    pub list: bool,
    pub tasks: Vec<Task>,
}

fn normalize_status(v: &Value) -> String {
    match v.as_str().unwrap_or("").to_ascii_lowercase().replace(['-', ' '], "_").as_str() {
        "in_progress" | "running" | "active" | "doing" => "in_progress".into(),
        "completed" | "complete" | "done" | "success" => "completed".into(),
        "failed" | "error" | "fail" => "failed".into(),
        _ => "pending".into(),
    }
}

/// `parseTaskBlock` (code is the fenced block body).
pub fn parse_task_block(code: &str) -> Option<TaskBlock> {
    let parsed: Value = serde_json::from_str(code).ok()?;
    let arr = parsed.as_array().cloned().or_else(|| parsed["tasks"].as_array().cloned())?;
    let tasks: Vec<Task> = arr
        .iter()
        .enumerate()
        .filter_map(|(idx, t)| {
            let label = t["label"].as_str().or(t["title"].as_str()).or(t["name"].as_str())?.trim().to_string();
            if label.is_empty() {
                return None;
            }
            let details = t["details"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|d| match d {
                    Value::String(s) => Some((s.clone(), String::new())),
                    Value::Object(_) => {
                        let l = d["label"].as_str().or(d["title"].as_str())?.trim().to_string();
                        let meta = match &d["meta"] {
                            Value::Null => String::new(),
                            Value::String(s) => s.clone(),
                            other => other.to_string(),
                        };
                        (!l.is_empty()).then_some((l, meta))
                    }
                    _ => None,
                })
                .collect();
            Some(Task {
                id: t["id"].as_str().or(t["key"].as_str()).map(str::to_string).unwrap_or_else(|| format!("task-{idx}")),
                label,
                amount: match &t["amount"] {
                    Value::Null => None,
                    Value::String(s) => Some(s.clone()),
                    other => Some(other.to_string()),
                },
                status: normalize_status(&t["status"]),
                details,
            })
        })
        .collect();
    if tasks.is_empty() {
        return None;
    }
    Some(TaskBlock { list: matches!(parsed["variant"].as_str(), Some("List" | "list")), tasks })
}

/// `parseApprovalBlock` → (questions, resettable).
pub fn parse_approval_block(code: &str) -> Option<(Vec<ApprovalQuestion>, bool)> {
    let parsed: Value = serde_json::from_str(code).ok()?;
    let qs = parse_questions(&parsed);
    if qs.is_empty() {
        return None;
    }
    Some((qs, parsed["resettable"] != Value::Bool(false)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks() {
        let b = parse_blocks("Hello\nworld\n\n- a\n* b\n\n```sql\nselect 1;\n```\n| a | b |\n| --- | --- |\n| 1 | 2 |\n");
        assert_eq!(b[0], Block::Paragraph("Hello world".into()));
        assert_eq!(b[1], Block::List(vec!["a".into(), "b".into()]));
        assert_eq!(b[2], Block::Code { language: "sql".into(), code: "select 1;".into() });
        assert_eq!(b[3], Block::Table { headers: vec!["a".into(), "b".into()], rows: vec![vec!["1".into(), "2".into()]] });
        // unterminated fence while streaming
        assert_eq!(parse_blocks("```sql\nselect")[0], Block::Code { language: "sql".into(), code: "select".into() });
    }

    #[test]
    fn inline() {
        let r = inline_runs("Use `id` and **bold** text");
        assert_eq!(r, vec![(InlineKind::Text, "Use ".into()), (InlineKind::Code, "id".into()), (InlineKind::Text, " and ".into()), (InlineKind::Bold, "bold".into()), (InlineKind::Text, " text".into())]);
        assert_eq!(inline_runs("a ** b"), vec![(InlineKind::Text, "a ** b".into())]);
    }

    #[test]
    fn sql() {
        let t = sql_tokens("SELECT 'x', 12 -- hi");
        assert_eq!(t[0].1, SqlToken::Keyword);
        assert_eq!(t[1].1, SqlToken::String);
        assert_eq!(t[2].1, SqlToken::Number);
        assert_eq!(t[3].1, SqlToken::Comment);
    }

    #[test]
    fn task_and_approval() {
        let t = parse_task_block(r#"{"variant":"List","tasks":[{"label":"A","status":"done","details":[{"label":"x","meta":3}]}]}"#).unwrap();
        assert!(t.list);
        assert_eq!(t.tasks[0].status, "completed");
        assert_eq!(t.tasks[0].details[0].1, "3");
        let (q, reset) = parse_approval_block(r#"{"questions":[{"q":"Go?","type":"radio","options":["Yes"]}],"resettable":false}"#).unwrap();
        assert_eq!(q.len(), 1);
        assert!(!reset);
    }
}
