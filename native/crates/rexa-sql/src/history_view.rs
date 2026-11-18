//! Port of components/studio/query-history-view.tsx: the Logs (grid) and
//! Cards views of `query_history`, caller filter, search, count badge and
//! Clear; cards copy / re-run a query (re-run opens it in a new SQL tab, the
//! studio's `onRunQuery`).
//!
//! Approximation: the logs grid sorts are not offered (the grid has no header
//! menu); paging uses the grid footer's page size of 50.

use crate::results_grid::{CellRenderer, ResultsGrid};
use crate::store::{now_millis, HistoryEntry, SqlStore};
use gpui::{div, prelude::*, px, AnyElement, ClipboardItem, Context, Entity, FontWeight, SharedString, Subscription, Window};
use gpui_component::Icon;
use rexa_core::{Session, TabSpec};
use rexa_drivers::{Cell, ColumnMeta, QueryResult};
use rexa_ui::widgets::InputState;
use rexa_ui::{tw, with_alpha, ActiveTokens, Badge, BadgeVariant, Button, ButtonSize, IconName, TextInput, Tokens, Tw, MONO};
use regex::Regex;
use std::rc::Rc;
use std::sync::{Arc, OnceLock};

#[derive(Clone, Copy, PartialEq)]
enum CallerFilter {
    All,
    System,
    User,
}

#[derive(Clone, Copy, PartialEq)]
enum DisplayMode {
    Logs,
    Cards,
}

const PAGE_SIZE: usize = 50;

