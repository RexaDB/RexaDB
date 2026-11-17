//! Port of `components/studio/table-editor-view.tsx` plus the table-tab state
//! and actions the original keeps in `hooks/use-studio.ts`
//! (`refreshTableData`, `handleUpdateRow`, `handleCommitChanges`,
//! `handleDeleteRows`, `handleDuplicateRow`, `handleInsertRow`, `exportData`,
//! `copyData`, `copyRowData`, `toggleColumn`) and `hooks/use-table-data-mutations.ts`
//! (`getRowId`, pending changes).

use crate::cells::{self, ValueShape};
use crate::filters;
use crate::grid::GridState;
use crate::settings::{self, GridSettings};
use gpui::{
    div, prelude::*, px, App, ClipboardItem, Context, Entity, FocusHandle, SharedString, Subscription, Task,
    WeakEntity, Window,
};
use rexa_core::{runtime, Session, StudioEvent, TabSpec};
use rexa_drivers::{
    ColumnDetail, Driver, EnumType, ForeignKey, Kind, RowUpdate, SortConfig, SortDirection, TableFilter, TableQuery,
    TableRef, TypeCategory, Value,
};
use rexa_ui::widgets::InputState;
use rexa_ui::{ActiveTokens, Toast};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::time::Duration;

/// One grid column (a result field joined with its `tableStructure` entry).
#[derive(Debug, Clone)]
pub struct GridColumn {
    pub name: String,
    /// `struct.data_type || struct.type` (drives editors and cell kinds).
    pub data_type: String,
    /// `struct.data_type || struct.udt_name || "text"` (header icon).
    pub header_type: String,
    pub category: TypeCategory,
    pub shape: ValueShape,
    pub is_pk: bool,
    pub is_fk: bool,
    pub nullable: bool,
    pub enum_options: Option<Vec<String>>,
    pub auto_width: f32,
}

impl GridColumn {
    pub fn is_boolean(&self) -> bool {
        cells::classify_column_type(&self.data_type).is_boolean
    }
    pub fn is_date(&self) -> bool {
        cells::classify_column_type(&self.data_type).is_date
    }
    pub fn is_json(&self) -> bool {
        self.data_type.to_lowercase().contains("json")
    }
    /// The JS value was a number (node-pg int2/int4/float).
    pub fn is_number(&self) -> bool {
        matches!(self.category, TypeCategory::Integer | TypeCategory::Decimal)
    }
}

pub type CellValue = Option<SharedString>;

#[derive(Debug, Clone, Default)]
pub struct GridData {
    pub columns: Vec<GridColumn>,
    pub rows: Vec<Vec<CellValue>>,
}

impl GridData {
    pub fn column_index(&self, name: &str) -> Option<usize> {
        self.columns.iter().position(|c| c.name == name)
    }
}

/// `{ old, new }` of one pending cell edit.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingCell {
    pub old: CellValue,
    pub new: CellValue,
}

/// `pendingChanges`: rowId → column → edit.
pub type PendingChanges = BTreeMap<String, BTreeMap<String, PendingCell>>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActionKind {
    DeleteRow,
    InsertRow,
    DuplicateRow,
}

impl ActionKind {
    pub fn id(self) -> &'static str {
        match self {
            ActionKind::DeleteRow => "delete_row",
            ActionKind::InsertRow => "insert_row",
            ActionKind::DuplicateRow => "duplicate_row",
        }
    }
}

/// `pendingActions` entry (review mode).
#[derive(Debug, Clone)]
pub struct PendingAction {
    pub id: u64,
    pub kind: ActionKind,
    pub description: String,
    pub sql: String,
    /// `metadata.where` for deletes (row identity), used to strike rows through.
    pub r#where: Vec<(String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SearchScope {
    Page,
    Table,
}

/// Contained sheets (`StudioSheet contained`) shown over the grid.
#[derive(Clone)]
pub enum SheetKind {
    Insert(Vec<(String, Entity<InputState>)>),
    Review,
    /// Text editing sheet for a cell (Alt+M / maximize) and the JSON sheet.
    EditCell { row: usize, col: usize, json: bool, error: Option<String> },
    /// FK picker for a cell (`fk-selection-sheet.tsx`).
    FkSelect(crate::sheets::FkPicker),
}

pub struct TableEditor {
    pub(crate) session: Arc<Session>,
    pub(crate) driver: Arc<dyn Driver>,
    pub(crate) kind: Kind,
    pub(crate) spec: TabSpec,
    pub(crate) table: TableRef,
    pub(crate) settings: GridSettings,
    pub(crate) focus: FocusHandle,

    pub(crate) structure: Vec<ColumnDetail>,
    pub(crate) foreign_keys: Vec<ForeignKey>,
    pub(crate) enums: Vec<EnumType>,
    pub(crate) fetching_structure: bool,

    pub(crate) data: Option<GridData>,
    pub(crate) loading: bool,
    pub(crate) error: Option<String>,
    pub(crate) total_count: Option<u64>,
    pub(crate) count_unavailable: bool,
    pub(crate) has_more: bool,
    pub(crate) loading_more: bool,
    pub(crate) load_more_error: Option<String>,
    pub(crate) filter_query: String,
    pub(crate) sort: Option<SortConfig>,
    pub(crate) page: usize,
    pub(crate) page_size: usize,
    pub(crate) hidden: Vec<String>,
    seq: u64,
    count_cache: BTreeMap<String, u64>,

    pub(crate) pending: PendingChanges,
    pub(crate) pending_actions: Vec<PendingAction>,
    next_action_id: u64,
    pub(crate) committing: bool,
    pub(crate) deleting: bool,
    pub(crate) selected_rows: BTreeSet<usize>,

    pub(crate) grid: GridState,
    pub(crate) toolbar: crate::toolbar::ToolbarState,
    pub(crate) search_input: Entity<InputState>,
    pub(crate) search_scope: SearchScope,
    whole_table_base: Option<String>,
    search_debounce: Option<Task<()>>,
    pub(crate) sheet: Option<SheetKind>,
    pub(crate) fk_preview: Option<crate::sheets::FkPreview>,
    pub(crate) auto_refresh_ms: u64,
    auto_refresh_task: Option<Task<()>>,
    _subs: Vec<Subscription>,
}

