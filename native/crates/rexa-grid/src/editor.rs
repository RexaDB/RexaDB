//! Port of the inline cell editors of @rexadbapp/data-table
//! `src/grid/rexa-cell-renderer.tsx` (`RexaCellEditor`: `TextEditor`,
//! `TypedEditor` for booleans/enums, `DateEditor`, the shared `EditorFooter`
//! with Save pending / Cancel / Set NULL / Discard change, and Alt+M to the
//! editing sheet). The overlay sits over the cell like Glide's overlay editor.

use crate::grid::HEADER_HEIGHT;
use crate::view::{SheetKind, TableEditor};
use gpui::{div, prelude::*, px, AnyElement, Context, Entity, FontWeight, KeyDownEvent, SharedString, Window};
use gpui_component::input::TextareaState;
use rexa_ui::widgets::InputState;
use rexa_ui::{tw, ActiveTokens, IconName, Tw};

const INLINE_TYPED_OPTIONS_MAX: usize = 8;

pub enum EditorInput {
    Text(Entity<TextareaState>),
    Date { state: Entity<InputState>, initial_raw: String, column: crate::date_value::DateColumn },
    /// Options + the highlighted one.
    #[allow(dead_code)]
    Typed { options: Vec<String>, active: usize, is_enum: bool },
}

pub struct CellEditor {
    pub vcol: usize,
    pub row: usize,
    pub col: usize,
    pub input: EditorInput,
    pub modified: bool,
}

impl TableEditor {
    pub(crate) fn open_editor(&mut self, vcol: usize, row: usize, col: usize, initial: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        // setEditingCell is a no-op while previewing as a role or user.
        if self.preview_only() {
            return;
        }
        let Some(column) = self.data.as_ref().and_then(|d| d.columns.get(col)).cloned() else { return };
        let value = self.cell_value(row, col);
        let modified = self.pending_cell(row, col).is_some();
        let enum_options = column.enum_options.clone().filter(|o| !o.is_empty());
        let input = if column.is_boolean() || enum_options.is_some() {
            let base = enum_options.clone().unwrap_or_else(|| vec!["true".into(), "false".into()]);
            let current = value.as_deref().unwrap_or("").to_string();
            let options = if !current.is_empty() && !base.contains(&current) { std::iter::once(current.clone()).chain(base).collect() } else { base };
            let active = options.iter().position(|o| *o == current).unwrap_or(0);
            EditorInput::Typed { options, active, is_enum: enum_options.is_some() }
        } else if column.is_date() {
            // DateEditor starts from the cell value (a typed key is not carried over).
            let initial_raw = value.as_deref().unwrap_or("").to_string();
            let date_column = crate::date_value::DateColumn::new(&column.data_type);
            let text = date_column.to_input_value(&initial_raw);
            let state = cx.new(|cx| InputState::new(window, cx).default_value(text));
            state.update(cx, |s, cx| s.focus(window, cx));
            EditorInput::Date { state, initial_raw, column: date_column }
        } else {
            let text = initial.unwrap_or_else(|| value.as_deref().unwrap_or("").to_string());
            let state = cx.new(|cx| TextareaState::new(window, cx).auto_grow(1, 10).default_value(text));
            state.update(cx, |s, cx| s.focus(window, cx));
            EditorInput::Text(state)
        };
        let typed = matches!(input, EditorInput::Typed { .. });
        self.grid.editor = Some(CellEditor { vcol, row, col, input, modified });
        if typed {
            self.editor_focus.focus(window, cx);
        }
        cx.notify();
    }

    fn editor_text(&self, cx: &Context<Self>) -> Option<String> {
        match &self.grid.editor.as_ref()?.input {
            EditorInput::Text(s) => Some(s.read(cx).value().to_string()),
            EditorInput::Date { state, initial_raw, column } => Some(column.commit_value(initial_raw, &state.read(cx).value())),
            EditorInput::Typed { options, active, .. } => options.get(*active).cloned(),
        }
    }