/// `extractTableName`
pub fn extract_table_name(query: &str) -> String {
    static R: OnceLock<Vec<Regex>> = OnceLock::new();
    let rs = R.get_or_init(|| {
        ["from", "join", "into", "update", "table"]
            .iter()
            .map(|k| Regex::new(&format!(r#"(?i)\b{k}\s+(["`\[]?[\w.\-]+["`\]]?)"#)).unwrap())
            .collect()
    });
    let compact = query.split_whitespace().collect::<Vec<_>>().join(" ");
    for r in rs {
        if let Some(c) = r.captures(&compact) {
            return c[1].replace(['"', '`', '[', ']'], "");
        }
    }
    "-".into()
}

/// `new Date(ts).toLocaleString()` (en-US).
pub fn format_absolute_time(ms: i64) -> String {
    use chrono::TimeZone;
    chrono::Local.timestamp_millis_opt(ms).single().map(|d| d.format("%-m/%-d/%Y, %-I:%M:%S %p").to_string()).unwrap_or_default()
}

/// `formatDistanceToNow(ts, { addSuffix: true })` (date-fns wording).
pub fn format_distance_to_now(ms: i64) -> String {
    let secs = ((now_millis() - ms) as f64 / 1000.).max(0.);
    let mins = (secs / 60.).round();
    let s = if secs < 30. {
        "less than a minute".to_string()
    } else if mins < 2. {
        "1 minute".into()
    } else if mins < 45. {
        format!("{mins} minutes")
    } else if mins < 90. {
        "about 1 hour".into()
    } else if mins < 1440. {
        format!("about {} hours", (mins / 60.).round())
    } else if mins < 2520. {
        "1 day".into()
    } else if mins < 43200. {
        format!("{} days", (mins / 1440.).round())
    } else if mins < 86400. {
        format!("about {} months", (mins / 43200.).round().max(1.))
    } else if mins < 525600. {
        format!("{} months", (mins / 43200.).round())
    } else {
        let years = (mins / 525600.).floor();
        if years <= 1. { "about 1 year".into() } else { format!("about {years} years") }
    };
    format!("{s} ago")
}

pub struct QueryHistoryView {
    connection_id: i64,
    connection_name: String,
    history: Vec<HistoryEntry>,
    search: Entity<InputState>,
    caller: CallerFilter,
    mode: DisplayMode,
    page: usize,
    grid: Entity<ResultsGrid>,
    _subs: Vec<Subscription>,
}

impl QueryHistoryView {
    pub fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search logs..."));
        let grid = cx.new(|cx| {
            let mut g = ResultsGrid::new(Arc::new(QueryResult::default()), cx);
            g.cell_renderer = Some(log_cell_renderer());
            g
        });
        let subs = vec![cx.observe(&search, |this, _, cx| {
            this.page = 0;
            this.refresh_grid(cx);
        })];
        let mut this = QueryHistoryView {
            connection_id: session.connection.id,
            connection_name: session.connection.name.clone(),
            history: Vec::new(),
            search,
            caller: CallerFilter::All,
            mode: DisplayMode::Logs,
            page: 0,
            grid,
            _subs: subs,
        };
        this.load(cx);
        this
    }

    /// `loadHistory`: newest first.
    fn load(&mut self, cx: &mut Context<Self>) {
        let mut h = SqlStore::open().and_then(|s| s.history(self.connection_id)).unwrap_or_default();
        h.reverse();
        self.history = h;
        self.refresh_grid(cx);
    }

    fn filtered(&self, cx: &Context<Self>) -> Vec<HistoryEntry> {
        let lower = self.search.read(cx).value().to_lowercase();
        self.history
            .iter()
            .filter(|e| match self.caller {
                CallerFilter::All => true,
                CallerFilter::System => e.caller == "system",
                CallerFilter::User => e.caller == "user",
            })
            .filter(|e| e.query.to_lowercase().contains(&lower) || e.error.as_deref().is_some_and(|x| x.to_lowercase().contains(&lower)))
            .cloned()
            .collect()
    }

    fn refresh_grid(&mut self, cx: &mut Context<Self>) {
        let rows = self.filtered(cx);
        let start = self.page * PAGE_SIZE;
        let page: Vec<&HistoryEntry> = rows.iter().skip(start).take(PAGE_SIZE).collect();
        let columns: Vec<String> =
            ["time", "status", "caller", "connection", "actor", "table", "query", "error", "duration_ms"].iter().map(|s| s.to_string()).collect();
        let text = |s: String| Cell::Text(s);
        let result = QueryResult {
            column_types: columns.iter().map(|c| ColumnMeta::new(c.clone(), if c == "duration_ms" { "int4" } else { "text" })).collect(),
            rows: page
                .iter()
                .map(|e| {
                    vec![
                        text(format_absolute_time(e.executed_at)),
                        text(if e.status == "success" { "Success".into() } else { "Error".into() }),
                        text(if e.caller == "user" { "User".into() } else { "System".into() }),
                        text(e.connection_name.clone().unwrap_or_else(|| self.connection_name.clone())),
                        text(e.executed_by_name.clone().or_else(|| e.executed_by.clone()).unwrap_or_else(|| "-".into())),
                        text(extract_table_name(&e.query)),
                        text(e.query.clone()),
                        text(e.error.clone().unwrap_or_default()),
                        text(e.duration.to_string()),
                    ]
                })
                .collect(),
            columns,
            ..Default::default()
        };
        self.grid.update(cx, |g, cx| g.set_result(Arc::new(result), cx));
        cx.notify();
    }

    fn clear(&mut self, cx: &mut Context<Self>) {
        if let Ok(s) = SqlStore::open() {
            s.clear_history(self.connection_id).ok();
        }
        self.history.clear();
        self.refresh_grid(cx);
    }
}

/// `renderLogCell`
fn log_cell_renderer() -> CellRenderer {
    Rc::new(|column: &str, cell: &Cell, t: &Tokens| {
        let value = cell.as_str().unwrap_or("").to_string();
        let el: AnyElement = match column {
            "status" => {
                let ok = value == "Success";
                let c = if ok { tw("green-500") } else { tw("red-500") };
                div()
                    .h_6()
                    .flex()
                    .items_center()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(with_alpha(c, 0.4))
                    .bg(with_alpha(c, 0.1))
                    .px(px(10.))
                    .tw_text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .text_color(if ok { tw("green-400") } else { tw("red-400") })
                    .child(if ok { "Success" } else { "Error" })
                    .into_any_element()
            }
            "caller" => div()
                .tw_text_xs()
                .text_color(if value == "User" { tw("blue-300") } else { tw("amber-300") })
                .child(value)
                .into_any_element(),
            "connection" | "actor" if value.is_empty() || value == "-" => {
                div().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.6)).child("-").into_any_element()
            }
            "connection" => div().tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(tw("sky-400")).child(value).into_any_element(),
            "actor" => div().tw_text_xs().text_color(t.muted_foreground).child(value).into_any_element(),
            "error" if value.is_empty() => div().text_color(with_alpha(t.muted_foreground, 0.4)).child("-").into_any_element(),
            "error" => div().font_family(MONO).tw_text_xs().text_color(tw("red-400")).overflow_hidden().text_ellipsis().child(value.replace('\n', " ")).into_any_element(),
            "duration_ms" => div().font_family(MONO).tw_text_xs().text_color(t.muted_foreground).child(format!("{value}ms")).into_any_element(),
            "query" => div()
                .font_family(MONO)
                .tw_text_xs()
                .text_color(with_alpha(t.foreground, 0.9))
                .overflow_hidden()
                .text_ellipsis()
                .child(value.split_whitespace().collect::<Vec<_>>().join(" "))
                .into_any_element(),
            _ => return None,
        };
        Some(el)
    })
}

