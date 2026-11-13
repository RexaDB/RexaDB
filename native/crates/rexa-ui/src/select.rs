//! Ports of the option pickers:
//! - components/ui/select.tsx (`Select`; `SelectContent` shows its search box
//!   when `options >= searchThreshold`, default 0 = always, and then uses
//!   popper positioning 10px below the trigger; otherwise Radix "item-aligned"
//!   positioning puts the selected row over the trigger)
//! - components/ui/select-with-search.tsx (`Select::with_search`, threshold 10)
//! - components/ui/combobox.tsx (`Combobox`) and components/ui/searchable-select.tsx
//!   (`Combobox::searchable`)
//! - components/ui/multi-select.tsx (`MultiSelect`)
//!
//! All are controlled: pass `value(s)` and handle `on_change`. Keyboard: ↑/↓
//! move, Enter picks, Esc closes; typing filters.

use crate::popup::{self, Align, PopupState, Side};
use crate::theme::{white, with_alpha};
use crate::{ActiveTokens, IconName, Tw};
use gpui::{
    div, img, prelude::*, px, AnyElement, App, ElementId, Entity, Hsla, ImageSource, KeyDownEvent,
    MouseButton, Pixels, Point, SharedString, Window,
};
use gpui_component::input::{Input, InputState};
use gpui_component::Icon;
use std::collections::HashSet;
use std::rc::Rc;

#[derive(Clone)]
pub struct SelectOption {
    pub value: SharedString,
    pub label: SharedString,
    pub icon: Option<IconName>,
    pub image: Option<ImageSource>,
    pub disabled: bool,
}

impl SelectOption {
    pub fn new(value: impl Into<SharedString>, label: impl Into<SharedString>) -> Self {
        Self { value: value.into(), label: label.into(), icon: None, image: None, disabled: false }
    }
    /// value == label
    pub fn simple(v: impl Into<SharedString>) -> Self {
        let v = v.into();
        Self::new(v.clone(), v)
    }
    pub fn icon(mut self, i: IconName) -> Self {
        self.icon = Some(i);
        self
    }
    /// `<img className="w-4 h-4 rounded-lg object-contain">` (provider logos).
    pub fn image(mut self, src: impl Into<ImageSource>) -> Self {
        self.image = Some(src.into());
        self
    }
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
}

/// `SelectItem` / `SelectLabel` / `SelectSeparator`.
#[derive(Clone)]
pub enum SelectEntry {
    Item(SelectOption),
    Label(SharedString),
    Separator,
}

impl From<SelectOption> for SelectEntry {
    fn from(o: SelectOption) -> Self {
        SelectEntry::Item(o)
    }
}

type OnChange = Rc<dyn Fn(SharedString, &mut Window, &mut App)>;

/// select.tsx's `matchesSelectQuery`.
pub fn matches_select_query(label: &str, query: &str) -> bool {
    if query.is_empty() {
        return true;
    }
    let l = label.to_lowercase();
    if l.starts_with(query) || (query.chars().count() >= 2 && l.contains(query)) {
        return true;
    }
    query.chars().count() == 1
        && l.split(|c: char| !c.is_ascii_alphanumeric()).filter(|t| !t.is_empty()).any(|t| t.starts_with(query))
}

/// Search + highlight state shared by every picker.
struct PickerState {
    query: Entity<InputState>,
    highlighted: Option<usize>,
}

fn picker_state(id: &ElementId, placeholder: SharedString, window: &mut Window, cx: &mut App) -> Entity<PickerState> {
    window.use_keyed_state(popup::sub_id(id, "picker"), cx, move |window, cx| PickerState {
        query: cx.new(|cx| InputState::new(window, cx).placeholder(placeholder)),
        highlighted: None,
    })
}

fn open_picker(popup: &Entity<PopupState>, picker: &Entity<PickerState>, search: bool, highlight: Option<usize>, window: &mut Window, cx: &mut App) {
    let opening = !popup.read(cx).open;
    popup.update(cx, |s, cx| s.toggle(window, cx));
    if opening {
        let query = picker.read(cx).query.clone();
        query.update(cx, |q, cx| q.set_value("", window, cx));
        picker.update(cx, |p, _| p.highlighted = highlight);
        if search {
            query.update(cx, |q, cx| q.focus(window, cx));
        }
    }
}

