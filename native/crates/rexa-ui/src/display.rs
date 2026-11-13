//! Display primitives:
//! - components/ui/skeleton.tsx (`Skeleton`, `animate-pulse`)
//! - components/ui/progress.tsx (`Progress`)
//! - components/ui/avatar.tsx (`Avatar`, `AvatarGroup`) and components/fallback-avatar.tsx (`FallbackAvatar`)
//! - components/ui/card.tsx (`Card`)
//! - components/ui/alert.tsx (`Alert`)
//! - components/ui/table.tsx (`Table`)
//! - the `animate-spin` border spinner used by multi-select and others (`Spinner`)

use crate::popup;
use crate::theme::with_alpha;
use crate::{ActiveTokens, Tw};
use gpui::{
    div, img, prelude::*, px, svg, AnimationExt, AnyElement, App, ElementId, FontWeight, Image,
    ImageFormat, ImageSource, ObjectFit, SharedString, Transformation, Window,
};
use std::sync::Arc;
use std::time::Duration;

// ---- Spinner -------------------------------------------------------------------------

/// `animate-spin rounded-full border border-muted-foreground/30 border-t-muted-foreground`.
#[derive(IntoElement)]
pub struct Spinner {
    size: f32,
}

impl Spinner {
    pub fn new(size: f32) -> Self {
        Self { size }
    }
}

impl RenderOnce for Spinner {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let c = cx.tokens().muted_foreground;
        let s = self.size;
        div()
            .relative()
            .size(px(s))
            .rounded_full()
            .border_1()
            .border_color(with_alpha(c, 0.3))
            .child(
                svg()
                    .path("ui/spinner-arc.svg")
                    .absolute()
                    .top(px(-1.))
                    .left(px(-1.))
                    .size(px(s))
                    .text_color(c)
                    .with_animation("spin", gpui::Animation::new(Duration::from_secs(1)).repeat(), |e, t| {
                        e.with_transformation(Transformation::rotate(gpui::percentage(t)))
                    }),
            )
    }
}

// ---- Skeleton ------------------------------------------------------------------------

/// `animate-pulse rounded-md bg-muted` (2s cubic-bezier(.4,0,.6,1), opacity 1 → .5 → 1).
/// `style` sizes it, e.g. `|d| d.h_4().w(px(200.))`.
pub fn skeleton(id: impl Into<ElementId>, style: impl FnOnce(gpui::Div) -> gpui::Div, cx: &App) -> gpui::AnimationElement<gpui::Div> {
    style(div())
        .tw_rounded_md()
        .bg(cx.tokens().muted)
        .with_animation(id, gpui::Animation::new(Duration::from_secs(2)).repeat(), |d, t| {
            let k = if t < 0.5 { t * 2. } else { (1. - t) * 2. };
            d.opacity(1. - 0.5 * popup::cubic_bezier(0.4, 0., 0.6, 1., k))
        })
}

// ---- Progress ------------------------------------------------------------------------

/// `bg-muted relative h-2 w-full overflow-hidden rounded-lg` + `bg-primary` indicator.
#[derive(IntoElement)]
pub struct Progress {
    value: f32,
    h: f32,
}

impl Progress {
    /// `value` in 0..=100.
    pub fn new(value: f32) -> Self {
        Self { value, h: 8. }
    }
    pub fn h(mut self, h: f32) -> Self {
        self.h = h;
        self
    }
}

impl RenderOnce for Progress {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens();
        div()
            .relative()
            .w_full()
            .h(px(self.h))
            .overflow_hidden()
            .tw_rounded_lg()
            .bg(t.muted)
            .child(div().h_full().w(gpui::relative(self.value.clamp(0., 100.) / 100.)).bg(t.primary))
    }
}

// ---- Avatar --------------------------------------------------------------------------

#[derive(Clone, Copy, PartialEq, Default)]
pub enum AvatarSize {
    Sm,
    #[default]
    Default,
    Lg,
}

impl AvatarSize {
    fn px(self) -> f32 {
        match self {
            AvatarSize::Sm => 24.,
            AvatarSize::Default => 32.,
            AvatarSize::Lg => 40.,
        }
    }
}

/// `Avatar` + `AvatarImage` / `AvatarFallback` (+ optional `AvatarBadge`).
#[derive(IntoElement)]
pub struct Avatar {
    size: AvatarSize,
    image: Option<ImageSource>,
    fallback: Option<SharedString>,
    fallback_el: Option<AnyElement>,
    badge: Option<AnyElement>,
    ring: bool,
}

