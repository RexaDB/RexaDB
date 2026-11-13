//! Table-editor SQL: the filter/sort/paging model of the data grid and row
//! mutations.
//!
//! * Filter rules: `components/studio/toolbar/toolbar-filter-sort.tsx`
//!   (`FilterRule`, `buildRuleClause`). Enabled rules are joined with `AND`;
//!   a free-form WHERE (the toolbar's custom text) is ANDed after them.
//! * Paging/sort: `hooks/use-studio.ts#refreshTableData` — `LIMIT/OFFSET`,
//!   `OFFSET … FETCH NEXT` for MSSQL/Oracle (with `ORDER BY (SELECT 1)` /
//!   `ORDER BY 1` when unsorted), prefix paging (`LIMIT offset+limit`) for
//!   Trino/SpacetimeDB, primary-key tie-breakers for infinite scrolling.
//! * Count: `SELECT COUNT(*) as "count" FROM … WHERE …`.

use crate::{Dialect, Kind, RowUpdate, RowValues, TableRef, Value};

/// `FilterOperator`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FilterOperator {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    StartsWith,
    EndsWith,
    IsNull,
    IsNotNull,
}

impl FilterOperator {
    /// `FILTER_OPERATORS` in menu order.
    pub const ALL: [FilterOperator; 11] = [
        FilterOperator::Eq,
        FilterOperator::Ne,
        FilterOperator::Contains,
        FilterOperator::StartsWith,
        FilterOperator::EndsWith,
        FilterOperator::Gt,
        FilterOperator::Gte,
        FilterOperator::Lt,
        FilterOperator::Lte,
        FilterOperator::IsNull,
        FilterOperator::IsNotNull,
    ];

    pub fn id(self) -> &'static str {
        match self {
            FilterOperator::Eq => "eq",
            FilterOperator::Ne => "ne",
            FilterOperator::Gt => "gt",
            FilterOperator::Gte => "gte",
            FilterOperator::Lt => "lt",
            FilterOperator::Lte => "lte",
            FilterOperator::Contains => "contains",
            FilterOperator::StartsWith => "starts_with",
            FilterOperator::EndsWith => "ends_with",
            FilterOperator::IsNull => "is_null",
            FilterOperator::IsNotNull => "is_not_null",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|o| o.id() == id)
    }

    pub fn label(self) -> &'static str {
        match self {
            FilterOperator::Eq => "Equals",
            FilterOperator::Ne => "Not equals",
            FilterOperator::Contains => "Contains",
            FilterOperator::StartsWith => "Starts with",
            FilterOperator::EndsWith => "Ends with",
            FilterOperator::Gt => "Greater than",
            FilterOperator::Gte => "Greater or equal",
            FilterOperator::Lt => "Less than",
            FilterOperator::Lte => "Less or equal",
            FilterOperator::IsNull => "Is null",
            FilterOperator::IsNotNull => "Is not null",
        }
    }

    /// `operatorNeedsValue`
    pub fn needs_value(self) -> bool {
        !matches!(self, FilterOperator::IsNull | FilterOperator::IsNotNull)
    }
}

/// One visual filter rule (`FilterRule`). `operator = None` is the
/// original's `"none"`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FilterRule {
    pub enabled: bool,
    pub column: String,
    pub operator: Option<FilterOperator>,
    pub value: String,
}

impl FilterRule {
    pub fn new(column: impl Into<String>, operator: FilterOperator, value: impl Into<String>) -> Self {
        FilterRule { enabled: true, column: column.into(), operator: Some(operator), value: value.into() }
    }
}

/// `toSqlLiteral`: numbers/booleans/null unquoted, everything else quoted.
fn to_sql_literal(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
        return "''".into();
    }
    if t.eq_ignore_ascii_case("null") {
        return "NULL".into();
    }
    if t.eq_ignore_ascii_case("true") {
        return "TRUE".into();
    }
    if t.eq_ignore_ascii_case("false") {
        return "FALSE".into();
    }
    let num = t.strip_prefix('-').unwrap_or(t);
    let mut parts = num.splitn(2, '.');
    let int_ok = parts.next().is_some_and(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()));
    let frac_ok = parts.next().is_none_or(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()));
    if int_ok && frac_ok {
        return t.to_string();
    }
    format!("'{}'", t.replace('\'', "''"))
}

