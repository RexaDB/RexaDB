//! Parameter / edit values and literal inlining.
//!
//! The grid edits text; [`Value::Text`] is rendered as a quoted string
//! literal, which every SQL engine coerces to the column type (Postgres
//! untyped literals, MySQL/SQLite/MSSQL implicit conversion). Use
//! [`Value::from_cell_typed`] when the column type is known so numbers and
//! booleans go out unquoted (needed by ClickHouse and Trino).

use crate::{Cell, Dialect, TypeCategory};

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Text(String),
    Bytes(Vec<u8>),
    Json(serde_json::Value),
    /// Raw SQL expression inserted verbatim (`DEFAULT`, `now()`). Never put
    /// user input here.
    Raw(String),
}

impl Value {
    /// Text from the grid, typed by the column category: numbers/booleans
    /// that parse become [`Value::Int`]/[`Value::Float`]/[`Value::Bool`],
    /// everything else stays text.
    pub fn from_text_typed(text: &str, category: TypeCategory) -> Value {
        let t = text.trim();
        match category {
            TypeCategory::Integer => t.parse().map(Value::Int).unwrap_or_else(|_| Value::Text(text.to_string())),
            TypeCategory::Decimal => {
                if t.parse::<f64>().is_ok() {
                    Value::Raw(t.to_string())
                } else {
                    Value::Text(text.to_string())
                }
            }
            TypeCategory::Boolean => match t.to_ascii_lowercase().as_str() {
                "true" | "t" | "1" | "yes" | "y" | "on" => Value::Bool(true),
                "false" | "f" | "0" | "no" | "n" | "off" => Value::Bool(false),
                _ => Value::Text(text.to_string()),
            },
            _ => Value::Text(text.to_string()),
        }
    }

    pub fn from_cell_typed(cell: &Cell, category: TypeCategory) -> Value {
        match cell {
            Cell::Null => Value::Null,
            Cell::Text(s) => Value::from_text_typed(s, category),
        }
    }

    pub fn is_null(&self) -> bool {
        matches!(self, Value::Null)
    }

    /// Plain text form (for HTTP engines that take JSON params).
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Value::Null => serde_json::Value::Null,
            Value::Bool(b) => (*b).into(),
            Value::Int(i) => (*i).into(),
            Value::Float(f) => serde_json::Number::from_f64(*f).map_or(serde_json::Value::Null, serde_json::Value::Number),
            Value::Text(s) | Value::Raw(s) => s.clone().into(),
            Value::Bytes(b) => b.iter().map(|x| format!("{x:02x}")).collect::<String>().into(),
            Value::Json(j) => j.clone(),
        }
    }
}

impl From<&Cell> for Value {
    fn from(c: &Cell) -> Self {
        match c {
            Cell::Null => Value::Null,
            Cell::Text(s) => Value::Text(s.clone()),
        }
    }
}
impl From<&str> for Value {
    fn from(s: &str) -> Self {
        Value::Text(s.to_string())
    }
}
impl From<String> for Value {
    fn from(s: String) -> Self {
        Value::Text(s)
    }
}
impl From<i64> for Value {
    fn from(i: i64) -> Self {
        Value::Int(i)
    }
}
impl From<bool> for Value {
    fn from(b: bool) -> Self {
        Value::Bool(b)
    }
}
impl From<f64> for Value {
    fn from(f: f64) -> Self {
        Value::Float(f)
    }
}
impl<T: Into<Value>> From<Option<T>> for Value {
    fn from(o: Option<T>) -> Self {
        o.map_or(Value::Null, Into::into)
    }
}