impl Avatar {
    pub fn new() -> Self {
        Self { size: AvatarSize::Default, image: None, fallback: None, fallback_el: None, badge: None, ring: false }
    }
    pub fn size(mut self, s: AvatarSize) -> Self {
        self.size = s;
        self
    }
    pub fn image(mut self, src: impl Into<ImageSource>) -> Self {
        self.image = Some(src.into());
        self
    }
    /// Initials shown when there's no image.
    pub fn fallback(mut self, text: impl Into<SharedString>) -> Self {
        self.fallback = Some(text.into());
        self
    }
    /// Any fallback element (e.g. a [`FallbackAvatar`]).
    pub fn fallback_el(mut self, el: impl IntoElement) -> Self {
        self.fallback_el = Some(el.into_any_element());
        self
    }
    /// `AvatarBadge` content (dot or tiny icon).
    pub fn badge(mut self, el: impl IntoElement) -> Self {
        self.badge = Some(el.into_any_element());
        self
    }
    /// `ring-2 ring-background` (inside an `AvatarGroup`).
    pub fn ring(mut self) -> Self {
        self.ring = true;
        self
    }
}

impl Default for Avatar {
    fn default() -> Self {
        Self::new()
    }
}

impl RenderOnce for Avatar {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let s = self.size.px();
        let content = match (self.image, self.fallback_el) {
            (Some(src), _) => img(src).size_full().rounded_full().object_fit(ObjectFit::Cover).into_any_element(),
            (None, Some(el)) => el,
            (None, None) => div()
                .flex()
                .size_full()
                .items_center()
                .justify_center()
                .rounded_full()
                .bg(t.muted)
                .text_color(t.muted_foreground)
                .map(|d| if self.size == AvatarSize::Sm { d.tw_text_xs() } else { d.tw_text_sm() })
                .children(self.fallback)
                .into_any_element(),
        };
        let badge_size = match self.size {
            AvatarSize::Sm => 8.,
            AvatarSize::Default => 10.,
            AvatarSize::Lg => 12.,
        };
        div()
            .relative()
            .flex()
            .flex_shrink_0()
            .size(px(s))
            .rounded_full()
            .when(self.ring, |d| d.shadow(vec![gpui::BoxShadow {
                color: t.background,
                offset: gpui::point(px(0.), px(0.)),
                blur_radius: px(0.),
                spread_radius: px(2.),
                inset: false,
            }]))
            .child(content)
            // after:border after:border-border (mix-blend lighten/darken ≈ plain border)
            .child(div().absolute().inset_0().rounded_full().border_1().border_color(t.border))
            .children(self.badge.map(|b| {
                div()
                    .absolute()
                    .right_0()
                    .bottom_0()
                    .size(px(badge_size))
                    .flex()
                    .items_center()
                    .justify_center()
                    .rounded_full()
                    .bg(t.primary)
                    .text_color(t.var_or("--primary-foreground", gpui::white()))
                    .shadow(vec![popup::ring(t.background), gpui::BoxShadow {
                        color: t.background,
                        offset: gpui::point(px(0.), px(0.)),
                        blur_radius: px(0.),
                        spread_radius: px(2.),
                        inset: false,
                    }])
                    .when(self.size != AvatarSize::Sm, |d| d.child(b))
            }))
    }
}

/// `AvatarGroup`: `flex -space-x-2`, each avatar ringed; optional `AvatarGroupCount`.
pub fn avatar_group(avatars: impl IntoIterator<Item = Avatar>, count: Option<SharedString>, cx: &App) -> impl IntoElement {
    let t = cx.tokens().clone();
    div()
        .flex()
        .children(avatars.into_iter().enumerate().map(|(i, a)| div().when(i > 0, |d| d.ml(px(-8.))).child(a.ring())))
        .children(count.map(|c| {
            div()
                .ml(px(-8.))
                .size_8()
                .flex()
                .items_center()
                .justify_center()
                .rounded_full()
                .bg(t.muted)
                .text_color(t.muted_foreground)
                .tw_text_sm()
                .child(c)
        }))
}

// ---- FallbackAvatar ------------------------------------------------------------------

/// components/fallback-avatar.tsx: a deterministic gradient blob avatar from a
/// name. The original renders a WebGL fragment shader; this evaluates the
/// same shader on the CPU (at T = 0, 2× density) once per name and size.
/// The hover animation (shader time running) is not reproduced.
#[derive(IntoElement)]
pub struct FallbackAvatar {
    name: SharedString,
    size: f32,
}

