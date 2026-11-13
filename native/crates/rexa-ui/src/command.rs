//! Port of components/ui/command.tsx (cmdk) and components/ui/command-search-bar.tsx.
//!
//! ```ignore
//! // ⌘K palette (CommandDialog):
//! rexa_ui::open_command_dialog(cx, "palette", |_, _| vec![
//!     CommandGroup::new("Suggestions")
//!         .item(CommandItem::new("New query").icon(IconName::Plus).shortcut("⌘N").on_select(|_, _| {})),
//! ]);
//! // inline (inside a popover):
//! Command::new("tables").placeholder("Search tables…").groups(groups)
//! ```
//! Filtering follows cmdk: items are scored against the query (label +
//! keywords), non-matching ones and empty groups are hidden, matches are
//! sorted by score, the first item is selected, ↑/↓ move, Enter runs, hover selects.

use crate::popup;
use crate::tracked_text::tracked;
use crate::{ActiveTokens, IconName, Kbd, Tw};
use gpui::{
    div, prelude::*, px, AnimationExt, App, ElementId, FontWeight, MouseButton,
    SharedString, Window,
};
use gpui_component::input::{Input, InputEvent, InputState};
use gpui_component::{Icon, Sizable, Size};
use std::rc::Rc;
use std::time::Duration;

type Handler = Rc<dyn Fn(&mut Window, &mut App)>;

#[derive(Clone)]
pub struct CommandItem {
    value: SharedString,
    label: SharedString,
    keywords: Vec<SharedString>,
    icon: Option<IconName>,
    shortcut: Option<SharedString>,
    disabled: bool,
    on_select: Option<Handler>,
    keep_open: bool,
}

impl CommandItem {
    pub fn new(label: impl Into<SharedString>) -> Self {
        let label = label.into();
        Self { value: label.clone(), label, keywords: Vec::new(), icon: None, shortcut: None, disabled: false, on_select: None, keep_open: false }
    }
    /// Unique value (defaults to the label).
    pub fn value(mut self, v: impl Into<SharedString>) -> Self {
        self.value = v.into();
        self
    }
    pub fn keywords(mut self, k: impl IntoIterator<Item = impl Into<SharedString>>) -> Self {
        self.keywords = k.into_iter().map(Into::into).collect();
        self
    }
    pub fn icon(mut self, i: IconName) -> Self {
        self.icon = Some(i);
        self
    }
    /// `CommandShortcut`
    pub fn shortcut(mut self, s: impl Into<SharedString>) -> Self {
        self.shortcut = Some(s.into());
        self
    }
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
    /// In a dialog the palette closes after running the item unless `keep_open`.
    pub fn keep_open(mut self) -> Self {
        self.keep_open = true;
        self
    }
    pub fn on_select(mut self, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_select = Some(Rc::new(f));
        self
    }
}

/// `CommandGroup heading=…`; a group with no heading renders just its items.
#[derive(Clone)]
pub struct CommandGroup {
    heading: Option<SharedString>,
    items: Vec<CommandItem>,
    separator_before: bool,
}

impl CommandGroup {
    pub fn new(heading: impl Into<SharedString>) -> Self {
        Self { heading: Some(heading.into()), items: Vec::new(), separator_before: false }
    }
    pub fn untitled() -> Self {
        Self { heading: None, items: Vec::new(), separator_before: false }
    }
    pub fn item(mut self, i: CommandItem) -> Self {
        self.items.push(i);
        self
    }
    pub fn items(mut self, i: impl IntoIterator<Item = CommandItem>) -> Self {
        self.items.extend(i);
        self
    }
    /// `<CommandSeparator />` before this group.
    pub fn separator_before(mut self) -> Self {
        self.separator_before = true;
        self
    }
}

/// cmdk-style score: 0 = no match.
pub fn command_score(text: &str, query: &str) -> f32 {
    if query.is_empty() {
        return 1.;
    }
    let (t, q) = (text.to_lowercase(), query.to_lowercase());
    if t == q {
        return 1.;
    }
    if t.starts_with(&q) {
        return 0.9;
    }
    if t.split(|c: char| !c.is_alphanumeric()).any(|w| w.starts_with(&q)) {
        return 0.8;
    }
    if t.contains(&q) {
        return 0.6;
    }
    // In-order subsequence (cmdk's fuzzy fallback), penalised by gaps.
    let mut chars = t.chars().enumerate();
    let mut gaps = 0usize;
    let mut last = None;
    for qc in q.chars() {
        match chars.find(|(_, c)| *c == qc) {
            Some((i, _)) => {
                if let Some(l) = last {
                    gaps += i - l - 1;
                }
                last = Some(i);
            }
            None => return 0.,
        }
    }
    (0.5 - gaps as f32 * 0.01).max(0.05)
}

