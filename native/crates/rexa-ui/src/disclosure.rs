//! - components/ui/tabs.tsx (`Tabs`: the `TabsList` + triggers; render the
//!   selected content yourself below it with `tabs_content`)
//! - components/ui/accordion.tsx (`Accordion`)
//! - components/ui/collapsible.tsx (`Collapsible`)
//!
//! Approximation: Radix's `accordion-down/up` height animation is not
//! reproduced (GPUI can't animate to an unknown content height); content fades in.

use crate::popup;
use crate::{ActiveTokens, IconName, Tw};
use gpui::{
    div, prelude::*, px, AnimationExt, AnyElement, App, ElementId, FontWeight, SharedString, Window,
};
use gpui_component::Icon;
use std::collections::HashSet;
use std::rc::Rc;
use std::time::Duration;

// ---- Tabs ----------------------------------------------------------------------------

/// `TabsList` (`inline-flex h-10 rounded-lg bg-muted p-1 text-muted-foreground`) with
/// `TabsTrigger`s (`px-3 py-1.5 text-sm font-medium rounded-lg`, active
/// `bg-background text-foreground shadow-sm`).
#[derive(IntoElement)]
pub struct Tabs {
    id: ElementId,
    labels: Vec<(SharedString, bool)>,
    selected: usize,
    on_change: Option<Rc<dyn Fn(usize, &mut Window, &mut App)>>,
    full_width: bool,
}

impl Tabs {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), labels: Vec::new(), selected: 0, on_change: None, full_width: false }
    }
    pub fn tab(mut self, label: impl Into<SharedString>) -> Self {
        self.labels.push((label.into(), false));
        self
    }
    pub fn disabled_tab(mut self, label: impl Into<SharedString>) -> Self {
        self.labels.push((label.into(), true));
        self
    }
    pub fn selected(mut self, ix: usize) -> Self {
        self.selected = ix;
        self
    }
    pub fn on_change(mut self, f: impl Fn(usize, &mut Window, &mut App) + 'static) -> Self {
        self.on_change = Some(Rc::new(f));
        self
    }
    /// `className="w-full grid grid-cols-N"`
    pub fn w_full(mut self) -> Self {
        self.full_width = true;
        self
    }
}

impl RenderOnce for Tabs {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        div()
            .id(self.id)
            .flex()
            .items_center()
            .justify_center()
            .h_10()
            .p_1()
            .tw_rounded_lg()
            .bg(t.muted)
            .text_color(t.muted_foreground)
            .when(self.full_width, |d| d.w_full())
            .children(self.labels.into_iter().enumerate().map(|(i, (label, disabled))| {
                let active = i == self.selected;
                let change = self.on_change.clone();
                div()
                    .id(i)
                    .flex()
                    .items_center()
                    .justify_center()
                    .when(self.full_width, |d| d.flex_1())
                    .whitespace_nowrap()
                    .px_3()
                    .py(px(6.))
                    .tw_rounded_lg()
                    .tw_text_sm()
                    .font_weight(FontWeight::MEDIUM)
                    .when(active, |d| d.bg(t.background).text_color(t.foreground).shadow(popup::shadow_sm()))
                    .when(disabled, |d| d.opacity(0.5))
                    .when(!disabled, |d| {
                        d.cursor_pointer().when_some(change, |d, f| d.on_click(move |_, w, cx| f(i, w, cx)))
                    })
                    .child(label)
            }))
    }
}

/// `TabsContent`: `mt-2`.
pub fn tabs_content(child: impl IntoElement) -> impl IntoElement {
    div().mt_2().child(child)
}

// ---- Accordion -----------------------------------------------------------------------

struct AccordionItem {
    title: SharedString,
    content: AnyElement,
    disabled: bool,
}

/// `Accordion type="single" collapsible` (default) or `type="multiple"`.
/// Uncontrolled: open state lives with the element id.
#[derive(IntoElement)]
pub struct Accordion {
    id: ElementId,
    items: Vec<AccordionItem>,
    multiple: bool,
    default_open: Vec<usize>,
}

impl Accordion {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), items: Vec::new(), multiple: false, default_open: Vec::new() }
    }
    pub fn item(mut self, title: impl Into<SharedString>, content: impl IntoElement) -> Self {
        self.items.push(AccordionItem { title: title.into(), content: content.into_any_element(), disabled: false });
        self
    }
    pub fn disabled_item(mut self, title: impl Into<SharedString>, content: impl IntoElement) -> Self {
        self.items.push(AccordionItem { title: title.into(), content: content.into_any_element(), disabled: true });
        self
    }
    pub fn multiple(mut self) -> Self {
        self.multiple = true;
        self
    }
    pub fn default_open(mut self, ix: impl IntoIterator<Item = usize>) -> Self {
        self.default_open = ix.into_iter().collect();
        self
    }
}

