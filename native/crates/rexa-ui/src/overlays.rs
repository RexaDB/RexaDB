//! Window-level modal layer: ports of components/ui/dialog.tsx,
//! components/ui/alert-dialog.tsx, components/ui/sheet.tsx and
//! hooks/use-confirm.tsx.
//!
//! Open from anywhere with only `&mut App`:
//! ```ignore
//! rexa_ui::open_dialog(cx, |_, _| Dialog::new().title("Rename").child(...).footer(...));
//! let ok = rexa_ui::confirm(ConfirmOptions::destructive("Delete table?"), cx); // impl Future<Output = bool>
//! rexa_ui::open_sheet(cx, Side::Right, |_, _| Sheet::new().title("Row").child(...));
//! ```
//! The content closure runs on every render, so it can read live state.
//! Everything is drawn by a `gpui_base::RootPlugin` registered in `rexa_ui::init`.
//!
//! Approximations: CSS `zoom-in-95` and `backdrop-blur-xs` have no GPUI
//! equivalent (fade / dim only); exit animations are skipped (closing is instant).

use crate::popup::{self, Side};
use crate::theme::{tw, with_alpha};
use crate::{ActiveTokens, Button, ButtonSize, IconName, Tw};
use gpui::{
    div, prelude::*, px, AnimationExt, AnyElement, App, AppContext, Context, CursorStyle, Entity,
    FocusHandle, FontWeight, Global, MouseButton, SharedString, Window,
};
use gpui_component::Icon;
use std::cell::Cell;
use std::rc::Rc;
use std::time::Duration;

pub type OverlayId = usize;
type RenderFn = Rc<dyn Fn(&mut Window, &mut App) -> AnyElement>;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Dialog,
    Alert,
    Sheet(Side),
}

struct Entry {
    id: OverlayId,
    kind: Kind,
    render: RenderFn,
    focus: FocusHandle,
    prev_focus: Option<FocusHandle>,
    focused: Cell<bool>,
    /// Resized width of side sheets.
    width: Rc<Cell<Option<f32>>>,
}

/// All open modal layers, app-wide.
pub struct Overlays {
    entries: Vec<Entry>,
    next_id: OverlayId,
}

struct OverlaysGlobal(Entity<Overlays>);
impl Global for OverlaysGlobal {}

pub(crate) fn store(cx: &mut App) -> Entity<Overlays> {
    if let Some(g) = cx.try_global::<OverlaysGlobal>() {
        return g.0.clone();
    }
    let e = cx.new(|_| Overlays { entries: Vec::new(), next_id: 1 });
    cx.set_global(OverlaysGlobal(e.clone()));
    e
}

fn push(kind: Kind, render: RenderFn, cx: &mut App) -> OverlayId {
    let focus = cx.focus_handle();
    store(cx).update(cx, |s, cx| {
        let id = s.next_id;
        s.next_id += 1;
        s.entries.push(Entry {
            id,
            kind,
            render,
            focus,
            prev_focus: None,
            focused: Cell::new(false),
            width: Rc::new(Cell::new(None)),
        });
        cx.notify();
        id
    })
}

/// `<Dialog open>` with this content.
pub fn open_dialog(cx: &mut App, f: impl Fn(&mut Window, &mut App) -> Dialog + 'static) -> OverlayId {
    push(Kind::Dialog, Rc::new(move |w, cx| f(w, cx).into_any_element()), cx)
}

/// `<AlertDialog open>`: not dismissed by outside clicks.
pub fn open_alert_dialog(cx: &mut App, f: impl Fn(&mut Window, &mut App) -> AlertDialog + 'static) -> OverlayId {
    push(Kind::Alert, Rc::new(move |w, cx| f(w, cx).into_any_element()), cx)
}

/// `<Sheet open><SheetContent side=…>`.
pub fn open_sheet(cx: &mut App, side: Side, f: impl Fn(&mut Window, &mut App) -> Sheet + 'static) -> OverlayId {
    push(Kind::Sheet(side), Rc::new(move |w, cx| f(w, cx).into_any_element()), cx)
}