/// Keyboard handling over the visible, enabled rows. Returns the row to pick on Enter.
fn picker_keys(
    e: &KeyDownEvent,
    picker: &Entity<PickerState>,
    popup: &Entity<PopupState>,
    selectable: &[usize],
    on_pick: &dyn Fn(usize, &mut Window, &mut App),
    window: &mut Window,
    cx: &mut App,
) -> bool {
    let cur = picker.read(cx).highlighted.and_then(|h| selectable.iter().position(|&s| s == h));
    let set = |ix: Option<usize>, cx: &mut App| picker.update(cx, |p, cx| {
        p.highlighted = ix;
        cx.notify();
    });
    let n = selectable.len();
    match e.keystroke.key.as_str() {
        "down" if n > 0 => set(Some(selectable[cur.map_or(0, |c| (c + 1).min(n - 1))]), cx),
        "up" if n > 0 => set(Some(selectable[cur.map_or(n - 1, |c| c.saturating_sub(1))]), cx),
        "enter" => {
            if let Some(h) = picker.read(cx).highlighted {
                on_pick(h, window, cx);
            }
        }
        "escape" => popup.update(cx, |s, cx| s.hide(window, cx)),
        _ => return false,
    }
    true
}

fn option_leading(o: &SelectOption) -> Option<AnyElement> {
    if let Some(src) = o.image.clone() {
        return Some(img(src).size_4().tw_rounded_lg().flex_shrink_0().into_any_element());
    }
    o.icon.map(|i| Icon::new(i).size_4().flex_shrink_0().into_any_element())
}

// ---- Select --------------------------------------------------------------------------

#[derive(IntoElement)]
pub struct Select {
    id: ElementId,
    entries: Vec<SelectEntry>,
    value: Option<SharedString>,
    placeholder: SharedString,
    on_change: Option<OnChange>,
    small: bool,
    w: Option<Pixels>,
    full_width: bool,
    search_threshold: usize,
    search_placeholder: SharedString,
    empty_text: SharedString,
    disabled: bool,
    wide_items: bool,
    content_w: Option<f32>,
}

impl Select {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            entries: Vec::new(),
            value: None,
            placeholder: "".into(),
            on_change: None,
            small: false,
            w: None,
            full_width: false,
            search_threshold: 0,
            search_placeholder: "Search options...".into(),
            empty_text: "No options found.".into(),
            disabled: false,
            wide_items: false,
            content_w: None,
        }
    }
    /// select-with-search.tsx: threshold 10, "Search...", items `py-1.5 pl-2.5 pr-7`.
    pub fn with_search(id: impl Into<ElementId>) -> Self {
        Self { search_threshold: 10, search_placeholder: "Search...".into(), wide_items: true, ..Self::new(id) }
    }
    pub fn options(mut self, options: impl IntoIterator<Item = SelectOption>) -> Self {
        self.entries.extend(options.into_iter().map(SelectEntry::Item));
        self
    }
    pub fn entries(mut self, entries: impl IntoIterator<Item = SelectEntry>) -> Self {
        self.entries.extend(entries);
        self
    }
    pub fn value(mut self, v: Option<impl Into<SharedString>>) -> Self {
        self.value = v.map(Into::into);
        self
    }
    /// `SelectValue placeholder`
    pub fn placeholder(mut self, p: impl Into<SharedString>) -> Self {
        self.placeholder = p.into();
        self
    }
    pub fn on_change(mut self, f: impl Fn(SharedString, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(f));
        self
    }
    /// `size="sm"` (h-7).
    pub fn small(mut self) -> Self {
        self.small = true;
        self
    }
    pub fn w(mut self, w: impl Into<Pixels>) -> Self {
        self.w = Some(w.into());
        self
    }
    pub fn w_full(mut self) -> Self {
        self.full_width = true;
        self
    }
    /// `searchThreshold` (show the search box when there are at least this many items).
    pub fn search_threshold(mut self, n: usize) -> Self {
        self.search_threshold = n;
        self
    }
    pub fn search_placeholder(mut self, p: impl Into<SharedString>) -> Self {
        self.search_placeholder = p.into();
        self
    }
    pub fn empty_text(mut self, p: impl Into<SharedString>) -> Self {
        self.empty_text = p.into();
        self
    }
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
    /// Fixed content width (`className="w-…"` on SelectContent).
    pub fn content_w(mut self, w: f32) -> Self {
        self.content_w = Some(w);
        self
    }
}