impl TableEditor {
    pub fn new(schema: String, table: String, session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let driver = session.driver.clone();
        let kind = driver.kind();
        let spec = TabSpec::Table { schema: schema.clone(), table: table.clone() };
        let search_input = cx.new(|cx| {
            InputState::new(window, cx).placeholder(format!("Search all values in {table}..."))
        });
        let mut subs = Vec::new();
        subs.push(cx.subscribe_in(&search_input, window, Self::on_search_event));
        subs.push(cx.subscribe_in(&rexa_core::studio_bus(cx), window, Self::on_bus));
        let hidden = settings::load_hidden_columns(session.connection.id, &schema, &table);
        let mut this = TableEditor {
            driver,
            kind,
            spec,
            table: TableRef::new(schema, table),
            settings: GridSettings::load(),
            focus: cx.focus_handle(),
            structure: Vec::new(),
            foreign_keys: Vec::new(),
            enums: Vec::new(),
            fetching_structure: true,
            data: None,
            loading: true,
            error: None,
            total_count: None,
            count_unavailable: false,
            has_more: false,
            loading_more: false,
            load_more_error: None,
            filter_query: String::new(),
            sort: None,
            page: 0,
            page_size: 100,
            hidden,
            seq: 0,
            count_cache: BTreeMap::new(),
            pending: PendingChanges::new(),
            pending_actions: Vec::new(),
            next_action_id: 1,
            committing: false,
            deleting: false,
            selected_rows: BTreeSet::new(),
            grid: GridState::default(),
            toolbar: crate::toolbar::ToolbarState::new(window, cx),
            search_input,
            search_scope: SearchScope::Page,
            whole_table_base: None,
            search_debounce: None,
            sheet: None,
            fk_preview: None,
            auto_refresh_ms: 0,
            auto_refresh_task: None,
            session,
            _subs: subs,
        };
        this.load_structure(cx);
        this.refresh(cx);
        this
    }

    pub(crate) fn weak(cx: &Context<Self>) -> WeakEntity<Self> {
        cx.entity().downgrade()
    }

    pub fn connection_id(&self) -> i64 {
        self.session.connection.id
    }

    pub(crate) fn connection_string(&self) -> &str {
        &self.session.connection.connection_string
    }

    fn on_bus(&mut self, _: &Entity<rexa_core::StudioBus>, ev: &StudioEvent, window: &mut Window, cx: &mut Context<Self>) {
        if let StudioEvent::TabCommand { tab, command } = ev {
            if *tab != self.spec {
                return;
            }
            match command.as_str() {
                "REFRESH_CURRENT_TAB" => self.refresh_current_tab(cx),
                "COMMIT_PENDING_CHANGES" => self.commit_changes(cx),
                "OPEN_INSERT_SHEET" => self.open_insert_sheet(window, cx),
                "TOGGLE_PENDING_CHANGES_PANEL" => {
                    self.sheet = match self.sheet {
                        Some(SheetKind::Review) => None,
                        _ => Some(SheetKind::Review),
                    };
                    cx.notify();
                }
                _ => {}
            }
        }
    }

    // ---- structure --------------------------------------------------------------------

