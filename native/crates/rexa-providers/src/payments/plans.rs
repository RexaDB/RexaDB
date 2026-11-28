//! Port of `components/studio/payments/{plans-tab,features-tab,product-sheet,feature-sheet}.tsx`.
//! Contained ProductSheet + FeatureSheet via `crate::ui::studio_sheet` (not `open_dialog`).

use super::currencies::{currency_symbol, PAYKIT_CURRENCIES};
use super::deploy::{self, summarize_sync};
use super::drafts::{
    format_plan_price, is_paid, load_drafts, save_drafts, slugify_paykit_id, validate_drafts, validate_paykit_id, DraftState, FeatureDraft,
    PlanDraft, PlanInclude,
};
use crate::supabase::{self, ConnInfo};
use crate::ui;
use gpui::{div, prelude::*, px, AnyElement, AppContext, Context, Entity, FocusHandle, FontWeight, KeyDownEvent, SharedString, Window};
use rexa_core::Session;
use rexa_ui::widgets::{Icon, InputState};
use rexa_ui::{
    tw, with_alpha, ActiveTokens, Align, Button, ButtonSize, Checkbox, DropdownMenu, IconName, Kbd, MenuItem, Select, SelectOption, Switch,
    TextInput, Toast, Tokens, Tw, MONO,
};
use std::collections::HashMap;
use std::sync::Arc;

use super::shell;

#[path = "detail.rs"]
mod detail;

#[derive(Clone, Debug)]
enum SheetKind {
    Product { edit: Option<usize> },
    Feature { edit: Option<usize> },
}

pub struct PlansView {
    info: Option<ConnInfo>,
    project_ref: Option<String>,
    drafts: DraftState,
    last_slug_name: String,
    last_slug_feat: String,
    filter: &'static str,
    feature_filter: &'static str,
    tab_features: bool,
    sheet: Option<SheetKind>,
    // product form
    f_id: Entity<InputState>,
    f_name: Entity<InputState>,
    f_price: Entity<InputState>,
    f_group: Entity<InputState>,
    f_quantity: Entity<InputState>,
    f_interval: String,
    f_currency: String,
    f_default: bool,
    id_touched: bool,
    more_open: bool,
    preview_open: bool,
    selected_features: Vec<String>,
    resets: HashMap<String, String>,
    limit_inputs: HashMap<String, Entity<InputState>>,
    field_errors: HashMap<String, String>,
    // feature form
    feat_name: Entity<InputState>,
    feat_key: Entity<InputState>,
    feat_type: String,
    key_touched: bool,
    // pending values applied on render when a sheet opens
    pending_product: Option<(String, String, String, String, String)>,
    pending_feature: Option<(String, String)>,
    // detail views (`selectedIndex` in plans-tab / features-tab)
    selected_product: Option<usize>,
    selected_feature: Option<usize>,
    add_feature_id: Option<String>,
    attach_open: bool,
    attach_plan: Option<usize>,
    copied_id: Option<String>,
    focus: FocusHandle,
    syncing: bool,
}

impl PlansView {
    pub fn new(session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let vault = rexa_core::credential_vault(cx);
        let info = supabase::connection_info(&session, vault.as_deref());
        let project_ref = info.as_ref().map(|i| i.project_ref.clone());
        let drafts = project_ref.as_deref().map(load_drafts).unwrap_or_default();
        let mut input = |p: &str, cx: &mut Context<Self>| cx.new(|cx| InputState::new(window, cx).placeholder(p.to_string()));
        Self {
            info,
            project_ref,
            drafts,
            last_slug_name: String::new(),
            last_slug_feat: String::new(),
            filter: "all",
            feature_filter: "all",
            tab_features: false,
            sheet: None,
            f_id: input("pro", cx),
            f_name: input("Pro", cx),
            f_price: input("0.00", cx),
            f_group: input("base", cx),
            f_quantity: input("1", cx),
            f_interval: "month".into(),
            f_currency: "usd".into(),
            f_default: false,
            id_touched: false,
            more_open: false,
            preview_open: false,
            selected_features: vec![],
            resets: HashMap::new(),
            limit_inputs: HashMap::new(),
            field_errors: HashMap::new(),
            feat_name: input("Messages", cx),
            feat_key: input("messages", cx),
            feat_type: "boolean".into(),
            key_touched: false,
            pending_product: None,
            pending_feature: None,
            selected_product: None,
            selected_feature: None,
            add_feature_id: None,
            attach_open: false,
            attach_plan: None,
            copied_id: None,
            focus: cx.focus_handle(),
            syncing: false,
        }
    }

    fn update(&mut self, f: impl FnOnce(&mut DraftState), cx: &mut Context<Self>) {
        f(&mut self.drafts);
        if let Some(r) = &self.project_ref {
            save_drafts(r, &self.drafts);
        }
        cx.notify();
    }

    fn duplicate(&mut self, i: usize, cx: &mut Context<Self>) {
        let Some(src) = self.drafts.plans.get(i).cloned() else { return };
        let taken: std::collections::HashSet<String> = self.drafts.plans.iter().map(|p| p.id.clone()).collect();
        let mut id = if src.id.is_empty() { String::new() } else { format!("{}-copy", src.id) };
        let mut n = 2;
        while !id.is_empty() && taken.contains(&id) {
            id = format!("{}-copy-{n}", src.id);
            n += 1;
        }
        let copy = PlanDraft {
            id,
            name: if src.name.is_empty() { String::new() } else { format!("{} copy", src.name) },
            default: Some(false),
            ..src
        };
        let new_index = self.drafts.plans.len();
        self.update(|d| d.plans.push(copy), cx);
        self.selected_feature = None;
        self.selected_product = Some(new_index);
    }

    fn ensure_limit_input(&mut self, feature_id: &str, initial: &str, window: &mut Window, cx: &mut Context<Self>) {
        if self.limit_inputs.contains_key(feature_id) {
            return;
        }
        let state = cx.new(|cx| InputState::new(window, cx).placeholder("Limit".to_string()));
        let init = initial.to_string();
        state.update(cx, |s, cx| s.set_value(init, window, cx));
        self.limit_inputs.insert(feature_id.to_string(), state);
    }