/// `SelectTrigger` look (rexa-raised in dark themes).
fn trigger_colors(t: &crate::Tokens, hovered: bool) -> (Hsla, Hsla) {
    let base = if t.dark { with_alpha(t.input, if hovered { 0.5 } else { 0.3 }) } else { gpui::transparent_black() };
    if t.dark {
        // .rexa-raised: white/20 border + sheen
        (white(0.2), crate::button::overlay(base, if hovered { 0.08 } else { 0.0525 }))
    } else {
        (t.input, base)
    }
}

impl RenderOnce for Select {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let state = PopupState::keyed(self.id.clone(), window, cx);
        let picker = picker_state(&self.id, self.search_placeholder.clone(), window, cx);
        let (open, bounds, generation) = {
            let s = state.read(cx);
            (s.open, s.trigger.clone(), s.generation)
        };
        let item_count = self.entries.iter().filter(|e| matches!(e, SelectEntry::Item(_))).count();
        let show_search = item_count >= self.search_threshold;
        let selected_ix = self.entries.iter().position(|e| matches!(e, SelectEntry::Item(o) if Some(&o.value) == self.value.as_ref()));
        let selected = selected_ix.and_then(|i| match &self.entries[i] {
            SelectEntry::Item(o) => Some(o.clone()),
            _ => None,
        });

        // Trigger.
        let (border, bg) = trigger_colors(&t, false);
        let (_, hover_bg) = trigger_colors(&t, true);
        let st = state.clone();
        let pk = picker.clone();
        let mut trigger = div()
            .id(self.id.clone())
            .relative()
            .flex()
            .items_center()
            .justify_between()
            .gap(px(6.))
            .h(px(if self.small { 28. } else { 32. }))
            .pl(px(10.))
            .pr_2()
            .rounded(px(if self.small { 8. } else { 10. }))
            .border_1()
            .border_color(border)
            .bg(bg)
            .tw_text_sm()
            .whitespace_nowrap()
            .when(t.dark, |d| d.shadow(vec![gpui::BoxShadow {
                color: gpui::hsla(222. / 360., 0.2, 0.08, 0.24),
                offset: gpui::point(px(0.), px(1.)),
                blur_radius: px(2.),
                spread_radius: px(0.),
                inset: false,
            }]))
            .when_some(self.w, |d, w| d.w(w))
            .when(self.full_width, |d| d.w_full())
            .child(popup::bounds_tracker(bounds.clone()))
            .child(match &selected {
                Some(o) => div()
                    .flex()
                    .items_center()
                    .gap(px(6.))
                    .min_w_0()
                    .overflow_hidden()
                    .children(option_leading(o))
                    .child(o.label.clone())
                    .into_any_element(),
                None => div().text_color(t.muted_foreground).child(self.placeholder.clone()).into_any_element(),
            })
            .child(Icon::new(IconName::ChevronDown).size_4().text_color(t.muted_foreground));
        if self.disabled {
            trigger = trigger.opacity(0.5);
        } else {
            trigger = trigger.cursor_pointer().hover(move |s| s.bg(hover_bg)).on_mouse_down(MouseButton::Left, move |_, window, cx| {
                open_picker(&st, &pk, show_search, selected_ix, window, cx);
            });
        }
        if !open {
            return trigger;
        }