/// `buildRuleClause(rule, dbType)`. `None` for disabled/incomplete rules.
pub fn build_rule_clause(rule: &FilterRule, kind: Kind) -> Option<String> {
    let op = rule.operator?;
    if !rule.enabled || rule.column.is_empty() || rule.column == "none" {
        return None;
    }
    if op.needs_value() && rule.value.trim().is_empty() {
        return None;
    }
    let d = kind.dialect();
    let column = d.quote_ident(&rule.column);
    let mut literal = to_sql_literal(&rule.value);
    if kind == Kind::MsSql {
        if literal == "TRUE" {
            literal = "1".into();
        } else if literal == "FALSE" {
            literal = "0".into();
        }
    }
    let like = |pattern: String| format!("CAST({column} AS {}) LIKE '{}'", d.text_cast_target(), pattern.replace('\'', "''"));
    Some(match op {
        FilterOperator::Eq if literal == "NULL" => format!("{column} IS NULL"),
        FilterOperator::Eq => format!("{column} = {literal}"),
        FilterOperator::Ne if literal == "NULL" => format!("{column} IS NOT NULL"),
        FilterOperator::Ne => format!("{column} <> {literal}"),
        FilterOperator::Gt => format!("{column} > {literal}"),
        FilterOperator::Gte => format!("{column} >= {literal}"),
        FilterOperator::Lt => format!("{column} < {literal}"),
        FilterOperator::Lte => format!("{column} <= {literal}"),
        FilterOperator::Contains => like(format!("%{}%", rule.value)),
        FilterOperator::StartsWith => like(format!("{}%", rule.value)),
        FilterOperator::EndsWith => like(format!("%{}", rule.value)),
        FilterOperator::IsNull => format!("{column} IS NULL"),
        FilterOperator::IsNotNull => format!("{column} IS NOT NULL"),
    })
}

/// `stripLeadingWhereKeyword`: stored filters already mean WHERE.
pub fn strip_leading_where(text: &str) -> &str {
    let t = text.trim();
    if t.len() >= 6 && t[..5].eq_ignore_ascii_case("where") && t.as_bytes()[5].is_ascii_whitespace() {
        t[6..].trim_start()
    } else {
        t
    }
}

/// Filter of a table read: visual rules plus an optional raw WHERE body
/// (the toolbar's custom SQL; `filterQuery` in the original).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TableFilter {
    pub rules: Vec<FilterRule>,
    pub raw_where: Option<String>,
}

impl TableFilter {
    pub fn raw(where_body: impl Into<String>) -> Self {
        TableFilter { rules: Vec::new(), raw_where: Some(where_body.into()) }
    }

    /// The WHERE body (without `WHERE`), `None` when nothing filters.
    pub fn where_clause(&self, kind: Kind) -> Option<String> {
        let mut parts: Vec<String> = self.rules.iter().filter_map(|r| build_rule_clause(r, kind)).collect();
        if let Some(raw) = self.raw_where.as_deref().map(strip_leading_where).filter(|s| !s.is_empty()) {
            if parts.is_empty() {
                parts.push(raw.to_string());
            } else {
                parts.push(format!("({raw})"));
            }
        }
        (!parts.is_empty()).then(|| parts.join(" AND "))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SortDirection {
    #[default]
    Asc,
    Desc,
}

impl SortDirection {
    pub fn sql(self) -> &'static str {
        match self {
            SortDirection::Asc => "ASC",
            SortDirection::Desc => "DESC",
        }
    }
}

/// `sortConfig: { column, direction }`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SortConfig {
    pub column: String,
    pub direction: SortDirection,
}

