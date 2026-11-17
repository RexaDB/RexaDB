//! Dev aid (not part of the original): `REXA_GRID_DEBUG="cmd;cmd;…"` replays UI
//! actions once the first page has loaded, so overlays can be screenshotted
//! without synthesizing pointer events. Commands: `select:c,r`, `range:c,r,c2,r2`,
//! `rows:a,b,…`, `edit`, `menu`, `header:c`, `filter`, `sort`, `review`,
//! `insert`, `fk`, `picker`, `set:value`, `search:text`, `scope:table`,
//! `scrolly:px`, `hover:c,r`, `sortby:column`, `filterq:sql`, `keys:<key>`.

use crate::grid::{Rect, Selection};
use crate::view::TableEditor;
use gpui::{point, px, Bounds, Context, Window};

impl TableEditor {
    pub(crate) fn run_debug_commands(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Ok(script) = std::env::var("REXA_GRID_DEBUG") else { return };
        let nums = |s: &str| s.split(',').filter_map(|n| n.trim().parse::<usize>().ok()).collect::<Vec<_>>();
        for cmd in script.split(';').map(str::trim).filter(|c| !c.is_empty()) {
            let (name, arg) = cmd.split_once(':').unwrap_or((cmd, ""));
            match name {
                "select" => {
                    let n = nums(arg);
                    self.grid.selection = Some(Selection { cell: (n[0], n[1]), range: Rect::cell(n[0], n[1]), stack: Vec::new() });
                }
                "range" => {
                    let n = nums(arg);
                    self.grid.selection = Some(Selection {
                        cell: (n[0], n[1]),
                        range: Rect { x: n[0], y: n[1], w: n[2] - n[0] + 1, h: n[3] - n[1] + 1 },
                        stack: Vec::new(),
                    });
                }
                "rows" => self.selected_rows = nums(arg).into_iter().collect(),
                "hover" => {
                    let n = nums(arg);
                    self.grid.hover_cell = Some((n[0], n[1]));
                }
                "edit" => {
                    if let Some((c, r)) = self.grid.selection.as_ref().map(|s| s.cell) {
                        let ix = self.visible_columns()[c];
                        self.open_editor(c, r, ix, None, window, cx);
                    }
                }
                "menu" | "header" => {
                    let o = self.grid.bounds.get().origin;
                    if name == "header" {
                        let ix = self.visible_columns()[nums(arg)[0]];
                        self.open_header_menu(ix, point(o.x + px(300.), o.y + px(40.)), cx);
                    } else if let Some((c, r)) = self.grid.selection.as_ref().map(|s| s.cell) {
                        self.open_cell_menu(c, r, point(o.x + px(320.), o.y + px(120.)), cx);
                    }
                }
                "filter" => self.open_filter_panel(window, cx),
                "sort" => self.open_sort_panel(cx),
                "review" => self.sheet = Some(crate::view::SheetKind::Review),
                "insert" => self.open_insert_sheet(window, cx),
                "picker" | "fk" => {
                    if let Some((c, r)) = self.grid.selection.as_ref().map(|s| s.cell) {
                        let ix = self.visible_columns()[c];
                        if name == "picker" {
                            self.open_fk_picker(r, ix, window, cx);
                        } else {
                            let o = self.grid.bounds.get().origin;
                            let b = Bounds::new(point(o.x + px(400.), o.y + px(80.)), gpui::size(px(20.), px(20.)));
                            self.toggle_fk_preview(r, ix, b, window, cx);
                        }
                    }
                }
                "set" => {
                    if let Some((c, r)) = self.grid.selection.as_ref().map(|s| s.cell) {
                        let ix = self.visible_columns()[c];
                        let v = if arg == "NULL" { None } else { Some(arg.to_string().into()) };
                        self.update_cell(r, ix, v, cx);
                    }
                }
                "search" => {
                    let a = arg.to_string();
                    self.search_input.update(cx, |s, cx| s.set_value(a, window, cx));
                }
                "scope" => self.set_search_scope(crate::view::SearchScope::Table, cx),
                "scrolly" => self.grid.scroll.y = arg.parse().unwrap_or(0.),
                "sortby" => self.cycle_sort(arg, cx),
                "filterq" => self.apply_filter_sort(arg.to_string(), self.sort.clone(), cx),
                "review_mode" => self.settings.review_mode = true,
                _ => eprintln!("REXA_GRID_DEBUG: unknown command {cmd}"),
            }
        }
        cx.notify();
    }
}