        // Content.
        let query = picker.read(cx).query.read(cx).value().trim().to_lowercase();
        let highlighted = picker.read(cx).highlighted;
        let mut rows = Vec::new();
        let mut selectable = Vec::new();
        let mut values = Vec::new();
        let mut any_match = false;
        for (ix, e) in self.entries.iter().enumerate() {
            values.push(match e {
                SelectEntry::Item(o) => Some(o.value.clone()),
                _ => None,
            });
            match e {
                SelectEntry::Item(o) => {
                    if show_search && !matches_select_query(&o.label, &query) {
                        continue;
                    }
                    any_match = true;
                    if !o.disabled {
                        selectable.push(ix);
                    }
                    let is_sel = Some(&o.value) == self.value.as_ref();
                    let hl = highlighted == Some(ix);
                    let pk = picker.clone();
                    let (st, change, value) = (state.clone(), self.on_change.clone(), o.value.clone());
                    rows.push(
                        div()
                            .id(ix)
                            .relative()
                            .flex()
                            .w_full()
                            .items_center()
                            .gap_2()
                            .py(px(6.))
                            .pl(px(if self.wide_items { 10. } else { 8. }))
                            .pr(px(if self.wide_items { 28. } else { 32. }))
                            .tw_rounded_lg()
                            .tw_text_xs()
                            .when(hl, |d| d.bg(t.accent).text_color(t.accent_foreground))
                            .when(o.disabled, |d| d.opacity(0.5))
                            .children(option_leading(o))
                            .child(o.label.clone())
                            .when(is_sel, |d| {
                                d.child(div().absolute().right_2().size_4().flex().items_center().justify_center().child(Icon::new(IconName::Check).size_4()))
                            })
                            .when(!o.disabled, |d| {
                                d.on_hover(move |h, _, cx| {
                                    if *h {
                                        pk.update(cx, |p, cx| {
                                            p.highlighted = Some(ix);
                                            cx.notify();
                                        })
                                    }
                                })
                                .on_click(move |_, window, cx| {
                                    st.update(cx, |s, cx| s.hide(window, cx));
                                    if let Some(f) = &change {
                                        f(value.clone(), window, cx);
                                    }
                                })
                            })
                            .into_any_element(),
                    );
                }
                SelectEntry::Label(l) if query.is_empty() => {
                    rows.push(div().px(px(6.)).py_1().tw_text_xs().text_color(t.muted_foreground).child(l.clone()).into_any_element())
                }
                SelectEntry::Separator if query.is_empty() => {
                    rows.push(div().h(px(1.)).my_1().bg(t.border).into_any_element())
                }
                _ => {}
            }
        }
        let trigger_w = f32::from(bounds.get().size.width);
        let pick: Rc<dyn Fn(usize, &mut Window, &mut App)> = {
            let (st, change) = (state.clone(), self.on_change.clone());
            Rc::new(move |ix, window, cx| {
                st.update(cx, |s, cx| s.hide(window, cx));
                if let (Some(f), Some(Some(v))) = (&change, values.get(ix)) {
                    f(v.clone(), window, cx);
                }
            })
        };
        let (pk, st_key, st_out, focus) = (picker.clone(), state.clone(), state.clone(), state.read(cx).focus.clone());
        let trig = bounds.clone();
        let panel = div()
            .id("select-content")
            .track_focus(&focus)
            .flex()
            .flex_col()
            .min_w(px(trigger_w.max(144.)))
            .when_some(self.content_w, |d, w| d.w(px(w)))
            .max_h(px(320.))
            .tw_rounded_lg()
            .bg(t.popover)
            .text_color(t.var_or("--popover-foreground", t.foreground))
            .shadow(popup::with_ring(popup::shadow_md(), t.border))
            .overflow_hidden()
            .occlude()
            .capture_key_down(move |e, window, cx| {
                if picker_keys(e, &pk, &st_key, &selectable, &*pick, window, cx) {
                    cx.stop_propagation();
                }
            })
            .on_mouse_down_out(move |e, window, cx| {
                if !trig.get().contains(&e.position) {
                    st_out.update(cx, |s, cx| s.hide(window, cx));
                }
            })
            .when(show_search, |d| {
                // border-b px-2 py-1; input h-5 text-xs placeholder:text-muted-foreground/70
                d.child(
                    div().flex_shrink_0().px_2().py_1().border_b_1().border_color(t.border).child(
                        div().h_5().mx(px(-crate::controls::INPUT_PX)).tw_text_xs().child(
                            Input::new(&picker.read(cx).query).appearance(false).h(px(20.)),
                        ),
                    ),
                )
            })
            .child(
                div()
                    .id("select-viewport")
                    .flex()
                    .flex_col()
                    .overflow_y_scroll()
                    .children(rows)
                    .when(show_search && !query.is_empty() && !any_match, |d| {
                        d.child(div().px_3().py_2().tw_text_xs().text_color(t.muted_foreground).child(self.empty_text.clone()))
                    }),
            );
        let floating = if show_search {
            // popper: align start, sideOffset 6, plus `translate-y-1`.
            let panel = popup::animate_in(div().child(panel), popup::sub_id(&self.id, generation), Side::Bottom, 100);
            popup::floating(bounds.get(), Side::Bottom, Align::Start, 10., 0., panel)
        } else {
            // item-aligned: the selected row sits over the trigger, its text over the value.
            let b = bounds.get();
            let row_ix = selected_ix.map_or(0, |i| self.entries[..i].iter().filter(|e| matches!(e, SelectEntry::Item(_))).count());
            let row_h = 28.;
            let y = f32::from(b.center().y) - row_h * row_ix as f32 - row_h / 2.;
            popup::floating_at(Point { x: b.origin.x + px(3.), y: px(y.max(10.)) }, panel)
        };
        trigger.child(floating)
    }
}