/// One table page request ([`crate::Driver::read_table`]).
#[derive(Debug, Clone, Default)]
pub struct TableQuery {
    pub table: TableRef,
    /// Visible columns; `None` = `*` (hidden-column projection).
    pub columns: Option<Vec<String>>,
    pub filter: TableFilter,
    pub sort: Option<SortConfig>,
    pub limit: usize,
    pub offset: usize,
    /// Infinite scrolling: append primary-key tie-breakers so pages are stable.
    pub stable_order_keys: Vec<String>,
    /// Also run `SELECT COUNT(*)` with the same filter.
    pub with_count: bool,
}

/// `SELECT … FROM … [WHERE] [ORDER BY] LIMIT/OFFSET` as `refreshTableData`
/// builds it. For Trino/SpacetimeDB (prefix paging) the result contains
/// `offset + limit` rows; callers drop the first `offset`.
pub fn build_select_sql(kind: Kind, q: &TableQuery) -> String {
    let d = kind.dialect();
    if kind == Kind::MongoDb {
        return build_mongo_find(q);
    }
    let cols = match &q.columns {
        Some(c) if !c.is_empty() => c.iter().map(|c| d.quote_ident(c)).collect::<Vec<_>>().join(", "),
        _ => "*".into(),
    };
    let mut sql = format!("SELECT {cols} FROM {}", d.table_ref(&q.table.schema, &q.table.name));
    if let Some(w) = q.filter.where_clause(kind) {
        sql.push_str(&format!(" WHERE {w}"));
    }
    let mut order: Vec<String> = q.sort.iter().map(|s| format!("{} {}", d.quote_ident(&s.column), s.direction.sql())).collect();
    for k in &q.stable_order_keys {
        if q.sort.as_ref().is_none_or(|s| &s.column != k) {
            order.push(format!("{} ASC", d.quote_ident(k)));
        }
    }
    if !order.is_empty() {
        sql.push_str(&format!(" ORDER BY {}", order.join(", ")));
    }
    match kind {
        Kind::MsSql | Kind::Oracle => {
            if order.is_empty() {
                sql.push_str(if kind == Kind::Oracle { " ORDER BY 1" } else { " ORDER BY (SELECT 1)" });
            }
            sql.push_str(&format!(" OFFSET {} ROWS FETCH NEXT {} ROWS ONLY", q.offset, q.limit));
        }
        Kind::Trino | Kind::SpacetimeDb => sql.push_str(&format!(" LIMIT {}", q.offset + q.limit)),
        _ => sql.push_str(&format!(" LIMIT {} OFFSET {}", q.limit, q.offset)),
    }
    sql.push(';');
    sql
}

/// The Mongo `find` command `refreshTableData` sends.
fn build_mongo_find(q: &TableQuery) -> String {
    let mut cmd = serde_json::json!({
        "operation": "find",
        "database": q.table.schema,
        "collection": q.table.name,
        "filter": {},
        "limit": q.limit,
        "skip": q.offset,
    });
    if let Some(s) = &q.sort {
        let mut sort = serde_json::Map::new();
        sort.insert(s.column.clone(), (if s.direction == SortDirection::Asc { 1 } else { -1 }).into());
        if !q.stable_order_keys.is_empty() && s.column != "_id" {
            sort.insert("_id".into(), 1.into());
        }
        cmd["sort"] = sort.into();
    } else if !q.stable_order_keys.is_empty() {
        cmd["sort"] = serde_json::json!({ "_id": 1 });
    }
    cmd.to_string()
}

pub fn build_count_sql(kind: Kind, table: &TableRef, filter: &TableFilter) -> String {
    if kind == Kind::MongoDb {
        return serde_json::json!({ "operation": "count", "database": table.schema, "collection": table.name, "filter": {} })
            .to_string();
    }
    let d = kind.dialect();
    let mut sql = format!("SELECT COUNT(*) as {} FROM {}", d.quote_ident("count"), d.table_ref(&table.schema, &table.name));
    if let Some(w) = filter.where_clause(kind) {
        sql.push_str(&format!(" WHERE {w}"));
    }
    sql
}

fn conditions(d: Dialect, keys: &[(String, Value)]) -> Vec<String> {
    keys.iter()
        .filter(|(k, _)| !k.is_empty())
        .map(|(k, v)| if v.is_null() { format!("{} IS NULL", d.quote_ident(k)) } else { format!("{} = {}", d.quote_ident(k), d.literal(v)) })
        .collect()
}

