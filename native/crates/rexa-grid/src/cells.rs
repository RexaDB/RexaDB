//! Port of @rexadbapp/data-table `src/grid/cell-content.ts`, `columns.ts` and
//! `header-icons.ts#typeIconKey`, plus the value serialization the original
//! sidecar applies before the grid sees a row (`lib/db/pg-client.ts#serializeValue`,
//! node-pg / mysql2 type parsers): booleans become `true`/`false`, dates
//! become `Date#toISOString()`, JSON is re-serialized compactly
//! (`JSON.stringify`), Postgres arrays become JSON arrays and `bytea` becomes
//! bare hex. The native drivers return server text, so this module rebuilds
//! exactly what the old grid displayed and copied.

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use rexa_drivers::{Cell, ColumnMeta, Kind, TypeCategory};

/// `classifyColumnType`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TypeClass {
    pub is_date: bool,
    pub is_boolean: bool,
    pub is_numeric: bool,
}

pub fn classify_column_type(column_type: &str) -> TypeClass {
    let t = column_type.to_lowercase();
    TypeClass {
        is_date: t.contains("timestamp") || t.contains("date"),
        is_boolean: t == "boolean" || t == "bool" || t.contains("bool"),
        is_numeric: t.contains("int") || t.contains("float") || t.contains("decimal") || t.contains("numeric"),
    }
}

/// `getSortLabels` (legacy grid-header.tsx).
pub fn sort_labels(data_type: &str) -> (&'static str, &'static str) {
    let t = data_type.to_lowercase();
    if ["int", "decimal", "numeric", "real", "double", "serial"].iter().any(|k| t.contains(k)) {
        ("Less to more", "More to less")
    } else if t.contains("date") || t.contains("time") || t.contains("timestamp") {
        ("Oldest first", "Newest first")
    } else if t.contains("bool") {
        ("False first", "True first")
    } else {
        ("A - Z", "Z - A")
    }
}

/// Header type icons (`header-icons.ts`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypeIcon {
    Text,
    Number,
    Date,
    Boolean,
    Uuid,
    Json,
}

impl TypeIcon {
    /// Lucide asset path of the sprite (`TYPE_INNER`, `HASH_INNER`, …).
    pub fn path(self) -> &'static str {
        match self {
            TypeIcon::Text => "icons/type.svg",
            TypeIcon::Number => "icons/hash.svg",
            TypeIcon::Date => "icons/calendar.svg",
            TypeIcon::Boolean => "icons/square-check-big.svg",
            TypeIcon::Uuid => "icons/database.svg",
            TypeIcon::Json => "icons/list.svg",
        }
    }
}

/// `typeIconKey`.
pub fn type_icon(data_type: &str) -> TypeIcon {
    let t = data_type.to_lowercase();
    if t.contains("int") || t.contains("float") || t.contains("decimal") || t.contains("numeric") {
        TypeIcon::Number
    } else if t.contains("date") || t.contains("time") {
        TypeIcon::Date
    } else if t.contains("bool") {
        TypeIcon::Boolean
    } else if t.contains("uuid") {
        TypeIcon::Uuid
    } else if t.contains("json") {
        TypeIcon::Json
    } else {
        TypeIcon::Text
    }
}

const CHAR_WIDTH: f32 = 7.5;
const MIN_WIDTH: f32 = 150.;
const MAX_WIDTH: f32 = 600.;
const CELL_PADDING: f32 = 20.;
const HEADER_ICON_SPACE: f32 = 24.;

/// `computeAutoColumnWidths` for one column: header + the longest of the first 1000 values.
pub fn auto_column_width<'a>(name: &str, is_pk: bool, is_fk: bool, values: impl Iterator<Item = Option<&'a str>>) -> f32 {
    let mut header = name.chars().count() as f32 * CHAR_WIDTH + HEADER_ICON_SPACE;
    if is_pk {
        header += 12.;
    }
    if is_fk {
        header += 12.;
    }
    let mut max_len = (header / CHAR_WIDTH).ceil() as usize;
    for v in values.take(1000).flatten() {
        // JS `String(val).length` counts UTF-16 units.
        let len = v.encode_utf16().count();
        max_len = max_len.max(len);
    }
    (max_len as f32 * CHAR_WIDTH + CELL_PADDING).clamp(MIN_WIDTH, MAX_WIDTH)
}

