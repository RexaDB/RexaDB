//! Port of `components/studio/data-table-toolbar.tsx` (UnifiedSearchBar with
//! quick-filter assist, search scope, ToolbarLayout overflow) and
//! `components/studio/toolbar/{toolbar-filter-sort,toolbar-selection-actions,
//! toolbar-global-actions,toolbar-layout}.tsx`, `saved-table-views.tsx`.
//!
//! The filter and sort popovers contain selects; Radix lets a select's list
//! sit outside its popover without closing it. GPUI has no such layering, so
//! those two popovers and their selects are drawn here with an explicit
//! "nested list open" rule: an outside press first closes the open list,
//! the next one closes the popover (what Radix does).

use crate::filters::{self, DraftRule};
use crate::settings;
use crate::view::{SearchScope, TableEditor};
use gpui::{
    div, prelude::*, px, AnyElement, App, Bounds, Context, Entity, FontWeight, Hsla, Pixels, SharedString, Window,
};
use rexa_drivers::{FilterOperator, FilterRule, SortConfig, SortDirection};
use rexa_ui::popup::{self, Align, Side};
use rexa_ui::widgets::InputState;
use rexa_ui::{
    tw, with_alpha, ActiveTokens, Button, ButtonSize, Checkbox, DropdownMenu, IconName, MenuItem, Popover, TextInput,
    Toast, Tw,
};
use std::cell::Cell;
use std::collections::HashMap;
use std::rc::Rc;

const SEARCH_MIN_WIDTH: f32 = 256.;
const SEARCH_MIN_WIDTH_SELECTING: f32 = 96.;
const MORE_BUTTON_WIDTH: f32 = 44.;
const GAP: f32 = 8.;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum NestedOwner {
    FilterColumn(u64),
    FilterOperator(u64),
    SortAdd,
}

#[allow(dead_code)]
pub struct FilterPanel {
    pub rules: Vec<(DraftRule, Entity<InputState>)>,
    pub custom_where: Entity<InputState>,
    pub suggest_index: usize,
}

pub struct SortPanel {
    pub local: Vec<SortConfig>,
}

#[derive(Clone)]
pub struct SavedView {
    pub id: String,
    pub name: String,
    pub table: String,
    pub schema: String,
    pub filter: String,
    pub sort: Vec<SortConfig>,
}

pub struct ToolbarState {
    pub search_focused: bool,
    pub assist_open: bool,
    pub suggest_index: usize,
    pub page_input: Option<Entity<InputState>>,
    pub custom_page_size: Option<Entity<InputState>>,
    pub filter_panel: Option<FilterPanel>,
    pub sort_panel: Option<SortPanel>,
    pub nested: Option<NestedOwner>,
    swallow_out: bool,
    next_rule_id: u64,
    pub expanded: bool,
    pub hidden_items: Vec<String>,
    pub bar: Rc<Cell<Bounds<Pixels>>>,
    triggers: HashMap<&'static str, Rc<Cell<Bounds<Pixels>>>>,
    nested_bounds: HashMap<NestedOwner, Rc<Cell<Bounds<Pixels>>>>,
    pub views: Vec<SavedView>,
    pub view_name: Option<Entity<InputState>>,
}

impl ToolbarState {
    pub fn new(_window: &mut Window, _cx: &mut App) -> Self {
        ToolbarState {
            search_focused: false,
            assist_open: false,
            suggest_index: 0,
            page_input: None,
            custom_page_size: None,
            filter_panel: None,
            sort_panel: None,
            nested: None,
            swallow_out: false,
            next_rule_id: 1,
            expanded: false,
            hidden_items: Vec::new(),
            bar: Rc::new(Cell::new(Bounds::default())),
            triggers: HashMap::new(),
            nested_bounds: HashMap::new(),
            views: Vec::new(),
            view_name: None,
        }
    }

    fn trigger(&mut self, key: &'static str) -> Rc<Cell<Bounds<Pixels>>> {
        self.triggers.entry(key).or_insert_with(|| Rc::new(Cell::new(Bounds::default()))).clone()
    }
}

// ---- persistence of toolbar-layout / saved views (localStorage keys → app_settings) ----------

fn load_local(key: &str) -> Option<serde_json::Value> {
    if let Some(v) = rexa_store::Store::open().ok().and_then(|s| s.setting(key).ok().flatten()) {
        return serde_json::from_str(&v).ok();
    }
    rexa_store::WebStore::open().and_then(|w| w.get_json(key))
}

fn save_local(key: &str, value: &serde_json::Value) {
    if let Ok(s) = rexa_store::Store::open() {
        s.set_setting(key, &value.to_string()).ok();
    }
}

fn sort_json(s: &SortConfig) -> serde_json::Value {
    serde_json::json!({ "column": s.column, "direction": s.direction.sql() })
}

impl TableEditor {
    fn layout_key(&self) -> String {
        format!("rexadb:toolbar-layout:{}", settings::connection_hash(self.connection_string()))
    }

    fn views_key(&self) -> String {
        format!("rexadb:saved-table-views:{}", settings::connection_hash(self.connection_string()))
    }

    pub(crate) fn load_toolbar_prefs(&mut self) {
        self.toolbar.hidden_items = load_local(&self.layout_key())
            .and_then(|v| v.get("hidden").cloned())
            .and_then(|v| serde_json::from_value::<Vec<String>>(v).ok())
            .unwrap_or_default();
        self.toolbar.views = load_local(&self.views_key())
            .and_then(|v| v.as_array().cloned())
            .unwrap_or_default()
            .into_iter()
            .filter_map(|v| {
                Some(SavedView {
                    id: v.get("id")?.as_str()?.to_string(),
                    name: v.get("name")?.as_str().unwrap_or("").to_string(),
                    table: v.get("table")?.as_str().unwrap_or("").to_string(),
                    schema: v.get("schema")?.as_str().unwrap_or("").to_string(),
                    filter: v.get("filter").and_then(|f| f.as_str()).unwrap_or("").to_string(),
                    sort: v
                        .get("sort")
                        .and_then(|s| s.as_array().cloned())
                        .unwrap_or_default()
                        .into_iter()
                        .filter_map(|s| {
                            Some(SortConfig {
                                column: s.get("column")?.as_str()?.to_string(),
                                direction: if s.get("direction")?.as_str()? == "DESC" { SortDirection::Desc } else { SortDirection::Asc },
                            })
                        })
                        .collect(),
                })
            })
            .collect();
    }

