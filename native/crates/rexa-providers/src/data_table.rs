//! Copy of rexa-schema/src/data_table.rs (feature crates cannot depend on each other).
//! Port of `@rexadbapp/data-table`'s `DataTable` (data-table-root, -header, -body,
//! -surfaces, -pager, -pagination, use-column-sort, use-table-paging) as used by the
//! database object lists: a grey 2px-rim frame, header on the band, the rows on a
//! lifted card, sortable headers (asc → desc → off), client pagination with
//! "1-10 of 24 types" and "Page 1 of 3" + prev/next.
//!
//! Approximations: no column resizing / collapsing / virtualization (lists are
//! short and paged); `fr` widths are flex-grow shares, fixed widths are exact.

use gpui::{div, prelude::*, px, AnyElement, App, ElementId, Entity, FontWeight, SharedString, Window};
use rexa_ui::widgets::Icon;
use rexa_ui::{white, with_alpha, ActiveTokens, Button, ButtonSize, IconName, Tw};
use std::cmp::Ordering;
use std::rc::Rc;

pub const ROW_HEIGHT: f32 = 48.;

#[derive(Clone, Copy, PartialEq)]
pub enum Width {
    Fr(f32),
    Px(f32),
}

#[derive(Clone, Copy, PartialEq, Default)]
pub enum Align {
    #[default]
    Left,
    Center,
    Right,
}

#[derive(Clone)]
pub struct Column {
    pub key: &'static str,
    pub header: SharedString,
    pub width: Width,
    pub align: Align,
    pub sortable: bool,
}

