//! Port of components/studio/create-table-view.tsx (+ `handleCreateTable` from
//! hooks/use-studio.ts, including its per-engine SQL).
//!
//! Not ported: the SpacetimeDB table builder (`SpacetimeDBTableBuilder`).

use super::shell;
use super::submit_button;
use crate::actions::{self, dq};
use crate::column_types::{self, NewColumn};
use crate::common;
use gpui::{div, prelude::*, px, Context, Entity, FontWeight, Hsla, SharedString, Window};
use rexa_core::{emit_studio, open_tab, runtime, Session, StudioEvent, TabSpec};
use rexa_ui::widgets::{Icon, InputEvent, InputState};
use rexa_ui::{tw, with_alpha, ActiveTokens, Button, ButtonSize, IconName, Select, SelectOption, TextInput, Tw, MONO};
use std::sync::Arc;

struct ColRow {
    col: NewColumn,
    name: Entity<InputState>,
    default: Entity<InputState>,
    fk_column: Entity<InputState>,
}

pub struct CreateTableView {
    spec: TabSpec,
    session: Arc<Session>,
    db_type: &'static str,
    schema: String,
    schemas: Vec<String>,
    tables: Vec<String>,
    name: Entity<InputState>,
    columns: Vec<ColRow>,
    creating: bool,
}

/// `toSqliteType` of `handleCreateTable`.
fn to_sqlite_type(raw: &str) -> String {
    let t = raw.trim().to_uppercase();
    match t.as_str() {
        "" => "TEXT".into(),
        "SERIAL" | "BIGSERIAL" | "INTEGER" | "BIGINT" | "SMALLINT" | "INT" | "BOOLEAN" | "BOOL" => "INTEGER".into(),
        "TIMESTAMPTZ" | "TIMESTAMP" | "DATE" | "DATETIME" | "TIME" | "VARCHAR" | "TEXT" | "UUID" | "JSONB" | "JSON" => "TEXT".into(),
        "REAL" | "DOUBLE" | "DOUBLE PRECISION" | "FLOAT" => "REAL".into(),
        "NUMERIC" | "DECIMAL" => "NUMERIC".into(),
        "BLOB" | "BINARY" => "BLOB".into(),
        _ => t,
    }
}

fn sqlite_default(raw: &str, ty: &str) -> String {
    let d = raw.trim();
    let l = d.to_lowercase();
    if d.is_empty() || l.starts_with("nextval(") {
        return String::new();
    }
    if l == "now()" || l == "current_timestamp()" {
        return "CURRENT_TIMESTAMP".into();
    }
    if l == "true" {
        return "1".into();
    }
    if l == "false" {
        return "0".into();
    }
    let ident = d.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && d.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ty == "TEXT" && ident && d.to_uppercase() != "CURRENT_TIMESTAMP" {
        return actions::sq(d);
    }
    d.to_string()
}

