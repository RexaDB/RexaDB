//! Port of components/studio/tint-color-picker.tsx (`TintColorPicker`), plus
//! the settings page's two native inputs GPUI lacks: `<input type="color">`
//! (a swatch that opens a palette + hex field popover) and `<input type="range">`.

use gpui::{canvas, div, prelude::*, px, App, Bounds, ElementId, Hsla, MouseButton, Pixels, SharedString, Window};
use gpui_component::Icon;
use rexa_ui::{parse_color, white, with_alpha, ActiveTokens, Align, IconName, Popover, Tw};
use std::cell::Cell;
use std::rc::Rc;

pub const METRIC_TINT_COLORS: [&str; 13] = [
    "#ef4444", "#f97316", "#f59e0b", "#eab308", "#22c55e", "#14b8a6", "#06b6d4", "#3b82f6", "#6366f1", "#8b5cf6",
    "#a855f7", "#ec4899", "#f43f5e",
];

/// `bg-gray-600` / the `#6b7280` empty trigger.
fn gray(hex: &str) -> Hsla {
    parse_color(hex).unwrap_or(gpui::black())
}

#[derive(Clone, Copy)]
pub enum TriggerSize {
    Sm,
    Md,
    Lg,
}

/// TintColorPicker: a round swatch trigger; popover grid of 8 columns
/// (none + 13 tints), `p-1.5 border-studio-border/80 bg-studio-bg`.
pub fn tint_color_picker(
    id: impl Into<ElementId>,
    value: Option<String>,
    label: &str,
    size: TriggerSize,
    on_change: impl Fn(Option<String>, &mut Window, &mut App) + 'static,
    cx: &App,
) -> impl IntoElement {
    let t = cx.tokens().clone();
    let (trig, icon) = match size {
        TriggerSize::Sm => (12., 8.),
        TriggerSize::Md => (16., 10.),
        TriggerSize::Lg => (24., 12.),
    };
    let bg = value.as_deref().and_then(parse_color).unwrap_or(gray("#6b7280"));
    let trigger = div()
        .size(px(trig))
        .tw_rounded_lg()
        .border_1()
        .border_color(if value.is_some() { bg } else { with_alpha(t.studio_border, 0.8) })
        .bg(bg)
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .when(value.is_none(), |d| d.child(Icon::new(IconName::X).size(px(icon)).text_color(white(1.))));
    let on_change = Rc::new(on_change);
    let _ = label;
    Popover::new(id)
        .align(Align::Start)
        .side_offset(6.)
        .w(None)
        .p(6.)
        .trigger(trigger)
        .content(move |ctl, _, cx| {
            let t = cx.tokens().clone();
            let sel = |active: bool| if active { with_alpha(t.foreground, 0.8) } else { gpui::transparent_black() };
            let mut grid = div().flex().flex_wrap().w(px(8. * 16. + 7. * 4.)).gap_1();
            let (oc, c) = (on_change.clone(), ctl.clone());
            grid = grid.child(
                div()
                    .id("tint-none")
                    .size_4()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(sel(value.is_none()))
                    .bg(gray("#4b5563"))
                    .flex()
                    .items_center()
                    .justify_center()
                    .cursor_pointer()
                    .on_click(move |_, w, cx| {
                        oc(None, w, cx);
                        c.close(w, cx);
                    })
                    .child(Icon::new(IconName::X).size(px(10.)).text_color(white(1.))),
            );
            for color in METRIC_TINT_COLORS {
                let (oc, c) = (on_change.clone(), ctl.clone());
                grid = grid.child(
                    div()
                        .id(SharedString::from(format!("tint-{color}")))
                        .size_4()
                        .tw_rounded_lg()
                        .border_1()
                        .border_color(sel(value.as_deref() == Some(color)))
                        .bg(gray(color))
                        .cursor_pointer()
                        .on_click(move |_, w, cx| {
                            oc(Some(color.to_string()), w, cx);
                            c.close(w, cx);
                        }),
                );
            }
            div().child(grid)
        })
}

