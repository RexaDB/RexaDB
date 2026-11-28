//! Port of components/studio/theme-creator/{theme-creator-panel,theme-panel-shell,
//! color-control,theme-colors-shared}.tsx: the 340px side panel that edits a
//! copy of the active app theme with live preview (the draft is installed as
//! the app theme until saved or discarded). The visual icon-theme creator
//! (icon-theme-creator-panel.tsx, icon-item.tsx) is reduced to its shell plus
//! manifest import.

use crate::model::{builtin_app_themes, NamedTheme, SettingsModel};
use crate::view::SettingsView;
use gpui::{div, prelude::*, px, App, Context, Entity, FontWeight, SharedString, WeakEntity, Window};
use gpui_component::Icon;
use rexa_ui::{parse_color, tw, with_alpha, ActiveTokens, Align, Button, ButtonSize, IconName, Popover, Tw};
use serde_json::{json, Map, Value};
use std::collections::{BTreeSet, HashSet};

pub const CATEGORIES: &[(&str, &str, &[(&str, &str)])] = &[
    ("bg", "Background", &[("--background", "Background"), ("--card", "Card"), ("--popover", "Popover"), ("--sidebar", "Sidebar")]),
    (
        "text",
        "Text",
        &[("--foreground", "Foreground"), ("--card-foreground", "Card Foreground"), ("--popover-foreground", "Popover Foreground"), ("--muted-foreground", "Muted Foreground"), ("--sidebar-foreground", "Sidebar Foreground")],
    ),
    (
        "primary",
        "Primary & Accent",
        &[
            ("--primary", "Primary"),
            ("--primary-foreground", "Primary Foreground"),
            ("--ring", "Ring"),
            ("--accent", "Accent"),
            ("--accent-foreground", "Accent Foreground"),
            ("--sidebar-primary", "Sidebar Primary"),
            ("--sidebar-primary-foreground", "Sidebar Primary Foreground"),
        ],
    ),
    (
        "secondary",
        "Secondary & Muted",
        &[("--secondary", "Secondary"), ("--secondary-foreground", "Secondary Foreground"), ("--muted", "Muted"), ("--sidebar-accent", "Sidebar Accent"), ("--sidebar-accent-foreground", "Sidebar Accent Foreground")],
    ),
    ("border", "Borders & Inputs", &[("--border", "Border"), ("--input", "Input"), ("--sidebar-border", "Sidebar Border"), ("--sidebar-ring", "Sidebar Ring")]),
    (
        "studio",
        "Studio UI",
        &[
            ("--studio-bg", "Studio Background"),
            ("--studio-border", "Studio Border"),
            ("--studio-header-bg", "Header Background"),
            ("--table-header-bg", "Table Header"),
            ("--studio-cell-text", "Cell Text"),
            ("--studio-cell-muted", "Cell Muted"),
            ("--studio-tab-active", "Tab Active"),
            ("--studio-tab-inactive", "Tab Inactive"),
            ("--studio-row-hover", "Row Hover"),
            ("--studio-selection", "Selection"),
        ],
    ),
    ("status", "Status Colors", &[("--destructive", "Destructive"), ("--chart-1", "Chart 1"), ("--chart-2", "Chart 2"), ("--chart-3", "Chart 3"), ("--chart-4", "Chart 4"), ("--chart-5", "Chart 5")]),
];

pub const COLOR_PRESETS: &[&str] = &[
    "#000000", "#1a1a1a", "#2d2d2d", "#3d3d3d", "#555555", "#777777", "#999999", "#aaaaaa", "#cccccc", "#dddddd", "#eeeeee", "#f5f5f5", "#ffffff", "#0f172a",
    "#1e293b", "#334155", "#475569", "#64748b", "#94a3b8", "#cbd5e1", "#0a0a0a", "#18181b", "#27272a", "#3f3f46", "#52525b", "#a1a1aa", "#d4d4d8", "#020617",
    "#1e3a5f", "#1e40af", "#2563eb", "#3b82f6", "#60a5fa", "#052e16", "#14532d", "#166534", "#22c55e", "#4ade80", "#86efac", "#7c2d12", "#9a3412", "#ea580c",
    "#f97316", "#fb923c", "#fdba74", "#881337", "#9f1239", "#e11d48", "#f43f5e", "#fb7185", "#fda4af", "#4c1d95", "#6d28d9", "#8b5cf6", "#a78bfa", "#c4b5fd",
    "#ddd6fe", "#0f766e", "#14b8a6", "#2dd4bf", "#5eead4", "#99f6e4", "#854d0e", "#ca8a04", "#eab308", "#facc15", "#fde047",
];

