//! Port of `components/studio/payments/views/setup-view.tsx`.

use super::deploy::{
    self, create_stripe_webhook, deploy_functions, expose_schema, get_status, is_sync_blocking_error, push_schema, set_secrets, setup_complete, summarize_sync, sync_products, PaykitProjectStatus,
};
use super::sql::{self, SchemaPhase};
use super::{load_drafts, validate_drafts, DraftState};
use crate::supabase::{self, Access, ConnInfo};
use crate::ui;
use gpui::{div, prelude::*, px, AnyElement, App, AppContext, Context, Entity, FontWeight, SharedString, Window};
use rexa_core::Session;
use rexa_ui::widgets::{Icon, InputState};
use rexa_ui::{
    tw, with_alpha, ActiveTokens, Button, ButtonSize, Dialog, IconName, OverlayId, PasswordInput, Spinner, Toast, Tokens, Tw, MONO,
};
use std::sync::Arc;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Phase {
    Schema,
    Tables,
    Deploy,
    Expose,
    Verify,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum StepId {
    Schema,
    Tables,
    Functions,
    Verify,
}

impl StepId {
    fn label(self) -> &'static str {
        match self {
            Self::Schema => "Setting up the schema",
            Self::Tables => "Creating tables",
            Self::Functions => "Creating edge functions",
            Self::Verify => "Verifying setup",
        }
    }
    fn all() -> [StepId; 4] {
        [Self::Schema, Self::Tables, Self::Functions, Self::Verify]
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum StepStatus {
    Pending,
    InProgress,
    Completed,
    Failed,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum DialogTab {
    Secrets,
    Webhook,
}

pub struct SetupView {
    info: Option<ConnInfo>,
    access: Option<Access>,
    drafts: Option<DraftState>,
    status: Option<PaykitProjectStatus>,
    phase: Option<Phase>,
    completed: Vec<StepId>,
    failed_step: Option<StepId>,
    ran: bool,
    run_error: Option<String>,
    expose_note: Option<String>,
    gate_run: bool,
    saved_secrets_ref: Option<String>,
    dialog: Option<OverlayId>,
    dialog_tab: DialogTab,
    stripe_key: Entity<InputState>,
    secret_key: Entity<InputState>,
    webhook_secret: Entity<InputState>,
    saving_secrets: bool,
    creating_endpoint: bool,
    saving_webhook_secret: bool,
    endpoint_result: Option<(String, String, bool)>,
    endpoint_error: Option<String>,
    loading: bool,
}

impl SetupView {
    pub fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let vault = rexa_core::credential_vault(cx);
        let info = supabase::connection_info(&session, vault.as_deref());
        let drafts = info.as_ref().map(|i| load_drafts(&i.project_ref));
        let mut input = |p: &str, cx: &mut Context<Self>| cx.new(|cx| InputState::new(window, cx).masked(true).placeholder(p.to_string()));
        let (stripe_key, secret_key, webhook_secret) = (input("sk_test_…", cx), input("sk_…", cx), input("whsec_…", cx));
        let mut this = Self {
            info,
            access: None,
            drafts,
            status: None,
            phase: None,
            completed: vec![],
            failed_step: None,
            ran: false,
            run_error: None,
            expose_note: None,
            gate_run: false,
            saved_secrets_ref: None,
            dialog: None,
            dialog_tab: DialogTab::Secrets,
            stripe_key,
            secret_key,
            webhook_secret,
            saving_secrets: false,
            creating_endpoint: false,
            saving_webhook_secret: false,
            endpoint_result: None,
            endpoint_error: None,
            loading: false,
        };
        this.refresh(cx);
        this
    }

    fn project_ref(&self) -> Option<&str> {
        self.info.as_ref().map(|i| i.project_ref.as_str())
    }

    fn draft_errors(&self) -> Vec<String> {
        match &self.drafts {
            Some(d) => validate_drafts(d),
            None => vec!["No plans defined.".into()],
        }
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        let info = self.info.clone();
        self.loading = true;
        cx.notify();
        ui::run(
            cx,
            async move {
                let a = supabase::resolve_access(info).await?.ok_or_else(|| anyhow::anyhow!("No Supabase access."))?;
                let status = get_status(&a).await?;
                Ok((a, status))
            },
            |this, r, _| {
                this.loading = false;
                if let Ok((a, status)) = r {
                    this.access = Some(a);
                    this.status = Some(status);
                }
            },
        );
    }

    fn functions_deployed(status: &PaykitProjectStatus) -> bool {
        !status.functions.is_empty() && status.functions.iter().all(|f| f.deployed)
    }

    fn step_status(&self, id: StepId) -> StepStatus {
        if self.failed_step == Some(id) {
            return StepStatus::Failed;
        }
        if self.completed.contains(&id) {
            return StepStatus::Completed;
        }
        let active = match self.phase {
            Some(Phase::Schema) => Some(StepId::Schema),
            Some(Phase::Tables) => Some(StepId::Tables),
            Some(Phase::Deploy) => Some(StepId::Functions),
            Some(Phase::Expose) | Some(Phase::Verify) => Some(StepId::Verify),
            None => None,
        };
        if active == Some(id) {
            return StepStatus::InProgress;
        }
        let Some(status) = &self.status else { return StepStatus::Pending };
        match id {
            StepId::Schema if status.schema_exists => StepStatus::Completed,
            StepId::Tables if status.schema_ready => StepStatus::Completed,
            StepId::Functions if Self::functions_deployed(status) => StepStatus::Completed,
            StepId::Verify if setup_complete(status) => StepStatus::Completed,
            _ => StepStatus::Pending,
        }
    }

    fn close_dialog(&mut self, cx: &mut Context<Self>) {
        if let Some(id) = self.dialog.take() {
            rexa_ui::close_overlay(id, cx);
        }
        self.gate_run = false;
        cx.notify();
    }

    fn open_secrets_dialog(&mut self, gate: bool, cx: &mut Context<Self>) {
        self.gate_run = gate;
        self.dialog_tab = DialogTab::Secrets;
        if self.dialog.is_some() {
            cx.notify();
            return;
        }
        let weak = cx.entity().downgrade();
        self.dialog = Some(rexa_ui::open_dialog(cx, move |_, cx| {
            let Some(view) = weak.upgrade() else { return Dialog::new() };
            render_secrets_dialog(&view, cx)
        }));
        cx.notify();
    }

    fn save_secrets(&mut self, cx: &mut Context<Self>) {
        let Some(a) = self.access.clone() else { return };
        let mut payload = Vec::new();
        let sk = self.secret_key.read(cx).value().trim().to_string();
        let wh = self.webhook_secret.read(cx).value().trim().to_string();
        if !sk.is_empty() {
            payload.push(("STRIPE_SECRET_KEY".into(), sk));
        }
        if !wh.is_empty() {
            payload.push(("STRIPE_WEBHOOK_SECRET".into(), wh));
        }
        if payload.is_empty() {
            Toast::error("Enter at least one secret value.").show(cx);
            return;
        }
        let should_run = self.gate_run;
        let project_ref = self.project_ref().map(str::to_string);
        self.saving_secrets = true;
        cx.notify();
        ui::run(
            cx,
            async move { set_secrets(&a, &payload).await },
            move |this, r, cx| {
                this.saving_secrets = false;
                match r {
                    Ok(_) => {
                        this.gate_run = false;
                        this.saved_secrets_ref = project_ref;
                        this.close_dialog(cx);
                        Toast::success("Secrets saved to the Supabase project.").show(cx);
                        this.refresh(cx);
                        if should_run {
                            this.run_setup(cx);
                        }
                    }
                    Err(e) => {
                        Toast::error(format!("{e:#}")).show(cx);
                    }
                }
            },
        );
    }

    fn auto_create_endpoint(&mut self, cx: &mut Context<Self>) {
        let key = {
            let from_stripe = self.stripe_key.read(cx).value().trim().to_string();
            if from_stripe.is_empty() { self.secret_key.read(cx).value().trim().to_string() } else { from_stripe }
        };
        if key.is_empty() {
            Toast::error("Paste your Stripe secret key first (sk_test_… or sk_live_…).").show(cx);
            return;
        }
        let Some(url) = self.project_ref().map(deploy::paykit_webhook_url) else {
            Toast::error("No endpoint URL — open a Supabase project connection first.").show(cx);
            return;
        };
        self.creating_endpoint = true;
        self.endpoint_error = None;
        self.endpoint_result = None;
        cx.notify();
        let events: Vec<String> = sql::webhook_events().to_vec();
        ui::run(
            cx,
            async move {
                let refs: Vec<&str> = events.iter().map(String::as_str).collect();
                create_stripe_webhook(&key, &url, &refs).await
            },
            |this, r, cx| {
                this.creating_endpoint = false;
                match r {
                    Ok(ep) => {
                        this.endpoint_result = Some((ep.id, ep.secret, ep.livemode));
                        Toast::success("Endpoint created in Stripe — save the signing secret below.").show(cx);
                    }
                    Err(e) => this.endpoint_error = Some(format!("{e:#}")),
                }
            },
        );
    }

    fn save_webhook_secret(&mut self, cx: &mut Context<Self>) {
        let Some(a) = self.access.clone() else { return };
        let Some((_, secret, _)) = self.endpoint_result.clone() else { return };
        self.saving_webhook_secret = true;
        cx.notify();
        ui::run(
            cx,
            async move { set_secrets(&a, &[("STRIPE_WEBHOOK_SECRET".into(), secret)]).await },
            |this, r, cx| {
                this.saving_webhook_secret = false;
                match r {
                    Ok(_) => {
                        Toast::success("Webhook signing secret saved to the Supabase project.").show(cx);
                        this.refresh(cx);
                    }
                    Err(e) => {
                        Toast::error(format!("{e:#}")).show(cx);
                    }
                }
            },
        );
    }

    fn handle_run_click(&mut self, cx: &mut Context<Self>) {
        if !self.draft_errors().is_empty() {
            Toast::error("Fix plan errors in the Plans tab before running setup.").show(cx);
            return;
        }
        let ready = self.status.as_ref().is_some_and(|s| s.secrets_ready) || self.saved_secrets_ref.as_deref() == self.project_ref();
        if ready {
            self.run_setup(cx);
        } else {
            self.open_secrets_dialog(true, cx);
        }
    }

    fn run_setup(&mut self, cx: &mut Context<Self>) {
        let Some(a) = self.access.clone() else { return };
        let Some(drafts) = self.drafts.clone() else { return };
        if !self.draft_errors().is_empty() {
            Toast::error("Fix plan errors in the Plans tab before running setup.").show(cx);
            return;
        }
        self.run_error = None;
        self.expose_note = None;
        self.completed.clear();
        self.failed_step = None;
        self.phase = Some(Phase::Schema);
        cx.notify();

        ui::run(
            cx,
            async move {
                push_schema(&a, SchemaPhase::Schema).await.map_err(|e| phase_err(Phase::Schema, e))?;
                push_schema(&a, SchemaPhase::Tables).await.map_err(|e| phase_err(Phase::Tables, e))?;
                let deployed = deploy_functions(&a, &drafts).await.map_err(|e| phase_err(Phase::Deploy, e))?;
                if deployed.results.iter().any(|r| !r.deployed) {
                    let msg = deployed
                        .results
                        .iter()
                        .filter(|r| !r.deployed)
                        .map(|r| format!("{}: {}", r.slug, r.error.as_deref().unwrap_or("failed")))
                        .collect::<Vec<_>>()
                        .join(" ");
                    return Err(phase_err(Phase::Deploy, anyhow::anyhow!(msg)));
                }
                let mut notes = Vec::new();
                if let Err(e) = expose_schema(&a).await {
                    notes.push(format!("{e:#}"));
                }
                let fresh = get_status(&a).await.ok();
                if fresh.as_ref().is_some_and(|s| !s.secrets_ready) {
                    notes.push("Finish by adding your Stripe secrets below.".into());
                }
                let mut blocking = false;
                match sync_products(&a).await {
                    Ok(synced) => {
                        let (n, prices) = summarize_sync(&synced.products);
                        notes.push(format!("Synced {n} product{} to Stripe ({prices} with prices).", if n == 1 { "" } else { "s" }));
                    }
                    Err(e) => {
                        let message = format!("{e:#}");
                        notes.push(format!("Auto-sync skipped: {message} — use Sync to Stripe in the Plans tab."));
                        if is_sync_blocking_error(&message) {
                            blocking = true;
                        }
                    }
                }
                Ok(RunOutcome { notes, blocking, status: fresh })
            },
            |this, r, cx| {
                this.phase = None;
                this.ran = true;
                match r {
                    Ok(out) => {
                        this.completed = vec![StepId::Schema, StepId::Tables, StepId::Functions];
                        if out.blocking {
                            this.failed_step = Some(StepId::Verify);
                        } else {
                            this.completed.push(StepId::Verify);
                        }
                        if !out.notes.is_empty() {
                            this.expose_note = Some(out.notes.join(" "));
                        }
                        if let Some(s) = out.status {
                            this.status = Some(s);
                        }
                        Toast::success("Setup finished. Add Stripe secrets if you haven't yet.").show(cx);
                    }
                    Err(e) => {
                        let msg = format!("{e:#}");
                        this.failed_step = Some(step_from_phase_err(&msg));
                        this.completed = match this.failed_step {
                            Some(StepId::Schema) => vec![],
                            Some(StepId::Tables) => vec![StepId::Schema],
                            Some(StepId::Functions) => vec![StepId::Schema, StepId::Tables],
                            _ => vec![StepId::Schema, StepId::Tables, StepId::Functions],
                        };
                        this.run_error = Some(strip_phase_prefix(&msg));
                    }
                }
                this.refresh(cx);
            },
        );
    }
}

struct RunOutcome {
    notes: Vec<String>,
    blocking: bool,
    status: Option<PaykitProjectStatus>,
}

fn phase_err(phase: Phase, e: impl std::fmt::Display) -> anyhow::Error {
    anyhow::anyhow!("__PHASE__{phase:?}__{e}")
}

fn step_from_phase_err(msg: &str) -> StepId {
    if msg.contains("__PHASE__Schema__") {
        StepId::Schema
    } else if msg.contains("__PHASE__Tables__") {
        StepId::Tables
    } else if msg.contains("__PHASE__Deploy__") {
        StepId::Functions
    } else {
        StepId::Verify
    }
}

fn strip_phase_prefix(msg: &str) -> String {
    if let Some(rest) = msg.split("__PHASE__").nth(1) {
        if let Some((_, body)) = rest.split_once("__") {
            return body.to_string();
        }
    }
    msg.to_string()
}

fn render_secrets_dialog(view: &Entity<SetupView>, cx: &App) -> Dialog {
    let t = cx.tokens().clone();
    let weak = view.downgrade();
    let v = view.read(cx);
    let tab = v.dialog_tab;
    let gate = v.gate_run;
    let saving = v.saving_secrets;
    let secret_key = v.secret_key.clone();
    let webhook_secret = v.webhook_secret.clone();
    let stripe_key = v.stripe_key.clone();
    let webhook_url = v.project_ref().map(deploy::paykit_webhook_url).unwrap_or_default();
    let creating = v.creating_endpoint;
    let endpoint = v.endpoint_result.clone();
    let endpoint_error = v.endpoint_error.clone();
    let saving_wh = v.saving_webhook_secret;
    let sk_set = v.status.as_ref().and_then(|s| s.secrets_present.get("STRIPE_SECRET_KEY").copied()).unwrap_or(false);
    let wh_set = v.status.as_ref().and_then(|s| s.secrets_present.get("STRIPE_WEBHOOK_SECRET").copied()).unwrap_or(false);
    let live_warn = stripe_key.read(cx).value().trim().starts_with("sk_live_");
    let events = sql::webhook_events().join(", ");

    let tabs = div()
        .flex()
        .gap_1()
        .rounded_full()
        .border_1()
        .border_color(with_alpha(t.border, 0.7))
        .bg(with_alpha(t.muted, 0.4))
        .p_1()
        .child(tab_chip("sec-tab-secrets", "Secrets", tab == DialogTab::Secrets, {
            let w = weak.clone();
            move |_, _, cx| {
                w.update(cx, |s, cx| {
                    s.dialog_tab = DialogTab::Secrets;
                    cx.notify();
                })
                .ok();
            }
        }))
        .child(tab_chip("sec-tab-webhook", "Webhook setup", tab == DialogTab::Webhook, {
            let w = weak.clone();
            move |_, _, cx| {
                w.update(cx, |s, cx| {
                    s.dialog_tab = DialogTab::Webhook;
                    cx.notify();
                })
                .ok();
            }
        }));

    let body: AnyElement = if tab == DialogTab::Secrets {
        div()
            .flex()
            .flex_col()
            .gap_3()
            .child(tabs)
            .when(gate, |d| d.child(div().tw_text_xs().text_color(t.muted_foreground).child("Add your Stripe keys to continue — setup starts automatically after saving.")))
            .child(secret_field("STRIPE_SECRET_KEY", sk_set, PasswordInput::new("pk-sk", &secret_key).into_any_element(), "Lets your Edge Functions create checkouts, customers and prices.", &t))
            .child(secret_field("STRIPE_WEBHOOK_SECRET", wh_set, PasswordInput::new("pk-wh", &webhook_secret).into_any_element(), "Proves webhooks really came from Stripe. Register the endpoint first (Webhook setup tab).", &t))
            .child(div().text_size(px(11.)).text_color(t.muted_foreground).child("Values go straight to Supabase secrets — never stored in RexaDB."))
            .into_any_element()
    } else {
        let auto = if let Some((id, secret, live)) = endpoint {
            div()
                .flex()
                .flex_col()
                .gap_2()
                .child(div().font_family(MONO).text_size(px(11.)).text_color(t.muted_foreground).child(format!("Endpoint {id} created — save its signing secret:")))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap_1()
                        .child(div().flex_1().min_w_0().truncate().font_family(MONO).text_size(px(11.)).tw_rounded_lg().border_1().border_color(with_alpha(t.border, 0.7)).bg(with_alpha(t.muted, 0.4)).px_2().py_2().child(secret.clone()))
                        .child(Button::new("pk-copy-secret").outline().size(ButtonSize::Sm).icon(IconName::Copy).label("Copy").on_click({
                            let s = secret.clone();
                            move |_, _, cx| ui::copy(s.clone(), "Signing secret copied.", cx)
                        })),
                )
                .child({
                    let w = weak.clone();
                    Button::new("pk-save-wh").size(ButtonSize::Sm).label(if saving_wh { "Saving…" } else { "Save as STRIPE_WEBHOOK_SECRET" }).disabled(saving_wh).on_click(move |_, _, cx| {
                        w.update(cx, |s, cx| s.save_webhook_secret(cx)).ok();
                    })
                })
                .child(div().text_size(px(10.)).text_color(if live { tw("amber-500") } else { tw("green-500") }).child(if live { "live" } else { "test" }))
                .into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap_2()
                .child(div().text_size(px(11.)).text_color(t.muted_foreground).child(format!("Creates the endpoint with the URL above and all {} events pre-set.", sql::webhook_events().len())))
                .child(PasswordInput::new("pk-stripe-key", &stripe_key))
                .when(live_warn, |d| d.child(div().text_size(px(11.)).text_color(tw("amber-500")).child("Live key — this creates a LIVE endpoint.")))
                .children(endpoint_error.map(|e| div().text_size(px(11.)).text_color(t.destructive).child(e)))
                .child({
                    let w = weak.clone();
                    let disabled = creating || webhook_url.is_empty();
                    Button::new("pk-create-ep").size(ButtonSize::Sm).label(if creating { "Creating…" } else { "Create endpoint" }).disabled(disabled).on_click(move |_, _, cx| {
                        w.update(cx, |s, cx| s.auto_create_endpoint(cx)).ok();
                    })
                })
                .into_any_element()
        };

        div()
            .flex()
            .flex_col()
            .gap_3()
            .child(tabs)
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child("Endpoint URL"))
                    .child(
                        div()
                            .flex()
                            .items_center()
                            .gap_1()
                            .child(div().flex_1().min_w_0().truncate().font_family(MONO).text_size(px(11.)).tw_rounded_lg().border_1().border_color(with_alpha(t.border, 0.7)).bg(with_alpha(t.muted, 0.4)).px_2().py_2().child(if webhook_url.is_empty() { "—".into() } else { webhook_url.clone() }))
                            .child(Button::new("pk-copy-url").outline().size(ButtonSize::Sm).icon(IconName::Copy).label("Copy").on_click({
                                let url = webhook_url.clone();
                                move |_, _, cx| ui::copy(url.clone(), "Webhook URL copied.", cx)
                            }))
                            .child(Button::new("pk-open-stripe").outline().size(ButtonSize::Sm).icon(IconName::ExternalLink).label("Open Stripe").on_click(|_, _, cx| cx.open_url("https://dashboard.stripe.com/webhooks"))),
                    ),
            )
            .child(div().flex().flex_col().gap_2().tw_rounded_xl().border_1().border_color(with_alpha(t.border, 0.7)).bg(with_alpha(t.muted, 0.2)).p_2().child(div().tw_text_xs().font_weight(FontWeight::MEDIUM).child("Auto-create in Stripe")).child(auto))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_1()
                    .text_size(px(12.))
                    .text_color(t.muted_foreground)
                    .child("1. Stripe Dashboard → Developers → Webhooks → Add endpoint.")
                    .child("2. Paste the endpoint URL above.")
                    .child(div().child(format!("3. Select events: {events}.")))
                    .child("4. Add endpoint, then Reveal → copy the Signing secret.")
                    .child("5. Back on the Secrets tab, save it as STRIPE_WEBHOOK_SECRET."),
            )
            .into_any_element()
    };

    let footer = if tab == DialogTab::Secrets {
        let w1 = weak.clone();
        let w2 = weak.clone();
        div()
            .flex()
            .justify_end()
            .gap_2()
            .child(Button::new("pk-sec-cancel").ghost().size(ButtonSize::Sm).label("Cancel").disabled(saving).on_click(move |_, _, cx| {
                w1.update(cx, |s, cx| s.close_dialog(cx)).ok();
            }))
            .child(Button::new("pk-sec-save").size(ButtonSize::Sm).label(if saving { "Saving…" } else { "Save secrets" }).disabled(saving).on_click(move |_, _, cx| {
                w2.update(cx, |s, cx| s.save_secrets(cx)).ok();
            }))
            .into_any_element()
    } else {
        let w = weak.clone();
        div()
            .flex()
            .justify_end()
            .child(Button::new("pk-wh-back").ghost().size(ButtonSize::Sm).label("Back to secrets").on_click(move |_, _, cx| {
                w.update(cx, |s, cx| {
                    s.dialog_tab = DialogTab::Secrets;
                    cx.notify();
                })
                .ok();
            }))
            .into_any_element()
    };

    Dialog::new().max_w(448.).title("Set secrets").child(body).footer(footer)
}

