//! Port of components/studio/database/{extensions-list,extension-details-sheet}.tsx
//! (+ `handleToggleExtension`).
//!
//! Approximation: CSS `repeat(auto-fit, minmax(260px, 1fr))` is computed from the
//! measured width of the grid (columns = floor((w + gap) / (260 + gap))).

use super::{fetch, ListBase, ListView};
use crate::actions;
use crate::sheet::{detail_row, StudioSheet};
use gpui::{div, prelude::*, px, AnyElement, Bounds, Context, FontWeight, Pixels, SharedString, Window};
use rexa_core::{Session, TabSpec};
use rexa_drivers::ExtensionInfo;
use rexa_ui::widgets::Icon;
use rexa_ui::{open_alert_dialog, tw, with_alpha, ActiveTokens, AlertDialog, Badge, BadgeVariant, Button, ButtonSize, IconName, Spinner, Tw, MONO};
use std::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;

pub struct ExtensionsList {
    base: ListBase,
    extensions: Vec<ExtensionInfo>,
    toggling: Option<String>,
    selected: Option<String>,
    grid_bounds: Rc<Cell<Bounds<Pixels>>>,
}

impl ListView for ExtensionsList {
    fn base(&mut self) -> &mut ListBase {
        &mut self.base
    }
    fn load(&mut self, cx: &mut Context<Self>) {
        self.base.loading = true;
        let d = self.base.session.driver.clone();
        let fut = rexa_core::runtime::spawn(async move { d.extensions().await });
        fetch(cx, fut, |v: &mut Self, e| v.extensions = e);
    }
}

impl ExtensionsList {
    pub fn new(spec: TabSpec, session: Arc<Session>, schema: Option<String>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let base = ListBase::new(spec, session, schema, "Search extensions...", window, cx);
        let mut this = ExtensionsList { base, extensions: Vec::new(), toggling: None, selected: None, grid_bounds: Rc::default() };
        this.load(cx);
        this
    }

    /// The confirm AlertDialog, then `toggleExtension`.
    fn ask_toggle(&mut self, name: String, install: bool, cx: &mut Context<Self>) {
        let this = cx.entity().downgrade();
        open_alert_dialog(cx, move |_, cx| {
            let (title, desc, action) = if install {
                ("Install Extension", format!("Are you sure you want to install the \"{name}\" extension? This will add new functionality to your database."), "Install")
            } else {
                ("Uninstall Extension", format!("Are you sure you want to uninstall the \"{name}\" extension? This may cause errors if your database objects depend on it."), "Uninstall")
            };
            let this = this.clone();
            let name = name.clone();
            let ok = if install {
                Button::new("ext-confirm").label(action)
            } else {
                Button::new("ext-confirm").colors(tw("red-600"), tw("red-500"), gpui::white()).label(action)
            };
            let _ = cx;
            AlertDialog::new()
                .title(title)
                .description(desc)
                .footer(Button::new("ext-cancel").outline().label("Cancel").on_click(|_, _, cx| rexa_ui::close_top(cx)))
                .footer(ok.on_click(move |_, _, cx| {
                    rexa_ui::close_top(cx);
                    let n = name.clone();
                    this.update(cx, |v, cx| v.toggle(n, install, cx)).ok();
                }))
        });
    }

    fn toggle(&mut self, name: String, install: bool, cx: &mut Context<Self>) {
        self.toggling = Some(name.clone());
        cx.notify();
        // handleToggleExtension (no CASCADE, unlike ddl::toggle_extension).
        let sql = if install { format!("CREATE EXTENSION IF NOT EXISTS {};", actions::dq(&name)) } else { format!("DROP EXTENSION IF EXISTS {};", actions::dq(&name)) };
        let msg = if install { "Extension installed".to_string() } else { "Extension uninstalled".to_string() };
        let this = cx.entity().downgrade();
        actions::run(&self.base.session, sql, msg, "Failed to toggle extension", cx, move |_, cx| {
            this.update(cx, |v, cx| {
                v.toggling = None;
                v.load(cx);
            })
            .ok();
        });
    }