// ---- Combobox ------------------------------------------------------------------------

/// combobox.tsx content (`ComboboxInput` h-9 search row, `ComboboxList` p-1,
/// items `px-2 py-1.5 pr-8 text-xs`), with searchable-select.tsx's trigger via
/// [`Combobox::searchable`] (`h-9 w-full rounded-lg border bg-muted/30 px-3 text-xs`).
#[derive(IntoElement)]
pub struct Combobox {
    id: ElementId,
    options: Vec<SelectOption>,
    value: Option<SharedString>,
    placeholder: SharedString,
    search_placeholder: SharedString,
    empty_text: SharedString,
    search_threshold: usize,
    on_change: Option<OnChange>,
    trigger: Option<AnyElement>,
    list_max_h: f32,
}

impl Combobox {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            options: Vec::new(),
            value: None,
            placeholder: "Select…".into(),
            search_placeholder: "Search...".into(),
            empty_text: "No options found.".into(),
            search_threshold: 0,
            on_change: None,
            trigger: None,
            list_max_h: 224.,
        }
    }
    /// searchable-select.tsx (`searchThreshold` default 0, "No options found.").
    pub fn searchable(id: impl Into<ElementId>) -> Self {
        Self::new(id)
    }
    pub fn options(mut self, o: impl IntoIterator<Item = SelectOption>) -> Self {
        self.options.extend(o);
        self
    }
    pub fn value(mut self, v: Option<impl Into<SharedString>>) -> Self {
        self.value = v.map(Into::into);
        self
    }
    pub fn placeholder(mut self, p: impl Into<SharedString>) -> Self {
        self.placeholder = p.into();
        self
    }
    pub fn search_placeholder(mut self, p: impl Into<SharedString>) -> Self {
        self.search_placeholder = p.into();
        self
    }
    pub fn empty_text(mut self, p: impl Into<SharedString>) -> Self {
        self.empty_text = p.into();
        self
    }
    pub fn search_threshold(mut self, n: usize) -> Self {
        self.search_threshold = n;
        self
    }
    /// Custom trigger instead of the searchable-select one.
    pub fn trigger(mut self, el: impl IntoElement) -> Self {
        self.trigger = Some(el.into_any_element());
        self
    }
    pub fn on_change(mut self, f: impl Fn(SharedString, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(f));
        self
    }
}