/// `detectArabicScript`.
pub fn is_arabic(text: &str) -> bool {
    text.chars().any(|c| matches!(c as u32, 0x0600..=0x06FF | 0x0750..=0x077F | 0x08A0..=0x08FF))
}

/// `detectJsonInfo` (only with `richJsonInspector`): `[Array]` / `[Object]` badge.
pub fn json_badge(display: &str) -> Option<&'static str> {
    let t = display.trim();
    if t.len() < 2 {
        return None;
    }
    let kind = if t.starts_with('{') && t.ends_with('}') {
        "Object"
    } else if t.starts_with('[') && t.ends_with(']') {
        "Array"
    } else {
        return None;
    };
    serde_json::from_str::<serde_json::Value>(t).ok().filter(|v| v.is_object() || v.is_array()).map(|_| kind)
}

/// `formatDistanceToNow(date, { addSuffix: true })` (date-fns), for `relativeDates`.
pub fn relative_date_label(value: &str) -> Option<String> {
    let date = parse_iso(value)?;
    let now = Utc::now();
    let secs = (now - date).num_seconds();
    let future = secs < 0;
    let s = secs.unsigned_abs() as f64;
    let mins = (s / 60.).round();
    let text = if s < 30. {
        "less than a minute".to_string()
    } else if mins < 2. {
        "1 minute".into()
    } else if mins < 45. {
        format!("{mins} minutes")
    } else if mins < 90. {
        "about 1 hour".into()
    } else if mins < 1440. {
        format!("about {} hours", (mins / 60.).round())
    } else if mins < 2520. {
        "1 day".into()
    } else if mins < 43200. {
        format!("{} days", (mins / 1440.).round())
    } else if mins < 86400. {
        format!("about {} months", (mins / 43200.).round().max(1.))
    } else if mins < 525600. {
        format!("{} months", (mins / 43200.).round())
    } else {
        let years = s / 31_536_000.;
        let whole = years.floor();
        let rem = years - whole;
        if rem < 0.25 {
            format!("about {whole} year{}", if whole == 1. { "" } else { "s" })
        } else if rem < 0.75 {
            format!("over {whole} year{}", if whole == 1. { "" } else { "s" })
        } else {
            format!("almost {} years", whole + 1.)
        }
    };
    Some(if future { format!("in {text}") } else { format!("{text} ago") })
}

fn parse_iso(value: &str) -> Option<DateTime<Utc>> {
    let v = value.trim();
    if let Ok(d) = DateTime::parse_from_rfc3339(v) {
        return Some(d.with_timezone(&Utc));
    }
    if let Ok(d) = NaiveDateTime::parse_from_str(v, "%Y-%m-%dT%H:%M:%S%.f") {
        return Local.from_local_datetime(&d).single().map(|d| d.with_timezone(&Utc));
    }
    if let Ok(d) = NaiveDate::parse_from_str(v, "%Y-%m-%d") {
        // parseISO treats a bare date as local midnight.
        return Local.from_local_datetime(&d.and_hms_opt(0, 0, 0)?).single().map(|d| d.with_timezone(&Utc));
    }
    None
}

// ---- value serialization -----------------------------------------------------------

/// How the original's sidecar turned a server value into what the grid holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueShape {
    Plain,
    Bool,
    Json,
    /// Postgres array literal → JSON array; elements typed by `ArrayElem`.
    Array(ArrayElem),
    Bytes,
    /// timestamptz: an instant.
    Instant,
    /// timestamp without time zone / MySQL DATETIME: JS reads it as local time.
    LocalDateTime,
    /// date: JS reads it as local midnight.
    LocalDate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArrayElem {
    Number,
    Bool,
    Json,
    Instant,
    Text,
}

