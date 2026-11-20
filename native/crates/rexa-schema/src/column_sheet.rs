//! Port of components/studio/grid/{add-column-sheet,edit-column-sheet,
//! column-sheet-common,column-sheet-shell}.tsx with the studio's
//! `handleAddColumn` / `handleEditColumn` SQL (hooks/use-studio.ts).
//!
//! Public API (for rexa-grid and others):
//! - [`open_add_column_sheet`]`(target, on_done, cx)` — "Add column".
//! - [`open_edit_column_sheet`]`(target, column, on_done, cx)` — "Edit column".
//! `on_done` runs after a successful change (refresh the grid there).
//!
//! Approximations: the sheet opens window-level through `rexa_ui::open_sheet`
//! (the original is `contained` in the table area) at rexa-ui's sheet width; the
//! dirty-close confirm (`confirmSheetClose`) and review mode are not ported.

use crate::actions::{dq, sq};
use crate::column_types;
use crate::common;
use crate::sheet::StudioSheet;
use gpui::{div, prelude::*, px, AnyElement, App, AppContext, Context, Entity, FontWeight, SharedString, Window};
use rexa_core::{runtime, Session};
use rexa_drivers::ddl::FK_ACTIONS;
use rexa_drivers::{ColumnDetail, EnumType, ForeignKey, TableRef};
use rexa_ui::widgets::{Icon, InputEvent, InputState};
use rexa_ui::{tw, with_alpha, ActiveTokens, Button, ButtonSize, IconName, Select, SelectOption, Spinner, Switch, TextInput, Toast, Tw, MONO};
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

/// The table a column sheet edits.
#[derive(Clone)]
pub struct ColumnSheetTarget {
    pub session: Arc<Session>,
    pub schema: String,
    pub table: String,
}

type Done = Rc<dyn Fn(&mut App)>;

/// Open "Add new column" for `target`.
pub fn open_add_column_sheet(target: ColumnSheetTarget, on_done: impl Fn(&mut App) + 'static, cx: &mut App) {
    open(target, None, Rc::new(on_done), cx);
}

/// Open "Edit column" for `column` of `target`.
pub fn open_edit_column_sheet(target: ColumnSheetTarget, column: String, on_done: impl Fn(&mut App) + 'static, cx: &mut App) {
    open(target, Some(column), Rc::new(on_done), cx);
}

fn open(target: ColumnSheetTarget, column: Option<String>, done: Done, cx: &mut App) {
    let slot: Rc<RefCell<Option<Entity<ColumnSheet>>>> = Rc::default();
    rexa_ui::open_sheet(cx, rexa_ui::Side::Right, move |window, cx| {
        let entity = slot
            .borrow_mut()
            .get_or_insert_with(|| {
                let (t, c, d) = (target.clone(), column.clone(), done.clone());
                cx.new(|cx| ColumnSheet::new(t, c, d, window, cx))
            })
            .clone();
        rexa_ui::Sheet::new().hide_close().child(div().size_full().child(entity))
    });
}

struct Fk {
    enabled: bool,
    schema: String,
    table: String,
    column: String,
    on_update: String,
    on_delete: String,
    schemas: Vec<String>,
    tables: Vec<String>,
    columns: Vec<String>,
}

pub struct ColumnSheet {
    target: ColumnSheetTarget,
    db_type: &'static str,
    /// Edit mode: the column being edited.
    editing: Option<String>,
    current: Option<ColumnDetail>,
    existing_fk: Option<ForeignKey>,
    enums: Vec<EnumType>,
    name: Entity<InputState>,
    default: Entity<InputState>,
    check: Entity<InputState>,
    r#type: String,
    nullable: bool,
    primary: bool,
    unique: bool,
    unique_touched: bool,
    check_touched: bool,
    is_array: bool,
    create_more: bool,
    fk: Fk,
    busy: bool,
    done: Done,
}

fn input(ph: &str, window: &mut Window, cx: &mut Context<ColumnSheet>) -> Entity<InputState> {
    let ph = ph.to_string();
    let e = cx.new(|cx| InputState::new(window, cx).placeholder(ph));
    cx.subscribe(&e, |_, _, _: &InputEvent, cx| cx.notify()).detach();
    e
}

