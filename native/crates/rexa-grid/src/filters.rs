//! Port of the filter string logic of
//! `components/studio/toolbar/toolbar-filter-sort.tsx` (decomposeFilterQuery,
//! parseSegmentToRule, splitTopLevelAnd, …), the quick filters of
//! `components/studio/data-table-toolbar.tsx` (parseQuickFilter,
//! joinFilterClause) and the whole-table search / filter-by-cell helpers of
//! `components/studio/studio-main-content.tsx`. The stored filter is the
//! original's `filterQuery`: a raw WHERE body. SQL for single rules comes from
//! `rexa_drivers::grid::build_rule_clause` (the driver's port of `buildRuleClause`).

use rexa_drivers::grid::{build_rule_clause, strip_leading_where};
use rexa_drivers::{FilterOperator, FilterRule, Kind};

/// The toolbar's draft rule: `FilterRule` plus a stable id for the UI.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DraftRule {
    pub id: u64,
    pub rule: FilterRule,
}

/// `makeRule("")`: column "none", operator "none".
pub fn make_rule(id: u64) -> DraftRule {
    DraftRule { id, rule: FilterRule { enabled: true, column: "none".into(), operator: None, value: String::new() } }
}

pub fn is_real(r: &FilterRule) -> bool {
    r.enabled && !r.column.is_empty() && r.column != "none" && r.operator.is_some()
}

/// `stripLeadingWhereKeyword` including the `SELECT … WHERE …` form.
pub fn strip_where_keyword(text: &str) -> String {
    let t = text.trim();
    if t.len() >= 6 && t[..6].eq_ignore_ascii_case("select") {
        let lower = t.to_lowercase();
        if let Some(pos) = find_word(&lower, "where") {
            return t[pos + 5..].trim().to_string();
        }
        return t.to_string();
    }
    strip_leading_where(t).to_string()
}

fn find_word(hay: &str, word: &str) -> Option<usize> {
    let b = hay.as_bytes();
    let mut start = 0;
    while let Some(p) = hay[start..].find(word) {
        let i = start + p;
        let before = i == 0 || !(b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_');
        let j = i + word.len();
        let after = j >= b.len() || !(b[j].is_ascii_alphanumeric() || b[j] == b'_');
        if before && after {
            return Some(i);
        }
        start = i + 1;
    }
    None
}

/// `stripBalancedOuterParens`.
pub fn strip_balanced_outer_parens(s: &str) -> String {
    let mut out = s.trim().to_string();
    loop {
        if out.len() < 2 || !out.starts_with('(') || !out.ends_with(')') {
            return out;
        }
        let mut depth = 0i32;
        let chars: Vec<char> = out.chars().collect();
        for (i, c) in chars.iter().enumerate() {
            if *c == '(' {
                depth += 1;
            } else if *c == ')' {
                depth -= 1;
            }
            if depth == 0 && i < chars.len() - 1 {
                return out;
            }
        }
        if depth != 0 {
            return out;
        }
        out = chars[1..chars.len() - 1].iter().collect::<String>().trim().to_string();
    }
}

fn is_ws(c: Option<char>) -> bool {
    c.is_none_or(|c| c.is_whitespace())
}

/// Scan top level (outside parens and string literals) for a keyword.
fn top_level_keywords(s: &str, words: &[&str]) -> Vec<(usize, usize)> {
    let chars: Vec<char> = s.chars().collect();
    let upper: Vec<char> = s.to_uppercase().chars().collect();
    let mut hits = Vec::new();
    if upper.len() != chars.len() {
        return hits;
    }
    let (mut depth, mut in_str, mut i) = (0i32, false, 0usize);
    while i < chars.len() {
        let ch = chars[i];
        if in_str {
            if ch == '\'' {
                if chars.get(i + 1) == Some(&'\'') {
                    i += 1;
                } else {
                    in_str = false;
                }
            }
            i += 1;
            continue;
        }
        match ch {
            '\'' => in_str = true,
            '(' => depth += 1,
            ')' => depth = (depth - 1).max(0),
            _ if depth == 0 => {
                for w in words {
                    let wc: Vec<char> = w.chars().collect();
                    if upper[i..].starts_with(&wc)
                        && is_ws(if i == 0 { None } else { Some(chars[i - 1]) })
                        && is_ws(chars.get(i + wc.len()).copied())
                    {
                        hits.push((i, wc.len()));
                    }
                }
            }
            _ => {}
        }
        i += 1;
    }
    hits
}

/// `hasTopLevelOr`.
pub fn has_top_level_or(s: &str) -> bool {
    !top_level_keywords(s, &["OR"]).is_empty()
}

fn has_top_level_joiner(s: &str) -> bool {
    !top_level_keywords(s, &["AND", "OR"]).is_empty()
}

/// `splitTopLevelAnd`.
pub fn split_top_level_and(s: &str) -> Vec<String> {
    let chars: Vec<char> = s.chars().collect();
    let hits = top_level_keywords(s, &["AND"]);
    let mut parts = Vec::new();
    let mut start = 0;
    for (i, len) in hits {
        if i < start {
            continue;
        }
        parts.push(chars[start..i].iter().collect::<String>());
        start = i + len;
    }
    parts.push(chars[start..].iter().collect::<String>());
    parts.into_iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect()
}

#[derive(Clone, Copy, PartialEq)]
enum Quoted {
    None,
    Double,
    Backtick,
    Bracket,
}

fn split_identifier_ref(raw: &str) -> Option<(String, Quoted)> {
    let t = raw.trim();
    if t.chars().count() >= 2 {
        if t.starts_with('"') && t.ends_with('"') {
            return Some((t[1..t.len() - 1].replace("\"\"", "\""), Quoted::Double));
        }
        if t.starts_with('`') && t.ends_with('`') {
            return Some((t[1..t.len() - 1].replace("``", "`"), Quoted::Backtick));
        }
        if t.starts_with('[') && t.ends_with(']') {
            return Some((t[1..t.len() - 1].replace("]]", "]"), Quoted::Bracket));
        }
    }
    let mut chars = t.chars();
    let first = chars.next()?;
    if (first.is_ascii_alphabetic() || first == '_') && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$') {
        return Some((t.to_string(), Quoted::None));
    }
    None
}

