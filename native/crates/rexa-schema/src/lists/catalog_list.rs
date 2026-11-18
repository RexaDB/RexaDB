//! Port of components/studio/database/oracle-catalog-list.tsx and its five uses in
//! studio-main-content.tsx (packages, sequences, synonyms, db-links,
//! materialized-views), including their column definitions and "View" actions.

use super::{fetch, ListBase, ListView};
use crate::common;
use crate::data_table::{Column, DataTable, Row};
use gpui::{div, prelude::*, px, Context, ElementId, SharedString, Window};
use rexa_core::{Session, TabSpec};
use rexa_ui::{skeleton, ActiveTokens, Badge, BadgeVariant, Button, ButtonSize};
use std::sync::Arc;

#[derive(Clone, Copy, PartialEq)]
pub enum CatalogKind {
    Packages,
    Sequences,
    Synonyms,
    DbLinks,
    MaterializedViews,
}

#[derive(Clone)]
pub struct CatalogRow {
    pub schema: String,
    pub name: String,
    /// Column key → rendered text.
    pub fields: Vec<(&'static str, String)>,
    /// (tab id, title, sql) for "View".
    pub view: Option<(String, String, String)>,
}

struct Spec {
    title: &'static str,
    description: &'static str,
    placeholder: &'static str,
    columns: &'static [(&'static str, &'static str, f32)],
    /// `render` columns shown in muted text.
    muted: &'static [&'static str],
    schema_filter: bool,
}

fn spec(k: CatalogKind) -> Spec {
    match k {
        CatalogKind::Packages => Spec {
            title: "Packages",
            description: "PL/SQL packages (spec) in the selected schema",
            placeholder: "Search packages",
            columns: &[("name", "Name", 1.2), ("status", "Status", 0.6)],
            muted: &["status"],
            schema_filter: true,
        },
        CatalogKind::Sequences => Spec {
            title: "Sequences",
            description: "Number generators used for identity and keys",
            placeholder: "Search sequences",
            columns: &[("name", "Name", 1.), ("last_number", "Last", 0.6), ("increment_by", "Increment", 0.6), ("cycle_flag", "Cycle", 0.5)],
            muted: &[],
            schema_filter: true,
        },
        CatalogKind::Synonyms => Spec {
            title: "Synonyms",
            description: "Aliases that point at other schema objects",
            placeholder: "Search synonyms",
            columns: &[("name", "Name", 1.), ("target", "Target", 1.4), ("db_link", "DB Link", 0.8)],
            muted: &[],
            schema_filter: true,
        },
        CatalogKind::DbLinks => Spec {
            title: "Database Links",
            description: "Named connections to remote (or local loopback) Oracle databases",
            placeholder: "Search DB links",
            columns: &[("name", "Name", 1.), ("username", "User", 0.8), ("host", "Connect string", 1.4)],
            muted: &[],
            schema_filter: false,
        },
        CatalogKind::MaterializedViews => Spec {
            title: "Materialized Views",
            description: "Stored query results that can be refreshed on demand or on a schedule",
            placeholder: "Search materialized views",
            columns: &[("name", "Name", 1.1), ("refresh_method", "Refresh", 0.7), ("staleness", "Staleness", 0.7), ("compile_state", "State", 0.6)],
            muted: &[],
            schema_filter: true,
        },
    }
}

pub struct CatalogList {
    base: ListBase,
    kind: CatalogKind,
    rows: Vec<CatalogRow>,
}

fn opt(s: &Option<String>) -> String {
    s.clone().unwrap_or_default()
}

impl ListView for CatalogList {
    fn base(&mut self) -> &mut ListBase {
        &mut self.base
    }
    fn load(&mut self, cx: &mut Context<Self>) {
        self.base.loading = true;
        let d = self.base.session.driver.clone();
        let schema = self.base.schema.clone();
        let kind = self.kind;
        let fut = rexa_core::runtime::spawn(async move {
            let dash = |s: &Option<String>| s.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| "\u{2014}".into());
            Ok(match kind {
                CatalogKind::Packages => d
                    .packages(&schema)
                    .await?
                    .into_iter()
                    .map(|p| CatalogRow {
                        view: Some((format!("sql-package-{}", p.name), format!("Package: {}", p.name), p.definition.clone().unwrap_or_else(|| format!("-- No source for {}", p.name)))),
                        fields: vec![("name", p.name.clone()), ("status", p.status.clone())],
                        schema: p.schema,
                        name: p.name,
                    })
                    .collect(),
                CatalogKind::Sequences => d
                    .sequences(&schema)
                    .await?
                    .into_iter()
                    .map(|s| CatalogRow {
                        view: None,
                        fields: vec![
                            ("name", s.name.clone()),
                            ("last_number", opt(&s.last_number)),
                            ("increment_by", opt(&s.increment_by)),
                            ("cycle_flag", if s.cycle_flag { "Yes".into() } else { "No".into() }),
                        ],
                        schema: s.schema,
                        name: s.name,
                    })
                    .collect(),
                CatalogKind::Synonyms => d
                    .synonyms(&schema)
                    .await?
                    .into_iter()
                    .map(|s| CatalogRow {
                        view: None,
                        fields: vec![("name", s.name.clone()), ("target", format!("{}.{}", s.table_owner, s.table_name)), ("db_link", dash(&s.db_link))],
                        schema: s.schema,
                        name: s.name,
                    })
                    .collect(),
                CatalogKind::DbLinks => d
                    .db_links()
                    .await?
                    .into_iter()
                    .map(|l| CatalogRow {
                        view: None,
                        fields: vec![("name", l.name.clone()), ("username", opt(&l.username)), ("host", opt(&l.host))],
                        schema: l.owner,
                        name: l.name,
                    })
                    .collect(),
                CatalogKind::MaterializedViews => d
                    .materialized_views(&schema)
                    .await?
                    .into_iter()
                    .map(|m| CatalogRow {
                        view: Some((format!("sql-mview-{}", m.name), format!("MView: {}", m.name), m.query.clone().unwrap_or_else(|| format!("-- No query text for {}", m.name)))),
                        fields: vec![
                            ("name", m.name.clone()),
                            ("refresh_method", m.refresh_method.clone().or(m.refresh_mode.clone()).filter(|s| !s.is_empty()).unwrap_or_else(|| "\u{2014}".into())),
                            ("staleness", dash(&m.staleness)),
                            ("compile_state", dash(&m.compile_state)),
                        ],
                        schema: m.schema,
                        name: m.name,
                    })
                    .collect(),
            })
        });
        fetch(cx, fut, |v: &mut Self, rows: Vec<CatalogRow>| v.rows = rows);
    }
}