struct CommandState {
    query: gpui::Entity<InputState>,
    selected: Option<SharedString>,
    last_query: SharedString,
    focused_once: bool,
    _sub: gpui::Subscription,
}

/// The `Command` box: input row + list.
#[derive(IntoElement)]
pub struct Command {
    id: ElementId,
    groups: Vec<CommandGroup>,
    placeholder: SharedString,
    empty: SharedString,
    in_dialog: bool,
    on_close: Option<Handler>,
    max_h: f32,
    autofocus: bool,
}

impl Command {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            groups: Vec::new(),
            placeholder: "Type a command or search...".into(),
            empty: "No results found.".into(),
            in_dialog: false,
            on_close: None,
            max_h: 300.,
            autofocus: true,
        }
    }
    pub fn groups(mut self, g: impl IntoIterator<Item = CommandGroup>) -> Self {
        self.groups.extend(g);
        self
    }
    pub fn group(mut self, g: CommandGroup) -> Self {
        self.groups.push(g);
        self
    }
    /// `CommandInput placeholder`
    pub fn placeholder(mut self, p: impl Into<SharedString>) -> Self {
        self.placeholder = p.into();
        self
    }
    /// `CommandEmpty` text.
    pub fn empty_text(mut self, p: impl Into<SharedString>) -> Self {
        self.empty = p.into();
        self
    }
    pub fn max_h(mut self, h: f32) -> Self {
        self.max_h = h;
        self
    }
    pub fn autofocus(mut self, a: bool) -> Self {
        self.autofocus = a;
        self
    }
    /// CommandDialog sizing (`input h-12`, item `py-3`, 20px icons).
    fn dialog(mut self, on_close: Handler) -> Self {
        self.in_dialog = true;
        self.on_close = Some(on_close);
        self
    }
}

impl RenderOnce for Command {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let placeholder = self.placeholder.clone();
        let state = window.use_keyed_state(popup::sub_id(&self.id, "cmd"), cx, move |window, cx| {
            let query = cx.new(|cx| InputState::new(window, cx).placeholder(placeholder));
            let sub = cx.subscribe(&query, |_: &mut CommandState, _, _: &InputEvent, cx| cx.notify());
            CommandState { query, selected: None, last_query: "".into(), focused_once: false, _sub: sub }
        });
        if self.autofocus && !state.read(cx).focused_once {
            let q = state.read(cx).query.clone();
            q.update(cx, |q, cx| q.focus(window, cx));
            state.update(cx, |s, _| s.focused_once = true);
        }
        let query = state.read(cx).query.read(cx).value();

        // Filter + sort.
        let mut visible: Vec<(Option<SharedString>, bool, Vec<(f32, CommandItem)>)> = Vec::new();
        for g in self.groups {
            let mut items: Vec<(f32, CommandItem)> = g
                .items
                .into_iter()
                .filter_map(|i| {
                    let s = std::iter::once(&i.label).chain(&i.keywords).map(|x| command_score(x, &query)).fold(0f32, f32::max);
                    (s > 0.).then_some((s, i))
                })
                .collect();
            if !query.is_empty() {
                items.sort_by(|a, b| b.0.total_cmp(&a.0));
            }
            if !items.is_empty() {
                visible.push((g.heading, g.separator_before, items));
            }
        }
        let flat: Vec<CommandItem> = visible.iter().flat_map(|(_, _, i)| i.iter().map(|(_, i)| i.clone())).filter(|i| !i.disabled).collect();
        // cmdk selects the first item whenever the query changes.
        if state.read(cx).last_query != query || state.read(cx).selected.as_ref().is_none_or(|s| !flat.iter().any(|i| &i.value == s)) {
            let first = flat.first().map(|i| i.value.clone());
            state.update(cx, |s, _| {
                s.selected = first;
                s.last_query = query.clone();
            });
        }
        let selected = state.read(cx).selected.clone();
        let dialog = self.in_dialog;
        let icon_size = if dialog { 20. } else { 16. };
        let on_close = self.on_close.clone();