impl RenderOnce for Combobox {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let state = PopupState::keyed(self.id.clone(), window, cx);
        let picker = picker_state(&self.id, self.search_placeholder.clone(), window, cx);
        let (open, bounds, generation) = {
            let s = state.read(cx);
            (s.open, s.trigger.clone(), s.generation)
        };
        let show_search = self.options.len() >= self.search_threshold;
        let selected = self.options.iter().find(|o| Some(&o.value) == self.value.as_ref()).cloned();
        let (st, pk) = (state.clone(), picker.clone());
        let trigger_content = self.trigger.unwrap_or_else(|| {
            div()
                .flex()
                .items_center()
                .justify_between()
                .gap_2()
                .w_full()
                .h_9()
                .px_3()
                .tw_rounded_lg()
                .border_1()
                .border_color(t.border)
                .bg(with_alpha(t.muted, 0.3))
                .tw_text_xs()
                .child(
                    div().flex().items_center().gap_2().min_w_0().children(selected.as_ref().and_then(option_leading)).child(match &selected {
                        Some(o) => div().child(o.label.clone()),
                        None => div().text_color(t.muted_foreground).child(self.placeholder.clone()),
                    }),
                )
                .child(Icon::new(IconName::ChevronsUpDown).size_4().text_color(t.muted_foreground))
                .into_any_element()
        });
        let trigger = div()
            .id(self.id.clone())
            .relative()
            .w_full()
            .cursor_pointer()
            .child(popup::bounds_tracker(bounds.clone()))
            .child(trigger_content)
            .on_mouse_down(MouseButton::Left, move |_, window, cx| open_picker(&st, &pk, show_search, None, window, cx));
        if !open {
            return trigger;
        }
        let query = picker.read(cx).query.read(cx).value().trim().to_lowercase();
        let highlighted = picker.read(cx).highlighted;
        let visible: Vec<(usize, SelectOption)> = self
            .options
            .iter()
            .cloned()
            .enumerate()
            .filter(|(_, o)| !show_search || query.is_empty() || o.label.to_lowercase().contains(&query))
            .collect();
        let selectable: Vec<usize> = visible.iter().filter(|(_, o)| !o.disabled).map(|(i, _)| *i).collect();
        let values: Vec<SharedString> = self.options.iter().map(|o| o.value.clone()).collect();
        let rows = visible.into_iter().map(|(ix, o)| {
            let is_sel = Some(&o.value) == self.value.as_ref();
            let pk = picker.clone();
            let (st, change, value) = (state.clone(), self.on_change.clone(), o.value.clone());
            div()
                .id(ix)
                .relative()
                .flex()
                .w_full()
                .items_center()
                .gap_2()
                .px_2()
                .py(px(6.))
                .pr_8()
                .tw_rounded_lg()
                .tw_text_xs()
                .when(highlighted == Some(ix), |d| d.bg(t.accent).text_color(t.accent_foreground))
                .when(o.disabled, |d| d.opacity(0.5))
                .children(option_leading(&o))
                .child(o.label.clone())
                .when(is_sel, |d| d.child(div().absolute().right_2().size_4().flex().items_center().justify_center().child(Icon::new(IconName::Check).size_4())))
                .on_hover(move |h, _, cx| {
                    if *h {
                        pk.update(cx, |p, cx| {
                            p.highlighted = Some(ix);
                            cx.notify();
                        })
                    }
                })
                .on_click(move |_, window, cx| {
                    st.update(cx, |s, cx| s.hide(window, cx));
                    if let Some(f) = &change {
                        f(value.clone(), window, cx);
                    }
                })
        });
        let rows: Vec<_> = rows.collect();
        let empty = rows.is_empty();
        let pick: Rc<dyn Fn(usize, &mut Window, &mut App)> = {
            let (st, change) = (state.clone(), self.on_change.clone());
            Rc::new(move |ix, window, cx| {
                st.update(cx, |s, cx| s.hide(window, cx));
                if let (Some(f), Some(v)) = (&change, values.get(ix)) {
                    f(v.clone(), window, cx);
                }
            })
        };
        let (pk, st_key, st_out, focus) = (picker.clone(), state.clone(), state.clone(), state.read(cx).focus.clone());
        let trig = bounds.clone();
        let anchor_w = f32::from(bounds.get().size.width);
        let panel = div()
            .id("combobox-content")
            .track_focus(&focus)
            .flex()
            .flex_col()
            .min_w(px(anchor_w))
            .max_w(px(512.))
            .max_h(px(288.))
            .tw_rounded_lg()
            .bg(t.popover)
            .text_color(t.var_or("--popover-foreground", t.foreground))
            .shadow(popup::with_ring(popup::shadow_md(), t.border))
            .overflow_hidden()
            .occlude()
            .capture_key_down(move |e, window, cx| {
                if picker_keys(e, &pk, &st_key, &selectable, &*pick, window, cx) {
                    cx.stop_propagation();
                }
            })
            .on_mouse_down_out(move |e, window, cx| {
                if !trig.get().contains(&e.position) {
                    st_out.update(cx, |s, cx| s.hide(window, cx));
                }
            })
            .when(show_search, |d| {
                // InputGroup restyled: h-9, border-b border-border/40, control px-3 text-xs
                d.child(
                    div()
                        .flex_shrink_0()
                        .flex()
                        .items_center()
                        .h_9()
                        .px_3()
                        .border_b_1()
                        .border_color(with_alpha(t.border, 0.4))
                        .tw_text_xs()
                        .child(div().flex_1().mx(px(-crate::controls::INPUT_PX)).child(Input::new(&picker.read(cx).query).appearance(false))),
                )
            })
            .when(empty, |d| {
                d.child(div().flex().w_full().justify_center().py_2().tw_text_sm().text_color(t.muted_foreground).child(self.empty_text.clone()))
            })
            .when(!empty, |d| {
                d.child(div().id("combobox-list").flex().flex_col().p_1().max_h(px(self.list_max_h)).overflow_y_scroll().children(rows))
            });
        let panel = popup::animate_in(div().child(panel), popup::sub_id(&self.id, generation), Side::Bottom, 100);
        trigger.child(popup::floating(bounds.get(), Side::Bottom, Align::Start, 6., 0., panel))
    }
}

