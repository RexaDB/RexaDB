//! Name-addressable rows over a [`QueryResult`] (the original works with
//! `row.column_name` objects; this is the equivalent for catalog code).

use crate::{Cell, QueryResult};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct Record {
    columns: Arc<Vec<String>>,
    cells: Vec<Cell>,
}

pub(crate) fn records(r: &QueryResult) -> Vec<Record> {
    let columns = Arc::new(r.columns.clone());
    r.rows.iter().map(|row| Record { columns: columns.clone(), cells: row.clone() }).collect()
}

impl Record {
    pub fn new(columns: Vec<String>, cells: Vec<Cell>) -> Self {
        Record { columns: Arc::new(columns), cells }
    }

    pub fn columns(&self) -> &[String] {
        &self.columns
    }

    pub fn cells(&self) -> &[Cell] {
        &self.cells
    }

    /// Cell by column name (case-insensitive fallback, like the original's
    /// `row.x ?? row.X`).
    pub fn cell(&self, name: &str) -> Option<&Cell> {
        let i = self
            .columns
            .iter()
            .position(|c| c == name)
            .or_else(|| self.columns.iter().position(|c| c.eq_ignore_ascii_case(name)))?;
        self.cells.get(i)
    }

    /// Non-null text.
    pub fn get(&self, name: &str) -> Option<&str> {
        self.cell(name).and_then(Cell::as_str)
    }

    pub fn string(&self, name: &str) -> String {
        self.get(name).unwrap_or_default().to_string()
    }

    pub fn opt(&self, name: &str) -> Option<String> {
        self.get(name).map(str::to_string)
    }

    /// Non-empty text.
    pub fn non_empty(&self, name: &str) -> Option<String> {
        self.get(name).filter(|s| !s.is_empty()).map(str::to_string)
    }

    /// `t`/`true`/`1`/`YES`/`Y` → true.
    pub fn bool(&self, name: &str) -> bool {
        self.get(name).is_some_and(parse_bool)
    }

    pub fn opt_bool(&self, name: &str) -> Option<bool> {
        self.get(name).map(parse_bool)
    }

    pub fn i64(&self, name: &str) -> Option<i64> {
        let s = self.get(name)?.trim();
        s.parse::<i64>().ok().or_else(|| s.parse::<f64>().ok().map(|f| f as i64))
    }

    /// Postgres text array (`{a,b}`) or comma list → items.
    pub fn list(&self, name: &str) -> Vec<String> {
        self.get(name).map(parse_list).unwrap_or_default()
    }
}

pub(crate) fn parse_bool(s: &str) -> bool {
    matches!(s.trim().to_ascii_lowercase().as_str(), "t" | "true" | "1" | "yes" | "y" | "on")
}

/// Parse a Postgres array literal `{a,"b c"}` or a JSON array / comma list.
pub(crate) fn parse_list(s: &str) -> Vec<String> {
    let t = s.trim();
    if let Some(inner) = t.strip_prefix('{').and_then(|x| x.strip_suffix('}')) {
        let mut out = Vec::new();
        let mut cur = String::new();
        let mut quoted = false;
        let mut chars = inner.chars().peekable();
        while let Some(c) = chars.next() {
            match c {
                '"' => quoted = !quoted,
                '\\' if quoted => {
                    if let Some(n) = chars.next() {
                        cur.push(n);
                    }
                }
                ',' if !quoted => out.push(std::mem::take(&mut cur)),
                _ => cur.push(c),
            }
        }
        if !inner.is_empty() {
            out.push(cur);
        }
        return out;
    }
    if t.starts_with('[') {
        if let Ok(v) = serde_json::from_str::<Vec<serde_json::Value>>(t) {
            return v.into_iter().map(|x| x.as_str().map(str::to_string).unwrap_or_else(|| x.to_string())).collect();
        }
    }
    t.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn lists() {
        assert_eq!(super::parse_list("{public,\"a b\"}"), vec!["public", "a b"]);
        assert_eq!(super::parse_list("{}"), Vec::<String>::new());
        assert_eq!(super::parse_list("[\"x\",\"y\"]"), vec!["x", "y"]);
    }
}