impl FallbackAvatar {
    pub fn new(name: impl Into<SharedString>, size: f32) -> Self {
        Self { name: name.into(), size }
    }
}

impl RenderOnce for FallbackAvatar {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        img(fallback_avatar_image(&self.name, self.size)).flex_shrink_0().size(px(self.size)).rounded_full()
    }
}

fn hash_string(s: &str) -> (u32, u32) {
    let (mut h1, mut h2) = (0xdeadbeefu32, 0x41c6ce57u32);
    for ch in s.encode_utf16() {
        h1 = (h1 ^ ch as u32).wrapping_mul(2654435761);
        h2 = (h2 ^ ch as u32).wrapping_mul(1597334677);
    }
    h1 = (h1 ^ (h1 >> 16)).wrapping_mul(2246822507);
    h1 ^= (h2 ^ (h2 >> 13)).wrapping_mul(3266489909);
    h2 = (h2 ^ (h2 >> 16)).wrapping_mul(2246822507);
    h2 ^= (h1 ^ (h1 >> 13)).wrapping_mul(3266489909);
    (h1, h2)
}

fn mulberry32(mut seed: u32) -> impl FnMut() -> f32 {
    move || {
        seed = seed.wrapping_add(0x6d2b79f5);
        let mut t = (seed ^ (seed >> 15)).wrapping_mul(1 | seed);
        t = t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t)) ^ t;
        ((t ^ (t >> 14)) as f64 / 4294967296.) as f32
    }
}

fn derive_hue(h: (u32, u32)) -> f32 {
    let mut sum = 0u32;
    for i in 0..4 {
        sum += (h.0 >> (i * 8)) & 0xff;
        sum += (h.1 >> (i * 8)) & 0xff;
    }
    (sum % 360) as f32
}

fn oklch_rgb(l: f32, c: f32, h: f32) -> [f32; 3] {
    let rgba: gpui::Rgba = crate::parse_color(&format!("oklch({l} {c} {h})")).unwrap_or_default().into();
    // Match the original's rounding to 8-bit before use.
    [(rgba.r * 255.).round() / 255., (rgba.g * 255.).round() / 255., (rgba.b * 255.).round() / 255.]
}

pub fn fallback_avatar_image(name: &str, size: f32) -> Arc<Image> {
    use std::collections::HashMap;
    use std::sync::Mutex;
    static CACHE: Mutex<Option<HashMap<(String, u32), Arc<Image>>>> = Mutex::new(None);
    let px_size = (size * 2.).round().max(2.) as u32;
    let key = (name.to_string(), px_size);
    if let Some(img) = CACHE.lock().unwrap().get_or_insert_with(HashMap::new).get(&key) {
        return img.clone();
    }
    let hash = hash_string(name);
    let mut rng = mulberry32(hash.0);
    let hue = derive_hue(hash);
    let (c1, c2) = (oklch_rgb(0.8, 0.18, hue), oklch_rgb(0.45, 0.18, hue));
    let p: Vec<f32> = (0..8).map(|_| rng()).collect();
    let (b1, b2, b3) = ((p[0], p[1]), (p[2], p[3]), (p[4], p[5]));
    // T = 0
    let c1p = (b1.0 + (b1.0 * 6.).sin() * 0.08, b1.1 + (b1.1 * 6.).cos() * 0.08);
    let c2p = (b2.0 + 2.1f32.sin() * 0.1, b2.1 + 1.3f32.cos() * 0.07);
    let c3p = (b3.0 + 4.2f32.sin() * 0.07, b3.1 + 3.7f32.cos() * 0.09);
    let (k2, k3) = (1. + 1f32.sin() * 0.05, 1. + 2f32.sin() * 0.05);
    let c3col = [0, 1, 2].map(|i| c1[i] + (c2[i] - c1[i]) * 0.5);
    let n = px_size as usize;
    // 32-bit BMP, bottom-up rows = GL's gl_FragCoord orientation.
    let mut data = Vec::with_capacity(54 + n * n * 4);
    let file_size = (54 + n * n * 4) as u32;
    data.extend_from_slice(b"BM");
    data.extend_from_slice(&file_size.to_le_bytes());
    data.extend_from_slice(&[0, 0, 0, 0]);
    data.extend_from_slice(&54u32.to_le_bytes());
    data.extend_from_slice(&40u32.to_le_bytes());
    data.extend_from_slice(&(n as i32).to_le_bytes());
    data.extend_from_slice(&(n as i32).to_le_bytes());
    data.extend_from_slice(&1u16.to_le_bytes());
    data.extend_from_slice(&32u16.to_le_bytes());
    data.extend_from_slice(&[0u8; 24]);
    let dist = |u: (f32, f32), c: (f32, f32)| ((u.0 - c.0).powi(2) + (u.1 - c.1).powi(2)).sqrt();
    for y in 0..n {
        for x in 0..n {
            let uv = ((x as f32 + 0.5) / n as f32, (y as f32 + 0.5) / n as f32);
            let d1 = (1. - dist(uv, c1p) * 1.5).max(0.);
            let d2 = ((1. - dist(uv, c2p) * 1.5) * k2).max(0.);
            let d3 = ((1. - dist(uv, c3p) * 1.5) * k3).max(0.);
            let mut col = [0f32; 3];
            for i in 0..3 {
                col[i] = 1. - (1. - col[i]) * (1. - c1[i] * d1);
                col[i] = 1. - (1. - col[i]) * (1. - c2[i] * d2);
                col[i] = (1. - (1. - col[i]) * (1. - c3col[i] * d3)).clamp(0., 1.);
            }
            let b = |v: f32| (v * 255.).round() as u8;
            data.extend_from_slice(&[b(col[2]), b(col[1]), b(col[0]), 255]);
        }
    }
    let image = Arc::new(Image::from_bytes(ImageFormat::Bmp, data));
    CACHE.lock().unwrap().get_or_insert_with(HashMap::new).insert(key, image.clone());
    image
}