/// Pick the shape from the result column's server type.
pub fn value_shape(kind: Kind, meta: &ColumnMeta) -> ValueShape {
    let t = meta.type_name.to_lowercase();
    match kind {
        Kind::Postgres | Kind::SupabaseMgmt => {
            if let Some(elem) = t.strip_prefix('_') {
                return ValueShape::Array(match elem {
                    "int2" | "int4" | "float4" | "float8" | "oid" => ArrayElem::Number,
                    "bool" => ArrayElem::Bool,
                    "json" | "jsonb" => ArrayElem::Json,
                    "timestamptz" | "timestamp" | "date" => ArrayElem::Instant,
                    _ => ArrayElem::Text,
                });
            }
            match t.as_str() {
                "bool" | "boolean" => ValueShape::Bool,
                "json" | "jsonb" => ValueShape::Json,
                "bytea" => ValueShape::Bytes,
                "timestamptz" | "timestamp with time zone" => ValueShape::Instant,
                "timestamp" | "timestamp without time zone" => ValueShape::LocalDateTime,
                "date" => ValueShape::LocalDate,
                _ if meta.category == TypeCategory::Array => ValueShape::Array(ArrayElem::Text),
                _ => ValueShape::Plain,
            }
        }
        Kind::MySql => match t.as_str() {
            "json" => ValueShape::Json,
            "datetime" | "timestamp" => ValueShape::LocalDateTime,
            "date" | "newdate" => ValueShape::LocalDate,
            _ => ValueShape::Plain,
        },
        _ => ValueShape::Plain,
    }
}

/// The value as the original grid holds it (`String(value)` / `JSON.stringify(value)`).
pub fn serialize_value(text: &str, shape: ValueShape) -> String {
    match shape {
        ValueShape::Plain => text.to_string(),
        ValueShape::Bool => match text {
            "t" | "true" | "1" => "true".into(),
            "f" | "false" | "0" => "false".into(),
            other => other.to_string(),
        },
        ValueShape::Json => compact_json(text),
        ValueShape::Bytes => text.strip_prefix("\\x").unwrap_or(text).to_string(),
        ValueShape::Instant => instant_iso(text).unwrap_or_else(|| text.to_string()),
        ValueShape::LocalDateTime => local_iso(text, false).unwrap_or_else(|| text.to_string()),
        ValueShape::LocalDate => local_iso(text, true).unwrap_or_else(|| text.to_string()),
        ValueShape::Array(elem) => pg_array_to_json(text, elem).unwrap_or_else(|| text.to_string()),
    }
}

pub fn serialize_cell(cell: &Cell, shape: ValueShape) -> Option<String> {
    cell.as_str().map(|t| serialize_value(t, shape))
}

/// `JSON.stringify(JSON.parse(text))` without reordering keys: drop insignificant whitespace.
pub fn compact_json(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_str = false;
    let mut escape = false;
    for c in text.chars() {
        if in_str {
            out.push(c);
            if escape {
                escape = false;
            } else if c == '\\' {
                escape = true;
            } else if c == '"' {
                in_str = false;
            }
        } else if c == '"' {
            in_str = true;
            out.push(c);
        } else if !c.is_whitespace() {
            out.push(c);
        }
    }
    out
}

fn iso_ms(d: DateTime<Utc>) -> String {
    d.format("%Y-%m-%dT%H:%M:%S%.3fZ").to_string()
}

/// Postgres `2024-01-02 10:00:00.123456+01` → `2024-01-02T09:00:00.123Z`.
fn instant_iso(text: &str) -> Option<String> {
    let t = text.trim();
    // Normalize the short `+01` offset to `+01:00` for chrono.
    let normalized = {
        let bytes = t.as_bytes();
        let n = bytes.len();
        if n > 3 && (bytes[n - 3] == b'+' || bytes[n - 3] == b'-') && bytes[n - 2].is_ascii_digit() {
            format!("{t}:00")
        } else {
            t.to_string()
        }
    };
    for fmt in ["%Y-%m-%d %H:%M:%S%.f%:z", "%Y-%m-%dT%H:%M:%S%.f%:z", "%Y-%m-%d %H:%M:%S%.f%:z:%S"] {
        if let Ok(d) = DateTime::parse_from_str(&normalized, fmt) {
            return Some(iso_ms(d.with_timezone(&Utc)));
        }
    }
    DateTime::parse_from_rfc3339(t).ok().map(|d| iso_ms(d.with_timezone(&Utc)))
}