/// `UPDATE t SET … WHERE …` with inline literals; `None` when either side is empty.
pub fn build_update_sql(kind: Kind, table: &TableRef, u: &RowUpdate) -> Option<String> {
    if u.set.is_empty() || u.r#where.is_empty() {
        return None;
    }
    let d = kind.dialect();
    let set: Vec<String> = u.set.iter().map(|(k, v)| format!("{} = {}", d.quote_ident(k), d.literal(v))).collect();
    let w = conditions(d, &u.r#where);
    if kind == Kind::ClickHouse {
        return Some(format!("ALTER TABLE {} UPDATE {} WHERE {}", d.table_ref(&table.schema, &table.name), set.join(", "), w.join(" AND ")));
    }
    Some(format!("UPDATE {} SET {} WHERE {}", d.table_ref(&table.schema, &table.name), set.join(", "), w.join(" AND ")))
}

/// `DELETE FROM t WHERE pk… = …` for one row; `None` when a key value is missing.
pub fn build_delete_sql(kind: Kind, table: &TableRef, pk: &[String], row: &RowValues) -> Option<String> {
    let d = kind.dialect();
    let mut keys = Vec::new();
    for k in pk {
        let (_, v) = row.iter().find(|(c, _)| c == k)?;
        keys.push((k.clone(), v.clone()));
    }
    if keys.is_empty() {
        return None;
    }
    let w = conditions(d, &keys).join(" AND ");
    if kind == Kind::ClickHouse {
        return Some(format!("ALTER TABLE {} DELETE WHERE {w}", d.table_ref(&table.schema, &table.name)));
    }
    Some(format!("DELETE FROM {} WHERE {w}", d.table_ref(&table.schema, &table.name)))
}

/// `INSERT INTO t (cols) VALUES (…)`; an empty row inserts defaults.
pub fn build_insert_sql(kind: Kind, table: &TableRef, row: &RowValues) -> String {
    let d = kind.dialect();
    let tref = d.table_ref(&table.schema, &table.name);
    if row.is_empty() {
        return match kind {
            Kind::MySql => format!("INSERT INTO {tref} () VALUES ()"),
            _ => format!("INSERT INTO {tref} DEFAULT VALUES"),
        };
    }
    let cols: Vec<String> = row.iter().map(|(k, _)| d.quote_ident(k)).collect();
    let vals: Vec<String> = row.iter().map(|(_, v)| d.literal(v)).collect();
    format!("INSERT INTO {tref} ({}) VALUES ({})", cols.join(", "), vals.join(", "))
}

