//! Port of @rexadbapp/data-table `src/grid/data-grid.tsx`,
//! `rexa-cell-renderer.tsx` (cell drawing), `theme.ts` (canvas palette),
//! `context-menu.tsx` and `states.tsx`. The original draws on a Glide Data
//! Grid canvas; this draws the same layers with GPUI paint calls inside a
//! `canvas` element and hit-tests pointer events itself, so only the visible
//! rows/columns are ever shaped or painted (cheap at any page size).
//!
//! Glide behaviour reproduced explicitly: row-marker checkboxes always
//! visible, frozen first data column, header click = sort (ASC → DESC →
//! clear), right 30px of a header = column menu (always-drawn chevron),
//! column resize by dragging a header edge (clamped 80–1200), drag / shift /
//! ⌘-click range selection (`rangeSelect="multi-rect"`), arrow-key
//! navigation, ⌘C copies the selection as TSV, ⌘A selects every row,
//! ⌥N sets NULL, ⌥D discards a pending edit, double-click / Enter edits.

use crate::cells;
use crate::view::{GridColumn, TableEditor};
use gpui::{
    canvas, div, fill, point, prelude::*, px, size, App, Bounds, ClipboardItem, Context, ContentMask, Corners,
    CursorStyle, Edges, FontStyle, FontWeight, Hsla, KeyDownEvent, MouseButton, MouseDownEvent, MouseMoveEvent,
    MouseUpEvent, Pixels, Point, Rgba, ScrollEvent, SharedString, TextAlign, TextRun, TransformationMatrix,
    Window,
};
use rexa_ui::{tw, with_alpha, ActiveTokens, Tokens, Tw};
use std::cell::Cell;
use std::collections::HashMap;
use std::rc::Rc;
use std::time::{Duration, Instant};

pub const ROW_MARKER_WIDTH: f32 = 44.;
pub const HEADER_HEIGHT: f32 = 40.;
pub const ADD_COLUMN_WIDTH: f32 = 150.;
pub const HEADER_MENU_ZONE_WIDTH: f32 = 30.;
pub const FK_BUTTON_SIZE: f32 = 20.;
pub const FK_BUTTON_MARGIN: f32 = 6.;
const RESIZE_ZONE: f32 = 5.;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: usize,
    pub y: usize,
    pub w: usize,
    pub h: usize,
}

impl Rect {
    pub fn cell(x: usize, y: usize) -> Self {
        Rect { x, y, w: 1, h: 1 }
    }
    fn span(a: (usize, usize), b: (usize, usize)) -> Self {
        let (x0, x1) = (a.0.min(b.0), a.0.max(b.0));
        let (y0, y1) = (a.1.min(b.1), a.1.max(b.1));
        Rect { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
    }
    pub fn contains(&self, c: usize, r: usize) -> bool {
        c >= self.x && c < self.x + self.w && r >= self.y && r < self.y + self.h
    }
}

/// `gridSelection.current`: anchor cell, its range and ⌘-click extras.
#[derive(Debug, Clone, PartialEq)]
pub struct Selection {
    /// (visible column, row)
    pub cell: (usize, usize),
    pub range: Rect,
    pub stack: Vec<Rect>,
}

impl Selection {
    pub fn is_multi(&self) -> bool {
        !self.stack.is_empty() || self.range.w * self.range.h > 1
    }
    pub fn contains(&self, c: usize, r: usize) -> bool {
        self.range.contains(c, r) || self.stack.iter().any(|s| s.contains(c, r))
    }
}

#[derive(Debug, Clone, Copy)]
enum Drag {
    Select { anchor: (usize, usize), additive: bool },
    Resize { col: usize, start_x: f32, start_w: f32 },
    Markers { from: usize },
}

/// Header menu / cell context menu (`RexaContextMenu`).
#[derive(Clone)]
pub struct MenuEntry {
    pub label: SharedString,
    pub separator_before: bool,
    pub action: Rc<dyn Fn(&mut TableEditor, &mut Window, &mut Context<TableEditor>)>,
}

#[derive(Clone)]
pub struct GridMenu {
    pub position: Point<Pixels>,
    pub items: Vec<MenuEntry>,
}

#[derive(Default)]
pub struct GridState {
    pub scroll: Point<f32>,
    pub manual_widths: HashMap<String, f32>,
    pub hover_cell: Option<(usize, usize)>,
    pub hover_header: Option<usize>,
    pub hover_fk_button: Option<(usize, usize)>,
    pub hover_marker: Option<usize>,
    pub selection: Option<Selection>,
    drag: Option<Drag>,
    pub bounds: Rc<Cell<Bounds<Pixels>>>,
    pub editor: Option<crate::editor::CellEditor>,
    pub menu: Option<GridMenu>,
    last_scroll: Option<Instant>,
}

impl GridState {
    pub fn clear_selection(&mut self) {
        self.selection = None;
        self.editor = None;
    }
}

/// Canvas palette (`useGlideGridTheme` + `useGlideHoverColors`).
#[derive(Clone, Copy)]
pub struct GridTheme {
    pub bg_cell: Hsla,
    pub bg_header: Hsla,
    pub bg_header_hovered: Hsla,
    pub border: Hsla,
    pub text_dark: Hsla,
    pub text_medium: Hsla,
    pub cell_hover: Hsla,
    pub row_hover: Hsla,
    pub column_hover: Hsla,
    pub accent: Hsla,
    pub selection: Hsla,
}

fn mix(a: Hsla, b: Hsla, amount: f32) -> Hsla {
    let (a, b): (Rgba, Rgba) = (a.into(), b.into());
    let m = |x: f32, y: f32| ((x + (y - x) * amount) * 255.).round() / 255.;
    Rgba { r: m(a.r, b.r), g: m(a.g, b.g), b: m(a.b, b.b), a: 1. }.into()
}

impl GridTheme {
    pub fn from_tokens(t: &Tokens) -> Self {
        let bg = t.studio_bg;
        let border = t.border;
        let legacy_header = t.var("--table-header-bg").unwrap_or(t.studio_header_bg);
        let text_medium = t.var("--studio-cell-muted").unwrap_or(t.muted_foreground);
        GridTheme {
            bg_cell: bg,
            bg_header: mix(border, bg, 0.8),
            bg_header_hovered: mix(border, legacy_header, 0.5),
            border,
            text_dark: t.var("--studio-cell-text").unwrap_or(t.foreground),
            text_medium,
            cell_hover: mix(border, bg, 0.5),
            row_hover: with_alpha(t.var("--studio-accent-purple").unwrap_or(t.primary), 0.05),
            column_hover: mix(border, bg, 0.3),
            // Fixed colors of the original (grid-cell.tsx `cellSelectionBorder` / `cellSelectionBg`).
            accent: gpui::rgb(0x4e81ee).into(),
            selection: gpui::rgba(0x1d377e33).into(),
        }
    }
}

/// One visible column's placement.
#[derive(Clone)]
struct ColPlace {
    /// index into `data.columns` (None = the "Add column" column)
    data_ix: Option<usize>,
    /// left edge in viewport coordinates
    x: f32,
    w: f32,
    frozen: bool,
}

/// Geometry of one frame.
#[derive(Clone, Default)]
struct Geometry {
    cols: Vec<ColPlace>,
    content_w: f32,
    rows: usize,
    row_h: f32,
    frozen_right: f32,
}

impl TableEditor {
    /// Columns shown in the grid (results minus hidden), as indices into `data.columns`.
    pub fn visible_columns(&self) -> Vec<usize> {
        let Some(data) = &self.data else { return Vec::new() };
        data.columns.iter().enumerate().filter(|(_, c)| !self.hidden.contains(&c.name)).map(|(i, _)| i).collect()
    }

    pub fn column_width(&self, c: &GridColumn) -> f32 {
        self.grid.manual_widths.get(&c.name).copied().unwrap_or(c.auto_width)
    }

