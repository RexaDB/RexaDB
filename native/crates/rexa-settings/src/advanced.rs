//! Port of the "advanced" section of components/studio/settings-view.tsx:
//! interface polish, data grid, explorers, tab/pane behaviour, system
//! configuration (SQL engine, RLS tab editor, privacy switches), App Updates,
//! Command Menu Customization and the Danger Zone.

use crate::rows::{group_title, model_select, model_switch, setting_row, title_block};
use crate::view::SettingsView;
use gpui::{div, prelude::*, px, AnyElement, Context, FontWeight, SharedString, Window};
use gpui_component::Icon;
use rexa_ui::{tw, with_alpha, ActiveTokens, Button, ButtonSize, IconName, Switch, Tw};
use serde_json::Value;

pub fn render_advanced(view: &mut SettingsView, _window: &mut Window, cx: &mut Context<SettingsView>) -> AnyElement {
    let t = cx.tokens().clone();
    let model = view.model.clone();
    let switch = |id: &'static str, key: &'static str, title: &'static str, desc: &'static str, cx: &gpui::App| {
        setting_row(title, desc, model_switch(&model, key)(cx), view.hl(id), cx)
    };
    let group = |title: &'static str| div().flex().flex_col().gap_4().pt_4().child(group_title(title));

    let hide_actions = model.read(cx).bool("hideWindowActions");
    let m_actions = model.clone();
    let window_actions = setting_row(
        "Window Action Buttons",
        "Show custom minimize, maximize, and close buttons in the header. Disable if your window manager provides these natively.",
        Switch::new("switch-window-actions")
            .checked(!hide_actions)
            .on_change(move |v, _, cx| m_actions.update(cx, |m, cx| m.set("hideWindowActions", !v, cx))),
        view.hl("window-actions"),
        cx,
    );

    let (diagnostics, auto_checks) = {
        let m = model.read(cx);
        (m.diagnostics, m.auto_update_checks)
    };
    let (m_d, m_a) = (model.clone(), model.clone());

    div()
        .flex()
        .flex_col()
        .gap_4()
        .child(
            div()
                .flex()
                .flex_col()
                .gap_1()
                .child(crate::rows::section_title("Advanced"))
                .child(div().tw_text_xs().text_color(t.muted_foreground).child("Configure advanced behavior and appearance of the application.")),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .gap_4()
                .child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_4()
                        .child(group_title("Interface Polish"))
                        .child(switch("tab-indicator", "showTabIndicator", "Show Tab Indicator", "Display the primary color line above the active editor tab.", cx))
                        .child(window_actions)
                        .child(switch(
                            "sidebar-toggle-pos",
                            "sidebarToggleBeforeConnection",
                            "Sidebar Toggle Before Connection",
                            "Move the sidebar toggle button before the connection selector in the header.",
                            cx,
                        )),
                )
                .child(
                    group("Data Grid - Visual Overhaul")
                        .child(switch("glass-headers", "glassmorphicHeaders", "Glassmorphic Sticky Headers", "Translucent, blurred backdrop for grid headers.", cx))
                        .child(switch("grid-animations", "gridAnimations", "Micro-Animations", "Subtle transition effects on row hover.", cx))
                        .child(switch("sleek-selection", "sleekSelection", "Sleek Selection States", "Subtle box-shadow glow for selected cells and rows.", cx)),
                )
                .child(
                    group("Data Grid - Smart Cell Visualizations")
                        .child(switch("colorized-pills", "colorizedPills", "Colorized Pills", "Render Booleans and Enums as elegant, colored pills.", cx))
                        .child(switch("relative-dates", "relativeDates", "Relative Dates", "Format dates into a more readable relative format.", cx))
                        .child(switch("json-inspector", "richJsonInspector", "Rich JSON Inspector", "Formatted mini-pill for JSON objects with tooltip.", cx))
                        .child(switch("data-bars", "dataBars", "Data Bars", "Inline background progress bar for numeric columns.", cx)),
                )
                .child(
                    group("Data Grid - Empty States & Loading Polish")
                        .child(switch("skeleton-loaders", "skeletonLoaders", "Skeleton Loaders", "Animated skeleton rows during data loading.", cx))
                        .child(switch(
                            "fast-table-loading",
                            "fastTableLoading",
                            "Fast table loading",
                            "Show SQL table rows before the exact count finishes. Pagination totals may appear later.",
                            cx,
                        )),
                )
                .child(group("Schema Explorer").child(switch(
                    "schema-explorer",
                    "schemaExplorer",
                    "Enable Schema Explorer",
                    "Show tables, functions, triggers, and indexes in a unified explorer with schema icon.",
                    cx,
                )))
                .child(
                    group("Database Explorer")
                        .child(switch(
                            "database-explorer",
                            "databaseExplorer",
                            "Enable Database Explorer",
                            "Browse all schemas and object types (tables, functions, triggers, indexes, enums) in a hierarchical tree view.",
                            cx,
                        ))
                        .child(switch(
                            "table-expansion",
                            "tableExpansion",
                            "Enable Table Expansion",
                            "Show expand/collapse arrows next to table names to view columns inline in the sidebar.",
                            cx,
                        ))
                        .child(switch(
                            "show-table-count",
                            "showTableCount",
                            "Show table count",
                            "Show the number of tables on the right of the A-Z / Tags row in the Tables sidebar.",
                            cx,
                        ))
                        .child(switch(
                            "redis-key-tree-view",
                            "redisKeyTreeView",
                            "Redis keys tree view",
                            "For Redis connections, show keys in the sidebar as a nested tree split on ':' (org:id \u{2192} org \u{203a} id). Parent keys stay clickable to open their own value, and expandable to reach child keys.",
                            cx,
                        )),
                )
                .child(group("Tab Behavior").child(switch(
                    "preview-tabs",
                    "previewTabs",
                    "Preview Tabs",
                    "VS Code-style preview mode. Opening a table, snippet, or dashboard shows it in a temporary tab (italicized) that gets replaced when you open another item. Double-click a tab or pin it to keep it permanently.",
                    cx,
                )))
                .child(
                    group("Pane Behavior")
                        .child(switch("autoclose-pane", "autoClosePane", "Auto-close Empty Panes", "Automatically close a split pane when its last tab is closed.", cx))
                        .child(switch(
                            "confirm-sheet-close",
                            "confirmSheetClose",
                            "Confirm Unsaved Sheet Close",
                            "Show a confirmation dialog when clicking outside a form sheet with unsaved changes.",
                            cx,
                        )),
                ),
        )
        .child(div().mt_8().child(group_title("System Configuration")))
        .child(
            // SqlEditorEngineSetting
            div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .border_t_1()
                .border_color(t.border)
                .py_3()
                .child(title_block("SQL Editor Engine", "Use the custom lightweight editor or Monaco with built-in editor features.", None, cx))
                .child(model_select(&model, "sqlEditorEngine", &[("custom", "Custom"), ("monaco", "Monaco")], 176., false, false, cx)),
        )
        .child(switch(
            "rls-tab-editor",
            "rlsPolicyTabEditor",
            "Open RLS Policies in Tab",
            "Edit and create Row-Level Security policies in an editor tab instead of a side sheet.",
            cx,
        ))
        .child(setting_row(
            "Send Diagnostics",
            "Upload error reports (message, stack trace, page and app version) to help fix crashes. Off by default; when off, errors are only logged on this device.",
            Switch::new("switch-diagnostics").checked(diagnostics).on_change(move |v, _, cx| m_d.update(cx, |m, cx| m.set_diagnostics(v, cx))),
            view.hl("send-diagnostics"),
            cx,
        ))
        .child(setting_row(
            "Check for Updates Automatically",
            "Ask GitHub for the latest release when the app starts. When off, RexaDB only checks when you press Check for Updates.",
            Switch::new("switch-auto-updates").checked(auto_checks).on_change(move |v, _, cx| m_a.update(cx, |m, cx| m.set_auto_update_checks(v, cx))),
            view.hl("auto-update-checks"),
            cx,
        ))
        .child(render_updates(auto_checks, view.hl("app-updates"), cx))
        .child(render_command_menu(view, cx))
        .child(div().mt_8().child(crate::danger::render_danger_zone(view.hl("danger-zone-reset"), cx)))
        .into_any_element()
}

