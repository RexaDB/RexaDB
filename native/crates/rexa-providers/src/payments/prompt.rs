//! Port of `lib/supabase-paykit/{billing-prompt,integration-prompt}.ts` and
//! `components/studio/payments/copy-prompt-button.tsx`.

use super::currencies::currency_symbol;
use super::deploy::{paykit_api_url, paykit_webhook_url};
use super::drafts::DraftState;
use gpui::{prelude::*, px, svg, AnyElement, App};
use rexa_ui::{ActiveTokens, Align, Button, ButtonSize, DropdownMenu, IconName, MenuItem, Toast};

/// `buildBillingPrompt`: Markdown brief of the local drafts.
pub fn build_billing_prompt(d: &DraftState) -> String {
    let mut l: Vec<String> = Vec::new();
    l.push("# Billing setup (RexaDB PayKit drafts)".into());
    l.push(String::new());
    l.push(
        "Help me review and improve this Stripe billing setup. Products sync to Stripe as products/prices; features sync as entitlement features attached to products."
            .into(),
    );
    l.push(String::new());
    l.push("## Products".into());
    if d.plans.is_empty() {
        l.push("- (none yet)".into());
    }
    for p in &d.plans {
        let cur = p.price_currency.as_deref().filter(|c| !c.is_empty()).unwrap_or("usd");
        let price = match p.price_amount.filter(|a| a.is_finite()) {
            None => "Free".to_string(),
            Some(a) => format!(
                "{}{:.2} {} per {}",
                currency_symbol(cur),
                a,
                cur.to_uppercase(),
                if p.price_interval.as_deref() == Some("year") { "year" } else { "month" }
            ),
        };
        let feats = p
            .includes
            .iter()
            .map(|inc| match inc.limit {
                Some(lim) => format!("{} (limit {}/{})", inc.feature_id, fmt_num(lim), inc.reset.as_deref().unwrap_or("month")),
                None => inc.feature_id.clone(),
            })
            .collect::<Vec<_>>()
            .join(", ");
        let feats = if feats.is_empty() { "no features".to_string() } else { feats };
        let name = if !p.name.is_empty() {
            p.name.as_str()
        } else if !p.id.is_empty() {
            p.id.as_str()
        } else {
            "Untitled"
        };
        l.push(format!(
            "- **{name}** (`{}`) — {price}, group `{}`{}. Features: {feats}.",
            if p.id.is_empty() { "no-id" } else { &p.id },
            if p.group.is_empty() { "base" } else { &p.group },
            if p.default == Some(true) { ", default" } else { "" },
        ));
    }
    l.push(String::new());
    l.push("## Features".into());
    if d.features.is_empty() {
        l.push("- (none yet)".into());
    }
    for f in &d.features {
        let desc = f.description.as_deref().map(str::trim).filter(|s| !s.is_empty());
        l.push(format!("- `{}` ({}){}", f.id, f.feature_type, desc.map(|s| format!(" — {s}")).unwrap_or_default()));
    }
    l.push(String::new());
    l.join("\n")
}

