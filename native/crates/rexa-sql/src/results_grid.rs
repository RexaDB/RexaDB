//! The SQL results grid — a read-only port of the look of
//! `@rexadbapp/data-table/grid` (Glide Data Grid) as the SQL editor and the
//! query-history logs configure it: 40px header (`500 12px`, type icon,
//! chevron menu zone), `checkbox-visible` row markers (44px), relaxed 36px
//! rows, 13px sans cells with 8px padding, `NULL` in muted italic, column
//! widths from `computeAutoColumnWidths` (7.5px/char, 150–600px), a trailing
//! "Add column" column, and the theme from `useGlideGridTheme`.
//!
//! Approximations: no cell editing, column resize, sorting menu or frozen
//! first column (rexa-grid owns the full table editor); the header chevron
//! is drawn but has no menu. Cmd+C copies the selected cell.

use gpui::{
    div, prelude::*, px, uniform_list, App, ClipboardItem, Context, FocusHandle, Focusable, FontWeight,
    Hsla, ListHorizontalSizingBehavior, MouseButton, Rgba, ScrollStrategy, SharedString, UniformListScrollHandle,
    Window,
};
use gpui_component::Icon;
use rexa_drivers::{Cell, QueryResult, TypeCategory};
use rexa_ui::{square_check, tw, with_alpha, ActiveTokens, IconName, Tokens, Tw};
use std::collections::BTreeSet;
use std::rc::Rc;
use std::sync::Arc;

const HEADER_HEIGHT: f32 = 40.;
const ROW_MARKER_WIDTH: f32 = 44.;
const ADD_COLUMN_WIDTH: f32 = 150.;
const CHAR_WIDTH: f32 = 7.5;
const MIN_WIDTH: f32 = 150.;
const MAX_WIDTH: f32 = 600.;
const CELL_PADDING: f32 = 20.;
const HEADER_ICON_SPACE: f32 = 24.;

/// Custom cell rendering (the query-history logs' `customCellRenderer`).
pub type CellRenderer = Rc<dyn Fn(&str, &Cell, &Tokens) -> Option<gpui::AnyElement>>;

pub struct ResultsGrid {
    result: Arc<QueryResult>,
    widths: Vec<f32>,
    pub row_height: f32,
    pub show_add_column: bool,
    selected_rows: BTreeSet<usize>,
    selected_cell: Option<(usize, usize)>,
    hovered_row: Option<usize>,
    scroll: UniformListScrollHandle,
    focus: FocusHandle,
    pub cell_renderer: Option<CellRenderer>,
}

impl Focusable for ResultsGrid {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

/// `computeAutoColumnWidths` (no table structure for SQL results).
pub fn auto_widths(r: &QueryResult) -> Vec<f32> {
    r.columns
        .iter()
        .enumerate()
        .map(|(i, name)| {
            let header = name.chars().count() as f32 * CHAR_WIDTH + HEADER_ICON_SPACE;
            let mut max_len = (header / CHAR_WIDTH).ceil() as usize;
            for row in r.rows.iter().take(1000) {
                if let Some(Cell::Text(s)) = row.get(i) {
                    max_len = max_len.max(s.chars().count());
                }
            }
            (max_len as f32 * CHAR_WIDTH + CELL_PADDING).clamp(MIN_WIDTH, MAX_WIDTH)
        })
        .collect()
}

fn mix(a: Hsla, b: Hsla, amount: f32) -> Hsla {
    let (a, b): (Rgba, Rgba) = (a.into(), b.into());
    let m = |x: f32, y: f32| x + (y - x) * amount;
    Rgba { r: m(a.r, b.r), g: m(a.g, b.g), b: m(a.b, b.b), a: 1. }.into()
}

/// `useGlideGridTheme` + `useGlideHoverColors`.
pub struct GridTheme {
    pub bg_cell: Hsla,
    pub bg_header: Hsla,
    pub border: Hsla,
    pub text_dark: Hsla,
    pub text_medium: Hsla,
    pub row_hover: Hsla,
}

impl GridTheme {
    pub fn new(t: &Tokens) -> Self {
        let border = t.var("--border").unwrap_or(t.studio_border);
        GridTheme {
            bg_cell: t.studio_bg,
            bg_header: mix(border, t.studio_bg, 0.8),
            border,
            text_dark: t.var("--studio-cell-text").unwrap_or(t.foreground),
            text_medium: t.var("--studio-cell-muted").unwrap_or(t.muted_foreground),
            row_hover: with_alpha(t.var("--studio-accent-purple").unwrap_or_else(|| tw("violet-600")), 0.05),
        }
    }
}

fn type_icon(category: TypeCategory) -> IconName {
    match category {
        TypeCategory::Integer | TypeCategory::Decimal => IconName::Hash,
        TypeCategory::Date | TypeCategory::Time | TypeCategory::Timestamp => IconName::Calendar,
        TypeCategory::Boolean => IconName::SquareCheck,
        TypeCategory::Uuid => IconName::Database,
        TypeCategory::Json => IconName::List,
        _ => IconName::Type,
    }
}

impl ResultsGrid {
    pub fn new(result: Arc<QueryResult>, cx: &mut Context<Self>) -> Self {
        let widths = auto_widths(&result);
        ResultsGrid {
            result,
            widths,
            row_height: 36.,
            show_add_column: true,
            selected_rows: BTreeSet::new(),
            selected_cell: None,
            hovered_row: None,
            scroll: UniformListScrollHandle::new(),
            focus: cx.focus_handle(),
            cell_renderer: None,
        }
    }

