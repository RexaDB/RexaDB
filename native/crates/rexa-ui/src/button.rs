//! components/ui/button.tsx, including the default "raised" button style
//! (`.rexa-raised` in globals.css) for dark themes.

use crate::theme::{tw, white, with_alpha};
use crate::{ActiveTokens, IconName, Tw};
use gpui::{
    div, prelude::*, px, AnyElement, App, ClickEvent, ElementId, FontWeight, Hsla, SharedString,
    Window,
};
use gpui_component::Icon;

#[derive(Clone, Copy, PartialEq, Default)]
pub enum ButtonVariant {
    #[default]
    Default,
    Outline,
    Secondary,
    Ghost,
    Destructive,
    Link,
}

#[derive(Clone, Copy, PartialEq, Default)]
pub enum ButtonSize {
    #[default]
    Default,
    Xs,
    Sm,
    Lg,
    Icon,
    IconXs,
    IconSm,
    IconLg,
}

type ClickHandler = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

#[derive(IntoElement)]
pub struct Button {
    id: ElementId,
    variant: ButtonVariant,
    size: ButtonSize,
    label: Option<SharedString>,
    icon: Option<IconName>,
    icon_end: Option<IconName>,
    disabled: bool,
    selected: bool,
    full_width: bool,
    on_click: Option<ClickHandler>,
    children: Vec<AnyElement>,
    colors: Option<(Hsla, Hsla, Hsla)>,
}

impl Button {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self {
            id: id.into(),
            variant: ButtonVariant::Default,
            size: ButtonSize::Default,
            label: None,
            icon: None,
            icon_end: None,
            disabled: false,
            selected: false,
            full_width: false,
            on_click: None,
            children: Vec::new(),
            colors: None,
        }
    }
    pub fn variant(mut self, v: ButtonVariant) -> Self {
        self.variant = v;
        self
    }
    pub fn outline(self) -> Self {
        self.variant(ButtonVariant::Outline)
    }
    pub fn secondary(self) -> Self {
        self.variant(ButtonVariant::Secondary)
    }
    pub fn ghost(self) -> Self {
        self.variant(ButtonVariant::Ghost)
    }
    pub fn destructive(self) -> Self {
        self.variant(ButtonVariant::Destructive)
    }
    pub fn link(self) -> Self {
        self.variant(ButtonVariant::Link)
    }
    pub fn size(mut self, s: ButtonSize) -> Self {
        self.size = s;
        self
    }
    pub fn label(mut self, l: impl Into<SharedString>) -> Self {
        self.label = Some(l.into());
        self
    }
    pub fn icon(mut self, i: IconName) -> Self {
        self.icon = Some(i);
        self
    }
    pub fn icon_end(mut self, i: IconName) -> Self {
        self.icon_end = Some(i);
        self
    }
    pub fn disabled(mut self, d: bool) -> Self {
        self.disabled = d;
        self
    }
    /// `aria-expanded` / pressed look (ghost & outline).
    pub fn selected(mut self, s: bool) -> Self {
        self.selected = s;
        self
    }
    pub fn w_full(mut self) -> Self {
        self.full_width = true;
        self
    }
    pub fn child(mut self, c: impl IntoElement) -> Self {
        self.children.push(c.into_any_element());
        self
    }
    /// Class overrides like `bg-red-600 text-white hover:bg-red-500 border-transparent`.
    pub fn colors(mut self, bg: Hsla, hover_bg: Hsla, fg: Hsla) -> Self {
        self.colors = Some((bg, hover_bg, fg));
        self
    }
    pub fn on_click(mut self, f: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static) -> Self {
        self.on_click = Some(Box::new(f));
        self
    }
}

struct Look {
    bg: Hsla,
    hover_bg: Hsla,
    fg: Hsla,
    hover_fg: Hsla,
    border: Hsla,
    medium: bool,
    raised: bool,
}

