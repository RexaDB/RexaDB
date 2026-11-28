//! Port of components/studio/database/indexes-list.tsx (+ `handleDeleteIndex`).

use super::{fetch, ListBase, ListView};
use crate::actions;
use crate::common;
use crate::data_table::{Column, DataTable, Row};
use crate::prefill;
use gpui::{div, prelude::*, Context, FontWeight, SharedString, Window};
use rexa_core::{Session, TabSpec};
use rexa_drivers::{IndexInfo, Kind};
use rexa_ui::{ActiveTokens, Badge, BadgeVariant, Button, ButtonSize, IconName, Side, Tooltip};
use std::sync::Arc;

pub struct IndexesList {
    base: ListBase,
    indexes: Vec<IndexInfo>,
}

impl ListView for IndexesList {
    fn base(&mut self) -> &mut ListBase {
        &mut self.base
    }
    fn load(&mut self, cx: &mut Context<Self>) {
        self.base.loading = true;
        let d = self.base.session.driver.clone();
        let schema = self.base.schema.clone();
        let fut = rexa_core::runtime::spawn(async move { d.indexes(Some(&schema)).await });
        fetch(cx, fut, |v: &mut Self, e| v.indexes = e);
    }
}

impl IndexesList {
    pub fn new(spec: TabSpec, session: Arc<Session>, schema: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let base = ListBase::new(spec, session, schema, "Search for an index", window, cx);
        let mut this = IndexesList { base, indexes: Vec::new() };
        this.load(cx);
        this
    }

    fn read_only(&self) -> bool {
        common::kind(&self.base.session) == Kind::Oracle
    }

    fn delete(&mut self, idx: IndexInfo, cx: &mut Context<Self>) {
        let kind = common::kind(&self.base.session);
        let sql = match kind {
            Kind::Postgres | Kind::SupabaseMgmt => format!("DROP INDEX IF EXISTS {}.{};", actions::dq(&idx.schema), actions::dq(&idx.name)),
            _ => rexa_drivers::ddl::drop_index(kind, &idx.schema, &idx.name, Some(&idx.table_name)),
        };
        let this = cx.entity().downgrade();
        actions::confirm_run(
            &self.base.session,
            "Delete Index",
            format!("Are you sure you want to delete the index \"{}\".\"{}\"?", idx.schema, idx.name),
            "Delete",
            sql,
            String::new(),
            "Failed to delete index",
            cx,
            move |_, cx| {
                this.update(cx, |v, cx| v.load(cx)).ok();
            },
        );
    }
}

impl Render for IndexesList {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.base.loading && self.indexes.is_empty() && !self.base.loaded_once {
            return common::list_skeleton("idx-sk", &[96., 128., 112.], cx);
        }
        let t = cx.tokens().clone();
        let search = self.base.query(cx);
        let schema = self.base.schema.clone();
        let needle = search.to_lowercase();
        let mut filtered: Vec<IndexInfo> = self
            .indexes
            .iter()
            .filter(|i| {
                (schema == "all" || schema.is_empty() || i.schema == schema)
                    && (needle.is_empty() || i.name.to_lowercase().contains(&needle) || i.table_name.to_lowercase().contains(&needle))
            })
            .cloned()
            .collect();
        filtered.sort_by_key(|i| i.name.to_lowercase());
        let read_only = self.read_only();
        let this = cx.entity();
        let create = {
            let schema = schema.clone();
            move |_: &mut Window, cx: &mut gpui::App| prefill::open_create("index", Some(&schema), cx)
        };

        let body = if filtered.is_empty() && search.is_empty() {
            let action = (!read_only).then(|| {
                let c = create.clone();
                Button::new("idx-empty-create").outline().size(ButtonSize::Sm).icon(IconName::Plus).label("Create index").on_click(move |_, w, cx| c(w, cx)).into_any_element()
            });
            common::empty_state(IconName::Database, "No indexes created yet", Some(format!("There are no indexes found in the schema \"{schema}\"").into()), action, cx)
        } else {
            let rows: Vec<Row> = filtered
                .into_iter()
                .map(|idx| {
                    let cols = idx.columns.join(", ");
                    let key = format!("{}.{}", idx.schema, idx.name);
                    let (ts, tn) = (idx.schema.clone(), idx.table_name.clone());
                    let def = idx.clone();
                    let del = idx.clone();
                    let this = this.clone();
                    Row::new(key.clone())
                        .sort("table", idx.table_name.clone())
                        .sort("name", idx.name.clone())
                        .cell(common::table_link(SharedString::from(format!("idx-tl-{key}")), &idx.table_name, move |_, cx| common::open_table(&ts, &tn, cx), cx))
                        .cell(div().truncate().text_color(t.muted_foreground).child(cols))
                        .cell(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .min_w_0()
                                .child(div().truncate().font_weight(FontWeight::MEDIUM).child(idx.name.clone()))
                                .when(idx.is_unique, |d| d.child(div().flex_shrink_0().child(Badge::new("Unique").variant(BadgeVariant::Info)))),
                        )
                        .cell(
                            div()
                                .flex()
                                .justify_end()
                                .items_center()
                                .gap_2()
                                .child(Button::new(SharedString::from(format!("idx-def-{key}"))).outline().size(ButtonSize::Sm).label("View definition").on_click(move |_, _, cx| {
                                    common::open_sql(format!("sql-index-{}", def.name), format!("Index: {}", def.name), def.definition.clone(), cx)
                                }))
                                .when(!read_only, |d| {
                                    d.child(Tooltip::new("Delete index").side(Side::Bottom).child(
                                        Button::new(SharedString::from(format!("idx-del-{key}"))).ghost().size(ButtonSize::IconSm).icon(IconName::Trash).on_click(move |_, _, cx| {
                                            let i = del.clone();
                                            this.update(cx, |v, cx| v.delete(i, cx));
                                        }),
                                    ))
                                }),
                        )
                })
                .collect();
            div()
                .pb_8()
                .child(
                    DataTable::new("idx-table", &self.base.table)
                        .columns([
                            Column::new("table", "Table").fr(1.).sortable(),
                            Column::new("columns", "Columns").fr(1.2),
                            Column::new("name", "Name").fr(1.).sortable(),
                            Column::new("actions", "").px(176.).right(),
                        ])
                        .rows(rows)
                        .paginate(10, "indexes")
                        .empty(common::no_results(&search, cx)),
                )
                .into_any_element()
        };

        let this2 = cx.entity();
        common::page(cx)
            .child(common::list_header("Database Indexes", "Improve query performance against your database", cx))
            .child(
                common::toolbar()
                    .child(
                        common::filters()
                            .child(common::schema_dropdown("idx-schema", &self.base.schemas, &schema, false, move |s, _, cx| this2.update(cx, |v, cx| ListBase::set_schema(v, s, cx)), cx))
                            .child(common::search_input(&self.base.search, cx)),
                    )
                    .when(!read_only, |d| d.child(common::create_button("idx-create", "Create index", create))),
            )
            .child(div().id("idx-scroll").px_8().flex_1().min_h_0().overflow_y_scroll().child(body))
            .into_any_element()
    }
}
