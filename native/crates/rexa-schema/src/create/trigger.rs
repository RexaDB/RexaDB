//! Port of components/studio/create-trigger-view.tsx (+ `handleCreateTrigger`,
//! `handleUpdateTrigger` — edit is create-temp / drop-old / rename in one
//! transaction).

use super::{section_label, shell, submit_button, switch_away, target_table_select};
use crate::actions::{self, dq};
use crate::prefill::{self, PrefillChanged, TriggerPrefill};
use gpui::{div, prelude::*, px, Context, Entity, FontWeight, SharedString, Window};
use rexa_core::{runtime, Session, TabSpec};
use rexa_ui::widgets::{InputEvent, InputState};
use rexa_ui::{tw, with_alpha, ActiveTokens, Checkbox, IconName, Select, SelectOption, TextInput, Tw, MONO};
use std::sync::Arc;

const TIMINGS: [&str; 3] = ["BEFORE", "AFTER", "INSTEAD OF"];
const ORIENTATIONS: [&str; 2] = ["ROW", "STATEMENT"];
const EVENTS: [&str; 4] = ["INSERT", "UPDATE", "DELETE", "TRUNCATE"];

pub struct CreateTriggerView {
    spec: TabSpec,
    session: Arc<Session>,
    schema: String,
    name: Entity<InputState>,
    table: String,
    function: String,
    tables: Vec<String>,
    functions: Vec<String>,
    events: Vec<String>,
    timing: String,
    orientation: String,
    loading: bool,
    edit: Option<(String, String, String)>,
    creating: bool,
}

impl CreateTriggerView {
    pub fn new(spec: TabSpec, session: Arc<Session>, schema: String, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let name = cx.new(|cx| InputState::new(window, cx).placeholder("e.g. notify_on_user_update"));
        cx.subscribe(&name, |_, _, _: &InputEvent, cx| cx.notify()).detach();
        let mut this = CreateTriggerView {
            spec,
            session,
            schema,
            name,
            table: String::new(),
            function: String::new(),
            tables: Vec::new(),
            functions: Vec::new(),
            events: vec!["INSERT".into()],
            timing: "BEFORE".into(),
            orientation: "ROW".into(),
            loading: true,
            edit: None,
            creating: false,
        };
        this.apply_prefill(window, cx);
        this.load(cx);
        let p = prefill::prefills(cx);
        cx.subscribe_in(&p, window, |v, _, e: &PrefillChanged, window, cx| {
            if matches!(e, PrefillChanged::Trigger) {
                v.apply_prefill(window, cx);
            }
        })
        .detach();
        this
    }

    fn pristine(&self, cx: &gpui::App) -> bool {
        self.name.read(cx).value().is_empty() && self.table.is_empty() && self.function.is_empty() && self.events == ["INSERT"] && self.timing == "BEFORE" && self.orientation == "ROW"
    }