fn segmented(t: &Tokens) -> gpui::Div {
    div().flex().items_center().tw_rounded_lg().border_1().border_color(t.studio_border).bg(with_alpha(t.studio_bg, 0.7)).p(px(2.))
}

fn seg_button(id: impl Into<SharedString>, active: bool, t: &Tokens) -> gpui::Stateful<gpui::Div> {
    div()
        .id(gpui::ElementId::Name(id.into()))
        .h_7()
        .px_2()
        .flex()
        .items_center()
        .gap_1()
        .tw_rounded_lg()
        .tw_text_xs()
        .cursor_pointer()
        .when(active, |d| d.bg(t.muted).text_color(t.foreground))
        .when(!active, |d| d.text_color(t.muted_foreground).hover(|s| s.text_color(t.foreground)))
}

impl Render for QueryHistoryView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let filtered = self.filtered(cx);
        let searching = !self.search.read(cx).value().is_empty();

        let toolbar = div()
            .h(px(56.))
            .flex_shrink_0()
            .border_b_1()
            .border_color(t.studio_border)
            .flex()
            .items_center()
            .justify_between()
            .px_4()
            .bg(t.studio_header_bg)
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(
                        segmented(&t)
                            .child(
                                seg_button("mode-logs", self.mode == DisplayMode::Logs, &t)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.mode = DisplayMode::Logs;
                                        cx.notify();
                                    }))
                                    .child(Icon::new(IconName::Table2).size(px(14.)))
                                    .child("Logs"),
                            )
                            .child(
                                seg_button("mode-cards", self.mode == DisplayMode::Cards, &t)
                                    .on_click(cx.listener(|this, _, _, cx| {
                                        this.mode = DisplayMode::Cards;
                                        cx.notify();
                                    }))
                                    .child(Icon::new(IconName::Rows3).size(px(14.)))
                                    .child("Cards"),
                            ),
                    )
                    .child(segmented(&t).children([(CallerFilter::All, "All"), (CallerFilter::System, "System"), (CallerFilter::User, "User")].map(
                        |(f, label)| {
                            seg_button(format!("caller-{label}"), self.caller == f, &t)
                                .px_3()
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.caller = f;
                                    this.page = 0;
                                    this.refresh_grid(cx);
                                }))
                                .child(label)
                        },
                    )))
                    .child(Badge::new(filtered.len().to_string()).variant(BadgeVariant::Secondary)),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        div().w_72().child(
                            TextInput::new(&self.search)
                                .h(32.)
                                .prefix(Icon::new(IconName::Search).size(px(14.)).text_color(t.muted_foreground)),
                        ),
                    )
                    .child(
                        div()
                            .id("clear-history")
                            .h_8()
                            .px_3()
                            .flex()
                            .items_center()
                            .gap_2()
                            .tw_rounded_lg()
                            .tw_text_xs()
                            .text_color(tw("red-500"))
                            .cursor_pointer()
                            .hover(|s| s.text_color(tw("red-600")).bg(with_alpha(tw("red-500"), 0.1)))
                            .on_click(cx.listener(|this, _, _, cx| this.clear(cx)))
                            .child(Icon::new(IconName::Trash).size(px(14.)))
                            .child("Clear"),
                    ),
            );

        let body: AnyElement = match self.mode {
            DisplayMode::Logs if filtered.is_empty() => div()
                .flex_1()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .bg(t.studio_bg)
                .text_color(t.muted_foreground)
                .child(div().mb_3().opacity(0.2).child(Icon::new(IconName::Clock).size(px(40.))))
                .child(div().tw_text_sm().child(if searching { "No logs match your search" } else { "No logs yet" }))
                .into_any_element(),
            DisplayMode::Logs => {
                let pages = filtered.len().div_ceil(PAGE_SIZE).max(1);
                let page = self.page;
                div()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .min_h_0()
                    .bg(t.studio_bg)
                    .child(div().flex_1().flex().min_h_0().child(self.grid.clone()))
                    .child(
                        // Grid pagination footer.
                        div()
                            .h_10()
                            .flex_shrink_0()
                            .border_t_1()
                            .border_color(t.studio_border)
                            .flex()
                            .items_center()
                            .justify_between()
                            .px_4()
                            .tw_text_xs()
                            .text_color(t.muted_foreground)
                            .child(format!(
                                "{}–{} of {}",
                                page * PAGE_SIZE + 1,
                                ((page + 1) * PAGE_SIZE).min(filtered.len()),
                                filtered.len()
                            ))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_1()
                                    .child(Button::new("hist-prev").ghost().size(ButtonSize::IconSm).icon(IconName::ChevronLeft).disabled(page == 0).on_click(
                                        cx.listener(|this, _, _, cx| {
                                            this.page = this.page.saturating_sub(1);
                                            this.refresh_grid(cx);
                                        }),
                                    ))
                                    .child(format!("Page {} of {pages}", page + 1))
                                    .child(Button::new("hist-next").ghost().size(ButtonSize::IconSm).icon(IconName::ChevronRight).disabled(page + 1 >= pages).on_click(
                                        cx.listener(move |this, _, _, cx| {
                                            if this.page + 1 < pages {
                                                this.page += 1;
                                            }
                                            this.refresh_grid(cx);
                                        }),
                                    )),
                            ),
                    )
                    .into_any_element()
            }
            DisplayMode::Cards => self.render_cards(filtered, searching, cx),
        };

        div().flex_1().size_full().flex().flex_col().min_h_0().bg(t.background).font_family(rexa_ui::SANS).text_color(t.foreground).child(toolbar).child(body)
    }
}