        let run = {
            let on_close = on_close.clone();
            move |item: &CommandItem, window: &mut Window, cx: &mut App| {
                if !item.keep_open {
                    if let Some(c) = &on_close {
                        c(window, cx);
                    }
                }
                if let Some(f) = &item.on_select {
                    f(window, cx);
                }
            }
        };
        let run = Rc::new(run);

        let mut list = div().id(popup::sub_id(&self.id, "list")).flex().flex_col().max_h(px(self.max_h)).overflow_y_scroll();
        if visible.is_empty() {
            list = list.child(div().py_6().text_center().tw_text_sm().child(self.empty.clone()));
        }
        for (gi, (heading, sep, items)) in visible.into_iter().enumerate() {
            if sep {
                list = list.child(div().h(px(1.)).bg(t.border));
            }
            // `[cmdk-group]:not([hidden]) ~ [cmdk-group]` has pt-0 in the dialog.
            let mut group = div().flex().flex_col().p_1().text_color(t.foreground).when(dialog, |d| d.px_2().when(gi > 0, |d| d.pt_0()));
            if let Some(h) = heading {
                group = group.child(div().px_2().py(px(6.)).tw_text_xs().font_weight(FontWeight::MEDIUM).text_color(t.muted_foreground).child(h));
            }
            for (_, item) in items {
                let is_sel = selected.as_ref() == Some(&item.value);
                let (st, value) = (state.clone(), item.value.clone());
                let run = run.clone();
                let it = item.clone();
                let row = div()
                    .id(popup::sub_id(&self.id, &item.value))
                    .relative()
                    .flex()
                    .items_center()
                    .gap_2()
                    .px_2()
                    .py(px(if dialog { 12. } else { 6. }))
                    .tw_rounded_lg()
                    .tw_text_sm()
                    .when(is_sel, |d| d.bg(t.muted).text_color(t.foreground))
                    .when(item.disabled, |d| d.opacity(0.5))
                    .children(item.icon.map(|i| Icon::new(i).size(px(icon_size)).flex_shrink_0()))
                    .child(item.label.clone())
                    .children(item.shortcut.clone().map(|s| {
                        div().ml_auto().tw_text_xs().text_color(t.muted_foreground).child(tracked(s, 0.1))
                    }))
                    .when(!item.disabled, |d| {
                        d.cursor_pointer()
                            .on_mouse_move(move |_, _, cx| {
                                if st.read(cx).selected.as_ref() != Some(&value) {
                                    st.update(cx, |s, cx| {
                                        s.selected = Some(value.clone());
                                        cx.notify();
                                    });
                                }
                            })
                            .on_mouse_down(MouseButton::Left, move |_, w, cx| run(&it, w, cx))
                    })
                    // animate-cmd-item-enter: 0.4s cubic-bezier(.16,1,.3,1), translateY(4px) → 0.
                    .with_animation(
                        popup::sub_id(&self.id, format!("enter-{}", item.value)),
                        gpui::Animation::new(Duration::from_millis(400)).with_easing(|t| popup::cubic_bezier(0.16, 1., 0.3, 1., t)),
                        |d, v| d.opacity(v).mt(px(4. * (1. - v))).mb(px(-4. * (1. - v))),
                    );
                group = group.child(row);
            }
            list = list.child(group);
        }

        let st_key = state.clone();
        let run_key = run.clone();
        let flat_key = flat.clone();
        div()
            .id(self.id.clone())
            .flex()
            .flex_col()
            .size_full()
            .overflow_hidden()
            .tw_rounded_lg()
            .bg(t.popover)
            .text_color(t.var_or("--popover-foreground", t.foreground))
            .capture_key_down(move |e, window, cx| {
                let sel = st_key.read(cx).selected.clone();
                let pos = sel.and_then(|s| flat_key.iter().position(|i| i.value == s));
                let n = flat_key.len();
                let next = match e.keystroke.key.as_str() {
                    "down" if n > 0 => Some(pos.map_or(0, |p| (p + 1).min(n - 1))),
                    "up" if n > 0 => Some(pos.map_or(0, |p| p.saturating_sub(1))),
                    "enter" => {
                        if let Some(p) = pos {
                            run_key(&flat_key[p], window, cx);
                        }
                        cx.stop_propagation();
                        return;
                    }
                    _ => return,
                };
                if let Some(ix) = next {
                    st_key.update(cx, |s, cx| {
                        s.selected = Some(flat_key[ix].value.clone());
                        cx.notify();
                    });
                }
                cx.stop_propagation();
            })
            .child(
                // CommandInput: `flex items-center border-b px-3`, Search `mr-2 size-4 opacity-50`, input `h-11` (dialog h-12).
                div()
                    .flex()
                    .items_center()
                    .flex_shrink_0()
                    .border_b_1()
                    .border_color(t.border)
                    .px_3()
                    .child(Icon::new(IconName::Search).size(px(icon_size)).mr_2().flex_shrink_0().opacity(0.5))
                    .child(
                        div()
                            .flex_1()
                            .h(px(if dialog { 48. } else { 44. }))
                            .flex()
                            .items_center()
                            .tw_text_sm()
                            .mx(px(-crate::controls::INPUT_PX))
                            .child(Input::new(&state.read(cx).query).appearance(false).with_size(Size::Medium)),
                    ),
            )
            .child(list)
    }
}