impl CatalogList {
    pub fn new(kind: CatalogKind, spec_: TabSpec, session: Arc<Session>, schema: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let base = ListBase::new(spec_, session, schema, spec(kind).placeholder, window, cx);
        let mut this = CatalogList { base, kind, rows: Vec::new() };
        this.load(cx);
        this
    }
}

impl Render for CatalogList {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let s = spec(self.kind);
        let t = cx.tokens().clone();
        if self.base.loading && self.rows.is_empty() && !self.base.loaded_once {
            return common::page(cx)
                .p_8()
                .gap_4()
                .child(skeleton("cat-sk1", |d| d.h_4().w(px(160.)), cx))
                .child(skeleton("cat-sk2", |d| d.h_3().w(px(256.)), cx))
                .child(skeleton("cat-sk3", |d| d.h_64().w_full().rounded(px(10.)), cx))
                .into_any_element();
        }
        let search = self.base.query(cx).to_lowercase();
        let schema = self.base.schema.clone();
        let mut filtered: Vec<CatalogRow> = self
            .rows
            .iter()
            .filter(|r| {
                let ms = !s.schema_filter || schema == "all" || schema.is_empty() || r.schema.eq_ignore_ascii_case(&schema);
                let hay = format!("{} {} {}", r.schema, r.name, r.fields.iter().map(|(_, v)| v.as_str()).collect::<Vec<_>>().join(" ")).to_lowercase();
                ms && (search.is_empty() || hay.contains(&search))
            })
            .cloned()
            .collect();
        filtered.sort_by_key(|r| r.name.to_lowercase());
        let has_view = matches!(self.kind, CatalogKind::Packages | CatalogKind::MaterializedViews);
        let count = filtered.len();

        let body = if filtered.is_empty() {
            common::empty_state(rexa_ui::IconName::SquarePlus, "No objects found", Some("Nothing matched this schema.".into()), None, cx)
        } else {
            let mut cols: Vec<Column> = s.columns.iter().map(|(k, h, f)| Column::new(k, *h).fr(*f).sortable()).collect();
            if has_view {
                cols.push(Column::new("actions", "").px(160.).right());
            }
            let rows: Vec<Row> = filtered
                .into_iter()
                .enumerate()
                .map(|(i, r)| {
                    let mut row = Row::new(format!("{}:{}:{i}", r.schema, r.name));
                    for (k, _, _) in s.columns {
                        let v = r.fields.iter().find(|(fk, _)| fk == k).map(|(_, v)| v.clone()).unwrap_or_default();
                        row = row.sort(k, v.clone()).cell(div().truncate().when(s.muted.contains(k), |d| d.text_color(t.muted_foreground)).child(v));
                    }
                    if has_view {
                        let view = r.view.clone();
                        row = row.cell(div().flex().justify_end().child(Button::new(ElementId::Name(format!("cat-view-{i}").into())).outline().size(ButtonSize::Sm).label("View").on_click(move |_, _, cx| {
                            if let Some((id, title, sql)) = view.clone() {
                                common::open_sql(id, title, sql, cx);
                            }
                        })));
                    }
                    row
                })
                .collect();
            div()
                .pb_8()
                .child(DataTable::new("cat-table", &self.base.table).columns(cols).rows(rows).paginate(25, "objects"))
                .into_any_element()
        };

        let this = cx.entity();
        common::page(cx)
            .child(common::list_header(s.title, s.description, cx))
            .child(
                div()
                    .flex_shrink_0()
                    .px_8()
                    .pb_4()
                    .flex()
                    .items_center()
                    .gap_2()
                    .flex_wrap()
                    .when(s.schema_filter, |d| {
                        d.child(common::schema_dropdown("cat-schema", &self.base.schemas, &schema, false, move |s, _, cx| this.update(cx, |v, cx| ListBase::set_schema(v, s, cx)), cx))
                    })
                    .child(common::search_input(&self.base.search, cx))
                    .child(div().ml_auto().child(Badge::new(SharedString::from(count.to_string())).variant(BadgeVariant::Secondary))),
            )
            .child(div().id("cat-scroll").px_8().flex_1().min_h_0().overflow_y_scroll().child(body))
            .into_any_element()
    }
}
