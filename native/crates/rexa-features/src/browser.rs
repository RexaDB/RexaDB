//! Browser tab fallback for GPUI, which does not embed a webview.

use gpui::{div, prelude::*, px, App, AppContext, Context, Entity, Subscription, Window};
use gpui_component::input::{Input, InputEvent, InputState};
use rexa_core::{emit_studio, Registry, Session, StudioEvent, TabSpec};
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, Tw};

pub struct BrowserTab {
    spec: TabSpec,
    address: Entity<InputState>,
    history: Vec<String>,
    history_index: usize,
    _sub: Subscription,
}

impl BrowserTab {
    fn new(
        spec: TabSpec,
        params: &serde_json::Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let mut history: Vec<String> = params
            .get("history")
            .and_then(serde_json::Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(serde_json::Value::as_str)
            .filter_map(|url| normalize_url(url).ok())
            .take(100)
            .collect();
        let mut history_index = params
            .get("historyIndex")
            .and_then(serde_json::Value::as_u64)
            .map(|index| index as usize)
            .unwrap_or_else(|| history.len().saturating_sub(1))
            .min(history.len().saturating_sub(1));
        let initial = params
            .get("url")
            .and_then(serde_json::Value::as_str)
            .filter(|url| !url.trim().is_empty())
            .and_then(|url| normalize_url(url).ok())
            .or_else(|| history.get(history_index).cloned())
            .unwrap_or_else(|| "https://www.google.com".to_string());
        if history.is_empty() {
            history.push(initial.clone());
        } else if history[history_index] != initial {
            history.truncate(history_index + 1);
            history.push(initial.clone());
            history_index = history.len() - 1;
        }
        history_index = history_index.min(history.len().saturating_sub(1));
        let address = cx.new(|cx| {
            InputState::new(window, cx)
                .default_value(initial.clone())
                .placeholder("https://example.com")
        });
        let sub = cx.subscribe(&address, |_, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                cx.notify();
            }
        });
        Self {
            spec,
            address,
            history,
            history_index,
            _sub: sub,
        }
    }

    fn navigate(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let raw = self.address.read(cx).value().trim().to_string();
        let url = match normalize_url(&raw) {
            Ok(url) => url,
            Err(error) => {
                rexa_ui::toast::error(error, cx);
                return;
            }
        };
        self.address
            .update(cx, |state, cx| state.set_value(url.clone(), window, cx));
        self.history.truncate(self.history_index + 1);
        if self.history.last() != Some(&url) {
            self.history.push(url.clone());
            if self.history.len() > 100 {
                self.history.remove(0);
            }
        }
        self.history_index = self.history.len().saturating_sub(1);
        self.persist_url(&url, cx);
        cx.open_url(&url);
        rexa_ui::toast::info(
            "Opened in your default browser. This GPUI build does not embed web pages yet.",
            cx,
        );
        cx.notify();
    }

    fn move_history(&mut self, delta: isize, window: &mut Window, cx: &mut Context<Self>) {
        let next = self.history_index as isize + delta;
        if next < 0 || next as usize >= self.history.len() {
            return;
        }
        self.history_index = next as usize;
        let url = self.history[self.history_index].clone();
        self.address
            .update(cx, |state, cx| state.set_value(url.clone(), window, cx));
        self.persist_url(&url, cx);
        cx.open_url(&url);
        cx.notify();
    }

    fn reload(&self, cx: &mut Context<Self>) {
        let url = self
            .history
            .get(self.history_index)
            .cloned()
            .unwrap_or_default();
        if !url.is_empty() {
            cx.open_url(&url);
        }
    }

    fn persist_url(&self, url: &str, cx: &mut Context<Self>) {
        emit_studio(
            StudioEvent::TabParamsChanged {
                tab: self.spec.clone(),
                patch: serde_json::json!({
                    "url": url,
                    "history": &self.history,
                    "historyIndex": self.history_index,
                }),
            },
            cx,
        );
    }
}

fn normalize_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("Enter a web address.".into());
    }
    let candidate = if value.contains("://") {
        value.to_string()
    } else {
        format!("https://{value}")
    };
    let parsed =
        url::Url::parse(&candidate).map_err(|_| "Enter a valid web address.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Only HTTP and HTTPS addresses are supported.".into());
    }
    Ok(parsed.to_string())
}

impl Render for BrowserTab {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let can_back = self.history_index > 0;
        let can_forward = self.history_index + 1 < self.history.len();
        let toolbar = div()
            .flex()
            .items_center()
            .gap_2()
            .border_b_1()
            .border_color(t.border)
            .px_3()
            .py_2()
            .child(
                Button::new("browser-back")
                    .ghost()
                    .size(ButtonSize::IconSm)
                    .icon(IconName::ArrowLeft)
                    .disabled(!can_back)
                    .on_click(cx.listener(|this, _, window, cx| this.move_history(-1, window, cx))),
            )
            .child(
                Button::new("browser-forward")
                    .ghost()
                    .size(ButtonSize::IconSm)
                    .icon(IconName::ArrowRight)
                    .disabled(!can_forward)
                    .on_click(cx.listener(|this, _, window, cx| this.move_history(1, window, cx))),
            )
            .child(
                Button::new("browser-reload")
                    .ghost()
                    .size(ButtonSize::IconSm)
                    .icon(IconName::RefreshCw)
                    .on_click(cx.listener(|this, _, _, cx| this.reload(cx))),
            )
            .child(
                div()
                    .flex_1()
                    .child(Input::new(&self.address).appearance(false)),
            )
            .child(
                Button::new("browser-open")
                    .size(ButtonSize::Sm)
                    .icon(IconName::ExternalLink)
                    .label("Open")
                    .on_click(cx.listener(|this, _, window, cx| this.navigate(window, cx))),
            );
        let message = div()
            .flex_1()
            .flex()
            .items_center()
            .justify_center()
            .p_6()
            .child(div().max_w(px(560.)).flex().flex_col().items_center().gap_3().rounded(px(12.)).border_1().border_color(t.border).bg(t.card).p_6()
                .child(div().size(px(44.)).flex().items_center().justify_center().rounded(px(12.)).bg(t.muted).child(rexa_ui::widgets::Icon::new(IconName::Globe).size_5()))
                .child(div().tw_text_sm().font_weight(gpui::FontWeight::SEMIBOLD).child("Open websites in your browser"))
                .child(div().text_center().tw_text_xs().text_color(t.muted_foreground).child("This native build does not include an embedded webview. Enter a URL above and choose Open to continue in your default browser.")));
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(toolbar)
            .child(message)
    }
}

pub fn init(cx: &mut App) {
    Registry::tab(
        cx,
        "rexa-features-browser",
        |spec, _session: std::sync::Arc<Session>, window, cx| {
            let TabSpec::View { view, params } = spec else {
                return None;
            };
            if view != "browser" {
                return None;
            }
            let (spec, params) = (spec.clone(), params.clone());
            Some(
                cx.new(|cx| BrowserTab::new(spec, &params, window, cx))
                    .into(),
            )
        },
    );
}