/// `h-7 rounded-lg border border-border bg-secondary/40 px-2.5 text-xs font-medium` buttons.
fn update_button(id: &'static str, label: String, disabled: bool, primary: bool, cx: &gpui::App) -> gpui::Stateful<gpui::Div> {
    let t = cx.tokens().clone();
    let secondary = t.var_or("--secondary", t.muted);
    div()
        .id(id)
        .h_7()
        .flex()
        .items_center()
        .tw_rounded_lg()
        .px(px(10.))
        .tw_text_xs()
        .font_weight(FontWeight::MEDIUM)
        .when(primary, |d| d.bg(t.primary).text_color(t.var_or("--primary-foreground", t.background)))
        .when(!primary, |d| d.border_1().border_color(t.border).bg(with_alpha(secondary, 0.4)).text_color(t.foreground))
        .when(disabled, |d| d.opacity(0.5))
        .when(!disabled, |d| {
            d.cursor_pointer().hover(move |s| if primary { s.bg(with_alpha(t.primary, 0.9)) } else { s.bg(with_alpha(secondary, 0.6)) })
        })
        .child(label)
}

/// The App Updates block (standalone install).
fn render_updates(auto_checks: bool, highlight: bool, cx: &mut Context<SettingsView>) -> impl IntoElement {
    let t = cx.tokens().clone();
    let u = crate::update::state(cx);
    let version_line = format!(
        "Current version: {}{}",
        if u.current_version.is_empty() { "Unknown".to_string() } else { u.current_version.clone() },
        u.latest_version.as_ref().map(|l| format!(" \u{2022} Latest: {l}")).unwrap_or_default()
    );
    let check = update_button("check-updates", if u.checking { "Checking...".into() } else { "Check for Updates".into() }, u.checking || u.downloading, false, cx)
        .when(!u.checking && !u.downloading, |d| {
            d.on_click(|_, _, cx| {
                rexa_ui::toast::success("Checking for updates...", cx);
                crate::update::check_for_updates(cx);
            })
        });
    let download_label = if u.downloading {
        format!("Downloading{}", u.progress_percent.map(|p| format!(" {p}%")).unwrap_or_else(|| "...".into()))
    } else if u.update_downloaded {
        "Downloaded".into()
    } else {
        "Download Update".into()
    };
    let can_download = u.update_available && !u.downloading && !u.update_downloaded;
    let download = update_button("download-update", download_label, !can_download, false, cx).when(can_download, |d| {
        // Installing through the Tauri updater is not available in the native
        // build: open the release page instead.
        d.on_click(|_, _, cx| cx.open_url("https://github.com/RexaDB/RexaDB/releases/latest"))
    });
    let install = update_button("install-update", "Install and Restart".into(), !u.update_downloaded, true, cx);
    div()
        .flex()
        .flex_col()
        .gap(px(10.))
        .when(highlight, |d| d.tw_rounded_lg().border_2().border_color(with_alpha(t.primary, 0.5)))
        .child(title_block("App Updates", version_line, None, cx))
        .child(div().flex().flex_wrap().items_center().gap(px(6.)).child(check).child(download).child(install))
        .when(!u.enabled && auto_checks, |d| {
            d.child(div().tw_text_xs().text_color(t.muted_foreground).child("Automatic updates are not configured for this build."))
        })
        .when_some(u.error.clone(), |d, e| d.child(div().tw_text_xs().text_color(tw("red-500")).child(e)))
}