fn local_iso(text: &str, date_only: bool) -> Option<String> {
    let t = text.trim();
    let naive = if date_only {
        NaiveDate::parse_from_str(t, "%Y-%m-%d").ok()?.and_hms_opt(0, 0, 0)?
    } else {
        NaiveDateTime::parse_from_str(t, "%Y-%m-%d %H:%M:%S%.f")
            .or_else(|_| NaiveDateTime::parse_from_str(t, "%Y-%m-%dT%H:%M:%S%.f"))
            .ok()?
    };
    let local = Local.from_local_datetime(&naive).earliest()?;
    Some(iso_ms(local.with_timezone(&Utc)))
}

/// Parse a Postgres array literal (`{1,2,"a b",NULL}`, nested) into JSON text.
pub fn pg_array_to_json(text: &str, elem: ArrayElem) -> Option<String> {
    let chars: Vec<char> = text.trim().chars().collect();
    let mut i = 0;
    // Optional dimension decoration `[1:2]=`.
    if chars.first() == Some(&'[') {
        while i < chars.len() && chars[i] != '=' {
            i += 1;
        }
        i += 1;
    }
    let mut out = String::new();
    parse_array(&chars, &mut i, elem, &mut out)?;
    Some(out)
}

fn parse_array(c: &[char], i: &mut usize, elem: ArrayElem, out: &mut String) -> Option<()> {
    if c.get(*i) != Some(&'{') {
        return None;
    }
    *i += 1;
    out.push('[');
    let mut first = true;
    loop {
        match c.get(*i)? {
            '}' => {
                *i += 1;
                out.push(']');
                return Some(());
            }
            ',' => {
                *i += 1;
                continue;
            }
            _ => {}
        }
        if !first {
            out.push(',');
        }
        first = false;
        if c[*i] == '{' {
            parse_array(c, i, elem, out)?;
            continue;
        }
        let (value, quoted) = if c[*i] == '"' {
            *i += 1;
            let mut s = String::new();
            loop {
                let ch = *c.get(*i)?;
                *i += 1;
                match ch {
                    '\\' => {
                        s.push(*c.get(*i)?);
                        *i += 1;
                    }
                    '"' => break,
                    _ => s.push(ch),
                }
            }
            (s, true)
        } else {
            let mut s = String::new();
            while let Some(&ch) = c.get(*i) {
                if ch == ',' || ch == '}' {
                    break;
                }
                s.push(ch);
                *i += 1;
            }
            (s.trim().to_string(), false)
        };
        if !quoted && value.eq_ignore_ascii_case("null") {
            out.push_str("null");
            continue;
        }
        match elem {
            ArrayElem::Number if value.parse::<f64>().is_ok() => {
                let n: f64 = value.parse().unwrap();
                out.push_str(&serde_json::Value::from(n).to_string().trim_end_matches(".0").to_string());
            }
            ArrayElem::Bool => out.push_str(if value == "t" || value == "true" { "true" } else { "false" }),
            ArrayElem::Json => out.push_str(&compact_json(&value)),
            ArrayElem::Instant => {
                let iso = instant_iso(&value).or_else(|| local_iso(&value, false)).or_else(|| local_iso(&value, true));
                out.push_str(&serde_json::Value::String(iso.unwrap_or(value)).to_string());
            }
            _ => out.push_str(&serde_json::Value::String(value).to_string()),
        }
    }
}

