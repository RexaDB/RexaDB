//! Shared building blocks for the provider studio tabs (headers, search,
//! empty/error states and a compact table). Mirrors the shapes used by the
//! original `components/studio/{auth,storage,edge-functions,payments}` views
//! and `components/team/*`.

use gpui::{div, prelude::*, px, AnyElement, App, Entity, FontWeight, SharedString};
use rexa_drivers::{Cell, Driver, QueryResult};
use rexa_ui::widgets::InputState;
use rexa_ui::{with_alpha, ActiveTokens, IconName, Spinner, Tw};
use std::sync::Arc;

/// One SQL result set flattened to display strings, addressed by column name.
#[derive(Clone, Default)]
pub struct Grid {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
}

impl Grid {
    pub fn from_result(result: QueryResult) -> Self {
        let columns = result.columns;
        let rows = result
            .rows
            .into_iter()
            .map(|row| row.into_iter().map(cell_text).collect())
            .collect();
        Self { columns, rows }
    }

    pub fn index(&self, name: &str) -> Option<usize> {
        self.columns.iter().position(|c| c == name)
    }

    pub fn get<'a>(&self, row: &'a [String], name: &str) -> &'a str {
        self.index(name)
            .and_then(|i| row.get(i))
            .map_or("", String::as_str)
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }
}

fn cell_text(cell: Cell) -> String {
    match cell {
        Cell::Null => String::new(),
        Cell::Text(text) => text,
    }
}

pub async fn run_sql(driver: Arc<dyn Driver>, sql: String, limit: usize) -> anyhow::Result<Grid> {
    Ok(Grid::from_result(driver.execute(&sql, limit).await?))
}

/// Case-insensitive "does any of these columns contain the query" filter.
pub fn matches(query: &str, values: &[&str]) -> bool {
    let q = query.trim().to_lowercase();
    q.is_empty() || values.iter().any(|v| v.to_lowercase().contains(&q))
}

pub fn page(cx: &App) -> gpui::Div {
    let t = cx.tokens();
    div()
        .size_full()
        .flex()
        .flex_col()
        .bg(t.background)
        .text_color(t.foreground)
}

pub fn header(
    title: impl Into<SharedString>,
    description: impl Into<SharedString>,
    cx: &App,
) -> gpui::Div {
    let t = cx.tokens();
    div()
        .flex()
        .flex_col()
        .gap_1()
        .px_6()
        .py_5()
        .border_b_1()
        .border_color(t.border)
        .child(
            div()
                .tw_text_sm()
                .font_weight(FontWeight::SEMIBOLD)
                .child(title.into()),
        )
        .child(
            div()
                .tw_text_xs()
                .text_color(t.muted_foreground)
                .child(description.into()),
        )
}

pub fn toolbar() -> gpui::Div {
    div().flex().items_center().gap_2().px_6().py_3()
}

pub fn search_input(state: &Entity<InputState>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .w(px(300.))
        .flex()
        .items_center()
        .gap_2()
        .child(
            rexa_ui::widgets::Icon::new(IconName::Search)
                .size(px(14.))
                .text_color(with_alpha(t.muted_foreground, 0.7)),
        )
        .child(div().flex_1().child(rexa_ui::TextInput::new(state)))
        .into_any_element()
}

pub fn loading(text: impl Into<SharedString>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .flex_1()
        .flex()
        .items_center()
        .justify_center()
        .gap_3()
        .tw_text_sm()
        .text_color(t.muted_foreground)
        .child(Spinner::new(16.))
        .child(text.into())
        .into_any_element()
}

pub fn empty(
    icon: IconName,
    title: impl Into<SharedString>,
    description: impl Into<SharedString>,
    cx: &App,
) -> AnyElement {
    let t = cx.tokens();
    div()
        .flex_1()
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap_2()
        .p_8()
        .text_center()
        .child(
            rexa_ui::widgets::Icon::new(icon)
                .size(px(28.))
                .text_color(with_alpha(t.muted_foreground, 0.6)),
        )
        .child(
            div()
                .tw_text_sm()
                .font_weight(FontWeight::MEDIUM)
                .child(title.into()),
        )
        .child(
            div()
                .max_w(px(420.))
                .tw_text_xs()
                .text_color(t.muted_foreground)
                .child(description.into()),
        )
        .into_any_element()
}

pub fn error_box(message: impl Into<SharedString>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .mx_6()
        .my_3()
        .p_3()
        .tw_rounded_lg()
        .border_1()
        .border_color(with_alpha(t.destructive, 0.35))
        .bg(with_alpha(t.destructive, 0.08))
        .tw_text_xs()
        .text_color(t.destructive)
        .child(message.into())
        .into_any_element()
}