// ---- MultiSelect ---------------------------------------------------------------------

/// multi-select.tsx: an outline Button trigger ("N tables selected") opening a
/// popover (`p-0`, trigger width) with a search row, Select all / Deselect all,
/// and a checkbox list (`max-h-56`).
#[derive(IntoElement)]
pub struct MultiSelect {
    id: ElementId,
    options: Vec<SelectOption>,
    selected: HashSet<SharedString>,
    placeholder: SharedString,
    search_placeholder: SharedString,
    noun: (SharedString, SharedString),
    loading: bool,
    on_change: Option<Rc<dyn Fn(HashSet<SharedString>, &mut Window, &mut App)>>,
}

impl MultiSelect {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            options: Vec::new(),
            selected: HashSet::new(),
            placeholder: "Select tables...".into(),
            search_placeholder: "Search tables...".into(),
            noun: ("table".into(), "tables".into()),
            loading: false,
            on_change: None,
        }
    }
    pub fn options(mut self, o: impl IntoIterator<Item = SelectOption>) -> Self {
        self.options.extend(o);
        self
    }
    pub fn selected(mut self, s: impl IntoIterator<Item = SharedString>) -> Self {
        self.selected = s.into_iter().collect();
        self
    }
    pub fn placeholder(mut self, p: impl Into<SharedString>) -> Self {
        self.placeholder = p.into();
        self
    }
    pub fn search_placeholder(mut self, p: impl Into<SharedString>) -> Self {
        self.search_placeholder = p.into();
        self
    }
    /// Singular / plural for "N tables selected".
    pub fn noun(mut self, one: impl Into<SharedString>, many: impl Into<SharedString>) -> Self {
        self.noun = (one.into(), many.into());
        self
    }
    pub fn loading(mut self, l: bool) -> Self {
        self.loading = l;
        self
    }
    pub fn on_change(mut self, f: impl Fn(HashSet<SharedString>, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(f));
        self
    }
}