impl ColumnSheet {
    fn new(target: ColumnSheetTarget, editing: Option<String>, done: Done, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let db_type = common::db_type(&target.session);
        let types = column_types::for_db(db_type);
        let name = input(editing.as_deref().unwrap_or("column_name"), window, cx);
        let default = input(if editing.is_some() { "Leave empty to drop default" } else { "NULL" }, window, cx);
        let check = input(if editing.is_some() { "e.g. price > 0" } else { "length(\"column_name\") < 500" }, window, cx);
        cx.subscribe(&check, |v: &mut Self, _, e: &InputEvent, _cx| {
            if matches!(e, InputEvent::Change) {
                v.check_touched = true;
            }
        })
        .detach();
        let mut this = ColumnSheet {
            db_type,
            editing: editing.clone(),
            current: None,
            existing_fk: None,
            enums: Vec::new(),
            name,
            default,
            check,
            r#type: if editing.is_some() { column_types::POSTGRES_EDIT[0].into() } else { types.first().copied().unwrap_or("TEXT").into() },
            nullable: true,
            primary: false,
            unique: false,
            unique_touched: false,
            check_touched: false,
            is_array: false,
            create_more: false,
            fk: Fk { enabled: false, schema: target.schema.clone(), table: String::new(), column: String::new(), on_update: "NO ACTION".into(), on_delete: "NO ACTION".into(), schemas: Vec::new(), tables: Vec::new(), columns: Vec::new() },
            busy: false,
            done,
            target,
        };
        this.load_schemas(cx);
        if let Some(col) = editing {
            this.name.update(cx, |s, cx| s.set_value(col.clone(), window, cx));
            this.load_current(col, cx);
        }
        this
    }

    fn mongo(&self) -> bool {
        self.db_type == "mongodb"
    }

