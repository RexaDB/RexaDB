//! SQL script splitting for engines without native multi-statement support
//! (and for per-statement results). Semicolons inside strings, quoted
//! identifiers, comments, Postgres dollar quotes and `BEGIN … END` bodies of
//! `CREATE TRIGGER/FUNCTION/PROCEDURE` don't split.

use crate::Dialect;

/// Split `sql` into trimmed statements (without the trailing `;`). Empty
/// statements and comment-only fragments are dropped.
pub fn split_statements(sql: &str, dialect: Dialect) -> Vec<String> {
    if !dialect.is_sql() {
        let t = sql.trim();
        return if t.is_empty() { Vec::new() } else { vec![t.to_string()] };
    }
    let b = sql.as_bytes();
    let mut out = Vec::new();
    let mut start = 0;
    let mut i = 0;
    let mut block_depth = 0i32;
    let mut word_start: Option<usize> = None;
    let mut stmt_is_routine: Option<bool> = None;
    let flush_word = |ws: &mut Option<usize>, end: usize, depth: &mut i32, routine: &mut Option<bool>, start: usize| {
        if let Some(s) = ws.take() {
            let w = &sql[s..end];
            if routine.is_none() {
                let head = sql[start..end].trim_start().to_ascii_uppercase();
                if head.split_whitespace().count() >= 2 || head.len() > 20 {
                    let words: Vec<&str> = head.split_whitespace().collect();
                    let is_routine = words.first() == Some(&"CREATE")
                        && words.iter().skip(1).take(4).any(|w| matches!(*w, "TRIGGER" | "PROCEDURE" | "FUNCTION" | "PACKAGE"));
                    *routine = Some(is_routine);
                }
            }
            if *routine == Some(true) {
                if w.eq_ignore_ascii_case("BEGIN") || w.eq_ignore_ascii_case("CASE") {
                    *depth += 1;
                } else if w.eq_ignore_ascii_case("END") && *depth > 0 {
                    *depth -= 1;
                }
            }
        }
    };
    while i < b.len() {
        let c = b[i];
        if c.is_ascii_alphanumeric() || c == b'_' {
            if word_start.is_none() {
                word_start = Some(i);
            }
            i += 1;
            continue;
        }
        flush_word(&mut word_start, i, &mut block_depth, &mut stmt_is_routine, start);
        match c {
            b'-' if b.get(i + 1) == Some(&b'-') => {
                i = sql[i..].find('\n').map_or(b.len(), |p| i + p);
            }
            b'#' if dialect == Dialect::MySql => {
                i = sql[i..].find('\n').map_or(b.len(), |p| i + p);
            }
            b'/' if b.get(i + 1) == Some(&b'*') => {
                i = sql[i + 2..].find("*/").map_or(b.len(), |p| i + 2 + p + 2);
            }
            b'\'' | b'"' | b'`' => {
                let q = c;
                let mut j = i + 1;
                while j < b.len() {
                    if b[j] == b'\\' && matches!(dialect, Dialect::MySql | Dialect::ClickHouse) {
                        j += 2;
                        continue;
                    }
                    if b[j] == q {
                        if b.get(j + 1) == Some(&q) {
                            j += 2;
                            continue;
                        }
                        break;
                    }
                    j += 1;
                }
                i = (j + 1).min(b.len());
            }
            b'[' if dialect == Dialect::MsSql => {
                i = sql[i..].find(']').map_or(b.len(), |p| i + p + 1);
            }
            b'$' if matches!(dialect, Dialect::Postgres | Dialect::DuckDb) => {
                let rest = &sql[i..];
                let tag_len = {
                    let rb = rest.as_bytes();
                    if rb.get(1) == Some(&b'$') {
                        Some(2)
                    } else if rb.get(1).is_some_and(|x| x.is_ascii_alphabetic() || *x == b'_') {
                        let mut j = 2;
                        while j < rb.len() && (rb[j].is_ascii_alphanumeric() || rb[j] == b'_') {
                            j += 1;
                        }
                        (rb.get(j) == Some(&b'$')).then_some(j + 1)
                    } else {
                        None
                    }
                };
                match tag_len {
                    Some(n) => {
                        let tag = &rest[..n];
                        i = rest[n..].find(tag).map_or(b.len(), |p| i + n + p + n);
                    }
                    None => i += 1,
                }
            }
            b';' if block_depth == 0 => {
                push(&mut out, &sql[start..i]);
                i += 1;
                start = i;
                stmt_is_routine = None;
            }
            _ => i += 1,
        }
    }
    flush_word(&mut word_start, b.len(), &mut block_depth, &mut stmt_is_routine, start);
    push(&mut out, &sql[start..]);
    out
}

fn push(out: &mut Vec<String>, s: &str) {
    let t = s.trim();
    if t.is_empty() || is_comment_only(t) {
        return;
    }
    out.push(t.to_string());
}

fn is_comment_only(s: &str) -> bool {
    let mut rest = s.trim();
    loop {
        if rest.is_empty() {
            return true;
        }
        if let Some(r) = rest.strip_prefix("--") {
            rest = r.find('\n').map_or("", |p| &r[p..]).trim();
        } else if let Some(r) = rest.strip_prefix("/*") {
            rest = r.find("*/").map_or("", |p| &r[p + 2..]).trim();
        } else {
            return false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_respecting_literals() {
        let s = "SELECT 'a;b'; -- c;\nSELECT \"x;\" FROM t; /* ; */ SELECT $$;$$; SELECT $f$ ; $f$";
        assert_eq!(
            split_statements(s, Dialect::Postgres),
            vec!["SELECT 'a;b'", "-- c;\nSELECT \"x;\" FROM t", "/* ; */ SELECT $$;$$", "SELECT $f$ ; $f$"]
        );
        assert_eq!(split_statements("  ;; -- only\n", Dialect::Postgres), Vec::<String>::new());
    }

    #[test]
    fn keeps_trigger_bodies() {
        let s = "CREATE TRIGGER tr AFTER INSERT ON t BEGIN UPDATE x SET a = 1; END; SELECT 1";
        assert_eq!(
            split_statements(s, Dialect::Sqlite),
            vec!["CREATE TRIGGER tr AFTER INSERT ON t BEGIN UPDATE x SET a = 1; END", "SELECT 1"]
        );
        // plain BEGIN transactions still split
        assert_eq!(split_statements("BEGIN; SELECT 1; COMMIT", Dialect::Sqlite).len(), 3);
    }
}