/// `CommandDialog` — opens the palette in the modal layer (DialogContent
/// `overflow-hidden p-0 shadow-lg`, cmd-enter 0.3s) and closes after an item runs.
pub fn open_command_dialog(
    cx: &mut App,
    id: impl Into<ElementId>,
    groups: impl Fn(&mut Window, &mut App) -> Vec<CommandGroup> + 'static,
) -> crate::OverlayId {
    open_command_dialog_with(cx, id, "Type a command or search...", groups)
}

pub fn open_command_dialog_with(
    cx: &mut App,
    id: impl Into<ElementId>,
    placeholder: impl Into<SharedString>,
    groups: impl Fn(&mut Window, &mut App) -> Vec<CommandGroup> + 'static,
) -> crate::OverlayId {
    let id: ElementId = id.into();
    let placeholder = placeholder.into();
    let overlay = Rc::new(std::cell::Cell::new(0));
    let ov = overlay.clone();
    let opened = crate::open_dialog(cx, move |window, cx| {
        let ov = ov.clone();
        let close: Handler = Rc::new(move |_, cx| crate::close_overlay(ov.get(), cx));
        crate::Dialog::new()
            .padding(0.)
            .gap(0.)
            .child(
                Command::new(id.clone())
                    .placeholder(placeholder.clone())
                    .groups(groups(window, cx))
                    .dialog(close),
            )
    });
    overlay.set(opened);
    opened
}

// ---- CommandSearchBar ----------------------------------------------------------------

/// The fake search field in the studio header that opens the palette.
#[derive(IntoElement)]
pub struct CommandSearchBar {
    id: ElementId,
    sleek: bool,
    on_click: Option<Handler>,
}

impl CommandSearchBar {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), sleek: false, on_click: None }
    }
    /// `sleekLayout` (h-8, 12px icon).
    pub fn sleek(mut self, s: bool) -> Self {
        self.sleek = s;
        self
    }
    pub fn on_click(mut self, f: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Rc::new(f));
        self
    }
}

impl RenderOnce for CommandSearchBar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let group: SharedString = format!("cmdbar-{:?}", self.id).into();
        let on_click = self.on_click.clone();
        div().flex_1().max_w(px(576.)).child(
            div()
                .id(self.id)
                .group(group.clone())
                .relative()
                .cursor_pointer()
                .when_some(on_click, |d, f| d.on_click(move |_, w, cx| f(w, cx)))
                .child(
                    div()
                        .w_full()
                        .h(px(if self.sleek { 32. } else { 36. }))
                        .flex()
                        .items_center()
                        .gap_2()
                        .px_3()
                        .pl_8()
                        .tw_rounded_lg()
                        .border_1()
                        .border_color(t.studio_border)
                        .bg(crate::with_alpha(t.background, 0.15))
                        .hover(|s| s.bg(crate::with_alpha(t.background, 0.25)))
                        .tw_text_xs()
                        .text_color(crate::with_alpha(t.muted_foreground, 0.6))
                        .child(div().flex().items_center().gap_1().opacity(0.5).child(Kbd::new("⌘")).child(Kbd::new("K")))
                        .child(div().ml_1().child("Search")),
                )
                .child(
                    div()
                        .absolute()
                        .left(px(10.))
                        .top_0()
                        .bottom_0()
                        .flex()
                        .items_center()
                        .text_color(crate::with_alpha(t.muted_foreground, 0.3))
                        .group_hover(group, |s| s.text_color(crate::with_alpha(t.foreground, 0.5)))
                        .child(Icon::new(IconName::Search).size(px(if self.sleek { 12. } else { 14. }))),
                ),
        )
    }
}