    fn card(&self, ext: &ExtensionInfo, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let installed = ext.is_installed();
        let loading = self.toggling.as_deref() == Some(ext.name.as_str());
        let studio_border = t.var_or("--studio-border", t.border);
        let version = format!("v{}", ext.installed_version.clone().or(ext.default_version.clone()).unwrap_or_default());
        let name = ext.name.clone();
        let (n1, n2, n3) = (name.clone(), name.clone(), name.clone());
        let red = tw("red-500");
        let action = if loading {
            Button::new(SharedString::from(format!("ext-t-{name}"))).size(ButtonSize::Sm).disabled(true).child(Spinner::new(12.))
        } else if installed {
            Button::new(SharedString::from(format!("ext-t-{name}"))).outline().size(ButtonSize::Sm).colors(gpui::transparent_black(), with_alpha(red, 0.1), red).label("Uninstall")
        } else {
            Button::new(SharedString::from(format!("ext-t-{name}"))).size(ButtonSize::Sm).label("Install")
        };
        let action = action.on_click(cx.listener(move |v, _, _, cx| {
            cx.stop_propagation();
            v.ask_toggle(n1.clone(), !installed, cx);
        }));
        let gid: SharedString = format!("ext-card-{name}").into();
        div()
            .id(SharedString::from(format!("ext-{name}")))
            .group(gid.clone())
            .flex()
            .flex_1()
            .flex_col()
            .p_5()
            .min_w_0()
            .tw_rounded_lg()
            .border_1()
            .cursor_pointer()
            .when(installed, |d| d.border_color(with_alpha(t.primary, 0.2)).bg(with_alpha(t.primary, 0.02)))
            .when(!installed, |d| d.border_color(studio_border).bg(with_alpha(t.background, 0.4)).hover(|s| s.border_color(t.var_or("--studio-border-hover", t.border))))
            .on_click(cx.listener(move |v, _, _, cx| {
                v.selected = Some(n2.clone());
                cx.notify();
            }))
            .child(
                div()
                    .flex()
                    .items_start()
                    .justify_between()
                    .gap_3()
                    .mb_3()
                    .child(
                        div()
                            .flex()
                            .min_w_0()
                            .flex_1()
                            .items_center()
                            .gap_3()
                            .child(
                                div()
                                    .size_10()
                                    .flex_shrink_0()
                                    .tw_rounded_lg()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .when(installed, |d| d.bg(with_alpha(t.primary, 0.1)).text_color(t.primary))
                                    .when(!installed, |d| d.bg(t.muted).text_color(t.muted_foreground))
                                    .child(Icon::new(IconName::Box).size(px(20.))),
                            )
                            .child(
                                div()
                                    .flex()
                                    .flex_col()
                                    .min_w_0()
                                    .flex_1()
                                    .child(div().truncate().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(name.clone()))
                                    .child(div().tw_text_xs().font_family(MONO).text_color(t.muted_foreground).child(version)),
                            ),
                    )
                    .child(div().flex_shrink_0().child(action)),
            )
            .child(
                div()
                    .flex_1()
                    .mb_4()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .line_clamp(2)
                    .child(ext.comment.clone().filter(|c| !c.is_empty()).unwrap_or_else(|| "No description provided.".into())),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .pt_3()
                    .border_t_1()
                    .border_color(with_alpha(studio_border, 0.5))
                    .child(if installed {
                        div()
                            .flex()
                            .items_center()
                            .h_4()
                            .px(px(6.))
                            .tw_rounded_md()
                            .bg(with_alpha(tw("emerald-500"), 0.1))
                            .text_color(tw("emerald-500"))
                            .tw_text_xs()
                            .font_weight(FontWeight::MEDIUM)
                            .child(Icon::new(IconName::Check).size(px(10.)).mr_1())
                            .child("Installed")
                            .into_any_element()
                    } else {
                        div().opacity(0.5).child(Badge::new("Available").variant(BadgeVariant::Outline)).into_any_element()
                    })
                    .child(
                        div()
                            .id(SharedString::from(format!("ext-open-{name}")))
                            .text_color(t.muted_foreground)
                            .hover(|s| s.text_color(t.primary))
                            .on_click(cx.listener(move |v, _, _, cx| {
                                cx.stop_propagation();
                                v.selected = Some(n3.clone());
                                cx.notify();
                            }))
                            .child(Icon::new(IconName::ExternalLink).size(px(12.))),
                    ),
            )
            .into_any_element()
    }

