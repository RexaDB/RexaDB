//! The old app's theming, ported 1:1: base tokens come from `app/globals.css`
//! (`:root` / `.dark`, exported to assets/theme-base.json), overlaid with the
//! selected app theme (built-ins from lib/studio/app-themes.ts, exported to
//! assets/themes.json, plus the user's `custom_app_themes` setting).

use gpui::{App, Global, Hsla, Rgba};
use serde::Deserialize;
use std::collections::HashMap;

#[derive(Deserialize, Clone)]
struct AppThemeDef {
    id: String,
    base: String,
    colors: HashMap<String, String>,
}

#[derive(Deserialize)]
struct BaseTokens {
    light: HashMap<String, String>,
    dark: HashMap<String, String>,
}

/// Resolved design tokens. Field names mirror the CSS variables.
#[derive(Clone)]
pub struct Tokens {
    pub dark: bool,
    vars: HashMap<String, String>,
    pub background: Hsla,
    pub foreground: Hsla,
    pub card: Hsla,
    pub popover: Hsla,
    pub primary: Hsla,
    pub muted: Hsla,
    pub muted_foreground: Hsla,
    pub accent: Hsla,
    pub accent_foreground: Hsla,
    pub destructive: Hsla,
    pub border: Hsla,
    pub input: Hsla,
    pub ring: Hsla,
    pub sidebar: Hsla,
    pub studio_bg: Hsla,
    pub studio_border: Hsla,
    pub studio_header_bg: Hsla,
    pub studio_row_hover: Hsla,
    pub studio_selection: Hsla,
    pub radius: f32,
}

impl Global for Tokens {}

impl Tokens {
    /// Any CSS variable as a color (for tokens without a dedicated field).
    pub fn var(&self, name: &str) -> Option<Hsla> {
        parse_color(&self.resolve(name)?)
    }

    fn resolve(&self, name: &str) -> Option<String> {
        let mut value = self.vars.get(name)?.trim().to_string();
        for _ in 0..8 {
            let Some(start) = value.find("var(") else { break };
            let end = start + matching_paren(&value[start + 3..])? + 3;
            let inner = &value[start + 4..end];
            let (var, fallback) = match inner.split_once(',') {
                Some((v, f)) => (v.trim(), Some(f.trim())),
                None => (inner.trim(), None),
            };
            let replacement = self
                .vars
                .get(var)
                .cloned()
                .or_else(|| fallback.map(str::to_string))?;
            value.replace_range(start..=end, &replacement);
        }
        Some(value)
    }

    fn color(&self, name: &str) -> Hsla {
        self.var(name).unwrap_or_else(|| {
            eprintln!("theme: unresolved {name}");
            gpui::transparent_black()
        })
    }
}