/// Close one overlay (focus returns to where it was before opening).
pub fn close_overlay(id: OverlayId, cx: &mut App) {
    let s = store(cx);
    let removed = s.update(cx, |s, cx| {
        let ix = s.entries.iter().position(|e| e.id == id)?;
        cx.notify();
        Some(s.entries.remove(ix))
    });
    if let Some(prev) = removed.and_then(|e| e.prev_focus) {
        if let Some(window) = cx.active_window() {
            window.update(cx, |_, window, cx| prev.focus(window, cx)).ok();
        }
    }
}

/// Close the topmost dialog / sheet (what `DialogClose` does).
pub fn close_top(cx: &mut App) {
    if let Some(id) = store(cx).read(cx).entries.last().map(|e| e.id) {
        close_overlay(id, cx);
    }
}

pub fn close_all_overlays(cx: &mut App) {
    while store(cx).read(cx).entries.last().is_some() {
        close_top(cx);
    }
}

pub fn has_open_overlay(cx: &mut App) -> bool {
    !store(cx).read(cx).entries.is_empty()
}

// ---- Root plugin ---------------------------------------------------------------

pub(crate) struct OverlayLayer {
    _observe: Vec<gpui::Subscription>,
}

impl OverlayLayer {
    pub(crate) fn new(_: &mut Window, cx: &mut Context<Self>) -> Self {
        let overlays = store(cx);
        let toasts = crate::toast::store(cx);
        Self {
            _observe: vec![
                cx.observe(&overlays, |_, _, cx| cx.notify()),
                cx.observe(&toasts, |_, _, cx| cx.notify()),
            ],
        }
    }
}

impl gpui_base::RootPlugin for OverlayLayer {}

impl Render for OverlayLayer {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let overlays = store(cx);
        let entries: Vec<(OverlayId, Kind, RenderFn, FocusHandle, bool, Rc<Cell<Option<f32>>>)> = overlays
            .read(cx)
            .entries
            .iter()
            .map(|e| (e.id, e.kind, e.render.clone(), e.focus.clone(), e.focused.replace(true), e.width.clone()))
            .collect();
        // Remember what had focus, then move focus into newly opened layers.
        for (id, _, _, focus, was_focused, _) in &entries {
            if !was_focused {
                let prev = window.focused(cx);
                overlays.update(cx, |s, _| {
                    if let Some(e) = s.entries.iter_mut().find(|e| e.id == *id) {
                        e.prev_focus = prev;
                    }
                });
                focus.focus(window, cx);
            }
        }
        let t = cx.tokens().clone();
        let mut layer = div().absolute().inset_0();
        for (id, kind, render, focus, _, width) in entries {
            let content = render(window, cx);
            let (dim, fade_ms) = match kind {
                Kind::Dialog => (0.8, 150),
                Kind::Alert | Kind::Sheet(_) => (0.1, 100),
            };
            let backdrop = div()
                .id(("overlay-backdrop", id))
                .absolute()
                .inset_0()
                .bg(gpui::hsla(0., 0., 0., dim))
                .occlude()
                .when(kind != Kind::Alert, |d| {
                    d.on_mouse_down(MouseButton::Left, move |_, _, cx| close_overlay(id, cx))
                })
                .with_animation(("overlay-fade", id), gpui::Animation::new(Duration::from_millis(fade_ms)), |d, v| {
                    d.opacity(v)
                });
            let keys = div()
                .id(("overlay-focus", id))
                .track_focus(&focus)
                .on_key_down(move |e, _, cx| {
                    if e.keystroke.key == "escape" {
                        close_overlay(id, cx);
                        cx.stop_propagation();
                    }
                })
                .child(content);
            let positioned = match kind {
                Kind::Dialog | Kind::Alert => {
                    let ms = if kind == Kind::Dialog { 300 } else { 100 };
                    div()
                        .absolute()
                        .inset_0()
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(keys.with_animation(
                            ("overlay-in", id),
                            gpui::Animation::new(Duration::from_millis(ms)).with_easing(popup::css_ease),
                            |d, v| d.opacity(v),
                        ))
                        .into_any_element()
                }
                Kind::Sheet(side) => render_sheet_frame(id, side, keys, width, &t, window),
            };
            layer = layer.child(div().absolute().inset_0().child(backdrop).child(positioned));
        }
        layer.children(crate::toast::render_toaster(window, cx))
    }
}