/// `<input type="color" className="h-7 w-10 rounded border p-0.5">`.
pub fn color_input(
    id: &'static str,
    value: &str,
    cx: &App,
    on_change: impl Fn(String, &mut Window, &mut App) + 'static,
) -> impl IntoElement {
    let t = cx.tokens().clone();
    let swatch = parse_color(value).unwrap_or(gpui::black());
    let on_change = Rc::new(on_change);
    let current = value.to_string();
    Popover::new(id)
        .align(Align::End)
        .w(None)
        .p(8.)
        .trigger(
            div()
                .h_7()
                .w_10()
                .rounded(px(4.))
                .border_1()
                .border_color(t.border)
                .p(px(2.))
                .cursor_pointer()
                .child(div().size_full().rounded(px(2.)).bg(swatch)),
        )
        .content(move |ctl, _, cx| {
            let t = cx.tokens().clone();
            let mut grid = div().flex().flex_wrap().w(px(7. * 20. + 6. * 4.)).gap_1();
            let palette = ["#000000", "#ffffff", "#6b7280"].into_iter().chain(METRIC_TINT_COLORS);
            for (i, color) in palette.enumerate() {
                let (oc, c) = (on_change.clone(), ctl.clone());
                let active = current.eq_ignore_ascii_case(color);
                grid = grid.child(
                    div()
                        .id(("color-opt", i))
                        .size_5()
                        .rounded(px(4.))
                        .border_1()
                        .border_color(if active { t.foreground } else { t.border })
                        .bg(gray(color))
                        .cursor_pointer()
                        .on_click(move |_, w, cx| {
                            oc(color.to_string(), w, cx);
                            c.close(w, cx);
                        }),
                );
            }
            div().child(grid)
        })
}

/// `<input type="range">` (`h-2 w-28 rounded-full bg-muted accent-primary`,
/// thumb `h-3.5 w-3.5 rounded-full bg-primary`): click or drag along the track.
pub fn range_slider(
    id: impl Into<ElementId>,
    value: f64,
    min: f64,
    max: f64,
    width: f32,
    cx: &App,
    on_change: impl Fn(f64, &mut Window, &mut App) + 'static,
) -> impl IntoElement {
    let t = cx.tokens().clone();
    let frac = (((value - min) / (max - min)).clamp(0., 1.)) as f32;
    let bounds: Rc<Cell<Option<Bounds<Pixels>>>> = Rc::new(Cell::new(None));
    let on_change = Rc::new(on_change);
    let pick = {
        let bounds = bounds.clone();
        move |x: Pixels| -> Option<f64> {
            let b = bounds.get()?;
            let f = ((x - b.origin.x) / b.size.width).clamp(0., 1.) as f64;
            Some((min + f * (max - min)).round())
        }
    };
    let pick = Rc::new(pick);
    let (p1, p2, o1, o2) = (pick.clone(), pick, on_change.clone(), on_change);
    let b2 = bounds.clone();
    div()
        .id(id)
        .relative()
        .w(px(width))
        .h(px(14.))
        .flex()
        .items_center()
        .cursor_pointer()
        .child(canvas(move |b, _, _| b2.set(Some(b)), |_, _, _, _| {}).absolute().size_full())
        .child(div().w_full().h_2().rounded_full().bg(t.muted).child(div().h_full().w(px(width * frac)).rounded_full().bg(t.primary)))
        .child(div().absolute().top_0().left(px((width * frac - 7.).clamp(0., width - 14.))).size(px(14.)).rounded_full().bg(t.primary))
        .on_mouse_down(MouseButton::Left, move |e, w, cx| {
            if let Some(v) = p1(e.position.x) {
                o1(v, w, cx);
            }
        })
        .on_mouse_move(move |e, w, cx| {
            if e.pressed_button == Some(MouseButton::Left) {
                if let Some(v) = p2(e.position.x) {
                    o2(v, w, cx);
                }
            }
        })
}