    fn open_product_sheet(&mut self, idx: Option<usize>, window: &mut Window, cx: &mut Context<Self>) {
        let p = idx.and_then(|i| self.drafts.plans.get(i).cloned()).unwrap_or_else(|| PlanDraft {
            group: "base".into(),
            ..Default::default()
        });
        self.f_interval = p.price_interval.clone().unwrap_or_else(|| "month".into());
        self.f_currency = p.price_currency.clone().unwrap_or_else(|| "usd".into());
        self.f_default = p.default.unwrap_or(false);
        self.id_touched = idx.is_some();
        self.more_open = false;
        self.preview_open = false;
        self.field_errors.clear();
        self.selected_features = p.includes.iter().map(|x| x.feature_id.clone()).collect();
        self.resets.clear();
        self.limit_inputs.clear();
        for inc in &p.includes {
            if let Some(lim) = inc.limit {
                self.ensure_limit_input(&inc.feature_id, &format!("{}", lim as i64), window, cx);
            }
            if let Some(r) = &inc.reset {
                self.resets.insert(inc.feature_id.clone(), r.clone());
            }
        }
        let metered_selected: Vec<String> = self
            .drafts
            .features
            .iter()
            .filter(|f| f.feature_type == "metered" && self.selected_features.iter().any(|id| id == &f.id))
            .map(|f| f.id.clone())
            .collect();
        for fid in metered_selected {
            if !self.limit_inputs.contains_key(&fid) {
                self.ensure_limit_input(&fid, "100", window, cx);
            }
        }
        self.last_slug_name = p.name.clone();
        self.pending_product = Some((
            p.id.clone(),
            p.name.clone(),
            p.price_amount.map(|a| format!("{a}")).unwrap_or_default(),
            if p.group.is_empty() { "base".into() } else { p.group.clone() },
            "1".into(),
        ));
        self.sheet = Some(SheetKind::Product { edit: idx });
        cx.notify();
    }

    fn open_feature_sheet(&mut self, idx: Option<usize>, _window: &mut Window, cx: &mut Context<Self>) {
        let f = idx.and_then(|i| self.drafts.features.get(i).cloned()).unwrap_or_else(|| FeatureDraft {
            feature_type: "boolean".into(),
            ..Default::default()
        });
        self.feat_type = if f.feature_type == "metered" { "metered".into() } else { "boolean".into() };
        self.key_touched = idx.is_some();
        self.field_errors.clear();
        self.last_slug_feat = f.description.clone().unwrap_or_default();
        self.pending_feature = Some((f.description.clone().unwrap_or_default(), f.id.clone()));
        self.sheet = Some(SheetKind::Feature { edit: idx });
        cx.notify();
    }

    fn apply_pending(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some((id, name, price, group, qty)) = self.pending_product.take() {
            self.f_id.update(cx, |s, cx| s.set_value(id, window, cx));
            self.f_name.update(cx, |s, cx| s.set_value(name, window, cx));
            self.f_price.update(cx, |s, cx| s.set_value(price, window, cx));
            self.f_group.update(cx, |s, cx| s.set_value(group, window, cx));
            self.f_quantity.update(cx, |s, cx| s.set_value(qty, window, cx));
        }
        if let Some((name, key)) = self.pending_feature.take() {
            self.feat_name.update(cx, |s, cx| s.set_value(name, window, cx));
            self.feat_key.update(cx, |s, cx| s.set_value(key, window, cx));
        }
    }

    fn close_sheet(&mut self, cx: &mut Context<Self>) {
        self.sheet = None;
        self.field_errors.clear();
        cx.notify();
    }

    fn toggle_feature(&mut self, feature_id: String, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(pos) = self.selected_features.iter().position(|x| x == &feature_id) {
            self.selected_features.remove(pos);
        } else {
            self.selected_features.push(feature_id.clone());
            let metered = self.drafts.features.iter().any(|f| f.id == feature_id && f.feature_type == "metered");
            if metered {
                self.ensure_limit_input(&feature_id, "100", window, cx);
                self.resets.entry(feature_id).or_insert_with(|| "month".into());
            }
        }
        cx.notify();
    }

    fn save_product(&mut self, cx: &mut Context<Self>) {
        let Some(SheetKind::Product { edit: idx }) = self.sheet.clone() else { return };
        let name = self.f_name.read(cx).value().trim().to_string();
        let id = self.f_id.read(cx).value().trim().to_string();
        let price = self.f_price.read(cx).value().trim().to_string();
        let group = {
            let g = self.f_group.read(cx).value().trim().to_string();
            if g.is_empty() { "base".into() } else { g }
        };
        let mut errors = HashMap::new();
        if name.is_empty() {
            errors.insert("name".into(), "Name is required.".into());
        }
        if let Some(err) = validate_paykit_id(&id) {
            errors.insert("id".into(), err);
        } else if self.drafts.plans.iter().enumerate().any(|(i, p)| p.id == id && Some(i) != idx) {
            errors.insert("id".into(), "This ID is already used by another product.".into());
        }
        let amount = if price.is_empty() {
            None
        } else {
            match price.parse::<f64>() {
                Ok(n) if n.is_finite() && n > 0. && n <= 999_999.99 => Some(n),
                _ => {
                    errors.insert("amount".into(), "Enter an amount between 0 and 999,999.99 USD.".into());
                    None
                }
            }
        };
        if !price.is_empty() && amount.is_none() && !errors.contains_key("amount") {
            errors.insert("amount".into(), "Enter an amount between 0 and 999,999.99 USD.".into());
        }
        self.field_errors = errors;
        if !self.field_errors.is_empty() {
            cx.notify();
            return;
        }

        let includes: Vec<PlanInclude> = self
            .selected_features
            .iter()
            .filter_map(|fid| {
                let feat = self.drafts.features.iter().find(|f| &f.id == fid)?;
                if feat.feature_type != "metered" {
                    return Some(PlanInclude {
                        feature_id: fid.clone(),
                        limit: None,
                        reset: None,
                    });
                }
                let raw = self.limit_inputs.get(fid).map(|e| e.read(cx).value().trim().to_string()).unwrap_or_else(|| "100".into());
                let n = raw.parse::<i64>().ok().filter(|&n| n > 0).unwrap_or(100);
                let reset = self.resets.get(fid).cloned().unwrap_or_else(|| "month".into());
                Some(PlanInclude {
                    feature_id: fid.clone(),
                    limit: Some(n as f64),
                    reset: Some(reset),
                })
            })
            .collect();

        let plan = PlanDraft {
            id,
            name,
            group,
            default: Some(self.f_default),
            price_amount: amount,
            price_interval: Some(self.f_interval.clone()),
            price_currency: Some(self.f_currency.clone()),
            includes,
        };
        let new_index = self.drafts.plans.len();
        self.update(
            |d| match idx {
                Some(i) => d.plans[i] = plan,
                None => d.plans.push(plan),
            },
            cx,
        );
        if idx.is_none() {
            // `handleAddProduct` opens the new product's detail page.
            self.selected_product = Some(new_index);
        }
        self.close_sheet(cx);
    }