    fn load_structure(&mut self, cx: &mut Context<Self>) {
        let driver = self.driver.clone();
        let table = self.table.clone();
        let caps = self.driver.capabilities();
        let task = runtime::spawn(async move {
            let structure = driver.table_structure(&table).await.unwrap_or_default();
            let fks = if caps.foreign_keys { driver.foreign_keys(&table).await.unwrap_or_default() } else { Vec::new() };
            let enums = if caps.postgres_catalog { driver.enums().await.unwrap_or_default() } else { Vec::new() };
            anyhow::Ok((structure, fks, enums))
        });
        self.fetching_structure = true;
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.fetching_structure = false;
                if let Ok((structure, fks, enums)) = result {
                    this.structure = structure;
                    this.foreign_keys = fks;
                    this.enums = enums;
                    this.rebuild_columns();
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn detail(&self, name: &str) -> Option<&ColumnDetail> {
        self.structure.iter().find(|c| c.column_name == name)
    }

    /// `resolveEnumOptions`.
    fn enum_options(&self, d: &ColumnDetail) -> Option<Vec<String>> {
        let udt = d.udt_name.as_deref().unwrap_or("").trim();
        if udt.is_empty() {
            return None;
        }
        let schema = d.udt_schema.as_deref().unwrap_or("").trim();
        let candidates: Vec<&EnumType> = self.enums.iter().filter(|e| e.name == udt).collect();
        let m = candidates.iter().find(|e| schema.is_empty() || e.schema == schema).or(candidates.first())?;
        Some(m.values.clone())
    }

    fn make_column(&self, meta: &rexa_drivers::ColumnMeta, values: &[Vec<CellValue>], i: usize) -> GridColumn {
        let detail = self.detail(&meta.name);
        let is_pk = detail.is_some_and(|d| d.is_primary_key);
        let is_fk = detail.is_some_and(|d| d.is_foreign_key);
        let data_type = detail.map(|d| d.data_type.clone()).unwrap_or_default();
        let header_type = detail
            .map(|d| if d.data_type.is_empty() { d.udt_name.clone().unwrap_or_default() } else { d.data_type.clone() })
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "text".into());
        let shape = cells::value_shape(self.kind, meta);
        GridColumn {
            name: meta.name.clone(),
            data_type,
            header_type,
            category: meta.category,
            shape,
            is_pk,
            is_fk,
            nullable: detail.is_none_or(|d| d.is_nullable),
            enum_options: detail.and_then(|d| self.enum_options(d)),
            auto_width: cells::auto_column_width(&meta.name, is_pk, is_fk, values.iter().map(|r| r.get(i).and_then(|v| v.as_deref()))),
        }
    }

    /// Re-join columns with the structure once it arrives.
    fn rebuild_columns(&mut self) {
        let Some(data) = self.data.take() else { return };
        let columns = data
            .columns
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let meta = rexa_drivers::ColumnMeta { name: c.name.clone(), type_name: String::new(), type_id: 0, category: c.category };
                let mut col = self.make_column(&meta, &data.rows, i);
                col.shape = c.shape;
                col
            })
            .collect();
        self.data = Some(GridData { columns, rows: data.rows });
    }

    // ---- loading (refreshTableData) ------------------------------------------------------

    pub fn refresh_current_tab(&mut self, cx: &mut Context<Self>) {
        self.count_cache.clear();
        self.load_structure(cx);
        self.refresh(cx);
    }

    pub(crate) fn infinite(&self) -> bool {
        // supportsInfiniteTableScrolling: needs a stable order (a primary key) on SQL engines.
        self.settings.infinite_scrolling && (self.structure.is_empty() || self.structure.iter().any(|c| c.is_primary_key))
    }

    fn build_query(&self, offset: usize) -> TableQuery {
        let columns = if !self.structure.is_empty() && !self.hidden.is_empty() {
            let selected: Vec<String> =
                self.structure.iter().map(|c| c.column_name.clone()).filter(|n| !self.hidden.contains(n)).collect();
            (!selected.is_empty() && selected.len() < self.structure.len()).then_some(selected)
        } else {
            None
        };
        let stable_order_keys = if self.infinite() {
            self.structure
                .iter()
                .filter(|c| c.is_primary_key && self.sort.as_ref().is_none_or(|s| s.column != c.column_name))
                .map(|c| c.column_name.clone())
                .collect()
        } else {
            Vec::new()
        };
        TableQuery {
            table: self.table.clone(),
            columns,
            filter: if self.filter_query.trim().is_empty() { TableFilter::default() } else { TableFilter::raw(self.filter_query.clone()) },
            sort: self.sort.clone(),
            limit: self.page_size,
            offset,
            stable_order_keys,
            with_count: false,
        }
    }

    /// Reload the current page (or the first batch with infinite scrolling).
    pub fn refresh(&mut self, cx: &mut Context<Self>) {
        self.seq += 1;
        let seq = self.seq;
        self.loading = true;
        self.loading_more = false;
        self.load_more_error = None;
        self.error = None;
        let offset = if self.infinite() { 0 } else { self.page * self.page_size };
        let query = self.build_query(offset);
        let fast = self.settings.fast_table_loading;
        let count_key = format!("{}|{}", self.table.name, self.filter_query);
        let cached_count = self.count_cache.get(&count_key).copied();
        if fast {
            self.total_count = cached_count;
            self.count_unavailable = false;
        }
        let driver = self.driver.clone();
        let rows_query = query.clone();
        let rows_task = runtime::spawn(async move { driver.read_table(&rows_query).await });
        // Fast mode: the count runs beside the rows and lands later; otherwise rows wait for it.
        let need_count = cached_count.is_none() || !fast;
        let count_task = need_count.then(|| {
            let driver = self.driver.clone();
            let (table, filter) = (query.table.clone(), query.filter.clone());
            runtime::spawn(async move { driver.count_rows(&table, &filter).await })
        });
        cx.notify();
        cx.spawn(async move |this, cx| {
            let mut count_task = count_task;
            if !fast {
                if let Some(t) = count_task.take() {
                    let count = t.await.ok();
                    this.update(cx, |this, _| {
                        if this.seq == seq {
                            this.total_count = count;
                        }
                    })
                    .ok();
                }
            }
            let result = rows_task.await;
            this.update(cx, |this, cx| {
                if this.seq != seq {
                    return;
                }
                this.loading = false;
                match result {
                    Ok(page) => {
                        let rows_len = page.result.rows.len();
                        this.accept_page(page.result, false);
                        this.has_more = rows_len >= this.page_size
                            && this.total_count.is_none_or(|t| (this.data.as_ref().map_or(0, |d| d.rows.len()) as u64) < t);
                        this.selected_rows.clear();
                        this.grid.clear_selection();
                    }
                    Err(e) => {
                        this.error = Some(format!("{e:#}"));
                        this.data = None;
                    }
                }
                cx.notify();
            })
            .ok();
            if let Some(t) = count_task {
                let count = t.await.ok();
                this.update(cx, |this, cx| {
                    if this.seq != seq {
                        return;
                    }
                    this.total_count = count;
                    this.count_unavailable = count.is_none();
                    if let Some(c) = count {
                        this.count_cache.insert(count_key, c);
                        let loaded = this.data.as_ref().map_or(0, |d| d.rows.len()) as u64;
                        this.has_more = this.has_more && loaded < c;
                    }
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }

    fn accept_page(&mut self, result: rexa_drivers::QueryResult, append: bool) {
        let metas: Vec<rexa_drivers::ColumnMeta> = (0..result.columns.len()).map(|i| result.column_type(i)).collect();
        let shapes: Vec<ValueShape> = metas.iter().map(|m| cells::value_shape(self.kind, m)).collect();
        let rows: Vec<Vec<CellValue>> = result
            .rows
            .iter()
            .map(|r| {
                r.iter()
                    .enumerate()
                    .map(|(i, c)| cells::serialize_cell(c, shapes.get(i).copied().unwrap_or(ValueShape::Plain)).map(SharedString::from))
                    .collect()
            })
            .collect();
        if append {
            if let Some(data) = self.data.as_mut() {
                data.rows.extend(rows);
                return;
            }
        }
        let columns = metas.iter().enumerate().map(|(i, m)| self.make_column(m, &rows, i)).collect();
        self.data = Some(GridData { columns, rows });
    }

    /// Infinite scrolling: fetch the next batch (`onLoadMore`).
    pub fn load_more(&mut self, cx: &mut Context<Self>) {
        if !self.infinite() || self.loading || self.loading_more || !self.has_more {
            return;
        }
        let offset = self.data.as_ref().map_or(0, |d| d.rows.len());
        let query = self.build_query(offset);
        let seq = self.seq;
        self.loading_more = true;
        self.load_more_error = None;
        let driver = self.driver.clone();
        let task = runtime::spawn(async move { driver.read_table(&query).await });
        cx.notify();
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                if this.seq != seq {
                    return;
                }
                this.loading_more = false;
                match result {
                    Ok(page) => {
                        let n = page.result.rows.len();
                        this.accept_page(page.result, true);
                        let loaded = this.data.as_ref().map_or(0, |d| d.rows.len()) as u64;
                        this.has_more = n >= this.page_size && this.total_count.is_none_or(|t| loaded < t);
                    }
                    Err(e) => this.load_more_error = Some(format!("{e:#}")),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub fn set_page(&mut self, page: usize, cx: &mut Context<Self>) {
        self.page = page;
        self.refresh(cx);
    }

    pub fn set_page_size(&mut self, size: usize, cx: &mut Context<Self>) {
        self.page_size = size.max(1);
        self.page = 0;
        self.refresh(cx);
    }

    /// `refreshTableData(table, schema, filter, sort)` from the toolbar.
    pub fn apply_filter_sort(&mut self, filter: String, sort: Option<SortConfig>, cx: &mut Context<Self>) {
        self.filter_query = filter;
        self.sort = sort;
        self.refresh(cx);
    }

    /// Header click: ASC → DESC → none.
    pub fn cycle_sort(&mut self, column: &str, cx: &mut Context<Self>) {
        self.sort = match &self.sort {
            Some(s) if s.column == column && s.direction == SortDirection::Asc => {
                Some(SortConfig { column: column.into(), direction: SortDirection::Desc })
            }
            Some(s) if s.column == column => None,
            _ => Some(SortConfig { column: column.into(), direction: SortDirection::Asc }),
        };
        self.refresh(cx);
    }

    pub fn set_sort(&mut self, sort: Option<SortConfig>, cx: &mut Context<Self>) {
        self.sort = sort;
        self.refresh(cx);
    }

    // ---- columns ------------------------------------------------------------------------

    pub fn toggle_column(&mut self, name: &str, cx: &mut Context<Self>) {
        if let Some(i) = self.hidden.iter().position(|h| h == name) {
            self.hidden.remove(i);
        } else {
            self.hidden.push(name.to_string());
        }
        settings::save_hidden_columns(self.connection_id(), &self.table.schema, &self.table.name, &self.hidden);
        self.refresh(cx);
    }

    pub fn show_all_columns(&mut self, cx: &mut Context<Self>) {
        self.hidden.clear();
        settings::save_hidden_columns(self.connection_id(), &self.table.schema, &self.table.name, &self.hidden);
        self.refresh(cx);
    }

    /// Columns shown in the toolbar's lists: structure when known, else result fields.
    pub fn column_names(&self) -> Vec<String> {
        if !self.structure.is_empty() {
            self.structure.iter().map(|c| c.column_name.clone()).collect()
        } else {
            self.data.as_ref().map(|d| d.columns.iter().map(|c| c.name.clone()).collect()).unwrap_or_default()
        }
    }

    /// `results.fields` names.
    pub fn field_names(&self) -> Vec<String> {
        self.data.as_ref().map(|d| d.columns.iter().map(|c| c.name.clone()).collect()).unwrap_or_default()
    }

    // ---- search -------------------------------------------------------------------------

    fn on_search_event(&mut self, _: &Entity<InputState>, ev: &rexa_ui::widgets::InputEvent, window: &mut Window, cx: &mut Context<Self>) {
        match ev {
            rexa_ui::widgets::InputEvent::Change => {
                self.toolbar.suggest_index = 0;
                if self.search_scope == SearchScope::Table {
                    self.schedule_whole_table_search(cx);
                }
                cx.notify();
            }
            rexa_ui::widgets::InputEvent::PressEnter { secondary, .. } => {
                if *secondary {
                    self.create_ai_filter(window, cx);
                } else if !self.create_filter_from_search(window, cx) {
                    self.focus.focus(window, cx);
                }
            }
            rexa_ui::widgets::InputEvent::Focus => {
                self.toolbar.search_focused = true;
                cx.notify();
            }
            rexa_ui::widgets::InputEvent::Blur => {
                self.toolbar.search_focused = false;
                self.toolbar.assist_open = false;
                cx.notify();
            }
        }
    }

    pub fn search_query(&self, cx: &App) -> String {
        self.search_input.read(cx).value().to_string()
    }

    /// Lower-cased page-search term (`globalSearchQuery` highlighting).
    pub fn page_search_term(&self, cx: &App) -> Option<String> {
        let q = self.search_query(cx);
        (!q.is_empty()).then(|| q.to_lowercase())
    }

    pub fn set_search_scope(&mut self, scope: SearchScope, cx: &mut Context<Self>) {
        let supports = !matches!(self.kind, Kind::MongoDb | Kind::Redis);
        let scope = if supports { scope } else { SearchScope::Page };
        if scope == self.search_scope {
            return;
        }
        self.search_scope = scope;
        match scope {
            SearchScope::Table => {
                self.whole_table_base = Some(self.filter_query.clone());
                self.schedule_whole_table_search(cx);
            }
            SearchScope::Page => {
                if let Some(base) = self.whole_table_base.take() {
                    if base != self.filter_query {
                        self.filter_query = base;
                        self.refresh(cx);
                    }
                }
            }
        }
        cx.notify();
    }

    fn schedule_whole_table_search(&mut self, cx: &mut Context<Self>) {
        let base = self.whole_table_base.get_or_insert_with(|| self.filter_query.clone()).clone();
        let combined = filters::combine_filters(&base, &self.search_query(cx), &self.field_names(), self.kind);
        if combined == self.filter_query {
            return;
        }
        self.filter_query = combined;
        self.search_debounce = Some(cx.spawn(async move |this, cx| {
            cx.background_executor().timer(Duration::from_millis(150)).await;
            this.update(cx, |this, cx| {
                this.page = 0;
                this.refresh(cx);
            })
            .ok();
        }));
    }

    /// `createFilterFromSearch`: Enter on `column op value`.
    pub fn create_filter_from_search(&mut self, window: &mut Window, cx: &mut Context<Self>) -> bool {
        let text = self.search_query(cx);
        let Some(clause) = filters::parse_quick_filter(&text, &self.column_names(), self.kind) else { return false };
        let next = filters::join_filter_clause(&self.filter_query, &clause);
        self.filter_query = next;
        self.refresh(cx);
        self.search_input.update(cx, |s, cx| s.set_value("", window, cx));
        self.toolbar.assist_open = false;
        Toast::success(format!("Filter added: {clause}")).show(cx);
        self.focus.focus(window, cx);
        true
    }

    /// `createAiFilter` (⌘↩): needs the AI agent crate, which talks to providers.
    pub fn create_ai_filter(&mut self, _window: &mut Window, cx: &mut Context<Self>) {
        if self.search_query(cx).trim().is_empty() {
            return;
        }
        Toast::error("Set a default AI provider in AI settings first (Models section).").show(cx);
    }

    /// `handleFilterByCell`.
    pub fn filter_by_cell(&mut self, col: usize, row: usize, cx: &mut Context<Self>) {
        let Some(data) = &self.data else { return };
        let Some(column) = data.columns.get(col) else { return };
        let value = self.cell_value(row, col);
        let filter = filters::filter_by_value(&column.name, value.as_deref(), column.is_number(), column.is_boolean(), self.kind);
        if self.search_scope == SearchScope::Table {
            self.whole_table_base = Some(filter.clone());
            self.filter_query = filters::combine_filters(&filter, &self.search_query(cx), &self.field_names(), self.kind);
            self.page = 0;
        } else {
            self.filter_query = filter;
        }
        self.refresh(cx);
    }

    // ---- row identity & values --------------------------------------------------------------

    pub fn pk_columns(&self) -> Vec<String> {
        self.structure.iter().filter(|c| c.is_primary_key).map(|c| c.column_name.clone()).collect()
    }

    /// `getRowId`: `pk:value|pk2:value` or `idx:<n>`.
    pub fn row_id(&self, row: usize) -> String {
        let pks = self.pk_columns();
        let Some(data) = &self.data else { return format!("idx:{row}") };
        if pks.is_empty() {
            return format!("idx:{row}");
        }
        pks.iter()
            .map(|pk| {
                let v = data.column_index(pk).and_then(|i| data.rows.get(row)?.get(i).cloned().flatten());
                // JS template interpolation of null/undefined.
                format!("{pk}:{}", v.as_deref().unwrap_or(if data.column_index(pk).is_some() { "null" } else { "undefined" }))
            })
            .collect::<Vec<_>>()
            .join("|")
    }

    /// `parseRowId`.
    pub fn parse_row_id(row_id: &str) -> Vec<(String, String)> {
        row_id
            .split('|')
            .filter_map(|part| part.split_once(':').map(|(c, v)| (c.to_string(), v.to_string())))
            .collect()
    }

    /// The value shown in a cell: the pending new value when edited.
    pub fn cell_value(&self, row: usize, col: usize) -> CellValue {
        let data = self.data.as_ref()?;
        let column = data.columns.get(col)?;
        if !self.pending.is_empty() {
            if let Some(p) = self.pending.get(&self.row_id(row)).and_then(|r| r.get(&column.name)) {
                return p.new.clone();
            }
        }
        data.rows.get(row)?.get(col).cloned().flatten()
    }

    pub fn pending_cell(&self, row: usize, col: usize) -> Option<&PendingCell> {
        let name = &self.data.as_ref()?.columns.get(col)?.name;
        self.pending.get(&self.row_id(row))?.get(name)
    }

    /// `countPendingCellEdits`.
    pub fn pending_count(&self) -> usize {
        self.pending.values().map(|r| r.len()).sum()
    }

    /// `computePendingDeleteState` + `isRowPendingDelete`.
    pub fn is_row_pending_delete(&self, row: usize) -> bool {
        if self.pending_actions.is_empty() {
            return false;
        }
        let Some(data) = &self.data else { return false };
        let id = self.row_id(row);
        self.pending_actions.iter().filter(|a| a.kind == ActionKind::DeleteRow).any(|a| {
            let rid = a.r#where.iter().map(|(c, v)| format!("{c}:{v}")).collect::<Vec<_>>().join("|");
            rid == id
                || a.r#where.iter().all(|(c, v)| {
                    data.column_index(c)
                        .and_then(|i| data.rows.get(row)?.get(i).cloned())
                        .map(|cell| cell.as_deref().unwrap_or("null") == v)
                        .unwrap_or(false)
                })
        })
    }

    fn mark_dirty(&self, cx: &mut Context<Self>) {
        let dirty = self.pending_count() > 0 || !self.pending_actions.is_empty();
        rexa_core::emit_studio(StudioEvent::MarkDirty { tab: self.spec.clone(), dirty }, cx);
    }

    fn typed(&self, col: &GridColumn, v: &CellValue) -> Value {
        match v {
            None => Value::Null,
            Some(s) => {
                if matches!(col.shape, ValueShape::Array(_)) {
                    if let Some(lit) = cells::json_to_pg_array(s) {
                        return Value::Text(lit);
                    }
                }
                if col.is_boolean() {
                    return Value::from_text_typed(s, TypeCategory::Boolean);
                }
                Value::Text(s.to_string())
            }
        }
    }

    fn where_values(&self, row_id: &str) -> Vec<(String, Value)> {
        let data = self.data.as_ref();
        Self::parse_row_id(row_id)
            .into_iter()
            .map(|(c, v)| {
                let cat = data.and_then(|d| d.columns.iter().find(|x| x.name == c)).map_or(TypeCategory::Text, |x| x.category);
                let value = match cat {
                    TypeCategory::Integer | TypeCategory::Decimal | TypeCategory::Boolean => Value::from_text_typed(&v, cat),
                    _ => Value::Text(v),
                };
                (c, value)
            })
            .collect()
    }

    // ---- edits (handleUpdateRow) ------------------------------------------------------------

    pub fn update_cell(&mut self, row: usize, col: usize, new_value: CellValue, cx: &mut Context<Self>) {
        let Some(data) = &self.data else { return };
        let Some(column) = data.columns.get(col).cloned() else { return };
        // normalizeJsonColumnValue: JSON columns must hold valid JSON.
        let new_value = if column.is_json() {
            match &new_value {
                Some(s) if !s.trim().is_empty() => match serde_json::from_str::<serde_json::Value>(s) {
                    Ok(_) => Some(SharedString::from(cells::compact_json(s))),
                    Err(_) => {
                        Toast::error(format!("Invalid JSON for column \"{}\".", column.name)).show(cx);
                        return;
                    }
                },
                _ => new_value,
            }
        } else {
            new_value
        };
        let row_id = self.row_id(row);
        let old = self
            .pending
            .get(&row_id)
            .and_then(|r| r.get(&column.name))
            .map(|p| p.old.clone())
            .unwrap_or_else(|| data.rows.get(row).and_then(|r| r.get(col).cloned()).flatten());
        if self.settings.review_mode {
            if new_value == old {
                if let Some(r) = self.pending.get_mut(&row_id) {
                    r.remove(&column.name);
                    if r.is_empty() {
                        self.pending.remove(&row_id);
                    }
                }
            } else {
                self.pending.entry(row_id).or_default().insert(column.name.clone(), PendingCell { old, new: new_value });
            }
            self.mark_dirty(cx);
            cx.notify();
            return;
        }
        // Direct mode.
        if new_value == old {
            return;
        }
        let update = RowUpdate { r#where: self.where_values(&row_id), set: vec![(column.name.clone(), self.typed(&column, &new_value))] };
        // Optimistic: show the new value right away.
        if let Some(cell) = self.data.as_mut().and_then(|d| d.rows.get_mut(row)).and_then(|r| r.get_mut(col)) {
            *cell = new_value;
        }
        cx.notify();
        let driver = self.driver.clone();
        let table = self.table.clone();
        let task = runtime::spawn(async move { driver.update_rows(&table, &[update]).await });
        cx.spawn(async move |this, cx| {
            let r = task.await;
            this.update(cx, |this, cx| {
                match r {
                    Ok(()) => {
                        Toast::success("Row updated successfully").show(cx);
                    }
                    Err(e) => {
                        Toast::error(format!("{e:#}")).show(cx);
                    }
                }
                this.refresh(cx);
            })
            .ok();
        })
        .detach();
    }

    /// Alt+D / "Discard change".
    pub fn discard_cell_change(&mut self, row: usize, col: usize, cx: &mut Context<Self>) {
        let Some(name) = self.data.as_ref().and_then(|d| d.columns.get(col)).map(|c| c.name.clone()) else { return };
        let id = self.row_id(row);
        if let Some(r) = self.pending.get_mut(&id) {
            r.remove(&name);
            if r.is_empty() {
                self.pending.remove(&id);
            }
        }
        self.mark_dirty(cx);
        cx.notify();
    }

    pub fn clear_pending(&mut self, cx: &mut Context<Self>) {
        self.pending.clear();
        self.pending_actions.clear();
        self.mark_dirty(cx);
        cx.notify();
    }

    pub fn remove_action(&mut self, id: u64, cx: &mut Context<Self>) {
        self.pending_actions.retain(|a| a.id != id);
        self.mark_dirty(cx);
        cx.notify();
    }

    fn add_action(&mut self, kind: ActionKind, description: String, sql: String, r#where: Vec<(String, String)>, cx: &mut Context<Self>) {
        let id = self.next_action_id;
        self.next_action_id += 1;
        self.pending_actions.push(PendingAction { id, kind, description, sql, r#where });
        self.mark_dirty(cx);
    }

    /// `buildPendingEditsSql` (review sheet preview).
    pub fn pending_edits_sql(&self) -> Vec<String> {
        let d = self.kind.dialect();
        let table_ref = d.table_ref(&self.table.schema, &self.table.name);
        let lit = |v: &CellValue| match v {
            None => "NULL".to_string(),
            Some(s) => format!("'{}'", s.replace('\'', "''")),
        };
        self.pending
            .iter()
            .filter(|(id, _)| !id.starts_with("idx:"))
            .filter_map(|(id, fields)| {
                let sets: Vec<String> = fields.iter().map(|(c, e)| format!("{} = {}", d.quote_ident(c), lit(&e.new))).collect();
                let conds: Vec<String> = Self::parse_row_id(id)
                    .into_iter()
                    .filter(|(c, _)| !c.is_empty() && c != "idx")
                    .map(|(c, v)| format!("{} = {}", d.quote_ident(&c), lit(&Some(v.into()))))
                    .collect();
                (!sets.is_empty() && !conds.is_empty())
                    .then(|| format!("UPDATE {table_ref} SET {} WHERE {};", sets.join(", "), conds.join(" AND ")))
            })
            .collect()
    }

    /// `handleCommitChanges`.
    pub fn commit_changes(&mut self, cx: &mut Context<Self>) {
        if (self.pending.is_empty() && self.pending_actions.is_empty()) || self.committing {
            return;
        }
        if self.pending.keys().any(|id| id.starts_with("idx:")) {
            Toast::error("Cannot save changes: One or more rows do not have a primary key.").show(cx);
            return;
        }
        let actions: Vec<String> = self.pending_actions.iter().map(|a| a.sql.clone()).collect();
        let columns = self.data.as_ref().map(|d| d.columns.clone()).unwrap_or_default();
        let updates: Vec<RowUpdate> = self
            .pending
            .iter()
            .map(|(id, changes)| RowUpdate {
                r#where: self.where_values(id),
                set: changes
                    .iter()
                    .map(|(c, e)| {
                        let col = columns.iter().find(|x| &x.name == c);
                        (c.clone(), col.map_or_else(|| Value::Text(e.new.clone().unwrap_or_default().to_string()), |col| self.typed(col, &e.new)))
                    })
                    .collect(),
            })
            .collect();
        self.committing = true;
        cx.notify();
        let driver = self.driver.clone();
        let table = self.table.clone();
        let task = runtime::spawn(async move {
            for sql in &actions {
                driver.execute(sql, 0).await?;
            }
            if !updates.is_empty() {
                driver.update_rows(&table, &updates).await?;
            }
            anyhow::Ok(())
        });
        cx.spawn(async move |this, cx| {
            let r = task.await;
            this.update(cx, |this, cx| {
                this.committing = false;
                match r {
                    Ok(()) => {
                        this.pending.clear();
                        this.pending_actions.clear();
                        if matches!(this.sheet, Some(SheetKind::Review)) {
                            this.sheet = None;
                        }
                        this.mark_dirty(cx);
                        Toast::success("All changes committed successfully").show(cx);
                        this.refresh(cx);
                    }
                    Err(e) => {
                        Toast::error(format!("{e:#}")).show(cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    // ---- rows ---------------------------------------------------------------------------

    /// `handleDeleteRows` (after the confirm dialog).
    pub fn delete_selected_rows(&mut self, cx: &mut Context<Self>) {
        if self.selected_rows.is_empty() {
            return;
        }
        let rows: Vec<usize> = self.selected_rows.iter().copied().collect();
        if rows.iter().any(|r| self.row_id(*r).starts_with("idx:")) {
            self.error_toast("Cannot delete: One or more rows do not have a primary key.", cx);
            return;
        }
        let wheres: Vec<Vec<(String, String)>> = rows.iter().map(|r| Self::parse_row_id(&self.row_id(*r))).collect();
        if self.settings.review_mode {
            let d = self.kind.dialect();
            for w in wheres {
                let clause = w.iter().map(|(c, v)| format!("{} = '{}'", d.quote_ident(c), v.replace('\'', "''"))).collect::<Vec<_>>().join(" AND ");
                let sql = format!("DELETE FROM {} WHERE {clause};", d.table_ref(&self.table.schema, &self.table.name));
                let desc = format!("Delete row from {}.{}", self.table.schema, self.table.name);
                self.add_action(ActionKind::DeleteRow, desc, sql, w, cx);
            }
            self.selected_rows.clear();
            cx.notify();
            return;
        }
        let values: Vec<rexa_drivers::RowValues> = rows.iter().map(|r| self.where_values(&self.row_id(*r))).collect();
        self.deleting = true;
        cx.notify();
        let driver = self.driver.clone();
        let table = self.table.clone();
        let task = runtime::spawn(async move { driver.delete_rows(&table, &values).await });
        cx.spawn(async move |this, cx| {
            let r = task.await;
            this.update(cx, |this, cx| {
                this.deleting = false;
                match r {
                    Ok(_) => {
                        this.selected_rows.clear();
                        this.count_cache.clear();
                        this.refresh(cx);
                    }
                    Err(e) => this.error_toast(&format!("{e:#}"), cx),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn error_toast(&self, msg: &str, cx: &mut Context<Self>) {
        Toast::error(msg.to_string()).show(cx);
    }

    fn insert_sql(&self, values: &[(String, Value)]) -> String {
        let d = self.kind.dialect();
        let cols = values.iter().map(|(c, _)| d.quote_ident(c)).collect::<Vec<_>>().join(", ");
        let vals = values.iter().map(|(_, v)| d.literal(v)).collect::<Vec<_>>().join(", ");
        let ret = if matches!(self.kind, Kind::MySql | Kind::ClickHouse | Kind::Oracle) { "" } else { " RETURNING *" };
        format!("INSERT INTO {} ({cols}) VALUES ({vals}){ret};", d.table_ref(&self.table.schema, &self.table.name))
    }

    fn run_insert(&mut self, kind: ActionKind, values: Vec<(String, Value)>, cx: &mut Context<Self>) {
        let sql = self.insert_sql(&values);
        if self.settings.review_mode {
            let verb = if kind == ActionKind::DuplicateRow { "Duplicate row in" } else { "Insert row into" };
            let desc = format!("{verb} {}.{}", self.table.schema, self.table.name);
            self.add_action(kind, desc, sql, Vec::new(), cx);
            self.sheet = None;
            cx.notify();
            return;
        }
        let driver = self.driver.clone();
        let table = self.table.clone();
        let task = runtime::spawn(async move { driver.insert_rows(&table, &[values]).await });
        cx.spawn(async move |this, cx| {
            let r = task.await;
            this.update(cx, |this, cx| {
                match r {
                    Ok(_) => {
                        if kind == ActionKind::InsertRow {
                            this.sheet = None;
                            Toast::success("Row inserted successfully").show(cx);
                        }
                        this.count_cache.clear();
                        this.refresh(cx);
                    }
                    Err(e) => this.error_toast(&format!("{e:#}"), cx),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    /// `handleDuplicateRow`: every column except PKs with defaults.
    pub fn duplicate_row(&mut self, row: usize, cx: &mut Context<Self>) {
        let Some(data) = &self.data else { return };
        let values: Vec<(String, Value)> = self
            .structure
            .iter()
            .filter(|c| !c.is_primary_key || c.column_default.is_none())
            .filter_map(|c| {
                let i = data.column_index(&c.column_name)?;
                let col = &data.columns[i];
                Some((c.column_name.clone(), self.typed(col, &data.rows.get(row)?.get(i).cloned().flatten())))
            })
            .collect();
        if values.is_empty() {
            self.error_toast("No columns to duplicate", cx);
            return;
        }
        self.run_insert(ActionKind::DuplicateRow, values, cx);
    }

    pub fn open_insert_sheet(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let inputs = self
            .structure
            .iter()
            .map(|c| {
                let placeholder = if c.is_primary_key && c.column_default.is_some() {
                    "Auto-generated ID".to_string()
                } else if let Some(d) = &c.column_default {
                    format!("Default: {d}")
                } else if c.is_nullable {
                    "NULL".into()
                } else {
                    "Required...".into()
                };
                (c.column_name.clone(), cx.new(|cx| InputState::new(window, cx).placeholder(placeholder)))
            })
            .collect();
        self.sheet = Some(SheetKind::Insert(inputs));
        cx.notify();
    }

    /// `handleInsertRow`: only non-empty inputs are sent.
    pub fn save_insert(&mut self, cx: &mut Context<Self>) {
        let Some(SheetKind::Insert(inputs)) = &self.sheet else { return };
        let values: Vec<(String, Value)> = inputs
            .iter()
            .filter_map(|(name, input)| {
                let v = input.read(cx).value().to_string();
                if v.is_empty() {
                    return None;
                }
                let cat = self.detail(name).map_or(TypeCategory::Text, |d| TypeCategory::classify(&d.data_type));
                Some((name.clone(), Value::from_text_typed(&v, cat)))
            })
            .collect();
        if values.is_empty() {
            let d = self.kind.dialect();
            let sql = format!("INSERT INTO {} DEFAULT VALUES;", d.table_ref(&self.table.schema, &self.table.name));
            let driver = self.driver.clone();
            let task = runtime::spawn(async move { driver.execute(&sql, 0).await });
            cx.spawn(async move |this, cx| {
                let r = task.await;
                this.update(cx, |this, cx| {
                    match r {
                        Ok(_) => {
                            this.sheet = None;
                            this.refresh(cx);
                        }
                        Err(e) => this.error_toast(&format!("{e:#}"), cx),
                    }
                })
                .ok();
            })
            .detach();
            return;
        }
        self.run_insert(ActionKind::InsertRow, values, cx);
    }

    // ---- copy / export --------------------------------------------------------------------

    fn rows_for_export(&self, cx: &mut Context<Self>, copy: bool) -> Option<Vec<usize>> {
        let data = self.data.as_ref()?;
        if data.rows.is_empty() {
            self.error_toast(if copy { "No data available to copy." } else { "No data available to export." }, cx);
            return None;
        }
        Some(if self.selected_rows.is_empty() { (0..data.rows.len()).collect() } else { self.selected_rows.iter().copied().collect() })
    }

    fn row_json(&self, row: usize) -> serde_json::Value {
        let mut map = serde_json::Map::new();
        if let Some(data) = &self.data {
            for (i, c) in data.columns.iter().enumerate() {
                let v = data.rows.get(row).and_then(|r| r.get(i).cloned()).flatten();
                map.insert(c.name.clone(), cells::json_value(v.as_deref(), c.shape, c.category));
            }
        }
        serde_json::Value::Object(map)
    }

    fn format_rows(&self, rows: &[usize], format: &str, delimiter: char) -> String {
        let Some(data) = &self.data else { return String::new() };
        let d = self.kind.dialect();
        match format {
            "json" => serde_json::to_string_pretty(&rows.iter().map(|r| self.row_json(*r)).collect::<Vec<_>>()).unwrap_or_default(),
            "csv" => {
                let mut lines = vec![data.columns.iter().map(|c| cells::format_delimited(Some(&c.name), delimiter)).collect::<Vec<_>>().join(&delimiter.to_string())];
                for r in rows {
                    lines.push(
                        (0..data.columns.len())
                            .map(|i| cells::format_delimited(data.rows[*r].get(i).cloned().flatten().as_deref(), delimiter))
                            .collect::<Vec<_>>()
                            .join(&delimiter.to_string()),
                    );
                }
                lines.join("\n")
            }
            _ => {
                let cols = data.columns.iter().map(|c| d.quote_ident(&c.name)).collect::<Vec<_>>().join(", ");
                rows.iter()
                    .map(|r| {
                        let vals = data
                            .columns
                            .iter()
                            .enumerate()
                            .map(|(i, c)| cells::format_sql_literal(data.rows[*r].get(i).cloned().flatten().as_deref(), c.is_number() || c.is_boolean()))
                            .collect::<Vec<_>>()
                            .join(", ");
                        format!("INSERT INTO {} ({cols}) VALUES ({vals});", d.table_ref(&self.table.schema, &self.table.name))
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            }
        }
    }

    /// `copyData(format)`.
    pub fn copy_data(&mut self, format: &str, cx: &mut Context<Self>) {
        let Some(rows) = self.rows_for_export(cx, true) else { return };
        let text = self.format_rows(&rows, format, '\t');
        cx.write_to_clipboard(ClipboardItem::new_string(text));
    }

    /// `exportData(format)`: the browser download becomes a file in ~/Downloads.
    pub fn export_data(&mut self, format: &str, cx: &mut Context<Self>) {
        let Some(rows) = self.rows_for_export(cx, false) else { return };
        let text = self.format_rows(&rows, format, ',');
        let dir = std::env::var_os("HOME").map(|h| std::path::PathBuf::from(h).join("Downloads")).unwrap_or_else(std::env::temp_dir);
        let mut path = dir.join(format!("{}.{format}", self.table.name));
        let mut n = 1;
        while path.exists() {
            path = dir.join(format!("{} ({n}).{format}", self.table.name));
            n += 1;
        }
        match std::fs::write(&path, text) {
            Ok(()) => {
                Toast::success(format!("Saved {}", path.file_name().and_then(|f| f.to_str()).unwrap_or_default())).show(cx);
            }
            Err(e) => self.error_toast(&e.to_string(), cx),
        }
    }

    /// `copyRowData(row, format)`.
    pub fn copy_row(&mut self, row: usize, json: bool, cx: &mut Context<Self>) {
        let text = if json {
            serde_json::to_string_pretty(&self.row_json(row)).unwrap_or_default()
        } else {
            let Some(data) = &self.data else { return };
            let headers = data.columns.iter().map(|c| cells::format_delimited(Some(&c.name), ',')).collect::<Vec<_>>().join(",");
            let values = (0..data.columns.len())
                .map(|i| cells::format_delimited(data.rows[row].get(i).cloned().flatten().as_deref(), ','))
                .collect::<Vec<_>>()
                .join(",");
            format!("{headers}\n{values}")
        };
        cx.write_to_clipboard(ClipboardItem::new_string(text));
        Toast::success(format!("Row copied as {}", if json { "JSON" } else { "CSV" })).show(cx);
    }

    // ---- auto refresh ------------------------------------------------------------------------

    pub fn set_auto_refresh(&mut self, ms: u64, cx: &mut Context<Self>) {
        self.auto_refresh_ms = ms;
        self.auto_refresh_task = (ms > 0).then(|| {
            cx.spawn(async move |this, cx| loop {
                cx.background_executor().timer(Duration::from_millis(ms)).await;
                if this.update(cx, |this, cx| this.refresh_current_tab(cx)).is_err() {
                    break;
                }
            })
        });
        cx.notify();
    }
}

impl gpui::Focusable for TableEditor {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}

impl Render for TableEditor {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let show_banner = self.settings.show_pending_changes_banner && (self.pending_count() > 0 || !self.pending_actions.is_empty());
        let loading = self.loading || self.fetching_structure;
        div()
            .relative()
            .flex_1()
            .size_full()
            .flex()
            .flex_col()
            .overflow_hidden()
            .bg(t.studio_bg)
            .child(self.render_toolbar(window, cx))
            .when(show_banner, |d| d.child(self.render_pending_banner(cx)))
            // The 1px progress beam under the toolbar while loading.
            .child(div().w_full().h(px(if loading && !self.settings.skeleton_loaders { 1. } else { 0. })).when(loading, |d| {
                d.bg(rexa_ui::with_alpha(rexa_ui::tw("blue-500"), 0.4))
            }))
            .child(self.render_grid_area(window, cx))
            .children(self.render_sheet(window, cx))
            .children(self.render_fk_preview(window, cx))
    }
}

impl TableEditor {
    /// `PendingChangesBanner`.
    fn render_pending_banner(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let (changes, actions) = (self.pending_count(), self.pending_actions.len());
        let total = changes + actions;
        let mut parts = Vec::new();
        if changes > 0 {
            parts.push(format!("{changes} cell edit{}", if changes != 1 { "s" } else { "" }));
        }
        if actions > 0 {
            parts.push(format!("{actions} action{}", if actions != 1 { "s" } else { "" }));
        }
        let label = format!("{total} pending ({})", parts.join(", "));
        let t = cx.tokens();
        let color = if t.dark { rexa_ui::tw("amber-400") } else { rexa_ui::tw("amber-700") };
        use rexa_ui::Tw;
        div()
            .flex()
            .items_center()
            .justify_between()
            .px_4()
            .py(px(6.))
            .bg(rexa_ui::with_alpha(rexa_ui::tw("amber-500"), 0.1))
            .flex_shrink_0()
            .child(div().tw_text_xs().text_color(color).font_weight(gpui::FontWeight::MEDIUM).child(label))
            .child(
                div()
                    .id("review-pending")
                    .tw_text_xs()
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .text_color(color)
                    .cursor_pointer()
                    .hover(|s| s.underline())
                    .child("Review →")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.sheet = Some(SheetKind::Review);
                        cx.notify();
                    })),
            )
    }
}