    /// Duplicate prefills only fill a pristine form; edit prefills always win.
    fn apply_prefill(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(p): Option<TriggerPrefill> = prefill::take_trigger(cx) else { return };
        if !(self.pristine(cx) || p.edit.is_some()) {
            return;
        }
        let schema_changed = !p.schema.is_empty() && p.schema != self.schema;
        if !p.schema.is_empty() {
            self.schema = p.schema.clone();
        }
        self.name.update(cx, |s, cx| s.set_value(p.name.clone(), window, cx));
        self.table = p.table;
        self.function = p.function_name;
        self.events = if p.events.is_empty() { vec!["INSERT".into()] } else { p.events };
        self.timing = if p.timing.is_empty() { "BEFORE".into() } else { p.timing };
        self.orientation = if p.orientation.is_empty() { "ROW".into() } else { p.orientation };
        self.edit = p.edit;
        if schema_changed {
            self.load(cx);
        }
        cx.notify();
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        let d = self.session.driver.clone();
        let s = self.schema.clone();
        let fut = runtime::spawn(async move {
            let tables = d.tables(&s).await?.into_iter().map(|t| t.name).collect::<Vec<_>>();
            let fns = d.functions(&s).await.unwrap_or_default().into_iter().filter(|f| matches!(f.return_type.to_lowercase().as_str(), "trigger" | "opaque")).map(|f| f.name).collect::<Vec<_>>();
            Ok((tables, fns))
        });
        cx.spawn(async move |this, cx| {
            let r = fut.await;
            this.update(cx, |v, cx| {
                v.loading = false;
                if let Ok((t, f)) = r {
                    v.tables = t;
                    v.functions = f;
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn suggest_name(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if !self.table.is_empty() && !self.events.is_empty() && self.name.read(cx).value().is_empty() {
            let s = format!("trig_{}_{}", self.table, self.events[0].to_lowercase());
            self.name.update(cx, |st, cx| st.set_value(s, window, cx));
        }
    }

    fn submit(&mut self, cx: &mut Context<Self>) {
        let name = self.name.read(cx).value().to_string();
        if name.is_empty() || self.table.is_empty() || self.function.is_empty() || self.events.is_empty() || self.creating {
            return;
        }
        let on = format!("{}.{}", dq(&self.schema), dq(&self.table));
        let body = format!("{} {} ON {on} FOR EACH {} EXECUTE FUNCTION {}();", self.timing, self.events.join(" OR "), self.orientation, self.function);
        self.creating = true;
        cx.notify();
        let this = cx.entity().downgrade();
        let spec = self.spec.clone();
        let done = move |ok: bool, cx: &mut gpui::AsyncApp| {
            this.update(cx, |v, cx| {
                v.creating = false;
                if ok {
                    v.edit = None;
                }
                cx.notify();
            })
            .ok();
            if ok {
                cx.update(|cx| switch_away(&spec, "triggers", cx));
            }
        };
        match self.edit.clone() {
            None => {
                let sql = format!("CREATE TRIGGER {} {body}", dq(&name));
                actions::run(&self.session, sql, format!("Trigger \"{name}\" created successfully"), "Failed to create trigger", cx, done);
            }
            Some((os, ot, on_name)) => {
                let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
                let temp = format!("__temp_trigger_{ms}");
                let stmts = vec![
                    format!("CREATE TRIGGER {} {body}", dq(&temp)),
                    format!("DROP TRIGGER IF EXISTS {} ON {}.{};", dq(&on_name), dq(&os), dq(&ot)),
                    format!("ALTER TRIGGER {} ON {on} RENAME TO {};", dq(&temp), dq(&name)),
                ];
                let d = self.session.driver.clone();
                let fut = runtime::spawn(async move { d.transaction(&stmts).await.map(|_| ()) });
                cx.spawn(async move |_, cx| {
                    let r = fut.await;
                    let ok = r.is_ok();
                    cx.update(|cx| match r {
                        Ok(()) => {
                            rexa_ui::Toast::success(format!("Trigger \"{name}\" updated successfully")).show(cx);
                            rexa_core::emit_studio(rexa_core::StudioEvent::SchemaChanged, cx);
                        }
                        Err(e) => {
                            rexa_ui::Toast::error(format!("{e:#}")).show(cx);
                        }
                    });
                    done(ok, cx);
                })
                .detach();
            }
        }
    }
}

impl Render for CreateTriggerView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let name = self.name.read(cx).value().to_string();
        let disabled = name.trim().is_empty() || self.table.is_empty() || self.function.is_empty() || self.events.is_empty() || self.creating;
        let editing = self.edit.clone();
        let submit = submit_button("trg-submit", if editing.is_some() { "Save Changes" } else { "Create Trigger" }, "Creating...", self.creating, disabled, {
            let this = cx.entity();
            move |_, cx| this.update(cx, |v, cx| v.submit(cx))
        });
        let this = cx.entity();
        let secondary = t.var_or("--secondary", t.muted);
        let blue = tw("blue-500");
        let sel = |id: &'static str, opts: &[&str], value: &str, f: fn(&mut Self, String)| {
            let this = this.clone();
            Select::new(id).w_full().options(opts.iter().map(|o| SelectOption::simple(o.to_string()))).value(Some(value.to_string())).on_change(move |v, _, cx| {
                this.update(cx, |s, cx| {
                    f(s, v.to_string());
                    cx.notify();
                })
            })
        };
        let fn_select = {
            let this = this.clone();
            Select::new("trg-fn")
                .w_full()
                .placeholder(if self.loading { "Loading functions..." } else { "Select a trigger function" })
                .empty_text("No trigger functions found in this schema.")
                .options(self.functions.iter().map(|f| SelectOption::simple(f.clone())))
                .value(Some(self.function.clone()).filter(|s| !s.is_empty()))
                .on_change(move |v, _, cx| {
                    this.update(cx, |s, cx| {
                        s.function = v.to_string();
                        cx.notify();
                    })
                })
        };
        let left = div()
            .flex_1()
            .min_w_0()
            .flex()
            .flex_col()
            .gap_8()
            .child(div().flex().flex_col().gap_4().child(section_label(Some(IconName::Zap), "Trigger Name", cx)).child(TextInput::new(&self.name).h(40.)))
            .child(target_table_select("trg-target", &self.table, &self.tables, self.loading, {
                let this = this.clone();
                move |v, w, cx| {
                    this.update(cx, |s, cx| {
                        s.table = v.to_string();
                        s.suggest_name(w, cx);
                        cx.notify();
                    })
                }
            }, cx))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(section_label(Some(IconName::SquareFunction), "Function to Execute", cx))
                    .child(fn_select)
                    .child(div().flex().tw_text_xs().text_color(t.muted_foreground).italic().child("Only functions returning\u{a0}").child(div().font_family(MONO).child("TRIGGER")).child("\u{a0}are listed.")),
            );
        let mut events = div().flex().flex_col().gap_2();
        for pair in EVENTS.chunks(2) {
            let mut row = div().flex().gap_2();
            for ev in pair {
                let on = self.events.iter().any(|e| e == ev);
                let ev_s = ev.to_string();
                row = row.child(
                    div()
                        .id(SharedString::from(format!("trg-ev-{ev}")))
                        .flex_1()
                        .flex()
                        .items_center()
                        .gap_2()
                        .p_2()
                        .tw_rounded_lg()
                        .border_1()
                        .cursor_pointer()
                        .when(on, |d| d.bg(with_alpha(blue, 0.05)).border_color(with_alpha(blue, 0.3)).shadow(vec![rexa_ui::popup::ring(with_alpha(blue, 0.2))]))
                        .when(!on, |d| d.bg(with_alpha(secondary, 0.1)).border_color(t.border).hover(|s| s.bg(with_alpha(secondary, 0.2))))
                        .on_click(cx.listener(move |v, _, w, cx| {
                            if let Some(i) = v.events.iter().position(|e| *e == ev_s) {
                                v.events.remove(i);
                            } else {
                                v.events.push(ev_s.clone());
                            }
                            v.suggest_name(w, cx);
                            cx.notify();
                        }))
                        .child(Checkbox::new(SharedString::from(format!("trg-evc-{ev}"))).checked(on))
                        .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child(ev.to_string())),
                );
            }
            events = events.child(row);
        }
        let right = div()
            .flex_1()
            .min_w_0()
            .flex()
            .flex_col()
            .gap_8()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_4()
                    .child(section_label(Some(IconName::Clock), "Events & Timing", cx))
                    .child(
                        div()
                            .flex()
                            .gap_4()
                            .child(div().flex_1().flex().flex_col().gap_2().child(div().tw_text_xs().text_color(t.muted_foreground).font_weight(FontWeight::MEDIUM).child("Timing")).child(sel("trg-timing", &TIMINGS, &self.timing, |s, v| s.timing = v)))
                            .child(div().flex_1().flex().flex_col().gap_2().child(div().tw_text_xs().text_color(t.muted_foreground).font_weight(FontWeight::MEDIUM).child("Orientation")).child(sel("trg-orient", &ORIENTATIONS, &self.orientation, |s, v| s.orientation = v))),
                    )
                    .child(div().flex().flex_col().gap_3().pt_2().child(div().tw_text_xs().text_color(t.muted_foreground).font_weight(FontWeight::MEDIUM).child("Trigger on Events")).child(events)),
            )
            .child(
                div()
                    .p_4()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(t.border)
                    .bg(with_alpha(t.muted, 0.2))
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(section_label(Some(IconName::LayoutDashboard), "Summary", cx))
                    .child(
                        div()
                            .tw_text_xs()
                            .text_color(with_alpha(t.foreground, 0.8))
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(
                                div()
                                    .flex()
                                    .flex_wrap()
                                    .items_center()
                                    .child("This trigger will run\u{a0}")
                                    .child(div().px_1().h_4().flex().items_center().tw_rounded_md().bg(with_alpha(blue, 0.1)).text_color(blue).child(self.timing.clone()))
                                    .child(div().font_weight(FontWeight::BOLD).child(format!("\u{a0}{}", self.events.join(" or "))))
                                    .child("\u{a0}operations."),
                            )
                            .child(div().flex().child("It will execute for\u{a0}").child(div().font_weight(FontWeight::BOLD).child(if self.orientation == "ROW" { "each row" } else { "the entire statement" })).child("."))
                            .child(div().flex().child("Executing function:\u{a0}").child(div().font_family(MONO).font_weight(FontWeight::BOLD).text_color(blue).underline().child(format!("{}()", if self.function.is_empty() { "..." } else { &self.function })))),
                    ),
            );
        let body = div().flex().gap_8().child(left).child(right).into_any_element();
        let (title, desc) = match &editing {
            Some((_, _, n)) => ("Edit trigger".to_string(), format!("Update trigger \"{n}\" \u{2014} saved as drop + recreate")),
            None => ("Create a new trigger".to_string(), "Automate actions when data changes in".to_string()),
        };
        let _ = px(0.);
        shell("create-trigger", title, desc, Some(&self.schema), 768., submit, body, cx)
    }
}
