//! Port of components/studio/settings/themes-section.tsx +
//! components/studio/marketplace-extension-list.tsx (search list) + the
//! "Add Custom Editor Theme" dialog (ThemeAddDialog in settings-view.tsx).
//! The Open VSX search is live; "Browse" (download the extension, convert its
//! VS Code themes) opens the extension page instead — the theme conversion
//! (lib/studio/themes/vscode-marketplace.ts) is not ported. Community
//! publishing needs a signed-in account and is not shown.

use crate::model::{NamedTheme, SettingsModel, EDITOR_BUILTIN_THEMES};
use crate::view::{SettingsView, SidePanel};
use gpui::{div, img, prelude::*, px, App, AppContext, Context, Entity, FontWeight, SharedString, WeakEntity, Window};
use gpui_component::input::{InputEvent, InputState, TextareaState};
use gpui_component::Icon;
use rexa_ui::{close_top, open_dialog, tw, with_alpha, ActiveTokens, Align, Button, ButtonSize, Dialog, DropdownMenu, IconName, MenuItem, TextArea, TextInput, Tw};
use serde_json::{json, Value};
use std::collections::HashSet;

const OPEN_VSX_BASE: &str = "https://open-vsx.org/api";

#[derive(Clone, Debug)]
pub struct Extension {
    pub namespace: String,
    pub name: String,
    pub display_name: String,
    pub description: String,
    pub version: String,
    pub downloads: u64,
    pub rating: f64,
    pub reviews: u64,
    pub verified: bool,
}

async fn search(query: String, offset: usize) -> anyhow::Result<(Vec<Extension>, u64)> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).build()?;
    let mut params = vec![("size", "50".to_string()), ("offset", offset.to_string()), ("category", "Themes".to_string())];
    if !query.is_empty() {
        params.push(("query", query));
    }
    let resp = client.get(format!("{OPEN_VSX_BASE}/-/search")).query(&params).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("Open VSX search failed: {}", resp.status());
    }
    let body: Value = resp.json().await?;
    let exts = body["extensions"].as_array().ok_or_else(|| anyhow::anyhow!("Invalid response from Open VSX"))?;
    let list = exts
        .iter()
        .map(|e| Extension {
            namespace: e["namespace"].as_str().unwrap_or_default().into(),
            name: e["name"].as_str().unwrap_or_default().into(),
            display_name: e["displayName"].as_str().or(e["name"].as_str()).unwrap_or_default().into(),
            description: e["description"].as_str().unwrap_or_default().into(),
            version: e["version"].as_str().unwrap_or_default().into(),
            downloads: e["downloadCount"].as_u64().unwrap_or(0),
            rating: e["averageRating"].as_f64().unwrap_or(0.),
            reviews: e["reviewCount"].as_u64().unwrap_or(0),
            verified: e["verified"].as_bool().unwrap_or(false),
        })
        .collect();
    Ok((list, body["totalSize"].as_u64().unwrap_or(0)))
}

/// formatDownloads.
pub fn format_downloads(n: u64) -> String {
    if n >= 1_000_000 {
        format!("{:.1}M", n as f64 / 1_000_000.)
    } else if n >= 1_000 {
        format!("{:.1}K", n as f64 / 1_000.)
    } else {
        n.to_string()
    }
}

/// starDisplay: ★ per full star, ☆ for the rest.
fn stars(r: f64) -> String {
    let full = r.floor().clamp(0., 5.) as usize;
    let half = r - full as f64 >= 0.5;
    "\u{2605}".repeat(full) + if half { "\u{bd}" } else { "" } + &"\u{2606}".repeat(5 - full - usize::from(half))
}

pub struct ThemesSection {
    model: Entity<SettingsModel>,
    view: WeakEntity<SettingsView>,
    search: Entity<InputState>,
    extensions: Vec<Extension>,
    total: u64,
    loading: bool,
    error: Option<String>,
    seq: usize,
    _subs: Vec<gpui::Subscription>,
}

impl ThemesSection {
    pub fn new(model: Entity<SettingsModel>, view: WeakEntity<SettingsView>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search theme extensions from VS Code Marketplace..."));
        let subs = vec![cx.subscribe(&search, |this, s, e: &InputEvent, cx| {
            if matches!(e, InputEvent::Change) {
                let q = s.read(cx).value().trim().to_string();
                this.load(q, false, cx);
            }
        })];
        let mut this = Self { model, view, search, extensions: Vec::new(), total: 0, loading: false, error: None, seq: 0, _subs: subs };
        this.load(String::new(), false, cx);
        this
    }