    /// "Save pending" / Enter / click elsewhere.
    pub(crate) fn commit_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(text) = self.editor_text(cx) else { return };
        let Some(ed) = self.grid.editor.take() else { return };
        let old = self.cell_value(ed.row, ed.col);
        // An untouched editor never rewrites the value.
        if old.as_deref() != Some(text.as_str()) || matches!(ed.input, EditorInput::Typed { .. }) {
            self.update_cell(ed.row, ed.col, Some(SharedString::from(text)), cx);
        }
        self.focus.focus(window, cx);
        cx.notify();
    }

    pub(crate) fn cancel_editor(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.grid.editor = None;
        self.focus.focus(window, cx);
        cx.notify();
    }

    fn editor_set_null(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(ed) = self.grid.editor.take() {
            self.update_cell(ed.row, ed.col, None, cx);
        }
        self.focus.focus(window, cx);
    }

    fn editor_discard(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(ed) = self.grid.editor.take() {
            self.discard_cell_change(ed.row, ed.col, cx);
        }
        self.focus.focus(window, cx);
    }

    /// Alt+M / maximize: the editing sheet (JSON columns get the JSON editor).
    fn editor_maximize(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let text = self.editor_text(cx).unwrap_or_default();
        let Some(ed) = self.grid.editor.take() else { return };
        let json = self.data.as_ref().is_some_and(|d| d.columns[ed.col].is_json());
        let text = if json { crate::sheets::format_json_text(&text) } else { text };
        let state = cx.new(|cx| TextareaState::new(window, cx).default_value(text));
        state.update(cx, |s, cx| s.focus(window, cx));
        self.sheet_text = Some(state);
        self.sheet = Some(SheetKind::EditCell { row: ed.row, col: ed.col, json, error: None });
        cx.notify();
    }

    fn on_editor_key(&mut self, ev: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let k = &ev.keystroke;
        let m = k.modifiers;
        match k.key.as_str() {
            "enter" if !m.shift => {
                self.commit_editor(window, cx);
                cx.stop_propagation();
            }
            "escape" => {
                self.cancel_editor(window, cx);
                cx.stop_propagation();
            }
            "n" if m.alt => {
                self.editor_set_null(window, cx);
                cx.stop_propagation();
            }
            "d" if m.alt && self.grid.editor.as_ref().is_some_and(|e| e.modified) => {
                self.editor_discard(window, cx);
                cx.stop_propagation();
            }
            "m" if m.alt && matches!(self.grid.editor.as_ref().map(|e| &e.input), Some(EditorInput::Text(_))) => {
                self.editor_maximize(window, cx);
                cx.stop_propagation();
            }
            key @ ("up" | "down" | "left" | "right") => {
                if let Some(CellEditor { input: EditorInput::Typed { options, active, .. }, .. }) = self.grid.editor.as_mut() {
                    let n = options.len().max(1);
                    *active = if matches!(key, "down" | "right") { (*active + 1) % n } else { (*active + n - 1) % n };
                    cx.stop_propagation();
                    cx.notify();
                }
            }
            _ => {}
        }
    }

    fn footer_button(id: &'static str, kbd: AnyElement, label: &'static str, amber: bool, cx: &mut Context<Self>, f: fn(&mut TableEditor, &mut Window, &mut Context<TableEditor>)) -> impl IntoElement {
        let t = cx.tokens().clone();
        let fg = if amber { tw("amber-500") } else { rexa_ui::with_alpha(t.foreground, 0.8) };
        let hover = if amber { tw("amber-400") } else { t.foreground };
        div()
            .id(id)
            .flex()
            .items_center()
            .gap(px(6.))
            .whitespace_nowrap()
            .tw_text_xs()
            .font_weight(FontWeight::MEDIUM)
            .text_color(fg)
            .cursor_pointer()
            .hover(move |s| s.text_color(hover))
            .child(kbd)
            .child(label)
            .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(cx.listener(move |this, _, window, cx| f(this, window, cx)))
    }

    fn kbd_box(text: Option<&'static str>, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let d = div()
            .flex()
            .items_center()
            .justify_center()
            .h_4()
            .rounded(px(4.))
            .bg(t.background)
            .border_1()
            .border_color(t.studio_border)
            .tw_text_xs()
            .font_family(rexa_ui::MONO);
        match text {
            Some(s) => d.px_1().child(s).into_any_element(),
            None => d.w_4().child(gpui_component::Icon::new(IconName::CornerDownLeft).size(px(10.))).into_any_element(),
        }
    }

    pub(crate) fn render_editor_overlay(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let ed = self.grid.editor.as_ref()?;
        let (vcol, row, modified) = (ed.vcol, ed.row, ed.modified);
        let data = self.data.as_ref()?;
        let vis = self.visible_columns();
        let ix = *vis.get(vcol)?;
        // Place over the cell (same math as the canvas).
        let mut x = crate::grid::ROW_MARKER_WIDTH;
        for (i, c) in vis.iter().enumerate() {
            if i == vcol {
                break;
            }
            x += self.column_width(&data.columns[*c]);
        }
        let w = self.column_width(&data.columns[ix]);
        if vcol != 0 {
            x -= self.grid.scroll.x;
        }
        let rh = self.settings.row_spacing.row_height();
        let y = HEADER_HEIGHT + row as f32 * rh - self.grid.scroll.y;
        let t = cx.tokens().clone();
        let bg = crate::sheets::mix_tokens(t.studio_row_hover, t.studio_bg, 0.15);
        let typed_bg = crate::sheets::mix_tokens(t.studio_row_hover, t.studio_bg, 0.3);
        let footer = div()
            .flex()
            .items_center()
            .justify_between()
            .px_2()
            .py(px(6.))
            .bg(t.studio_row_hover)
            .border_t_1()
            .border_color(t.studio_border)
            .gap_4()
            .flex_shrink_0()
            .child(
                div()
                    .flex()
                    .flex_wrap()
                    .items_center()
                    .gap_x_4()
                    .gap_y_2()
                    .child(Self::footer_button("ed-save", Self::kbd_box(None, cx), "Save pending", false, cx, |e, w, cx| e.commit_editor(w, cx)))
                    .child(Self::footer_button("ed-cancel", Self::kbd_box(Some("esc"), cx), "Cancel", false, cx, |e, w, cx| e.cancel_editor(w, cx)))
                    .child(Self::footer_button("ed-null", Self::kbd_box(Some("⌥N"), cx), "Set NULL", false, cx, |e, w, cx| e.editor_set_null(w, cx)))
                    .when(modified, |d| d.child(Self::footer_button("ed-discard", Self::kbd_box(Some("⌥D"), cx), "Discard change", true, cx, |e, w, cx| e.editor_discard(w, cx)))),
            );
        let body: AnyElement = match &ed.input {
            EditorInput::Text(state) => {
                let footer = footer.child(
                    div()
                        .id("ed-max")
                        .p_1()
                        .rounded(px(4.))
                        .cursor_pointer()
                        .text_color(rexa_ui::with_alpha(t.foreground, 0.8))
                        .hover(|s| s.bg(t.muted).text_color(t.foreground))
                        .child(gpui_component::Icon::new(IconName::Maximize2).size_3p5())
                        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .on_click(cx.listener(|this, _, window, cx| this.editor_maximize(window, cx))),
                );
                div()
                    .flex()
                    .flex_col()
                    .bg(bg)
                    .child(
                        div().px_3().py_2().tw_text_xs().min_h(px(rh)).child(
                            gpui_component::input::Textarea::new(state).appearance(false),
                        ),
                    )
                    .child(footer)
                    .into_any_element()
            }
            EditorInput::Date { state, column, .. } => {
                let selected = column.selected_day(&state.read(cx).value()).map(|d| {
                    use chrono::Datelike;
                    rexa_ui::calendar::Date::new(d.year(), d.month(), d.day())
                });
                let editor = cx.entity();
                let input = state.clone();
                // Popover + Calendar anchored on the calendar button (align start, sideOffset 8).
                let calendar = rexa_ui::Popover::new("ed-calendar")
                    .align(rexa_ui::popup::Align::Start)
                    .side_offset(8.)
                    .w(None)
                    .p(0.)
                    .trigger(div().id("ed-calendar-btn").flex_shrink_0().cursor_pointer().child(gpui_component::Icon::new(IconName::Calendar).size_3p5().text_color(tw("blue-500"))))
                    .content(move |ctl, _, _| {
                        let (editor, input, ctl) = (editor.clone(), input.clone(), ctl.clone());
                        rexa_ui::Calendar::new("ed-calendar-days")
                            .selected(selected)
                            .selected_colors(tw("blue-600"), gpui::white())
                            .on_select(move |date, window, cx| {
                                let Some(day) = chrono::NaiveDate::from_ymd_opt(date.year, date.month, date.day) else { return };
                                let next = editor.read(cx).grid.editor.as_ref().and_then(|ed| match &ed.input {
                                    EditorInput::Date { column, .. } => Some(column.with_day(&input.read(cx).value(), day)),
                                    _ => None,
                                });
                                if let Some(next) = next {
                                    input.update(cx, |s, cx| s.set_value(next, window, cx));
                                }
                                ctl.close(window, cx);
                                input.update(cx, |s, cx| s.focus(window, cx));
                            })
                    });
                div()
                    .flex()
                    .flex_col()
                    .bg(typed_bg)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .px_3()
                            .gap_2()
                            .py_2()
                            .child(calendar)
                            .child(div().flex_1().tw_text_xs().child(gpui_component::input::Input::new(state).appearance(false))),
                    )
                    .child(footer)
                    .into_any_element()
            }
            EditorInput::Typed { options, active, .. } => {
                let inline = !options.is_empty() && options.len() <= INLINE_TYPED_OPTIONS_MAX;
                let list = div().flex().flex_col().w_full().overflow_hidden().children(options.iter().enumerate().map(|(i, o)| {
                    let is_active = i == *active;
                    div()
                        .id(("ed-opt", i))
                        .w_full()
                        .h(px(rh))
                        .px_3()
                        .flex()
                        .items_center()
                        .tw_text_xs()
                        .cursor_pointer()
                        .when(is_active, |d| d.bg(gpui::rgba(0x1d377e33)).text_color(t.foreground))
                        .when(!is_active, |d| d.text_color(rexa_ui::with_alpha(t.foreground, 0.72)).hover(|s| s.text_color(t.foreground)))
                        .child(o.clone())
                        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .on_click(cx.listener(move |this, ev: &gpui::ClickEvent, window, cx| {
                            if let Some(CellEditor { input: EditorInput::Typed { active, .. }, .. }) = this.grid.editor.as_mut() {
                                *active = i;
                            }
                            if ev.click_count() >= 2 {
                                this.commit_editor(window, cx);
                            }
                            cx.notify();
                        }))
                }));
                div()
                    .id("typed-editor")
                    .track_focus(&self.editor_focus)
                    .flex()
                    .flex_col()
                    .bg(typed_bg)
                    .child(if inline { list.into_any_element() } else { div().px_3().py_2().child(list).into_any_element() })
                    .child(footer)
                    .into_any_element()
            }
        };
        Some(
            div()
                .id("cell-editor")
                .absolute()
                .left(px(x))
                .top(px(y))
                .w(px(w))
                .border_1()
                .border_color(rexa_ui::with_alpha(t.studio_border, 0.8))
                .rounded_b(px(8.))
                .shadow(rexa_ui::popup::shadow_2xl())
                .overflow_hidden()
                .occlude()
                .text_color(t.foreground)
                .capture_key_down(cx.listener(Self::on_editor_key))
                .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                .on_scroll(|_, _, cx| cx.stop_propagation())
                .child(body),
        )
    }
}