fn tab_chip(id: &'static str, label: &'static str, active: bool, on: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static) -> AnyElement {
    Button::new(id).ghost().size(ButtonSize::Sm).label(label).selected(active).on_click(on).into_any_element()
}

fn secret_field(name: &str, set: bool, input: AnyElement, hint: &str, t: &Tokens) -> AnyElement {
    div()
        .flex()
        .flex_col()
        .gap_1()
        .child(
            div()
                .flex()
                .items_center()
                .gap_2()
                .font_family(MONO)
                .tw_text_xs()
                .child(name.to_string())
                .when(set, |d| {
                    d.child(div().rounded_full().border_1().border_color(with_alpha(tw("green-500"), 0.3)).bg(with_alpha(tw("green-500"), 0.1)).px_1().text_size(px(10.)).text_color(tw("green-500")).child("set"))
                }),
        )
        .child(input)
        .child(div().text_size(px(11.)).text_color(t.muted_foreground).child(hint.to_string()))
        .into_any_element()
}

fn step_icon(status: StepStatus, cx: &App) -> AnyElement {
    let t = cx.tokens();
    match status {
        StepStatus::Completed => Icon::new(IconName::Check).size(px(14.)).text_color(tw("green-500")).into_any_element(),
        StepStatus::Failed => Icon::new(IconName::TriangleAlert).size(px(14.)).text_color(t.destructive).into_any_element(),
        StepStatus::InProgress => Spinner::new(14.).into_any_element(),
        StepStatus::Pending => div().size(px(14.)).rounded_full().border_1().border_color(with_alpha(t.border, 0.7)).into_any_element(),
    }
}