    fn load(&mut self, query: String, more: bool, cx: &mut Context<Self>) {
        let q = if query.chars().count() < 2 { String::new() } else { query };
        self.seq += 1;
        let seq = self.seq;
        self.loading = true;
        self.error = None;
        let offset = if more { self.extensions.len() } else { 0 };
        let delay = if q.is_empty() { 0 } else { 200 };
        cx.notify();
        cx.spawn(async move |this, cx| {
            cx.background_executor().timer(std::time::Duration::from_millis(delay)).await;
            if this.update(cx, |s, _| s.seq != seq).unwrap_or(true) {
                return;
            }
            let res = rexa_core::runtime::spawn(search(q, offset)).await;
            this.update(cx, |s, cx| {
                if s.seq != seq {
                    return;
                }
                s.loading = false;
                match res {
                    Ok((list, total)) => {
                        if more {
                            s.extensions.extend(list);
                        } else {
                            s.extensions = list;
                        }
                        s.total = total;
                    }
                    Err(e) => s.error = Some(e.to_string()),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn render_ext(&self, ext: &Extension, cx: &App) -> impl IntoElement {
        let t = cx.tokens().clone();
        let url = format!("https://open-vsx.org/extension/{}/{}", ext.namespace, ext.name);
        let icon = format!("{OPEN_VSX_BASE}/{}/{}/{}/file/icon", ext.namespace, ext.name, ext.version);
        div()
            .px_2()
            .py_3()
            .border_b_1()
            .border_color(with_alpha(t.studio_border, 0.4))
            .child(
                div()
                    .flex()
                    .gap_3()
                    .child(div().size_10().flex_shrink_0().rounded(px(4.)).mt(px(2.)).bg(with_alpha(t.var_or("--secondary", t.muted), 0.3)).overflow_hidden().child(img(icon).size_full()))
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .min_w_0()
                            .flex_1()
                            .gap(px(2.))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).overflow_hidden().text_ellipsis().whitespace_nowrap().child(ext.display_name.clone()))
                                    .when(ext.verified, |d| d.child(div().tw_text_10().px_1().py(px(2.)).rounded(px(4.)).bg(with_alpha(tw("blue-500"), 0.1)).text_color(tw("blue-500")).font_weight(FontWeight::MEDIUM).child("Verified"))),
                            )
                            .child(div().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.6)).child(ext.namespace.clone()))
                            .child(div().mt(px(2.)).tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.8)).overflow_hidden().text_ellipsis().whitespace_nowrap().child(ext.description.clone()))
                            .child(
                                div()
                                    .mt_1()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(if ext.rating > 0. {
                                        div().tw_text_xs().flex().gap_1().child(div().text_color(tw("yellow-500")).child(stars(ext.rating))).child(div().text_color(with_alpha(t.muted_foreground, 0.4)).child(format!("({})", ext.reviews)))
                                    } else {
                                        div().tw_text_10().px(px(6.)).py(px(2.)).rounded(px(4.)).bg(with_alpha(tw("orange-500"), 0.1)).text_color(tw("orange-500")).font_weight(FontWeight::MEDIUM).child("New")
                                    })
                                    .child(div().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.4)).child(format!("{} installs", format_downloads(ext.downloads))))
                                    .child(div().ml_auto().child(
                                        Button::new(SharedString::from(format!("browse-{}-{}", ext.namespace, ext.name))).size(ButtonSize::Xs).icon(IconName::Palette).label("Browse").on_click(move |_, _, cx| cx.open_url(&url)),
                                    )),
                            ),
                    ),
            )
    }
}