impl RenderOnce for Accordion {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let defaults = self.default_open.clone();
        let open = window.use_keyed_state(popup::sub_id(&self.id, "open"), cx, move |_, _| defaults.into_iter().collect::<HashSet<usize>>());
        let opened = open.read(cx).clone();
        let n = self.items.len();
        let multiple = self.multiple;
        div().id(self.id.clone()).flex().flex_col().w_full().children(self.items.into_iter().enumerate().map(|(i, item)| {
            let is_open = opened.contains(&i);
            let state = open.clone();
            let trigger = div()
                .id(i)
                .flex()
                .flex_1()
                .items_start()
                .justify_between()
                .py(px(10.))
                .tw_rounded_lg()
                .tw_text_sm()
                .font_weight(FontWeight::MEDIUM)
                .when(item.disabled, |d| d.opacity(0.5))
                .when(!item.disabled, |d| {
                    d.cursor_pointer().hover(|s| s.underline()).on_click(move |_, _, cx| {
                        state.update(cx, |set, cx| {
                            if !set.remove(&i) {
                                if !multiple {
                                    set.clear();
                                }
                                set.insert(i);
                            }
                            cx.notify();
                        })
                    })
                })
                .child(item.title)
                .child(
                    Icon::new(if is_open { IconName::ChevronUp } else { IconName::ChevronDown })
                        .size_4()
                        .ml_auto()
                        .flex_shrink_0()
                        .text_color(t.muted_foreground),
                );
            div()
                .flex()
                .flex_col()
                .when(i + 1 < n, |d| d.border_b_1().border_color(t.border))
                .child(div().flex().child(trigger))
                .when(is_open, |d| {
                    d.child(
                        div().overflow_hidden().tw_text_sm().pb(px(10.)).child(item.content).with_animation(
                            popup::sub_id(&self.id, format!("acc{i}")),
                            gpui::Animation::new(Duration::from_millis(200)).with_easing(popup::css_ease),
                            |d, v| d.opacity(v),
                        ),
                    )
                })
        }))
    }
}

// ---- Collapsible ---------------------------------------------------------------------

/// Radix Collapsible: unstyled; clicking the trigger toggles the content.
/// Controlled with `open` + `on_open_change`, otherwise state lives with the id.
#[derive(IntoElement)]
pub struct Collapsible {
    id: ElementId,
    trigger: Option<Box<dyn FnOnce(bool) -> AnyElement>>,
    content: Option<AnyElement>,
    open: Option<bool>,
    default_open: bool,
    on_open_change: Option<Rc<dyn Fn(bool, &mut Window, &mut App)>>,
}

impl Collapsible {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), trigger: None, content: None, open: None, default_open: false, on_open_change: None }
    }
    /// Trigger rendered from the current open state (chevrons etc.).
    pub fn trigger<E: IntoElement>(mut self, f: impl FnOnce(bool) -> E + 'static) -> Self {
        self.trigger = Some(Box::new(move |o| f(o).into_any_element()));
        self
    }
    pub fn content(mut self, el: impl IntoElement) -> Self {
        self.content = Some(el.into_any_element());
        self
    }
    pub fn open(mut self, o: bool) -> Self {
        self.open = Some(o);
        self
    }
    pub fn default_open(mut self, o: bool) -> Self {
        self.default_open = o;
        self
    }
    pub fn on_open_change(mut self, f: impl Fn(bool, &mut Window, &mut App) + 'static) -> Self {
        self.on_open_change = Some(Rc::new(f));
        self
    }
}

impl RenderOnce for Collapsible {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let d = self.default_open;
        let state = window.use_keyed_state(popup::sub_id(&self.id, "open"), cx, move |_, _| d);
        let open = self.open.unwrap_or(*state.read(cx));
        let controlled = self.open.is_some();
        let change = self.on_open_change.clone();
        div()
            .flex()
            .flex_col()
            .child(
                div()
                    .id(self.id.clone())
                    .cursor_pointer()
                    .children(self.trigger.map(|f| f(open)))
                    .on_click(move |_, w, cx| {
                        if !controlled {
                            state.update(cx, |v, cx| {
                                *v = !open;
                                cx.notify();
                            });
                        }
                        if let Some(f) = &change {
                            f(!open, w, cx);
                        }
                    }),
            )
            .when(open, |d| d.children(self.content))
    }
}
