//! Port of `lib/supabase-paykit/{types,validation}.ts` draft state + helpers,
//! and `slugifyPaykitId` / `formatPlanPrice` from the product sheet / paykit-shared.

use super::currencies::currency_symbol;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const PAYKIT_ID_RE: &str = r"^[a-z0-9_-]{1,64}$";
pub const PAYKIT_RESETS: &[&str] = &["day", "week", "month", "year"];

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureDraft {
    pub id: String,
    #[serde(rename = "type")]
    pub feature_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanInclude {
    pub feature_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reset: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanDraft {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub group: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<bool>,
    #[serde(default)]
    pub price_amount: Option<f64>,
    #[serde(default)]
    pub price_interval: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub price_currency: Option<String>,
    #[serde(default)]
    pub includes: Vec<PlanInclude>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftState {
    pub version: u32,
    #[serde(default)]
    pub features: Vec<FeatureDraft>,
    pub plans: Vec<PlanDraft>,
    #[serde(default)]
    pub updated_at: i64,
}

impl Default for DraftState {
    /// `createEmptyDraftState`.
    fn default() -> Self {
        DraftState {
            version: 1,
            features: vec![],
            plans: vec![PlanDraft {
                id: "free".into(),
                name: "Free".into(),
                group: "base".into(),
                default: Some(true),
                ..Default::default()
            }],
            updated_at: chrono::Utc::now().timestamp_millis(),
        }
    }
}

fn drafts_key(r: &str) -> String {
    format!("rexadb-paykit-drafts:{r}")
}

pub fn load_drafts(r: &str) -> DraftState {
    let raw = rexa_store::Store::open()
        .ok()
        .and_then(|s| s.setting(&drafts_key(r)).ok().flatten())
        .or_else(|| rexa_store::WebStore::open()?.get(&drafts_key(r)).ok().flatten());
    raw.and_then(|r| serde_json::from_str::<DraftState>(&r).ok())
        .filter(|d| d.version == 1)
        .unwrap_or_default()
}

pub fn save_drafts(r: &str, d: &DraftState) {
    let mut d = d.clone();
    d.updated_at = chrono::Utc::now().timestamp_millis();
    if let (Ok(s), Ok(json)) = (rexa_store::Store::open(), serde_json::to_string(&d)) {
        s.set_setting(&drafts_key(r), &json).ok();
    }
}

/// `slugifyPaykitId`.
pub fn slugify_paykit_id(value: &str) -> String {
    let lower = value.to_ascii_lowercase();
    let mut out = String::new();
    let mut prev_dash = false;
    for c in lower.trim().chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c);
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-');
    trimmed.chars().take(64).collect()
}

/// `validatePaykitId` — returns an error message, or `None` when valid.
pub fn validate_paykit_id(id: &str) -> Option<String> {
    let id = id.trim();
    if id.is_empty() {
        return Some("ID is required.".into());
    }
    if id.len() > 64 || !id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_') {
        return Some("Lowercase alphanumeric with dashes/underscores, max 64 chars.".into());
    }
    None
}

fn validate_feature(f: &FeatureDraft) -> Option<String> {
    if let Some(err) = validate_paykit_id(&f.id) {
        return Some(format!("Feature \"{}\": {err}", if f.id.is_empty() { "?" } else { &f.id }));
    }
    if f.feature_type != "boolean" && f.feature_type != "metered" {
        return Some(format!("Feature \"{}\": type must be boolean or metered.", f.id));
    }
    None
}

fn validate_plan(plan: &PlanDraft, features_by_id: &HashMap<&str, &FeatureDraft>) -> Vec<String> {
    let mut errors = Vec::new();
    let label = if plan.id.is_empty() { "?" } else { plan.id.as_str() };
    if let Some(err) = validate_paykit_id(&plan.id) {
        errors.push(format!("Plan \"{label}\": {err}"));
    }
    if plan.name.trim().is_empty() {
        errors.push(format!("Plan \"{label}\": name is required."));
    }
    if plan.group.trim().is_empty() {
        errors.push(format!("Plan \"{label}\": group is required."));
    }

    let has_price = plan.price_amount.is_some_and(|a| !a.is_nan());
    if has_price {
        let amount = plan.price_amount.unwrap_or(0.);
        if !amount.is_finite() || amount <= 0. || amount > 999_999.99 {
            errors.push(format!("Plan \"{label}\": price must be between 0 and 999,999.99 USD."));
        }
        match plan.price_interval.as_deref() {
            Some("month") | Some("year") => {}
            _ => errors.push(format!("Plan \"{label}\": price interval must be month or year.")),
        }
    }

    let mut seen = HashSet::new();
    for inc in &plan.includes {
        if !seen.insert(inc.feature_id.as_str()) {
            errors.push(format!("Plan \"{label}\": duplicate feature \"{}\".", inc.feature_id));
            continue;
        }
        let Some(feat) = features_by_id.get(inc.feature_id.as_str()) else {
            errors.push(format!("Plan \"{label}\": unknown feature \"{}\".", inc.feature_id));
            continue;
        };
        if feat.feature_type == "boolean" {
            if inc.limit.is_some() || inc.reset.is_some() {
                errors.push(format!(
                    "Plan \"{label}\": boolean feature \"{}\" takes no limit/reset.",
                    inc.feature_id
                ));
            }
        } else {
            let ok_limit = inc.limit.is_some_and(|n| n.is_finite() && n > 0. && n.fract() == 0.);
            if !ok_limit {
                errors.push(format!(
                    "Plan \"{label}\": metered feature \"{}\" needs a positive integer limit.",
                    inc.feature_id
                ));
            }
            let reset_ok = inc.reset.as_deref().is_some_and(|r| PAYKIT_RESETS.contains(&r));
            if !reset_ok {
                errors.push(format!(
                    "Plan \"{label}\": metered feature \"{}\" needs reset day|week|month|year.",
                    inc.feature_id
                ));
            }
        }
    }
    errors
}

/// `validateDrafts` — full rules from `lib/supabase-paykit/validation.ts`.
pub fn validate_drafts(d: &DraftState) -> Vec<String> {
    let mut errors = Vec::new();
    let mut feature_ids = HashSet::new();
    let mut features_by_id: HashMap<&str, &FeatureDraft> = HashMap::new();
    for f in &d.features {
        if let Some(err) = validate_feature(f) {
            errors.push(err);
        }
        if !f.id.is_empty() {
            if !feature_ids.insert(f.id.as_str()) {
                errors.push(format!("Duplicate feature id \"{}\".", f.id));
            }
            features_by_id.insert(f.id.as_str(), f);
        }
    }

    let mut plan_ids = HashSet::new();
    let mut defaults_per_group: HashMap<&str, usize> = HashMap::new();
    for p in &d.plans {
        if !p.id.is_empty() {
            if !plan_ids.insert(p.id.as_str()) {
                errors.push(format!("Duplicate plan id \"{}\".", p.id));
            }
        }
        errors.extend(validate_plan(p, &features_by_id));
        if p.default == Some(true) {
            let group = if p.group.trim().is_empty() { "base" } else { p.group.trim() };
            *defaults_per_group.entry(group).or_default() += 1;
        }
    }
    for (group, count) in defaults_per_group {
        if count > 1 {
            errors.push(format!("Group \"{group}\": only one plan may be default."));
        }
    }
    if d.plans.is_empty() {
        errors.push("Define at least one plan.".into());
    }
    errors
}

pub fn is_paid(p: &PlanDraft) -> bool {
    p.price_amount.is_some_and(f64::is_finite)
}

/// `formatPlanPrice`.
pub fn format_plan_price(p: &PlanDraft) -> (String, Option<String>) {
    if !is_paid(p) {
        return ("Free".into(), None);
    }
    let code = p.price_currency.clone().unwrap_or_else(|| "usd".into());
    (
        format!("{}{:.2} {}", currency_symbol(&code), p.price_amount.unwrap_or(0.), code.to_uppercase()),
        Some(if p.price_interval.as_deref() == Some("year") {
            "Per year".into()
        } else {
            "Per month".into()
        }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_and_validate_id() {
        assert_eq!(slugify_paykit_id("Pro Plan!"), "pro-plan");
        assert_eq!(slugify_paykit_id("  Messages_API  "), "messages-api");
        assert_eq!(slugify_paykit_id("---Hello---"), "hello");
        assert!(validate_paykit_id("pro").is_none());
        assert!(validate_paykit_id("pro_plan-1").is_none());
        assert!(validate_paykit_id("").is_some());
        assert!(validate_paykit_id("Bad Id").is_some());
        assert!(validate_paykit_id(&"a".repeat(65)).is_some());
    }

    #[test]
    fn drafts_roundtrip_and_validation() {
        let d: DraftState = serde_json::from_str(
            r#"{"version":1,"features":[{"id":"messages","type":"metered","description":"Messages"}],"plans":[{"id":"pro","name":"Pro","group":"base","priceAmount":29,"priceInterval":"month","includes":[{"featureId":"messages","limit":100,"reset":"month"}]}],"updatedAt":1}"#,
        )
        .unwrap();
        assert_eq!(d.features[0].feature_type, "metered");
        assert_eq!(d.features[0].description.as_deref(), Some("Messages"));
        assert_eq!(format_plan_price(&d.plans[0]), ("$29.00 USD".to_string(), Some("Per month".to_string())));
        assert!(validate_drafts(&d).is_empty());
        let s = serde_json::to_string(&d).unwrap();
        assert!(s.contains("\"priceAmount\":29"));
        assert!(s.contains("\"type\":\"metered\""));

        let dflt = DraftState::default();
        assert_eq!(format_plan_price(&dflt.plans[0]).0, "Free");
        let bad = DraftState {
            plans: vec![PlanDraft {
                id: "Bad Id".into(),
                ..Default::default()
            }],
            ..dflt
        };
        // id invalid + name required + group required
        assert_eq!(validate_drafts(&bad).len(), 3);

        let missing_metered = DraftState {
            features: vec![FeatureDraft {
                id: "msgs".into(),
                feature_type: "metered".into(),
                description: None,
            }],
            plans: vec![PlanDraft {
                id: "pro".into(),
                name: "Pro".into(),
                group: "base".into(),
                includes: vec![PlanInclude {
                    feature_id: "msgs".into(),
                    limit: None,
                    reset: None,
                }],
                ..Default::default()
            }],
            ..DraftState::default()
        };
        let errs = validate_drafts(&missing_metered);
        assert!(errs.iter().any(|e| e.contains("positive integer limit")));
        assert!(errs.iter().any(|e| e.contains("needs reset")));
    }
}