fn matching_paren(s: &str) -> Option<usize> {
    let mut depth = 0;
    for (i, c) in s.char_indices() {
        match c {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
    }
    None
}

pub fn load(app_theme_id: Option<&str>, custom_themes_json: Option<&str>) -> Tokens {
    let base: BaseTokens = serde_json::from_str(include_str!("../../../assets/theme-base.json")).unwrap();
    let mut themes: Vec<AppThemeDef> = serde_json::from_str(include_str!("../../../assets/themes.json")).unwrap();
    if let Some(custom) = custom_themes_json.and_then(|j| serde_json::from_str::<Vec<AppThemeDef>>(j).ok()) {
        themes.extend(custom);
    }
    let selected = app_theme_id.and_then(|id| themes.iter().find(|t| t.id == id));
    let dark = match (selected, app_theme_id) {
        (Some(theme), _) => theme.base != "light",
        (None, Some("light")) => false,
        _ => true,
    };

    // `.dark` only overrides `:root`, so start from light and layer on top.
    let mut vars = base.light.clone();
    if dark {
        vars.extend(base.dark.clone());
    }
    if let Some(theme) = selected {
        vars.extend(theme.colors.clone());
    }

    let mut t = Tokens {
        dark,
        vars,
        background: Hsla::default(),
        foreground: Hsla::default(),
        card: Hsla::default(),
        popover: Hsla::default(),
        primary: Hsla::default(),
        muted: Hsla::default(),
        muted_foreground: Hsla::default(),
        accent: Hsla::default(),
        accent_foreground: Hsla::default(),
        destructive: Hsla::default(),
        border: Hsla::default(),
        input: Hsla::default(),
        ring: Hsla::default(),
        sidebar: Hsla::default(),
        studio_bg: Hsla::default(),
        studio_border: Hsla::default(),
        studio_header_bg: Hsla::default(),
        studio_row_hover: Hsla::default(),
        studio_selection: Hsla::default(),
        radius: 10.,
    };
    t.background = t.color("--background");
    t.foreground = t.color("--foreground");
    t.card = t.color("--card");
    t.popover = t.color("--popover");
    t.primary = t.color("--primary");
    t.muted = t.color("--muted");
    t.muted_foreground = t.color("--muted-foreground");
    t.accent = t.color("--accent");
    t.accent_foreground = t.color("--accent-foreground");
    t.destructive = t.color("--destructive");
    t.border = t.color("--border");
    t.input = t.color("--input");
    t.ring = t.color("--ring");
    t.sidebar = t.color("--sidebar");
    t.studio_bg = t.color("--studio-bg");
    t.studio_border = t.color("--studio-border");
    t.studio_header_bg = t.color("--studio-header-bg");
    t.studio_row_hover = t.color("--studio-row-hover");
    t.studio_selection = t.color("--studio-selection");
    if let Some(rem) = t.resolve("--radius").and_then(|r| r.strip_suffix("rem").and_then(|n| n.parse::<f32>().ok())) {
        t.radius = rem * 16.;
    }
    t
}

/// Install tokens as a global and map them onto gpui-component's theme so
/// library widgets (editor, table, menus) match the hand-built screens.
pub fn install(tokens: Tokens, cx: &mut App) {
    use gpui_component::theme::{Theme, ThemeMode};
    Theme::change(if tokens.dark { ThemeMode::Dark } else { ThemeMode::Light }, None, cx);
    let theme = Theme::global_mut(cx);
    let c = &mut theme.colors;
    c.background = tokens.background;
    c.foreground = tokens.foreground;
    c.border = tokens.border;
    c.input = tokens.input;
    c.ring = tokens.ring;
    c.muted = tokens.muted;
    c.muted_foreground = tokens.muted_foreground;
    c.accent = tokens.accent;
    c.accent_foreground = tokens.accent_foreground;
    c.popover = tokens.popover;
    c.popover_foreground = tokens.foreground;
    c.primary = tokens.primary;
    c.danger = tokens.destructive;
    c.sidebar = tokens.sidebar;
    c.list = tokens.studio_bg;
    c.list_head = tokens.var("--table-header-bg").unwrap_or(tokens.studio_header_bg);
    c.list_hover = tokens.studio_row_hover;
    c.list_active = tokens.studio_selection;
    c.list_even = tokens.studio_bg;
    c.table = tokens.studio_bg;
    c.table_head = c.list_head;
    c.table_hover = tokens.studio_row_hover;
    c.table_active = tokens.studio_selection;
    c.table_even = tokens.studio_bg;
    c.table_row_border = tokens.studio_border;
    c.selection = tokens.studio_selection;
    theme.radius = gpui::px(tokens.radius);
    theme.font_family = SANS.into();
    theme.mono_font_family = MONO.into();
    cx.set_global(tokens);
}

/// `--font-sans` resolves to SF Pro on macOS. `--font-mono` is "Geist Mono",
/// "SFMono-Regular", Menlo, …; neither of the first two is installed and
/// WebKit doesn't map SFMono-Regular, so the old app renders Menlo.
pub const SANS: &str = ".SystemUIFont";
pub const MONO: &str = "Menlo";

pub trait ActiveTokens {
    fn tokens(&self) -> &Tokens;
}

impl ActiveTokens for App {
    fn tokens(&self) -> &Tokens {
        self.global::<Tokens>()
    }
}

// ---- CSS color parsing -------------------------------------------------------

pub fn parse_color(input: &str) -> Option<Hsla> {
    let s = input.trim().to_ascii_lowercase();
    if s == "transparent" {
        return Some(gpui::transparent_black());
    }
    if let Some(hex) = s.strip_prefix('#') {
        return parse_hex(hex).map(Into::into);
    }
    let (func, args) = s.split_once('(')?;
    let args = args.strip_suffix(')')?;
    let (channels, alpha) = split_alpha(args);
    let alpha = alpha.map_or(Some(1.), |a| parse_number_or_pct(&a, 1.))?;
    match func.trim() {
        "rgb" | "rgba" => {
            let v: Vec<f32> = channels.iter().map(|c| parse_number_or_pct(c, 255.)).collect::<Option<_>>()?;
            Some(Rgba { r: v[0] / 255., g: v[1] / 255., b: v[2] / 255., a: alpha }.into())
        }
        "hsl" | "hsla" => {
            let h = channels.first()?.trim_end_matches("deg").parse::<f32>().ok()?;
            let sat = parse_number_or_pct(channels.get(1)?, 100.)? / 100.;
            let light = parse_number_or_pct(channels.get(2)?, 100.)? / 100.;
            Some(gpui::hsla(h / 360., sat, light, alpha))
        }
        "oklch" => {
            let l = parse_number_or_pct(channels.first()?, 1.)?;
            let c = channels.get(1)?.parse::<f32>().ok()?;
            let h = channels.get(2).map_or(Some(0.), |h| h.trim_end_matches("deg").parse::<f32>().ok())?;
            Some(oklch_to_rgba(l, c, h, alpha).into())
        }
        _ => None,
    }
}

/// Split "r g b / a", "r, g, b, a" or "r g b" into channels and optional alpha.
fn split_alpha(args: &str) -> (Vec<String>, Option<String>) {
    let (main, alpha) = match args.split_once('/') {
        Some((m, a)) => (m, Some(a.trim().to_string())),
        None => (args, None),
    };
    let mut parts: Vec<String> = main
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|p| !p.is_empty())
        .map(str::to_string)
        .collect();
    let alpha = alpha.or_else(|| (parts.len() == 4).then(|| parts.pop().unwrap()));
    (parts, alpha)
}