/// toHex.
pub fn to_hex(color: &str) -> String {
    let c = color.trim();
    if c.len() == 7 && c.starts_with('#') && c[1..].chars().all(|x| x.is_ascii_hexdigit()) {
        return c.to_lowercase();
    }
    match parse_color(c) {
        Some(h) => {
            let r: gpui::Rgba = h.into();
            format!("#{:02x}{:02x}{:02x}", (r.r * 255.).round() as u8, (r.g * 255.).round() as u8, (r.b * 255.).round() as u8)
        }
        None => "#888888".into(),
    }
}

/// createThemeNameFromId.
fn name_from_id(id: &str) -> String {
    id.split('-').map(|w| w.chars().next().map(|f| f.to_uppercase().collect::<String>() + &w[f.len_utf8()..]).unwrap_or_default()).collect::<Vec<_>>().join(" ")
}

/// The active app theme as a full theme object (built-ins come from themes.json).
fn active_theme(m: &SettingsModel, cx: &App) -> Option<(String, String, Map<String, Value>)> {
    let id = crate::model::resolve_theme_id(&m.app_theme_id, cx.window_appearance());
    if let Some(t) = m.custom_app_themes.iter().find(|t| t.id == id) {
        return Some((t.name.clone(), t.base.clone(), t.raw["colors"].as_object().cloned().unwrap_or_default()));
    }
    let all: Vec<Value> = serde_json::from_str(include_str!("../../../assets/themes.json")).unwrap_or_default();
    all.into_iter().find(|t| t["id"] == id.as_str()).map(|t| {
        (t["name"].as_str().unwrap_or_default().to_string(), t["base"].as_str().unwrap_or("dark").to_string(), t["colors"].as_object().cloned().unwrap_or_default())
    })
}

pub struct ThemeCreatorPanel {
    model: Entity<SettingsModel>,
    view: WeakEntity<SettingsView>,
    theme: Option<(String, String, Map<String, Value>)>,
    draft: Map<String, Value>,
    collapsed: BTreeSet<&'static str>,
    saved: bool,
}

impl ThemeCreatorPanel {
    pub fn new(model: Entity<SettingsModel>, view: WeakEntity<SettingsView>, _: &mut Window, cx: &mut Context<Self>) -> Self {
        let theme = active_theme(model.read(cx), cx);
        let draft = theme.as_ref().map(|t| t.2.clone()).unwrap_or_default();
        Self { model, view, theme, draft, collapsed: BTreeSet::new(), saved: false }
    }

    /// Live preview: install the draft as a temporary custom theme.
    fn preview(&self, cx: &mut App) {
        let Some((_, base, _)) = &self.theme else { return };
        let mut customs: Vec<Value> = self.model.read(cx).custom_app_themes.iter().map(|t| t.raw.clone()).collect();
        customs.push(json!({"id": "__theme-creator-draft__", "name": "Draft", "base": base, "colors": self.draft}));
        rexa_ui::theme::install(rexa_ui::theme::load(Some("__theme-creator-draft__"), Some(&Value::Array(customs).to_string())), cx);
        cx.refresh_windows();
    }

    fn restore(&self, cx: &mut App) {
        let (id, custom) = {
            let m = self.model.read(cx);
            (m.app_theme_id.clone(), m.custom_app_themes_json())
        };
        crate::model::apply_app_theme(&id, &custom, cx);
    }

    fn close(&mut self, cx: &mut Context<Self>) {
        if !self.saved {
            self.restore(cx);
        }
        self.view.update(cx, |v, cx| v.close_side_panel(cx)).ok();
    }

    fn set_color(&mut self, key: &str, value: String, cx: &mut Context<Self>) {
        self.draft.insert(key.to_string(), Value::from(value));
        self.preview(cx);
        cx.notify();
    }

    /// handleSave: "<name> Custom" copy, selected as the app theme.
    fn save(&mut self, cx: &mut Context<Self>) {
        let Some((name, base, _)) = self.theme.clone() else { return };
        self.saved = true;
        let draft = self.draft.clone();
        self.model.update(cx, |m, cx| {
            let ids: HashSet<String> = builtin_app_themes().into_iter().map(|t| t.0).chain(m.custom_app_themes.iter().map(|t| t.id.clone())).collect();
            let id = crate::theme_util::create_theme_id(&format!("{name} Custom"), &ids);
            let theme_name = name_from_id(&id);
            let raw = json!({"id": id, "name": theme_name, "base": base, "colors": draft});
            let mut list = m.custom_app_themes.clone();
            list.push(NamedTheme { id: id.clone(), name: theme_name, base, raw });
            m.set_custom_app_themes(list, cx);
            m.set_app_theme(&id, cx);
        });
        self.view.update(cx, |v, cx| v.close_side_panel(cx)).ok();
    }