/// `buildSelectByKeyValuesQuery` with inline literals (`LIMIT 1` / `TOP 1` / `FETCH FIRST`).
pub fn build_select_by_keys_sql(kind: Kind, table: &TableRef, keys: &RowValues) -> Option<String> {
    let d = kind.dialect();
    let w = conditions(d, keys);
    if w.is_empty() {
        return None;
    }
    let tref = d.table_ref(&table.schema, &table.name);
    Some(match kind {
        Kind::MsSql => format!("SELECT TOP 1 * FROM {tref} WHERE {}", w.join(" AND ")),
        Kind::Oracle => format!("SELECT * FROM {tref} WHERE {} FETCH FIRST 1 ROWS ONLY", w.join(" AND ")),
        _ => format!("SELECT * FROM {tref} WHERE {} LIMIT 1", w.join(" AND ")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t() -> TableRef {
        TableRef::new("public", "users")
    }

    #[test]
    fn rule_clauses_match_toolbar() {
        let r = |op, v: &str| build_rule_clause(&FilterRule::new("name", op, v), Kind::Postgres).unwrap();
        assert_eq!(r(FilterOperator::Eq, "5"), "\"name\" = 5");
        assert_eq!(r(FilterOperator::Eq, "null"), "\"name\" IS NULL");
        assert_eq!(r(FilterOperator::Ne, "bob"), "\"name\" <> 'bob'");
        assert_eq!(r(FilterOperator::Contains, "o'k"), "CAST(\"name\" AS TEXT) LIKE '%o''k%'");
        assert_eq!(r(FilterOperator::StartsWith, "a"), "CAST(\"name\" AS TEXT) LIKE 'a%'");
        assert_eq!(r(FilterOperator::IsNotNull, ""), "\"name\" IS NOT NULL");
        assert_eq!(
            build_rule_clause(&FilterRule::new("b", FilterOperator::Eq, "true"), Kind::MsSql).unwrap(),
            "[b] = 1"
        );
        assert_eq!(
            build_rule_clause(&FilterRule::new("b", FilterOperator::Contains, "x"), Kind::MySql).unwrap(),
            "CAST(`b` AS CHAR) LIKE '%x%'"
        );
        assert!(build_rule_clause(&FilterRule::new("b", FilterOperator::Eq, " "), Kind::Postgres).is_none());
        assert_eq!(strip_leading_where("WHERE a = 1"), "a = 1");
    }

    #[test]
    fn select_sql_matches_refresh_table_data() {
        let mut q = TableQuery { table: t(), limit: 50, offset: 100, ..Default::default() };
        assert_eq!(build_select_sql(Kind::Postgres, &q), "SELECT * FROM \"public\".\"users\" LIMIT 50 OFFSET 100;");
        q.filter = TableFilter { rules: vec![FilterRule::new("id", FilterOperator::Gt, "3")], raw_where: Some("WHERE x = 1".into()) };
        q.sort = Some(SortConfig { column: "name".into(), direction: SortDirection::Desc });
        q.stable_order_keys = vec!["id".into()];
        assert_eq!(
            build_select_sql(Kind::Postgres, &q),
            "SELECT * FROM \"public\".\"users\" WHERE \"id\" > 3 AND (x = 1) ORDER BY \"name\" DESC, \"id\" ASC LIMIT 50 OFFSET 100;"
        );
        let q2 = TableQuery { table: TableRef::new("dbo", "t"), limit: 10, ..Default::default() };
        assert_eq!(build_select_sql(Kind::MsSql, &q2), "SELECT * FROM [dbo].[t] ORDER BY (SELECT 1) OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY;");
        assert_eq!(build_select_sql(Kind::Oracle, &q2), "SELECT * FROM \"dbo\".\"t\" ORDER BY 1 OFFSET 0 ROWS FETCH NEXT 10 ROWS ONLY;");
        let q3 = TableQuery { table: TableRef::new("db", "t"), limit: 10, offset: 20, ..Default::default() };
        assert_eq!(build_select_sql(Kind::SpacetimeDb, &q3), "SELECT * FROM \"t\" LIMIT 30;");
        assert_eq!(
            build_count_sql(Kind::MySql, &TableRef::new("shop", "o"), &TableFilter::raw("a=1")),
            "SELECT COUNT(*) as `count` FROM `shop`.`o` WHERE a=1"
        );
    }

    #[test]
    fn mutations() {
        let u = RowUpdate { r#where: vec![("id".into(), Value::Int(1))], set: vec![("name".into(), "x".into())] };
        assert_eq!(build_update_sql(Kind::Postgres, &t(), &u).unwrap(), "UPDATE \"public\".\"users\" SET \"name\" = 'x' WHERE \"id\" = 1");
        let row = vec![("id".into(), Value::Int(1)), ("name".into(), Value::Null)];
        assert_eq!(
            build_delete_sql(Kind::MySql, &TableRef::new("s", "t"), &["id".into()], &row).unwrap(),
            "DELETE FROM `s`.`t` WHERE `id` = 1"
        );
        assert!(build_delete_sql(Kind::MySql, &t(), &["missing".into()], &row).is_none());
        assert_eq!(build_insert_sql(Kind::Sqlite, &TableRef::new("main", "t"), &vec![]), "INSERT INTO \"main\".\"t\" DEFAULT VALUES");
        assert_eq!(
            build_select_by_keys_sql(Kind::Postgres, &t(), &row).unwrap(),
            "SELECT * FROM \"public\".\"users\" WHERE \"id\" = 1 AND \"name\" IS NULL LIMIT 1"
        );
    }
}