// ---- Dialog ------------------------------------------------------------------------

/// `DialogContent` with `DialogHeader` (title + description) and `DialogFooter`.
#[derive(IntoElement)]
pub struct Dialog {
    title: Option<SharedString>,
    description: Option<SharedString>,
    header: Option<AnyElement>,
    children: Vec<AnyElement>,
    footer: Vec<AnyElement>,
    max_w: f32,
    w: Option<f32>,
    hide_close: bool,
    padding: f32,
    gap: f32,
}

impl Default for Dialog {
    fn default() -> Self {
        Self::new()
    }
}

impl Dialog {
    pub fn new() -> Self {
        Self {
            title: None,
            description: None,
            header: None,
            children: Vec::new(),
            footer: Vec::new(),
            max_w: 425.,
            w: None,
            hide_close: false,
            padding: 24.,
            gap: 16.,
        }
    }
    pub fn title(mut self, t: impl Into<SharedString>) -> Self {
        self.title = Some(t.into());
        self
    }
    pub fn description(mut self, d: impl Into<SharedString>) -> Self {
        self.description = Some(d.into());
        self
    }
    /// Replace the whole `DialogHeader`.
    pub fn header(mut self, el: impl IntoElement) -> Self {
        self.header = Some(el.into_any_element());
        self
    }
    pub fn footer(mut self, el: impl IntoElement) -> Self {
        self.footer.push(el.into_any_element());
        self
    }
    /// `sm:max-w-[…]` (default 425px).
    pub fn max_w(mut self, w: f32) -> Self {
        self.max_w = w;
        self
    }
    /// Fixed width.
    pub fn w(mut self, w: f32) -> Self {
        self.w = Some(w);
        self
    }
    /// `hideCloseButton`
    pub fn hide_close(mut self) -> Self {
        self.hide_close = true;
        self
    }
    /// `p-0` etc. (default `p-6`).
    pub fn padding(mut self, p: f32) -> Self {
        self.padding = p;
        self
    }
    pub fn gap(mut self, g: f32) -> Self {
        self.gap = g;
        self
    }
}

impl ParentElement for Dialog {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

/// `DialogTitle`: text-sm font-semibold leading-none tracking-tight.
pub fn dialog_title(text: impl Into<SharedString>) -> impl IntoElement {
    div().text_size(px(14.)).line_height(px(14.)).font_weight(FontWeight::SEMIBOLD).child(crate::tight(text))
}

impl RenderOnce for Dialog {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let width = self.w.unwrap_or(self.max_w).min(f32::from(window.viewport_size().width) - 32.);
        let header = self.header.or_else(|| {
            (self.title.is_some() || self.description.is_some()).then(|| {
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .children(self.title.map(dialog_title))
                    .children(self.description.map(|d| {
                        div().tw_text_sm().text_color(t.muted_foreground).child(d)
                    }))
                    .into_any_element()
            })
        });
        div()
            .relative()
            .flex()
            .flex_col()
            .gap(px(self.gap))
            .w(px(width))
            .p(px(self.padding))
            .tw_rounded_lg()
            .border_1()
            .border_color(t.border)
            .bg(t.background)
            .text_color(t.foreground)
            .shadow(popup::shadow_lg())
            .occlude()
            .children(header)
            .children(self.children)
            .when(!self.footer.is_empty(), |d| {
                d.child(div().flex().flex_row().justify_end().gap_2().children(self.footer))
            })
            .when(!self.hide_close, |d| {
                d.child(
                    div()
                        .id("dialog-close")
                        .absolute()
                        .top_4()
                        .right_4()
                        .rounded_xs()
                        .opacity(0.7)
                        .hover(|s| s.opacity(1.))
                        .cursor_pointer()
                        .child(Icon::new(IconName::X).size_4())
                        .on_click(|_, _, cx| close_top(cx)),
                )
            })
    }
}

