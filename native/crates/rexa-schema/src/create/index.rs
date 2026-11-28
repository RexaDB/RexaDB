//! Port of components/studio/create-index-view.tsx (+ `handleCreateIndex`).

use super::{section_label, shell, submit_button, switch_away, target_table_select};
use crate::actions::{self, dq};
use crate::prefill::{self, PrefillChanged};
use gpui::{div, prelude::*, px, Context, Entity, FontWeight, SharedString, Window};
use rexa_core::{runtime, Session, TabSpec};
use rexa_drivers::{ColumnDetail, Kind, TableRef};
use rexa_ui::widgets::{Icon, InputEvent, InputState};
use rexa_ui::{tw, with_alpha, ActiveTokens, Checkbox, IconName, Select, SelectOption, Spinner, TextInput, Tw, MONO};
use std::sync::Arc;

const METHODS: [&str; 5] = ["btree", "hash", "gist", "gin", "brin"];

pub struct CreateIndexView {
    spec: TabSpec,
    session: Arc<Session>,
    schema: String,
    name: Entity<InputState>,
    table: String,
    tables: Vec<String>,
    columns: Vec<ColumnDetail>,
    selected: Vec<String>,
    unique: bool,
    method: String,
    loading_tables: bool,
    loading_columns: bool,
    creating: bool,
}

impl CreateIndexView {
    pub fn new(spec: TabSpec, session: Arc<Session>, schema: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name = cx.new(|cx| InputState::new(window, cx).placeholder("e.g. users_email_idx"));
        cx.subscribe(&name, |_, _, _: &InputEvent, cx| cx.notify()).detach();
        let mut this = CreateIndexView {
            spec,
            session,
            schema,
            name,
            table: String::new(),
            tables: Vec::new(),
            columns: Vec::new(),
            selected: Vec::new(),
            unique: false,
            method: "btree".into(),
            loading_tables: true,
            loading_columns: false,
            creating: false,
        };
        this.load_tables(cx);
        this.apply_prefill(cx);
        let p = prefill::prefills(cx);
        cx.subscribe(&p, |v, _, e: &PrefillChanged, cx| {
            if matches!(e, PrefillChanged::Index) {
                v.apply_prefill(cx);
            }
        })
        .detach();
        this
    }

    fn apply_prefill(&mut self, cx: &mut Context<Self>) {
        let Some(p) = prefill::take_index(cx) else { return };
        if !p.schema.is_empty() && p.schema != self.schema {
            self.schema = p.schema;
            self.load_tables(cx);
        }
        if !p.table.is_empty() {
            self.set_table(p.table, cx);
        }
    }