/// JSON array text back to a Postgres array literal (edits of array columns).
pub fn json_to_pg_array(text: &str) -> Option<String> {
    fn lit(v: &serde_json::Value) -> String {
        match v {
            serde_json::Value::Null => "NULL".into(),
            serde_json::Value::Array(a) => format!("{{{}}}", a.iter().map(lit).collect::<Vec<_>>().join(",")),
            serde_json::Value::String(s) => format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\"")),
            other => {
                let s = other.to_string();
                if other.is_object() {
                    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
                } else {
                    s
                }
            }
        }
    }
    let v: serde_json::Value = serde_json::from_str(text.trim()).ok()?;
    v.is_array().then(|| lit(&v))
}

/// `formatDelimitedValue` (lib/studio/general-utils): quote when it contains the delimiter, quotes or newlines.
pub fn format_delimited(value: Option<&str>, delimiter: char) -> String {
    let Some(s) = value else { return String::new() };
    if s.contains(delimiter) || s.contains('"') || s.contains('\n') || s.contains('\r') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// `formatSqlLiteral`: NULL, bare numbers/booleans, quoted strings.
pub fn format_sql_literal(value: Option<&str>, numeric_or_bool: bool) -> String {
    match value {
        None => "NULL".into(),
        Some(s) if numeric_or_bool && (s == "true" || s == "false" || s.parse::<f64>().is_ok()) => s.to_string(),
        Some(s) => format!("'{}'", s.replace('\'', "''")),
    }
}

/// A JSON scalar for a grid value, typed like the JS value the original held.
pub fn json_value(value: Option<&str>, shape: ValueShape, category: TypeCategory) -> serde_json::Value {
    let Some(s) = value else { return serde_json::Value::Null };
    match shape {
        ValueShape::Bool if s == "true" || s == "false" => serde_json::Value::Bool(s == "true"),
        ValueShape::Json | ValueShape::Array(_) => serde_json::from_str(s).unwrap_or_else(|_| s.into()),
        _ => {
            // node-pg returns int2/int4/float as numbers, int8/numeric as strings.
            if matches!(category, TypeCategory::Integer | TypeCategory::Decimal) {
                if let Ok(i) = s.parse::<i32>() {
                    return i.into();
                }
            }
            s.into()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widths_match_original_heuristic() {
        assert_eq!(auto_column_width("id", true, false, [Some("1")].into_iter()), 150.);
        let long = "x".repeat(100);
        assert_eq!(auto_column_width("n", false, false, [Some(long.as_str())].into_iter()), 600.);
        assert_eq!(auto_column_width("n", false, false, [Some("x".repeat(30).as_str())].into_iter()), 245.);
    }

    #[test]
    fn serializes_like_the_sidecar() {
        assert_eq!(serialize_value("t", ValueShape::Bool), "true");
        assert_eq!(compact_json(r#"{"a": 1, "b": [1, 2], "s": "x y"}"#), r#"{"a":1,"b":[1,2],"s":"x y"}"#);
        assert_eq!(serialize_value("\\x00ff", ValueShape::Bytes), "00ff");
        assert_eq!(serialize_value("2024-01-02 10:00:00.123456+01", ValueShape::Instant), "2024-01-02T09:00:00.123Z");
        assert_eq!(pg_array_to_json(r#"{a1,"b c",NULL}"#, ArrayElem::Text).unwrap(), r#"["a1","b c",null]"#);
        assert_eq!(pg_array_to_json("{1,2,3}", ArrayElem::Number).unwrap(), "[1,2,3]");
        assert_eq!(pg_array_to_json("{{1,2},{3,4}}", ArrayElem::Number).unwrap(), "[[1,2],[3,4]]");
        assert_eq!(json_to_pg_array(r#"["a","b c"]"#).unwrap(), r#"{"a","b c"}"#);
    }

    #[test]
    fn labels_and_icons() {
        assert_eq!(sort_labels("integer"), ("Less to more", "More to less"));
        assert_eq!(sort_labels("timestamp with time zone").0, "Oldest first");
        assert_eq!(type_icon("uuid"), TypeIcon::Uuid);
        assert_eq!(type_icon("jsonb"), TypeIcon::Json);
        assert_eq!(json_badge("[1,2]"), Some("Array"));
        assert!(is_arabic("مرحبا"));
    }
}