// ---- AlertDialog ---------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Default)]
pub enum AlertDialogSize {
    #[default]
    Default,
    Sm,
}

/// `AlertDialogContent` + header (media / title / description) + footer.
#[derive(IntoElement)]
pub struct AlertDialog {
    size: AlertDialogSize,
    media: Option<AnyElement>,
    title: Option<SharedString>,
    description: Option<SharedString>,
    children: Vec<AnyElement>,
    footer: Vec<AnyElement>,
    /// use-confirm's `className="border-0 bg-transparent -mx-0 -mb-0 p-0 pt-2"`.
    plain_footer: bool,
}

impl AlertDialog {
    pub fn new() -> Self {
        Self {
            size: AlertDialogSize::Default,
            media: None,
            title: None,
            description: None,
            children: Vec::new(),
            footer: Vec::new(),
            plain_footer: false,
        }
    }
    pub fn size(mut self, s: AlertDialogSize) -> Self {
        self.size = s;
        self
    }
    /// `AlertDialogMedia` (an icon in a muted 40px tile).
    pub fn media(mut self, el: impl IntoElement) -> Self {
        self.media = Some(el.into_any_element());
        self
    }
    pub fn title(mut self, t: impl Into<SharedString>) -> Self {
        self.title = Some(t.into());
        self
    }
    pub fn description(mut self, d: impl Into<SharedString>) -> Self {
        self.description = Some(d.into());
        self
    }
    /// `AlertDialogCancel` / `AlertDialogAction` buttons (close themselves via `close_top`).
    pub fn footer(mut self, el: impl IntoElement) -> Self {
        self.footer.push(el.into_any_element());
        self
    }
    pub fn plain_footer(mut self) -> Self {
        self.plain_footer = true;
        self
    }
}