/// `handleCreateTable`'s statement for each engine.
pub fn create_table_sql(db_type: &str, session: &Session, schema: &str, table: &str, cols: &[NewColumn]) -> String {
    let d = &session.driver;
    let qi = |s: &str| d.quote_ident(s);
    let tref = |s: &str, t: &str| d.dialect().table_ref(s, t);
    match db_type {
        "mongodb" => serde_json::to_string_pretty(&serde_json::json!({ "operation": "createCollection", "database": schema, "collection": table })).unwrap_or_default(),
        "sqlite" => {
            let defs: Vec<String> = cols
                .iter()
                .map(|c| {
                    let ty = to_sqlite_type(&c.r#type);
                    let def = sqlite_default(&c.default, &ty);
                    let mut s = format!("{} {ty}", dq(&c.name));
                    if c.is_primary && ty == "INTEGER" {
                        s.push_str(" PRIMARY KEY AUTOINCREMENT");
                    } else {
                        if !c.is_nullable {
                            s.push_str(" NOT NULL");
                        }
                        if c.is_primary {
                            s.push_str(" PRIMARY KEY");
                        }
                    }
                    if c.is_unique {
                        s.push_str(" UNIQUE");
                    }
                    if !def.is_empty() {
                        s.push_str(&format!(" DEFAULT {def}"));
                    }
                    if let Some((t, col)) = &c.references {
                        s.push_str(&format!(" REFERENCES {}({})", dq(t), dq(col)));
                    }
                    s
                })
                .collect();
            format!("CREATE TABLE {}.{} ({});", dq(schema), dq(table), defs.join(", "))
        }
        "mysql" | "mssql" => {
            let defs: Vec<String> = cols
                .iter()
                .map(|c| {
                    let dv = c.default.trim();
                    let mut s = format!("{} {}", qi(&c.name), c.r#type);
                    let special = if db_type == "mysql" { dv.to_lowercase().contains("auto_increment") } else { dv.to_lowercase().starts_with("identity") };
                    if db_type == "mssql" && special {
                        s.push_str(&format!(" {dv}"));
                    }
                    if !c.is_nullable {
                        s.push_str(" NOT NULL");
                    }
                    if c.is_primary {
                        s.push_str(" PRIMARY KEY");
                    }
                    if c.is_unique {
                        s.push_str(" UNIQUE");
                    }
                    if db_type == "mysql" && special {
                        s.push_str(" AUTO_INCREMENT");
                    } else if !special && !dv.is_empty() {
                        s.push_str(&format!(" DEFAULT {dv}"));
                    }
                    if let Some((t, col)) = &c.references {
                        s.push_str(&format!(" REFERENCES {}({})", tref(schema, t), qi(col)));
                    }
                    s
                })
                .collect();
            format!("CREATE TABLE {} ({});", tref(schema, table), defs.join(", "))
        }
        "clickhouse" => {
            let defs: Vec<String> = cols
                .iter()
                .map(|c| {
                    let mut s = format!("{} {}", qi(&c.name), c.r#type);
                    if !c.is_nullable {
                        s.push_str(" NOT NULL");
                    }
                    if !c.default.is_empty() {
                        s.push_str(&format!(" DEFAULT {}", c.default));
                    }
                    s
                })
                .collect();
            let pk: Vec<String> = cols.iter().filter(|c| c.is_primary).map(|c| qi(&c.name)).collect();
            let primary = if pk.is_empty() { String::new() } else { format!(" PRIMARY KEY ({})", pk.join(", ")) };
            let order = if pk.is_empty() { "ORDER BY tuple()".to_string() } else { format!("ORDER BY ({})", pk.join(", ")) };
            format!("CREATE TABLE {} ({}) ENGINE = MergeTree{primary} {order};", tref(schema, table), defs.join(", "))
        }
        _ => {
            let defs: Vec<String> = cols
                .iter()
                .map(|c| {
                    let mut s = format!("{} {}", dq(&c.name), c.r#type);
                    if !c.is_nullable {
                        s.push_str(" NOT NULL");
                    }
                    if c.is_primary {
                        s.push_str(" PRIMARY KEY");
                    }
                    if c.is_unique {
                        s.push_str(" UNIQUE");
                    }
                    if !c.default.is_empty() {
                        s.push_str(&format!(" DEFAULT {}", c.default));
                    }
                    if let Some((t, col)) = &c.references {
                        s.push_str(&format!(" REFERENCES {}.{}({})", dq(schema), dq(t), dq(col)));
                    }
                    s
                })
                .collect();
            format!("CREATE TABLE {}.{} ({});", dq(schema), dq(table), defs.join(", "))
        }
    }
}

impl CreateTableView {
    pub fn new(spec: TabSpec, session: Arc<Session>, schema: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let db_type = common::db_type(&session);
        let name = cx.new(|cx| InputState::new(window, cx).placeholder("e.g. customers"));
        cx.subscribe(&name, |_, _, _: &InputEvent, cx| cx.notify()).detach();
        let mut this = CreateTableView { spec, session, db_type, schema, schemas: Vec::new(), tables: Vec::new(), name, columns: Vec::new(), creating: false };
        for c in column_types::default_new_table_columns(db_type) {
            this.push(c, window, cx);
        }
        let d = this.session.driver.clone();
        let s = this.schema.clone();
        let fut = runtime::spawn(async move { Ok((d.schemas().await.unwrap_or_default(), d.tables(&s).await.unwrap_or_default())) });
        cx.spawn(async move |this, cx| {
            if let Ok((schemas, tables)) = fut.await {
                this.update(cx, |v, cx| {
                    v.schemas = schemas;
                    v.tables = tables.into_iter().map(|t| t.name).collect();
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
        this
    }

    fn push(&mut self, col: NewColumn, window: &mut Window, cx: &mut Context<Self>) {
        let mk = |ph: &str, v: &str, window: &mut Window, cx: &mut Context<Self>| {
            let (ph, v) = (ph.to_string(), v.to_string());
            let e = cx.new(|cx| {
                let mut s = InputState::new(window, cx).placeholder(ph);
                s.set_value(v, window, cx);
                s
            });
            cx.subscribe(&e, |_, _, _: &InputEvent, cx| cx.notify()).detach();
            e
        };
        let name = mk("column_name", &col.name, window, cx);
        let default = mk("NULL", &col.default, window, cx);
        let fk_column = mk("column", col.references.as_ref().map(|r| r.1.as_str()).unwrap_or("id"), window, cx);
        self.columns.push(ColRow { col, name, default, fk_column });
        cx.notify();
    }

    fn collect(&self, cx: &gpui::App) -> Vec<NewColumn> {
        self.columns
            .iter()
            .map(|r| {
                let mut c = r.col.clone();
                c.name = r.name.read(cx).value().to_string();
                c.default = r.default.read(cx).value().to_string();
                if let Some(rf) = c.references.as_mut() {
                    rf.1 = r.fk_column.read(cx).value().to_string();
                }
                c
            })
            .collect()
    }

    fn submit(&mut self, cx: &mut Context<Self>) {
        let table = self.name.read(cx).value().trim().to_string();
        if table.is_empty() || self.creating {
            return;
        }
        let cols = if self.db_type == "mongodb" { Vec::new() } else { self.collect(cx) };
        let sql = create_table_sql(self.db_type, &self.session, &self.schema, &table, &cols);
        let mongo = self.db_type == "mongodb";
        self.creating = true;
        cx.notify();
        let this = cx.entity().downgrade();
        let spec = self.spec.clone();
        let schema = self.schema.clone();
        let msg = if mongo { format!("Collection \"{table}\" created successfully") } else { format!("Table \"{table}\" created successfully") };
        actions::run(&self.session, sql, msg, if mongo { "Failed to create collection" } else { "Failed to create table" }, cx, move |ok, cx| {
            this.update(cx, |v, cx| {
                v.creating = false;
                cx.notify();
            })
            .ok();
            if ok {
                cx.update(|cx| {
                    emit_studio(StudioEvent::CloseTab(spec.clone()), cx);
                    open_tab(TabSpec::Table { schema: schema.clone(), table: table.clone() }, cx);
                });
            }
        });
    }

    fn toggle_btn(&self, id: String, label: &'static str, icon: IconName, on: bool, color: Hsla, f: fn(&mut NewColumn), i: usize, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        div()
            .id(SharedString::from(id))
            .flex()
            .items_center()
            .gap(px(6.))
            .px_2()
            .py(px(6.))
            .rounded(px(4.))
            .cursor_pointer()
            .when(on, |d| d.text_color(color).bg(with_alpha(color, 0.1)))
            .when(!on, |d| d.text_color(t.muted_foreground).hover(|s| s.bg(t.muted)))
            .on_click(cx.listener(move |v, _, _, cx| {
                if let Some(r) = v.columns.get_mut(i) {
                    f(&mut r.col);
                    if r.col.is_primary {
                        for (j, o) in v.columns.iter_mut().enumerate() {
                            if j != i && label == "PK" {
                                o.col.is_primary = false;
                            }
                        }
                    }
                }
                cx.notify();
            }))
            .child(Icon::new(icon).size(px(14.)))
            .child(div().tw_text_xs().font_weight(FontWeight::BOLD).child(label))
    }
}

fn toggle_pk(c: &mut NewColumn) {
    c.is_primary = !c.is_primary;
}
fn toggle_null(c: &mut NewColumn) {
    c.is_nullable = !c.is_nullable;
}
fn toggle_unique(c: &mut NewColumn) {
    c.is_unique = !c.is_unique;
}

impl Render for CreateTableView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let mongo = self.db_type == "mongodb";
        let table_name = self.name.read(cx).value().to_string();
        let submit = submit_button("tbl-submit", if mongo { "Create Collection" } else { "Create Table" }, "Creating...", self.creating, table_name.trim().is_empty() || self.creating, {
            let this = cx.entity();
            move |_, cx| this.update(cx, |v, cx| v.submit(cx))
        });
        let this = cx.entity();
        let label = |s: &str| div().tw_text_xs().text_color(t.muted_foreground).child(rexa_ui::tracked_text::tracked(s.to_string(), 0.05));
        let small_label = |s: &str| div().tw_text_xs().text_color(t.muted_foreground).font_weight(FontWeight::SEMIBOLD).child(s.to_string());
        let top = div()
            .flex()
            .gap_8()
            .child(
                div().flex_1().flex().flex_col().gap_3().child(label(if mongo { "Database" } else { "Schema" })).child({
                    let this = this.clone();
                    Select::new("tbl-schema").w_full().placeholder("Select schema").options(self.schemas.iter().map(|s| SelectOption::simple(s.clone()))).value(Some(self.schema.clone())).on_change(move |v, _, cx| {
                        this.update(cx, |s, cx| {
                            s.schema = v.to_string();
                            cx.notify();
                        })
                    })
                }),
            )
            .child(div().flex_1().flex().flex_col().gap_3().child(label(if mongo { "Collection Name" } else { "Table Name" })).child(div().tw_text_xs().child(TextInput::new(&self.name).h(40.))));
        let mut body = div().flex().flex_col().gap_8().child(top);
        if !mongo {
            let types = column_types::for_db(self.db_type);
            let n = self.columns.len();
            let blue = tw("blue-500");
            let mut rows = div().flex().flex_col().gap_3();
            for (i, r) in self.columns.iter().enumerate() {
                let c = &r.col;
                let fk_tables: Vec<SelectOption> = std::iter::once(SelectOption::new("none", "No reference")).chain(self.tables.iter().filter(|x| **x != table_name).map(|x| SelectOption::simple(x.clone()))).collect();
                let (t1, t2) = (this.clone(), this.clone());
                rows = rows.child(
                    div()
                        .flex()
                        .items_end()
                        .gap_4()
                        .p_4()
                        .tw_rounded_lg()
                        .border_1()
                        .border_color(t.border)
                        .bg(with_alpha(t.muted, 0.2))
                        .hover(|s| s.bg(with_alpha(t.muted, 0.3)))
                        .child(
                            div()
                                .flex()
                                .items_end()
                                .gap_4()
                                .flex_1()
                                .min_w_0()
                                .child(div().flex_basis(px(0.)).flex_grow(2.).min_w_0().flex().flex_col().gap(px(6.)).child(small_label("Name")).child(div().tw_text_xs().child(TextInput::new(&r.name).h(36.))))
                                .child(div().flex_basis(px(0.)).flex_grow(3.).min_w_0().flex().flex_col().gap(px(6.)).child(small_label("Type")).child(
                                    Select::new(("tbl-type", i)).w_full().options(types.iter().map(|x| SelectOption::simple(x.to_string()))).value(Some(c.r#type.clone())).on_change(move |v, _, cx| {
                                        t1.update(cx, |s, cx| {
                                            if let Some(r) = s.columns.get_mut(i) {
                                                r.col.r#type = v.to_string();
                                            }
                                            cx.notify();
                                        })
                                    }),
                                ))
                                .child(div().flex_basis(px(0.)).flex_grow(2.).min_w_0().flex().flex_col().gap(px(6.)).child(small_label("Default")).child(div().tw_text_xs().font_family(MONO).child(TextInput::new(&r.default).h(36.))))
                                .child(
                                    div()
                                        .flex_basis(px(0.))
                                        .flex_grow(3.)
                                        .min_w_0()
                                        .flex()
                                        .flex_col()
                                        .gap(px(6.))
                                        .child(div().flex().items_center().gap_1().tw_text_xs().text_color(t.muted_foreground).font_weight(FontWeight::SEMIBOLD).child(Icon::new(IconName::Link).size(px(10.))).child("Foreign Key"))
                                        .child(
                                            div()
                                                .flex()
                                                .gap(px(6.))
                                                .child(div().flex_1().min_w_0().child(
                                                    Select::new(("tbl-fk", i)).w_full().placeholder("No reference").options(fk_tables).value(Some(c.references.as_ref().map(|r| r.0.clone()).unwrap_or_else(|| "none".into()))).on_change(move |v, _, cx| {
                                                        t2.update(cx, |s, cx| {
                                                            if let Some(r) = s.columns.get_mut(i) {
                                                                r.col.references = if v == "none" { None } else { Some((v.to_string(), r.col.references.as_ref().map(|x| x.1.clone()).unwrap_or_else(|| "id".into()))) };
                                                            }
                                                            cx.notify();
                                                        })
                                                    }),
                                                ))
                                                .when(c.references.is_some(), |d| d.child(div().w(px(96.)).tw_text_xs().child(TextInput::new(&r.fk_column).h(36.)))),
                                        ),
                                ),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .flex_shrink_0()
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .bg(t.background)
                                        .tw_rounded_lg()
                                        .border_1()
                                        .border_color(t.border)
                                        .p_1()
                                        .gap_1()
                                        .child(self.toggle_btn(format!("pk-{i}"), "PK", IconName::Database, c.is_primary, tw("yellow-500"), toggle_pk, i, cx))
                                        .child(div().w(px(1.)).h_4().bg(t.border))
                                        .child(self.toggle_btn(format!("nn-{i}"), "NotNull", if c.is_nullable { IconName::Square } else { IconName::SquareCheck }, !c.is_nullable, blue, toggle_null, i, cx))
                                        .child(div().w(px(1.)).h_4().bg(t.border))
                                        .child(self.toggle_btn(format!("uq-{i}"), "Unique", IconName::Hash, c.is_unique, tw("purple-500"), toggle_unique, i, cx)),
                                )
                                .child(
                                    Button::new(("tbl-rm", i))
                                        .ghost()
                                        .size(ButtonSize::Icon)
                                        .colors(gpui::transparent_black(), with_alpha(t.destructive, 0.05), t.muted_foreground)
                                        .icon(IconName::Trash)
                                        .disabled(n == 1)
                                        .on_click(cx.listener(move |v, _, _, cx| {
                                            if v.columns.len() > 1 {
                                                v.columns.remove(i);
                                                cx.notify();
                                            }
                                        })),
                                ),
                        ),
                );
            }
            let db_type = self.db_type;
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .justify_between()
                            .border_b_1()
                            .border_color(t.border)
                            .pb_2()
                            .child(label("Columns"))
                            .child(Button::new("tbl-add-col").ghost().size(ButtonSize::Sm).colors(gpui::transparent_black(), with_alpha(blue, 0.05), blue).icon(IconName::Plus).label("Add column").on_click(cx.listener(move |v, _, w, cx| {
                                let ty = column_types::for_db(db_type).first().copied().unwrap_or("TEXT");
                                v.push(NewColumn { r#type: ty.into(), is_nullable: true, ..Default::default() }, w, cx);
                            }))),
                    )
                    .child(rows),
            );
        }
        let desc = if mongo { "Create a collection in" } else { "Define columns and constraints for your new table in" };
        shell("create-table", if mongo { "Create a new collection" } else { "Create a new table" }, desc, Some(&self.schema), 896., submit, body.into_any_element(), cx)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn sqlite_types() {
        assert_eq!(super::to_sqlite_type("serial"), "INTEGER");
        assert_eq!(super::sqlite_default("now()", "TEXT"), "CURRENT_TIMESTAMP");
        assert_eq!(super::sqlite_default("abc", "TEXT"), "'abc'");
    }
}