    fn details(&self, ext: &ExtensionInfo, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let installed = ext.is_installed();
        let loading = self.toggling.as_deref() == Some(ext.name.as_str());
        let caps: Vec<&str> = [
            ext.trusted.unwrap_or(false).then_some("Trusted"),
            ext.relocatable.unwrap_or(false).then_some("Relocatable"),
            ext.superuser.unwrap_or(false).then_some("Requires superuser"),
        ]
        .into_iter()
        .flatten()
        .collect();
        let name = ext.name.clone();
        let search_href = format!("https://www.google.com/search?q=postgresql+extension+{name}");
        let default_version = ext.default_version.clone().unwrap_or_default();
        let red = tw("red-500");
        let n = name.clone();
        let toggle = if loading {
            Button::new("ext-sheet-toggle").size(ButtonSize::Sm).disabled(true).child(Spinner::new(14.))
        } else if installed {
            Button::new("ext-sheet-toggle").outline().size(ButtonSize::Sm).colors(gpui::transparent_black(), with_alpha(red, 0.1), red).label("Uninstall extension")
        } else {
            Button::new("ext-sheet-toggle").size(ButtonSize::Sm).label("Install extension")
        }
        .on_click(cx.listener(move |v, _, _, cx| v.toggle(n.clone(), !installed, cx)));
        let title = div()
            .flex()
            .min_w_0()
            .flex_1()
            .items_center()
            .gap_2()
            .child(
                div()
                    .size_7()
                    .flex_shrink_0()
                    .flex()
                    .items_center()
                    .justify_center()
                    .tw_rounded_md()
                    .when(installed, |d| d.bg(with_alpha(t.primary, 0.1)).text_color(t.primary))
                    .when(!installed, |d| d.bg(t.muted).text_color(t.muted_foreground))
                    .child(Icon::new(IconName::Box).size_4()),
            )
            .child(crate::sheet::title_pill(name.clone().into()))
            .child(if installed {
                div().h_5().px(px(6.)).flex().items_center().tw_rounded_md().bg(with_alpha(tw("emerald-500"), 0.1)).text_color(tw("emerald-500")).tw_text_xs().child("Installed").into_any_element()
            } else {
                Badge::new("Available").variant(BadgeVariant::Outline).into_any_element()
            })
            .child(div().font_family(MONO).child(Badge::new(format!("v{}", ext.installed_version.clone().unwrap_or(default_version.clone()))).variant(BadgeVariant::Outline)));
        let this = cx.entity();
        StudioSheet::new("ext-details")
            .width(520.)
            .contained(move |_, cx| {
                this.update(cx, |v, cx| {
                    v.selected = None;
                    cx.notify();
                })
            })
            .title_el(title)
            .child(div().mb_4().tw_text_xs().text_color(t.muted_foreground).child(ext.comment.clone().filter(|c| !c.is_empty()).unwrap_or_else(|| "No extension description is available for this package.".into())))
            .child(
                div().mb_5().flex().flex_wrap().gap_2().child(
                    Button::new("ext-search").ghost().size(ButtonSize::Sm).label("Search").icon_end(IconName::ExternalLink).on_click(move |_, _, cx| cx.open_url(&search_href)),
                ),
            )
            .child(
                div()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(with_alpha(t.var_or("--studio-border", t.border), 0.7))
                    .bg(with_alpha(t.background, 0.3))
                    .px_4()
                    .child(detail_row("Default version", ext.default_version.clone().unwrap_or_else(|| "Unknown".into()), cx))
                    .child(detail_row("Installed version", ext.installed_version.clone().unwrap_or_else(|| "Not installed".into()), cx))
                    .child(detail_row("Installed schema", ext.installed_schema.clone().unwrap_or_else(|| "Not installed".into()), cx))
                    .child(detail_row("Default schema", ext.default_schema.clone().unwrap_or_else(|| "Database default".into()), cx))
                    .child(detail_row("Dependencies", ext.requires.clone().filter(|s| !s.is_empty()).unwrap_or_else(|| "None".into()), cx))
                    .child(detail_row("Available versions", ext.available_versions.clone().unwrap_or(default_version), cx)),
            )
            .when(!caps.is_empty(), |s| {
                s.child(
                    div()
                        .mt_5()
                        .child(div().mb_2().tw_text_xs().text_color(with_alpha(t.muted_foreground, 0.6)).child(rexa_ui::tracked_text::tracked("Capabilities", 0.14)))
                        .child(div().flex().flex_wrap().gap_2().children(caps.into_iter().map(|c| Badge::new(c).variant(BadgeVariant::Outline)))),
                )
            })
            .footer(div().ml_auto().child(toggle))
            .into_any_element()
    }
}