pub fn notice(message: impl Into<SharedString>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .mx_6()
        .my_3()
        .p_3()
        .tw_rounded_lg()
        .border_1()
        .border_color(t.border)
        .bg(t.muted)
        .tw_text_xs()
        .text_color(t.muted_foreground)
        .child(message.into())
        .into_any_element()
}

pub fn section_title(title: impl Into<SharedString>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .px_6()
        .pt_5()
        .pb_2()
        .tw_text_xs()
        .font_weight(FontWeight::MEDIUM)
        .text_color(t.muted_foreground)
        .child(title.into())
        .into_any_element()
}

pub struct Col {
    pub header: &'static str,
    pub width: Option<f32>,
    pub right: bool,
}

impl Col {
    pub fn new(header: &'static str) -> Self {
        Col {
            header,
            width: None,
            right: false,
        }
    }
    pub fn w(header: &'static str, width: f32) -> Self {
        Col {
            header,
            width: Some(width),
            right: false,
        }
    }
    pub fn right(header: &'static str, width: f32) -> Self {
        Col {
            header,
            width: Some(width),
            right: true,
        }
    }
}

/// Compact list table with a muted header band and hover rows.
pub fn list_table(
    cols: &[Col],
    rows: Vec<Vec<AnyElement>>,
    empty: AnyElement,
    cx: &App,
) -> AnyElement {
    let t = cx.tokens().clone();
    let widths: Vec<AnyElement> = cols
        .iter()
        .map(|c| {
            let mut cell = div().flex().items_center().px_3().min_w_0();
            cell = match c.width {
                Some(w) => cell.flex_shrink_0().w(px(w)),
                None => cell.flex_1(),
            };
            if c.right {
                cell = cell.justify_end();
            }
            cell.child(div().truncate().child(c.header))
                .into_any_element()
        })
        .collect();
    let count = rows.len();
    let body: Vec<AnyElement> = rows
        .into_iter()
        .enumerate()
        .map(|(i, cells)| {
            let last = i + 1 == count;
            let mut row = div()
                .flex()
                .items_center()
                .h(px(44.))
                .px_3()
                .hover(|d| d.bg(t.muted));
            if !last {
                row = row.border_b_1().border_color(with_alpha(t.border, 0.6));
            }
            for (ci, cell) in cells.into_iter().enumerate() {
                let Some(col) = cols.get(ci) else { break };
                let mut slot = div().flex().items_center().px_2().min_w_0();
                slot = match col.width {
                    Some(w) => slot.flex_shrink_0().w(px(w)),
                    None => slot.flex_1(),
                };
                if col.right {
                    slot = slot.justify_end();
                }
                row = row.child(slot.child(cell));
            }
            row.into_any_element()
        })
        .collect();

    let mut table = div()
        .mx_6()
        .mb_6()
        .tw_rounded_lg()
        .border_1()
        .border_color(t.border)
        .overflow_hidden()
        .flex()
        .flex_col()
        .tw_text_sm();
    table = table.child(
        div()
            .flex()
            .items_center()
            .h(px(36.))
            .px_3()
            .bg(t.muted)
            .tw_text_xs()
            .text_color(t.muted_foreground)
            .children(widths),
    );
    if body.is_empty() {
        table = table.child(empty);
    } else {
        table = table.children(body);
    }
    table.into_any_element()
}

/// Plain text cell.
pub fn text(value: impl Into<SharedString>) -> AnyElement {
    div().truncate().child(value.into()).into_any_element()
}

/// Muted text cell.
pub fn muted(value: impl Into<SharedString>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .truncate()
        .text_color(t.muted_foreground)
        .child(value.into())
        .into_any_element()
}

/// `timeAgo` for ISO-8601 timestamps, e.g. "3m ago".
pub fn time_ago(value: &str) -> String {
    let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(value) else {
        return if value.is_empty() {
            "—".into()
        } else {
            value.to_string()
        };
    };
    let seconds = (chrono::Utc::now() - parsed.with_timezone(&chrono::Utc)).num_seconds();
    if seconds < 60 {
        "just now".into()
    } else if seconds < 3600 {
        format!("{}m ago", seconds / 60)
    } else if seconds < 86_400 {
        format!("{}h ago", seconds / 3600)
    } else if seconds < 2_592_000 {
        format!("{}d ago", seconds / 86_400)
    } else {
        format!("{}mo ago", seconds / 2_592_000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grid_reads_cells_by_column_name() {
        let grid = Grid {
            columns: vec!["id".into(), "name".into()],
            rows: vec![vec!["1".into(), "Ada".into()]],
        };
        assert_eq!(grid.get(&grid.rows[0], "name"), "Ada");
        assert_eq!(grid.get(&grid.rows[0], "missing"), "");
    }

    #[test]
    fn filters_case_insensitively() {
        assert!(matches("", &["Postgres"]));
        assert!(matches("post", &["Postgres"]));
        assert!(!matches("redis", &["Postgres"]));
    }
}