    fn save_feature(&mut self, cx: &mut Context<Self>) {
        let Some(SheetKind::Feature { edit: idx }) = self.sheet.clone() else { return };
        let name = self.feat_name.read(cx).value().trim().to_string();
        let key = self.feat_key.read(cx).value().trim().to_string();
        let mut errors = HashMap::new();
        if let Some(err) = validate_paykit_id(&key) {
            errors.insert("lookupKey".into(), err);
        } else if self.drafts.features.iter().enumerate().any(|(i, f)| f.id == key && Some(i) != idx) {
            errors.insert("lookupKey".into(), "This lookup key is already used by another feature.".into());
        }
        self.field_errors = errors;
        if !self.field_errors.is_empty() {
            cx.notify();
            return;
        }
        let feature = FeatureDraft {
            id: key,
            feature_type: self.feat_type.clone(),
            description: if name.is_empty() { None } else { Some(name) },
        };
        self.update(
            |d| match idx {
                Some(i) => d.features[i] = feature,
                None => d.features.push(feature),
            },
            cx,
        );
        self.close_sheet(cx);
    }

    fn field_error(&self, key: &str, t: &Tokens) -> Option<AnyElement> {
        self.field_errors.get(key).map(|msg| {
            div()
                .flex()
                .items_center()
                .gap_1()
                .tw_text_xs()
                .text_color(t.destructive)
                .child(Icon::new(IconName::CircleAlert).size(px(14.)).flex_shrink_0())
                .child(msg.clone())
                .into_any_element()
        })
    }

    fn sync_to_stripe(&mut self, cx: &mut Context<Self>) {
        let errors = validate_drafts(&self.drafts);
        if !errors.is_empty() {
            Toast::error(format!("Fix {} draft error{} before syncing.", errors.len(), if errors.len() == 1 { "" } else { "s" })).show(cx);
            return;
        }
        let Some(info) = self.info.clone() else {
            Toast::error("Open a Supabase project connection to sync.").show(cx);
            return;
        };
        if self.drafts.plans.is_empty() {
            Toast::error("Add a product first — there is nothing to sync.").show(cx);
            return;
        }
        if self.syncing {
            return;
        }
        self.syncing = true;
        cx.notify();
        let drafts = self.drafts.clone();
        ui::run(
            cx,
            async move {
                let a = supabase::resolve_access(Some(info)).await?.ok_or_else(|| anyhow::anyhow!("No Supabase access."))?;
                // Sync acts on the DEPLOYED bundle, not these drafts — so deploy first.
                let deployed = deploy::deploy_functions(&a, &drafts).await?;
                let failed: Vec<String> = deployed
                    .results
                    .iter()
                    .filter(|r| !r.deployed)
                    .map(|r| format!("{}: {}", r.slug, r.error.as_deref().unwrap_or("failed")))
                    .collect();
                if !failed.is_empty() {
                    anyhow::bail!("Deploy failed: {}", failed.join(" "));
                }
                let synced = deploy::sync_products(&a).await?;
                Ok(summarize_sync(&synced.products))
            },
            |this, r, cx| match r {
                Ok((n, prices)) => {
                    this.syncing = false;
                    cx.notify();
                    Toast::success(format!("Synced {n} product{} to Stripe ({prices} with prices).", if n == 1 { "" } else { "s" })).show(cx);
                }
                Err(e) => {
                    this.syncing = false;
                    cx.notify();
                    Toast::error(format!("{e:#}")).show(cx);
                }
            },
        );
    }

    fn render_product_sheet(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let editing = matches!(&self.sheet, Some(SheetKind::Product { edit: Some(_) }));
        let title = if editing { "Edit product" } else { "Add a product" };
        let submit = if editing { "Save changes" } else { "Add product" };
        let w = cx.entity().downgrade();
        let name_err = self.field_errors.contains_key("name");
        let id_err = self.field_errors.contains_key("id");
        let amount_err = self.field_errors.contains_key("amount");
        let sym = currency_symbol(&self.f_currency);
        let selected_n = self.selected_features.len();
        let features = self.drafts.features.clone();
        let selected = self.selected_features.clone();
        let resets = self.resets.clone();
        let limit_inputs = self.limit_inputs.clone();
        let interval = self.f_interval.clone();
        let currency = self.f_currency.clone();
        let more_open = self.more_open;
        let preview_open = self.preview_open;
        let is_default = self.f_default;

        let name_s = self.f_name.clone();
        let id_s = self.f_id.clone();
        let price_s = self.f_price.clone();
        let group_s = self.f_group.clone();
        let qty_s = self.f_quantity.clone();

        let label = |title: &str, hint: &str, required: bool| {
            div()
                .flex()
                .flex_col()
                .gap(px(6.))
                .child(
                    div()
                        .tw_text_sm()
                        .font_weight(FontWeight::SEMIBOLD)
                        .child(title.to_string())
                        .when(required, |d| {
                            d.child(div().ml_1().font_weight(FontWeight::NORMAL).text_color(t.muted_foreground).child("(required)"))
                        }),
                )
                .child(div().tw_text_xs().text_color(t.muted_foreground).child(hint.to_string()))
        };

        let feature_rows: AnyElement = if features.is_empty() {
            div()
                .tw_text_xs()
                .text_color(t.muted_foreground)
                .child("No features yet — add them in the Features tab first, or add the product now and attach features later.")
                .into_any_element()
        } else {
            div()
                .flex()
                .flex_col()
                .gap_2()
                .children(features.iter().map(|f| {
                    let fid = f.id.clone();
                    let checked = selected.iter().any(|x| x == &fid);
                    let metered = f.feature_type == "metered";
                    let w1 = w.clone();
                    let row = div()
                        .tw_rounded_lg()
                        .border_1()
                        .border_color(with_alpha(t.border, 0.7))
                        .bg(t.card)
                        .p(px(10.))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_2()
                                .child(Checkbox::new(SharedString::from(format!("pf-cb-{fid}"))).checked(checked).on_change({
                                    let fid = fid.clone();
                                    let w1 = w1.clone();
                                    move |_, win, cx| {
                                        w1.update(cx, |s, cx| s.toggle_feature(fid.clone(), win, cx)).ok();
                                    }
                                }))
                                .child(div().flex_1().min_w_0().truncate().font_family(MONO).text_size(px(11.)).child(f.id.clone()))
                                .child(
                                    div()
                                        .flex_shrink_0()
                                        .rounded_full()
                                        .border_1()
                                        .border_color(t.border)
                                        .bg(with_alpha(t.muted, 0.4))
                                        .px_2()
                                        .py(px(2.))
                                        .text_size(px(10.))
                                        .font_weight(FontWeight::SEMIBOLD)
                                        .text_color(t.muted_foreground)
                                        .child(f.feature_type.clone()),
                                ),
                        );
                    if checked && metered {
                        let lim = limit_inputs.get(&fid).cloned();
                        let reset_val = resets.get(&fid).cloned().unwrap_or_else(|| "month".into());
                        let w2 = w.clone();
                        row.child(
                            div()
                                .mt_2()
                                .pl_7()
                                .grid()
                                .grid_cols(2)
                                .gap(px(6.))
                                .children(lim.map(|inp| TextInput::new(&inp).h(32.).into_any_element()))
                                .child(
                                    Select::new(SharedString::from(format!("pf-reset-{fid}")))
                                        .w_full()
                                        .small()
                                        .options(["day", "week", "month", "year"].iter().map(|r| SelectOption::new(*r, format!("per {r}"))))
                                        .value(Some(reset_val))
                                        .on_change({
                                            let fid = fid.clone();
                                            move |v, _, cx| {
                                                w2.update(cx, |s, cx| {
                                                    s.resets.insert(fid.clone(), v.to_string());
                                                    cx.notify();
                                                })
                                                .ok();
                                            }
                                        }),
                                ),
                        )
                        .into_any_element()
                    } else {
                        row.into_any_element()
                    }
                }))
                .into_any_element()
        };