impl RenderOnce for Button {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens();
        let dark = t.dark;
        let clear = gpui::transparent_black();
        let look = match self.variant {
            ButtonVariant::Default => Look {
                bg: t.primary,
                hover_bg: with_alpha(t.primary, 0.9),
                fg: t.var("--primary-foreground").unwrap_or(gpui::white()),
                hover_fg: t.var("--primary-foreground").unwrap_or(gpui::white()),
                border: clear,
                medium: true,
                raised: true,
            },
            ButtonVariant::Outline if dark => Look {
                bg: white(0.03),
                hover_bg: white(0.07),
                fg: tw("neutral-200"),
                hover_fg: tw("white"),
                border: white(0.12),
                medium: false,
                raised: true,
            },
            ButtonVariant::Outline => Look {
                bg: t.background,
                hover_bg: with_alpha(t.muted, 0.6),
                fg: t.foreground,
                hover_fg: t.foreground,
                border: t.border,
                medium: false,
                raised: true,
            },
            ButtonVariant::Secondary => Look {
                bg: if dark { white(0.07) } else { t.muted },
                hover_bg: if dark { white(0.1) } else { with_alpha(t.muted, 0.6) },
                fg: if dark { tw("neutral-100") } else { t.foreground },
                hover_fg: if dark { tw("neutral-100") } else { t.foreground },
                border: clear,
                medium: true,
                raised: true,
            },
            ButtonVariant::Ghost => Look {
                bg: if self.selected { t.muted } else { clear },
                hover_bg: if dark { white(0.06) } else { with_alpha(t.muted, 0.6) },
                fg: if self.selected { t.foreground } else { t.muted_foreground },
                hover_fg: t.foreground,
                border: clear,
                medium: false,
                raised: false,
            },
            ButtonVariant::Destructive => Look {
                bg: if dark { crate::parse_color("#b54444").unwrap() } else { t.destructive },
                hover_bg: if dark { crate::parse_color("#a53c3c").unwrap() } else { with_alpha(t.destructive, 0.9) },
                fg: gpui::white(),
                hover_fg: gpui::white(),
                border: clear,
                medium: true,
                raised: true,
            },
            ButtonVariant::Link => Look {
                bg: clear,
                hover_bg: clear,
                fg: t.foreground,
                hover_fg: t.foreground,
                border: clear,
                medium: false,
                raised: false,
            },
        };
        let look = match self.colors {
            Some((bg, hover_bg, fg)) => Look { bg, hover_bg, fg, hover_fg: fg, border: clear, ..look },
            None => look,
        };
        // .rexa-raised (dark): white/20 border, a ~5% white sheen and a 1px drop shadow.
        let raised = look.raised && dark;
        let (border, bg, hover_bg) = if raised {
            (white(0.2), overlay(look.bg, 0.0525), overlay(look.hover_bg, 0.08))
        } else {
            (look.border, look.bg, look.hover_bg)
        };

        let (h, pad_x, text_xs, icon_size, square) = match self.size {
            ButtonSize::Default => (32., 12., false, 16., false),
            ButtonSize::Xs => (24., 8., true, 12., false),
            ButtonSize::Sm => (28., 10., true, 14., false),
            ButtonSize::Lg => (36., 16., false, 16., false),
            ButtonSize::Icon => (32., 0., false, 16., true),
            ButtonSize::IconXs => (24., 0., false, 12., true),
            ButtonSize::IconSm => (28., 0., false, 14., true),
            ButtonSize::IconLg => (36., 0., false, 16., true),
        };
        let gap = matches!(self.size, ButtonSize::Xs | ButtonSize::Sm).then_some(6.).unwrap_or(8.);
        let link = self.variant == ButtonVariant::Link;

        let mut el = div()
            .id(self.id)
            .flex()
            .flex_shrink_0()
            .items_center()
            .justify_center()
            .gap(px(gap))
            .border_1()
            .border_color(border)
            .bg(bg)
            .text_color(look.fg)
            .whitespace_nowrap()
            .font_weight(if look.medium { FontWeight::MEDIUM } else { FontWeight::NORMAL });
        el = if link { el.gap_1() } else { el.h(px(h)).rounded(px(10.)) };
        el = if square { el.w(px(h)) } else if !link { el.px(px(pad_x)) } else { el };
        el = match (self.size, text_xs) {
            (ButtonSize::Lg, _) => el.tw_text_sm(),
            (_, true) => el.tw_text_xs(),
            _ => el.tw_text_13(),
        };
        if raised {
            el = el.shadow(vec![gpui::BoxShadow {
                color: gpui::hsla(222. / 360., 0.2, 0.08, 0.24),
                offset: gpui::point(px(0.), px(1.)),
                blur_radius: px(2.),
                spread_radius: px(0.),
                inset: false,
            }]);
        }
        if self.full_width {
            el = el.w_full();
        }
        if self.disabled {
            el = el.opacity(0.5);
        } else {
            let (hover_bg, hover_fg) = (hover_bg, look.hover_fg);
            el = el.cursor_pointer().hover(move |s| {
                let s = s.bg(hover_bg).text_color(hover_fg);
                if link { s.underline() } else { s }
            });
            if let Some(handler) = self.on_click {
                el = el.on_click(handler);
            }
        }
        el.children(self.icon.map(|i| Icon::new(i).size(px(icon_size))))
            .children(self.label)
            .children(self.children)
            .children(self.icon_end.map(|i| Icon::new(i).size(px(icon_size))))
    }
}

/// Composite a translucent white sheen over `base` (the raised gradient, averaged).
pub(crate) fn overlay(base: Hsla, alpha: f32) -> Hsla {
    let b: gpui::Rgba = base.into();
    let mix = |c: f32| c + (1. - c) * alpha;
    if b.a == 0. {
        return white(alpha);
    }
    gpui::Rgba { r: mix(b.r), g: mix(b.g), b: mix(b.b), a: b.a.max(alpha) }.into()
}