impl gpui::Render for SetupView {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens();
        let running = self.phase.is_some();
        let done = self.status.as_ref().is_some_and(setup_complete);
        let last_run_clean = self.ran && self.run_error.is_none() && self.failed_step.is_none();
        let show_run = !running && !done && !last_run_clean;
        let show_secrets = !running && !done && (last_run_clean || self.status.as_ref().is_some_and(|s| !s.secrets_ready));
        let draft_errors = self.draft_errors();
        let present = self.status.as_ref().map(|s| s.tables.iter().filter(|t| t.present).count()).unwrap_or(0);
        let has_ref = self.project_ref().is_some();
        let has_access = self.access.is_some();
        let loading = self.loading;
        let note = self.run_error.clone().or_else(|| self.expose_note.clone());

        let task_list = div()
            .flex()
            .flex_col()
            .gap_2()
            .w_full()
            .max_w(px(440.))
            .children(StepId::all().into_iter().map(|id| {
                let status = self.step_status(id);
                let detail = match id {
                    StepId::Schema => format!("Schema · {}", if self.status.as_ref().is_some_and(|s| s.schema_exists) { "exists" } else { "missing" }),
                    StepId::Tables => format!("{present}/10 tables"),
                    StepId::Functions => {
                        let fns = self.status.as_ref().map(|s| s.functions.iter().filter(|f| f.deployed).count()).unwrap_or(0);
                        format!("{fns}/2 live")
                    }
                    StepId::Verify => {
                        let secrets = self.status.as_ref().map(|s| if s.secrets_ready { "set" } else { "missing" }).unwrap_or("—");
                        format!("Secrets · {secrets}")
                    }
                };
                let row = div()
                    .flex()
                    .items_center()
                    .gap_3()
                    .rounded_full()
                    .border_1()
                    .border_color(with_alpha(t.border, 0.7))
                    .bg(t.card)
                    .px_4()
                    .py_2()
                    .child(step_icon(status, cx))
                    .child(div().flex_1().min_w_0().child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child(id.label())).child(div().text_size(px(11.)).text_color(t.muted_foreground).child(detail)));
                if status == StepStatus::Failed {
                    let w = cx.entity().downgrade();
                    row.child(Button::new(SharedString::from(format!("pk-retry-{}", id.label()))).ghost().size(ButtonSize::Sm).label("Retry").on_click(move |_, _, cx| {
                        w.update(cx, |s, cx| {
                            s.failed_step = None;
                            s.run_error = None;
                            s.run_setup(cx);
                        })
                        .ok();
                    }))
                    .into_any_element()
                } else {
                    row.into_any_element()
                }
            }));

        let mut actions = div().mx_auto().mt_4().flex().w_full().max_w(px(440.)).items_center().gap_2();
        if show_run {
            let w = cx.entity().downgrade();
            let disabled = !draft_errors.is_empty() || !has_access;
            actions = actions.child(Button::new("pk-run").outline().label("Run setup").disabled(disabled).on_click(move |_, _, cx| {
                w.update(cx, |s, cx| s.handle_run_click(cx)).ok();
            }));
        }
        if running {
            actions = actions.child(Button::new("pk-running").outline().label("Setting up…").disabled(true));
        }
        if show_secrets {
            let w = cx.entity().downgrade();
            actions = actions.child(Button::new("pk-set-secrets").outline().label("Set secrets").disabled(!has_access || self.saving_secrets).on_click(move |_, _, cx| {
                w.update(cx, |s, cx| s.open_secrets_dialog(false, cx)).ok();
            }));
        }
        if done && !running {
            actions = actions.child(Button::new("pk-done").outline().icon(IconName::Check).label("Completed").disabled(true));
            if let Some(d) = &self.drafts {
                actions = actions.child(super::prompt::copy_prompt_button("pk-copy-prompt", d, self.project_ref().unwrap_or(""), true));
            }
        }

        let content: AnyElement = if !has_ref {
            div().py_4().text_center().tw_text_sm().text_color(t.muted_foreground).child("Open a Supabase project connection to set up billing.").into_any_element()
        } else if !has_access && !loading {
            div().py_4().text_center().tw_text_sm().text_color(t.muted_foreground).child("Direct Postgres connection with no linked Supabase account that can see this project. Link the account in the Supabase tab to run automatic setup.").into_any_element()
        } else {
            let mut col = div().flex().flex_col().child(div().flex().justify_center().child(task_list));
            if let Some(n) = note {
                col = col.child(
                    div()
                        .mx_auto()
                        .mt_5()
                        .flex()
                        .w_full()
                        .max_w(px(440.))
                        .items_center()
                        .justify_center()
                        .rounded_full()
                        .border_1()
                        .border_color(with_alpha(t.border, 0.7))
                        .bg(t.card)
                        .px_8()
                        .py_3()
                        .text_center()
                        .child(div().tw_text_xs().text_color(t.muted_foreground).child(n)),
                );
            }
            col = col.child(actions);
            if !draft_errors.is_empty() {
                col = col.child(div().mt_2().text_right().text_size(px(11.)).text_color(tw("amber-500")).child("Define valid plans first (Plans tab) to enable Run setup."));
            }
            col.into_any_element()
        };

        div()
            .id("paykit-setup")
            .size_full()
            .overflow_y_scroll()
            .bg(t.studio_bg)
            .text_color(t.foreground)
            .child(
                div()
                    .mx_auto()
                    .my_auto()
                    .flex()
                    .w_full()
                    .max_w(px(576.))
                    .flex_col()
                    .gap_6()
                    .px_4()
                    .py_10()
                    .child(div().flex().items_center().justify_center().gap_3().child(div().tw_text_2xl().font_weight(FontWeight::SEMIBOLD).child("PayKit Setup")))
                    .child(div().px_1().py_2().child(content)),
            )
    }
}
