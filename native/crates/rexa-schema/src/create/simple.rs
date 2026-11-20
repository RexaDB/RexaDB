//! Ports of components/studio/{create-schema-view,create-database-view,create-enum-view}.tsx
//! with `handleCreateSchema`, `handleCreateDatabase`, `handleCreateEnum` and
//! `handleUpdateEnum` from hooks/use-studio.ts.

use super::{close_and_open_tables, section_label, shell, submit_button, switch_away};
use crate::actions::{self, dq, sq};
use crate::prefill::{self, PrefillChanged};
use gpui::{div, prelude::*, px, Context, Entity, FontWeight, Window};
use rexa_core::{Session, TabSpec};
use rexa_drivers::Kind;
use rexa_ui::widgets::{Icon, InputEvent, InputState};
use rexa_ui::{tw, with_alpha, ActiveTokens, Button, ButtonSize, IconName, TextInput, Tw, MONO};
use std::sync::Arc;

fn input<V: 'static>(placeholder: &str, value: &str, window: &mut Window, cx: &mut Context<V>) -> Entity<InputState> {
    let (p, v) = (placeholder.to_string(), value.to_string());
    let e = cx.new(|cx| {
        let mut s = InputState::new(window, cx).placeholder(p);
        if !v.is_empty() {
            s.set_value(v, window, cx);
        }
        s
    });
    cx.subscribe(&e, |_, _, _: &InputEvent, cx| cx.notify()).detach();
    e
}

// ---- create-schema ---------------------------------------------------------------------------

pub struct CreateSchemaView {
    spec: TabSpec,
    session: Arc<Session>,
    name: Entity<InputState>,
    creating: bool,
}

impl CreateSchemaView {
    pub fn new(spec: TabSpec, session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name = input("e.g. auth, billing, reporting", "", window, cx);
        cx.subscribe(&name, |v: &mut Self, _, e: &InputEvent, cx| {
            if matches!(e, InputEvent::PressEnter { .. }) {
                v.submit(cx);
            }
        })
        .detach();
        name.update(cx, |s, cx| s.focus(window, cx));
        CreateSchemaView { spec, session, name, creating: false }
    }

    fn submit(&mut self, cx: &mut Context<Self>) {
        let name = self.name.read(cx).value().trim().to_string();
        if name.is_empty() || self.creating {
            return;
        }
        let kind = self.session.driver.kind();
        let sql = match kind {
            Kind::Postgres | Kind::SupabaseMgmt => format!("CREATE SCHEMA {};", dq(&name)),
            _ => match rexa_drivers::ddl::create_schema(kind, &name) {
                Ok(s) => s,
                Err(e) => {
                    rexa_ui::Toast::error(e.to_string()).show(cx);
                    return;
                }
            },
        };
        self.creating = true;
        cx.notify();
        let this = cx.entity().downgrade();
        let spec = self.spec.clone();
        actions::run(&self.session, sql, format!("Schema \"{name}\" created successfully"), "Failed to create schema", cx, move |ok, cx| {
            this.update(cx, |v, cx| {
                v.creating = false;
                cx.notify();
            })
            .ok();
            if ok {
                cx.update(|cx| close_and_open_tables(&spec, cx));
            }
        });
    }
}

impl Render for CreateSchemaView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let empty = self.name.read(cx).value().trim().is_empty();
        let submit = submit_button("schema-submit", "Create Schema", "Creating...", self.creating, empty || self.creating, {
            let this = cx.entity();
            move |_, cx| this.update(cx, |v, cx| v.submit(cx))
        });
        let body = div()
            .flex()
            .flex_col()
            .gap_8()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .p_6()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(t.border)
                    .bg(with_alpha(t.var_or("--secondary", t.muted), 0.1))
                    .child(section_label(Some(IconName::Box), "Schema Name", cx))
                    .child(TextInput::new(&self.name).h(40.))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).italic().child("Names should be lowercase and contain no spaces. Use underscores for separation.")),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .p_4()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(t.border)
                    .bg(with_alpha(t.muted, 0.2))
                    .child(section_label(Some(IconName::Shield), "Best Practices", cx))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .tw_text_xs()
                            .text_color(with_alpha(t.foreground, 0.7))
                            .child("\u{2022} Use schemas to separate multi-tenant data")
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .child("\u{2022} Group related tables (e.g., all authentication tables in an\u{a0}")
                                    .child(div().bg(t.muted).px_1().rounded(px(4.)).font_family(MONO).child("auth"))
                                    .child("\u{a0}schema)"),
                            )
                            .child("\u{2022} Avoid using reserved keywords as schema names"),
                    ),
            )
            .into_any_element();
        shell("create-schema", "Create a new schema", "Schemas help you organize your database objects into logical groups.", None, 576., submit, body, cx)
    }
}