    fn persist_views(&self) {
        let arr: Vec<serde_json::Value> = self
            .toolbar
            .views
            .iter()
            .map(|v| {
                serde_json::json!({
                    "id": v.id, "name": v.name, "table": v.table, "schema": v.schema,
                    "filter": v.filter, "sort": v.sort.iter().map(sort_json).collect::<Vec<_>>()
                })
            })
            .collect();
        save_local(&self.views_key(), &serde_json::Value::Array(arr));
    }

    fn toggle_toolbar_item(&mut self, id: &str, cx: &mut Context<Self>) {
        if let Some(i) = self.toolbar.hidden_items.iter().position(|h| h == id) {
            self.toolbar.hidden_items.remove(i);
        } else {
            self.toolbar.hidden_items.push(id.to_string());
        }
        save_local(&self.layout_key(), &serde_json::json!({ "hidden": self.toolbar.hidden_items }));
        cx.notify();
    }

    // ---- filter panel (ToolbarFilterSort) --------------------------------------------------

    fn draft_value_input(&mut self, value: &str, window: &mut Window, cx: &mut Context<Self>) -> Entity<InputState> {
        let v = value.to_string();
        cx.new(|cx| InputState::new(window, cx).placeholder("Value...").default_value(v))
    }

    fn next_rule(&mut self) -> u64 {
        let id = self.toolbar.next_rule_id;
        self.toolbar.next_rule_id += 1;
        id
    }

    /// `prepareDialog`.
    pub(crate) fn open_filter_panel(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.toolbar.filter_panel.take().is_some() {
            cx.notify();
            return;
        }
        let (rules, remainder) = filters::decompose_filter_query(&self.filter_query, &self.field_names(), self.kind);
        let mut drafts = Vec::new();
        for r in rules {
            let id = self.next_rule();
            let input = self.draft_value_input(&r.value, window, cx);
            drafts.push((DraftRule { id, rule: r }, input));
        }
        let custom_where = cx.new(|cx| InputState::new(window, cx).placeholder("Advanced filter… e.g. revenue > 100").default_value(remainder));
        self.toolbar.sort_panel = None;
        self.toolbar.filter_panel = Some(FilterPanel { rules: drafts, custom_where, suggest_index: 0 });
        cx.notify();
    }

    fn panel_rules(&self, cx: &App) -> Vec<FilterRule> {
        self.toolbar
            .filter_panel
            .as_ref()
            .map(|p| {
                p.rules
                    .iter()
                    .map(|(d, input)| FilterRule { value: input.read(cx).value().to_string(), ..d.rule.clone() })
                    .collect()
            })
            .unwrap_or_default()
    }

    /// `handleApplyFilter`.
    fn apply_filter_panel(&mut self, cx: &mut Context<Self>) {
        let Some(panel) = &self.toolbar.filter_panel else { return };
        let custom = panel.custom_where.read(cx).value().to_string();
        let next = filters::compose_filter(&self.panel_rules(cx), &custom, self.kind);
        self.toolbar.filter_panel = None;
        self.toolbar.nested = None;
        self.apply_filter_sort(next, self.sort.clone(), cx);
    }

    /// `handleClearFilters`.
    fn clear_filters(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.toolbar.filter_panel = None;
        self.search_input.update(cx, |s, cx| s.set_value("", window, cx));
        self.set_search_scope(SearchScope::Page, cx);
        self.apply_filter_sort(String::new(), self.sort.clone(), cx);
    }

    /// Enter in the advanced input: move parseable segments into visual rules.
    fn on_custom_where_enter(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some(panel) = &self.toolbar.filter_panel else { return };
        let val = panel.custom_where.read(cx).value().trim().to_string();
        if val.is_empty() {
            self.apply_filter_panel(cx);
            return;
        }
        let (rules, remainder) = filters::decompose_filter_query(&val, &self.field_names(), self.kind);
        let real: Vec<FilterRule> = rules.into_iter().filter(filters::is_real).collect();
        if real.is_empty() {
            self.apply_filter_panel(cx);
            return;
        }
        let mut new_rules = Vec::new();
        for r in real {
            let id = self.next_rule();
            let input = self.draft_value_input(&r.value, window, cx);
            new_rules.push((DraftRule { id, rule: r }, input));
        }
        let panel = self.toolbar.filter_panel.as_mut().unwrap();
        if panel.rules.len() == 1 && (panel.rules[0].0.rule.column == "none" || panel.rules[0].0.rule.operator.is_none()) {
            panel.rules.clear();
        }
        panel.rules.extend(new_rules);
        let cw = panel.custom_where.clone();
        cw.update(cx, |s, cx| s.set_value(remainder, window, cx));
        cx.notify();
    }

    fn set_rule(&mut self, id: u64, f: impl FnOnce(&mut FilterRule), cx: &mut Context<Self>) {
        if let Some(p) = self.toolbar.filter_panel.as_mut() {
            if let Some((d, _)) = p.rules.iter_mut().find(|(d, _)| d.id == id) {
                f(&mut d.rule);
            }
        }
        cx.notify();
    }

    // ---- sort panel -------------------------------------------------------------------------------

    pub(crate) fn open_sort_panel(&mut self, cx: &mut Context<Self>) {
        if self.toolbar.sort_panel.take().is_some() {
            cx.notify();
            return;
        }
        self.toolbar.filter_panel = None;
        self.toolbar.sort_panel = Some(SortPanel { local: self.sort.iter().cloned().collect() });
        cx.notify();
    }

    fn close_panels(&mut self, cx: &mut Context<Self>) {
        if self.toolbar.nested.is_some() || self.toolbar.swallow_out {
            self.toolbar.swallow_out = false;
            return;
        }
        self.toolbar.filter_panel = None;
        self.toolbar.sort_panel = None;
        cx.notify();
    }

    // ---- small builders -------------------------------------------------------------------------

    fn toolbar_btn(id: impl Into<gpui::ElementId>, icon: IconName, label: impl Into<SharedString>) -> Button {
        Button::new(id).outline().size(ButtonSize::Sm).icon(icon).label(label)
    }