impl Default for AlertDialog {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for AlertDialog {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for AlertDialog {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let sm = self.size == AlertDialogSize::Sm;
        // max-w-xs (sm) / sm:max-w-sm (default); w-full.
        let width = if sm { 320. } else { 384. };
        let has_media = self.media.is_some();
        let text = div()
            .flex()
            .flex_col()
            .gap(px(6.))
            .when(sm, |d| d.items_center())
            .children(self.title.map(|title| {
                div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(title)
            }))
            .children(self.description.map(|d| div().tw_text_sm().text_color(t.muted_foreground).child(d)));
        let media = self.media.map(|m| {
            div().mb_2().size_10().flex_shrink_0().flex().items_center().justify_center().tw_rounded_lg().bg(t.muted).child(m)
        });
        // Default size with media: a 2-column grid (media spans both rows) —
        // `sm:…:has-media:grid-rows-[auto_1fr]` + `col-start-2`.
        let header = if has_media && !sm {
            div().flex().flex_row().gap_x_4().children(media).child(text)
        } else {
            div().flex().flex_col().gap(px(6.)).when(sm, |d| d.items_center()).children(media).child(text)
        };
        let footer = (!self.footer.is_empty()).then(|| {
            let row = div().flex().flex_row().gap_2();
            let row = if sm {
                // grid grid-cols-2
                row.children(self.footer.into_iter().map(|b| div().flex_1().flex().child(b)))
            } else {
                row.justify_end().children(self.footer)
            };
            if self.plain_footer {
                row.pt_2()
            } else {
                row.mx(px(-16.))
                    .mb(px(-16.))
                    .p_4()
                    .border_t_1()
                    .border_color(t.border)
                    .bg(with_alpha(t.muted, 0.5))
                    .rounded_b(px(14.))
            }
        });
        div()
            .flex()
            .flex_col()
            .gap_4()
            .w(px(width))
            .p_4()
            .tw_rounded_lg()
            .bg(t.background)
            .text_color(t.foreground)
            .shadow(vec![popup::ring(with_alpha(t.foreground, 0.1))])
            .occlude()
            .child(header)
            .children(self.children)
            .children(footer)
    }
}

// ---- Sheet ---------------------------------------------------------------------------

/// `SheetContent` with `SheetHeader` / `SheetFooter`.
#[derive(IntoElement)]
pub struct Sheet {
    title: Option<SharedString>,
    description: Option<SharedString>,
    children: Vec<AnyElement>,
    footer: Vec<AnyElement>,
    show_close: bool,
}

impl Sheet {
    pub fn new() -> Self {
        Self { title: None, description: None, children: Vec::new(), footer: Vec::new(), show_close: true }
    }
    pub fn title(mut self, t: impl Into<SharedString>) -> Self {
        self.title = Some(t.into());
        self
    }
    pub fn description(mut self, d: impl Into<SharedString>) -> Self {
        self.description = Some(d.into());
        self
    }
    pub fn footer(mut self, el: impl IntoElement) -> Self {
        self.footer.push(el.into_any_element());
        self
    }
    /// `showCloseButton={false}`
    pub fn hide_close(mut self) -> Self {
        self.show_close = false;
        self
    }
}

impl Default for Sheet {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for Sheet {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Sheet {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let header = (self.title.is_some() || self.description.is_some()).then(|| {
            div()
                .flex()
                .flex_col()
                .gap(px(2.))
                .p_4()
                .children(self.title.map(|x| div().tw_text_sm().font_weight(FontWeight::MEDIUM).text_color(t.foreground).child(x)))
                .children(self.description.map(|x| div().tw_text_sm().text_color(t.muted_foreground).child(x)))
        });
        div()
            .relative()
            .size_full()
            .flex()
            .flex_col()
            .gap_4()
            .tw_text_sm()
            .children(header)
            .children(self.children)
            .when(!self.footer.is_empty(), |d| d.child(div().mt_auto().flex().flex_col().gap_2().p_4().children(self.footer)))
            .when(self.show_close, |d| {
                d.child(
                    div().absolute().top_3().right_3().child(
                        Button::new("sheet-close").ghost().size(ButtonSize::IconSm).icon(IconName::X).on_click(|_, _, cx| close_top(cx)),
                    ),
                )
            })
    }
}

/// Fixed panel on `side`: w-3/4 sm:max-w-sm, border on the inner edge,
/// shadow-lg, slide-in 200ms ease-in-out; left/right sheets resize from
/// their inner edge (min 360px, max viewport − 24px) like sheet.tsx.
fn render_sheet_frame(
    id: OverlayId,
    side: Side,
    content: impl IntoElement,
    width: Rc<Cell<Option<f32>>>,
    t: &crate::Tokens,
    window: &mut Window,
) -> AnyElement {
    let vw = f32::from(window.viewport_size().width);
    let vh = f32::from(window.viewport_size().height);
    let horizontal = matches!(side, Side::Left | Side::Right);
    let w = width.get().unwrap_or((vw * 0.75).min(384.));
    let mut panel = div()
        .absolute()
        .flex()
        .flex_col()
        .bg(t.background)
        .text_color(t.foreground)
        .border_color(t.border)
        .shadow(popup::shadow_lg())
        .occlude()
        .child(content);
    panel = match side {
        Side::Right => panel.top_0().bottom_0().right_0().w(px(w)).border_l_1(),
        Side::Left => panel.top_0().bottom_0().left_0().w(px(w)).border_r_1(),
        Side::Top => panel.left_0().right_0().top_0().border_b_1(),
        Side::Bottom => panel.left_0().right_0().bottom_0().border_b_1(),
    };
    if horizontal {
        let drag_width = width.clone();
        let handle = div()
            .id(("sheet-resize", id))
            .absolute()
            .top_0()
            .h_full()
            .w(px(6.))
            .when(side == Side::Right, |d| d.left(px(-3.)))
            .when(side == Side::Left, |d| d.right(px(-3.)))
            .cursor(CursorStyle::ResizeLeftRight)
            .on_drag(SheetResize, |_, _, _, cx| cx.new(|_| gpui::Empty))
            .on_drag_move::<SheetResize>(move |e, window, _| {
                let vw = f32::from(window.viewport_size().width);
                let x = f32::from(e.event.position.x);
                let next = if side == Side::Right { vw - x } else { x };
                drag_width.set(Some(next.clamp(360., (vw - 24.).max(360.))));
                window.refresh();
            });
        panel = panel.child(handle);
    }
    let travel = if horizontal { w } else { vh * 0.5 };
    panel
        .with_animation(
            ("sheet-in", id),
            gpui::Animation::new(Duration::from_millis(200)).with_easing(popup::css_ease_in_out),
            move |p, v| {
                let d = px(-travel * (1. - v));
                let p = p.opacity(v);
                match side {
                    Side::Right => p.right(d),
                    Side::Left => p.left(d),
                    Side::Top => p.top(d),
                    Side::Bottom => p.bottom(d),
                }
            },
        )
        .into_any_element()
}

#[derive(Clone)]
struct SheetResize;

// ---- use-confirm ---------------------------------------------------------------------

/// hooks/use-confirm.tsx `ConfirmOptions` (same defaults).
#[derive(Clone, Default)]
pub struct ConfirmOptions {
    pub title: Option<SharedString>,
    pub description: Option<SharedString>,
    pub confirm_text: Option<SharedString>,
    pub cancel_text: Option<SharedString>,
    pub destructive: bool,
}

impl ConfirmOptions {
    pub fn new(title: impl Into<SharedString>) -> Self {
        Self { title: Some(title.into()), ..Default::default() }
    }
    pub fn destructive(title: impl Into<SharedString>) -> Self {
        Self { destructive: true, ..Self::new(title) }
    }
    pub fn description(mut self, d: impl Into<SharedString>) -> Self {
        self.description = Some(d.into());
        self
    }
    pub fn confirm_text(mut self, s: impl Into<SharedString>) -> Self {
        self.confirm_text = Some(s.into());
        self
    }
    pub fn cancel_text(mut self, s: impl Into<SharedString>) -> Self {
        self.cancel_text = Some(s.into());
        self
    }
}

/// `const ok = await confirm({...})`. Resolves `false` on Cancel / Esc.
pub fn confirm(opts: ConfirmOptions, cx: &mut App) -> impl std::future::Future<Output = bool> + 'static {
    let (tx, rx) = futures::channel::oneshot::channel::<bool>();
    let tx = Rc::new(Cell::new(Some(tx)));
    let id_cell = Rc::new(Cell::new(0));
    let (id_c, tx_c) = (id_cell.clone(), tx.clone());
    let id = open_alert_dialog(cx, move |_, _| {
        let resolve = |value: bool, tx: Rc<Cell<Option<futures::channel::oneshot::Sender<bool>>>>, id: OverlayId| {
            move |_: &gpui::ClickEvent, _: &mut Window, cx: &mut App| {
                if let Some(tx) = tx.take() {
                    tx.send(value).ok();
                }
                close_overlay(id, cx);
            }
        };
        let id = id_c.get();
        let action = Button::new("confirm-action")
            .label(opts.confirm_text.clone().unwrap_or("Confirm".into()))
            .on_click(resolve(true, tx_c.clone(), id));
        let action = if opts.destructive {
            action.destructive().colors(tw("red-600"), tw("red-500"), gpui::white())
        } else {
            action
        };
        AlertDialog::new()
            .title(opts.title.clone().unwrap_or("Are you sure?".into()))
            .description(opts.description.clone().unwrap_or("This action cannot be undone.".into()))
            .plain_footer()
            .footer(
                Button::new("confirm-cancel")
                    .ghost()
                    .label(opts.cancel_text.clone().unwrap_or("Cancel".into()))
                    .on_click(resolve(false, tx_c.clone(), id)),
            )
            .footer(action)
    });
    id_cell.set(id);
    // Esc closes the dialog without a button: the sender drops → `false`.
    async move { rx.await.unwrap_or(false) }
}