/// `sameColumnRef`.
fn same_column_ref(input: &str, canonical: &str, kind: Kind) -> bool {
    let Some((name, quoted)) = split_identifier_ref(input) else { return false };
    if quoted == Quoted::None {
        if kind == Kind::ClickHouse {
            return name == canonical;
        }
        return name.to_lowercase() == canonical.to_lowercase();
    }
    let valid = match quoted {
        Quoted::Double => !matches!(kind, Kind::MySql | Kind::ClickHouse | Kind::MsSql),
        Quoted::Backtick => matches!(kind, Kind::MySql | Kind::ClickHouse),
        _ => kind == Kind::MsSql,
    };
    if !valid {
        return false;
    }
    if matches!(kind, Kind::MySql | Kind::MsSql) {
        return name.to_lowercase() == canonical.to_lowercase();
    }
    name == canonical
}

fn find_column(columns: &[String], raw: &str, kind: Kind) -> Option<String> {
    let mut sorted: Vec<&String> = columns.iter().collect();
    sorted.sort_by_key(|c| std::cmp::Reverse(c.len()));
    sorted.into_iter().find(|c| same_column_ref(raw, c, kind)).cloned()
}

fn extract_string_literals(s: &str) -> Option<(String, Vec<String>)> {
    let chars: Vec<char> = s.chars().collect();
    let (mut out, mut lits, mut i) = (String::new(), Vec::new(), 0);
    while i < chars.len() {
        if chars[i] == '\'' {
            let (mut j, mut lit, mut closed) = (i + 1, String::new(), false);
            while j < chars.len() {
                if chars[j] == '\'' {
                    if chars.get(j + 1) == Some(&'\'') {
                        lit.push('\'');
                        j += 2;
                        continue;
                    }
                    closed = true;
                    j += 1;
                    break;
                }
                lit.push(chars[j]);
                j += 1;
            }
            if !closed {
                return None;
            }
            lits.push(lit);
            out.push_str(&format!("__LIT_{}__", lits.len() - 1));
            i = j;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    Some((out, lits))
}

/// `verifyRuleRoundTrip`.
fn verify_round_trip(seg: &str, input_ref: &str, rule: &FilterRule, kind: Kind) -> bool {
    let Some(rebuilt) = build_rule_clause(rule, kind) else { return false };
    if !same_column_ref(input_ref, &rule.column, kind) {
        return false;
    }
    let (Some((a, al)), Some((b, bl))) = (extract_string_literals(seg), extract_string_literals(&rebuilt)) else {
        return false;
    };
    if al != bl {
        return false;
    }
    let norm = |t: &str| {
        let mut s = t.to_string();
        if kind != Kind::ClickHouse {
            s = s.to_uppercase();
        }
        s = s.replace("!=", "<>").replace(['"', '`', '[', ']'], "");
        let col = if kind == Kind::ClickHouse { rule.column.clone() } else { rule.column.to_uppercase() };
        s = s.split(&col).collect::<Vec<_>>().join("__COL__");
        s.split_whitespace().collect::<Vec<_>>().join(" ")
    };
    norm(&a) == norm(&b)
}

fn unquote_literal(raw: &str) -> String {
    let t = raw.trim();
    if t.len() >= 2 && t.starts_with('\'') && t.ends_with('\'') {
        t[1..t.len() - 1].replace("''", "'")
    } else {
        t.to_string()
    }
}

const SQL_OPS: [(&str, Option<FilterOperator>); 12] = [
    ("IS NOT NULL", Some(FilterOperator::IsNotNull)),
    ("NOT LIKE", Some(FilterOperator::Ne)),
    ("IS NULL", Some(FilterOperator::IsNull)),
    ("ILIKE", Some(FilterOperator::Contains)),
    ("LIKE", Some(FilterOperator::Contains)),
    ("!=", Some(FilterOperator::Ne)),
    ("<>", Some(FilterOperator::Ne)),
    (">=", Some(FilterOperator::Gte)),
    ("<=", Some(FilterOperator::Lte)),
    ("=", Some(FilterOperator::Eq)),
    (">", Some(FilterOperator::Gt)),
    ("<", Some(FilterOperator::Lt)),
];

fn is_strict_quoted(v: &str) -> bool {
    let c: Vec<char> = v.chars().collect();
    if c.len() < 2 || c[0] != '\'' || c[c.len() - 1] != '\'' {
        return false;
    }
    let mut i = 1;
    while i < c.len() - 1 {
        if c[i] == '\'' {
            if i + 1 < c.len() - 1 && c[i + 1] == '\'' {
                i += 2;
                continue;
            }
            return false;
        }
        i += 1;
    }
    true
}

fn is_number(s: &str) -> bool {
    let n = s.strip_prefix('-').unwrap_or(s);
    let mut p = n.splitn(2, '.');
    p.next().is_some_and(|a| !a.is_empty() && a.bytes().all(|b| b.is_ascii_digit()))
        && p.next().is_none_or(|b| !b.is_empty() && b.bytes().all(|x| x.is_ascii_digit()))
}

/// `parseSegmentToRule`.
pub fn parse_segment_to_rule(segment: &str, columns: &[String], kind: Kind) -> Option<FilterRule> {
    let seg = strip_balanced_outer_parens(segment.trim());
    if seg.is_empty() {
        return None;
    }
    // CAST(col AS TEXT) LIKE '%v%'
    let upper = seg.to_uppercase();
    if upper.starts_with("CAST(") {
        if let Some(as_pos) = upper.find(" AS ") {
            let col_raw = seg[5..as_pos].trim();
            if let Some(like_pos) = upper.find(") LIKE '") {
                let target = upper[as_pos + 4..like_pos].trim().replace(' ', "");
                let target_ok = ["TEXT", "CHAR", "STRING", "NVARCHAR(MAX)"].contains(&target.as_str());
                if target_ok && seg.ends_with('\'') {
                    if let Some(col) = find_column(columns, col_raw, kind) {
                        let pattern = seg[like_pos + 8..seg.len() - 1].replace("''", "'");
                        let (op, inner) = if pattern.len() >= 2 && pattern.starts_with('%') && pattern.ends_with('%') {
                            (FilterOperator::Contains, pattern[1..pattern.len() - 1].to_string())
                        } else if pattern.ends_with('%') && !pattern.starts_with('%') {
                            (FilterOperator::StartsWith, pattern[..pattern.len() - 1].to_string())
                        } else if pattern.starts_with('%') && !pattern.ends_with('%') {
                            (FilterOperator::EndsWith, pattern[1..].to_string())
                        } else {
                            return None;
                        };
                        let cand = FilterRule::new(col, op, inner);
                        return verify_round_trip(&seg, col_raw, &cand, kind).then_some(cand);
                    }
                }
            }
        }
    }
    let mut sorted: Vec<&String> = columns.iter().collect();
    sorted.sort_by_key(|c| std::cmp::Reverse(c.len()));
    for c in sorted {
        if seg.len() < c.len() || !seg.is_char_boundary(c.len()) {
            continue;
        }
        let ref_raw = &seg[..c.len()];
        if !same_column_ref(ref_raw, c, kind) {
            continue;
        }
        let after = &seg[c.len()..];
        if !after.is_empty() && !after.starts_with(char::is_whitespace) {
            continue;
        }
        let rest = after.trim();
        let rest_upper = rest.to_uppercase();
        for (op_text, filter_op) in SQL_OPS {
            if !rest_upper.starts_with(op_text) {
                continue;
            }
            let after_op = &rest[op_text.len()..];
            let filter_op = filter_op?;
            if matches!(op_text, "LIKE" | "ILIKE" | "NOT LIKE") {
                return None;
            }
            let needs = filter_op.needs_value();
            if needs && after_op.trim().is_empty() {
                return None;
            }
            if !needs && !after_op.trim().is_empty() {
                return None;
            }
            if has_top_level_joiner(after_op) {
                return None;
            }
            let raw_value = after_op.trim();
            let strict = is_strict_quoted(raw_value);
            let was_quoted = raw_value.len() >= 2 && raw_value.starts_with('\'') && raw_value.ends_with('\'');
            if was_quoted && !strict {
                return None;
            }
            let unquoted = if strict { unquote_literal(raw_value) } else { raw_value.to_string() };
            if matches!(filter_op, FilterOperator::Eq | FilterOperator::Ne)
                && (if was_quoted { &unquoted } else { raw_value }).eq_ignore_ascii_case("null")
            {
                return None;
            }
            if needs {
                if strict {
                    if unquoted != unquoted.trim() || unquoted.is_empty() {
                        return None;
                    }
                    let u = unquoted.to_lowercase();
                    if u == "null" || u == "true" || u == "false" || is_number(&unquoted) {
                        return None;
                    }
                } else {
                    let u = raw_value.to_lowercase();
                    if !(u == "null" || u == "true" || u == "false" || is_number(raw_value)) {
                        return None;
                    }
                }
            }
            let cand = FilterRule::new(c.clone(), filter_op, if needs { unquote_literal(raw_value) } else { String::new() });
            return verify_round_trip(&seg, ref_raw, &cand, kind).then_some(cand);
        }
        return None;
    }
    // Quoted-identifier form: "col" = 'v'.
    let first = seg.chars().next()?;
    let close = match first {
        '"' => '"',
        '`' => '`',
        '[' => ']',
        _ => return None,
    };
    let end = seg[1..].find(close)? + 1;
    let col = find_column(columns, &seg[..=end], kind)?;
    parse_segment_to_rule(&format!("{col} {}", seg[end + 1..].trim()), columns, kind)
}

/// `decomposeFilterQuery`: visual rules + raw remainder.
pub fn decompose_filter_query(filter: &str, columns: &[String], kind: Kind) -> (Vec<FilterRule>, String) {
    let trimmed = strip_where_keyword(filter);
    let empty = FilterRule { enabled: true, column: "none".into(), operator: None, value: String::new() };
    if trimmed.is_empty() {
        return (vec![empty], String::new());
    }
    let mut rules = Vec::new();
    let mut leftovers = Vec::new();
    fn visit(text: &str, depth: u8, columns: &[String], kind: Kind, rules: &mut Vec<FilterRule>, leftovers: &mut Vec<String>) {
        if has_top_level_or(text) {
            let whole = text.trim();
            if let Some(r) = parse_segment_to_rule(whole, columns, kind) {
                rules.push(r);
                return;
            }
            let stripped = strip_balanced_outer_parens(whole);
            if depth < 3 && stripped != whole && !has_top_level_or(&stripped) {
                visit(&stripped, depth + 1, columns, kind, rules, leftovers);
                return;
            }
            leftovers.push(whole.to_string());
            return;
        }
        for part in split_top_level_and(text) {
            if let Some(r) = parse_segment_to_rule(&part, columns, kind) {
                rules.push(r);
                continue;
            }
            if depth < 3 {
                let stripped = strip_balanced_outer_parens(&part);
                if stripped != part.trim() {
                    let (rb, lb) = (rules.len(), leftovers.len());
                    visit(&stripped, depth + 1, columns, kind, rules, leftovers);
                    if rules.len() > rb && leftovers.len() == lb {
                        continue;
                    }
                    rules.truncate(rb);
                    leftovers.truncate(lb);
                }
            }
            leftovers.push(part.trim().to_string());
        }
    }
    visit(&trimmed, 0, columns, kind, &mut rules, &mut leftovers);
    let remainder = leftovers.join(" AND ");
    if rules.is_empty() {
        return (vec![empty], remainder);
    }
    (rules, remainder)
}

/// `handleApplyFilter`: visual clauses + `(remainder)`.
pub fn compose_filter(rules: &[FilterRule], custom_where: &str, kind: Kind) -> String {
    let mut clauses: Vec<String> = rules.iter().filter_map(|r| build_rule_clause(r, kind)).collect();
    let remainder = strip_balanced_outer_parens(custom_where.trim());
    if !remainder.is_empty() {
        clauses.push(format!("({remainder})"));
    }
    clauses.join(" AND ")
}

/// `activeFilterCount`.
pub fn active_filter_count(filter: &str, columns: &[String], kind: Kind) -> usize {
    if filter.trim().is_empty() {
        return 0;
    }
    let (rules, remainder) = decompose_filter_query(filter, columns, kind);
    rules.iter().filter(|r| is_real(r)).count() + usize::from(!remainder.trim().is_empty())
}

// ---- quick filters (data-table-toolbar.tsx) ----------------------------------------

pub const QUICK_FILTER_OPS: [&str; 8] = ["=", "!=", "<>", ">=", "<=", ">", "<", "~"];

fn quote_ident(kind: Kind, name: &str) -> String {
    kind.dialect().quote_ident(name)
}

/// `toQuickLiteral`.
pub fn to_quick_literal(raw: &str, kind: Kind) -> String {
    let t = raw.trim();
    if t.is_empty() {
        return "''".into();
    }
    let n = t.chars().count();
    if n >= 2 && ((t.starts_with('\'') && t.ends_with('\'')) || (t.starts_with('"') && t.ends_with('"'))) {
        let inner = &t[1..t.len() - 1];
        return format!("'{}'", inner.replace('\'', "''"));
    }
    let l = t.to_lowercase();
    if l == "null" {
        return "NULL".into();
    }
    if l == "true" {
        return if kind == Kind::MsSql { "1" } else { "TRUE" }.into();
    }
    if l == "false" {
        return if kind == Kind::MsSql { "0" } else { "FALSE" }.into();
    }
    if is_number(t) {
        return t.to_string();
    }
    format!("'{}'", t.replace('\'', "''"))
}

/// `joinFilterClause`.
pub fn join_filter_clause(existing: &str, clause: &str) -> String {
    let base = existing.trim();
    if base.is_empty() {
        clause.to_string()
    } else {
        format!("({base}) AND ({clause})")
    }
}

/// `matchColumnPrefix`: longest column that prefixes the text (case-insensitive).
pub fn match_column_prefix<'a>(text: &'a str, columns: &[String]) -> Option<(String, &'a str)> {
    let lower = text.to_lowercase();
    let mut best: Option<&String> = None;
    for c in columns {
        if !c.is_empty() && lower.starts_with(&c.to_lowercase()) && best.is_none_or(|b| c.len() > b.len()) {
            best = Some(c);
        }
    }
    let best = best?;
    text.get(best.len()..).map(|rest| (best.clone(), rest))
}

/// `parseQuickFilter`: `column op value` / `column IS [NOT] NULL`.
pub fn parse_quick_filter(text: &str, columns: &[String], kind: Kind) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (col, rest) = match_column_prefix(trimmed, columns)?;
    if rest.is_empty() || !rest.starts_with(char::is_whitespace) {
        return None;
    }
    let column = quote_ident(kind, &col);
    let rest = rest.trim();
    if rest.is_empty() {
        return None;
    }
    let lr = rest.to_lowercase();
    let words: Vec<&str> = lr.split_whitespace().collect();
    if words == ["is", "null"] {
        return Some(format!("{column} IS NULL"));
    }
    if words == ["is", "not", "null"] {
        return Some(format!("{column} IS NOT NULL"));
    }
    let op = [">=", "<=", "!=", "<>", "=", ">", "<", "~"].into_iter().find(|op| rest.starts_with(op))?;
    let raw_value = rest[op.len()..].trim_start();
    if raw_value.trim().is_empty() {
        return None;
    }
    if op == "~" {
        let mut p = raw_value.trim().to_string();
        if p.len() >= 2 && ((p.starts_with('\'') && p.ends_with('\'')) || (p.starts_with('"') && p.ends_with('"'))) {
            p = p[1..p.len() - 1].to_string();
        }
        let p = p.replace('\'', "''");
        let like = format!("LIKE '%{p}%'");
        let target = match kind {
            Kind::MsSql => "NVARCHAR(MAX)",
            Kind::MySql => "CHAR",
            Kind::ClickHouse => "String",
            _ => "TEXT",
        };
        return Some(format!("CAST({column} AS {target}) {like}"));
    }
    let sql_op = if op == "!=" { "<>" } else { op };
    Some(format!("{column} {sql_op} {}", to_quick_literal(raw_value, kind)))
}