impl Render for ThemesSection {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let view = self.view.clone();
        let (v1, v2) = (view.clone(), view);
        let model = self.model.clone();
        let mut list = div().flex().flex_col().mt_2();
        if let Some(e) = &self.error {
            list = list.child(div().px_3().py_2().mx_1().tw_rounded_md().tw_text_xs().text_color(tw("red-500")).bg(with_alpha(tw("red-500"), 0.05)).child(e.clone()));
        }
        if self.extensions.is_empty() && self.error.is_none() {
            list = list.child(
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap_2()
                    .py_12()
                    .text_color(t.muted_foreground)
                    .child(Icon::new(IconName::LoaderCircle).size_6().opacity(0.3))
                    .child(div().tw_text_xs().child(if self.loading { "Loading themes..." } else { "No themes found" })),
            );
        }
        for ext in &self.extensions {
            list = list.child(self.render_ext(ext, cx));
        }
        if (self.extensions.len() as u64) < self.total {
            let remaining = self.total - self.extensions.len() as u64;
            list = list.child(
                div().px_2().pt_2().pb_1().child(
                    Button::new("themes-more")
                        .outline()
                        .size(ButtonSize::Sm)
                        .w_full()
                        .disabled(self.loading)
                        .label(if self.loading { "Loading...".to_string() } else { format!("Load more ({remaining} remaining)") })
                        .on_click(cx.listener(|this, _, _, cx| {
                            let q = this.search.read(cx).value().trim().to_string();
                            this.load(q, true, cx);
                        })),
                ),
            );
        }
        div()
            .flex()
            .flex_col()
            .gap_5()
            .child(
                div()
                    .flex()
                    .items_start()
                    .justify_between()
                    .gap_4()
                    .child(div().child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child("Themes")).child(div().tw_text_xs().text_color(t.muted_foreground).child("Browse and install themes from the VS Code Marketplace.")))
                    .child(
                        DropdownMenu::new("themes-add")
                            .align(Align::End)
                            .trigger(Button::new("themes-add-btn").outline().icon(IconName::Plus).label("Add Theme"))
                            .menu(move |m, _, _| {
                                let (v1, v2, model) = (v1.clone(), v2.clone(), model.clone());
                                m.w(208.)
                                    .item(MenuItem::new("Custom App Theme").icon(IconName::Palette).text_xs().on_select(move |_, cx| {
                                        v1.update(cx, |v, cx| v.open_side_panel(SidePanel::ThemeCreator, cx)).ok();
                                    }))
                                    .item(MenuItem::new("Visual Icon Theme").icon(IconName::Palette).text_xs().on_select(move |_, cx| {
                                        v2.update(cx, |v, cx| v.open_side_panel(SidePanel::IconThemeCreator, cx)).ok();
                                    }))
                                    .item(MenuItem::new("Custom Editor Theme").icon(IconName::Code).text_xs().on_select(move |_, cx| open_editor_theme_dialog(model.clone(), cx)))
                            }),
                    ),
            )
            .child(
                div()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(t.studio_border)
                    .overflow_hidden()
                    .bg(t.popover)
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_2()
                            .px_3()
                            .py_2()
                            .border_b_1()
                            .border_color(with_alpha(t.studio_border, 0.4))
                            .bg(with_alpha(t.muted, 0.2))
                            .child(Icon::new(IconName::Palette).size_4().text_color(t.muted_foreground))
                            .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child("VS Code Marketplace")),
                    )
                    .child(
                        div()
                            .id("themes-market")
                            .p_3()
                            .max_h(px(500.))
                            .overflow_y_scroll()
                            .child(TextInput::new(&self.search).prefix(Icon::new(IconName::Search).size(px(14.)).text_color(with_alpha(t.muted_foreground, 0.4))))
                            .child(list),
                    ),
            )
    }
}

