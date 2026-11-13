//! `screen:ui-gallery` — every rexa-ui primitive in its states, for visual
//! checking (`tools/run-native.sh out.png screen:ui-gallery`).
//! `REXA_GALLERY=<section>` shows one section only; `REXA_GALLERY_OPEN=
//! dialog|alert|confirm|sheet|toasts` opens that overlay at startup.

use crate::menu::{self, Menu, MenuItem, MenuStyle};
use crate::{
    ActiveTokens, AlertDialog, Button, ButtonSize, ConfirmOptions, Dialog, DropdownMenu, IconName,
    Popover, Sheet, Side, Toast, Tooltip, Tw,
};
use gpui::{div, prelude::*, px, AnyElement, App, Context, FontWeight, SharedString, Window};

pub struct Gallery {
    only: Option<String>,
}

type Section = fn(&mut Window, &mut Context<Gallery>) -> AnyElement;

impl Gallery {
    pub fn new(_: &mut Window, cx: &mut Context<Self>) -> Self {
        if let Ok(what) = std::env::var("REXA_GALLERY_OPEN") {
            cx.defer(move |cx| open_demo(&what, cx));
        }
        Self { only: std::env::var("REXA_GALLERY").ok() }
    }

    fn sections() -> Vec<(&'static str, Section)> {
        vec![("menus", menus), ("overlays", overlays), ("popovers", popovers)]
    }
}

fn popovers(_: &mut Window, cx: &mut Context<Gallery>) -> AnyElement {
    let t = cx.tokens().clone();
    let icon_btn = |id: &'static str, icon: IconName| Button::new(id).ghost().size(ButtonSize::IconSm).icon(icon);
    row()
        .pt_10()
        .pb_10()
        .gap_16()
        .child(Tooltip::new("Refresh schema").force_open().child(icon_btn("tt1", IconName::RefreshCw)))
        .child(Tooltip::new("Run query").kbd("⌘↵").force_open().child(icon_btn("tt2", IconName::Play)))
        .child(Tooltip::studio("New SQL query").force_open().child(icon_btn("tt3", IconName::Plus)))
        .child(Tooltip::new("Hover me").child(Button::new("tt4").outline().size(ButtonSize::Sm).label("Live tooltip")))
        .child(
            Popover::new("pop-demo")
                .trigger(Button::new("pop-t").outline().size(ButtonSize::Sm).label("Open popover"))
                .content(move |_, _, _| {
                    div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("Dimensions"))
                        .child(div().tw_text_sm().text_color(t.muted_foreground).child("Set the dimensions for the layer."))
                }),
        )
        .into_any_element()
}

pub fn open_demo(what: &str, cx: &mut App) {
    match what {
        "dialog" => {
            crate::open_dialog(cx, |_, _| {
                Dialog::new()
                    .title("Rename connection")
                    .description("Give this connection a name you'll recognise.")
                    .child(div().h_8())
                    .footer(Button::new("d-cancel").outline().label("Cancel").on_click(|_, _, cx| crate::close_top(cx)))
                    .footer(Button::new("d-save").label("Save"))
            });
        }
        "alert" => {
            crate::open_alert_dialog(cx, |_, _| {
                AlertDialog::new()
                    .title("Discard changes?")
                    .description("You have unsaved edits in 3 rows.")
                    .footer(Button::new("a-cancel").outline().label("Cancel").on_click(|_, _, cx| crate::close_top(cx)))
                    .footer(Button::new("a-ok").destructive().label("Discard"))
            });
        }
        "confirm" => {
            let fut = crate::confirm(ConfirmOptions::destructive("Delete table \"users\"?").confirm_text("Delete"), cx);
            cx.spawn(async move |_| {
                let ok = fut.await;
                eprintln!("confirm -> {ok}");
            })
            .detach();
        }
        "sheet" => {
            crate::open_sheet(cx, Side::Right, |_, cx| {
                let t = cx.tokens().clone();
                Sheet::new()
                    .title("Edit row")
                    .description("public.users · id = 42")
                    .child(div().px_4().text_color(t.muted_foreground).child("Sheet body"))
                    .footer(Button::new("s-save").label("Save changes"))
            });
        }
        "toasts" => {
            Toast::message("Copied to clipboard").show(cx);
            Toast::info("3 rows selected").show(cx);
            Toast::error("Query failed").description("relation \"userz\" does not exist").show(cx);
            Toast::success("Saved").action("Undo", |_, _| {}).show(cx);
        }
        _ => {}
    }
}

fn heading(text: &'static str, cx: &App) -> impl IntoElement {
    div()
        .tw_text_xs()
        .font_weight(FontWeight::MEDIUM)
        .text_color(cx.tokens().muted_foreground)
        .child(SharedString::from(text.to_uppercase()))
}