/// Command Menu Customization: drag to reorder, eye toggles visibility.
fn render_command_menu(view: &mut SettingsView, cx: &mut Context<SettingsView>) -> impl IntoElement {
    let t = cx.tokens().clone();
    let sections: Vec<Value> = view.model.read(cx).value("commandMenuSections").as_array().cloned().unwrap_or_default();
    let mut list = div().flex().flex_col().gap(px(6.)).border_t_1().border_color(t.border).pt_3();
    let secondary = t.var_or("--secondary", t.muted);
    for (index, section) in sections.iter().enumerate() {
        let id = section.get("id").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let name = section.get("name").and_then(|v| v.as_str()).unwrap_or(&id).to_string();
        let visible = section.get("isVisible").and_then(|v| v.as_bool()).unwrap_or(true);
        let dragged = view.command_drag == Some(index);
        let m = view.model.clone();
        let id_toggle = id.clone();
        list = list.child(
            div()
                .id(SharedString::from(format!("cmd-section-{id}")))
                .group("cmd-section")
                .flex()
                .items_center()
                .justify_between()
                .tw_rounded_lg()
                .border_1()
                .p(px(10.))
                .when(dragged, |d| d.bg(with_alpha(tw("blue-500"), 0.1)).border_color(with_alpha(tw("blue-500"), 0.5)).shadow_lg())
                .when(!dragged && !visible, |d| d.bg(with_alpha(secondary, 0.1)).border_color(with_alpha(t.border, 0.4)).opacity(0.6))
                .when(!dragged && visible, |d| d.bg(with_alpha(secondary, 0.3)).border_color(t.border).hover(|s| s.bg(with_alpha(secondary, 0.5))))
                // Live reordering (handleDragOver): moving over another row swaps into its slot.
                .on_mouse_down(gpui::MouseButton::Left, cx.listener(move |this, _, _, cx| {
                    this.command_drag = Some(index);
                    cx.notify();
                }))
                .on_mouse_move(cx.listener(move |this, e: &gpui::MouseMoveEvent, _, cx| {
                    if e.pressed_button != Some(gpui::MouseButton::Left) {
                        return;
                    }
                    if let Some(from) = this.command_drag.filter(|f| *f != index) {
                        this.model.update(cx, |m, cx| {
                            let mut list = m.value("commandMenuSections").as_array().cloned().unwrap_or_default();
                            if from < list.len() && index < list.len() {
                                let moved = list.remove(from);
                                list.insert(index, moved);
                                m.set("commandMenuSections", Value::Array(list), cx);
                            }
                        });
                        this.command_drag = Some(index);
                        cx.notify();
                    }
                }))
                .on_mouse_up(gpui::MouseButton::Left, cx.listener(|this, _, _, cx| {
                    this.command_drag = None;
                    cx.notify();
                }))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(10.))
                        .child(Icon::new(IconName::GripVertical).size_4().text_color(if dragged { tw("blue-500") } else { with_alpha(t.muted_foreground, 0.3) }))
                        .child(
                            div()
                                .tw_text_xs()
                                .font_weight(FontWeight::MEDIUM)
                                .text_color(if dragged { tw("blue-500") } else if visible { t.foreground } else { t.muted_foreground })
                                .when(!visible && !dragged, |d| d.line_through())
                                .child(name),
                        ),
                )
                .child(
                    div()
                        .id(SharedString::from(format!("cmd-eye-{id}")))
                        .p_1()
                        .rounded(px(4.))
                        .hover(|s| s.bg(t.muted))
                        .cursor_pointer()
                        .text_color(if visible { with_alpha(t.foreground, 0.7) } else { t.muted_foreground })
                        .on_click(move |_, _, cx| {
                            m.update(cx, |m, cx| {
                                let mut list = m.value("commandMenuSections").as_array().cloned().unwrap_or_default();
                                for s in list.iter_mut() {
                                    if s.get("id").and_then(|v| v.as_str()) == Some(id_toggle.as_str()) {
                                        let v = s.get("isVisible").and_then(|v| v.as_bool()).unwrap_or(true);
                                        s["isVisible"] = Value::Bool(!v);
                                    }
                                }
                                m.set("commandMenuSections", Value::Array(list), cx);
                            })
                        })
                        .child(Icon::new(IconName::Eye).size_4().when(!visible, |i| i.opacity(0.5))),
                ),
        );
    }
    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(
            div()
                .mt_8()
                .flex()
                .flex_col()
                .gap_1()
                .when(view.hl("command-menu"), |d| d.tw_rounded_lg().border_2().border_color(with_alpha(t.primary, 0.5)))
                .child(group_title("Command Menu Customization"))
                .child(
                    div()
                        .tw_text_xs()
                        .text_color(t.muted_foreground)
                        .child("Drag to reorder or click the eye icon to show/hide sections in the command menu (\u{2318}K)."),
                ),
        )
        .child(list)
}

#[allow(unused)]
fn _b(_: Button, _: ButtonSize) {}