/// ThemeAddDialog for editor themes (handleAddEditorTheme): name + JSON,
/// prefilled with a copy of the selected custom theme or a blank Monaco theme.
pub fn open_editor_theme_dialog(model: Entity<SettingsModel>, cx: &mut App) {
    let (selected, existing_labels) = {
        let m = model.read(cx);
        let sel = m.custom_editor_themes.iter().find(|t| t.id == m.editor_theme_id).cloned();
        let labels: HashSet<String> = EDITOR_BUILTIN_THEMES.iter().map(|(_, l)| l.to_string()).chain(m.custom_editor_themes.iter().map(|t| t.name.clone())).collect();
        (sel, labels)
    };
    let (name0, json0) = match &selected {
        Some(t) => (crate::theme_util::copy_name(&t.name, &existing_labels), t.raw["themeJson"].as_str().unwrap_or("{}").to_string()),
        None => (String::new(), serde_json::to_string_pretty(&json!({"base": "vs-dark", "inherit": true, "rules": [], "colors": {}})).unwrap_or_default()),
    };
    let Some(window) = cx.active_window() else { return };
    window
        .update(cx, |_, window, cx| {
            let name = cx.new(|cx| InputState::new(window, cx).placeholder("My Custom Theme").default_value(name0));
            let json_s = cx.new(|cx| TextareaState::new(window, cx).placeholder("Paste theme JSON here").default_value(json0));
            let file_label = cx.new(|_| None::<String>);
            open_dialog(cx, move |_, cx| {
                let t = cx.tokens().clone();
                let (n2, j2, m2, fl2, fl3, j3, n3) = (name.clone(), json_s.clone(), model.clone(), file_label.clone(), file_label.clone(), json_s.clone(), name.clone());
                Dialog::new()
                    .max_w(672.)
                    .title("Add Custom Editor Theme")
                    .description("Paste a VS Code theme JSON (colors + tokenColors) or a Monaco theme definition.")
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap_4()
                            .child(div().flex().flex_col().gap_2().child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child("Theme Name")).child(TextInput::new(&name)))
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .gap_2()
                                    .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child("Theme JSON"))
                                    .child(div().font_family(rexa_ui::MONO).child(TextArea::new(&json_s).min_h(200.).h(240.)))
                                    .child(
                                        div()
                                            .flex()
                                            .items_center()
                                            .justify_between()
                                            .gap_3()
                                            .child(div().tw_text_xs().text_color(t.muted_foreground).child(fl2.read(cx).clone().map_or("Upload a .json theme file".to_string(), |f| format!("Loaded: {f}"))))
                                            .child(Button::new("theme-file").outline().size(ButtonSize::Xs).label("Choose File").on_click(move |_, _, cx| {
                                                let paths = cx.prompt_for_paths(gpui::PathPromptOptions { files: true, directories: false, multiple: false, prompt: None });
                                                let (fl, js, nm) = (fl3.clone(), j3.clone(), n3.clone());
                                                cx.spawn(async move |cx| {
                                                    let Ok(Ok(Some(paths))) = paths.await else { return };
                                                    let Some(p) = paths.first().cloned() else { return };
                                                    let text = std::fs::read_to_string(&p);
                                                    cx.update(|cx| match text {
                                                        Ok(text) => {
                                                            let fname = p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
                                                            if let Some(w) = cx.active_window() {
                                                                w.update(cx, |_, w, cx| {
                                                                    js.update(cx, |s, cx| s.set_value(text, w, cx));
                                                                    if nm.read(cx).value().trim().is_empty() {
                                                                        let base = fname.trim_end_matches(".json").to_string();
                                                                        nm.update(cx, |s, cx| s.set_value(base, w, cx));
                                                                    }
                                                                })
                                                                .ok();
                                                            }
                                                            fl.update(cx, |f, _| *f = Some(fname));
                                                            cx.refresh_windows();
                                                        }
                                                        Err(_) => {
                                                            rexa_ui::toast::error("Failed to read theme file.", cx);
                                                        }
                                                    });
                                                })
                                                .detach();
                                            })),
                                    ),
                            ),
                    )
                    .footer(Button::new("theme-cancel").outline().label("Cancel").on_click(|_, _, cx| close_top(cx)))
                    .footer(Button::new("theme-add").label("Add Theme").on_click(move |_, _, cx| {
                        let json_text = j2.read(cx).value().to_string();
                        let name_in = n2.read(cx).value().trim().to_string();
                        if json_text.trim().is_empty() {
                            rexa_ui::toast::error("Paste a theme JSON first.", cx);
                            return;
                        }
                        let parsed = match crate::theme_util::parse_editor_theme(&json_text) {
                            Ok(n) => n,
                            Err(e) => {
                                rexa_ui::toast::error(e, cx);
                                return;
                            }
                        };
                        let name = if !name_in.is_empty() { name_in } else { parsed.filter(|n| !n.is_empty()).unwrap_or_else(|| "Custom Theme".into()) };
                        let (labels, ids) = {
                            let m = m2.read(cx);
                            let labels: HashSet<String> = EDITOR_BUILTIN_THEMES.iter().map(|(_, l)| l.to_string()).chain(m.custom_editor_themes.iter().map(|t| t.name.clone())).collect();
                            let ids: HashSet<String> = EDITOR_BUILTIN_THEMES.iter().map(|(i, _)| i.to_string()).chain(m.custom_editor_themes.iter().map(|t| t.id.clone())).collect();
                            (labels, ids)
                        };
                        if labels.contains(&name) {
                            rexa_ui::toast::error(format!("Theme name \"{name}\" already exists."), cx);
                            return;
                        }
                        let id = crate::theme_util::create_theme_id(&name, &ids);
                        let theme = NamedTheme { id: id.clone(), name: name.clone(), base: String::new(), raw: json!({"id": id, "name": name, "themeJson": json_text}) };
                        m2.update(cx, |m, cx| {
                            let mut list = m.custom_editor_themes.clone();
                            list.push(theme);
                            m.set_custom_editor_themes(list, cx);
                            m.set_editor_theme(&id, cx);
                        });
                        close_top(cx);
                        rexa_ui::toast::success(format!("Added \"{name}\" theme."), cx);
                    }))
            });
        })
        .ok();
}

#[cfg(test)]
mod tests {
    #[test]
    fn formats() {
        assert_eq!(super::format_downloads(1500), "1.5K");
        assert_eq!(super::format_downloads(2_300_000), "2.3M");
        assert_eq!(super::stars(3.6), "\u{2605}\u{2605}\u{2605}\u{bd}\u{2606}");
    }
}