impl QueryHistoryView {
    fn render_cards(&mut self, entries: Vec<HistoryEntry>, searching: bool, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let sep = || div().w(px(1.)).h_3().bg(t.studio_border);
        let content: AnyElement = if entries.is_empty() {
            div()
                .flex()
                .flex_col()
                .items_center()
                .justify_center()
                .py_20()
                .text_color(t.muted_foreground)
                .bg(with_alpha(t.studio_bg, 0.5))
                .tw_rounded_lg()
                .border_1()
                .border_dashed()
                .border_color(t.studio_border)
                .child(div().mb_4().opacity(0.1).child(Icon::new(IconName::Clock).size(px(48.))))
                .child(div().tw_text_sm().child(if searching { "No queries match your search" } else { "No history yet" }))
                .into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap_4()
                .children(entries.into_iter().take(500).map(|e| {
                    let ok = e.status == "success";
                    let group: SharedString = format!("card-{}", e.id).into();
                    let (q1, q2) = (e.query.clone(), e.query.clone());
                    div()
                        .tw_rounded_lg()
                        .border_1()
                        .border_color(if ok { t.studio_border } else { with_alpha(tw("red-500"), 0.2) })
                        .bg(if ok { with_alpha(t.studio_bg, 0.3) } else { with_alpha(tw("red-500"), 0.05) })
                        .overflow_hidden()
                        .child(
                            div()
                                .px_4()
                                .py_3()
                                .border_b_1()
                                .border_color(t.studio_border)
                                .flex()
                                .items_center()
                                .justify_between()
                                .bg(with_alpha(t.studio_bg, 0.5))
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_4()
                                        .child(
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap_2()
                                                .child(
                                                    div()
                                                        .size_5()
                                                        .tw_rounded_lg()
                                                        .flex()
                                                        .items_center()
                                                        .justify_center()
                                                        .bg(with_alpha(if ok { tw("green-500") } else { tw("red-500") }, 0.1))
                                                        .child(
                                                            Icon::new(if ok { IconName::CircleCheck } else { IconName::CircleAlert })
                                                                .size(px(12.))
                                                                .text_color(if ok { tw("green-500") } else { tw("red-500") }),
                                                        ),
                                                )
                                                .child(
                                                    div()
                                                        .tw_text_xs()
                                                        .text_color(with_alpha(if ok { tw("green-600") } else { tw("red-600") }, 0.7))
                                                        .child(e.status.clone()),
                                                ),
                                        )
                                        .child(sep())
                                        .child(
                                            div()
                                                .tw_text_xs()
                                                .font_weight(FontWeight::MEDIUM)
                                                .flex()
                                                .items_center()
                                                .gap(px(6.))
                                                .opacity(0.6)
                                                .child(Icon::new(if e.caller == "user" { IconName::User } else { IconName::Cpu }).size(px(10.)))
                                                .child(if e.caller == "user" { "User" } else { "System" }),
                                        )
                                        .child(sep())
                                        .child(div().tw_text_xs().text_color(t.muted_foreground).child(format_distance_to_now(e.executed_at)))
                                        .children(e.executed_by_name.clone().or(e.executed_by.clone()).map(|by| {
                                            div()
                                                .flex()
                                                .items_center()
                                                .gap_4()
                                                .child(sep())
                                                .child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("Ran by {by}")))
                                        })),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .gap_4()
                                        .when(ok && e.rows_count.is_some(), |d| {
                                            let n = e.rows_count.unwrap_or(0);
                                            d.child(
                                                div()
                                                    .tw_text_xs()
                                                    .font_weight(FontWeight::MEDIUM)
                                                    .text_color(t.muted_foreground)
                                                    .bg(with_alpha(t.studio_border, 0.5))
                                                    .px_2()
                                                    .py(px(2.))
                                                    .tw_rounded_lg()
                                                    .child(format!("{n} {}", if n == 1 { "row" } else { "rows" })),
                                            )
                                        })
                                        .child(div().tw_text_xs().font_family(MONO).text_color(t.muted_foreground).child(format!("{}ms", e.duration))),
                                ),
                        )
                        .child(
                            div()
                                .p_4()
                                .flex()
                                .flex_col()
                                .gap_3()
                                .child(
                                    div()
                                        .relative()
                                        .group(group.clone())
                                        .child(
                                            div()
                                                .tw_text_xs()
                                                .font_family(MONO)
                                                .bg(with_alpha(t.muted, 0.3))
                                                .p_4()
                                                .tw_rounded_lg()
                                                .border_1()
                                                .border_color(with_alpha(t.studio_border, 0.5))
                                                .max_h(px(256.))
                                                .overflow_hidden()
                                                .text_color(with_alpha(t.foreground, 0.8))
                                                .line_height(px(19.5))
                                                .child(e.query.clone()),
                                        )
                                        .child(
                                            div()
                                                .absolute()
                                                .top_2()
                                                .right_2()
                                                .flex()
                                                .gap_2()
                                                .invisible()
                                                .group_hover(group, |s| s.visible())
                                                .child(Button::new(SharedString::from(format!("copy-{}", e.id))).secondary().size(ButtonSize::Sm).icon(IconName::Copy).label("Copy").on_click(
                                                    move |_, _, cx| cx.write_to_clipboard(ClipboardItem::new_string(q1.clone())),
                                                ))
                                                .child(Button::new(SharedString::from(format!("run-{}", e.id))).secondary().size(ButtonSize::Sm).icon(IconName::Play).label("Run").on_click(
                                                    move |_, _, cx| {
                                                        rexa_core::open_tab(
                                                            TabSpec::Query { id: format!("sql-new-{}", now_millis()), title: "History Query".into(), sql: q2.clone() },
                                                            cx,
                                                        )
                                                    },
                                                )),
                                        ),
                                )
                                .children(e.error.clone().filter(|_| !ok).map(|err| {
                                    div()
                                        .tw_text_xs()
                                        .text_color(tw("red-400"))
                                        .font_family(MONO)
                                        .bg(with_alpha(tw("red-500"), 0.05))
                                        .p_3()
                                        .tw_rounded_lg()
                                        .border_1()
                                        .border_color(with_alpha(tw("red-500"), 0.1))
                                        .child(err)
                                })),
                        )
                }))
                .into_any_element()
        };
        div().id("history-cards").flex_1().overflow_y_scroll().p_6().child(div().max_w(px(1024.)).mx_auto().child(content)).into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn table_names() {
        // Same as the TS regex: a quoted segment stops at its closing quote.
        assert_eq!(extract_table_name("SELECT * FROM \"public\".\"users\" LIMIT 1"), "public");
        assert_eq!(extract_table_name("select * from public.users"), "public.users");
        assert_eq!(extract_table_name("update accounts set x = 1"), "accounts");
        assert_eq!(extract_table_name("select 1"), "-");
    }
}