    pub fn set_result(&mut self, result: Arc<QueryResult>, cx: &mut Context<Self>) {
        if Arc::ptr_eq(&self.result, &result) {
            return;
        }
        self.widths = auto_widths(&result);
        self.result = result;
        self.selected_rows.clear();
        self.selected_cell = None;
        self.scroll.scroll_to_item(0, ScrollStrategy::Top);
        cx.notify();
    }

    pub fn set_widths(&mut self, widths: Vec<f32>) {
        self.widths = widths;
    }

    fn copy_selection(&self, cx: &mut App) {
        if let Some((r, c)) = self.selected_cell {
            if let Some(cell) = self.result.rows.get(r).and_then(|row| row.get(c)) {
                cx.write_to_clipboard(ClipboardItem::new_string(cell.as_str().unwrap_or("").to_string()));
            }
        }
    }
}

impl Render for ResultsGrid {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let g = GridTheme::new(&t);
        let result = self.result.clone();
        let widths = self.widths.clone();
        let total_width: f32 =
            ROW_MARKER_WIDTH + widths.iter().sum::<f32>() + if self.show_add_column { ADD_COLUMN_WIDTH } else { 0. };
        let scroll_x = self.scroll.0.borrow().base_handle.offset().x;
        let all_selected = !result.rows.is_empty() && self.selected_rows.len() == result.rows.len();

        let header_cell = |w: f32| {
            div()
                .flex_shrink_0()
                .w(px(w))
                .h_full()
                .flex()
                .items_center()
                .border_r_1()
                .border_b_1()
                .border_color(g.border)
        };
        let header = div()
            .flex()
            .flex_shrink_0()
            .h(px(HEADER_HEIGHT))
            .w(px(total_width))
            .ml(scroll_x)
            .bg(g.bg_header)
            .child(
                header_cell(ROW_MARKER_WIDTH)
                    .justify_center()
                    .id("hdr-check")
                    .cursor_pointer()
                    .on_click(cx.listener(|this, _, _, cx| {
                        let n = this.result.rows.len();
                        if this.selected_rows.len() == n {
                            this.selected_rows.clear();
                        } else {
                            this.selected_rows = (0..n).collect();
                        }
                        cx.notify();
                    }))
                    .child(square_check(all_selected, cx)),
            )
            .children(result.columns.iter().enumerate().map(|(i, name)| {
                let meta = result.column_type(i);
                header_cell(widths[i])
                    .pl(px(8.))
                    .gap(px(6.))
                    .child(Icon::new(type_icon(meta.category)).size(px(14.)).text_color(g.text_medium))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .overflow_hidden()
                            .whitespace_nowrap()
                            .text_ellipsis()
                            .text_size(px(12.))
                            .line_height(px(16.))
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(g.text_dark)
                            .child(name.clone()),
                    )
                    .child(
                        div()
                            .w(px(30.))
                            .flex_shrink_0()
                            .flex()
                            .justify_center()
                            .child(Icon::new(IconName::ChevronDown).size(px(14.)).text_color(g.text_medium)),
                    )
            }))
            .when(self.show_add_column, |el| {
                el.child(
                    header_cell(ADD_COLUMN_WIDTH)
                        .pl(px(8.))
                        .gap(px(6.))
                        .child(Icon::new(IconName::Plus).size(px(14.)).text_color(g.text_medium))
                        .child(
                            div()
                                .text_size(px(12.))
                                .line_height(px(16.))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(g.text_medium)
                                .child("Add column"),
                        ),
                )
            });