impl Render for ExtensionsList {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let needle = self.base.query(cx).to_lowercase();
        let filtered: Vec<ExtensionInfo> = self
            .extensions
            .iter()
            .filter(|e| e.name.to_lowercase().contains(&needle) || e.comment.as_deref().is_some_and(|c| c.to_lowercase().contains(&needle)))
            .cloned()
            .collect();
        let width = f32::from(self.grid_bounds.get().size.width);
        let min = if self.base.loading { 240. } else { 260. };
        let cols = (((width + 16.) / (min + 16.)).floor() as usize).max(1);
        let studio_border = t.var_or("--studio-border", t.border);

        let grid: AnyElement = if self.base.loading && !self.base.loaded_once {
            grid_rows(
                (0..6).map(|_| div().h_32().bg(with_alpha(t.background, 0.2)).tw_rounded_lg().border_1().border_color(studio_border).min_w_0().into_any_element()).collect(),
                cols,
            )
        } else if filtered.is_empty() {
            div()
                .py_12()
                .px_4()
                .flex()
                .flex_col()
                .items_center()
                .text_center()
                .border_2()
                .border_dashed()
                .border_color(studio_border)
                .rounded(px(16.))
                .child(Icon::new(IconName::Box).size_8().mb_3().text_color(with_alpha(t.muted_foreground, 0.2)))
                .child(div().tw_text_sm().text_color(t.muted_foreground).child("No extensions found matching your search."))
                .into_any_element()
        } else {
            let cards: Vec<AnyElement> = filtered.iter().map(|e| self.card(e, cx)).collect();
            grid_rows(cards, cols)
        };
        let selected = self.selected.as_ref().and_then(|n| self.extensions.iter().find(|e| &e.name == n)).cloned();
        let sheet = selected.map(|e| self.details(&e, cx));
        let bounds = self.grid_bounds.clone();

        div()
            .size_full()
            .relative()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(
                div().id("ext-scroll").size_full().overflow_y_scroll().child(
                    div()
                        .max_w(px(1024.))
                        .mx_auto()
                        .w_full()
                        .p_8()
                        .flex()
                        .flex_col()
                        .gap_8()
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap_1()
                                .child(div().tw_text_sm().font_weight(FontWeight::BOLD).child(rexa_ui::tight("Extensions")))
                                .child(div().tw_text_sm().text_color(t.muted_foreground).child("PostgreSQL extensions provide additional functionality to your database.")),
                        )
                        .child(
                            div().w_full().max_w(px(448.)).child(
                                rexa_ui::TextInput::new(&self.base.search)
                                    .h(40.)
                                    .prefix(Icon::new(IconName::Search).size_4().text_color(with_alpha(t.muted_foreground, 0.5))),
                            ),
                        )
                        .child(
                            div()
                                .relative()
                                .child(crate::common::width_tracker(bounds))
                                .child(grid),
                        ),
                ),
            )
            .children(sheet)
    }
}

/// Lay `items` out in rows of `cols` equal columns (gap-4).
fn grid_rows(items: Vec<AnyElement>, cols: usize) -> AnyElement {
    let mut out = div().flex().flex_col().gap_4();
    let mut it = items.into_iter().peekable();
    while it.peek().is_some() {
        let mut row = div().flex().gap_4();
        for _ in 0..cols {
            row = row.child(match it.next() {
                Some(el) => div().flex_1().min_w_0().flex().flex_col().child(el),
                None => div().flex_1().min_w_0(),
            });
        }
        out = out.child(row);
    }
    out.into_any_element()
}
