//! Port of the table editor's contained sheets and popovers:
//! `insert-row-sheet.tsx`, `review-sheet.tsx`, `fk-selection-sheet.tsx`,
//! @rexadbapp/data-table `json-cell-editor-sheet.tsx` / `rexa-cell-renderer.tsx`
//! (the Alt+M editing sheet), `json-code-editor.tsx` (formatting), and the
//! FK preview popover of `data-grid.tsx`. `StudioSheet contained` renders as
//! an absolutely positioned 420px panel over the table area.

use crate::cells;
use crate::view::{SheetKind, TableEditor};
use gpui::{div, prelude::*, px, AnyElement, Bounds, Context, Entity, FontWeight, Hsla, Pixels, Rgba, SharedString, Window};

use rexa_core::runtime;
use rexa_drivers::{QueryResult, TableRef};
use rexa_ui::widgets::InputState;
use rexa_ui::{tw, with_alpha, ActiveTokens, Badge, BadgeVariant, Button, ButtonSize, IconName, TextInput, Toast, Tw};

/// `color-mix(in srgb, a (1-amount), b)`-style helper: mix `a` toward `b` by `amount`.
pub fn mix_tokens(a: Hsla, b: Hsla, amount: f32) -> Hsla {
    let (a, b): (Rgba, Rgba) = (a.into(), b.into());
    let m = |x: f32, y: f32| x + (y - x) * amount;
    Rgba { r: m(a.r, b.r), g: m(a.g, b.g), b: m(a.b, b.b), a: m(a.a, b.a) }.into()
}

/// `formatJsonText`: pretty-print with 2 spaces when it parses.
pub fn format_json_text(text: &str) -> String {
    serde_json::from_str::<serde_json::Value>(text).ok().and_then(|v| serde_json::to_string_pretty(&v).ok()).unwrap_or_else(|| text.to_string())
}

#[derive(Clone)]
pub struct FkPicker {
    pub row: usize,
    pub col: usize,
    pub table: TableRef,
    pub foreign_column: String,
    pub result: Option<QueryResult>,
    pub loading: bool,
    pub selected: Option<usize>,
    pub search: Entity<InputState>,
}

#[derive(Clone)]
pub struct FkPreview {
    pub row: usize,
    pub col: usize,
    pub table: TableRef,
    pub foreign_column: String,
    pub value: String,
    pub anchor: Bounds<Pixels>,
    pub result: Option<QueryResult>,
    pub error: Option<String>,
    pub loading: bool,
    /// `fkPreviewSize` (bottom-right resize handle), null until resized.
    pub size: Option<(f32, f32)>,
    /// Active resize: pointer start + the size it started from.
    pub resize_from: Option<(gpui::Point<Pixels>, f32, f32)>,
    pub bounds: std::rc::Rc<std::cell::Cell<Bounds<Pixels>>>,
}

impl TableEditor {
    fn fk_for(&self, col: usize) -> Option<rexa_drivers::ForeignKey> {
        let name = &self.data.as_ref()?.columns.get(col)?.name;
        self.foreign_keys.iter().find(|f| &f.column_name == name).cloned()
    }