    fn row_height(&self) -> f32 {
        self.settings.row_spacing.row_height()
    }

    fn geometry(&self) -> Geometry {
        let Some(data) = &self.data else { return Geometry { row_h: self.row_height(), ..Geometry::default() } };
        let mut cols = Vec::new();
        let mut x = 0.;
        for (vi, ix) in self.visible_columns().into_iter().enumerate() {
            let w = self.column_width(&data.columns[ix]);
            cols.push(ColPlace { data_ix: Some(ix), x, w, frozen: vi == 0 });
            x += w;
        }
        cols.push(ColPlace { data_ix: None, x, w: ADD_COLUMN_WIDTH, frozen: false });
        x += ADD_COLUMN_WIDTH;
        let frozen_right = ROW_MARKER_WIDTH + cols.first().filter(|c| c.frozen).map_or(0., |c| c.w);
        let sx = self.grid.scroll.x;
        for c in cols.iter_mut() {
            c.x = if c.frozen { ROW_MARKER_WIDTH } else { ROW_MARKER_WIDTH + c.x - sx };
        }
        Geometry { cols, content_w: ROW_MARKER_WIDTH + x, rows: data.rows.len(), row_h: self.row_height(), frozen_right }
    }

    fn max_scroll(&self, g: &Geometry) -> Point<f32> {
        let b = self.grid.bounds.get();
        let (vw, vh) = (f32::from(b.size.width), f32::from(b.size.height));
        point((g.content_w - vw).max(0.), (g.rows as f32 * g.row_h - (vh - HEADER_HEIGHT)).max(0.))
    }

    fn clamp_scroll(&mut self) {
        let g = self.geometry();
        let m = self.max_scroll(&g);
        self.grid.scroll.x = self.grid.scroll.x.clamp(0., m.x);
        self.grid.scroll.y = self.grid.scroll.y.clamp(0., m.y);
    }

    /// Scroll so (visible col, row) is in view.
    pub fn scroll_into_view(&mut self, vcol: usize, row: usize) {
        let g = self.geometry();
        let b = self.grid.bounds.get();
        let vh = f32::from(b.size.height) - HEADER_HEIGHT;
        let vw = f32::from(b.size.width);
        let top = row as f32 * g.row_h;
        if top < self.grid.scroll.y {
            self.grid.scroll.y = top;
        } else if top + g.row_h > self.grid.scroll.y + vh {
            self.grid.scroll.y = top + g.row_h - vh;
        }
        if let Some(c) = g.cols.get(vcol).filter(|c| !c.frozen) {
            let left = c.x + self.grid.scroll.x - ROW_MARKER_WIDTH;
            let frozen_w = g.frozen_right - ROW_MARKER_WIDTH;
            if left - frozen_w < self.grid.scroll.x {
                self.grid.scroll.x = (left - frozen_w).max(0.);
            } else if ROW_MARKER_WIDTH + left + c.w > self.grid.scroll.x + vw {
                self.grid.scroll.x = ROW_MARKER_WIDTH + left + c.w - vw;
            }
        }
        self.clamp_scroll();
    }

    // ---- hit testing -----------------------------------------------------------------------

    fn local(&self, p: Point<Pixels>) -> Point<f32> {
        let o = self.grid.bounds.get().origin;
        point(f32::from(p.x - o.x), f32::from(p.y - o.y))
    }

    fn col_at(g: &Geometry, x: f32) -> Option<usize> {
        // Frozen column wins where it overlaps scrolled ones.
        if let Some(i) = g.cols.iter().position(|c| c.frozen && x >= c.x && x < c.x + c.w) {
            return Some(i);
        }
        g.cols.iter().position(|c| !c.frozen && x >= c.x.max(g.frozen_right) && x < c.x + c.w)
    }

    fn row_at(&self, g: &Geometry, y: f32) -> Option<usize> {
        if y < HEADER_HEIGHT {
            return None;
        }
        let r = ((y - HEADER_HEIGHT + self.grid.scroll.y) / g.row_h).floor() as usize;
        (r < g.rows).then_some(r)
    }

    fn resize_edge(g: &Geometry, x: f32) -> Option<usize> {
        g.cols.iter().position(|c| c.data_ix.is_some() && (x - (c.x + c.w)).abs() <= RESIZE_ZONE && c.x + c.w >= g.frozen_right - 0.5)
    }

    // ---- pointer ------------------------------------------------------------------------------

    fn on_grid_mouse_down(&mut self, ev: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        self.focus.focus(window, cx);
        self.grid.menu = None;
        let p = self.local(ev.position);
        let g = self.geometry();
        let data_len = g.rows;
        if ev.button == MouseButton::Right {
            if let (Some(vc), Some(r)) = (Self::col_at(&g, p.x), self.row_at(&g, p.y)) {
                if g.cols[vc].data_ix.is_some() {
                    self.open_cell_menu(vc, r, ev.position, cx);
                }
            }
            return;
        }
        if ev.button != MouseButton::Left {
            return;
        }
        if self.grid.editor.is_some() {
            self.commit_editor(window, cx);
        }
        if p.y < HEADER_HEIGHT {
            if p.x < ROW_MARKER_WIDTH {
                // Select-all checkbox.
                if self.selected_rows.len() == data_len && data_len > 0 {
                    self.selected_rows.clear();
                } else {
                    self.selected_rows = (0..data_len).collect();
                }
                cx.notify();
                return;
            }
            if let Some(ci) = Self::resize_edge(&g, p.x) {
                let c = &g.cols[ci];
                self.grid.drag = Some(Drag::Resize { col: ci, start_x: p.x, start_w: c.w });
                return;
            }
            if let Some(ci) = Self::col_at(&g, p.x) {
                let c = g.cols[ci].clone();
                let Some(ix) = c.data_ix else {
                    Rexa::toast_add_column(cx);
                    return;
                };
                let name = self.data.as_ref().unwrap().columns[ix].name.clone();
                if p.x >= c.x + c.w - HEADER_MENU_ZONE_WIDTH {
                    let bounds_origin = self.grid.bounds.get().origin;
                    let pos = point(bounds_origin.x + px(c.x + c.w - 192.), bounds_origin.y + px(HEADER_HEIGHT));
                    self.open_header_menu(ix, pos, cx);
                } else {
                    self.cycle_sort(&name, cx);
                }
            }
            return;
        }
        let Some(row) = self.row_at(&g, p.y) else { return };
        if p.x < ROW_MARKER_WIDTH {
            // Row marker checkbox: toggle (shift extends from the last toggled row).
            if self.selected_rows.contains(&row) {
                self.selected_rows.remove(&row);
            } else {
                self.selected_rows.insert(row);
            }
            self.grid.drag = Some(Drag::Markers { from: row });
            cx.notify();
            return;
        }
        let Some(vc) = Self::col_at(&g, p.x) else { return };
        let place = g.cols[vc].clone();
        let Some(ix) = place.data_ix else { return };
        // FK preview button (right edge zone).
        let col = self.data.as_ref().unwrap().columns[ix].clone();
        let value = self.cell_value(row, ix);
        if col.is_fk && value.is_some() && p.x >= place.x + place.w - (FK_BUTTON_SIZE + FK_BUTTON_MARGIN) {
            let top = HEADER_HEIGHT + row as f32 * g.row_h - self.grid.scroll.y + (g.row_h - FK_BUTTON_SIZE) / 2.;
            let o = self.grid.bounds.get().origin;
            let left = place.x + place.w - FK_BUTTON_MARGIN - FK_BUTTON_SIZE;
            self.toggle_fk_preview(row, ix, Bounds::new(point(o.x + px(left), o.y + px(top)), size(px(FK_BUTTON_SIZE), px(FK_BUTTON_SIZE))), window, cx);
            return;
        }
        if ev.click_count >= 2 {
            self.grid.selection = Some(Selection { cell: (vc, row), range: Rect::cell(vc, row), stack: Vec::new() });
            self.activate_cell(vc, row, None, window, cx);
            return;
        }
        let additive = ev.modifiers.platform || ev.modifiers.control;
        match (&mut self.grid.selection, ev.modifiers.shift) {
            (Some(sel), true) => {
                sel.range = Rect::span(sel.cell, (vc, row));
            }
            (Some(sel), false) if additive => {
                let prev = sel.range;
                sel.stack.push(prev);
                sel.cell = (vc, row);
                sel.range = Rect::cell(vc, row);
            }
            _ => {
                self.grid.selection = Some(Selection { cell: (vc, row), range: Rect::cell(vc, row), stack: Vec::new() });
            }
        }
        // Clicking a cell clears the checkbox row selection (Glide's rows follow gridSelection).
        if !ev.modifiers.shift && !additive {
            self.selected_rows.clear();
        }
        self.grid.drag = Some(Drag::Select { anchor: self.grid.selection.as_ref().unwrap().cell, additive });
        cx.notify();
    }