// ---- Card ----------------------------------------------------------------------------

/// `Card` (+ header title / description / action, content, footer).
#[derive(IntoElement)]
pub struct Card {
    small: bool,
    title: Option<SharedString>,
    description: Option<SharedString>,
    action: Option<AnyElement>,
    children: Vec<AnyElement>,
    footer: Option<AnyElement>,
}

impl Card {
    pub fn new() -> Self {
        Self { small: false, title: None, description: None, action: None, children: Vec::new(), footer: None }
    }
    /// `size="sm"`
    pub fn small(mut self) -> Self {
        self.small = true;
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
    /// `CardAction` (top-right of the header).
    pub fn action(mut self, el: impl IntoElement) -> Self {
        self.action = Some(el.into_any_element());
        self
    }
    /// `CardFooter`
    pub fn footer(mut self, el: impl IntoElement) -> Self {
        self.footer = Some(el.into_any_element());
        self
    }
}

impl Default for Card {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for Card {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Card {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let (pad, gap) = if self.small { (12., 12.) } else { (16., 16.) };
        let has_header = self.title.is_some() || self.description.is_some() || self.action.is_some();
        let header = has_header.then(|| {
            div()
                .flex()
                .items_start()
                .justify_between()
                .px(px(pad))
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .children(self.title.map(|x| {
                            let d = div().font_weight(FontWeight::MEDIUM);
                            if self.small { d.tw_text_xs() } else { d.text_size(px(14.)).line_height(px(19.25)) }.child(x)
                        }))
                        .children(self.description.map(|x| div().tw_text_xs().text_color(t.muted_foreground).child(x))),
                )
                .children(self.action)
        });
        let has_footer = self.footer.is_some();
        div()
            .flex()
            .flex_col()
            .gap(px(gap))
            .py(px(pad))
            .when(has_footer, |d| d.pb_0())
            .overflow_hidden()
            .tw_rounded_lg()
            .bg(t.card)
            .text_color(t.var_or("--card-foreground", t.foreground))
            .tw_text_sm()
            .shadow(vec![popup::ring(with_alpha(t.foreground, 0.1))])
            .children(header)
            .when(!self.children.is_empty(), |d| d.child(div().px(px(pad)).children(self.children)))
            .children(self.footer.map(|f| {
                div()
                    .flex()
                    .items_center()
                    .p(px(pad))
                    .border_t_1()
                    .border_color(t.border)
                    .bg(with_alpha(t.muted, 0.5))
                    .child(f)
            }))
    }
}

// ---- Alert ---------------------------------------------------------------------------

/// `Alert` with `AlertTitle` / `AlertDescription`.
#[derive(IntoElement)]
pub struct Alert {
    destructive: bool,
    title: Option<SharedString>,
    description: Option<SharedString>,
    children: Vec<AnyElement>,
}

impl Alert {
    pub fn new() -> Self {
        Self { destructive: false, title: None, description: None, children: Vec::new() }
    }
    pub fn destructive(mut self) -> Self {
        self.destructive = true;
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
}

impl Default for Alert {
    fn default() -> Self {
        Self::new()
    }
}

impl ParentElement for Alert {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Alert {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let (border, bg, fg) = if self.destructive {
            (with_alpha(t.destructive, 0.5), with_alpha(t.destructive, 0.1), t.destructive)
        } else {
            (t.border, t.background, t.foreground)
        };
        div()
            .relative()
            .w_full()
            .px_4()
            .py_3()
            .tw_rounded_lg()
            .border_1()
            .border_color(border)
            .bg(bg)
            .text_color(fg)
            .tw_text_sm()
            .children(self.title.map(|x| {
                div().mb_1().font_weight(FontWeight::MEDIUM).line_height(px(14.)).child(crate::tight(x))
            }))
            .children(self.description.map(|x| div().text_size(px(14.)).line_height(px(22.75)).child(x)))
            .children(self.children)
    }
}

// ---- Table ---------------------------------------------------------------------------

/// table.tsx: `w-full text-sm`; head cells `h-10 px-2 font-medium`, body cells
/// `p-2`, rows `border-b hover:bg-muted/50` (selected `bg-muted`), last row no border.
/// HTML auto table layout is emulated with explicit column widths (`None` = share the rest).
#[derive(IntoElement)]
pub struct Table {
    id: ElementId,
    widths: Vec<Option<f32>>,
    header: Vec<AnyElement>,
    rows: Vec<(Vec<AnyElement>, bool)>,
    footer: Option<Vec<AnyElement>>,
    caption: Option<SharedString>,
}

impl Table {
    pub fn new(id: impl Into<ElementId>) -> Self {
        Self { id: id.into(), widths: Vec::new(), header: Vec::new(), rows: Vec::new(), footer: None, caption: None }
    }
    pub fn columns(mut self, widths: impl IntoIterator<Item = Option<f32>>) -> Self {
        self.widths = widths.into_iter().collect();
        self
    }
    pub fn header(mut self, cells: impl IntoIterator<Item = AnyElement>) -> Self {
        self.header = cells.into_iter().collect();
        self
    }
    pub fn row(mut self, cells: impl IntoIterator<Item = AnyElement>) -> Self {
        self.rows.push((cells.into_iter().collect(), false));
        self
    }
    /// `data-state="selected"`
    pub fn selected_row(mut self, cells: impl IntoIterator<Item = AnyElement>) -> Self {
        self.rows.push((cells.into_iter().collect(), true));
        self
    }
    pub fn footer(mut self, cells: impl IntoIterator<Item = AnyElement>) -> Self {
        self.footer = Some(cells.into_iter().collect());
        self
    }
    pub fn caption(mut self, c: impl Into<SharedString>) -> Self {
        self.caption = Some(c.into());
        self
    }
}

impl RenderOnce for Table {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let widths = self.widths.clone();
        let cell = move |i: usize, el: AnyElement, head: bool| {
            let d = div().flex().items_center().min_w_0().overflow_hidden().whitespace_nowrap();
            let d = match widths.get(i).copied().flatten() {
                Some(w) => d.w(px(w)).flex_shrink_0(),
                None => d.flex_1(),
            };
            if head { d.h_10().px_2().font_weight(FontWeight::MEDIUM).text_color(t.foreground) } else { d.p_2() }.child(el)
        };
        let n = self.rows.len();
        let has_header = !self.header.is_empty();
        div()
            .id(self.id)
            .w_full()
            .overflow_x_scroll()
            .tw_text_sm()
            .flex()
            .flex_col()
            .when(has_header, |d| {
                d.child(div().flex().w_full().border_b_1().border_color(t.border).children(self.header.into_iter().enumerate().map(|(i, c)| cell(i, c, true))))
            })
            .children(self.rows.into_iter().enumerate().map(|(r, (cells, selected))| {
                div()
                    .id(("row", r))
                    .flex()
                    .w_full()
                    .when(r + 1 < n, |d| d.border_b_1().border_color(t.border))
                    .when(selected, |d| d.bg(t.muted))
                    .hover(|s| s.bg(with_alpha(t.muted, 0.5)))
                    .children(cells.into_iter().enumerate().map(|(i, c)| cell(i, c, false)))
            }))
            .children(self.footer.map(|cells| {
                div()
                    .flex()
                    .w_full()
                    .border_t_1()
                    .border_color(t.border)
                    .bg(with_alpha(t.muted, 0.5))
                    .font_weight(FontWeight::MEDIUM)
                    .children(cells.into_iter().enumerate().map(|(i, c)| cell(i, c, false)))
            }))
            .children(self.caption.map(|c| div().mt_4().tw_text_sm().text_color(t.muted_foreground).text_center().child(c)))
    }
}