    fn has_changes(&self) -> bool {
        self.theme.as_ref().is_some_and(|(_, _, orig)| self.draft.iter().any(|(k, v)| orig.get(k) != Some(v)))
    }
}

pub fn panel_header(title: &'static str, on_close: impl Fn(&mut Window, &mut App) + 'static, cx: &App) -> impl IntoElement {
    let t = cx.tokens().clone();
    div()
        .h(px(44.))
        .flex()
        .items_center()
        .justify_between()
        .border_b_1()
        .border_color(t.studio_border)
        .px_3()
        .child(div().flex().items_center().gap_2().child(Icon::new(IconName::Palette).size_4().text_color(t.muted_foreground)).child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(title)))
        .child(
            div()
                .id("theme-panel-close")
                .size_6()
                .flex()
                .items_center()
                .justify_center()
                .tw_rounded_lg()
                .text_color(t.muted_foreground)
                .hover(|s| s.bg(with_alpha(t.studio_border, 0.3)).text_color(t.foreground))
                .cursor_pointer()
                .on_click(move |_, w, cx| on_close(w, cx))
                .child(Icon::new(IconName::X).size(px(14.))),
        )
}

/// ColorControl: label, hex value and a swatch opening the preset palette.
fn color_control(id: String, label: &'static str, value: String, default: String, on_change: impl Fn(String, &mut Window, &mut App) + Clone + 'static, cx: &App) -> impl IntoElement {
    let t = cx.tokens().clone();
    let hex = to_hex(&value);
    let modified = value != default;
    let swatch = parse_color(&value).unwrap_or(gpui::black());
    let (oc, od) = (on_change.clone(), on_change);
    div()
        .flex()
        .items_center()
        .gap_2()
        .py_1()
        .child(
            Popover::new(SharedString::from(format!("cc-{id}")))
                .align(Align::Start)
                .w(Some(224.))
                .p(8.)
                .trigger(div().size_6().tw_rounded_md().border_1().border_color(t.studio_border).bg(swatch).cursor_pointer())
                .content(move |ctl, _, _| {
                    let mut grid = div().flex().flex_wrap().gap_1();
                    for (i, c) in COLOR_PRESETS.iter().enumerate() {
                        let (oc, ctl) = (oc.clone(), ctl.clone());
                        grid = grid.child(
                            div()
                                .id(("preset", i))
                                .size_5()
                                .rounded(px(4.))
                                .bg(parse_color(c).unwrap_or(gpui::black()))
                                .cursor_pointer()
                                .on_click(move |_, w, cx| {
                                    oc(c.to_string(), w, cx);
                                    ctl.close(w, cx);
                                }),
                        );
                    }
                    grid
                }),
        )
        .child(div().flex_1().min_w_0().tw_text_xs().child(label))
        .child(div().font_family(rexa_ui::MONO).tw_text_11().text_color(t.muted_foreground).child(hex))
        .when(modified, |d| {
            d.child(
                div()
                    .id(SharedString::from(format!("cc-reset-{id}")))
                    .text_color(t.muted_foreground)
                    .hover(|s| s.text_color(t.foreground))
                    .cursor_pointer()
                    .on_click(move |_, w, cx| od(default.clone(), w, cx))
                    .child(Icon::new(IconName::RotateCcw).size_3()),
            )
        })
}

pub fn panel_footer(has_changes: bool, save_label: &'static str, on_reset: impl Fn(&mut Window, &mut App) + 'static, on_discard: impl Fn(&mut Window, &mut App) + 'static, on_save: impl Fn(&mut Window, &mut App) + 'static, cx: &App) -> impl IntoElement {
    let t = cx.tokens().clone();
    div()
        .flex()
        .items_center()
        .justify_between()
        .border_t_1()
        .border_color(t.studio_border)
        .px_3()
        .py(px(10.))
        .child(
            div()
                .id("theme-reset-all")
                .tw_text_xs()
                .text_color(t.muted_foreground)
                .when(!has_changes, |d| d.opacity(0.3))
                .when(has_changes, |d| d.cursor_pointer().hover(|s| s.text_color(t.foreground)).on_click(move |_, w, cx| on_reset(w, cx)))
                .child("Reset All"),
        )
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .child(Button::new("theme-discard").ghost().size(ButtonSize::Sm).label("Discard").on_click(move |_, w, cx| on_discard(w, cx)))
                .child(Button::new("theme-save").size(ButtonSize::Sm).icon(IconName::Check).label(save_label).disabled(!has_changes).on_click(move |_, w, cx| on_save(w, cx))),
        )
}

