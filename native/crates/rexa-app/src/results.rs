use gpui::{div, App, Context, IntoElement, ParentElement, SharedString, Styled, Window};
use gpui_component::table::{Column, TableDelegate, TableState};
use gpui_component::ActiveTheme;
use rexa_drivers::{Cell, QueryResult};

/// Table delegate over a query result. Rows are rendered lazily by the
/// virtualized table, so large results stay cheap.
#[derive(Default)]
pub struct ResultsDelegate {
    columns: Vec<Column>,
    rows: Vec<Vec<Cell>>,
}

impl ResultsDelegate {
    pub fn set_result(&mut self, result: &QueryResult) {
        self.columns = result
            .columns
            .iter()
            .enumerate()
            .map(|(i, name)| Column::new(SharedString::from(format!("c{i}")), name.clone()).width(gpui::px(column_width(result, i))))
            .collect();
        self.rows = result.rows.clone();
    }

    pub fn clear(&mut self) {
        self.columns.clear();
        self.rows.clear();
    }
}

/// Size columns from the header and a sample of rows, clamped to a sane range.
fn column_width(result: &QueryResult, col: usize) -> f32 {
    let header = result.columns[col].chars().count();
    let widest = result
        .rows
        .iter()
        .take(200)
        .map(|r| r[col].display().chars().count())
        .max()
        .unwrap_or(0)
        .max(header);
    (widest as f32 * 7.5 + 28.).clamp(64., 420.)
}

impl TableDelegate for ResultsDelegate {
    fn columns_count(&self, _: &App) -> usize {
        self.columns.len()
    }

    fn rows_count(&self, _: &App) -> usize {
        self.rows.len()
    }

    fn column(&self, col_ix: usize, _: &App) -> Column {
        self.columns[col_ix].clone()
    }

    fn render_td(
        &mut self,
        row_ix: usize,
        col_ix: usize,
        _: &mut Window,
        cx: &mut Context<TableState<Self>>,
    ) -> impl IntoElement {
        let cell = &self.rows[row_ix][col_ix];
        let text: String = cell.display().chars().take(500).collect::<String>().replace('\n', " ");
        let el = div().overflow_hidden().whitespace_nowrap().text_ellipsis();
        match cell {
            Cell::Null => el.text_color(cx.theme().muted_foreground).italic().child("NULL"),
            Cell::Text(_) => el.child(text),
        }
    }
}