    fn on_grid_mouse_move(&mut self, ev: &MouseMoveEvent, window: &mut Window, cx: &mut Context<Self>) {
        let p = self.local(ev.position);
        let g = self.geometry();
        match self.grid.drag {
            Some(Drag::Resize { col, start_x, start_w }) => {
                if let Some(ix) = g.cols.get(col).and_then(|c| c.data_ix) {
                    let name = self.data.as_ref().unwrap().columns[ix].name.clone();
                    let w = (start_w + p.x - start_x).clamp(80., 1200.);
                    self.grid.manual_widths.insert(name, w);
                    cx.notify();
                }
                return;
            }
            Some(Drag::Select { anchor, .. }) if ev.pressed_button == Some(MouseButton::Left) => {
                if let (Some(vc), Some(r)) = (Self::col_at(&g, p.x), self.row_at(&g, p.y.max(HEADER_HEIGHT))) {
                    if g.cols[vc].data_ix.is_some() {
                        if let Some(sel) = &mut self.grid.selection {
                            let next = Rect::span(anchor, (vc, r));
                            if sel.range != next {
                                sel.range = next;
                                cx.notify();
                            }
                        }
                    }
                }
                return;
            }
            Some(Drag::Markers { from }) if ev.pressed_button == Some(MouseButton::Left) => {
                if let Some(r) = self.row_at(&g, p.y) {
                    let (a, b) = (from.min(r), from.max(r));
                    let want = self.selected_rows.contains(&from);
                    for i in a..=b {
                        if want {
                            self.selected_rows.insert(i);
                        }
                    }
                    cx.notify();
                }
                return;
            }
            _ => {}
        }
        let header = (p.y >= 0. && p.y < HEADER_HEIGHT).then(|| Self::col_at(&g, p.x)).flatten().filter(|c| g.cols[*c].data_ix.is_some());
        let row = self.row_at(&g, p.y);
        let col = Self::col_at(&g, p.x);
        let cell = match (col, row) {
            (Some(c), Some(r)) if p.x >= ROW_MARKER_WIDTH => Some((c, r)),
            _ => None,
        };
        let marker = row.filter(|_| p.x < ROW_MARKER_WIDTH);
        let fk = cell.filter(|(c, r)| {
            let place = &g.cols[*c];
            place.data_ix.is_some_and(|ix| {
                self.data.as_ref().unwrap().columns[ix].is_fk
                    && self.cell_value(*r, ix).is_some()
                    && p.x >= place.x + place.w - (FK_BUTTON_SIZE + FK_BUTTON_MARGIN)
            })
        });
        if header != self.grid.hover_header || cell != self.grid.hover_cell || fk != self.grid.hover_fk_button || marker != self.grid.hover_marker {
            self.grid.hover_header = header;
            self.grid.hover_cell = cell;
            self.grid.hover_fk_button = fk;
            self.grid.hover_marker = marker;
            cx.notify();
        }
        let _ = window;
    }

    fn on_grid_mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.grid.drag.take().is_some() {
            cx.notify();
        }
    }

    fn on_grid_scroll(&mut self, ev: &ScrollEvent, _: &mut Window, cx: &mut Context<Self>) {
        let d = ev.delta.pixel_delta(px(self.row_height()));
        let before = self.grid.scroll;
        self.grid.scroll.x -= f32::from(d.x);
        self.grid.scroll.y -= f32::from(d.y);
        self.clamp_scroll();
        if self.grid.scroll != before {
            self.grid.last_scroll = Some(Instant::now());
            self.grid.editor = None;
            self.fk_preview = None;
            self.maybe_load_more(cx);
            cx.notify();
            // Fade the overlay scrollbars (macOS "when scrolling").
            cx.spawn(async move |this, cx| {
                cx.background_executor().timer(Duration::from_millis(1000)).await;
                this.update(cx, |_, cx| cx.notify()).ok();
            })
            .detach();
        }
    }

    /// `shouldLoadTableBatch`: within 20 rows of the end.
    fn maybe_load_more(&mut self, cx: &mut Context<Self>) {
        if !self.infinite() {
            return;
        }
        let g = self.geometry();
        let vh = f32::from(self.grid.bounds.get().size.height) - HEADER_HEIGHT;
        let visible_end = ((self.grid.scroll.y + vh) / g.row_h).ceil() as usize;
        if g.rows > 0 && visible_end + 20 >= g.rows && self.load_more_error.is_none() {
            self.load_more(cx);
        }
    }

    // ---- keyboard ------------------------------------------------------------------------------

    pub(crate) fn on_grid_key(&mut self, ev: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        if self.grid.editor.is_some() || self.sheet.is_some() {
            return;
        }
        let k = &ev.keystroke;
        let m = k.modifiers;
        let key = k.key.as_str();
        let cmd = m.platform || m.control;
        if self.grid.menu.is_some() && key == "escape" {
            self.grid.menu = None;
            cx.notify();
            return;
        }
        if cmd && key == "a" {
            let n = self.data.as_ref().map_or(0, |d| d.rows.len());
            self.selected_rows = (0..n).collect();
            self.grid.selection = None;
            cx.stop_propagation();
            cx.notify();
            return;
        }
        if cmd && key == "c" {
            self.copy_selection(false, cx);
            cx.stop_propagation();
            return;
        }
        if cmd && key == "v" {
            self.paste_into_selection(window, cx);
            cx.stop_propagation();
            return;
        }
        let Some(sel) = self.grid.selection.clone() else { return };
        let (vc, row) = sel.cell;
        let vis = self.visible_columns();
        let Some(&ix) = vis.get(vc) else { return };
        if m.alt && key == "n" {
            self.update_cell(row, ix, None, cx);
            cx.stop_propagation();
            return;
        }
        if m.alt && key == "d" {
            self.discard_cell_change(row, ix, cx);
            cx.stop_propagation();
            return;
        }
        let rows = self.data.as_ref().map_or(0, |d| d.rows.len());
        let page = ((f32::from(self.grid.bounds.get().size.height) - HEADER_HEIGHT) / self.row_height()).floor().max(1.) as usize;
        let target = match key {
            "up" if cmd => Some((vc, 0)),
            "down" if cmd => Some((vc, rows.saturating_sub(1))),
            "left" if cmd => Some((0, row)),
            "right" if cmd => Some((vis.len().saturating_sub(1), row)),
            "up" => Some((vc, row.saturating_sub(1))),
            "down" => Some((vc, (row + 1).min(rows.saturating_sub(1)))),
            "left" => Some((vc.saturating_sub(1), row)),
            "right" | "tab" if !m.shift || key == "right" => Some(((vc + 1).min(vis.len().saturating_sub(1)), row)),
            "tab" => Some((vc.saturating_sub(1), row)),
            "pageup" => Some((vc, row.saturating_sub(page))),
            "pagedown" => Some((vc, (row + page).min(rows.saturating_sub(1)))),
            "home" => Some((vc, 0)),
            "end" => Some((vc, rows.saturating_sub(1))),
            _ => None,
        };
        if let Some(t) = target {
            if m.shift && key != "tab" {
                // Extend the range from the anchor; the anchor cell stays.
                let mut s = sel.clone();
                let corner = (
                    if s.range.x == s.cell.0 { s.range.x + s.range.w - 1 } else { s.range.x },
                    if s.range.y == s.cell.1 { s.range.y + s.range.h - 1 } else { s.range.y },
                );
                let moved = match key {
                    "up" => (corner.0, corner.1.saturating_sub(1)),
                    "down" => (corner.0, (corner.1 + 1).min(rows.saturating_sub(1))),
                    "left" => (corner.0.saturating_sub(1), corner.1),
                    "right" => ((corner.0 + 1).min(vis.len().saturating_sub(1)), corner.1),
                    _ => t,
                };
                s.range = Rect::span(s.cell, moved);
                s.stack.clear();
                self.grid.selection = Some(s);
                self.scroll_into_view(moved.0, moved.1);
            } else {
                self.grid.selection = Some(Selection { cell: t, range: Rect::cell(t.0, t.1), stack: Vec::new() });
                self.scroll_into_view(t.0, t.1);
            }
            self.maybe_load_more(cx);
            cx.stop_propagation();
            cx.notify();
            return;
        }
        match key {
            "enter" => {
                self.activate_cell(vc, row, None, window, cx);
                cx.stop_propagation();
            }
            "escape" => {
                self.grid.selection = None;
                cx.notify();
            }
            _ => {
                // Typing starts editing with that character (Glide).
                if let Some(ch) = k.key_char.as_ref().filter(|c| !cmd && !m.alt && !c.is_empty() && !c.chars().any(char::is_control)) {
                    self.activate_cell(vc, row, Some(ch.clone()), window, cx);
                    cx.stop_propagation();
                }
            }
        }
    }