    /// shadcn SelectTrigger `h-8 w-full text-xs bg-background border-border` + its listbox.
    fn mini_select(
        &mut self,
        owner: NestedOwner,
        label: Option<String>,
        placeholder: &str,
        options: Vec<(String, String)>,
        on_pick: Rc<dyn Fn(&mut TableEditor, String, &mut Context<TableEditor>)>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let t = cx.tokens().clone();
        let tracker = self.toolbar.nested_bounds.entry(owner).or_insert_with(|| Rc::new(Cell::new(Bounds::default()))).clone();
        let open = self.toolbar.nested == Some(owner);
        let mut el = div()
            .id(SharedString::from(format!("mini-select-{owner:?}")))
            .relative()
            .flex()
            .items_center()
            .justify_between()
            .h_8()
            .w_full()
            .min_w_0()
            .px(px(10.))
            .gap_1()
            .tw_rounded_lg()
            .border_1()
            .border_color(t.border)
            .bg(t.background)
            .tw_text_xs()
            .cursor_pointer()
            .child(popup::bounds_tracker(tracker.clone()))
            .child(
                div()
                    .min_w_0()
                    .overflow_hidden()
                    .whitespace_nowrap()
                    .text_ellipsis()
                    .when(label.is_none(), |d| d.text_color(t.muted_foreground))
                    .child(label.unwrap_or_else(|| placeholder.to_string())),
            )
            .child(gpui_component::Icon::new(IconName::ChevronDown).size_4().text_color(with_alpha(t.muted_foreground, 0.5)))
            .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_click(cx.listener(move |this, _, _, cx| {
                this.toolbar.nested = if this.toolbar.nested == Some(owner) { None } else { Some(owner) };
                cx.notify();
            }));
        if open {
            let list = div()
                .id("mini-select-list")
                .occlude()
                .w(tracker.get().size.width.max(px(160.)))
                .max_h(px(288.))
                .overflow_y_scroll()
                .p_1()
                .tw_rounded_lg()
                .border_1()
                .border_color(t.border)
                .bg(t.popover)
                .shadow(popup::shadow_md())
                .children(options.into_iter().enumerate().map(|(i, (value, text))| {
                    let pick = on_pick.clone();
                    div()
                        .id(("mini-opt", i))
                        .px_2()
                        .py(px(6.))
                        .tw_rounded_md()
                        .tw_text_xs()
                        .cursor_pointer()
                        .hover(|s| s.bg(t.accent).text_color(t.accent_foreground))
                        .child(text)
                        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.toolbar.nested = None;
                            pick(this, value.clone(), cx);
                            cx.notify();
                        }))
                }))
                .on_mouse_down_out(cx.listener(|this, _, _, cx| {
                    this.toolbar.nested = None;
                    this.toolbar.swallow_out = true;
                    cx.notify();
                }));
            el = el.child(popup::floating(tracker.get(), Side::Bottom, Align::Start, 4., 0., list));
        }
        el.into_any_element()
    }

    fn render_filter_panel(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        self.toolbar.filter_panel.as_ref()?;
        let t = cx.tokens().clone();
        let columns = self.field_names();
        let ids: Vec<(u64, FilterRule, Entity<InputState>)> =
            self.toolbar.filter_panel.as_ref().unwrap().rules.iter().map(|(d, i)| (d.id, d.rule.clone(), i.clone())).collect();
        let mut rows = Vec::new();
        for (id, rule, input) in ids {
            let col_opts: Vec<(String, String)> =
                std::iter::once(("none".to_string(), "Column...".to_string())).chain(columns.iter().map(|c| (c.clone(), c.clone()))).collect();
            let op_opts: Vec<(String, String)> = std::iter::once(("none".to_string(), "Operator...".to_string()))
                .chain(FilterOperator::ALL.iter().map(|o| (o.id().to_string(), o.label().to_string())))
                .collect();
            let col_label = (rule.column != "none" && !rule.column.is_empty()).then(|| rule.column.clone());
            let op_label = rule.operator.map(|o| o.label().to_string());
            let needs_value = rule.operator.is_some_and(|o| o.needs_value());
            let col_sel = self.mini_select(
                NestedOwner::FilterColumn(id),
                col_label,
                "Column...",
                col_opts,
                Rc::new(move |this, v, cx| {
                    if v != "none" {
                        this.set_rule(id, |r| r.column = v, cx);
                    }
                }),
                cx,
            );
            let op_sel = self.mini_select(
                NestedOwner::FilterOperator(id),
                op_label,
                "Operator...",
                op_opts,
                Rc::new(move |this, v, cx| this.set_rule(id, |r| r.operator = FilterOperator::from_id(&v), cx)),
                cx,
            );
            rows.push(
                div()
                    .px_3()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(
                        div()
                            .size_8()
                            .flex_shrink_0()
                            .tw_rounded_lg()
                            .border_1()
                            .border_color(t.border)
                            .bg(t.background)
                            .flex()
                            .items_center()
                            .justify_center()
                            .child(Checkbox::new(("rule-on", id as usize)).checked(rule.enabled).on_change({
                                let this = cx.entity().downgrade();
                                move |v, _, cx| {
                                    this.update(cx, |this, cx| this.set_rule(id, |r| r.enabled = v, cx)).ok();
                                }
                            })),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .gap_2()
                            .child(div().flex_grow(1.).flex_basis(gpui::relative(0.367)).min_w_0().child(col_sel))
                            .child(div().flex_grow(1.).flex_basis(gpui::relative(0.3)).min_w_0().child(op_sel))
                            .child(
                                div()
                                    .flex_grow(1.)
                                    .flex_basis(gpui::relative(0.367))
                                    .min_w_0()
                                    .when(!needs_value, |d| d.opacity(0.4))
                                    .child(TextInput::new(&input).h(32.).disabled(!needs_value)),
                            ),
                    )
                    .child(
                        Button::new(("rule-x", id as usize))
                            .ghost()
                            .size(ButtonSize::Icon)
                            .icon(IconName::X)
                            .on_click(cx.listener(move |this, _, window, cx| {
                                let next_id = this.next_rule();
                                let input = this.draft_value_input("", window, cx);
                                if let Some(p) = this.toolbar.filter_panel.as_mut() {
                                    p.rules.retain(|(d, _)| d.id != id);
                                    if p.rules.is_empty() {
                                        p.rules.push((filters::make_rule(next_id), input));
                                    }
                                }
                                cx.notify();
                            })),
                    )
                    .into_any_element(),
            );
        }
        let custom = self.toolbar.filter_panel.as_ref().unwrap().custom_where.clone();
        let body = div()
            .flex()
            .flex_col()
            .gap_3()
            .py_3()
            .child(div().flex().flex_col().gap_2().children(rows))
            .child(div().h(px(1.)).bg(t.border))
            .child(
                div()
                    .px_3()
                    .flex()
                    .items_center()
                    .gap_3()
                    .child(Self::toolbar_btn("add-filter", IconName::Plus, "Add Filter").on_click(cx.listener(|this, _, window, cx| {
                        let id = this.next_rule();
                        let input = this.draft_value_input("", window, cx);
                        if let Some(p) = this.toolbar.filter_panel.as_mut() {
                            p.rules.push((filters::make_rule(id), input));
                        }
                        cx.notify();
                    })))
                    .child(
                        div()
                            .flex_1()
                            .capture_key_down(cx.listener(|this, ev: &gpui::KeyDownEvent, window, cx| {
                                if ev.keystroke.key == "enter" {
                                    this.on_custom_where_enter(window, cx);
                                    cx.stop_propagation();
                                }
                            }))
                            .child(TextInput::new(&custom).h(32.)),
                    ),
            )
            .child(
                div().px_3().pt_1().flex().justify_end().child(
                    Button::new("apply-filters").size(ButtonSize::Sm).label("Apply filters").on_click(cx.listener(|this, _, _, cx| this.apply_filter_panel(cx))),
                ),
            );
        Some(self.floating_panel("filter", 520., body.into_any_element(), cx))
    }

    fn render_sort_panel(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let local = self.toolbar.sort_panel.as_ref()?.local.clone();
        let t = cx.tokens().clone();
        let columns: Vec<String> = self.field_names().into_iter().filter(|c| !local.iter().any(|s| &s.column == c)).collect();
        let changed = local != self.sort.iter().cloned().collect::<Vec<_>>();
        let mut body = div().flex().flex_col().gap_2().py_2();
        if local.is_empty() {
            body = body.child(
                div()
                    .px_3()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child("No sorts applied to this view"))
                    .child(div().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.8)).child("Add a column below to sort the view")),
            );
        } else {
            body = body.child(div().flex().flex_col().gap_2().children(local.iter().enumerate().map(|(i, s)| {
                let col = s.column.clone();
                let dir_btn = |label: &'static str, dir: SortDirection, active: bool, col: String| {
                    let b = Button::new(SharedString::from(format!("sort-{label}-{i}"))).size(ButtonSize::Xs).label(label);
                    let b = if active { b } else { b.outline() };
                    b.on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(p) = this.toolbar.sort_panel.as_mut() {
                            if let Some(r) = p.local.iter_mut().find(|r| r.column == col) {
                                r.direction = dir;
                            }
                        }
                        cx.notify();
                    }))
                };
                div()
                    .px_3()
                    .flex()
                    .items_center()
                    .gap_2()
                    .child(div().tw_text_xs().font_family(rexa_ui::MONO).text_color(t.foreground).overflow_hidden().child(s.column.clone()))
                    .child(
                        div()
                            .ml_auto()
                            .flex()
                            .items_center()
                            .gap_1()
                            .child(dir_btn("ASC", SortDirection::Asc, s.direction == SortDirection::Asc, col.clone()))
                            .child(dir_btn("DESC", SortDirection::Desc, s.direction == SortDirection::Desc, col.clone()))
                            .child(Button::new(("sort-x", i)).ghost().size(ButtonSize::IconXs).icon(IconName::X).on_click(cx.listener(move |this, _, _, cx| {
                                if let Some(p) = this.toolbar.sort_panel.as_mut() {
                                    p.local.retain(|r| r.column != col);
                                }
                                cx.notify();
                            }))),
                    )
            })));
        }
        let add = if columns.is_empty() {
            div().tw_text_xs().text_color(t.muted_foreground).child("All columns have been added").into_any_element()
        } else {
            self.mini_select(
                NestedOwner::SortAdd,
                None,
                "Pick a column to sort by",
                columns.iter().map(|c| (c.clone(), c.clone())).collect(),
                Rc::new(|this, v, cx| {
                    if let Some(p) = this.toolbar.sort_panel.as_mut() {
                        p.local.push(SortConfig { column: v, direction: SortDirection::Asc });
                    }
                    cx.notify();
                }),
                cx,
            )
        };
        body = body
            .child(div().h(px(1.)).bg(t.border))
            .child(
                div()
                    .px_3()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(div().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.6)).child("Add column"))
                    .child(add),
            )
            .child(
                div()
                    .px_3()
                    .pt_1()
                    .flex()
                    .items_center()
                    .justify_between()
                    .gap_2()
                    .child(Button::new("sort-clear").ghost().size(ButtonSize::Sm).label("Clear").disabled(local.is_empty()).on_click(cx.listener(|this, _, _, cx| {
                        this.toolbar.sort_panel = None;
                        this.set_sort(None, cx);
                    })))
                    .child(Button::new("sort-apply").size(ButtonSize::Sm).label("Apply sorting").disabled(!changed).on_click(cx.listener(|this, _, _, cx| {
                        // Only the first rule reaches the query, like the original's `config[0]`.
                        let first = this.toolbar.sort_panel.take().and_then(|p| p.local.into_iter().next());
                        this.set_sort(first, cx);
                    }))),
            );
        Some(self.floating_panel("sort", 380., body.into_any_element(), cx))
    }

    fn floating_panel(&mut self, key: &'static str, w: f32, body: AnyElement, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let anchor = self.toolbar.trigger(key).get();
        let panel = div()
            .id(SharedString::from(format!("{key}-panel")))
            .occlude()
            .w(px(w))
            .tw_rounded_lg()
            .border_1()
            .border_color(t.border)
            .bg(t.popover)
            .text_color(t.var("--popover-foreground").unwrap_or(t.foreground))
            .shadow(popup::shadow_md())
            .child(body)
            .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .on_mouse_down_out(cx.listener(|this, _, _, cx| this.close_panels(cx)))
            .on_key_down(cx.listener(|this, ev: &gpui::KeyDownEvent, _, cx| {
                if ev.keystroke.key == "escape" {
                    if this.toolbar.nested.take().is_none() {
                        this.toolbar.filter_panel = None;
                        this.toolbar.sort_panel = None;
                    }
                    cx.notify();
                }
            }));
        popup::floating(anchor, Side::Bottom, Align::End, 6., 0., panel)
    }

    // ---- toolbar groups ----------------------------------------------------------------------------

    fn render_filter_sort(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let filtered = !self.filter_query.trim().is_empty();
        let count = filters::active_filter_count(&self.filter_query, &self.field_names(), self.kind);
        let ft = self.toolbar.trigger("filter");
        let st = self.toolbar.trigger("sort");
        let sorted = self.sort.is_some();
        let filter_btn = div()
            .relative()
            .child(popup::bounds_tracker(ft))
            .child(
                Self::toolbar_btn("filter-btn", IconName::Funnel, if filtered { "Filtered" } else { "Filter" })
                    .when(count > 0, |b| {
                        b.child(
                            div()
                                .ml(px(2.))
                                .h_4()
                                .min_w_4()
                                .px_1()
                                .rounded_full()
                                .bg(with_alpha(tw("blue-500"), 0.15))
                                .flex()
                                .items_center()
                                .justify_center()
                                .text_size(px(10.))
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(if t.dark { tw("blue-400") } else { tw("blue-600") })
                                .child(count.to_string()),
                        )
                    })
                    .on_click(cx.listener(|this, _, window, cx| this.open_filter_panel(window, cx))),
            );
        let sort_label = if sorted { "Sorted by 1 rule".to_string() } else { "Sort".into() };
        div()
            .flex()
            .items_center()
            .gap_2()
            .child(
                div()
                    .flex()
                    .items_center()
                    .child(filter_btn)
                    .when(filtered, |d| {
                        d.child(
                            Button::new("clear-filters")
                                .outline()
                                .size(ButtonSize::IconSm)
                                .icon(IconName::X)
                                .on_click(cx.listener(|this, _, window, cx| this.clear_filters(window, cx))),
                        )
                    }),
            )
            .child(
                div().relative().child(popup::bounds_tracker(st)).child(
                    Self::toolbar_btn("sort-btn", IconName::ArrowUpDown, sort_label)
                        .when(sorted, |b| b.colors(with_alpha(tw("blue-500"), 0.1), with_alpha(tw("blue-500"), 0.15), tw("blue-500")))
                        .on_click(cx.listener(|this, _, _, cx| this.open_sort_panel(cx))),
                ),
            )
            .into_any_element()
    }

    fn render_saved_views(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let scoped: Vec<SavedView> =
            self.toolbar.views.iter().filter(|v| v.table == self.table.name && v.schema == self.table.schema).cloned().collect();
        let label = if scoped.is_empty() { "Views".to_string() } else { format!("Views ({})", scoped.len()) };
        let this = cx.entity().downgrade();
        Popover::new("saved-views")
            .align(Align::End)
            .w(Some(256.))
            .p(8.)
            .trigger(Self::toolbar_btn("views-btn", IconName::Bookmark, label))
            .content(move |ctl, window, cx| {
                let t = cx.tokens().clone();
                let scoped = scoped.clone();
                let this = this.clone();
                let ctl = ctl.clone();
                let _ = window;
                div()
                    .child(
                        div()
                            .mb_2()
                            .px_1()
                            .flex()
                            .items_center()
                            .justify_between()
                            .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child("Saved views"))
                            .child(Button::new("save-current").ghost().size(ButtonSize::Sm).icon(IconName::Plus).label("Save current").on_click({
                                let (this, ctl) = (this.clone(), ctl.clone());
                                move |_, window, cx| {
                                    ctl.close(window, cx);
                                    this.update(cx, |this, cx| this.open_save_view_dialog(window, cx)).ok();
                                }
                            })),
                    )
                    .children(if scoped.is_empty() {
                        vec![div().px_1().py_3().tw_text_xs().text_color(t.muted_foreground).child("No saved views for this table yet.").into_any_element()]
                    } else {
                        scoped
                            .into_iter()
                            .enumerate()
                            .map(|(i, v)| {
                                let (apply, del) = (v.clone(), v.id.clone());
                                let (this_a, this_d, ctl_a) = (this.clone(), this.clone(), ctl.clone());
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_1()
                                    .rounded(px(4.))
                                    .px_1()
                                    .hover(|s| s.bg(t.muted))
                                    .child(
                                        div()
                                            .id(("view", i))
                                            .flex_1()
                                            .min_w_0()
                                            .py_2()
                                            .tw_text_xs()
                                            .cursor_pointer()
                                            .flex()
                                            .child(v.name.clone())
                                            .child(div().ml_2().text_color(t.muted_foreground).child(if v.filter.is_empty() { "All rows" } else { "Filtered" }))
                                            .on_click(move |_, window, cx| {
                                                ctl_a.close(window, cx);
                                                let apply = apply.clone();
                                                this_a
                                                    .update(cx, |this, cx| this.apply_filter_sort(apply.filter.clone(), apply.sort.first().cloned(), cx))
                                                    .ok();
                                            }),
                                    )
                                    .child(Button::new(("view-del", i)).ghost().size(ButtonSize::IconSm).icon(IconName::Trash).on_click(move |_, _, cx| {
                                        let del = del.clone();
                                        this_d
                                            .update(cx, |this, cx| {
                                                this.toolbar.views.retain(|v| v.id != del);
                                                this.persist_views();
                                                cx.notify();
                                            })
                                            .ok();
                                    }))
                                    .into_any_element()
                            })
                            .collect()
                    })
            })
            .into_any_element()
    }

    fn open_save_view_dialog(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let input = cx.new(|cx| InputState::new(window, cx).placeholder("View name"));
        input.update(cx, |s, cx| s.focus(window, cx));
        self.toolbar.view_name = Some(input.clone());
        let this = cx.entity().downgrade();
        let desc = format!("Save the current filters and sorting for {}.{}.", self.table.schema, self.table.name);
        rexa_ui::open_dialog(cx, move |_, _| {
            let (this_save, input2) = (this.clone(), input.clone());
            rexa_ui::Dialog::new()
                .title("Save table view")
                .child(div().tw_text_sm().child(desc.clone()))
                .child(TextInput::new(&input))
                .footer(
                    div()
                        .flex()
                        .gap_2()
                        .justify_end()
                        .child(Button::new("view-cancel").outline().label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                        .child(Button::new("view-save").label("Save view").on_click(move |_, _, cx| {
                            let name = input2.read(cx).value().trim().to_string();
                            if name.is_empty() {
                                return;
                            }
                            this_save
                                .update(cx, |this, cx| {
                                    let id = format!("{:x}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos());
                                    this.toolbar.views.push(SavedView {
                                        id,
                                        name,
                                        table: this.table.name.clone(),
                                        schema: this.table.schema.clone(),
                                        filter: this.filter_query.clone(),
                                        sort: this.sort.iter().cloned().collect(),
                                    });
                                    this.persist_views();
                                    cx.notify();
                                })
                                .ok();
                            rexa_ui::close_top(cx);
                        })),
                )
        });
    }

    fn render_columns_menu(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let names = self.column_names();
        let hidden = self.hidden.clone();
        let this = cx.entity().downgrade();
        DropdownMenu::new("columns-menu")
            .align(Align::Start)
            .trigger(Self::toolbar_btn("columns-btn", IconName::LayoutGrid, "Columns"))
            .menu(move |m, _, _| {
                let mut m = m.w(192.).label("Visible Columns").separator();
                for n in &names {
                    let (this, n2) = (this.clone(), n.clone());
                    m = m.item(MenuItem::checkbox(n.clone(), !hidden.contains(n)).text_xs().on_select(move |_, cx| {
                        let n2 = n2.clone();
                        this.update(cx, |this, cx| this.toggle_column(&n2, cx)).ok();
                    }));
                }
                let this = this.clone();
                m.separator().item(MenuItem::new("Show all columns").text_xs().on_select(move |_, cx| {
                    this.update(cx, |this, cx| this.show_all_columns(cx)).ok();
                }))
            })
            .into_any_element()
    }

    fn render_global_actions(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let loading = self.loading || self.fetching_structure;
        let this = cx.entity().downgrade();
        let current = self.auto_refresh_ms;
        div()
            .flex()
            .items_center()
            .gap_2()
            .when(self.kind != rexa_drivers::Kind::SpacetimeDb, |d| {
                d.child(Self::toolbar_btn("insert-btn", IconName::Plus, "Insert").on_click(cx.listener(|this, _, window, cx| this.open_insert_sheet(window, cx))))
            })
            .child(
                div()
                    .flex()
                    .items_center()
                    .child(
                        Self::toolbar_btn("refresh-btn", IconName::RefreshCw, "Refresh")
                            .selected(loading)
                            .on_click(cx.listener(|this, _, _, cx| this.refresh_current_tab(cx))),
                    )
                    .child(
                        DropdownMenu::new("auto-refresh")
                            .align(Align::End)
                            .trigger(Button::new("auto-refresh-btn").outline().size(ButtonSize::Sm).icon(IconName::ChevronDown))
                            .menu(move |m, _, _| {
                                let mut m = m.w(192.).label("Auto-refresh").separator();
                                for (label, ms) in [("Off", 0u64), ("5 seconds", 5000), ("10 seconds", 10000), ("30 seconds", 30000), ("1 minute", 60000), ("5 minutes", 300000)] {
                                    let this = this.clone();
                                    let mut item = MenuItem::new(label).text_xs().on_select(move |_, cx| {
                                        this.update(cx, |this, cx| this.set_auto_refresh(ms, cx)).ok();
                                    });
                                    if current == ms {
                                        item = item.shortcut("✓");
                                    }
                                    m = m.item(item);
                                }
                                m
                            }),
                    ),
            )
            .into_any_element()
    }

    fn render_selection_actions(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let n = self.selected_rows.len();
        let this = cx.entity().downgrade();
        let fmt_menu = |id: &'static str, icon: IconName, label: &'static str, title: &'static str, copy: bool| {
            let this = this.clone();
            DropdownMenu::new(id).align(Align::Start).trigger(Self::toolbar_btn(SharedString::from(format!("{id}-btn")), icon, label)).menu(move |m, _, _| {
                let mut m = m.w(192.).label(title);
                for (fmt, text, color, ic) in [
                    ("json", "JSON", "orange-500", IconName::FileBraces),
                    ("csv", if copy { "CSV (TSV)" } else { "CSV" }, "green-500", IconName::FileText),
                    ("sql", "SQL (Inserts)", "blue-500", IconName::Database),
                ] {
                    let this = this.clone();
                    m = m.item(MenuItem::new(text).leading(gpui_component::Icon::new(ic).size_4().text_color(tw(color))).on_select(move |_, cx| {
                        this.update(cx, |this, cx| if copy { this.copy_data(fmt, cx) } else { this.export_data(fmt, cx) }).ok();
                    }));
                }
                m
            })
        };
        let deleting = self.deleting;
        div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap_2()
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .pr_4()
                    .mr_2()
                    .border_r_1()
                    .border_color(t.border)
                    .child(Button::new("clear-sel").outline().size(ButtonSize::IconSm).icon(IconName::X).on_click(cx.listener(|this, _, _, cx| {
                        this.selected_rows.clear();
                        cx.notify();
                    })))
                    .child(div().tw_text_xs().text_color(tw("blue-500")).child(format!("{n} selected"))),
            )
            .child(fmt_menu("export-menu", IconName::Download, "Export", "Download format", false))
            .child(fmt_menu("copy-menu", IconName::Copy, "Copy", "Copy to clipboard", true))
            .child(
                Self::toolbar_btn("delete-rows", if deleting { IconName::LoaderCircle } else { IconName::Trash }, "Delete")
                    .colors(gpui::transparent_black(), with_alpha(tw("red-500"), 0.1), tw("red-500"))
                    .disabled(deleting)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let n = this.selected_rows.len();
                        let ok = rexa_ui::confirm(
                            rexa_ui::ConfirmOptions::destructive(format!("Delete {n} rows?"))
                                .description("Are you sure you want to delete the selected rows? This action cannot be undone.")
                                .confirm_text("Delete"),
                            cx,
                        );
                        cx.spawn(async move |this, cx| {
                            if ok.await {
                                this.update(cx, |this, cx| this.delete_selected_rows(cx)).ok();
                            }
                        })
                        .detach();
                    })),
            )
            .into_any_element()
    }

    // ---- search bar ----------------------------------------------------------------------------------

    fn apply_suggestion(&mut self, apply: String, window: &mut Window, cx: &mut Context<Self>) {
        self.search_input.update(cx, |s, cx| {
            s.set_value(apply, window, cx);
            s.focus(window, cx);
        });
        self.toolbar.suggest_index = 0;
        cx.notify();
    }

    fn on_search_key(&mut self, ev: &gpui::KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let k = &ev.keystroke;
        let cmd = k.modifiers.platform || k.modifiers.control;
        if cmd && k.key == "f" {
            self.toolbar.assist_open = true;
            self.toolbar.suggest_index = 0;
            cx.stop_propagation();
            cx.notify();
            return;
        }
        let items = self.suggestions(cx);
        let showing = self.toolbar.assist_open && self.toolbar.search_focused && !items.is_empty();
        if showing {
            let n = items.len();
            match k.key.as_str() {
                "down" => self.toolbar.suggest_index = (self.toolbar.suggest_index + 1) % n,
                "up" => self.toolbar.suggest_index = (self.toolbar.suggest_index + n - 1) % n,
                "tab" => {
                    let item = items[self.toolbar.suggest_index.min(n - 1)].apply.clone();
                    self.apply_suggestion(item, window, cx);
                }
                "escape" => self.toolbar.assist_open = false,
                _ => return,
            }
            cx.stop_propagation();
            cx.notify();
        } else if k.key == "escape" {
            self.focus.focus(window, cx);
            cx.stop_propagation();
        }
    }

    fn suggestions(&self, cx: &App) -> Vec<filters::Suggestion> {
        if !self.toolbar.assist_open {
            return Vec::new();
        }
        filters::quick_suggestions(&self.search_query(cx), &self.column_names())
    }

    fn render_suggest(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let items = self.suggestions(cx);
        if !(self.toolbar.search_focused && !items.is_empty()) {
            return None;
        }
        let t = cx.tokens().clone();
        let bar = self.toolbar.bar.get();
        let active = self.toolbar.suggest_index.min(items.len() - 1);
        let kbd = |s: &'static str| div().border_1().border_color(t.border).bg(with_alpha(t.muted, 0.4)).px_1().font_family(rexa_ui::MONO).child(s);
        let panel = div()
            .id("search-suggest")
            .occlude()
            .w(bar.size.width + px(32.))
            .ml(px(-16.))
            .rounded_b(px(10.))
            .border_b_1()
            .border_color(t.border)
            .bg(t.background)
            .shadow(popup::shadow_md())
            .p_1()
            .child(div().max_h(px(224.)).flex().flex_col().children(items.into_iter().enumerate().map(|(i, item)| {
                let apply = item.apply.clone();
                let is_col = item.is_column;
                div()
                    .id(("suggest", i))
                    .flex()
                    .w_full()
                    .items_center()
                    .gap_2()
                    .tw_rounded_md()
                    .px_2()
                    .py(px(6.))
                    .tw_text_xs()
                    .cursor_pointer()
                    .when(i == active, |d| d.bg(t.accent).text_color(t.accent_foreground))
                    .when(i != active, |d| d.text_color(t.muted_foreground))
                    .child(
                        div()
                            .size_5()
                            .flex_shrink_0()
                            .flex()
                            .items_center()
                            .justify_center()
                            .rounded(px(4.))
                            .border_1()
                            .font_family(rexa_ui::MONO)
                            .text_size(px(10.))
                            .when(is_col, |d| d.border_color(t.border).bg(with_alpha(t.muted, 0.4)).text_color(t.foreground))
                            .when(!is_col, |d| d.border_color(with_alpha(t.primary, 0.3)).bg(with_alpha(t.primary, 0.1)).text_color(t.primary))
                            .child(if is_col { "T".to_string() } else { item.label.trim().chars().next().unwrap_or('=').to_string() }),
                    )
                    .child(div().font_family(rexa_ui::MONO).overflow_hidden().child(item.label.clone()))
                    .when(is_col, |d| d.child(div().ml_auto().text_size(px(10.)).opacity(0.6).child("column")))
                    .on_hover(cx.listener(move |this, h: &bool, _, cx| {
                        if *h {
                            this.toolbar.suggest_index = i;
                            cx.notify();
                        }
                    }))
                    .on_mouse_down(gpui::MouseButton::Left, cx.listener(move |this, _, window, cx| {
                        cx.stop_propagation();
                        this.apply_suggestion(apply.clone(), window, cx);
                    }))
            })))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_2()
                    .border_t_1()
                    .border_color(t.border)
                    .px_2()
                    .py(px(6.))
                    .text_size(px(10.))
                    .text_color(t.muted_foreground)
                    .child(kbd("Tab"))
                    .child("complete")
                    .child(kbd("Enter"))
                    .child("filter")
                    .child(kbd("Esc"))
                    .child("close"),
            );
        Some(popup::floating(bar, Side::Bottom, Align::Start, 0., 0., panel))
    }

    fn render_hints(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let has_text = !self.search_query(cx).trim().is_empty();
        let chip = |id: &'static str, text: &'static str, primary: bool| {
            div()
                .id(id)
                .flex()
                .flex_shrink_0()
                .items_center()
                .gap_1()
                .rounded(px(4.))
                .border_1()
                .px_1()
                .py(px(2.))
                .font_family(rexa_ui::MONO)
                .text_size(px(10.))
                .line_height(px(15.))
                .whitespace_nowrap()
                .cursor_pointer()
                .when(!primary, |d| d.border_color(t.border).bg(with_alpha(t.muted, 0.4)).text_color(t.muted_foreground).hover(|s| s.text_color(t.foreground)))
                .when(primary, |d| {
                    d.border_color(with_alpha(t.primary, 0.3)).bg(with_alpha(t.primary, 0.1)).text_color(t.primary).hover(|s| s.bg(with_alpha(t.primary, 0.2)))
                })
                .child(text)
        };
        div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap_1()
            .child(chip("hint-filter", "⌘F for filtering", false).on_mouse_down(
                gpui::MouseButton::Left,
                cx.listener(|this, _, _, cx| {
                    cx.stop_propagation();
                    this.toolbar.assist_open = !this.toolbar.assist_open;
                    this.toolbar.suggest_index = 0;
                    cx.notify();
                }),
            ))
            .child(chip("hint-ai", "⌘↩ for AI filter", true).when(!has_text, |d| d.opacity(0.5)).on_mouse_down(
                gpui::MouseButton::Left,
                cx.listener(|this, _, window, cx| {
                    cx.stop_propagation();
                    this.create_ai_filter(window, cx);
                }),
            ))
            .into_any_element()
    }

    fn render_scope_menu(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let scope = self.search_scope;
        let supports = !matches!(self.kind, rexa_drivers::Kind::MongoDb | rexa_drivers::Kind::Redis);
        let this = cx.entity().downgrade();
        let t = cx.tokens().clone();
        DropdownMenu::new("search-scope")
            .align(Align::End)
            .trigger(
                div()
                    .id("scope-btn")
                    .h_7()
                    .px(px(6.))
                    .flex()
                    .items_center()
                    .tw_rounded_md()
                    .font_family(rexa_ui::MONO)
                    .text_size(px(10.))
                    .text_color(t.muted_foreground)
                    .cursor_pointer()
                    .hover(|s| s.bg(t.accent).text_color(t.foreground))
                    .child(if scope == SearchScope::Table { "table" } else { "page" }),
            )
            .menu(move |m, _, _| {
                let (a, b) = (this.clone(), this.clone());
                m.w(160.)
                    .label("Search Scope")
                    .item(MenuItem::radio("This page", scope == SearchScope::Page).text_xs().on_select(move |_, cx| {
                        a.update(cx, |this, cx| this.set_search_scope(SearchScope::Page, cx)).ok();
                    }))
                    .when(supports, |m| {
                        m.item(MenuItem::radio("Whole table", scope == SearchScope::Table).text_xs().on_select(move |_, cx| {
                            b.update(cx, |this, cx| this.set_search_scope(SearchScope::Table, cx)).ok();
                        }))
                    })
            })
            .into_any_element()
    }

    /// `countFittingItems` with the original's measured widths (approximated per item).
    fn fitting_items(&self, ids: &[&'static str], available: f32) -> usize {
        let width = |id: &str| match id {
            "filter" => {
                (if self.filter_query.trim().is_empty() { 70. } else { 112. }) + 8. + if self.sort.is_some() { 132. } else { 64. }
            }
            "views" => 76.,
            "columns" => 88.,
            _ => 160. + 22.,
        };
        let widths: Vec<f32> = ids.iter().map(|i| width(i)).collect();
        let total: f32 = widths.iter().enumerate().map(|(i, w)| w + if i > 0 { GAP } else { 0. }).sum();
        if total <= available {
            return widths.len();
        }
        let mut used = MORE_BUTTON_WIDTH;
        let mut count = 0;
        for w in widths {
            let next = used + w + if count > 0 { GAP } else { 0. };
            if next > available {
                break;
            }
            used = next;
            count += 1;
        }
        count
    }

    pub(crate) fn render_toolbar(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let selecting = !self.selected_rows.is_empty();
        let search_min = if selecting { SEARCH_MIN_WIDTH_SELECTING } else { SEARCH_MIN_WIDTH };
        let expanded = self.toolbar.expanded;
        let all_ids: [&'static str; 4] = ["filter", "views", "columns", "actions"];
        let ids: Vec<&'static str> = all_ids.into_iter().filter(|i| !self.toolbar.hidden_items.iter().any(|h| h == i)).collect();
        let bar_w = f32::from(self.toolbar.bar.get().size.width);
        let lead = if selecting { 380. + GAP } else { 0. };
        let available = bar_w - search_min - GAP - 36. - lead;
        let visible = if expanded || bar_w <= 0. { ids.len() } else { self.fitting_items(&ids, available) };
        let overflowing = !expanded && visible < ids.len();
        let mut items: Vec<AnyElement> = Vec::new();
        for (i, id) in ids.iter().enumerate() {
            let content = match *id {
                "filter" => {
                    if selecting {
                        continue;
                    }
                    self.render_filter_sort(cx)
                }
                "views" => self.render_saved_views(cx),
                "columns" => self.render_columns_menu(cx),
                _ => self.render_global_actions(cx),
            };
            if i < visible {
                items.push(div().flex().items_center().gap_2().flex_shrink_0().child(content).into_any_element());
            }
        }
        let focused = self.toolbar.search_focused;
        let layout_menu_items: Vec<(&'static str, &'static str, bool)> = [
            ("filter", "Filter and sort"),
            ("views", "Saved views"),
            ("columns", "Columns"),
            ("actions", "Table actions"),
        ]
        .into_iter()
        .map(|(id, label)| (id, label, !self.toolbar.hidden_items.iter().any(|h| h == id)))
        .collect();
        let this = cx.entity().downgrade();
        let actions_group = rexa_ui::ContextMenu::new("toolbar-layout")
            .menu(move |m, _, _| {
                let mut m = m;
                for (id, label, checked) in &layout_menu_items {
                    let (this, id) = (this.clone(), *id);
                    m = m.item(MenuItem::checkbox(*label, *checked).on_select(move |_, cx| {
                        this.update(cx, |this, cx| this.toggle_toolbar_item(id, cx)).ok();
                    }));
                }
                m
            })
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .items_center()
                    .gap_2()
                    .when(expanded, |d| d.flex_wrap())
                    .when(expanded, |d| {
                        d.child(
                            Button::new("back-to-search")
                                .outline()
                                .size(ButtonSize::Sm)
                                .icon(IconName::ChevronLeft)
                                .child(gpui_component::Icon::new(IconName::Search).size_3p5())
                                .on_click(cx.listener(|this, _, window, cx| {
                                    this.toolbar.expanded = false;
                                    this.search_input.update(cx, |s, cx| s.focus(window, cx));
                                    cx.notify();
                                })),
                        )
                    })
                    .when(selecting, |d| d.child(self.render_selection_actions(cx)))
                    .children(items)
                    .when(overflowing, |d| {
                        d.child(Button::new("more-actions").outline().size(ButtonSize::Sm).icon(IconName::Ellipsis).on_click(cx.listener(|this, _, _, cx| {
                            this.toolbar.expanded = true;
                            cx.notify();
                        })))
                    }),
            );
        let search = div()
            .relative()
            .h_12()
            .min_w_24()
            .flex_shrink(1.)
            .flex_grow(1.)
            .flex_basis(px(search_min))
            .when(expanded, |d| d.hidden())
            .when(!expanded, |d| d.flex())
            .items_center()
            .capture_key_down(cx.listener(Self::on_search_key))
            .child(div().flex_1().min_w_0().tw_text_sm().child(gpui_component::input::Input::new(&self.search_input).appearance(false)))
            .when(focused && bar_w >= 264. + 64. + search_min * 0., |d| d.child(self.render_hints(cx)));
        let bar = div()
            .relative()
            .flex()
            .min_h_12()
            .min_w_0()
            .flex_1()
            .flex_nowrap()
            .items_center()
            .gap_x_2()
            .bg(t.background)
            .child(popup::bounds_tracker(self.toolbar.bar.clone()))
            .child(search)
            .child(
                div()
                    .flex()
                    .min_w_0()
                    .flex_wrap()
                    .items_center()
                    .gap_1()
                    .py(px(6.))
                    .when(expanded, |d| d.flex_grow(1.))
                    .when(!expanded, |d| d.child(self.render_scope_menu(cx)))
                    .child(actions_group),
            );
        let _ = window;
        div()
            .relative()
            .min_h_12()
            .flex_shrink_0()
            .border_b_1()
            .border_color(t.border)
            .bg(t.studio_bg)
            .child(div().flex().min_h_12().min_w_0().items_center().px_4().child(bar))
            .children(self.render_suggest(cx))
            .children(self.render_filter_panel(cx))
            .children(self.render_sort_panel(cx))
    }
}

#[allow(dead_code)]
fn _unused(_: Hsla, _: Toast) {}