// ---- create-database -------------------------------------------------------------------------

pub struct CreateDatabaseView {
    spec: TabSpec,
    session: Arc<Session>,
    name: Entity<InputState>,
    creating: bool,
}

impl CreateDatabaseView {
    pub fn new(spec: TabSpec, session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name = input("e.g. production_backup, analytics_db", "", window, cx);
        cx.subscribe(&name, |v: &mut Self, _, e: &InputEvent, cx| {
            if matches!(e, InputEvent::PressEnter { .. }) {
                v.submit(cx);
            }
        })
        .detach();
        name.update(cx, |s, cx| s.focus(window, cx));
        CreateDatabaseView { spec, session, name, creating: false }
    }

    fn submit(&mut self, cx: &mut Context<Self>) {
        let name = self.name.read(cx).value().trim().to_string();
        if name.is_empty() || self.creating {
            return;
        }
        let kind = self.session.driver.kind();
        let sql = match kind {
            Kind::Postgres | Kind::SupabaseMgmt => format!("CREATE DATABASE {};", dq(&name)),
            _ => match rexa_drivers::ddl::create_database(kind, &name) {
                Ok(s) => s,
                Err(e) => {
                    rexa_ui::Toast::error(e.to_string()).show(cx);
                    return;
                }
            },
        };
        self.creating = true;
        cx.notify();
        let this = cx.entity().downgrade();
        let spec = self.spec.clone();
        actions::run(&self.session, sql, format!("Database \"{name}\" created successfully"), "Failed to create database", cx, move |ok, cx| {
            this.update(cx, |v, cx| {
                v.creating = false;
                cx.notify();
            })
            .ok();
            if ok {
                cx.update(|cx| close_and_open_tables(&spec, cx));
            }
        });
    }
}

impl Render for CreateDatabaseView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let empty = self.name.read(cx).value().trim().is_empty();
        let submit = submit_button("db-submit", "Create Database", "Creating...", self.creating, empty || self.creating, {
            let this = cx.entity();
            move |_, cx| this.update(cx, |v, cx| v.submit(cx))
        });
        let amber = tw("amber-500");
        let body = div()
            .flex()
            .flex_col()
            .gap_8()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .p_6()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(t.border)
                    .bg(with_alpha(t.var_or("--secondary", t.muted), 0.1))
                    .child(section_label(Some(IconName::Database), "Database Name", cx))
                    .child(TextInput::new(&self.name).h(40.)),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .p_4()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(with_alpha(amber, 0.2))
                    .bg(with_alpha(amber, 0.05))
                    .child(div().flex().items_center().gap_2().tw_text_xs().font_weight(FontWeight::BOLD).text_color(tw("amber-600")).child(Icon::new(IconName::CircleAlert).size(px(14.))).child("Important Note"))
                    .child(div().tw_text_xs().text_color(with_alpha(tw("amber-700"), 0.8)).child("Creating a database might take a few moments depending on your cluster configuration. The new database will be created using the default template.")),
            )
            .into_any_element();
        shell("create-database", "Create a new database", "Create a new database in your cluster.", None, 576., submit, body, cx)
    }
}

// ---- create-enum -----------------------------------------------------------------------------

pub struct CreateEnumView {
    spec: TabSpec,
    session: Arc<Session>,
    schema: String,
    name: Entity<InputState>,
    values: Vec<Entity<InputState>>,
    /// Update mode: original name + values.
    editing: Option<(String, Vec<String>)>,
    creating: bool,
}

impl CreateEnumView {
    pub fn new(spec: TabSpec, session: Arc<Session>, schema: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name = input("e.g. user_role", "", window, cx);
        let mut this = CreateEnumView { spec, session, schema, name, values: Vec::new(), editing: None, creating: false };
        this.add_value(String::new(), window, cx);
        this.apply_prefill(window, cx);
        let p = prefill::prefills(cx);
        cx.subscribe_in(&p, window, |v, _, e: &PrefillChanged, window, cx| {
            if matches!(e, PrefillChanged::Enum) {
                v.apply_prefill(window, cx);
            }
        })
        .detach();
        this
    }

    fn apply_prefill(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(p) = prefill::take_enum(cx) else { return };
        self.schema = p.schema;
        self.name.update(cx, |s, cx| s.set_value(p.name, window, cx));
        self.values.clear();
        for v in if p.values.is_empty() { vec![String::new()] } else { p.values } {
            self.add_value(v, window, cx);
        }
        self.editing = p.editing;
        cx.notify();
    }

    fn add_value(&mut self, value: String, window: &mut Window, cx: &mut Context<Self>) {
        let ph = format!("Value {}", self.values.len() + 1);
        self.values.push(input(&ph, &value, window, cx));
        cx.notify();
    }