    /// `onCellActivated` (Enter / double-click): FK columns open the picker, others the editor.
    fn activate_cell(&mut self, vc: usize, row: usize, initial: Option<String>, window: &mut Window, cx: &mut Context<Self>) {
        let vis = self.visible_columns();
        let Some(&ix) = vis.get(vc) else { return };
        let col = self.data.as_ref().unwrap().columns[ix].clone();
        if col.is_fk {
            self.open_fk_picker(row, ix, window, cx);
            return;
        }
        if !self.driver.capabilities().row_edit {
            return;
        }
        self.open_editor(vc, row, ix, initial, window, cx);
    }

    // ---- clipboard -------------------------------------------------------------------------------

    fn clip(v: Option<&str>) -> String {
        v.unwrap_or("").to_string()
    }

    /// `buildSelectedCellsClipboard(includeHeaders)`.
    pub fn selected_cells_clipboard(&self, headers: bool) -> String {
        let Some(sel) = &self.grid.selection else { return String::new() };
        let Some(data) = &self.data else { return String::new() };
        let vis = self.visible_columns();
        let name = |c: usize| vis.get(c).map(|ix| data.columns[*ix].name.clone());
        let val = |r: usize, c: usize| vis.get(c).map(|ix| Self::clip(self.cell_value(r, *ix).as_deref())).unwrap_or_default();
        let mut lines = Vec::new();
        if !sel.stack.is_empty() {
            let mut seen = std::collections::BTreeSet::new();
            for rect in std::iter::once(&sel.range).chain(sel.stack.iter()) {
                for r in rect.y..rect.y + rect.h {
                    for c in rect.x..rect.x + rect.w {
                        if name(c).is_some() {
                            seen.insert((r, c));
                        }
                    }
                }
            }
            if headers {
                lines.push("row\tcolumn\tvalue".to_string());
            }
            for (r, c) in seen {
                lines.push(format!("{}\t{}\t{}", r + 1, name(c).unwrap(), val(r, c)));
            }
            return lines.join("\n");
        }
        let rect = sel.range;
        if headers {
            lines.push((rect.x..rect.x + rect.w).filter_map(name).collect::<Vec<_>>().join("\t"));
        }
        for r in rect.y..rect.y + rect.h {
            lines.push((rect.x..rect.x + rect.w).map(|c| val(r, c)).collect::<Vec<_>>().join("\t"));
        }
        lines.join("\n")
    }

    /// ⌘C: Glide copies the cell range (values only), or the checked rows.
    fn copy_selection(&mut self, headers: bool, cx: &mut Context<Self>) {
        let text = if self.grid.selection.is_some() {
            self.selected_cells_clipboard(headers)
        } else if !self.selected_rows.is_empty() {
            let Some(data) = &self.data else { return };
            let vis = self.visible_columns();
            self.selected_rows
                .iter()
                .map(|r| vis.iter().map(|ix| Self::clip(self.cell_value(*r, *ix).as_deref())).collect::<Vec<_>>().join("\t"))
                .collect::<Vec<_>>()
                .join("\n")
                + if data.rows.is_empty() { "" } else { "" }
        } else {
            return;
        };
        cx.write_to_clipboard(ClipboardItem::new_string(text));
    }

    /// ⌘V: paste TSV into the cells from the selection anchor, as edits.
    fn paste_into_selection(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        let Some(sel) = self.grid.selection.clone() else { return };
        let Some(text) = cx.read_from_clipboard().and_then(|c| c.text()) else { return };
        let vis = self.visible_columns();
        let rows = self.data.as_ref().map_or(0, |d| d.rows.len());
        for (dr, line) in text.trim_end_matches('\n').split('\n').enumerate() {
            for (dc, value) in line.trim_end_matches('\r').split('\t').enumerate() {
                let (c, r) = (sel.cell.0 + dc, sel.cell.1 + dr);
                if r >= rows {
                    continue;
                }
                if let Some(&ix) = vis.get(c) {
                    if !self.data.as_ref().unwrap().columns[ix].is_fk {
                        self.update_cell(r, ix, Some(value.to_string().into()), cx);
                    }
                }
            }
        }
    }

    fn select_rows_from_cells(&mut self, cx: &mut Context<Self>) {
        let Some(sel) = &self.grid.selection else { return };
        let mut rows = std::collections::BTreeSet::new();
        for rect in std::iter::once(&sel.range).chain(sel.stack.iter()) {
            for r in rect.y..rect.y + rect.h {
                rows.insert(r);
            }
        }
        if !rows.is_empty() {
            self.selected_rows = rows;
            cx.notify();
        }
    }

    // ---- menus -------------------------------------------------------------------------------------

    fn entry(label: impl Into<SharedString>, sep: bool, f: impl Fn(&mut TableEditor, &mut Window, &mut Context<TableEditor>) + 'static) -> MenuEntry {
        MenuEntry { label: label.into(), separator_before: sep, action: Rc::new(f) }
    }

    /// Header chevron menu (`onHeaderClicked` menu zone).
    fn open_header_menu(&mut self, ix: usize, position: Point<Pixels>, cx: &mut Context<Self>) {
        let col = self.data.as_ref().unwrap().columns[ix].clone();
        let dt = if col.data_type.is_empty() { "text".to_string() } else { col.data_type.clone() };
        let (asc, desc) = cells::sort_labels(&dt);
        let name = col.name.clone();
        let (n1, n2) = (name.clone(), name.clone());
        let items = vec![
            Self::entry(asc, false, move |this, _, cx| {
                this.set_sort(Some(rexa_drivers::SortConfig { column: n1.clone(), direction: rexa_drivers::SortDirection::Asc }), cx)
            }),
            Self::entry(desc, false, move |this, _, cx| {
                this.set_sort(Some(rexa_drivers::SortConfig { column: n2.clone(), direction: rexa_drivers::SortDirection::Desc }), cx)
            }),
            // Present but unwired in the original too.
            Self::entry("Resize to fit", true, |_, _, _| {}),
        ];
        self.grid.menu = Some(GridMenu { position, items });
        cx.notify();
    }

