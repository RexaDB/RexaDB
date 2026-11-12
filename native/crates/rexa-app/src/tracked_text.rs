//! Single-line text with CSS `letter-spacing` (Tailwind `tracking-*`), which
//! GPUI's text system lacks. The line is shaped once so CoreText kerning is
//! kept, then each glyph is shifted by `spacing × ordinal`, matching how
//! browsers apply letter-spacing after every character.

use gpui::{
    px, App, Bounds, Element, ElementId, GlobalElementId, InspectorElementId, IntoElement, LayoutId,
    LineLayout, Pixels, SharedString, Style, Window,
};
use std::sync::Arc;

pub struct TrackedText {
    text: SharedString,
    /// Letter spacing in em (Tailwind: tight = -0.025, tighter = -0.05, wide = 0.025).
    em: f32,
}

/// `tracking-tight` text.
pub fn tight(text: impl Into<SharedString>) -> TrackedText {
    TrackedText { text: text.into(), em: -0.025 }
}

impl IntoElement for TrackedText {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}

pub struct Prepared {
    layout: Arc<LineLayout>,
    spacing: Pixels,
    line_height: Pixels,
}

fn shape(text: &str, em: f32, window: &mut Window) -> Prepared {
    let style = window.text_style();
    let font_size = style.font_size.to_pixels(window.rem_size());
    let line_height = style.line_height_in_pixels(window.rem_size());
    let run = style.to_run(text.len());
    let layout = window.text_system().layout_line(text, font_size, &[run], None);
    Prepared { layout, spacing: font_size * em, line_height }
}

fn glyph_count(layout: &LineLayout) -> usize {
    layout.runs.iter().map(|r| r.glyphs.len()).sum()
}

impl Element for TrackedText {
    type RequestLayoutState = ();
    type PrepaintState = Option<Prepared>;

    fn id(&self) -> Option<ElementId> {
        None
    }

    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }

    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let prepared = shape(&self.text, self.em, window);
        let width = prepared.layout.width + prepared.spacing * glyph_count(&prepared.layout) as f32;
        let size = gpui::size(width.max(px(0.)), prepared.line_height);
        let mut style = Style::default();
        style.size = size.map(|d| d.into());
        style.flex_shrink = 0.;
        (window.request_layout(style, [], cx), ())
    }

    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        _: &mut App,
    ) -> Option<Prepared> {
        Some(shape(&self.text, self.em, window))
    }

    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        prepared: &mut Option<Prepared>,
        window: &mut Window,
        _: &mut App,
    ) {
        let Some(p) = prepared.take() else { return };
        let color = window.text_style().color;
        let layout = &p.layout;
        let baseline = bounds.origin.y + (p.line_height - (layout.ascent + layout.descent)) / 2. + layout.ascent;
        let mut ordinal = 0.;
        for run in &layout.runs {
            for glyph in &run.glyphs {
                let origin = gpui::point(bounds.origin.x + glyph.position.x + p.spacing * ordinal, baseline);
                window.paint_glyph(origin, run.font_id, glyph.id, layout.font_size, color).ok();
                ordinal += 1.;
            }
        }
    }
}