impl Render for ThemeCreatorPanel {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let this = cx.entity();
        let (c1, c2, c3, c4) = (this.clone(), this.clone(), this.clone(), this.clone());
        let base = div().size_full().flex().flex_col().bg(t.background).overflow_hidden();
        let Some((_, _, orig)) = self.theme.clone() else {
            return base
                .items_center()
                .justify_center()
                .gap_2()
                .px_6()
                .child(Icon::new(IconName::Palette).size_6().text_color(with_alpha(t.muted_foreground, 0.4)))
                .child(div().tw_text_xs().text_color(t.muted_foreground).child("Select a dark or light theme first, then customize it here."))
                .child(div().id("tc-close").mt_2().tw_text_xs().text_color(tw("blue-500")).cursor_pointer().on_click(move |_, _, cx| c1.update(cx, |p, cx| p.close(cx))).child("Close"));
        };
        let mut body = div().flex().flex_col();
        for (cid, label, vars) in CATEGORIES {
            let expanded = !self.collapsed.contains(cid);
            let modified = vars.iter().any(|(k, _)| orig.get(*k) != self.draft.get(*k));
            let cid: &'static str = cid;
            let mut cat = div().border_b_1().border_color(with_alpha(t.studio_border, 0.5)).child(
                div()
                    .id(SharedString::from(format!("tc-cat-{cid}")))
                    .flex()
                    .w_full()
                    .items_center()
                    .justify_between()
                    .px_3()
                    .py_2()
                    .tw_text_xs()
                    .font_weight(FontWeight::MEDIUM)
                    .cursor_pointer()
                    .hover(|s| s.bg(with_alpha(t.studio_border, 0.2)))
                    .on_click(cx.listener(move |p, _, _, cx| {
                        if !p.collapsed.remove(cid) {
                            p.collapsed.insert(cid);
                        }
                        cx.notify();
                    }))
                    .child(*label)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.))
                            .when(modified, |d| d.child(div().size(px(6.)).rounded_full().bg(tw("blue-500"))))
                            .child(Icon::new(if expanded { IconName::ChevronDown } else { IconName::ChevronRight }).size_3().text_color(t.muted_foreground)),
                    ),
            );
            if expanded {
                let mut vars_el = div().flex().flex_col().gap_1().px_3().pb_3();
                for (key, vlabel) in *vars {
                    let default = orig.get(*key).and_then(|v| v.as_str()).unwrap_or_default().to_string();
                    let value = self.draft.get(*key).and_then(|v| v.as_str()).map(str::to_string).unwrap_or_else(|| default.clone());
                    let th = this.clone();
                    let key: &'static str = key;
                    vars_el = vars_el.child(color_control(key.to_string(), vlabel, value, default, move |v, _, cx| th.update(cx, |p, cx| p.set_color(key, v, cx)), cx));
                }
                cat = cat.child(vars_el);
            }
            body = body.child(cat);
        }
        let has_changes = self.has_changes();
        base.child(panel_header("Theme Creator", move |_, cx| c2.update(cx, |p, cx| p.close(cx)), cx))
            .child(div().id("tc-body").flex_1().overflow_y_scroll().child(body))
            .child(panel_footer(
                has_changes,
                "Save Theme",
                {
                    let th = this.clone();
                    move |_, cx| {
                        th.update(cx, |p, cx| {
                            if let Some((_, _, o)) = &p.theme {
                                p.draft = o.clone();
                            }
                            p.preview(cx);
                            cx.notify();
                        })
                    }
                },
                move |_, cx| c3.update(cx, |p, cx| p.close(cx)),
                move |_, cx| c4.update(cx, |p, cx| p.save(cx)),
                cx,
            ))
    }
}

/// IconThemeCreatorPanel (reduced): the panel shell with manifest import.
pub struct IconThemeCreatorPanel {
    model: Entity<SettingsModel>,
    view: WeakEntity<SettingsView>,
}

impl IconThemeCreatorPanel {
    pub fn new(model: Entity<SettingsModel>, view: WeakEntity<SettingsView>, _: &mut Window, _: &mut Context<Self>) -> Self {
        Self { model, view }
    }
}

impl Render for IconThemeCreatorPanel {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let view = self.view.clone();
        let current = self.model.read(cx).str("iconThemeId");
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.background)
            .child(panel_header("Icon Theme Creator", move |_, cx| {
                view.update(cx, |v, cx| v.close_side_panel(cx)).ok();
            }, cx))
            .child(
                div()
                    .flex_1()
                    .p_3()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .child(format!("Active icon theme: {current}"))
                    .child("Map Lucide icon names to SVG files in a JSON manifest, then import it from Settings \u{2192} General \u{2192} Icon Theme."),
            )
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn hex_and_names() {
        assert_eq!(super::to_hex("#ABCDEF"), "#abcdef");
        assert_eq!(super::to_hex("rgb(255, 0, 0)"), "#ff0000");
        assert_eq!(super::name_from_id("rexadb-dark-custom"), "Rexadb Dark Custom");
    }
}