fn row() -> gpui::Div {
    div().flex().flex_wrap().items_start().gap_6()
}

fn sample_menu(m: Menu, _: &mut Window, _: &mut App) -> Menu {
    m.label("My Account")
        .item(MenuItem::new("Profile").icon(IconName::User).shortcut("⇧⌘P"))
        .item(MenuItem::new("Settings").icon(IconName::Settings).shortcut("⌘,"))
        .item(MenuItem::new("Disabled").icon(IconName::Lock).disabled(true))
        .separator()
        .item(MenuItem::checkbox("Show grid lines", true))
        .item(MenuItem::checkbox("Wrap text", false))
        .separator()
        .item(MenuItem::radio("Compact", true))
        .item(MenuItem::radio("Comfortable", false))
        .separator()
        .sub_item(MenuItem::new("Export").icon(IconName::Download), |m, _, _| {
            m.item(MenuItem::new("CSV")).item(MenuItem::new("JSON")).item(MenuItem::new("SQL inserts"))
        })
        .item(MenuItem::new("Log out").icon(IconName::LogOut).destructive().shortcut("⌘Q"))
}

fn context_menu(m: Menu, _: &mut Window, _: &mut App) -> Menu {
    m.item(MenuItem::new("Open").icon(IconName::ExternalLink))
        .item(MenuItem::new("Copy name").icon(IconName::Copy).shortcut("⌘C"))
        .sub("Generate SQL", |m, _, _| m.item(MenuItem::new("SELECT")).item(MenuItem::new("INSERT")))
        .separator()
        .label("View")
        .item(MenuItem::checkbox("Show columns", true))
        .item(MenuItem::radio("By name", true))
        .separator()
        .item(MenuItem::new("Drop table").icon(IconName::Trash).destructive())
}

fn menus(window: &mut Window, cx: &mut Context<Gallery>) -> AnyElement {
    row()
        .child(menu::preview("pv-dropdown", MenuStyle::Dropdown, Some(1), sample_menu, window, cx))
        .child(menu::preview("pv-dropdown-destr", MenuStyle::Dropdown, Some(12), sample_menu, window, cx))
        .child(menu::preview("pv-context", MenuStyle::Context, Some(0), context_menu, window, cx))
        .child(
            div()
                .flex()
                .flex_col()
                .gap_3()
                .child(
                    DropdownMenu::new("dd-live")
                        .trigger_with(|open| Button::new("dd-live-t").outline().label("Open menu").icon_end(IconName::ChevronDown).selected(open))
                        .menu(sample_menu),
                )
                .child(
                    crate::ContextMenu::new("ctx-live")
                        .menu(context_menu)
                        .child(
                            div()
                                .w(px(220.))
                                .h(px(90.))
                                .flex()
                                .items_center()
                                .justify_center()
                                .border_1()
                                .border_dashed()
                                .border_color(cx.tokens().border)
                                .tw_rounded_lg()
                                .tw_text_sm()
                                .text_color(cx.tokens().muted_foreground)
                                .child("Right-click here"),
                        ),
                ),
        )
        .into_any_element()
}

fn overlays(_: &mut Window, _: &mut Context<Gallery>) -> AnyElement {
    let btn = |id: &'static str, label: &'static str, what: &'static str| {
        Button::new(id).outline().size(ButtonSize::Sm).label(label).on_click(move |_, _, cx| open_demo(what, cx))
    };
    row()
        .child(btn("g-dialog", "Dialog", "dialog"))
        .child(btn("g-alert", "Alert dialog", "alert"))
        .child(btn("g-confirm", "Confirm", "confirm"))
        .child(btn("g-sheet", "Sheet", "sheet"))
        .child(btn("g-toasts", "Toasts", "toasts"))
        .child(Button::new("g-loading").outline().size(ButtonSize::Sm).label("Loading toast").on_click(|_, _, cx| {
            let id = Toast::loading("Exporting 1,204 rows…").show(cx);
            cx.spawn(async move |cx| {
                cx.background_executor().timer(std::time::Duration::from_secs(2)).await;
                cx.update(|cx| Toast::success("Export complete").id(id).show(cx));
            })
            .detach();
        }))
        .into_any_element()
}

impl Render for Gallery {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let mut body = div().flex().flex_col().gap_8().p_8().pt(px(44.));
        for (name, f) in Self::sections() {
            if self.only.as_deref().is_some_and(|o| o != name) {
                continue;
            }
            body = body.child(div().flex().flex_col().gap_3().child(heading(name, cx)).child(f(window, cx)));
        }
        div()
            .id("ui-gallery")
            .size_full()
            .bg(t.background)
            .text_color(t.foreground)
            .overflow_y_scroll()
            .child(body)
    }
}
