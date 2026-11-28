//! Port of `handleFormat` (components/studio/sql-editor.tsx).
//!
//! Approximation: the original runs the `sql-formatter` npm package with the
//! user's `sqlFormat*` settings; we use the `sqlformat` crate (a port of an
//! earlier sql-formatter), which honours tab width / tabs, keyword case and
//! lines between queries. Data-type / function / identifier case, logical
//! operator placement, expression width, dense operators and newline before
//! semicolon are not configurable there and keep sqlformat's defaults
//! (which match sql-formatter's defaults for those options).

use serde_json::Value;

#[derive(Clone, Debug)]
pub struct FormatSettings {
    pub tab_width: u8,
    pub use_tabs: bool,
    /// "upper" | "lower" | "preserve"
    pub keyword_case: String,
    pub lines_between_queries: u8,
}

impl Default for FormatSettings {
    fn default() -> Self {
        FormatSettings { tab_width: 2, use_tabs: false, keyword_case: "upper".into(), lines_between_queries: 2 }
    }
}

impl FormatSettings {
    /// From the `studio_settings` JSON (`sqlFormat*` keys).
    pub fn from_studio(studio: &Value) -> Self {
        let d = FormatSettings::default();
        FormatSettings {
            tab_width: studio["sqlFormatTabWidth"].as_u64().map_or(d.tab_width, |v| v.min(16) as u8),
            use_tabs: studio["sqlFormatUseTabs"].as_bool().unwrap_or(d.use_tabs),
            keyword_case: studio["sqlFormatKeywordCase"].as_str().unwrap_or(&d.keyword_case).to_string(),
            lines_between_queries: studio["sqlFormatLinesBetweenQueries"].as_u64().map_or(d.lines_between_queries, |v| v.min(10) as u8),
        }
    }
}

/// Format `query` for `db_type`; `None` when it can't be formatted (the
/// original logs the error and leaves the text alone).
pub fn format_query(query: &str, db_type: &str, s: &FormatSettings) -> Option<String> {
    match db_type {
        "mongodb" => {
            let t = query.trim();
            if t.starts_with('{') || t.starts_with('[') {
                let v: Value = serde_json::from_str(query).ok()?;
                serde_json::to_string_pretty(&v).ok()
            } else {
                None
            }
        }
        "redis" => Some(query.to_string()),
        _ => {
            let options = sqlformat::FormatOptions {
                indent: if s.use_tabs { sqlformat::Indent::Tabs } else { sqlformat::Indent::Spaces(s.tab_width) },
                uppercase: match s.keyword_case.as_str() {
                    "upper" => Some(true),
                    "lower" => Some(false),
                    _ => None,
                },
                // sql-formatter's `linesBetweenQueries` counts blank lines + 1.
                lines_between_queries: s.lines_between_queries.max(1),
                ignore_case_convert: None,
            };
            Some(sqlformat::format(query, &sqlformat::QueryParams::None, &options))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_sql() {
        let out = format_query("select id, name from users where a = 1", "postgres", &FormatSettings::default()).unwrap();
        assert_eq!(out, "SELECT\n  id,\n  name\nFROM\n  users\nWHERE\n  a = 1");
        assert_eq!(format_query("{\"a\":1}", "mongodb", &FormatSettings::default()).unwrap(), "{\n  \"a\": 1\n}");
    }
}