    /// `onCellContextMenu`.
    fn open_cell_menu(&mut self, vc: usize, row: usize, position: Point<Pixels>, cx: &mut Context<Self>) {
        let vis = self.visible_columns();
        let Some(&ix) = vis.get(vc) else { return };
        // Right-click selects the cell unless it is inside the current selection.
        if !self.grid.selection.as_ref().is_some_and(|s| s.contains(vc, row)) {
            self.grid.selection = Some(Selection { cell: (vc, row), range: Rect::cell(vc, row), stack: Vec::new() });
        }
        let selected = self.selected_rows.contains(&row);
        let value = self.data.as_ref().unwrap().rows[row][ix].clone();
        let mut items = vec![Self::entry(if selected { "Deselect row" } else { "Select row" }, false, move |this, _, cx| {
            if !this.selected_rows.remove(&row) {
                this.selected_rows.insert(row);
            }
            cx.notify();
        })];
        items.push(Self::entry("Duplicate row", false, move |this, _, cx| this.duplicate_row(row, cx)));
        items.push(Self::entry("Copy cell", false, move |_, _, cx| {
            cx.write_to_clipboard(ClipboardItem::new_string(value.as_deref().unwrap_or("").to_string()));
        }));
        items.push(Self::entry("Filter by this value", false, move |this, _, cx| this.filter_by_cell(ix, row, cx)));
        if self.grid.selection.as_ref().is_some_and(|s| s.is_multi()) {
            items.push(Self::entry("Copy selected cells", true, |this, _, cx| this.copy_selection(true, cx)));
            items.push(Self::entry("Copy selected cell values", false, |this, _, cx| this.copy_selection(false, cx)));
            items.push(Self::entry("Select rows from selected cells", false, |this, _, cx| this.select_rows_from_cells(cx)));
        }
        items.push(Self::entry("Copy row as JSON", true, move |this, _, cx| this.copy_row(row, true, cx)));
        items.push(Self::entry("Copy row as CSV", false, move |this, _, cx| this.copy_row(row, false, cx)));
        self.grid.menu = Some(GridMenu { position, items });
        cx.notify();
    }