        let row_height = self.row_height;
        let selected_rows = self.selected_rows.clone();
        let selected_cell = self.selected_cell;
        let hovered = self.hovered_row;
        let show_add = self.show_add_column;
        let renderer = self.cell_renderer.clone();
        let entity = cx.entity();
        let g2 = GridTheme::new(&t);
        let t2 = t.clone();
        let body = uniform_list("sql-results-rows", result.rows.len(), move |range, _window, cx| {
            range
                .map(|ix| {
                    let row = &result.rows[ix];
                    let checked = selected_rows.contains(&ix);
                    let bg = if checked {
                        with_alpha(tw("blue-500"), 0.1)
                    } else if hovered == Some(ix) {
                        g2.row_hover
                    } else {
                        gpui::transparent_black()
                    };
                    let e = entity.clone();
                    div()
                        .id(("row", ix))
                        .flex()
                        .h(px(row_height))
                        .w(px(total_width))
                        .bg(g2.bg_cell)
                        .child(
                            div().absolute().size_full().bg(bg),
                        )
                        .relative()
                        .on_hover({
                            let e = e.clone();
                            move |hovering, _, cx| {
                                e.update(cx, |this, cx| {
                                    if *hovering {
                                        this.hovered_row = Some(ix);
                                    } else if this.hovered_row == Some(ix) {
                                        this.hovered_row = None;
                                    }
                                    cx.notify();
                                })
                            }
                        })
                        .child(
                            div()
                                .id(("mark", ix))
                                .flex_shrink_0()
                                .w(px(ROW_MARKER_WIDTH))
                                .h_full()
                                .flex()
                                .items_center()
                                .justify_center()
                                .border_r_1()
                                .border_b_1()
                                .border_color(g2.border)
                                .cursor_pointer()
                                .on_click({
                                    let e = e.clone();
                                    move |_, _, cx| {
                                        e.update(cx, |this, cx| {
                                            if !this.selected_rows.remove(&ix) {
                                                this.selected_rows.insert(ix);
                                            }
                                            cx.notify();
                                        })
                                    }
                                })
                                .child(square_check(checked, cx)),
                        )
                        .children(row.iter().enumerate().map(|(ci, cell)| {
                            let is_sel = selected_cell == Some((ix, ci));
                            let col_name = result.columns.get(ci).cloned().unwrap_or_default();
                            let custom = renderer.as_ref().and_then(|r| r(&col_name, cell, &t2));
                            let content = custom.unwrap_or_else(|| match cell {
                                Cell::Null => div()
                                    .text_color(g2.text_medium)
                                    .italic()
                                    .child("NULL")
                                    .into_any_element(),
                                Cell::Text(s) => {
                                    let text: String = s.chars().take(500).collect::<String>().replace(['\n', '\r'], " ");
                                    div().text_color(g2.text_dark).child(SharedString::from(text)).into_any_element()
                                }
                            });
                            let e = e.clone();
                            div()
                                .id(("cell", ix * 4096 + ci))
                                .flex_shrink_0()
                                .w(px(widths[ci]))
                                .h_full()
                                .relative()
                                .flex()
                                .items_center()
                                .px(px(8.))
                                .overflow_hidden()
                                .whitespace_nowrap()
                                .text_size(px(13.))
                                .line_height(px(16.))
                                .border_r_1()
                                .border_b_1()
                                .border_color(g2.border)
                                .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                                    e.update(cx, |this, cx| {
                                        this.selected_cell = Some((ix, ci));
                                        window.focus(&this.focus, cx);
                                        cx.notify();
                                    })
                                })
                                .child(content)
                                .when(is_sel, |d| {
                                    d.child(
                                        div()
                                            .absolute()
                                            .top(px(1.5))
                                            .left(px(1.5))
                                            .right(px(1.5))
                                            .bottom(px(1.5))
                                            .border_1()
                                            .border_color(tw("blue-500")),
                                    )
                                })
                        }))
                        .when(show_add, |d| {
                            d.child(
                                div()
                                    .flex_shrink_0()
                                    .w(px(ADD_COLUMN_WIDTH))
                                    .h_full()
                                    .border_r_1()
                                    .border_b_1()
                                    .border_color(g2.border),
                            )
                        })
                })
                .collect::<Vec<_>>()
        })
        .with_horizontal_sizing_behavior(ListHorizontalSizingBehavior::Unconstrained)
        .track_scroll(&self.scroll)
        .flex_1()
        .min_h_0();


        div()
            .track_focus(&self.focus)
            .key_context("SqlResultsGrid")
            .on_key_down(cx.listener(|this, ev: &gpui::KeyDownEvent, _, cx| {
                let k = &ev.keystroke;
                if k.key == "c" && k.modifiers.platform {
                    this.copy_selection(cx);
                    cx.stop_propagation();
                }
            }))
            .flex_1()
            .flex()
            .flex_col()
            .min_h_0()
            .size_full()
            .overflow_hidden()
            .bg(g.bg_cell)
            .font_family(rexa_ui::SANS)
            .child(div().w_full().overflow_hidden().flex_shrink_0().child(header))
            .child(body)
            // Re-render as the list scrolls so the header follows horizontally.
            .on_scroll(cx.listener(|_, _, _, cx| cx.notify()))
            .tw_text_xs()
    }
}