impl Column {
    pub fn new(key: &'static str, header: impl Into<SharedString>) -> Self {
        Column { key, header: header.into(), width: Width::Fr(1.), align: Align::Left, sortable: false }
    }
    pub fn fr(mut self, f: f32) -> Self {
        self.width = Width::Fr(f);
        self
    }
    /// Fixed width in px (`"3rem"` → 48).
    pub fn px(mut self, w: f32) -> Self {
        self.width = Width::Px(w);
        self
    }
    pub fn right(mut self) -> Self {
        self.align = Align::Right;
        self
    }
    pub fn center(mut self) -> Self {
        self.align = Align::Center;
        self
    }
    pub fn sortable(mut self) -> Self {
        self.sortable = true;
        self
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum SortKey {
    Str(String),
    Num(f64),
}

impl SortKey {
    fn cmp(&self, other: &SortKey) -> Ordering {
        match (self, other) {
            (SortKey::Num(a), SortKey::Num(b)) => a.partial_cmp(b).unwrap_or(Ordering::Equal),
            (a, b) => a.text().to_lowercase().cmp(&b.text().to_lowercase()),
        }
    }
    fn text(&self) -> String {
        match self {
            SortKey::Str(s) => s.clone(),
            SortKey::Num(n) => n.to_string(),
        }
    }
}

impl From<&str> for SortKey {
    fn from(s: &str) -> Self {
        SortKey::Str(s.to_string())
    }
}
impl From<String> for SortKey {
    fn from(s: String) -> Self {
        SortKey::Str(s)
    }
}
impl From<f64> for SortKey {
    fn from(n: f64) -> Self {
        SortKey::Num(n)
    }
}
impl From<i64> for SortKey {
    fn from(n: i64) -> Self {
        SortKey::Num(n as f64)
    }
}

type RowClick = Rc<dyn Fn(&mut Window, &mut App)>;

/// One row: per-column sort values (by column key) and the rendered cells.
pub struct Row {
    pub id: SharedString,
    pub sort: Vec<(&'static str, SortKey)>,
    pub cells: Vec<AnyElement>,
    pub on_click: Option<RowClick>,
}

impl Row {
    pub fn new(id: impl Into<SharedString>) -> Self {
        Row { id: id.into(), sort: Vec::new(), cells: Vec::new(), on_click: None }
    }
    pub fn sort(mut self, key: &'static str, v: impl Into<SortKey>) -> Self {
        self.sort.push((key, v.into()));
        self
    }
    pub fn cell(mut self, el: impl IntoElement) -> Self {
        self.cells.push(el.into_any_element());
        self
    }
    pub fn on_click(mut self, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(f));
        self
    }
}

/// Sort + page state, owned by the list view (observe it to re-render).
#[derive(Clone, Default)]
pub struct TableState {
    pub sort: Option<(&'static str, bool)>,
    pub page: usize,
}

impl TableState {
    pub fn toggle_sort(&mut self, key: &'static str) {
        self.sort = match self.sort {
            Some((k, true)) if k == key => Some((key, false)),
            Some((k, false)) if k == key => None,
            _ => Some((key, true)),
        };
    }
    pub fn reset_page(&mut self) {
        self.page = 1;
    }
}

#[derive(IntoElement)]
pub struct DataTable {
    id: ElementId,
    state: Entity<TableState>,
    columns: Vec<Column>,
    rows: Vec<Row>,
    page_size: Option<usize>,
    item_label: Option<SharedString>,
    empty: Option<AnyElement>,
    row_height: f32,
}

impl DataTable {
    pub fn new(id: impl Into<ElementId>, state: &Entity<TableState>) -> Self {
        DataTable {
            id: id.into(),
            state: state.clone(),
            columns: Vec::new(),
            rows: Vec::new(),
            page_size: None,
            item_label: None,
            empty: None,
            row_height: ROW_HEIGHT,
        }
    }
    pub fn columns(mut self, c: impl IntoIterator<Item = Column>) -> Self {
        self.columns.extend(c);
        self
    }
    pub fn rows(mut self, r: impl IntoIterator<Item = Row>) -> Self {
        self.rows.extend(r);
        self
    }
    /// `pagination={{ pageSize, itemLabel }}`.
    pub fn paginate(mut self, page_size: usize, item_label: impl Into<SharedString>) -> Self {
        self.page_size = Some(page_size);
        self.item_label = Some(item_label.into());
        self
    }
    pub fn empty(mut self, el: impl IntoElement) -> Self {
        self.empty = Some(el.into_any_element());
        self
    }
    pub fn row_height(mut self, h: f32) -> Self {
        self.row_height = h;
        self
    }
}

fn sized(d: gpui::Div, w: Width) -> gpui::Div {
    match w {
        Width::Px(p) => d.flex_shrink_0().w(px(p)),
        Width::Fr(f) => {
            let mut d = d.flex_basis(px(0.)).min_w(px(64.));
            d.style().flex_grow = Some(f);
            d.style().flex_shrink = Some(1.);
            d
        }
    }
}

fn justify<E: Styled>(d: E, a: Align) -> E {
    match a {
        Align::Left => d.justify_start(),
        Align::Center => d.justify_center(),
        Align::Right => d.justify_end(),
    }
}

impl RenderOnce for DataTable {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let state = self.state.read(cx).clone();
        let mut rows = self.rows;
        if let Some((key, asc)) = state.sort {
            rows.sort_by(|a, b| {
                let av = a.sort.iter().find(|(k, _)| *k == key).map(|(_, v)| v);
                let bv = b.sort.iter().find(|(k, _)| *k == key).map(|(_, v)| v);
                let o = match (av, bv) {
                    (Some(a), Some(b)) => a.cmp(b),
                    _ => Ordering::Equal,
                };
                if asc {
                    o
                } else {
                    o.reverse()
                }
            });
        }
        let total = rows.len();
        let (page, page_count) = match self.page_size {
            Some(ps) => {
                let count = total.div_ceil(ps).max(1);
                (state.page.clamp(1, count), count)
            }
            None => (1, 1),
        };
        let paged: Vec<Row> = match self.page_size {
            Some(ps) => rows.into_iter().skip((page - 1) * ps).take(ps).collect(),
            None => rows,
        };

        let band = t.var_or("--table-band", t.muted);
        let card = t.var_or("--table-row", t.background);
        let hover = t.var_or("--table-row-hover", t.muted);
        let rim = if t.dark { white(0.1) } else { gpui::hsla(0., 0., 0., 0.1) };
        let card_border = if t.dark { white(0.07) } else { gpui::hsla(0., 0., 0., 0.1) };
        let row_border = with_alpha(t.border, 0.6);
        let rh = self.row_height;

        // Header row (on the band).
        let mut header = div().flex().items_center().h(px(rh)).px(px(1.));
        for col in &self.columns {
            let active = state.sort.is_some_and(|(k, _)| k == col.key);
            let desc = state.sort.is_some_and(|(k, a)| k == col.key && !a);
            let header_text = col.header.clone();
            let label = move || div().whitespace_nowrap().font_weight(FontWeight::MEDIUM).child(header_text.clone());
            let cell = if col.sortable {
                let key = col.key;
                let st = self.state.clone();
                let arrow = div()
                    .flex_shrink_0()
                    .opacity(if active { 1. } else { 0.35 })
                    .child(Icon::new(IconName::ArrowUp).size(px(14.)).when(desc, |i| i.rotate(gpui::radians(std::f32::consts::PI))));
                let right = col.align == Align::Right;
                justify(
                    div()
                        .id(SharedString::from(format!("sort-{key}")))
                        .flex()
                        .flex_1()
                        .h_full()
                        .items_center()
                        .gap_1()
                        .px_4()
                        .tw_rounded_md()
                        .cursor_pointer()
                        .text_color(if active { t.foreground } else { t.muted_foreground })
                        .hover(|s| s.text_color(t.foreground))
                        .on_click(move |_, _, cx| {
                            st.update(cx, |s, cx| {
                                s.toggle_sort(key);
                                cx.notify();
                            })
                        })
                        .when(!right, |d| d.child(label()))
                        .child(arrow)
                        .when(right, |d| d.child(label())),
                    col.align,
                )
                .into_any_element()
            } else {
                justify(div().flex().flex_1().px_4().whitespace_nowrap().text_color(t.muted_foreground), col.align).child(label()).into_any_element()
            };
            header = header.child(sized(div().flex().h_full().items_center(), col.width).child(cell));
        }

        // Body (the lifted card).
        let row_count = paged.len();
        let mut body = div()
            .relative()
            .mt(px(-20.))
            .tw_rounded_xl()
            .border_1()
            .border_color(card_border)
            .bg(card)
            .shadow(lift(t.dark))
            .overflow_hidden()
            .flex()
            .flex_col();
        if row_count == 0 {
            let empty = self.empty.unwrap_or_else(|| div().text_color(t.muted_foreground).child("No data").into_any_element());
            body = body.child(div().flex().items_center().justify_center().px_6().text_center().h(px(rh)).child(empty));
        }
        for (i, row) in paged.into_iter().enumerate() {
            let last = i + 1 == row_count;
            let mut r = div()
                .id(ElementId::Name(format!("{}-row-{}", self.id, row.id).into()))
                .flex()
                .items_center()
                .h(px(rh))
                .px(px(0.))
                .hover(move |s| s.bg(hover))
                .when(!last, |d| d.border_b_1().border_color(row_border));
            if let Some(f) = row.on_click.clone() {
                r = r.cursor_pointer().on_click(move |_, w, cx| f(w, cx));
            }
            for (ci, cell) in row.cells.into_iter().enumerate() {
                let Some(col) = self.columns.get(ci) else { break };
                r = r.child(
                    justify(sized(div().flex().items_center().h_full().p_2().overflow_hidden(), col.width), col.align)
                        .child(div().w_full().min_w_0().overflow_hidden().flex().child(justify(div().flex().w_full().min_w_0(), col.align).child(cell))),
                );
            }
            body = body.child(r);
        }

        // Footer pager.
        let footer = self.page_size.filter(|_| total > 0).map(|ps| {
            let start = (page - 1) * ps + 1;
            let end = (page * ps).min(total);
            let base = format!("{}-{} of {}", fmt_num(start), fmt_num(end), fmt_num(total));
            let text = match &self.item_label {
                Some(l) => format!("{base} {l}"),
                None => base,
            };
            let has_pages = page_count > 1;
            let st_prev = self.state.clone();
            let st_next = self.state.clone();
            div()
                .mt(px(-20.))
                .pt(px(20.))
                .child(
                    div()
                        .flex()
                        .min_h(px(44.))
                        .flex_wrap()
                        .items_center()
                        .justify_between()
                        .gap_x_3()
                        .px_4()
                        .py(px(6.))
                        .tw_text_xs()
                        .text_color(t.muted_foreground)
                        .child(div().min_w_0().truncate().child(text))
                        .when(has_pages, |d| {
                            d.child(
                                div()
                                    .ml_auto()
                                    .flex()
                                    .items_center()
                                    .gap_3()
                                    .child(format!("Page {} of {}", fmt_num(page), fmt_num(page_count)))
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .gap_1()
                                            .child(
                                                Button::new(ElementId::Name(format!("{}-prev", self.id).into()))
                                                    .outline()
                                                    .size(ButtonSize::IconSm)
                                                    .icon(IconName::ChevronLeft)
                                                    .disabled(page <= 1)
                                                    .on_click(move |_, _, cx| {
                                                        st_prev.update(cx, |s, cx| {
                                                            s.page = page.saturating_sub(1).max(1);
                                                            cx.notify();
                                                        })
                                                    }),
                                            )
                                            .child(
                                                Button::new(ElementId::Name(format!("{}-next", self.id).into()))
                                                    .outline()
                                                    .size(ButtonSize::IconSm)
                                                    .icon(IconName::ChevronRight)
                                                    .disabled(page >= page_count)
                                                    .on_click(move |_, _, cx| {
                                                        st_next.update(cx, |s, cx| {
                                                            s.page = (page + 1).min(page_count);
                                                            cx.notify();
                                                        })
                                                    }),
                                            ),
                                    ),
                            )
                        }),
                )
        });

        div().w_full().min_w_0().tw_text_sm().child(
            div()
                .rounded(px(16.))
                .border_1()
                .border_color(rim)
                .bg(band)
                .p(px(2.))
                .child(div().rounded_t(px(14.)).pb(px(20.)).overflow_hidden().child(header))
                .child(body)
                .children(footer),
        )
    }
}

/// `--surface-lift`.
pub fn lift(dark: bool) -> Vec<gpui::BoxShadow> {
    use gpui::{point, BoxShadow};
    if dark {
        vec![
            BoxShadow { color: white(0.04), offset: point(px(0.), px(1.)), blur_radius: px(0.), spread_radius: px(0.), inset: true },
            BoxShadow { color: gpui::hsla(0., 0., 0., 0.4), offset: point(px(0.), px(1.)), blur_radius: px(2.), spread_radius: px(0.), inset: false },
        ]
    } else {
        let c = gpui::hsla(240. / 360., 0.1, 0.1, 0.06);
        vec![
            BoxShadow { color: c, offset: point(px(0.), px(1.)), blur_radius: px(2.), spread_radius: px(0.), inset: false },
            BoxShadow { color: c, offset: point(px(0.), px(2.)), blur_radius: px(8.), spread_radius: px(-2.), inset: false },
        ]
    }
}

/// `toLocaleString("en-US")` for counts.
pub fn fmt_num(n: usize) -> String {
    let s = n.to_string();
    let mut out = String::new();
    for (i, c) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sort_cycle_and_numbers() {
        let mut s = TableState::default();
        s.toggle_sort("a");
        assert_eq!(s.sort, Some(("a", true)));
        s.toggle_sort("a");
        assert_eq!(s.sort, Some(("a", false)));
        s.toggle_sort("a");
        assert_eq!(s.sort, None);
        assert_eq!(fmt_num(1234567), "1,234,567");
        assert_eq!(fmt_num(12), "12");
    }
}