        let amount_box = div()
            .flex()
            .h_10()
            .items_center()
            .tw_rounded_lg()
            .border_1()
            .border_color(if amount_err { t.destructive } else { t.border })
            .child(div().pl_3().tw_text_sm().text_color(t.muted_foreground).child(sym.to_string()))
            .child(div().flex_1().min_w_0().child(TextInput::new(&price_s)))
            .child(
                div().h_full().flex_shrink_0().border_l_1().border_color(t.border).child(
                    Select::with_search("pp-cur")
                        .w(px(100.))
                        .small()
                        .search_threshold(1)
                        .search_placeholder("Search…")
                        .options(PAYKIT_CURRENCIES.iter().map(|c| SelectOption::new(c.code, format!("{} · {}", c.code.to_uppercase(), c.name))))
                        .value(Some(currency.clone()))
                        .on_change({
                            let w = w.clone();
                            move |v, _, cx| {
                                w.update(cx, |s, cx| {
                                    s.f_currency = v.to_string();
                                    cx.notify();
                                })
                                .ok();
                            }
                        }),
                ),
            );

        let interval_toggles = div().grid().grid_cols(2).gap_2().children(["month", "year"].into_iter().map(|v| {
            let active = interval == v;
            let w = w.clone();
            div()
                .id(SharedString::from(format!("pp-int-{v}")))
                .h_11()
                .flex()
                .items_center()
                .justify_center()
                .tw_rounded_lg()
                .border_1()
                .border_color(if active { with_alpha(t.primary, 0.6) } else { t.border })
                .when(active, |d| d.bg(with_alpha(t.primary, 0.05)))
                .when(!active, |d| d.text_color(t.muted_foreground))
                .tw_text_sm()
                .font_weight(FontWeight::MEDIUM)
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    w.update(cx, |s, cx| {
                        s.f_interval = v.into();
                        cx.notify();
                    })
                    .ok();
                })
                .child(if v == "month" { "Monthly" } else { "Yearly" })
        }));

        let form = div()
            .flex()
            .flex_col()
            .gap_6()
            .px_6()
            .py_6()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(label("Name", "Name of the product, visible to customers.", true))
                    .child(TextInput::new(&name_s).h(40.))
                    .children(self.field_error("name", &t)),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(label(
                        "Product ID",
                        "Unique identifier, auto-filled from the name. Lowercase letters, numbers, dashes.",
                        true,
                    ))
                    .child(div().font_family(MONO).child(TextInput::new(&id_s).h(40.)))
                    .children(self.field_error("id", &t)),
            )
            .child(
                div()
                    .child(
                        div()
                            .id("pp-more")
                            .flex()
                            .items_center()
                            .gap_1()
                            .tw_text_xs()
                            .font_weight(FontWeight::MEDIUM)
                            .text_color(t.primary)
                            .cursor_pointer()
                            .on_click({
                                let w = w.clone();
                                move |_, _, cx| {
                                    w.update(cx, |s, cx| {
                                        s.more_open = !s.more_open;
                                        cx.notify();
                                    })
                                    .ok();
                                }
                            })
                            .child("More options")
                            .child(
                                Icon::new(IconName::ChevronDown)
                                    .size(px(14.))
                                    .when(more_open, |i| i),
                            ),
                    )
                    .when(more_open, |d| {
                        d.child(
                            div()
                                .mt_3()
                                .grid()
                                .grid_cols(2)
                                .gap_3()
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap(px(6.))
                                        .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child("Group"))
                                        .child(div().font_family(MONO).child(TextInput::new(&group_s).h(40.))),
                                )
                                .child(
                                    div()
                                        .flex()
                                        .items_center()
                                        .justify_between()
                                        .gap_2()
                                        .tw_rounded_lg()
                                        .border_1()
                                        .border_color(t.border)
                                        .px_3()
                                        .tw_text_xs()
                                        .font_weight(FontWeight::MEDIUM)
                                        .child("Default product")
                                        .child(Switch::new("pp-def").checked(is_default).on_change({
                                            let w = w.clone();
                                            move |v, _, cx| {
                                                w.update(cx, |s, cx| {
                                                    s.f_default = v;
                                                    cx.notify();
                                                })
                                                .ok();
                                            }
                                        })),
                                ),
                        )
                    }),
            )
            .child(div().border_t_1().border_color(t.border).pt_6().child(div().tw_text_base().font_weight(FontWeight::SEMIBOLD).child("Pricing")))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(label("Amount", "Leave empty for a free product.", false))
                    .child(amount_box)
                    .children(self.field_error("amount", &t)),
            )
            .child(div().flex().flex_col().gap(px(6.)).child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child("Billing period")).child(interval_toggles))
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .tw_text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("Features ")
                            .child(div().font_weight(FontWeight::NORMAL).text_color(t.muted_foreground).child(format!("({selected_n} selected)"))),
                    )
                    .child(feature_rows),
            );

        let preview = if preview_open {
            let amount_raw = price_s.read(cx).value().trim().to_string();
            let unit = amount_raw.parse::<f64>().ok().filter(|n| n.is_finite()).unwrap_or(0.);
            let qty = qty_s.read(cx).value().trim().parse::<i64>().ok().filter(|&n| n > 0).unwrap_or(1) as f64;
            let total = unit * qty;
            Some(
                div()
                    .w(px(240.))
                    .flex_shrink_0()
                    .flex()
                    .flex_col()
                    .gap_5()
                    .border_l_1()
                    .border_color(t.border)
                    .bg(with_alpha(t.muted, 0.2))
                    .px_6()
                    .py_6()
                    .child(
                        div()
                            .child(div().tw_text_base().font_weight(FontWeight::SEMIBOLD).child("Preview"))
                            .child(div().mt_1().tw_text_xs().text_color(t.muted_foreground).child("Estimate totals from amount and quantity.")),
                    )
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .gap(px(6.))
                            .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child("Unit quantity"))
                            .child(div().font_family(MONO).child(TextInput::new(&qty_s).h(40.))),
                    )
                    .child(
                        div()
                            .border_t_1()
                            .border_color(t.border)
                            .pt_4()
                            .tw_text_sm()
                            .child(format!("{qty} × {sym}{unit:.2} = "))
                            .child(div().font_weight(FontWeight::SEMIBOLD).child(format!("{sym}{total:.2}"))),
                    )
                    .child(
                        div()
                            .border_t_1()
                            .border_color(t.border)
                            .pt_4()
                            .child(
                                div()
                                    .flex()
                                    .items_baseline()
                                    .justify_between()
                                    .gap_2()
                                    .child(div().tw_text_sm().child(format!("Total per {}", if interval == "year" { "year" } else { "month" })))
                                    .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(format!("{sym}{total:.2}"))),
                            )
                            .child(div().mt_1().tw_text_xs().text_color(t.muted_foreground).child("Billed at the start of the period")),
                    )
                    .into_any_element(),
            )
        } else {
            None
        };

        let body = div()
            .flex()
            .flex_col()
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_end()
                    .px_6()
                    .pt_3()
                    .child(
                        Button::new("pp-preview")
                            .outline()
                            .size(ButtonSize::Sm)
                            .label(if preview_open { "Close preview" } else { "Open preview" })
                            .on_click({
                                let w = w.clone();
                                move |_, _, cx| {
                                    w.update(cx, |s, cx| {
                                        s.preview_open = !s.preview_open;
                                        cx.notify();
                                    })
                                    .ok();
                                }
                            }),
                    ),
            )
            .child(div().flex().min_h_0().flex_1().child(div().flex_1().min_w_0().child(form)).children(preview))
            .into_any_element();

        let footer = div()
            .flex()
            .justify_end()
            .gap_2()
            .child(Button::new("pp-cancel").outline().size(ButtonSize::Sm).label("Cancel").on_click({
                let w = w.clone();
                move |_, _, cx| {
                    w.update(cx, |s, cx| s.close_sheet(cx)).ok();
                }
            }))
            .child(Button::new("pp-save").size(ButtonSize::Sm).label(submit).on_click({
                let w = w.clone();
                move |_, _, cx| {
                    w.update(cx, |s, cx| s.save_product(cx)).ok();
                }
            }))
            .into_any_element();

        let _ = (name_err, id_err);
        ui::studio_sheet_w(
            "pay-product-sheet",
            title,
            if preview_open { 840. } else { 600. },
            body,
            Some(footer),
            {
                let w = w.clone();
                move |_, cx| {
                    w.update(cx, |s, cx| s.close_sheet(cx)).ok();
                }
            },
            cx,
        )
    }

    fn render_feature_sheet(&mut self, cx: &mut Context<Self>) -> AnyElement {
        let t = cx.tokens().clone();
        let editing = matches!(&self.sheet, Some(SheetKind::Feature { edit: Some(_) }));
        let title = if editing { "Edit feature" } else { "Create feature" };
        let submit = if editing { "Save changes" } else { "Create feature" };
        let w = cx.entity().downgrade();
        let feat_type = self.feat_type.clone();
        let name_s = self.feat_name.clone();
        let key_s = self.feat_key.clone();

        let type_toggles = div().grid().grid_cols(2).gap_2().children(["boolean", "metered"].into_iter().map(|v| {
            let active = feat_type == v;
            let w = w.clone();
            div()
                .id(SharedString::from(format!("ff-type-{v}")))
                .h_11()
                .flex()
                .items_center()
                .justify_center()
                .tw_rounded_lg()
                .border_1()
                .border_color(if active { with_alpha(t.primary, 0.6) } else { t.border })
                .when(active, |d| d.bg(with_alpha(t.primary, 0.05)))
                .when(!active, |d| d.text_color(t.muted_foreground))
                .tw_text_sm()
                .font_weight(FontWeight::MEDIUM)
                .cursor_pointer()
                .on_click(move |_, _, cx| {
                    w.update(cx, |s, cx| {
                        s.feat_type = v.into();
                        cx.notify();
                    })
                    .ok();
                })
                .child(v.to_string())
        }));

        let body = div()
            .flex()
            .flex_col()
            .gap_6()
            .px_6()
            .py_6()
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child("Feature name"))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child("This won't be shown to customers."))
                    .child(TextInput::new(&name_s).h(40.)),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(
                        div()
                            .tw_text_sm()
                            .font_weight(FontWeight::SEMIBOLD)
                            .child("Lookup key ")
                            .child(div().font_weight(FontWeight::NORMAL).text_color(t.muted_foreground).child("(required)")),
                    )
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child("A unique key you provide as your own identifier to support easier retrieval."))
                    .child(div().font_family(MONO).child(TextInput::new(&key_s).h(40.)))
                    .children(self.field_error("lookupKey", &t)),
            )
            .child(
                div()
                    .flex()
                    .flex_col()
                    .gap(px(6.))
                    .child(div().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child("Type"))
                    .child(div().tw_text_xs().text_color(t.muted_foreground).child("Boolean features gate access; metered features track usage against a limit."))
                    .child(type_toggles),
            )
            .into_any_element();

        let footer = div()
            .flex()
            .justify_end()
            .gap_2()
            .child(Button::new("ff-cancel").outline().size(ButtonSize::Sm).label("Cancel").on_click({
                let w = w.clone();
                move |_, _, cx| {
                    w.update(cx, |s, cx| s.close_sheet(cx)).ok();
                }
            }))
            .child(Button::new("ff-save").size(ButtonSize::Sm).label(submit).on_click({
                let w = w.clone();
                move |_, _, cx| {
                    w.update(cx, |s, cx| s.save_feature(cx)).ok();
                }
            }))
            .into_any_element();

        ui::studio_sheet_w(
            "pay-feature-sheet",
            title,
            480.,
            body,
            Some(footer),
            {
                let w = w.clone();
                move |_, cx| {
                    w.update(cx, |s, cx| s.close_sheet(cx)).ok();
                }
            },
            cx,
        )
    }

    fn render_sheet(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        match &self.sheet {
            Some(SheetKind::Product { .. }) => Some(self.render_product_sheet(cx)),
            Some(SheetKind::Feature { .. }) => Some(self.render_feature_sheet(cx)),
            None => None,
        }
    }

    fn sync_slug_from_name(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if matches!(&self.sheet, Some(SheetKind::Product { .. })) {
            let name = self.f_name.read(cx).value().to_string();
            let id = self.f_id.read(cx).value().to_string();
            let slug = slugify_paykit_id(&name);
            if !self.id_touched {
                if name != self.last_slug_name {
                    self.last_slug_name = name;
                    if id != slug {
                        self.f_id.update(cx, |s, cx| s.set_value(slug, window, cx));
                    }
                } else if !id.is_empty() && id != slug {
                    self.id_touched = true;
                }
            }
        }
        if matches!(&self.sheet, Some(SheetKind::Feature { .. })) {
            let name = self.feat_name.read(cx).value().to_string();
            let key = self.feat_key.read(cx).value().to_string();
            let slug = slugify_paykit_id(&name);
            if !self.key_touched {
                if name != self.last_slug_feat {
                    self.last_slug_feat = name;
                    if key != slug {
                        self.feat_key.update(cx, |s, cx| s.set_value(slug, window, cx));
                    }
                } else if !key.is_empty() && key != slug {
                    self.key_touched = true;
                }
            }
        }
    }
}

