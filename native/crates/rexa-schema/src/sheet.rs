//! Port of components/common/studio-sheet.tsx (`StudioSheetContent`, `-Header`,
//! `-Title`, `-Description`, `-Body`, `-Footer`): the compact tab-strip chrome of
//! product sheets.
//!
//! `contained` sheets (`SheetContent contained`) are drawn by the owning view as an
//! absolutely positioned panel over its own area ([`StudioSheet::contained`]); the
//! others go through `rexa_ui::open_sheet` ([`open_studio_sheet`]).

use gpui::{div, prelude::*, px, AnyElement, App, ElementId, FontWeight, SharedString, Window};
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, Side, Tw};
use std::rc::Rc;

type CloseFn = Rc<dyn Fn(&mut Window, &mut App)>;

#[derive(IntoElement)]
pub struct StudioSheet {
    id: ElementId,
    title: Option<AnyElement>,
    header_extra: Vec<AnyElement>,
    description: Option<SharedString>,
    body: Vec<AnyElement>,
    footer: Vec<AnyElement>,
    width: f32,
    contained: bool,
    on_close: Option<CloseFn>,
    body_padding: bool,
}

impl StudioSheet {
    pub fn new(id: impl Into<ElementId>) -> Self {
        StudioSheet {
            id: id.into(),
            title: None,
            header_extra: Vec::new(),
            description: None,
            body: Vec::new(),
            footer: Vec::new(),
            width: 420.,
            contained: false,
            on_close: None,
            body_padding: true,
        }
    }
    /// `StudioSheetTitle` text (selected tab pill).
    pub fn title(mut self, t: impl Into<SharedString>) -> Self {
        self.title = Some(title_pill(t.into()).into_any_element());
        self
    }
    /// A custom title element (rendered as-is in the header strip).
    pub fn title_el(mut self, el: impl IntoElement) -> Self {
        self.title = Some(el.into_any_element());
        self
    }
    pub fn header_child(mut self, el: impl IntoElement) -> Self {
        self.header_extra.push(el.into_any_element());
        self
    }
    pub fn description(mut self, d: impl Into<SharedString>) -> Self {
        self.description = Some(d.into());
        self
    }
    pub fn child(mut self, el: impl IntoElement) -> Self {
        self.body.push(el.into_any_element());
        self
    }
    /// Body without `px-5 py-4`.
    pub fn flush_body(mut self) -> Self {
        self.body_padding = false;
        self
    }
    pub fn footer(mut self, el: impl IntoElement) -> Self {
        self.footer.push(el.into_any_element());
        self
    }
    pub fn width(mut self, w: f32) -> Self {
        self.width = w;
        self
    }
    /// Draw as an absolute panel over the parent (the parent must be `relative`).
    pub fn contained(mut self, on_close: impl Fn(&mut Window, &mut App) + 'static) -> Self {
        self.contained = true;
        self.on_close = Some(Rc::new(on_close));
        self
    }
}

/// `StudioSheetTitle`: h-7 pill with the active-tab background.
pub fn title_pill(text: SharedString) -> impl IntoElement {
    TitlePill(text)
}

#[derive(IntoElement)]
struct TitlePill(SharedString);

impl RenderOnce for TitlePill {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens();
        div()
            .flex()
            .flex_shrink_0()
            .h_7()
            .min_w(px(96.))
            .max_w(px(208.))
            .items_center()
            .gap(px(6.))
            .px_2()
            .tw_rounded_md()
            .bg(t.var_or("--studio-tab-active", t.muted))
            .tw_text_xs()
            .font_weight(FontWeight::MEDIUM)
            .text_color(t.foreground)
            .child(div().truncate().child(self.0))
    }
}

impl RenderOnce for StudioSheet {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let on_close = self.on_close.clone();
        let close = Button::new(ElementId::Name(format!("{}-close", self.id).into())).ghost().size(ButtonSize::IconSm).icon(IconName::X).on_click(move |_, w, cx| match &on_close {
            Some(f) => f(w, cx),
            None => rexa_ui::close_top(cx),
        });
        let header = div()
            .relative()
            .flex()
            .h_9()
            .flex_shrink_0()
            .flex_row()
            .items_center()
            .justify_between()
            .gap_1()
            .overflow_hidden()
            .border_b_1()
            .border_color(t.border)
            .bg(t.background)
            .p_1()
            .pl_3()
            .pr_10()
            .child(
                div()
                    .flex()
                    .flex_1()
                    .min_w_0()
                    .items_center()
                    .gap_2()
                    .children(self.title)
                    .children(self.description.map(|d| div().min_w_0().flex_1().truncate().tw_text_xs().text_color(t.muted_foreground).child(d))),
            )
            .children(self.header_extra)
            .child(div().absolute().top_1().right_3().child(close));
        let body = div()
            .id(ElementId::Name(format!("{}-body", self.id).into()))
            .min_h_0()
            .flex_1()
            .overflow_y_scroll()
            .when(self.body_padding, |d| d.px_5().py_4())
            .children(self.body);
        let footer = (!self.footer.is_empty()).then(|| {
            div()
                .mt_auto()
                .flex()
                .min_h_9()
                .flex_shrink_0()
                .flex_row()
                .items_center()
                .justify_end()
                .gap_1()
                .border_t_1()
                .border_color(t.border)
                .bg(t.background)
                .px_3()
                .py_2()
                .children(self.footer)
        });
        let inner = div().flex().flex_col().size_full().bg(t.background).text_color(t.foreground).tw_text_sm().child(header).child(body).children(footer);
        if self.contained {
            div()
                .id(self.id)
                .absolute()
                .top_0()
                .right_0()
                .bottom_0()
                .w(px(self.width))
                .border_l_1()
                .border_color(t.border)
                .shadow(rexa_ui::popup::shadow_lg())
                .occlude()
                .on_scroll(|_, _, cx| cx.stop_propagation())
                .child(inner)
                .into_any_element()
        } else {
            div().id(self.id).size_full().child(inner).into_any_element()
        }
    }
}

/// Open a window-level studio sheet on the right; `f` runs on every render.
pub fn open_studio_sheet(cx: &mut App, f: impl Fn(&mut Window, &mut App) -> StudioSheet + 'static) -> rexa_ui::OverlayId {
    rexa_ui::open_sheet(cx, Side::Right, move |w, cx| rexa_ui::Sheet::new().hide_close().child(f(w, cx)))
}

/// `DetailRow` style "label / value" row used by several sheets.
pub fn detail_row(label: &str, value: impl Into<SharedString>, cx: &App) -> AnyElement {
    let t = cx.tokens();
    div()
        .flex()
        .flex_row()
        .items_start()
        .justify_between()
        .gap_4()
        .border_b_1()
        .border_color(rexa_ui::with_alpha(t.var_or("--studio-border", t.border), 0.6))
        .py_3()
        .child(div().flex_shrink_0().tw_text_xs().text_color(rexa_ui::with_alpha(t.muted_foreground, 0.6)).child(rexa_ui::tracked_text::tracked(label.to_string(), 0.14)))
        .child(div().max_w(gpui::relative(0.65)).text_right().tw_text_sm().text_color(t.foreground).child(value.into()))
        .into_any_element()
}