impl RenderOnce for MultiSelect {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let picker = picker_state(&self.id, self.search_placeholder.clone(), window, cx);
        let query = picker.read(cx).query.clone();
        let q = query.read(cx).value().to_lowercase();
        let n = self.selected.len();
        let label: SharedString = if n == 0 {
            self.placeholder.clone()
        } else {
            format!("{n} {} selected", if n == 1 { &self.noun.0 } else { &self.noun.1 }).into()
        };
        let options = self.options.clone();
        let selected = self.selected.clone();
        let change = self.on_change.clone();
        let loading = self.loading;
        let muted = n == 0;
        crate::Popover::new(self.id.clone())
            .w_full()
            .match_trigger_width()
            .p(0.)
            .align(Align::Start)
            .trigger(
                crate::Button::new(popup::sub_id(&self.id, "trigger"))
                    .outline()
                    .w_full()
                    .child(
                        div()
                            .flex()
                            .flex_1()
                            .items_center()
                            .justify_between()
                            .tw_text_sm()
                            .child(div().when(muted, |d| d.text_color(t.muted_foreground)).child(label))
                            .child(Icon::new(IconName::ChevronsUpDown).size(px(14.)).ml_2().opacity(0.5)),
                    ),
            )
            .content(move |_, _, cx| {
                let t = cx.tokens().clone();
                let filtered: Vec<SelectOption> =
                    options.iter().filter(|o| q.is_empty() || o.label.to_lowercase().contains(&q)).cloned().collect();
                let set = |next: HashSet<SharedString>, change: &Option<Rc<dyn Fn(HashSet<SharedString>, &mut Window, &mut App)>>, w: &mut Window, cx: &mut App| {
                    if let Some(f) = change {
                        f(next, w, cx)
                    }
                };
                let header = div()
                    .flex()
                    .items_center()
                    .border_b_1()
                    .border_color(t.border)
                    .px_3()
                    .child(Icon::new(IconName::Search).size_4().mr_2().flex_shrink_0().opacity(0.5))
                    .child(div().flex_1().h_9().tw_text_sm().mx(px(-crate::controls::INPUT_PX)).child(Input::new(&query).appearance(false).h(px(36.))));
                let (sel_all, desel) = (selected.clone(), selected.clone());
                let (vis_all, vis_none) = (filtered.clone(), filtered.clone());
                let (c1, c2) = (change.clone(), change.clone());
                let link = |id: &'static str, text: &'static str| {
                    div().id(id).cursor_pointer().hover(|s| s.text_color(t.foreground)).child(text)
                };
                let toolbar = div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .px_3()
                    .py(px(6.))
                    .border_b_1()
                    .border_color(t.border)
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .child(link("ms-all", "Select all").on_click(move |_, w, cx| {
                        let mut next = sel_all.clone();
                        next.extend(vis_all.iter().map(|o| o.value.clone()));
                        set(next, &c1, w, cx)
                    }))
                    .child(link("ms-none", "Deselect all").on_click(move |_, w, cx| {
                        let mut next = desel.clone();
                        for o in &vis_none {
                            next.remove(&o.value);
                        }
                        set(next, &c2, w, cx)
                    }));
                let body = if loading {
                    div().flex().items_center().justify_center().py_6().child(crate::display::Spinner::new(16.)).into_any_element()
                } else if filtered.is_empty() {
                    div().py_6().text_center().tw_text_sm().text_color(t.muted_foreground).child("No results").into_any_element()
                } else {
                    div()
                        .id("ms-list")
                        .flex()
                        .flex_col()
                        .max_h(px(224.))
                        .overflow_y_scroll()
                        .p_1()
                        .children(filtered.into_iter().enumerate().map(|(i, o)| {
                            let on = selected.contains(&o.value);
                            let (sel, change, v) = (selected.clone(), change.clone(), o.value.clone());
                            div()
                                .id(i)
                                .flex()
                                .w_full()
                                .items_center()
                                .gap_2()
                                .px_2()
                                .py(px(6.))
                                .tw_text_xs()
                                .tw_rounded_lg()
                                .cursor_pointer()
                                .hover(|s| s.bg(t.accent))
                                .child(crate::controls::square_check(on, cx))
                                .child(Icon::new(o.icon.unwrap_or(IconName::Database)).size(px(14.)).text_color(t.muted_foreground).flex_shrink_0())
                                .child(div().truncate().child(o.label.clone()))
                                .on_click(move |_, w, cx| {
                                    let mut next = sel.clone();
                                    if !next.remove(&v) {
                                        next.insert(v.clone());
                                    }
                                    set(next, &change, w, cx)
                                })
                        }))
                        .into_any_element()
                };
                div().child(header).child(toolbar).child(body)
            })
    }
}