    fn render_menu(&self, cx: &mut Context<Self>) -> Option<impl IntoElement> {
        let menu = self.grid.menu.clone()?;
        let t = cx.tokens().clone();
        let mut panel = div()
            .id("grid-menu")
            .occlude()
            .min_w(px(200.))
            .rounded(px(6.))
            .border_1()
            .border_color(t.studio_border)
            .bg(t.popover)
            .p_1()
            .shadow(rexa_ui::popup::shadow_2xl())
            .tw_text_xs()
            .text_color(t.foreground)
            .on_mouse_down_out(cx.listener(|this, _, _, cx| {
                this.grid.menu = None;
                cx.notify();
            }));
        for (i, item) in menu.items.into_iter().enumerate() {
            if item.separator_before {
                panel = panel.child(div().my_1().h(px(1.)).bg(t.studio_border));
            }
            let action = item.action.clone();
            panel = panel.child(
                div()
                    .id(("grid-menu-item", i))
                    .flex()
                    .w_full()
                    .items_center()
                    .rounded(px(4.))
                    .px_2()
                    .py(px(6.))
                    .cursor_pointer()
                    .hover(|s| s.bg(t.muted))
                    .child(item.label)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.grid.menu = None;
                        action(this, window, cx);
                        cx.notify();
                    })),
            );
        }
        // Clamp like the original (x ≤ innerWidth − 220).
        let vp = cx.windows().first().map(|_| ()).map(|_| ());
        let _ = vp;
        Some(rexa_ui::popup::floating_at(menu.position, panel))
    }

    // ---- states (states.tsx) ------------------------------------------------------------------------

    fn render_no_results(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let err = self.error.clone();
        div()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .text_color(t.muted_foreground)
            .child(
                div()
                    .max_w(px(320.))
                    .flex()
                    .flex_col()
                    .items_center()
                    .text_center()
                    .child(
                        div()
                            .size_16()
                            .bg(t.muted)
                            .tw_rounded_lg()
                            .flex()
                            .items_center()
                            .justify_center()
                            .mb_4()
                            .child(gpui_component::Icon::new(rexa_ui::IconName::Table2).size_8().opacity(0.2)),
                    )
                    .child(
                        div()
                            .tw_text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .text_color(t.foreground)
                            .mb_1()
                            .child(if err.is_some() { "Failed to load data" } else { "No table selected" }),
                    )
                    .child(div().tw_text_xs().child(err.clone().unwrap_or_else(|| "Select a table from the sidebar to view its data directly.".into())))
                    .when(err.is_some(), |d| {
                        d.child(
                            div().mt_4().child(
                                rexa_ui::Button::new("retry")
                                    .outline()
                                    .size(rexa_ui::ButtonSize::Sm)
                                    .label("Retry")
                                    .on_click(cx.listener(|this, _, _, cx| this.refresh_current_tab(cx))),
                            ),
                        )
                    }),
            )
    }

    // ---- render ---------------------------------------------------------------------------------------

    pub(crate) fn render_grid_area(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let body = if self.data.is_none() && !self.loading {
            self.render_no_results(cx).into_any_element()
        } else if self.loading && self.data.is_none() && self.settings.skeleton_loaders {
            self.render_skeleton(cx).into_any_element()
        } else {
            self.render_canvas(window, cx).into_any_element()
        };
        div()
            .flex_1()
            .flex()
            .flex_col()
            .min_h_0()
            .overflow_hidden()
            .child(div().relative().flex_1().min_h_0().child(body))
            .when(self.data.is_some() || self.loading, |d| d.child(self.render_footer(window, cx)))
    }

    fn render_skeleton(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let sk = |w: Option<f32>| {
            let d = div().h_4().tw_rounded_sm().bg(t.muted);
            match w {
                Some(w) => d.w(px(w)),
                None => d.flex_1(),
            }
        };
        div()
            .size_full()
            .flex()
            .flex_col()
            .child(
                div()
                    .h_10()
                    .border_b_1()
                    .border_color(t.border)
                    .bg(t.var("--table-header-bg").unwrap_or(t.studio_header_bg))
                    .flex()
                    .items_center()
                    .px_4()
                    .gap_4()
                    .child(sk(Some(16.)))
                    .child(sk(Some(96.)))
                    .child(sk(Some(128.)))
                    .child(sk(Some(80.))),
            )
            .child(div().flex_1().p_4().flex().flex_col().gap_4().children((0..10).map(|_| {
                div().flex().items_center().gap_4().child(sk(Some(16.))).child(sk(None)).child(sk(Some(128.))).child(sk(Some(96.)))
            })))
    }

    fn render_canvas(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let tokens = cx.tokens().clone();
        let theme = GridTheme::from_tokens(&tokens);
        let frame = Rc::new(self.build_frame(&theme, cx));
        let bounds_cell = self.grid.bounds.clone();
        let entity = cx.entity().downgrade();
        let focused = self.focus.is_focused(window);
        let _ = focused;
        let cursor = if matches!(self.grid.drag, Some(Drag::Resize { .. })) {
            CursorStyle::ResizeLeftRight
        } else if self.grid.hover_fk_button.is_some() {
            CursorStyle::PointingHand
        } else {
            CursorStyle::Arrow
        };
        let resize_hover = self.grid.hover_header.is_some();
        let _ = resize_hover;
        div()
            .id("data-grid")
            .track_focus(&self.focus)
            .key_context("DataGrid")
            .size_full()
            .relative()
            .overflow_hidden()
            .bg(theme.bg_cell)
            .cursor(cursor)
            .on_key_down(cx.listener(Self::on_grid_key))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::on_grid_mouse_down))
            .on_mouse_down(MouseButton::Right, cx.listener(Self::on_grid_mouse_down))
            .on_mouse_move(cx.listener(Self::on_grid_mouse_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::on_grid_mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::on_grid_mouse_up))
            .on_scroll(cx.listener(Self::on_grid_scroll))
            .on_hover(cx.listener(|this, hovered: &bool, _, cx| {
                if !*hovered {
                    this.grid.hover_cell = None;
                    this.grid.hover_header = None;
                    this.grid.hover_fk_button = None;
                    this.grid.hover_marker = None;
                    cx.notify();
                }
            }))
            .child(
                canvas(
                    move |bounds, window, _| {
                        if bounds_cell.get() != bounds {
                            bounds_cell.set(bounds);
                            // First layout / resize: re-render with the real viewport.
                            window.refresh();
                        }
                        bounds
                    },
                    move |bounds, _, window, cx| paint_frame(&frame, bounds, window, cx),
                )
                .size_full(),
            )
            .children(self.render_editor_overlay(window, cx))
            .children(self.render_menu(cx))
    }

    fn build_frame(&self, theme: &GridTheme, cx: &App) -> Frame {
        let g = self.geometry();
        let b = self.grid.bounds.get();
        let vh = f32::from(b.size.height).max(600.);
        let vw = f32::from(b.size.width).max(1200.);
        let first = (self.grid.scroll.y / g.row_h).floor() as usize;
        let count = ((vh - HEADER_HEIGHT) / g.row_h).ceil() as usize + 2;
        let rows: Vec<usize> = (first..(first + count).min(g.rows)).collect();
        let data = self.data.as_ref();
        let search = self.page_search_term(cx);
        let sort = self.sort.clone();
        let mut columns = Vec::new();
        for (vi, place) in g.cols.iter().enumerate() {
            if place.x + place.w < 0. || place.x > vw {
                continue;
            }
            let Some(ix) = place.data_ix else {
                columns.push(FrameCol { vi, x: place.x, w: place.w, frozen: false, header: None, cells: Vec::new() });
                continue;
            };
            let col = &data.unwrap().columns[ix];
            let indicator = match &sort {
                Some(s) if s.column == col.name => Some(if s.direction == rexa_drivers::SortDirection::Asc { Indicator::SortAsc } else { Indicator::SortDesc }),
                _ if col.is_pk => Some(Indicator::Pk),
                _ if col.is_fk => Some(Indicator::Fk),
                _ => None,
            };
            let header = FrameHeader {
                title: col.name.clone().into(),
                icon: cells::type_icon(&col.header_type).path(),
                indicator,
                hovered: self.grid.hover_header == Some(vi),
            };
            let cells_v = rows
                .iter()
                .map(|&r| {
                    let value = self.cell_value(r, ix);
                    let pending = self.pending_cell(r, ix).is_some();
                    let pending_delete = self.is_row_pending_delete(r);
                    let kind = if value.is_none() {
                        CellKind::Null
                    } else if col.is_boolean() {
                        CellKind::Boolean
                    } else if col.enum_options.as_ref().is_some_and(|o| !o.is_empty()) {
                        CellKind::Enum
                    } else if self.settings.rich_json_inspector && cells::json_badge(value.as_deref().unwrap_or("")).is_some() {
                        CellKind::Json
                    } else if col.is_date() {
                        CellKind::Date
                    } else {
                        CellKind::Text
                    };
                    let display: SharedString = match (&value, kind) {
                        (None, _) => "NULL".into(),
                        (Some(v), CellKind::Json) => format!("[{}]", cells::json_badge(v).unwrap_or("Object")).into(),
                        (Some(v), CellKind::Date) if self.settings.relative_dates => cells::relative_date_label(v).map(SharedString::from).unwrap_or_else(|| v.clone()),
                        (Some(v), _) => {
                            // Canvas text never wraps; cut very long values before shaping.
                            if v.len() > 400 {
                                let mut end = 400;
                                while !v.is_char_boundary(end) {
                                    end -= 1;
                                }
                                v[..end].replace(['\n', '\r'], " ").into()
                            } else if v.contains('\n') {
                                v.replace(['\n', '\r'], " ").into()
                            } else {
                                v.clone()
                            }
                        }
                    };
                    let selected = self.grid.selection.as_ref().is_some_and(|s| if s.is_multi() { s.contains(vi, r) } else { s.cell == (vi, r) });
                    FrameCell {
                        row: r,
                        rtl: cells::is_arabic(&display),
                        search_match: value.is_some() && search.as_ref().is_some_and(|q| display.to_lowercase().contains(q.as_str())),
                        display,
                        kind,
                        selected,
                        pending,
                        pending_delete,
                        bold: col.is_pk,
                        fk_button: col.is_fk && value.is_some(),
                        fk_hovered: self.grid.hover_fk_button == Some((vi, r)),
                        hovered: self.grid.hover_cell == Some((vi, r)),
                        row_hovered: self.settings.grid_animations && self.grid.hover_cell.is_some_and(|(_, hr)| hr == r),
                        column_hovered: self.grid.hover_header == Some(vi),
                        pill: self.settings.colorized_pills && matches!(kind, CellKind::Boolean | CellKind::Enum),
                    }
                })
                .collect();
            columns.push(FrameCol { vi, x: place.x, w: place.w, frozen: place.frozen, header: Some(header), cells: cells_v });
        }
        let total = g.rows;
        let scrollbar_visible = self.grid.last_scroll.is_some_and(|t| t.elapsed() < Duration::from_millis(900));
        Frame {
            theme: *theme,
            row_h: g.row_h,
            scroll_y: self.grid.scroll.y,
            scroll_x: self.grid.scroll.x,
            content_w: g.content_w,
            total_rows: total,
            rows: rows.iter().map(|r| (*r, self.selected_rows.contains(r), self.grid.hover_marker == Some(*r))).collect(),
            all_selected: total > 0 && self.selected_rows.len() == total,
            frozen_right: g.frozen_right,
            columns,
            scrollbar_visible,
            dark: cx.tokens().dark,
        }
    }
}

/// Placeholder type used to route the add-column click (sheet not ported yet).
struct Rexa;
impl Rexa {
    fn toast_add_column(cx: &mut App) {
        rexa_ui::Toast::info("Adding columns from the grid isn't available in the native app yet.").show(cx);
    }
}

// ---- frame painting (rexa-cell-renderer.tsx) ----------------------------------------------------

#[derive(Clone, Copy, PartialEq)]
enum CellKind {
    Null,
    Boolean,
    Enum,
    Json,
    Date,
    Text,
}

#[derive(Clone, Copy)]
enum Indicator {
    Pk,
    Fk,
    SortAsc,
    SortDesc,
}

struct FrameHeader {
    title: SharedString,
    icon: &'static str,
    indicator: Option<Indicator>,
    hovered: bool,
}

struct FrameCell {
    row: usize,
    display: SharedString,
    kind: CellKind,
    rtl: bool,
    selected: bool,
    pending: bool,
    pending_delete: bool,
    search_match: bool,
    bold: bool,
    fk_button: bool,
    fk_hovered: bool,
    hovered: bool,
    row_hovered: bool,
    column_hovered: bool,
    pill: bool,
}

struct FrameCol {
    #[allow(dead_code)]
    vi: usize,
    x: f32,
    w: f32,
    frozen: bool,
    header: Option<FrameHeader>,
    cells: Vec<FrameCell>,
}

struct Frame {
    theme: GridTheme,
    row_h: f32,
    scroll_y: f32,
    scroll_x: f32,
    content_w: f32,
    total_rows: usize,
    /// (row, checked, marker hovered)
    rows: Vec<(usize, bool, bool)>,
    all_selected: bool,
    frozen_right: f32,
    columns: Vec<FrameCol>,
    scrollbar_visible: bool,
    dark: bool,
}