/// Filter-box suggestions (`suggestItems`): columns, then operators.
#[derive(Debug, Clone, PartialEq)]
pub struct Suggestion {
    pub is_column: bool,
    pub label: String,
    pub apply: String,
}

pub fn quick_suggestions(text: &str, columns: &[String]) -> Vec<Suggestion> {
    let col = |c: &String| Suggestion { is_column: true, label: c.clone(), apply: format!("{c} ") };
    if text.trim().is_empty() {
        return columns.iter().take(8).map(col).collect();
    }
    let ops = |column: &str, filter: &dyn Fn(&str) -> bool| {
        QUICK_FILTER_OPS
            .iter()
            .filter(|op| filter(op))
            .map(|op| Suggestion {
                is_column: false,
                label: if *op == "~" { "~ contains".into() } else { op.to_string() },
                apply: format!("{column} {op} "),
            })
            .collect::<Vec<_>>()
    };
    match match_column_prefix(text.trim(), columns) {
        Some((c, rest)) if !rest.is_empty() && rest.starts_with(char::is_whitespace) => {
            let op_part = rest.trim();
            if op_part.is_empty() {
                ops(&c, &|_| true)
            } else if QUICK_FILTER_OPS.contains(&op_part) {
                Vec::new()
            } else {
                ops(&c, &|op| op.starts_with(op_part))
            }
        }
        _ => {
            let lower = text.to_lowercase();
            columns.iter().filter(|c| c.to_lowercase().starts_with(&lower)).take(8).map(col).collect()
        }
    }
}