/// Replace `$n` and `?` placeholders outside strings, quoted identifiers,
/// comments and dollar-quoted blocks with literals (single pass — inserted
/// values are never re-scanned). Port of `inlineMgmtParams` generalised to
/// `?` placeholders.
pub fn inline_params(sql: &str, params: &[Value], dialect: Dialect) -> String {
    if params.is_empty() {
        return sql.to_string();
    }
    let lits: Vec<String> = params.iter().map(|p| dialect.literal(p)).collect();
    let b = sql.as_bytes();
    let mut out = String::with_capacity(sql.len() + 16);
    let mut i = 0;
    let mut qmark = 0usize;
    let mut last = 0;
    while i < b.len() {
        let c = b[i];
        let skip_to = |out: &mut String, last: &mut usize, end: usize| {
            out.push_str(&sql[*last..end]);
            *last = end;
        };
        if c == b'-' && b.get(i + 1) == Some(&b'-') {
            let end = sql[i..].find('\n').map_or(b.len(), |p| i + p);
            skip_to(&mut out, &mut last, end);
            i = end;
            continue;
        }
        if c == b'/' && b.get(i + 1) == Some(&b'*') {
            let end = sql[i + 2..].find("*/").map_or(b.len(), |p| i + 2 + p + 2);
            skip_to(&mut out, &mut last, end);
            i = end;
            continue;
        }
        if c == b'\'' || c == b'"' || c == b'`' {
            let mut j = i + 1;
            while j < b.len() {
                if b[j] == c {
                    if b.get(j + 1) == Some(&c) {
                        j += 2;
                        continue;
                    }
                    j += 1;
                    break;
                }
                if b[j] == b'\\' && dialect == Dialect::MySql {
                    j += 2;
                    continue;
                }
                j += 1;
            }
            let j = j.min(b.len());
            skip_to(&mut out, &mut last, j);
            i = j;
            continue;
        }
        if c == b'$' {
            // $tag$ … $tag$
            let rest = &sql[i..];
            if let Some(tag_len) = dollar_tag_len(rest) {
                let tag = &rest[..tag_len];
                let end = rest[tag_len..].find(tag).map_or(b.len(), |p| i + tag_len + p + tag_len);
                skip_to(&mut out, &mut last, end);
                i = end;
                continue;
            }
            let digits = rest[1..].bytes().take_while(u8::is_ascii_digit).count();
            if digits > 0 {
                let n: usize = rest[1..1 + digits].parse().unwrap_or(0);
                if n >= 1 && n <= lits.len() {
                    out.push_str(&sql[last..i]);
                    out.push_str(&lits[n - 1]);
                    i += 1 + digits;
                    last = i;
                    continue;
                }
            }
        }
        if c == b'?' && qmark < lits.len() {
            out.push_str(&sql[last..i]);
            out.push_str(&lits[qmark]);
            qmark += 1;
            i += 1;
            last = i;
            continue;
        }
        i += 1;
    }
    out.push_str(&sql[last..]);
    out
}

fn dollar_tag_len(s: &str) -> Option<usize> {
    let b = s.as_bytes();
    if b.get(1) == Some(&b'$') {
        return Some(2);
    }
    let first = *b.get(1)?;
    if !(first.is_ascii_alphabetic() || first == b'_') {
        return None;
    }
    let mut j = 2;
    while j < b.len() && (b[j].is_ascii_alphanumeric() || b[j] == b'_') {
        j += 1;
    }
    (b.get(j) == Some(&b'$')).then_some(j + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inlines_outside_literals() {
        let sql = "SELECT '$1', \"?\", $$ $1 $$, $1, ? -- $2\n";
        let out = inline_params(sql, &[Value::Text("it's".into()), Value::Int(3)], Dialect::Postgres);
        assert_eq!(out, "SELECT '$1', \"?\", $$ $1 $$, 'it''s', 'it''s' -- $2\n");
        assert_eq!(inline_params("a = ? AND b = ?", &[Value::Null, Value::Bool(true)], Dialect::MySql), "a = NULL AND b = TRUE");
    }

    #[test]
    fn typed_from_text() {
        assert_eq!(Value::from_text_typed("12", TypeCategory::Integer), Value::Int(12));
        assert_eq!(Value::from_text_typed("x", TypeCategory::Integer), Value::Text("x".into()));
        assert_eq!(Value::from_text_typed("t", TypeCategory::Boolean), Value::Bool(true));
        assert_eq!(Value::from_text_typed("1.5", TypeCategory::Decimal), Value::Raw("1.5".into()));
    }
}