    fn load_tables(&mut self, cx: &mut Context<Self>) {
        self.loading_tables = true;
        let d = self.session.driver.clone();
        let s = self.schema.clone();
        let fut = runtime::spawn(async move { d.tables(&s).await });
        cx.spawn(async move |this, cx| {
            let r = fut.await;
            this.update(cx, |v, cx| {
                v.loading_tables = false;
                if let Ok(t) = r {
                    v.tables = t.into_iter().map(|t| t.name).collect();
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn set_table(&mut self, table: String, cx: &mut Context<Self>) {
        self.table = table.clone();
        self.columns.clear();
        self.selected.clear();
        self.loading_columns = true;
        cx.notify();
        let d = self.session.driver.clone();
        let tr = TableRef::new(self.schema.clone(), table);
        let fut = runtime::spawn(async move { d.table_structure(&tr).await });
        cx.spawn(async move |this, cx| {
            let r = fut.await;
            this.update(cx, |v, cx| {
                v.loading_columns = false;
                if let Ok(c) = r {
                    v.columns = c;
                    v.selected.clear();
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn toggle(&mut self, col: String, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(i) = self.selected.iter().position(|c| *c == col) {
            self.selected.remove(i);
        } else {
            self.selected.push(col);
        }
        // Suggest a name once (only while the name is empty).
        if !self.table.is_empty() && !self.selected.is_empty() && self.name.read(cx).value().is_empty() {
            let s = format!("{}_{}_idx", self.table, self.selected.join("_"));
            self.name.update(cx, |st, cx| st.set_value(s, window, cx));
        }
        cx.notify();
    }

    fn submit(&mut self, cx: &mut Context<Self>) {
        let name = self.name.read(cx).value().to_string();
        if name.is_empty() || self.table.is_empty() || self.selected.is_empty() || self.creating {
            return;
        }
        let kind = self.session.driver.kind();
        let sql = match kind {
            Kind::Postgres | Kind::SupabaseMgmt => format!(
                "CREATE {}INDEX {} ON {}.{} USING {} ({});",
                if self.unique { "UNIQUE " } else { "" },
                dq(&name),
                dq(&self.schema),
                dq(&self.table),
                self.method,
                self.selected.join(", ")
            ),
            _ => rexa_drivers::ddl::create_index(kind, &TableRef::new(self.schema.clone(), self.table.clone()), &name, &self.selected, self.unique, Some(&self.method)),
        };
        self.creating = true;
        cx.notify();
        let this = cx.entity().downgrade();
        let spec = self.spec.clone();
        actions::run(&self.session, sql, format!("Index \"{name}\" created successfully"), "Failed to create index", cx, move |ok, cx| {
            this.update(cx, |v, cx| {
                v.creating = false;
                cx.notify();
            })
            .ok();
            if ok {
                cx.update(|cx| switch_away(&spec, "indexes", cx));
            }
        });
    }
}

impl Render for CreateIndexView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let disabled = self.name.read(cx).value().trim().is_empty() || self.table.is_empty() || self.selected.is_empty() || self.creating;
        let submit = submit_button("idx-submit", "Create Index", "Creating...", self.creating, disabled, {
            let this = cx.entity();
            move |_, cx| this.update(cx, |v, cx| v.submit(cx))
        });
        let this = cx.entity();
        let secondary = t.var_or("--secondary", t.muted);
        let blue = tw("blue-500");
        let left = div()
            .flex_1()
            .min_w_0()
            .flex()
            .flex_col()
            .gap_8()
            .child(target_table_select("idx-target", &self.table, &self.tables, self.loading_tables, {
                let this = this.clone();
                move |v, _, cx| this.update(cx, |s, cx| s.set_table(v.to_string(), cx))
            }, cx))
            .child(div().flex().flex_col().gap_4().child(section_label(Some(IconName::Search), "Index Name", cx)).child(TextInput::new(&self.name).h(40.)))
            .child(
                div()
                    .flex()
                    .gap_4()
                    .child(
                        div().flex_1().flex().flex_col().gap_4().child(section_label(None, "Method", cx)).child({
                            let this = this.clone();
                            Select::new("idx-method").w_full().options(METHODS.map(|m| SelectOption::new(m, m.to_uppercase()))).value(Some(self.method.clone())).on_change(move |v, _, cx| {
                                this.update(cx, |s, cx| {
                                    s.method = v.to_string();
                                    cx.notify();
                                })
                            })
                        }),
                    )
                    .child(
                        div().flex_1().flex().flex_col().gap_4().child(section_label(None, "Constraint", cx)).child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .h_10()
                                .px_3()
                                .tw_rounded_lg()
                                .bg(with_alpha(secondary, 0.3))
                                .border_1()
                                .border_color(t.border)
                                .child({
                                    let this = this.clone();
                                    Checkbox::new("idx-unique").checked(self.unique).on_change(move |v, _, cx| {
                                        this.update(cx, |s, cx| {
                                            s.unique = v;
                                            cx.notify();
                                        })
                                    })
                                })
                                .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child("Unique Index")),
                        ),
                    ),
            );

        let list = if self.table.is_empty() {
            div()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .py_12()
                .text_center()
                .border_2()
                .border_dashed()
                .border_color(t.border)
                .tw_rounded_lg()
                .opacity(0.5)
                .child(Icon::new(IconName::Table2).size_8().mb_3().text_color(t.muted_foreground))
                .child(div().tw_text_xs().text_color(t.muted_foreground).child("Select a table first to see its columns"))
                .into_any_element()
        } else if self.loading_columns {
            div().flex().items_center().justify_center().py_12().child(Spinner::new(24.)).into_any_element()
        } else if self.columns.is_empty() {
            div().text_center().py_12().text_color(t.muted_foreground).tw_text_xs().child("No columns found for this table.").into_any_element()
        } else {
            let mut l = div().flex().flex_col().gap_2();
            for c in &self.columns {
                let on = self.selected.contains(&c.column_name);
                let name = c.column_name.clone();
                l = l.child(
                    div()
                        .id(SharedString::from(format!("idx-col-{name}")))
                        .flex()
                        .items_center()
                        .justify_between()
                        .p_3()
                        .tw_rounded_lg()
                        .border_1()
                        .cursor_pointer()
                        .when(on, |d| d.bg(with_alpha(blue, 0.05)).border_color(with_alpha(blue, 0.3)).shadow(vec![rexa_ui::popup::ring(with_alpha(blue, 0.2))]))
                        .when(!on, |d| d.bg(with_alpha(secondary, 0.1)).border_color(t.border).hover(|s| s.bg(with_alpha(secondary, 0.2))))
                        .on_click(cx.listener(move |v, _, w, cx| v.toggle(name.clone(), w, cx)))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_3()
                                .child(
                                    div()
                                        .size_4()
                                        .rounded(px(4.))
                                        .border_1()
                                        .flex()
                                        .items_center()
                                        .justify_center()
                                        .when(on, |d| d.bg(blue).border_color(blue).child(Icon::new(IconName::CircleCheck).size_3().text_color(t.var_or("--primary-foreground", gpui::white()))))
                                        .when(!on, |d| d.border_color(with_alpha(t.muted_foreground, 0.3))),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .child(div().tw_text_xs().font_weight(FontWeight::BOLD).text_color(if on { t.foreground } else { with_alpha(t.foreground, 0.8) }).child(c.column_name.clone()))
                                        .child(div().tw_text_xs().text_color(t.muted_foreground).font_family(MONO).child(c.data_type.clone())),
                                ),
                        )
                        .when(c.is_primary_key, |d| {
                            let amber = tw("amber-500");
                            d.child(div().flex().items_center().gap_1().h_5().px(px(6.)).tw_rounded_md().border_1().border_color(with_alpha(amber, 0.2)).bg(with_alpha(amber, 0.05)).text_color(tw("amber-600")).tw_text_xs().child(Icon::new(IconName::Key).size(px(10.))).child("PK"))
                        }),
                );
            }
            l.into_any_element()
        };
        let right = div()
            .flex_1()
            .min_w_0()
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
                    .child(section_label(Some(IconName::Layers), "Select Columns", cx))
                    .when(!self.selected.is_empty(), |d| d.child(div().px(px(6.)).h_5().flex().items_center().tw_rounded_md().bg(with_alpha(blue, 0.1)).text_color(blue).tw_text_xs().child(format!("{} selected", self.selected.len())))),
            )
            .child(div().id("idx-cols").max_h(px(400.)).overflow_y_scroll().pr_2().child(list))
            .when(!self.table.is_empty() && !self.columns.is_empty(), |d| {
                d.child(div().tw_text_xs().text_color(t.muted_foreground).text_center().italic().mt_4().child("Multicolumn indexes are supported. Select columns in the order you want them in the index."))
            });
        let body = div().flex().gap_8().child(left).child(right).into_any_element();
        shell("create-index", "Create a new index", "Improve query performance by indexing columns in", Some(&self.schema), 768., submit, body, cx)
    }
}