/// `buildWholeTableSearchClause`.
pub fn whole_table_search_clause(query: &str, fields: &[String], kind: Kind) -> String {
    let term = query.trim();
    if term.is_empty() || fields.is_empty() {
        return String::new();
    }
    let escaped = term.replace('!', "!!").replace('%', "!%").replace('_', "!_").replace('\'', "''");
    let pattern = format!("'%{escaped}%'");
    let preds: Vec<String> = fields
        .iter()
        .map(|f| {
            let q = quote_ident(kind, f);
            match kind {
                Kind::Postgres | Kind::SupabaseMgmt => format!("CAST({q} AS TEXT) ILIKE {pattern} ESCAPE '!'"),
                Kind::MySql => format!("LOWER(CAST({q} AS CHAR)) LIKE LOWER({pattern}) ESCAPE '!'"),
                Kind::ClickHouse => format!("LOWER(CAST({q} AS String)) LIKE LOWER({pattern}) ESCAPE '!'"),
                Kind::MsSql => format!("LOWER(CAST({q} AS NVARCHAR(MAX))) LIKE LOWER({pattern})"),
                _ => format!("LOWER(CAST({q} AS TEXT)) LIKE LOWER({pattern}) ESCAPE '!'"),
            }
        })
        .collect();
    format!("({})", preds.join(" OR "))
}