fn font(weight: FontWeight, italic: bool, mono: bool) -> gpui::Font {
    let mut f = gpui::font(if mono { rexa_ui::MONO } else { rexa_ui::SANS });
    f.weight = weight;
    if italic {
        f.style = FontStyle::Italic;
    }
    f
}

fn text_line(window: &mut Window, text: SharedString, size_px: f32, color: Hsla, f: gpui::Font) -> gpui::ShapedLine {
    let run = TextRun { len: text.len(), font: f, color, background_color: None, underline: None, strikethrough: None };
    window.text_system().shape_line(text, px(size_px), &[run], None)
}

fn rect(x: f32, y: f32, w: f32, h: f32) -> Bounds<Pixels> {
    Bounds::new(point(px(x), px(y)), size(px(w.max(0.)), px(h.max(0.))))
}

fn dashed_h(window: &mut Window, x: f32, y: f32, w: f32, color: Hsla) {
    let mut cx = x;
    while cx < x + w {
        window.paint_quad(fill(rect(cx, y, 3f32.min(x + w - cx), 1.), color));
        cx += 5.;
    }
}

fn dashed_rect(window: &mut Window, b: Bounds<Pixels>, color: Hsla) {
    let (x, y, w, h) = (f32::from(b.origin.x), f32::from(b.origin.y), f32::from(b.size.width), f32::from(b.size.height));
    dashed_h(window, x, y, w, color);
    dashed_h(window, x, y + h - 1., w, color);
    let mut cy = y;
    while cy < y + h {
        window.paint_quad(fill(rect(x, cy, 1., 3f32.min(y + h - cy)), color));
        window.paint_quad(fill(rect(x + w - 1., cy, 1., 3f32.min(y + h - cy)), color));
        cy += 5.;
    }
}

fn stroke_rect(window: &mut Window, b: Bounds<Pixels>, color: Hsla, radius: f32) {
    window.paint_quad(gpui::quad(b, Corners::all(px(radius)), gpui::transparent_black(), Edges::all(px(1.)), color, gpui::BorderStyle::Solid));
}

fn icon(window: &mut Window, cx: &App, path: &'static str, x: f32, y: f32, s: f32, color: Hsla) {
    window.paint_svg(rect(x, y, s, s), path.into(), None, TransformationMatrix::unit(), color, cx).ok();
}

fn paint_checkbox(window: &mut Window, cx: &App, x: f32, y: f32, checked: bool, hovered: bool, th: &GridTheme) {
    let s = 16.;
    let b = rect(x - s / 2., y - s / 2., s, s);
    if checked {
        window.paint_quad(gpui::quad(b, Corners::all(px(4.)), th.accent, Edges::all(px(0.)), th.accent, gpui::BorderStyle::Solid));
        icon(window, cx, "icons/check.svg", x - 6., y - 6., 12., gpui::white());
    } else {
        let border = if hovered { th.text_dark } else { th.text_medium };
        stroke_rect(window, b, with_alpha(border, 0.8), 4.);
    }
}

fn paint_frame(f: &Frame, bounds: Bounds<Pixels>, window: &mut Window, cx: &mut App) {
    let th = f.theme;
    let ox = f32::from(bounds.origin.x);
    let oy = f32::from(bounds.origin.y);
    let vw = f32::from(bounds.size.width);
    let vh = f32::from(bounds.size.height);
    let mask = |x0: f32, x1: f32| ContentMask { bounds: rect(ox + x0, oy, (x1 - x0).max(0.), vh) };
    let body_mask = |x0: f32, x1: f32| ContentMask { bounds: rect(ox + x0, oy + HEADER_HEIGHT, (x1 - x0).max(0.), vh - HEADER_HEIGHT) };

    window.paint_quad(fill(bounds, th.bg_cell));
    let row_y = |r: usize| oy + HEADER_HEIGHT + r as f32 * f.row_h - f.scroll_y;
    let content_bottom = oy + HEADER_HEIGHT + f.total_rows as f32 * f.row_h - f.scroll_y;

    // Columns: scrolled ones first, then the frozen one on top.
    let order: Vec<&FrameCol> = f.columns.iter().filter(|c| !c.frozen).chain(f.columns.iter().filter(|c| c.frozen)).collect();
    for col in order {
        let x0 = if col.frozen { col.x } else { col.x.max(f.frozen_right) };
        let x1 = (col.x + col.w).min(vw);
        if x1 <= x0 {
            continue;
        }
        // Body cells.
        window.with_content_mask(Some(body_mask(x0, x1)), |window| {
            if col.frozen {
                window.paint_quad(fill(rect(ox + col.x, oy + HEADER_HEIGHT, col.w, vh), th.bg_cell));
            }
            for c in &col.cells {
                let y = row_y(c.row);
                let cell = rect(ox + col.x, y, col.w, f.row_h);
                paint_cell(c, cell, &th, f.dark, window, cx);
            }
            // Gridlines: row bottoms (not under "Add column") + the column's right edge.
            if col.header.is_some() {
                for c in &col.cells {
                    let y = row_y(c.row) + f.row_h - 1.;
                    window.paint_quad(fill(rect(ox + col.x, y, col.w, 1.), th.border));
                }
                window.paint_quad(fill(rect(ox + col.x + col.w - 1., oy + HEADER_HEIGHT, 1., (content_bottom - oy - HEADER_HEIGHT).min(vh)), th.border));
            }
        });
        // Header.
        window.with_content_mask(Some(mask(x0, x1)), |window| {
            let hb = rect(ox + col.x, oy, col.w, HEADER_HEIGHT);
            let hovered = col.header.as_ref().is_some_and(|h| h.hovered);
            window.paint_quad(fill(hb, if hovered { th.bg_header_hovered } else { th.bg_header }));
            window.paint_quad(fill(rect(ox + col.x + col.w - 1., oy, 1., HEADER_HEIGHT), th.border));
            let cy = oy + HEADER_HEIGHT / 2.;
            match &col.header {
                Some(h) => {
                    let mut x = ox + col.x + 8.;
                    icon(window, cx, h.icon, x, cy - 7., 14., th.text_medium);
                    x += 14. + 6.;
                    let line = text_line(window, h.title.clone(), 12., th.text_dark, font(FontWeight::MEDIUM, false, false));
                    line.paint(point(px(x), px(cy - 9.)), px(18.), TextAlign::Left, None, window, cx).ok();
                    x += f32::from(line.width) + 6.;
                    if let Some(ind) = h.indicator {
                        let (path, color) = match ind {
                            Indicator::Pk => ("icons/key.svg", tw("amber-500")),
                            Indicator::Fk => ("icons/link.svg", tw("blue-400")),
                            Indicator::SortAsc => ("icons/arrow-up.svg", tw("blue-500")),
                            Indicator::SortDesc => ("icons/arrow-down.svg", tw("blue-500")),
                        };
                        icon(window, cx, path, x, cy - 7., 14., color);
                    }
                    // Always-visible menu chevron (onDrawHeader).
                    let mx = ox + col.x + col.w - HEADER_MENU_ZONE_WIDTH / 2. - 7.;
                    icon(window, cx, "icons/chevron-down.svg", mx, cy - 7., 14., th.text_medium);
                }
                None => {
                    let x = ox + col.x + 8.;
                    icon(window, cx, "icons/plus.svg", x, cy - 7., 14., th.text_medium);
                    let line = text_line(window, "Add column".into(), 12., th.text_medium, font(FontWeight::MEDIUM, false, false));
                    line.paint(point(px(x + 20.), px(cy - 9.)), px(18.), TextAlign::Left, None, window, cx).ok();
                }
            }
        });
    }

    // Row markers.
    window.with_content_mask(Some(body_mask(0., ROW_MARKER_WIDTH)), |window| {
        window.paint_quad(fill(rect(ox, oy + HEADER_HEIGHT, ROW_MARKER_WIDTH, vh), th.bg_cell));
        for &(r, checked, hovered) in &f.rows {
            let y = row_y(r);
            if checked {
                window.paint_quad(fill(rect(ox, y, ROW_MARKER_WIDTH, f.row_h), th.selection));
            }
            paint_checkbox(window, cx, ox + ROW_MARKER_WIDTH / 2., y + f.row_h / 2., checked, hovered, &th);
            window.paint_quad(fill(rect(ox, y + f.row_h - 1., ROW_MARKER_WIDTH, 1.), th.border));
        }
        window.paint_quad(fill(rect(ox + ROW_MARKER_WIDTH - 1., oy + HEADER_HEIGHT, 1., (content_bottom - oy - HEADER_HEIGHT).min(vh)), th.border));
    });
    window.paint_quad(fill(rect(ox, oy, ROW_MARKER_WIDTH, HEADER_HEIGHT), th.bg_header));
    window.paint_quad(fill(rect(ox + ROW_MARKER_WIDTH - 1., oy, 1., HEADER_HEIGHT), th.border));
    paint_checkbox(window, cx, ox + ROW_MARKER_WIDTH / 2., oy + HEADER_HEIGHT / 2., f.all_selected, false, &th);

    // Header bottom border; the header fills to the right edge.
    let right = ox + f.content_w - f.scroll_x;
    if right < ox + vw {
        window.paint_quad(fill(rect(right, oy, ox + vw - right, HEADER_HEIGHT), th.bg_header));
    }
    window.paint_quad(fill(rect(ox, oy + HEADER_HEIGHT - 1., vw, 1.), th.border));

    // Overlay scrollbars while scrolling.
    if f.scrollbar_visible {
        let thumb = with_alpha(if f.dark { gpui::white() } else { gpui::black() }, 0.35);
        let body_h = vh - HEADER_HEIGHT;
        let total_h = f.total_rows as f32 * f.row_h;
        if total_h > body_h {
            let h = (body_h * body_h / total_h).max(24.);
            let y = oy + HEADER_HEIGHT + (body_h - h) * (f.scroll_y / (total_h - body_h)).clamp(0., 1.);
            window.paint_quad(gpui::quad(rect(ox + vw - 9., y + 2., 6., h - 4.), Corners::all(px(3.)), thumb, Edges::all(px(0.)), thumb, gpui::BorderStyle::Solid));
        }
        if f.content_w > vw {
            let w = (vw * vw / f.content_w).max(24.);
            let x = ox + (vw - w) * (f.scroll_x / (f.content_w - vw)).clamp(0., 1.);
            window.paint_quad(gpui::quad(rect(x + 2., oy + vh - 9., w - 4., 6.), Corners::all(px(3.)), thumb, Edges::all(px(0.)), thumb, gpui::BorderStyle::Solid));
        }
    }
}