    /// `handleToggleFKPreview`.
    pub(crate) fn toggle_fk_preview(&mut self, row: usize, col: usize, anchor: Bounds<Pixels>, _window: &mut Window, cx: &mut Context<Self>) {
        if self.fk_preview.as_ref().is_some_and(|p| p.row == row && p.col == col) {
            self.fk_preview = None;
            cx.notify();
            return;
        }
        let Some(value) = self.cell_value(row, col) else { return };
        let Some(fk) = self.fk_for(col) else {
            self.fk_preview = None;
            cx.notify();
            return;
        };
        let table = TableRef::new(fk.foreign_table_schema.clone(), fk.foreign_table_name.clone());
        let incomplete = fk.foreign_table_name.is_empty() || fk.foreign_column_name.is_empty();
        self.fk_preview = Some(FkPreview {
            row,
            col,
            table: table.clone(),
            foreign_column: fk.foreign_column_name.clone(),
            value: value.to_string(),
            anchor,
            result: None,
            error: incomplete.then(|| "Foreign key metadata is incomplete for this column.".to_string()),
            loading: !incomplete,
            size: None,
            resize_from: None,
            bounds: Default::default(),
        });
        cx.notify();
        if incomplete {
            return;
        }
        let driver = self.driver.clone();
        let kind = self.kind;
        let keys = vec![(fk.foreign_column_name.clone(), rexa_drivers::Value::Text(value.to_string()))];
        let task = runtime::spawn(async move {
            let sql = rexa_drivers::grid::build_select_by_keys_sql(kind, &table, &keys).ok_or_else(|| anyhow::anyhow!("Missing key values."))?;
            driver.execute(&sql, 1).await
        });
        cx.spawn(async move |this, cx| {
            let r = task.await;
            this.update(cx, |this, cx| {
                if let Some(p) = this.fk_preview.as_mut().filter(|p| p.row == row && p.col == col) {
                    p.loading = false;
                    match r {
                        Ok(res) => p.result = Some(res),
                        Err(e) => p.error = Some(format!("{e:#}")),
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// `handleFKSelection`: the picker over the referenced table's first 100 rows.
    pub(crate) fn open_fk_picker(&mut self, row: usize, col: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(fk) = self.fk_for(col) else { return };
        let table = TableRef::new(fk.foreign_table_schema.clone(), fk.foreign_table_name.clone());
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search..."));
        cx.subscribe(&search, |_, _, _: &rexa_ui::widgets::InputEvent, cx| cx.notify()).detach();
        self.sheet = Some(SheetKind::FkSelect(FkPicker {
            row,
            col,
            table: table.clone(),
            foreign_column: fk.foreign_column_name.clone(),
            result: None,
            loading: true,
            selected: None,
            search,
        }));
        cx.notify();
        let driver = self.driver.clone();
        let kind = self.kind;
        let task = runtime::spawn(async move {
            let q = rexa_drivers::TableQuery { table, limit: 100, ..Default::default() };
            let sql = rexa_drivers::grid::build_select_sql(kind, &q);
            driver.execute(&sql, 100).await
        });
        cx.spawn(async move |this, cx| {
            let r = task.await;
            this.update(cx, |this, cx| {
                if let Some(SheetKind::FkSelect(p)) = this.sheet.as_mut() {
                    p.loading = false;
                    match r {
                        Ok(res) => p.result = Some(res),
                        Err(e) => { Toast::error(format!("{e:#}")).show(cx); }
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn sheet_shell(&self, title: AnyElement, body: AnyElement, footer: Option<AnyElement>, width: f32, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        div()
            .id("contained-sheet")
            .absolute()
            .top_0()
            .right_0()
            .bottom_0()
            .w(px(width))
            .flex()
            .flex_col()
            .bg(t.background)
            .text_color(t.foreground)
            .border_l_1()
            .border_color(t.border)
            .shadow(rexa_ui::popup::shadow_lg())
            .occlude()
            .on_scroll(|_, _, cx| cx.stop_propagation())
            .child(
                div()
                    .relative()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .gap_2()
                    .min_h_12()
                    .border_b_1()
                    .border_color(t.border)
                    .px_4()
                    .pr_10()
                    .child(title)
                    .child(
                        div().absolute().top(px(10.)).right_3().child(
                            Button::new("sheet-close").ghost().size(ButtonSize::IconSm).icon(IconName::X).on_click(cx.listener(|this, _, window, cx| {
                                this.sheet = None;
                                this.sheet_text = None;
                                this.focus.focus(window, cx);
                                cx.notify();
                            })),
                        ),
                    ),
            )
            .child(div().id("sheet-body").flex_1().min_h_0().overflow_y_scroll().child(body))
            .children(footer.map(|f| {
                div()
                    .flex()
                    .flex_shrink_0()
                    .items_center()
                    .justify_end()
                    .gap_2()
                    .min_h_9()
                    .border_t_1()
                    .border_color(t.border)
                    .bg(with_alpha(t.studio_bg, 0.95))
                    .px_3()
                    .py(px(10.))
                    .child(f)
            }))
            .into_any_element()
    }

    fn table_chip(&self, cx: &mut Context<Self>, text: String) -> AnyElement {
        let t = cx.tokens().clone();
        div().font_family(rexa_ui::MONO).text_color(t.primary).bg(with_alpha(t.primary, 0.1)).px_1().rounded(px(4.)).child(text).into_any_element()
    }

    pub(crate) fn render_sheet(&mut self, window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let sheet = self.sheet.clone()?;
        let t = cx.tokens().clone();
        Some(match sheet {
            SheetKind::Insert(inputs) => {
                let title = div()
                    .flex()
                    .items_center()
                    .gap_1()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .child("Add a new record to")
                    .child(self.table_chip(cx, self.table.name.clone()))
                    .child(".")
                    .into_any_element();
                let mut body = div().p_4().flex().flex_col().gap_4();
                for (name, input) in &inputs {
                    let Some(c) = self.structure.iter().find(|c| &c.column_name == name).cloned() else { continue };
                    let required = !c.is_nullable && c.column_default.is_none();
                    let empty = input.read(cx).value().is_empty();
                    body = body.child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(10.))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap(px(6.))
                                            .when(c.is_primary_key, |d| d.child(gpui_component::Icon::new(IconName::Key).size_3().text_color(tw("yellow-500"))))
                                            .when(c.is_foreign_key, |d| d.child(gpui_component::Icon::new(IconName::Link).size_3().text_color(t.primary)))
                                            .child(div().tw_text_xs().font_weight(FontWeight::SEMIBOLD).text_color(with_alpha(t.foreground, 0.8)).child(c.column_name.clone()))
                                            .when(required, |d| d.child(div().tw_text_xs().text_color(tw("red-500")).font_weight(FontWeight::BOLD).child("*"))),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_2()
                                            .when(c.is_primary_key && c.column_default.is_some(), |d| {
                                                d.child(div().tw_text_xs().px(px(6.)).py(px(2.)).rounded(px(4.)).bg(with_alpha(t.primary, 0.1)).font_weight(FontWeight::MEDIUM).text_color(t.primary).child("Auto"))
                                            })
                                            .child(div().tw_text_xs().px(px(6.)).py(px(2.)).rounded(px(4.)).bg(t.muted).font_family(rexa_ui::MONO).text_color(t.muted_foreground).child(c.data_type.clone())),
                                    ),
                            )
                            .child(
                                div().relative().font_family(rexa_ui::MONO).tw_text_xs().child(TextInput::new(input).h(40.)).when(c.is_nullable && empty, |d| {
                                    d.child(div().absolute().right_3().top(px(12.)).tw_text_xs().italic().text_color(with_alpha(t.muted_foreground, 0.5)).child(""))
                                }),
                            ),
                    );
                }
                let footer = div()
                    .flex()
                    .gap_2()
                    .child(Button::new("ins-cancel").ghost().size(ButtonSize::Sm).label("Cancel").on_click(cx.listener(|this, _, _, cx| {
                        this.sheet = None;
                        cx.notify();
                    })))
                    .child(Button::new("ins-save").size(ButtonSize::Sm).icon(IconName::Plus).label("Save Row").on_click(cx.listener(|this, _, _, cx| this.save_insert(cx))))
                    .into_any_element();
                self.sheet_shell(title, body.into_any_element(), Some(footer), 420., cx)
            }
            SheetKind::Review => self.render_review(cx),
            SheetKind::EditCell { row, col, json, error } => {
                let name = self.data.as_ref().and_then(|d| d.columns.get(col)).map(|c| c.name.clone()).unwrap_or_default();
                let title = div()
                    .h_7()
                    .px_2()
                    .flex()
                    .items_center()
                    .tw_rounded_md()
                    .bg(t.var("--studio-tab-active").unwrap_or(t.muted))
                    .tw_text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .child(format!("Edit {name}"))
                    .into_any_element();
                let state = self.sheet_text.clone()?;
                let modified = self.pending_cell(row, col).is_some();
                let body = div()
                    .size_full()
                    .flex()
                    .flex_col()
                    .child(div().flex_1().p_4().font_family(rexa_ui::MONO).tw_text_sm().child(gpui_component::input::Textarea::new(&state).appearance(false).h_full()))
                    .children(error.map(|e| div().border_t_1().border_color(with_alpha(t.destructive, 0.3)).px_4().py_2().tw_text_xs().text_color(t.destructive).child(e)))
                    .into_any_element();
                let footer = div()
                    .flex()
                    .gap_2()
                    .when(modified, |d| {
                        d.child(Button::new("sheet-discard").ghost().size(ButtonSize::Sm).label("Discard change").on_click(cx.listener(move |this, _, _, cx| {
                            this.discard_cell_change(row, col, cx);
                            this.sheet = None;
                        })))
                    })
                    .child(Button::new("sheet-null").ghost().size(ButtonSize::Sm).label("Set NULL").on_click(cx.listener(move |this, _, _, cx| {
                        this.update_cell(row, col, None, cx);
                        this.sheet = None;
                    })))
                    .child(Button::new("sheet-cancel").outline().size(ButtonSize::Sm).label("Cancel").on_click(cx.listener(|this, _, _, cx| {
                        this.sheet = None;
                        cx.notify();
                    })))
                    .child(Button::new("sheet-save").size(ButtonSize::Sm).label("Save pending").on_click(cx.listener(move |this, _, _, cx| {
                        let Some(state) = this.sheet_text.clone() else { return };
                        let text = state.read(cx).value().to_string();
                        if json && serde_json::from_str::<serde_json::Value>(&text).is_err() {
                            this.sheet = Some(SheetKind::EditCell { row, col, json, error: Some("Invalid JSON. Fix the syntax before saving.".into()) });
                            cx.notify();
                            return;
                        }
                        this.update_cell(row, col, Some(SharedString::from(text)), cx);
                        this.sheet = None;
                        cx.notify();
                    })))
                    .into_any_element();
                let _ = window;
                self.sheet_shell(title, body, Some(footer), 800., cx)
            }
            SheetKind::FkSelect(p) => self.render_fk_picker(p, cx),
        })
    }

    fn render_review(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let changes = self.pending_count();
        let actions = self.pending_actions.clone();
        let total = changes + actions.len();
        let title = div().tw_text_xs().text_color(t.muted_foreground).child(format!("{total} pending change{}", if total != 1 { "s" } else { "" })).into_any_element();
        let mut body = div().p_4().flex().flex_col().gap_4();
        if changes > 0 {
            let sql = self.pending_edits_sql();
            let unsaveable = self.pending.keys().filter(|k| k.starts_with("idx:")).count();
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(div().flex().items_center().justify_between().child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Cell Edits")).child(Badge::new(changes.to_string()).variant(BadgeVariant::Secondary)))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("{changes} cell edit{} pending", if changes != 1 { "s" } else { "" })))
                    .child(div().flex().flex_col().gap_2().children(sql.into_iter().map(|s| {
                        div().rounded(px(4.)).bg(t.muted).p_2().font_family(rexa_ui::MONO).text_size(px(10.)).line_height(px(15.)).text_color(t.foreground).child(s)
                    })))
                    .when(unsaveable > 0, |d| {
                        d.child(div().tw_text_xs().text_color(t.muted_foreground).child(format!(
                            "{unsaveable} row{} without a primary key can't be saved — commit will reject them.",
                            if unsaveable != 1 { "s" } else { "" }
                        )))
                    }),
            );
        }
        if !actions.is_empty() {
            let mut groups: Vec<(&'static str, Vec<crate::view::PendingAction>)> = Vec::new();
            for a in actions.iter().cloned() {
                match groups.iter_mut().find(|(k, _)| *k == a.kind.id()) {
                    Some((_, v)) => v.push(a),
                    None => groups.push((a.kind.id(), vec![a])),
                }
            }
            let fmt = |k: &str| k.split('_').map(|w| w[..1].to_uppercase() + &w[1..]).collect::<Vec<_>>().join(" ");
            body = body.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_3()
                    .child(div().flex().items_center().justify_between().child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Actions")).child(Badge::new(actions.len().to_string()).variant(BadgeVariant::Secondary)))
                    .children(groups.into_iter().map(|(k, list)| {
                        div()
                            .flex()
                            .flex_col()
                            .gap_2()
                            .child(div().flex().items_center().justify_between().tw_text_xs().child(div().font_weight(FontWeight::MEDIUM).child(fmt(k))).child(Badge::new(list.len().to_string()).variant(BadgeVariant::Outline)))
                            .children(list.into_iter().map(|a| {
                                let id = a.id;
                                div()
                                    .p_2()
                                    .rounded(px(4.))
                                    .border_1()
                                    .border_color(t.border)
                                    .bg(with_alpha(t.muted, 0.5))
                                    .tw_text_xs()
                                    .flex()
                                    .flex_col()
                                    .gap_1()
                                    .child(
                                        div().flex().items_start().justify_between().gap_2().child(div().flex_1().text_color(t.muted_foreground).child(a.description.clone())).child(
                                            Button::new(("rm-action", id as usize)).ghost().size(ButtonSize::IconXs).icon(IconName::X).on_click(cx.listener(move |this, _, _, cx| this.remove_action(id, cx))),
                                        ),
                                    )
                                    .child(div().p_1().rounded(px(4.)).bg(with_alpha(t.background, 0.5)).font_family(rexa_ui::MONO).text_size(px(10.)).child(a.sql.clone()))
                            }))
                    })),
            );
        }
        if total == 0 {
            body = body.child(div().text_center().py_8().tw_text_sm().text_color(t.muted_foreground).child("No pending changes"));
        }
        let committing = self.committing;
        let footer = div()
            .flex()
            .gap_2()
            .child(Button::new("clear-all").outline().size(ButtonSize::Sm).icon(IconName::Trash).label("Clear All").disabled(total == 0 || committing).on_click(cx.listener(|this, _, _, cx| this.clear_pending(cx))))
            .child(
                Button::new("commit")
                    .size(ButtonSize::Sm)
                    .icon(if committing { IconName::LoaderCircle } else { IconName::Check })
                    .label("Commit Changes")
                    .disabled(total == 0 || committing)
                    .on_click(cx.listener(|this, _, _, cx| this.commit_changes(cx))),
            )
            .into_any_element();
        self.sheet_shell(title, body.into_any_element(), Some(footer), 420., cx)
    }

    fn render_fk_picker(&mut self, p: FkPicker, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let title = div()
            .flex()
            .flex_1()
            .items_center()
            .gap_2()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_1()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .child("Choose a record from")
                    .child(self.table_chip(cx, format!("{}.{}", p.table.schema, p.table.name)))
                    .child("to link."),
            )
            .child(div().ml_auto().w(px(200.)).tw_text_xs().child(TextInput::new(&p.search).h(28.).prefix(gpui_component::Icon::new(IconName::Search).size_3p5().text_color(with_alpha(t.muted_foreground, 0.7)))))
            .into_any_element();
        let body = if p.loading {
            div()
                .py_16()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .gap_4()
                .child(rexa_ui::Spinner::new(32.))
                .child(div().tw_text_xs().text_color(t.muted_foreground).child("Loading available records..."))
                .into_any_element()
        } else if let Some(res) = &p.result {
            let q = p.search.read(cx).value().to_lowercase();
            let fcol = res.column_index(&p.foreign_column);
            let col_w = 160.;
            let header = div().flex().h_10().border_b_1().border_color(t.border).bg(mix_tokens(t.border, t.studio_bg, 0.8)).children(res.columns.iter().map(|c| {
                div().w(px(col_w)).flex_shrink_0().px_2().flex().items_center().border_r_1().border_color(t.border).tw_text_xs().font_weight(FontWeight::MEDIUM).overflow_hidden().child(c.clone())
            }));
            let rows = res.rows.iter().enumerate().filter(|(_, r)| q.is_empty() || r.iter().any(|c| c.as_str().is_some_and(|s| s.to_lowercase().contains(&q)))).map(|(i, r)| {
                let selected = p.selected == Some(i);
                div()
                    .id(("fk-row", i))
                    .flex()
                    .h(px(self.settings.row_spacing.row_height()))
                    .border_b_1()
                    .border_color(t.border)
                    .cursor_pointer()
                    .when(selected, |d| d.bg(gpui::rgba(0x1d377e33)))
                    .hover(|s| s.bg(t.studio_row_hover))
                    .children(r.iter().enumerate().map(|(ci, c)| {
                        let is_key = Some(ci) == fcol && !c.is_null();
                        div()
                            .w(px(col_w))
                            .flex_shrink_0()
                            .px_2()
                            .flex()
                            .items_center()
                            .border_r_1()
                            .border_color(t.border)
                            .text_size(px(13.))
                            .overflow_hidden()
                            .whitespace_nowrap()
                            .when(c.is_null(), |d| d.italic().text_color(t.muted_foreground))
                            .when(is_key, |d| d.text_color(t.primary).font_weight(FontWeight::BOLD))
                            .child(c.display().to_string())
                    }))
                    .on_click(cx.listener(move |this, ev: &gpui::ClickEvent, _, cx| {
                        if let Some(SheetKind::FkSelect(p)) = this.sheet.as_mut() {
                            p.selected = Some(i);
                        }
                        if ev.click_count() >= 2 {
                            this.continue_fk_picker(cx);
                        }
                        cx.notify();
                    }))
            });
            div().id("fk-grid").overflow_x_scroll().child(div().flex().flex_col().child(header).children(rows)).into_any_element()
        } else {
            div().py_16().flex().items_center().justify_center().text_color(t.muted_foreground).child("No data found").into_any_element()
        };
        let footer = div()
            .flex()
            .gap_2()
            .child(Button::new("fk-cancel").ghost().size(ButtonSize::Sm).label("Cancel").on_click(cx.listener(|this, _, _, cx| {
                this.sheet = None;
                cx.notify();
            })))
            .child(Button::new("fk-continue").size(ButtonSize::Sm).label("Continue").disabled(p.selected.is_none()).on_click(cx.listener(|this, _, _, cx| this.continue_fk_picker(cx))))
            .into_any_element();
        self.sheet_shell(title, body, Some(footer), 768., cx)
    }

    fn continue_fk_picker(&mut self, cx: &mut Context<Self>) {
        let Some(SheetKind::FkSelect(p)) = self.sheet.clone() else { return };
        let Some(res) = &p.result else { return };
        let (Some(i), Some(ci)) = (p.selected, res.column_index(&p.foreign_column)) else { return };
        let value = res.rows.get(i).and_then(|r| r.get(ci)).and_then(|c| c.as_str()).map(|s| SharedString::from(s.to_string()));
        self.sheet = None;
        self.update_cell(p.row, p.col, value, cx);
        cx.notify();
    }

    /// The FK preview popover (`fkPreviewData`).
    pub(crate) fn render_fk_preview(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> Option<AnyElement> {
        let p = self.fk_preview.clone()?;
        let t = cx.tokens().clone();
        let grip_color = with_alpha(t.muted_foreground, 0.4);
        let body = if p.loading {
            div().flex().items_center().justify_center().p_8().gap_2().child(rexa_ui::Spinner::new(16.)).child(div().tw_text_xs().text_color(t.muted_foreground).child("Loading...")).into_any_element()
        } else if let Some(res) = p.result.as_ref().filter(|r| !r.rows.is_empty()) {
            let row = &res.rows[0];
            div()
                .id("fk-preview-table")
                .overflow_x_scroll()
                .child(
                    div()
                        .flex()
                        .children(res.columns.iter().enumerate().map(|(i, name)| {
                            let meta = res.column_type(i);
                            let cell = row.get(i).cloned().unwrap_or(rexa_drivers::Cell::Null);
                            let shape = cells::value_shape(self.kind, &meta);
                            div()
                                .flex()
                                .flex_col()
                                .flex_shrink_0()
                                .border_r_1()
                                .border_color(t.studio_border)
                                .child(
                                    div()
                                        .px_3()
                                        .py_2()
                                        .border_b_1()
                                        .border_color(t.studio_border)
                                        .bg(with_alpha(t.muted, 0.3))
                                        .flex()
                                        .flex_col()
                                        .gap(px(2.))
                                        .child(div().tw_text_xs().font_weight(FontWeight::SEMIBOLD).child(name.clone()))
                                        .child(div().tw_text_xs().text_color(t.muted_foreground).child(meta.type_name.clone())),
                                )
                                .child(
                                    div().px_3().py_2().max_w(px(300.)).overflow_hidden().whitespace_nowrap().tw_text_xs().border_b_1().border_color(t.studio_border).child(match cells::serialize_cell(&cell, shape) {
                                        None => div().italic().text_color(with_alpha(t.muted_foreground, 0.3)).child("NULL"),
                                        Some(v) if matches!(shape, cells::ValueShape::Json | cells::ValueShape::Array(_)) => div().font_family(rexa_ui::MONO).text_color(with_alpha(tw("blue-400"), 0.8)).child(v),
                                        Some(v) => div().text_color(t.var("--studio-cell-text").unwrap_or(t.foreground)).child(v),
                                    }),
                                )
                        })),
                )
                .into_any_element()
        } else {
            div().flex().items_center().justify_center().p_8().tw_text_xs().text_color(t.muted_foreground).child(p.error.clone().unwrap_or_else(|| "Record not found".into())).into_any_element()
        };
        let (schema, table, fcol, value) = (p.table.schema.clone(), p.table.name.clone(), p.foreign_column.clone(), p.value.clone());
        // Viewport clamp of the resize (80vw / 80vh), min 280×120.
        let viewport = _window.viewport_size();
        let (max_w, max_h) = (f32::from(viewport.width) * 0.8, f32::from(viewport.height) * 0.8);
        let bounds_cell = p.bounds.clone();
        let resizing = p.resize_from.is_some();
        let this = cx.entity();
        let tracker = gpui::canvas(
            {
                let bounds_cell = bounds_cell.clone();
                move |b, _, _| bounds_cell.set(b)
            },
            move |_, _, window, _| {
                if !resizing {
                    return;
                }
                let this_move = this.clone();
                window.on_mouse_event(move |e: &gpui::MouseMoveEvent, phase, _, cx| {
                    if phase != gpui::DispatchPhase::Bubble {
                        return;
                    }
                    this_move.update(cx, |this, cx| {
                        if let Some(p) = this.fk_preview.as_mut() {
                            if let Some((start, w0, h0)) = p.resize_from {
                                let w = (w0 + f32::from(e.position.x - start.x)).min(max_w.round()).max(280.);
                                let h = (h0 + f32::from(e.position.y - start.y)).min(max_h.round()).max(120.);
                                p.size = Some((w.round(), h.round()));
                                cx.notify();
                            }
                        }
                    });
                });
                let this_up = this.clone();
                window.on_mouse_event(move |_: &gpui::MouseUpEvent, phase, _, cx| {
                    if phase != gpui::DispatchPhase::Bubble {
                        return;
                    }
                    this_up.update(cx, |this, cx| {
                        if let Some(p) = this.fk_preview.as_mut() {
                            p.resize_from = None;
                            cx.notify();
                        }
                    });
                });
            },
        )
        .absolute()
        .inset_0();
        let grip = gpui::canvas(
            |_, _, _| {},
            move |b, _, window, _| {
                // `<path d="M0 10 L10 10 L10 0 Z" />` in text-muted-foreground/40.
                let mut path = gpui::PathBuilder::fill();
                let (x, y, w, h) = (b.origin.x, b.origin.y, b.size.width, b.size.height);
                path.move_to(gpui::point(x, y + h));
                path.line_to(gpui::point(x + w, y + h));
                path.line_to(gpui::point(x + w, y));
                path.close();
                if let Ok(path) = path.build() {
                    window.paint_path(path, grip_color);
                }
            },
        )
        .absolute()
        .bottom(px(2.))
        .right(px(2.))
        .size_3();
        let handle = div()
            .id("fk-resize")
            .absolute()
            .bottom_0()
            .right_0()
            .size_4()
            .cursor(gpui::CursorStyle::ResizeUpLeftDownRight)
            .child(grip)
            .on_mouse_down(
                gpui::MouseButton::Left,
                cx.listener(move |this, e: &gpui::MouseDownEvent, _, cx| {
                    cx.stop_propagation();
                    if let Some(p) = this.fk_preview.as_mut() {
                        let b = p.bounds.get();
                        let (w, h) = p.size.unwrap_or((f32::from(b.size.width), f32::from(b.size.height)));
                        p.resize_from = Some((e.position, w, h));
                        cx.notify();
                    }
                }),
            );
        let (width, height) = match p.size {
            Some((w, h)) => (w, Some(h)),
            None => (420., None),
        };
        let panel = div()
            .id("fk-preview")
            .relative()
            .occlude()
            .w(px(width))
            .when_some(height, |d, h| d.h(px(h)))
            .max_w(px(max_w))
            .max_h(px(max_h))
            .child(tracker)
            .flex()
            .flex_col()
            .bg(t.studio_bg)
            .border_2()
            .border_color(tw("blue-500"))
            .shadow(rexa_ui::popup::shadow_2xl())
            .tw_rounded_lg()
            .overflow_hidden()
            .on_mouse_down_out(cx.listener(|this, _, _, cx| {
                this.fk_preview = None;
                cx.notify();
            }))
            .child(
                div()
                    .px_3()
                    .py_2()
                    .bg(with_alpha(t.muted, 0.3))
                    .border_b_1()
                    .border_color(t.studio_border)
                    .flex()
                    .items_center()
                    .justify_between()
                    .flex_shrink_0()
                    .child(
                        div()
                            .flex()
                            .tw_text_xs()
                            .font_weight(FontWeight::BOLD)
                            .text_color(t.muted_foreground)
                            .child("Referencing record from ")
                            .child(div().ml_1().text_color(tw("blue-500")).font_family(rexa_ui::MONO).child(format!("{schema}.{table}"))),
                    )
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .child(
                                div()
                                    .id("fk-open")
                                    .p_1()
                                    .cursor_pointer()
                                    .text_color(t.muted_foreground)
                                    .hover(|s| s.text_color(tw("blue-500")))
                                    .child(gpui_component::Icon::new(IconName::ExternalLink).size_3p5())
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        // onNavigateToTable: open the referenced table filtered to the value.
                                        this.fk_preview = None;
                                        let d = this.kind.dialect();
                                        let filter = format!("{} = '{}'", d.quote_ident(&fcol), value.replace('\'', "''"));
                                        crate::pending_filters::set(&schema, &table, filter);
                                        rexa_core::open_tab(rexa_core::TabSpec::Table { schema: schema.clone(), table: table.clone() }, cx);
                                        cx.notify();
                                    })),
                            )
                            .child(
                                div()
                                    .id("fk-close")
                                    .p_1()
                                    .cursor_pointer()
                                    .text_color(t.muted_foreground)
                                    .hover(|s| s.text_color(t.foreground))
                                    .child(gpui_component::Icon::new(IconName::X).size_3p5())
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.fk_preview = None;
                                        cx.notify();
                                    })),
                            ),
                    ),
            )
            .child(div().flex_1().min_h_0().child(body))
            .child(handle);
        Some(rexa_ui::popup::floating(p.anchor, rexa_ui::Side::Bottom, rexa_ui::Align::Start, 6., 0., panel))
    }
}