/// `combineFilters`.
pub fn combine_filters(base: &str, query: &str, fields: &[String], kind: Kind) -> String {
    let search = whole_table_search_clause(query, fields, kind);
    if search.is_empty() {
        return base.to_string();
    }
    if base.trim().is_empty() {
        return search;
    }
    format!("({base}) AND {search}")
}

/// `handleFilterByCell` / `serializeFilterValue`. `value` is the grid value;
/// `number`/`bool` say whether the JS value was a number / boolean.
pub fn filter_by_value(column: &str, value: Option<&str>, number: bool, boolean: bool, kind: Kind) -> String {
    let q = quote_ident(kind, column);
    match value {
        None => format!("{q} IS NULL"),
        Some(v) if boolean && (v == "true" || v == "false") => {
            if kind == Kind::MsSql {
                format!("{q} = {}", if v == "true" { 1 } else { 0 })
            } else {
                format!("{q} = {}", v.to_uppercase())
            }
        }
        Some(v) if number && v.parse::<f64>().is_ok_and(f64::is_finite) => format!("{q} = {v}"),
        Some(v) => format!("{q} = '{}'", v.replace('\'', "''")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cols() -> Vec<String> {
        ["id", "name", "status", "created_at"].iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn decomposes_builder_output() {
        let f = r#""name" = 'bob' AND CAST("status" AS TEXT) LIKE '%pa%' AND (revenue > 100 OR id = 2)"#;
        let (rules, rest) = decompose_filter_query(f, &cols(), Kind::Postgres);
        assert_eq!(rules.len(), 2);
        assert_eq!(rules[0], FilterRule::new("name", FilterOperator::Eq, "bob"));
        assert_eq!(rules[1].operator, Some(FilterOperator::Contains));
        assert_eq!(rest, "(revenue > 100 OR id = 2)");
        assert_eq!(compose_filter(&rules, &rest, Kind::Postgres), r#""name" = 'bob' AND CAST("status" AS TEXT) LIKE '%pa%' AND (revenue > 100 OR id = 2)"#);
        // Bare words and functions stay raw.
        let (rules, rest) = decompose_filter_query("status = active", &cols(), Kind::Postgres);
        assert!(!is_real(&rules[0]));
        assert_eq!(rest, "status = active");
        assert_eq!(active_filter_count("id = 1 AND status IS NULL", &cols(), Kind::Postgres), 2);
    }

    #[test]
    fn quick_filters() {
        assert_eq!(parse_quick_filter("id >= 3", &cols(), Kind::Postgres).unwrap(), r#""id" >= 3"#);
        assert_eq!(parse_quick_filter("name != bob", &cols(), Kind::Postgres).unwrap(), r#""name" <> 'bob'"#);
        assert_eq!(parse_quick_filter("name ~ o'b", &cols(), Kind::MySql).unwrap(), "CAST(`name` AS CHAR) LIKE '%o''b%'");
        assert_eq!(parse_quick_filter("status is not null", &cols(), Kind::Postgres).unwrap(), r#""status" IS NOT NULL"#);
        assert_eq!(parse_quick_filter("name", &cols(), Kind::Postgres), None);
        assert_eq!(join_filter_clause("a = 1", "b = 2"), "(a = 1) AND (b = 2)");
        // Like the original, the trimmed text loses the trailing space, so "name " suggests nothing.
        assert_eq!(quick_suggestions("name ", &cols()).len(), 0);
        assert_eq!(quick_suggestions("name !", &cols())[0].apply, "name != ");
        assert_eq!(quick_suggestions("na", &cols())[0].apply, "name ");
    }

    #[test]
    fn search_and_cell_filters() {
        assert_eq!(
            whole_table_search_clause("a_b", &["x".into()], Kind::Postgres),
            r#"(CAST("x" AS TEXT) ILIKE '%a!_b%' ESCAPE '!')"#
        );
        assert_eq!(filter_by_value("n", Some("3"), true, false, Kind::Postgres), r#""n" = 3"#);
        assert_eq!(filter_by_value("n", None, false, false, Kind::Postgres), r#""n" IS NULL"#);
        assert_eq!(filter_by_value("b", Some("true"), false, true, Kind::Postgres), r#""b" = TRUE"#);
        assert_eq!(strip_where_keyword("WHERE id = 1"), "id = 1");
        assert_eq!(strip_where_keyword("SELECT * FROM t WHERE id = 1"), "id = 1");
    }
}