/// JS `String(number)` for integral limits.
fn fmt_num(n: f64) -> String {
    if n.fract() == 0.0 && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

fn fetch_block(l: &mut Vec<String>, decl: &str, api: &str, action: &str, body: &str) {
    l.push("```js".into());
    l.push(format!("{decl}fetch(\"{api}?action={action}\", {{"));
    l.push("  method: \"POST\",".into());
    l.push("  headers: {".into());
    l.push("    \"Content-Type\": \"application/json\",".into());
    l.push("    Authorization: \"Bearer \" + supabaseAccessToken,".into());
    l.push("  },".into());
    for line in body.lines() {
        l.push(line.to_string());
    }
    l.push("}).then((r) => r.json());".into());
}

/// `buildIntegrationPrompt`: catalog + app-integration contract. Never contains secrets.
pub fn build_integration_prompt(d: &DraftState, project_ref: &str) -> String {
    let api = paykit_api_url(project_ref);
    let paid_plan = d
        .plans
        .iter()
        .find(|p| p.default != Some(true) && p.price_amount.is_some_and(f64::is_finite))
        .or_else(|| d.plans.iter().find(|p| p.default != Some(true)))
        .or_else(|| d.plans.first());
    let free_plan = d.plans.iter().find(|p| p.default == Some(true));
    let plan_id = paid_plan.map(|p| p.id.as_str()).filter(|s| !s.is_empty()).unwrap_or("pro");
    let feature_id = d.features.first().map(|f| f.id.as_str()).filter(|s| !s.is_empty()).unwrap_or("messages");

    let mut l: Vec<String> = Vec::new();
    l.push(build_billing_prompt(d).trim_end().to_string());
    l.push(String::new());
    l.push("## App integration".into());
    l.push(String::new());
    l.push(format!("Billing API base: `{api}`"));
    l.push(format!("Webhook endpoint (already registered in Stripe): `{}`", paykit_webhook_url(project_ref)));
    l.push(String::new());
    l.push("Every app call below authenticates with the **signed-in user's Supabase access token** (`Authorization: Bearer <user-jwt>`). The anon key and service_role key get 401 — never use them from the app.".into());
    l.push(String::new());
    l.push("### 1. Start checkout (paid plan)".into());
    fetch_block(
        &mut l,
        "const sub = await ",
        &api,
        "subscribe",
        &format!(
            "  body: JSON.stringify({{\n    planId: \"{plan_id}\",\n    successUrl: window.location.origin + \"/billing/success\",\n    cancelUrl: window.location.origin + \"/billing\",\n  }}),"
        ),
    );
    l.push("if (sub.paymentUrl) window.location.href = sub.paymentUrl;".into());
    l.push("```".into());
    l.push(String::new());
    if let Some(fp) = free_plan {
        l.push(format!(
            "Free/default plan (`{}`): the same call returns `{{ active: true }}` with **no `paymentUrl`** — do NOT redirect. Only redirect when `paymentUrl` is present.",
            fp.id
        ));
        l.push(String::new());
    }
    l.push("### 2. Gate a feature (call BEFORE the gated action)".into());
    fetch_block(&mut l, "const gate = await ", &api, "check", &format!("  body: JSON.stringify({{ featureId: \"{feature_id}\" }}),"));
    l.push("if (!gate.allowed) throw new Error(\"Usage limit reached\");".into());
    l.push("```".into());
    l.push(String::new());
    l.push("### 3. Report metered usage (call AFTER the action succeeds)".into());
    fetch_block(&mut l, "await ", &api, "report", &format!("  body: JSON.stringify({{ featureId: \"{feature_id}\", amount: 1 }}),"));
    l.push("```".into());
    l.push(String::new());
    l.push("### 4. Show the user's plan (badges, meters, paywall)".into());
    l.push("One call returns everything a paywall or account page needs —".into());
    l.push("no subscription-list parsing, no suffix stripping:".into());
    fetch_block(&mut l, "const me = await ", &api, "plan", "  body: JSON.stringify({}),");
    l.push("// me = { planId, planName, isDefault, status,".into());
    l.push("//   entitlements: [{ featureId, type, limit, balance, resetAt }] }".into());
    l.push("```".into());
    l.push(String::new());
    l.push("### Rules — do not break these".into());
    l.push("- Always send the signed-in user's access token. Anon/service_role keys return 401.".into());
    l.push("- `successUrl` is required for paid plans (400 without it). Free plans never redirect.".into());
    l.push("- Use the exact plan/feature ids listed above — never invent ids.".into());
    l.push("- Check BEFORE the gated action, report AFTER it succeeds. Reporting on failure drains metered balances for nothing.".into());
    l.push("- Non-admin callers can only act as themselves; there is no acting on behalf of other users.".into());
    l.push("- Never ask for, store, or embed Stripe secret keys, webhook signing secrets, or Supabase service_role keys in app code.".into());
    l.push(String::new());
    l.join("\n")
}

fn copy_text(text: &str, label: &str, cx: &mut App) {
    cx.write_to_clipboard(gpui::ClipboardItem::new_string(text.to_string()));
    Toast::success(label.to_string()).show(cx);
}

/// `encodeURIComponent`.
fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn open_external(prompt: &str, base: &str, label: &str, cx: &mut App) {
    // Very long prompts don't survive URL length limits — copy instead.
    if prompt.chars().count() > 6000 {
        copy_text(prompt, "Prompt too long for a link — copied instead.", cx);
        return;
    }
    cx.open_url(&format!("{base}{}", encode_uri_component(prompt)));
    Toast::success(label.to_string()).show(cx);
}

fn export_markdown(prompt: String, cx: &mut App) {
    let dir = std::env::var("HOME").map(|h| std::path::PathBuf::from(h).join("Downloads")).unwrap_or_default();
    let rx = cx.prompt_for_new_path(&dir, Some("billing-prompt.md"));
    cx.spawn(async move |cx| {
        if let Ok(Ok(Some(p))) = rx.await {
            let r = std::fs::write(p, prompt);
            cx.update(|cx| match r {
                Ok(()) => Toast::success("Exported billing-prompt.md.").show(cx),
                Err(e) => Toast::error(e.to_string()).show(cx),
            });
        }
    })
    .detach();
}

/// Monochrome brand logo; `dark:invert` is emulated by tinting with the foreground.
fn brand_logo(path: &'static str, cx: &App) -> AnyElement {
    svg().path(path).size(px(16.)).flex_shrink_0().text_color(cx.tokens().foreground).into_any_element()
}

/// `CopyPromptButton`. `large` = the setup view's `h-11 rounded-full px-8` trigger.
pub fn copy_prompt_button(id: &'static str, drafts: &DraftState, project_ref: &str, large: bool) -> AnyElement {
    let prompt = build_integration_prompt(drafts, project_ref);
    let trigger = Button::new((id, 0usize))
        .outline()
        .size(if large { ButtonSize::Lg } else { ButtonSize::Sm })
        .icon(IconName::Copy)
        .label("Copy prompt")
        .icon_end(IconName::ChevronDown);
    DropdownMenu::new(id)
        .align(Align::End)
        .trigger(trigger)
        .menu(move |m, _, cx| {
            let (p1, p2, p3, p4, p5) = (prompt.clone(), prompt.clone(), prompt.clone(), prompt.clone(), prompt.clone());
            m.min_w(224.)
                .item(MenuItem::new("Copy to clipboard").icon(IconName::Copy).on_select(move |_, cx| copy_text(&p1, "Prompt copied.", cx)))
                .item(MenuItem::new("Export Markdown file").icon(IconName::Download).on_select(move |_, cx| export_markdown(p2.clone(), cx)))
                .separator()
                .item(
                    MenuItem::new("Open in ChatGPT")
                        .leading(brand_logo("providers/openai.svg", cx))
                        .on_select(move |_, cx| open_external(&p3, "https://chatgpt.com/?q=", "Opening ChatGPT…", cx)),
                )
                .item(
                    MenuItem::new("Open in Claude")
                        .leading(brand_logo("providers/anthropic_black.svg", cx))
                        .on_select(move |_, cx| open_external(&p4, "https://claude.ai/new?q=", "Opening Claude…", cx)),
                )
                .item(
                    MenuItem::new("Copy for OpenCode")
                        .leading(brand_logo("providers/opencode.svg", cx))
                        .on_select(move |_, cx| copy_text(&p5, "Prompt copied — paste it into OpenCode.", cx)),
                )
        })
        .into_any_element()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::payments::drafts::{FeatureDraft, PlanDraft, PlanInclude};

    #[test]
    fn prompt_uses_real_ids() {
        let d = DraftState {
            features: vec![FeatureDraft { id: "messages".into(), feature_type: "metered".into(), description: Some("Messages".into()) }],
            plans: vec![
                PlanDraft { id: "free".into(), name: "Free".into(), group: "base".into(), default: Some(true), ..Default::default() },
                PlanDraft {
                    id: "pro".into(),
                    name: "Pro".into(),
                    group: "base".into(),
                    price_amount: Some(29.0),
                    price_currency: Some("usd".into()),
                    price_interval: Some("month".into()),
                    includes: vec![PlanInclude { feature_id: "messages".into(), limit: Some(100.0), reset: Some("month".into()) }],
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let p = build_integration_prompt(&d, "abc");
        assert!(p.contains("- **Pro** (`pro`) — $29.00 USD per month, group `base`. Features: messages (limit 100/month)."));
        assert!(p.contains("planId: \"pro\""));
        assert!(p.contains("Free/default plan (`free`)"));
        assert!(p.contains("https://abc.supabase.co/functions/v1/"));
        assert_eq!(encode_uri_component("a b&é"), "a%20b%26%C3%A9");
    }
}