impl Render for PlansView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.apply_pending(window, cx);
        self.sync_slug_from_name(window, cx);
        let t = cx.tokens().clone();
        if self.project_ref.is_none() {
            return div()
                .size_full()
                .child(shell(
                    "Plans",
                    None,
                    None,
                    None,
                    div().tw_text_xs().text_color(t.muted_foreground).child("Open a Supabase project connection to manage billing plans.").into_any_element(),
                    cx,
                ))
                .into_any_element();
        }

        let errors = validate_drafts(&self.drafts);
        let has_token = self.info.is_some();
        let sync = Button::new("pl-sync")
            .outline()
            .size(ButtonSize::Sm)
            .icon(if self.syncing { IconName::LoaderCircle } else { IconName::RefreshCw })
            .label(if self.syncing { "Syncing…" } else { "Sync to Stripe" })
            .disabled(self.syncing || !has_token)
            .on_click(cx.listener(|this, _, _, cx| this.sync_to_stripe(cx)));
        let actions = div()
            .flex()
            .flex_shrink_0()
            .items_center()
            .gap(px(6.))
            .child(super::prompt::copy_prompt_button("pl-copy-prompt", &self.drafts, self.project_ref.as_deref().unwrap_or(""), false))
            .child(sync);

        let tabs = div().flex().items_center().gap_1().border_b_1().border_color(t.border).children(
            [(false, "Products", self.drafts.plans.len()), (true, "Features", self.drafts.features.len())]
                .into_iter()
                .map(|(f, label, n)| {
                    let active = f == self.tab_features;
                    div()
                        .id(SharedString::from(format!("pl-tab-{label}")))
                        .mb(px(-1.))
                        .border_b_2()
                        .border_color(if active { t.primary } else { gpui::transparent_black() })
                        .px_3()
                        .pb_2()
                        .pt_1()
                        .tw_text_sm()
                        .cursor_pointer()
                        .when(active, |d| d.font_weight(FontWeight::MEDIUM))
                        .when(!active, |d| d.text_color(t.muted_foreground))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if this.tab_features != f {
                                this.tab_features = f;
                                this.back_to_list(cx);
                            }
                            cx.notify();
                        }))
                        .child(div().flex().gap_1().child(label).child(div().font_weight(FontWeight::NORMAL).text_color(t.muted_foreground).child(format!("({n})"))))
                }),
        );

        let content: AnyElement = if let Some(i) = self.selected_product.filter(|&i| !self.tab_features && i < self.drafts.plans.len()) {
            self.render_product_detail(i, cx)
        } else if let Some(i) = self.selected_feature.filter(|&i| self.tab_features && i < self.drafts.features.len()) {
            self.render_feature_detail(i, cx)
        } else if self.tab_features {
            let filter = self.feature_filter;
            let visible: Vec<(usize, FeatureDraft)> = self
                .drafts
                .features
                .iter()
                .cloned()
                .enumerate()
                .filter(|(_, f)| filter == "all" || f.feature_type == filter)
                .collect();
            let pills = div().flex().items_center().gap(px(6.)).children(["all", "boolean", "metered"].into_iter().map(|f| {
                let active = f == filter;
                div()
                    .id(SharedString::from(format!("pl-ff-{f}")))
                    .h_8()
                    .flex()
                    .items_center()
                    .tw_rounded_lg()
                    .border_1()
                    .px_3()
                    .tw_text_xs()
                    .font_weight(if active { FontWeight::SEMIBOLD } else { FontWeight::MEDIUM })
                    .border_color(if active { with_alpha(t.foreground, 0.6) } else { t.border })
                    .when(!active, |d| d.text_color(t.muted_foreground))
                    .cursor_pointer()
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.feature_filter = f;
                        cx.notify();
                    }))
                    .child(match f {
                        "boolean" => "Boolean",
                        "metered" => "Metered",
                        _ => "All",
                    })
            }));
            let head = div()
                .flex()
                .items_center()
                .justify_between()
                .gap_2()
                .child(pills)
                .child(
                    Button::new("pl-create-feat")
                        .size(ButtonSize::Sm)
                        .icon(IconName::Plus)
                        .label("Create feature")
                        .child(div().ml_1().child(Kbd::new("F")))
                        .on_click(cx.listener(|this, _, w, cx| this.open_feature_sheet(None, w, cx))),
                );
            let used_in = |fid: &str| self.drafts.plans.iter().filter(|p| p.includes.iter().any(|x| x.feature_id == fid)).count();
            let list: AnyElement = if self.drafts.features.is_empty() {
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap_1()
                    .tw_rounded_lg()
                    .border_1()
                    .border_dashed()
                    .border_color(t.border)
                    .px_3()
                    .py_8()
                    .text_center()
                    .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("No features yet"))
                    .child(div().max_w(px(320.)).tw_text_xs().text_color(t.muted_foreground).child("Boolean features gate access; metered features track usage against a limit."))
                    .into_any_element()
            } else if visible.is_empty() {
                div()
                    .tw_rounded_lg()
                    .border_1()
                    .border_dashed()
                    .border_color(t.border)
                    .px_3()
                    .py_8()
                    .text_center()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .child(format!("No {filter} features."))
                    .into_any_element()
            } else {
                let w = cx.entity().downgrade();
                let grid = |d: gpui::Div| d.flex().items_center().gap_2();
                div()
                    .overflow_hidden()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(with_alpha(t.border, 0.7))
                    .child(
                        grid(div())
                            .border_b_1()
                            .border_color(with_alpha(t.border, 0.7))
                            .px_3()
                            .py_2()
                            .tw_text_xs()
                            .text_color(t.muted_foreground)
                            .child(div().flex_grow(1.).flex_basis(px(0.)).min_w_0().child("Feature"))
                            .child(div().w(px(110.)).child("Type"))
                            .child(div().w(px(90.)).child("Used in"))
                            .child(div().w(px(90.)).child("Status"))
                            .child(div().w(px(36.))),
                    )
                    .children(visible.into_iter().enumerate().map(|(k, (i, f))| {
                        let count = used_in(&f.id);
                        let w = w.clone();
                        let menu = DropdownMenu::new(("pl-fmenu", i))
                            .align(Align::End)
                            .trigger(Button::new(("pl-fmore", i)).ghost().size(ButtonSize::IconSm).icon(IconName::Ellipsis))
                            .menu(move |m, _, _| {
                                let (w0, w1, w2) = (w.clone(), w.clone(), w.clone());
                                m.item(MenuItem::new("Open").on_select(move |_, cx| {
                                    w0.update(cx, |s, cx| {
                                        s.selected_feature = Some(i);
                                        cx.notify();
                                    })
                                    .ok();
                                }))
                                .item(MenuItem::new("Edit").icon(IconName::Pencil).on_select(move |win, cx| {
                                    w1.update(cx, |s, cx| s.open_feature_sheet(Some(i), win, cx)).ok();
                                }))
                                .item(MenuItem::new("Delete").icon(IconName::Trash).destructive().on_select(move |_, cx| {
                                    w2.update(cx, |s, cx| s.remove_feature(i, cx)).ok();
                                }))
                            });
                        let title = f
                            .description
                            .as_deref()
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(|s| s.to_string())
                            .unwrap_or_else(|| if f.id.is_empty() { "New feature".into() } else { f.id.clone() });
                        grid(div())
                            .id(("pl-frow", i))
                            .when(k > 0, |d| d.border_t_1().border_color(with_alpha(t.border, 0.6)))
                            .px_3()
                            .py(px(10.))
                            .cursor_pointer()
                            .hover(|d| d.bg(with_alpha(t.muted, 0.3)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.selected_feature = Some(i);
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .flex_grow(1.)
                                    .flex_basis(px(0.))
                                    .min_w_0()
                                    .flex()
                                    .items_center()
                                    .gap(px(10.))
                                    .child(
                                        div()
                                            .size_9()
                                            .flex_shrink_0()
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .tw_rounded_lg()
                                            .border_1()
                                            .border_color(with_alpha(t.border, 0.7))
                                            .bg(with_alpha(t.muted, 0.3))
                                            .child(Icon::new(IconName::KeyRound).size(px(16.)).text_color(t.muted_foreground)),
                                    )
                                    .child(
                                        div()
                                            .min_w_0()
                                            .child(div().truncate().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(title))
                                            .child(div().truncate().font_family(MONO).text_size(px(11.)).text_color(t.muted_foreground).child(if f.id.is_empty() {
                                                "no-id-yet".to_string()
                                            } else {
                                                f.id.clone()
                                            })),
                                    ),
                            )
                            .child(div().w(px(110.)).truncate().tw_text_xs().text_color(t.muted_foreground).child(f.feature_type.clone()))
                            .child(div().w(px(90.)).truncate().tw_text_xs().text_color(t.muted_foreground).child(if count == 0 {
                                "—".into()
                            } else {
                                format!("{count} plan{}", if count == 1 { "" } else { "s" })
                            }))
                            .child(
                                div().w(px(90.)).child(
                                    div()
                                        .h(px(22.))
                                        .flex()
                                        .items_center()
                                        .rounded_full()
                                        .border_1()
                                        .border_color(with_alpha(tw("emerald-500"), 0.25))
                                        .bg(with_alpha(tw("emerald-500"), 0.1))
                                        .px_2()
                                        .text_size(px(11.))
                                        .font_weight(FontWeight::MEDIUM)
                                        .text_color(tw("emerald-600"))
                                        .child("Active"),
                                ),
                            )
                            .child(div().w(px(36.)).on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation()).child(menu))
                    }))
                    .into_any_element()
            };
            div().flex().flex_col().gap_3().child(head).child(list).into_any_element()
        } else {
            let filter = self.filter;
            let visible: Vec<(usize, PlanDraft)> = self
                .drafts
                .plans
                .iter()
                .cloned()
                .enumerate()
                .filter(|(_, p)| filter == "all" || (filter == "paid") == is_paid(p))
                .collect();
            let pills = div().flex().items_center().gap(px(6.)).children(["all", "paid", "free"].into_iter().map(|f| {
                let active = f == filter;
                div()
                    .id(SharedString::from(format!("pl-f-{f}")))
                    .h_8()
                    .flex()
                    .items_center()
                    .tw_rounded_lg()
                    .border_1()
                    .px_3()
                    .tw_text_xs()
                    .font_weight(if active { FontWeight::SEMIBOLD } else { FontWeight::MEDIUM })
                    .border_color(if active { with_alpha(t.foreground, 0.6) } else { t.border })
                    .when(!active, |d| d.text_color(t.muted_foreground))
                    .cursor_pointer()
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.filter = f;
                        cx.notify();
                    }))
                    .child(match f {
                        "paid" => "Paid",
                        "free" => "Free",
                        _ => "All",
                    })
            }));
            let head = div()
                .flex()
                .items_center()
                .justify_between()
                .gap_2()
                .child(pills)
                .child(
                    Button::new("pl-create")
                        .size(ButtonSize::Sm)
                        .icon(IconName::Plus)
                        .label("Create product")
                        .child(div().ml_1().child(Kbd::new("N")))
                        .on_click(cx.listener(|this, _, w, cx| this.open_product_sheet(None, w, cx))),
                );
            let list: AnyElement = if self.drafts.plans.is_empty() {
                div()
                    .flex()
                    .flex_col()
                    .items_center()
                    .gap_1()
                    .tw_rounded_lg()
                    .border_1()
                    .border_dashed()
                    .border_color(t.border)
                    .px_3()
                    .py_8()
                    .text_center()
                    .child(div().tw_text_sm().font_weight(FontWeight::MEDIUM).child("No products yet"))
                    .child(div().max_w(px(320.)).tw_text_xs().text_color(t.muted_foreground).child("Create your first product above, or load a starter template from Features."))
                    .into_any_element()
            } else if visible.is_empty() {
                div()
                    .tw_rounded_lg()
                    .border_1()
                    .border_dashed()
                    .border_color(t.border)
                    .px_3()
                    .py_8()
                    .text_center()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .child(format!("No {} products.", if filter == "paid" { "paid" } else { "free" }))
                    .into_any_element()
            } else {
                let grid = |d: gpui::Div| d.flex().items_center().gap_2();
                let w = cx.entity().downgrade();
                div()
                    .overflow_hidden()
                    .tw_rounded_lg()
                    .border_1()
                    .border_color(with_alpha(t.border, 0.7))
                    .child(
                        grid(div())
                            .border_b_1()
                            .border_color(with_alpha(t.border, 0.7))
                            .px_3()
                            .py_2()
                            .tw_text_xs()
                            .text_color(t.muted_foreground)
                            .child(div().flex_grow(1.).flex_basis(px(0.)).min_w_0().child("Product"))
                            .child(div().w(px(160.)).child("Pricing"))
                            .child(div().w(px(110.)).child("Features"))
                            .child(div().w(px(90.)).child("Status"))
                            .child(div().w(px(36.))),
                    )
                    .children(visible.into_iter().enumerate().map(|(k, (i, p))| {
                        let (main, sub) = format_plan_price(&p);
                        let w = w.clone();
                        let menu = DropdownMenu::new(("pl-menu", i))
                            .align(Align::End)
                            .trigger(Button::new(("pl-more", i)).ghost().size(ButtonSize::IconSm).icon(IconName::Ellipsis))
                            .menu(move |m, _, _| {
                                let (w1, w2, w3) = (w.clone(), w.clone(), w.clone());
                                m.item(MenuItem::new("Open").on_select(move |_, cx| {
                                    w1.update(cx, |s, cx| {
                                        s.selected_product = Some(i);
                                        cx.notify();
                                    })
                                    .ok();
                                }))
                                .item(MenuItem::new("Duplicate").icon(IconName::Copy).on_select(move |_, cx| {
                                    w2.update(cx, |s, cx| s.duplicate(i, cx)).ok();
                                }))
                                .item(MenuItem::new("Delete").icon(IconName::Trash).destructive().on_select(move |_, cx| {
                                    w3.update(cx, |s, cx| s.remove_plan(i, cx)).ok();
                                }))
                            });
                        grid(div())
                            .id(("pl-row", i))
                            .when(k > 0, |d| d.border_t_1().border_color(with_alpha(t.border, 0.6)))
                            .px_3()
                            .py(px(10.))
                            .cursor_pointer()
                            .hover(|d| d.bg(with_alpha(t.muted, 0.3)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.selected_product = Some(i);
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .flex_grow(1.)
                                    .flex_basis(px(0.))
                                    .min_w_0()
                                    .flex()
                                    .items_center()
                                    .gap(px(10.))
                                    .child(
                                        div()
                                            .size_9()
                                            .flex_shrink_0()
                                            .flex()
                                            .items_center()
                                            .justify_center()
                                            .tw_rounded_lg()
                                            .border_1()
                                            .border_color(with_alpha(t.border, 0.7))
                                            .bg(with_alpha(t.muted, 0.3))
                                            .child(Icon::new(IconName::Package).size(px(16.)).text_color(t.muted_foreground)),
                                    )
                                    .child(
                                        div()
                                            .min_w_0()
                                            .child(div().truncate().tw_text_sm().font_weight(FontWeight::SEMIBOLD).child(if p.name.is_empty() {
                                                if p.id.is_empty() {
                                                    "New product".to_string()
                                                } else {
                                                    p.id.clone()
                                                }
                                            } else {
                                                p.name.clone()
                                            }))
                                            .child(div().truncate().font_family(MONO).text_size(px(11.)).text_color(t.muted_foreground).child(if p.id.is_empty() {
                                                "no-id-yet".to_string()
                                            } else {
                                                p.id.clone()
                                            })),
                                    ),
                            )
                            .child(
                                div()
                                    .w(px(160.))
                                    .min_w_0()
                                    .child(div().truncate().tw_text_sm().child(main))
                                    .children(sub.map(|s| div().truncate().text_size(px(11.)).text_color(t.muted_foreground).child(s))),
                            )
                            .child(div().w(px(110.)).truncate().tw_text_xs().text_color(t.muted_foreground).child(if p.includes.is_empty() {
                                "—".to_string()
                            } else {
                                format!("{} feature{}", p.includes.len(), if p.includes.len() == 1 { "" } else { "s" })
                            }))
                            .child(div().w(px(90.)).child(if p.default == Some(true) {
                                div()
                                    .h(px(22.))
                                    .flex()
                                    .items_center()
                                    .rounded_full()
                                    .border_1()
                                    .border_color(with_alpha(t.primary, 0.2))
                                    .bg(with_alpha(t.primary, 0.1))
                                    .px_2()
                                    .text_size(px(11.))
                                    .font_weight(FontWeight::MEDIUM)
                                    .text_color(t.primary)
                                    .child("Default")
                                    .into_any_element()
                            } else {
                                div().tw_text_xs().text_color(t.muted_foreground).child("—").into_any_element()
                            }))
                            .child(div().w(px(36.)).on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation()).child(menu))
                    }))
                    .into_any_element()
            };
            div().flex().flex_col().gap_3().child(head).child(list).into_any_element()
        };

        let body = div()
            .flex()
            .flex_col()
            .gap_4()
            .when(!errors.is_empty(), |d| {
                d.child(
                    div()
                        .flex()
                        .gap_2()
                        .tw_rounded_xl()
                        .border_1()
                        .border_color(with_alpha(tw("amber-500"), 0.3))
                        .bg(with_alpha(tw("amber-500"), 0.05))
                        .p_3()
                        .tw_text_xs()
                        .child(Icon::new(IconName::TriangleAlert).size(px(16.)).text_color(tw("amber-500")))
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .gap(px(2.))
                                .children(errors.iter().take(6).map(|e| div().child(format!("• {e}"))))
                                .when(errors.len() > 6, |d| d.child(format!("• …and {} more", errors.len() - 6))),
                        ),
                )
            })
            .child(tabs)
            .child(content)
            .into_any_element();

        let main = shell(
            "Plans",
            Some("Define once here, then deploy to sync products and prices to Stripe. Drafts are stored on this device until deployed."),
            Some(actions.into_any_element()),
            None,
            body,
            cx,
        );

        // "N" creates a product / "F" a feature (ignored while typing: inputs own focus then).
        div()
            .size_full()
            .flex()
            .track_focus(&self.focus)
            .on_mouse_down(gpui::MouseButton::Left, cx.listener(|this, _, win, cx| {
                if this.sheet.is_none() && win.focused(cx).is_none() {
                    this.focus.focus(win, cx);
                }
            }))
            .on_key_down(cx.listener(|this, e: &KeyDownEvent, win, cx| {
                let m = &e.keystroke.modifiers;
                if m.platform || m.control || m.alt || this.sheet.is_some() || !this.focus.is_focused(win) {
                    return;
                }
                match e.keystroke.key.to_lowercase().as_str() {
                    "n" if !this.tab_features && this.selected_product.is_none() => this.open_product_sheet(None, win, cx),
                    "f" if this.tab_features && this.selected_feature.is_none() => this.open_feature_sheet(None, win, cx),
                    _ => return,
                }
                cx.stop_propagation();
            }))
            .child(div().flex_1().min_w_0().h_full().child(main))
            .children(self.render_sheet(cx))
            .into_any_element()
    }
}