    fn load_schemas(&mut self, cx: &mut Context<Self>) {
        let fut = common::load_schemas(&self.target.session);
        cx.spawn(async move |this, cx| {
            if let Ok(s) = fut.await {
                this.update(cx, |v, cx| {
                    v.fk.schemas = s;
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }

    /// The edit sheet's initial state (`useEffect` on open).
    fn load_current(&mut self, col: String, cx: &mut Context<Self>) {
        let d = self.target.session.driver.clone();
        let tr = TableRef::new(self.target.schema.clone(), self.target.table.clone());
        let fut = runtime::spawn(async move {
            let cols = d.table_structure(&tr).await?;
            let fks = d.foreign_keys(&tr).await.unwrap_or_default();
            let enums = d.enums().await.unwrap_or_default();
            Ok((cols, fks, enums))
        });
        cx.spawn_in_window(fut, move |v, (cols, fks, enums), window, cx| {
            let current = cols.into_iter().find(|c| c.column_name == col);
            if let Some(c) = &current {
                let ty = Self::normalize_type(if c.data_type.is_empty() { c.udt_name.as_deref().unwrap_or("") } else { &c.data_type });
                v.r#type = if ty.is_empty() { column_types::POSTGRES_EDIT[0].into() } else { ty };
                v.nullable = c.is_nullable;
                v.primary = c.is_primary_key;
                let def = c.column_default.clone().unwrap_or_default();
                v.default.update(cx, |s, cx| s.set_value(def, window, cx));
            }
            v.current = current;
            v.existing_fk = fks.into_iter().find(|f| f.column_name == col);
            if let Some(f) = v.existing_fk.clone() {
                v.fk.enabled = true;
                v.fk.schema = if f.foreign_table_schema.is_empty() { v.target.schema.clone() } else { f.foreign_table_schema };
                v.fk.table = f.foreign_table_name;
                v.fk.column = f.foreign_column_name;
                v.load_fk_tables(cx);
            }
            v.enums = enums;
            v.check_touched = false;
        });
    }

    fn normalize_type(t: &str) -> String {
        let t = t.trim();
        column_types::POSTGRES_EDIT.iter().find(|x| x.eq_ignore_ascii_case(t)).map(|x| x.to_string()).unwrap_or_else(|| t.to_string())
    }

    fn load_fk_tables(&mut self, cx: &mut Context<Self>) {
        if self.fk.schema.is_empty() {
            return;
        }
        let d = self.target.session.driver.clone();
        let s = self.fk.schema.clone();
        let fut = runtime::spawn(async move { d.tables(&s).await });
        cx.spawn(async move |this, cx| {
            if let Ok(t) = fut.await {
                this.update(cx, |v, cx| {
                    v.fk.tables = t.into_iter().map(|t| t.name).collect();
                    v.load_fk_columns(cx);
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }

    fn load_fk_columns(&mut self, cx: &mut Context<Self>) {
        if self.fk.table.is_empty() {
            return;
        }
        let d = self.target.session.driver.clone();
        let tr = TableRef::new(self.fk.schema.clone(), self.fk.table.clone());
        let fut = runtime::spawn(async move { d.table_structure(&tr).await });
        cx.spawn(async move |this, cx| {
            if let Ok(c) = fut.await {
                this.update(cx, |v, cx| {
                    v.fk.columns = c.into_iter().map(|c| c.column_name).filter(|c| !c.is_empty()).collect();
                    if !v.fk.columns.is_empty() && !v.fk.columns.contains(&v.fk.column) {
                        v.fk.column = if v.fk.columns.iter().any(|c| c == "id") { "id".into() } else { v.fk.columns[0].clone() };
                    }
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }

    fn reset(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        for e in [&self.name, &self.default, &self.check] {
            e.update(cx, |s, cx| s.set_value("", window, cx));
        }
        self.r#type = column_types::for_db(self.db_type).first().copied().unwrap_or("TEXT").into();
        self.nullable = true;
        self.primary = false;
        self.unique = false;
        self.is_array = false;
        self.fk.enabled = false;
        self.fk.schema = self.target.schema.clone();
        self.fk.table.clear();
        self.fk.column.clear();
        self.fk.on_update = "NO ACTION".into();
        self.fk.on_delete = "NO ACTION".into();
    }

    fn qi(&self, s: &str) -> String {
        self.target.session.driver.quote_ident(s)
    }

    fn tref(&self, s: &str, t: &str) -> String {
        self.target.session.driver.dialect().table_ref(s, t)
    }

    /// `handleAddColumn`.
    fn add_sql(&self, cx: &App) -> Result<String, String> {
        let (schema, table) = (&self.target.schema, &self.target.table);
        let name = self.name.read(cx).value().trim().to_string();
        let default_raw = self.default.read(cx).value().trim().to_string();
        if self.mongo() {
            let dv = if default_raw.is_empty() { serde_json::Value::Null } else { serde_json::Value::String(default_raw) };
            let mut set = serde_json::Map::new();
            set.insert(name, dv);
            return Ok(serde_json::to_string_pretty(&serde_json::json!({"operation": "updateMany", "database": schema, "collection": table, "filter": {}, "update": {"$set": set}})).unwrap_or_default());
        }
        let db = self.db_type;
        let raw_type = if self.r#type.trim().is_empty() { "TEXT".to_string() } else { self.r#type.trim().to_string() };
        let base = if matches!(db, "mysql" | "clickhouse" | "mssql") || !self.is_array { raw_type } else { format!("{raw_type}[]") };
        let type_clause = if db == "clickhouse" && self.nullable && !base.to_lowercase().starts_with("nullable") { format!("Nullable({base})") } else { base };
        let nullable = if db == "clickhouse" { "" } else if self.primary || !self.nullable { "NOT NULL" } else { "NULL" };
        let auto_inc = db == "mysql" && default_raw.to_lowercase().contains("auto_increment");
        let identity = db == "mssql" && default_raw.to_lowercase().starts_with("identity");
        let default = if !auto_inc && !identity && !default_raw.is_empty() { format!(" DEFAULT {default_raw}") } else { String::new() };
        let check = self.check.read(cx).value().trim().to_string();
        let check = if check.is_empty() { String::new() } else { format!(" CHECK ({check})") };
        let fk = if self.fk.enabled && !self.fk.table.is_empty() && !self.fk.column.is_empty() {
            format!(" REFERENCES {} ({}) ON UPDATE {} ON DELETE {}", self.tref(&self.fk.schema, &self.fk.table), self.qi(&self.fk.column), self.fk.on_update, self.fk.on_delete)
        } else {
            String::new()
        };
        if db == "sqlite" && (self.primary || self.unique) {
            return Err("SQLite does not support adding PRIMARY KEY or UNIQUE via ALTER TABLE ADD COLUMN.".into());
        }
        Ok(format!(
            "ALTER TABLE {} {} {} {type_clause}{} {nullable}{default}{}{}{}{check}{fk};",
            self.tref(schema, table),
            if db == "mssql" { "ADD" } else { "ADD COLUMN" },
            self.qi(&name),
            if identity { format!(" {default_raw}") } else { String::new() },
            if self.primary { " PRIMARY KEY" } else { "" },
            if self.unique { " UNIQUE" } else { "" },
            if auto_inc { " AUTO_INCREMENT" } else { "" },
        ))
    }

    /// `handleEditColumn` (Postgres; Mongo renames the field).
    fn edit_sql(&self, cx: &App) -> Result<Vec<String>, String> {
        let original = self.editing.clone().unwrap_or_default();
        let (schema, table) = (self.target.schema.clone(), self.target.table.clone());
        let new_name = self.name.read(cx).value().trim().to_string();
        if self.mongo() {
            if new_name == original {
                return Ok(vec![]);
            }
            let mut ren = serde_json::Map::new();
            ren.insert(original, serde_json::Value::String(new_name));
            return Ok(vec![serde_json::to_string_pretty(&serde_json::json!({"operation": "updateMany", "database": schema, "collection": table, "filter": {}, "update": {"$rename": ren}})).unwrap_or_default()]);
        }
        if !matches!(self.db_type, "postgres" | "supabase-mgmt") {
            return Err("Editing column constraints is supported only for PostgreSQL.".into());
        }
        let tref = format!("{}.{}", dq(&schema), dq(&table));
        let cur = self.current.clone().unwrap_or_default();
        let cur_type = if cur.data_type.is_empty() { cur.udt_name.clone().unwrap_or_default() } else { cur.data_type.clone() };
        let cur_default = cur.column_default.clone().unwrap_or_default().trim().to_string();
        let desired_type = if self.r#type.trim().is_empty() { cur_type.clone() } else { self.r#type.trim().to_string() };
        let desired_default = self.default.read(cx).value().trim().to_string();
        let desired_check = self.check.read(cx).value().trim().to_string();
        let mut out = Vec::new();
        let mut working = original.clone();
        if new_name != original {
            out.push(format!("ALTER TABLE {tref} RENAME COLUMN {} TO {};", dq(&original), dq(&new_name)));
            working = new_name.clone();
        }
        let w = dq(&working);
        if !desired_type.is_empty() && !desired_type.eq_ignore_ascii_case(&cur_type) {
            out.push(format!("ALTER TABLE {tref} ALTER COLUMN {w} TYPE {desired_type};"));
        }
        if self.nullable != cur.is_nullable {
            out.push(format!("ALTER TABLE {tref} ALTER COLUMN {w} {};", if self.nullable { "DROP NOT NULL" } else { "SET NOT NULL" }));
        }
        if desired_default != cur_default {
            out.push(if desired_default.is_empty() { format!("ALTER TABLE {tref} ALTER COLUMN {w} DROP DEFAULT;") } else { format!("ALTER TABLE {tref} ALTER COLUMN {w} SET DEFAULT {desired_default};") });
        }
        let lit = |s: &str| s.replace('\'', "''");
        let (sl, tl, cl) = (lit(&schema), lit(&table), lit(&working));
        let constraint_match = |ty: char| format!("SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey) WHERE c.contype = '{ty}' AND n.nspname = '{sl}' AND t.relname = '{tl}' AND a.attname = '{cl}' AND array_length(c.conkey, 1) = 1");
        let drop_constraint = |ty: char| format!("DO $$\nDECLARE r record;\nBEGIN\n  FOR r IN {}\n  LOOP\n    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', '{sl}', '{tl}', r.conname);\n  END LOOP;\nEND $$;", constraint_match(ty));
        let cname = |prefix: &str| {
            let base: String = format!("{prefix}_{table}_{working}").chars().map(|c| if c.is_ascii_alphanumeric() || c == '_' { c } else { '_' }).take(40).collect();
            format!("{base}_{}", &rand_suffix())
        };
        if self.primary && !cur.is_primary_key {
            out.push(format!("ALTER TABLE {tref} ADD CONSTRAINT {} PRIMARY KEY ({w});", dq(&cname("pk"))));
        }
        if !self.primary && cur.is_primary_key {
            out.push(drop_constraint('p'));
        }
        if self.unique_touched && self.unique {
            let n = cname("uq");
            out.push(format!(
                "DO $$\nBEGIN\n  IF NOT EXISTS ({}) THEN\n    EXECUTE format('ALTER TABLE %I.%I ADD CONSTRAINT %I UNIQUE (%I)', '{sl}', '{tl}', '{n}', '{cl}');\n  END IF;\nEND $$;",
                constraint_match('u').replacen("SELECT conname", "SELECT 1", 1)
            ));
        } else if self.unique_touched {
            out.push(drop_constraint('u'));
        }
        if self.check_touched && !desired_check.is_empty() {
            out.push(format!("ALTER TABLE {tref} ADD CONSTRAINT {} CHECK ({desired_check});", dq(&cname("chk"))));
        } else if self.check_touched {
            out.push(drop_constraint('c'));
        }
        let fk_on = self.fk.enabled && !self.fk.table.is_empty() && !self.fk.column.is_empty();
        let matches = fk_on && self.existing_fk.as_ref().is_some_and(|e| e.foreign_table_schema == self.fk.schema && e.foreign_table_name == self.fk.table && e.foreign_column_name == self.fk.column);
        if fk_on && !matches {
            if self.existing_fk.is_some() {
                out.push(drop_constraint('f'));
            }
            out.push(format!(
                "ALTER TABLE {tref} ADD CONSTRAINT {} FOREIGN KEY ({w}) REFERENCES {}.{} ({}) ON UPDATE {} ON DELETE {};",
                dq(&cname("fk")),
                dq(&self.fk.schema),
                dq(&self.fk.table),
                dq(&self.fk.column),
                self.fk.on_update,
                self.fk.on_delete
            ));
        }
        if !self.fk.enabled && self.existing_fk.is_some() {
            out.push(drop_constraint('f'));
        }
        let _ = sq;
        Ok(out)
    }

    fn submit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.name.read(cx).value().trim().is_empty() || self.busy {
            return;
        }
        let (stmts, success, fallback) = if self.editing.is_some() {
            match self.edit_sql(cx) {
                Ok(s) if s.is_empty() => {
                    rexa_ui::close_top(cx);
                    return;
                }
                Ok(s) => {
                    let orig = self.editing.clone().unwrap_or_default();
                    let msg = if self.mongo() { format!("Field \"{orig}\" renamed to \"{}\"", self.name.read(cx).value().trim()) } else { format!("Column \"{orig}\" updated successfully") };
                    (s, msg, "Failed to edit column")
                }
                Err(e) => {
                    Toast::error(e).show(cx);
                    return;
                }
            }
        } else {
            match self.add_sql(cx) {
                Ok(s) => {
                    let n = self.name.read(cx).value().trim().to_string();
                    (vec![s], if self.mongo() { format!("Field \"{n}\" added successfully") } else { format!("Column \"{n}\" added successfully") }, "Failed to add column")
                }
                Err(e) => {
                    Toast::error(e).show(cx);
                    return;
                }
            }
        };
        self.busy = true;
        cx.notify();
        let d = self.target.session.driver.clone();
        let mongo = self.mongo();
        let fut = runtime::spawn(async move {
            for s in stmts {
                if mongo {
                    d.execute(&s, 1).await?;
                } else {
                    let r = d.execute_script(&s, 1).await?;
                    if let Some(e) = r.error {
                        anyhow::bail!(e.message);
                    }
                }
            }
            Ok(())
        });
        let more = self.create_more && self.editing.is_none();
        let _ = window;
        cx.spawn_in_window(fut, move |v, _: (), window, cx| {
            Toast::success(success.clone()).show(cx);
            (v.done)(cx);
            if more {
                v.reset(window, cx);
            } else {
                rexa_ui::close_top(cx);
            }
        });
        let _ = fallback;
    }

    fn switch_row(&self, id: &str, title: &str, desc: &str, on: bool, disabled: bool, f: fn(&mut Self, bool), cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let this = cx.entity();
        div()
            .flex()
            .items_start()
            .gap(px(10.))
            .tw_rounded_lg()
            .border_1()
            .border_color(t.var_or("--studio-border", t.border))
            .bg(with_alpha(t.muted, 0.1))
            .p(px(10.))
            .child(div().mt(px(2.)).child(Switch::new(SharedString::from(id.to_string())).checked(on).disabled(disabled).on_change(move |v, _, cx| {
                this.update(cx, |s, cx| {
                    f(s, v);
                    cx.notify();
                })
            })))
            .child(div().child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child(title.to_string())).child(div().tw_text_xs().text_color(t.muted_foreground).child(desc.to_string())))
            .into_any_element()
    }

    fn fk_select(&self, id: &'static str, placeholder: &str, options: Vec<String>, value: &str, f: fn(&mut Self, String, &mut Context<Self>), cx: &mut Context<Self>) -> AnyElement {
        let this = cx.entity();
        Select::new(id)
            .w_full()
            .small()
            .placeholder(placeholder.to_string())
            .options(options.into_iter().map(SelectOption::simple))
            .value(Some(value.to_string()).filter(|s| !s.is_empty()))
            .on_change(move |v, _, cx| {
                this.update(cx, |s, cx| {
                    f(s, v.to_string(), cx);
                    cx.notify();
                })
            })
            .into_any_element()
    }

    fn fk_section(&self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let lbl = |s: &str| div().tw_text_xs().font_weight(FontWeight::MEDIUM).child(s.to_string());
        let this = cx.entity();
        let toggle = div()
            .flex()
            .items_center()
            .justify_between()
            .tw_rounded_lg()
            .border_1()
            .border_color(t.var_or("--studio-border", t.border))
            .bg(with_alpha(t.muted, 0.1))
            .px(px(10.))
            .py(px(6.))
            .child(div().flex().items_center().gap(px(6.)).child(Icon::new(IconName::Link).size(px(14.)).text_color(t.primary)).child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child(if self.editing.is_some() { "Reference another table" } else { "Add foreign key" })))
            .child(Switch::new("cs-fk").checked(self.fk.enabled).on_change(move |v, _, cx| {
                this.update(cx, |s, cx| {
                    s.fk.enabled = v;
                    if v {
                        if s.fk.schema.is_empty() {
                            s.fk.schema = s.target.schema.clone();
                        }
                        s.load_fk_tables(cx);
                    } else {
                        s.fk.table.clear();
                        s.fk.column.clear();
                    }
                    cx.notify();
                })
            }));
        let actions: Vec<String> = FK_ACTIONS.iter().map(|a| a.to_string()).collect();
        let grid = self.fk.enabled.then(|| {
            div()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    div()
                        .flex()
                        .gap_3()
                        .child(div().flex_1().flex().flex_col().gap(px(6.)).child(lbl("Schema")).child(self.fk_select("cs-fk-schema", "Select schema", self.fk.schemas.clone(), &self.fk.schema, |s, v, cx| {
                            s.fk.schema = v;
                            s.fk.table.clear();
                            s.fk.column.clear();
                            s.load_fk_tables(cx);
                        }, cx)))
                        .child(div().flex_1().flex().flex_col().gap(px(6.)).child(lbl("Referenced Table")).child(self.fk_select("cs-fk-table", "Select table", self.fk.tables.clone(), &self.fk.table, |s, v, cx| {
                            s.fk.table = v;
                            s.fk.column.clear();
                            s.load_fk_columns(cx);
                        }, cx))),
                )
                .child(
                    div()
                        .flex()
                        .gap_3()
                        .child(div().flex_1().flex().flex_col().gap(px(6.)).child(lbl("Referenced Column")).child(self.fk_select("cs-fk-col", "Select column", self.fk.columns.clone(), &self.fk.column, |s, v, _| s.fk.column = v, cx)))
                        .child(div().flex_1().flex().flex_col().gap(px(6.)).child(lbl("On Update")).child(self.fk_select("cs-fk-upd", "", actions.clone(), &self.fk.on_update, |s, v, _| s.fk.on_update = v, cx))),
                )
                .child(div().flex().flex_col().gap(px(6.)).child(lbl("On Delete")).child(self.fk_select("cs-fk-del", "", actions.clone(), &self.fk.on_delete, |s, v, _| s.fk.on_delete = v, cx)))
        });
        div().flex().flex_col().gap_4().child(toggle).children(grid).into_any_element()
    }

    fn section(title: &str, hint: Option<&str>, body: AnyElement, cx: &App) -> AnyElement {
        let t = cx.tokens();
        div()
            .flex()
            .gap_3()
            .px_4()
            .py_4()
            .border_b_1()
            .border_color(t.border)
            .child(div().w(px(120.)).flex_shrink_0().flex().flex_col().gap(px(6.)).child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(title.to_string())).children(hint.map(|h| div().tw_text_xs().text_color(t.muted_foreground).child(h.to_string()))))
            .child(div().flex_1().min_w_0().child(body))
            .into_any_element()
    }
}

impl Render for ColumnSheet {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let mongo = self.mongo();
        let sqlite = self.db_type == "sqlite";
        let name_empty = self.name.read(cx).value().trim().is_empty();
        let fk_ok = !self.fk.enabled || (!self.fk.schema.is_empty() && !self.fk.table.is_empty() && !self.fk.column.is_empty());
        let can_submit = !name_empty && fk_ok && !self.busy;
        let lbl = |s: &str| div().tw_text_xs().font_weight(FontWeight::MEDIUM).child(s.to_string());
        let hint = |s: &str| div().tw_text_xs().text_color(t.muted_foreground).child(s.to_string());
        let this = cx.entity();
        let type_options: Vec<String> = if self.editing.is_some() {
            let mut o: Vec<String> = column_types::POSTGRES_EDIT.iter().map(|s| s.to_string()).chain(self.enums.iter().map(|e| format!("{}.{}", e.schema, e.name))).collect();
            if !o.iter().any(|x| x.eq_ignore_ascii_case(&self.r#type)) {
                o.insert(0, self.r#type.clone());
            }
            o
        } else {
            column_types::for_db(self.db_type).iter().map(|s| s.to_string()).collect()
        };
        let type_select = {
            let this = this.clone();
            Select::with_search("cs-type").w_full().small().search_threshold(0).placeholder("Choose a column type...").options(type_options.into_iter().map(SelectOption::simple)).value(Some(self.r#type.clone())).on_change(move |v, _, cx| {
                this.update(cx, |s, cx| {
                    s.r#type = v.to_string();
                    cx.notify();
                })
            })
        };
        let small_input = |e: &Entity<InputState>, mono: bool| div().tw_text_xs().when(mono, |d| d.font_family(MONO)).child(TextInput::new(e).h(32.));

        let sheet = if self.editing.is_some() {
            let target = format!("{}.{}", self.target.schema, self.target.table);
            let row = |label: &str, on: bool, id: &str, f: fn(&mut Self, bool), cx: &mut Context<Self>| {
                let this = cx.entity();
                div().flex().items_center().justify_between().child(div().tw_text_xs().text_color(t.muted_foreground).child(label.to_string())).child(Switch::new(SharedString::from(id.to_string())).checked(on).on_change(move |v, _, cx| {
                    this.update(cx, |s, cx| {
                        f(s, v);
                        cx.notify();
                    })
                }))
            };
            let mut body = div().flex().flex_col().gap_3().child(div().flex().flex_col().gap(px(6.)).child(div().tw_text_xs().text_color(t.muted_foreground).child("Column name")).child(small_input(&self.name, false)));
            if !mongo {
                body = body
                    .child(div().flex().flex_col().gap(px(6.)).child(div().tw_text_xs().text_color(t.muted_foreground).child("Data type")).child(type_select))
                    .child(div().flex().flex_col().gap(px(6.)).child(div().tw_text_xs().text_color(t.muted_foreground).child("Default")).child(small_input(&self.default, true)))
                    .child(
                        div().flex().flex_col().gap(px(6.)).child(div().tw_text_xs().text_color(t.muted_foreground).child("Constraints")).child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(10.))
                                .tw_rounded_lg()
                                .border_1()
                                .border_color(t.var_or("--studio-border", t.border))
                                .p(px(10.))
                                .child(row("Allow NULL values", self.nullable, "cs-e-null", |s, v| s.nullable = v, cx))
                                .child(row("Primary key", self.primary, "cs-e-pk", |s, v| {
                                    s.primary = v;
                                    if v {
                                        s.nullable = false;
                                    }
                                }, cx))
                                .child(row("Unique", self.unique, "cs-e-uq", |s, v| {
                                    s.unique = v;
                                    s.unique_touched = true;
                                }, cx))
                                .child(div().flex().flex_col().gap(px(6.)).child(div().tw_text_xs().text_color(t.muted_foreground).child("Check constraint")).child(small_input(&self.check, true))),
                        ),
                    )
                    .child(div().flex().flex_col().gap(px(6.)).child(div().tw_text_xs().text_color(t.muted_foreground).child("Foreign key")).child(self.fk_section(cx)));
            }
            StudioSheet::new("col-edit")
                .title_el(div().flex().items_center().gap(px(6.)).tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(Icon::new(IconName::PencilLine).size(px(14.))).child(if mongo { "Edit field" } else { "Edit column" }))
                .description(format!("Rename {} in {target}. Data remains intact.", if mongo { "field" } else { "column" }))
                .child(body)
                .footer(Button::new("col-edit-cancel").ghost().size(ButtonSize::Sm).label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                .footer(
                    Button::new("col-edit-save")
                        .size(ButtonSize::Sm)
                        .disabled(!can_submit || self.current.is_none() && !mongo)
                        .child(if self.busy { div().flex().items_center().gap_1().child(Spinner::new(14.)).child("Saving...").into_any_element() } else { div().child("Save changes").into_any_element() })
                        .on_click(cx.listener(|v, _, w, cx| v.submit(w, cx))),
                )
                .into_any_element()
        } else {
            let name_val = self.name.read(cx).value().to_string();
            let _ = name_val;
            let mut sections = div().flex().flex_col().child(Self::section(
                "General",
                None,
                div().flex().flex_col().gap(px(6.)).child(lbl(if mongo { "Field Name" } else { "Name" })).child(small_input(&self.name, false)).child(hint("Recommended to use lowercase and underscore-separated names.")).into_any_element(),
                cx,
            ));
            if !mongo {
                let mut dt = div().flex().flex_col().gap_4().child(div().flex().flex_col().gap(px(6.)).child(lbl("Type")).child(type_select));
                if !sqlite {
                    dt = dt.child(self.switch_row("cs-array", "Define as Array", "Allow this column to store PostgreSQL array values.", self.is_array, false, |s, v| s.is_array = v, cx));
                }
                dt = dt.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(6.))
                        .child(lbl("Default Value"))
                        .child(small_input(&self.default, true))
                        .child(div().flex().tw_text_xs().text_color(t.muted_foreground).child("Can be a literal or expression (example:\u{a0}").child(div().font_family(MONO).child("gen_random_uuid()")).child(").")),
                );
                sections = sections.child(Self::section("Data Type", None, dt.into_any_element(), cx)).child(Self::section("Foreign Keys", Some("Link this column to another table."), self.fk_section(cx), cx));
            }
            let suffix = if sqlite { " (SQLite ALTER TABLE limitation)" } else { "" };
            let mut cons = div()
                .flex()
                .flex_col()
                .gap(px(10.))
                .child(self.switch_row("cs-pk", "Is Primary Key", &format!("Use this column as the row identifier{suffix}"), self.primary, sqlite, |s, v| {
                    s.primary = v;
                    if v {
                        s.nullable = false;
                    }
                }, cx))
                .child(self.switch_row("cs-null", "Allow Nullable", "Allow the column to contain NULL values.", self.nullable, self.primary, |s, v| s.nullable = v, cx));
            if !mongo {
                cons = cons
                    .child(self.switch_row("cs-uq", "Is Unique", &format!("Enforce unique values for this column{suffix}"), self.unique, sqlite, |s, v| s.unique = v, cx))
                    .child(div().pt(px(6.)).flex().flex_col().gap(px(6.)).child(lbl("Check Constraint (Optional)")).child(small_input(&self.check, true)));
            }
            sections = sections.child(Self::section("Constraints", None, cons.into_any_element(), cx));
            let this2 = this.clone();
            StudioSheet::new("col-add")
                .title(if mongo { "Add new field" } else { "Add new column" })
                .description(format!("Add a new {} to {}.", if mongo { "field" } else { "column" }, self.target.table))
                .flush_body()
                .child(sections)
                .footer(
                    div()
                        .flex()
                        .w_full()
                        .items_center()
                        .justify_between()
                        .gap_3()
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(6.))
                                .child(Switch::new("cs-more").checked(self.create_more).on_change(move |v, _, cx| {
                                    this2.update(cx, |s, cx| {
                                        s.create_more = v;
                                        cx.notify();
                                    })
                                }))
                                .child(div().tw_text_xs().text_color(t.muted_foreground).child("Create more")),
                        )
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap(px(6.))
                                .child(Button::new("col-add-cancel").ghost().size(ButtonSize::Sm).label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                                .child(
                                    Button::new("col-add-save")
                                        .size(ButtonSize::Sm)
                                        .disabled(!can_submit)
                                        .child(if self.busy {
                                            div().flex().items_center().gap_1().child(Spinner::new(14.)).child("Adding...").into_any_element()
                                        } else {
                                            div().flex().items_center().gap(px(6.)).child(Icon::new(IconName::Plus).size(px(14.))).child(if mongo { "Add Field" } else { "Add Column" }).into_any_element()
                                        })
                                        .on_click(cx.listener(|v, _, w, cx| v.submit(w, cx))),
                                ),
                        ),
                )
                .into_any_element()
        };
        let _ = tw;
        div().size_full().child(sheet)
    }
}

trait SpawnInWindow<V> {
    /// Await `fut`; on success call `ok` on the view with the window, on failure toast the error.
    fn spawn_in_window<T: 'static>(&mut self, fut: impl std::future::Future<Output = anyhow::Result<T>> + 'static, ok: impl FnOnce(&mut V, T, &mut Window, &mut Context<V>) + 'static);
}

impl SpawnInWindow<ColumnSheet> for Context<'_, ColumnSheet> {
    fn spawn_in_window<T: 'static>(&mut self, fut: impl std::future::Future<Output = anyhow::Result<T>> + 'static, ok: impl FnOnce(&mut ColumnSheet, T, &mut Window, &mut Context<ColumnSheet>) + 'static) {
        let Some(window) = self.active_window() else { return };
        let this = self.entity().downgrade();
        self.spawn(async move |_, cx| {
            let r = fut.await;
            window
                .update(cx, |_, window, cx| {
                    this.update(cx, |v, cx| {
                        v.busy = false;
                        match r {
                            Ok(x) => ok(v, x, window, cx),
                            Err(e) => {
                                Toast::error(format!("{e:#}")).show(cx);
                            }
                        }
                        cx.notify();
                    })
                    .ok();
                })
                .ok();
        })
        .detach();
    }
}

/// `Math.random().toString(36).slice(2, 6)`.
fn rand_suffix() -> String {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.subsec_nanos() as u64 ^ d.as_secs());
    let mut x = n.wrapping_mul(0x9E37_79B9_7F4A_7C15);
    (0..4)
        .map(|_| {
            let c = (x % 36) as u32;
            x /= 36;
            std::char::from_digit(c, 36).unwrap_or('0')
        })
        .collect()
}