    fn valid_values(&self, cx: &gpui::App) -> Vec<String> {
        self.values.iter().map(|v| v.read(cx).value().to_string()).filter(|v| !v.trim().is_empty()).collect()
    }

    fn submit(&mut self, cx: &mut Context<Self>) {
        let values = self.valid_values(cx);
        let name = self.name.read(cx).value().to_string();
        if values.is_empty() || name.trim().is_empty() || self.creating {
            return;
        }
        let schema = self.schema.clone();
        let (sql, msg, fallback): (String, String, &'static str) = match &self.editing {
            None => (
                format!("CREATE TYPE {}.{} AS ENUM ({});", dq(&schema), dq(&name), values.iter().map(|v| sq(v)).collect::<Vec<_>>().join(", ")),
                format!("Enum \"{name}\" created successfully"),
                "Failed to create enum",
            ),
            Some((orig_name, orig_values)) => {
                // handleUpdateEnum: rename, then ADD VALUE for each new value.
                let mut stmts = Vec::new();
                if *orig_name != name {
                    stmts.push(format!("ALTER TYPE {}.{} RENAME TO {};", dq(&schema), dq(orig_name), dq(&name)));
                }
                for v in values.iter().filter(|v| !orig_values.contains(v)) {
                    stmts.push(format!("ALTER TYPE {}.{} ADD VALUE {};", dq(&schema), dq(&name), sq(v)));
                }
                if stmts.is_empty() {
                    switch_away(&self.spec, "enums", cx);
                    return;
                }
                (stmts.join("\n"), String::new(), "Failed to update enum")
            }
        };
        self.creating = true;
        cx.notify();
        let this = cx.entity().downgrade();
        let spec = self.spec.clone();
        actions::run(&self.session, sql, msg, fallback, cx, move |ok, cx| {
            this.update(cx, |v, cx| {
                v.creating = false;
                if ok {
                    v.editing = None;
                }
                cx.notify();
            })
            .ok();
            if ok {
                cx.update(|cx| switch_away(&spec, "enums", cx));
            }
        });
    }
}

impl Render for CreateEnumView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let name = self.name.read(cx).value().to_string();
        let editing = self.editing.is_some();
        let disabled = name.trim().is_empty() || self.valid_values(cx).is_empty() || self.creating;
        let submit = submit_button("enum-submit", if editing { "Update Enum" } else { "Create Enum" }, if editing { "Updating..." } else { "Creating..." }, self.creating, disabled, {
            let this = cx.entity();
            move |_, cx| this.update(cx, |v, cx| v.submit(cx))
        });
        let blue = tw("blue-500");
        let n = self.values.len();
        let mut rows = div().flex().flex_col().gap_3();
        for (i, v) in self.values.iter().enumerate() {
            let destructive = t.destructive;
            rows = rows.child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(div().flex_1().tw_text_xs().child(TextInput::new(v).h(36.)))
                    .child(
                        Button::new(("enum-rm", i))
                            .ghost()
                            .size(ButtonSize::Icon)
                            .colors(gpui::transparent_black(), with_alpha(destructive, 0.05), t.muted_foreground)
                            .icon(IconName::Trash)
                            .disabled(n == 1)
                            .on_click(cx.listener(move |v, _, _, cx| {
                                if v.values.len() > 1 {
                                    v.values.remove(i);
                                    cx.notify();
                                }
                            })),
                    ),
            );
        }
        let body = div()
            .flex()
            .flex_col()
            .gap_8()
            .child(div().flex().flex_col().gap_3().child(div().tw_text_xs().text_color(t.muted_foreground).child(rexa_ui::tracked_text::tracked("Type Name", 0.05))).child(TextInput::new(&self.name).h(40.)))
            .child(
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
                            .child(div().flex().items_center().gap_2().tw_text_xs().text_color(t.muted_foreground).child(Icon::new(IconName::List).size(px(14.))).child("Values"))
                            .child(
                                Button::new("enum-add")
                                    .ghost()
                                    .size(ButtonSize::Sm)
                                    .colors(gpui::transparent_black(), with_alpha(blue, 0.05), blue)
                                    .icon(IconName::Plus)
                                    .label("Add value")
                                    .on_click(cx.listener(|v, _, w, cx| v.add_value(String::new(), w, cx))),
                            ),
                    )
                    .child(rows),
            )
            .into_any_element();
        let (title, desc) = if editing {
            (format!("Edit enum type: {name}"), "Modify the values or rename the enum in ")
        } else {
            ("Create a new enum type".to_string(), "Define a set of static values for your enum in ")
        };
        let _ = MONO;
        shell("create-enum", title, desc, Some(&self.schema), 672., submit, body, cx)
    }
}