fn parse_number_or_pct(s: &str, scale: f32) -> Option<f32> {
    match s.trim().strip_suffix('%') {
        Some(p) => Some(p.parse::<f32>().ok()? / 100. * scale),
        None => s.trim().parse().ok(),
    }
}

fn parse_hex(hex: &str) -> Option<Rgba> {
    let expand = |s: &str| -> String { s.chars().flat_map(|c| [c, c]).collect() };
    let full = match hex.len() {
        3 | 4 => expand(hex),
        6 | 8 => hex.to_string(),
        _ => return None,
    };
    let byte = |i: usize| u8::from_str_radix(&full[i..i + 2], 16).ok().map(|b| b as f32 / 255.);
    Some(Rgba {
        r: byte(0)?,
        g: byte(2)?,
        b: byte(4)?,
        a: if full.len() == 8 { byte(6)? } else { 1. },
    })
}

fn oklch_to_rgba(l: f32, c: f32, h: f32, a: f32) -> Rgba {
    let (sin, cos) = h.to_radians().sin_cos();
    let (oa, ob) = (c * cos, c * sin);
    let l_ = (l + 0.396_337_78 * oa + 0.215_803_76 * ob).powi(3);
    let m_ = (l - 0.105_561_346 * oa - 0.063_854_17 * ob).powi(3);
    let s_ = (l - 0.089_484_18 * oa - 1.291_485_5 * ob).powi(3);
    let lin = [
        4.076_741_7 * l_ - 3.307_711_6 * m_ + 0.230_969_94 * s_,
        -1.268_438 * l_ + 2.609_757_4 * m_ - 0.341_319_38 * s_,
        -0.004_196_086_3 * l_ - 0.703_418_6 * m_ + 1.707_614_7 * s_,
    ];
    let gamma = |x: f32| {
        let x = x.clamp(0., 1.);
        if x <= 0.003_130_8 { 12.92 * x } else { 1.055 * x.powf(1. / 2.4) - 0.055 }
    };
    Rgba { r: gamma(lin[0]), g: gamma(lin[1]), b: gamma(lin[2]), a }
}

/// `#rrggbb` + alpha byte, like the `${tone}1a` trick used for tag badges.
pub fn with_alpha(color: Hsla, alpha: f32) -> Hsla {
    Hsla { a: color.a * alpha, ..color }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgb(c: Hsla) -> (u8, u8, u8) {
        let r: Rgba = c.into();
        ((r.r * 255.).round() as u8, (r.g * 255.).round() as u8, (r.b * 255.).round() as u8)
    }

    #[test]
    fn parses_css_colors() {
        assert_eq!(rgb(parse_color("#111113").unwrap()), (0x11, 0x11, 0x13));
        assert_eq!(rgb(parse_color("rgba(59, 130, 246, 0.18)").unwrap()), (59, 130, 246));
        assert_eq!(rgb(parse_color("oklch(1 0 0)").unwrap()), (255, 255, 255));
        assert_eq!(rgb(parse_color("oklch(0.145 0 0)").unwrap()), (10, 10, 10));
    }

    #[test]
    fn resolves_rexadb_dark() {
        let t = load(Some("rexadb-dark"), None);
        assert!(t.dark);
        assert_eq!(rgb(t.background), (0x11, 0x11, 0x13));
        assert_eq!(rgb(t.studio_border), (0x36, 0x3a, 0x3f));
        assert_eq!(t.radius, 10.);
    }
}