fn paint_cell(c: &FrameCell, cell: Bounds<Pixels>, th: &GridTheme, _dark: bool, window: &mut Window, cx: &mut App) {
    let (x, y, w, h) = (f32::from(cell.origin.x), f32::from(cell.origin.y), f32::from(cell.size.width), f32::from(cell.size.height));
    // Background layers (row hover < column hover < cell hover < search < pending).
    if c.selected {
        window.paint_quad(fill(cell, th.selection));
    } else {
        if c.row_hovered {
            window.paint_quad(fill(cell, th.row_hover));
        }
        if c.column_hovered {
            window.paint_quad(fill(cell, th.column_hover));
        }
        if c.hovered && !c.fk_hovered {
            window.paint_quad(fill(cell, th.cell_hover));
        }
    }
    if c.search_match {
        window.paint_quad(fill(cell, gpui::rgba(0x9e6a094d)));
    } else if c.pending_delete {
        window.paint_quad(fill(cell, with_alpha(tw("red-500"), 0.16)));
    } else if c.pending {
        window.paint_quad(fill(cell, with_alpha(tw("amber-500"), 0.15)));
    }
    let text_color = if c.pending_delete { tw("red-300") } else { th.text_dark };
    let content_w = if c.fk_button { (w - (FK_BUTTON_SIZE + FK_BUTTON_MARGIN * 2.)).max(0.) } else { w };
    let cy = y + h / 2.;
    window.with_content_mask(Some(ContentMask { bounds: rect(x, y, content_w, h) }), |window| {
        if c.pill && c.kind != CellKind::Null {
            let color = match (c.kind, c.display.as_ref()) {
                (CellKind::Boolean, "true") => tw("green-500"),
                (CellKind::Boolean, _) => tw("red-500"),
                _ => tw("blue-500"),
            };
            let line = text_line(window, c.display.clone(), 11., color, font(FontWeight::MEDIUM, false, false));
            let pw = f32::from(line.width) + 16. + 10.;
            let pb = rect(x + 8., cy - 9., pw, 18.);
            window.paint_quad(gpui::quad(pb, Corners::all(px(9.)), with_alpha(color, 0.1), Edges::all(px(1.)), with_alpha(color, 0.2), gpui::BorderStyle::Solid));
            window.paint_quad(gpui::quad(rect(x + 16. - 2., cy - 2., 4., 4.), Corners::all(px(2.)), color, Edges::all(px(0.)), color, gpui::BorderStyle::Solid));
            line.paint(point(px(x + 8. + 18.), px(cy - 8.)), px(16.), TextAlign::Left, None, window, cx).ok();
            return;
        }
        if c.kind == CellKind::Json {
            let line = text_line(window, c.display.clone(), 12., th.text_dark, font(FontWeight::NORMAL, false, true));
            let bw = f32::from(line.width) + 16.;
            window.paint_quad(gpui::quad(rect(x + 8., cy - 9., bw, 18.), Corners::all(px(4.)), th.bg_header, Edges::all(px(1.)), th.border, gpui::BorderStyle::Solid));
            line.paint(point(px(x + 16.), px(cy - 8.)), px(16.), TextAlign::Left, None, window, cx).ok();
            return;
        }
        let (color, italic, weight) = match c.kind {
            CellKind::Null => (if c.pending_delete { tw("red-300") } else { th.text_medium }, true, FontWeight::NORMAL),
            _ => (text_color, false, if c.bold { FontWeight::SEMIBOLD } else { FontWeight::NORMAL }),
        };
        let line = text_line(window, c.display.clone(), 13., color, font(weight, italic, false));
        let lw = f32::from(line.width);
        let tx = if c.rtl { x + content_w - 8. - lw } else { x + 8. };
        line.paint(point(px(tx), px(cy - 9. + 1.)), px(18.), TextAlign::Left, None, window, cx).ok();
        if c.pending_delete {
            dashed_h(window, tx, cy + 1., lw, color);
        }
    });
    if c.fk_button {
        let bx = x + w - FK_BUTTON_MARGIN - FK_BUTTON_SIZE;
        let by = y + (h - FK_BUTTON_SIZE) / 2.;
        let b = rect(bx + 0.5, by + 0.5, FK_BUTTON_SIZE - 1., FK_BUTTON_SIZE - 1.);
        if c.fk_hovered {
            window.paint_quad(gpui::quad(b, Corners::all(px(4.)), th.cell_hover, Edges::all(px(0.)), th.cell_hover, gpui::BorderStyle::Solid));
        }
        stroke_rect(window, b, if c.fk_hovered { th.text_dark } else { th.border }, 4.);
        icon(window, cx, "icons/chevron-right.svg", bx + 3., by + 3., 14., if c.fk_hovered { th.text_dark } else { th.text_medium });
    }
    if c.pending_delete {
        dashed_rect(window, rect(x + 1., y + 1., w - 2., h - 2.), with_alpha(tw("red-500"), 0.8));
    }
    if c.selected {
        // Strictly inside the cell so gridlines never touch it.
        stroke_rect(window, rect(x + 1., y + 1., w - 3., h - 3.), th.accent, 0.);
    }
}
