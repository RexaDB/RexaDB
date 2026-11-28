//! Port of the parts of components/studio/database/explain-plan-view.tsx the
//! SQL editor uses: `extractExplainPlan`, `getPlanNode` and `PlanNodeCard`
//! (Postgres `EXPLAIN (… FORMAT JSON)` trees).

use gpui::{div, prelude::*, px, AnyElement, App, FontWeight, SharedString};
use gpui_component::Icon;
use rexa_drivers::{Cell, QueryResult};
use rexa_ui::{tw, with_alpha, ActiveTokens, IconName, Tw, MONO};
use serde_json::Value;
use std::collections::HashSet;
use std::rc::Rc;

/// `extractExplainPlan(results.rows[0])`: the first column holds the JSON plan.
pub fn extract_explain_plan(r: &QueryResult) -> Option<Value> {
    let Some(Cell::Text(text)) = r.rows.first().and_then(|row| row.first()) else { return None };
    let t = text.trim_start();
    if !(t.starts_with('[') || t.starts_with('{')) {
        return None;
    }
    let v: Value = serde_json::from_str(text).ok()?;
    let candidate = match &v {
        Value::Array(a) => a.first()?.clone(),
        other => other.clone(),
    };
    (candidate.get("Query Plan").is_some() || candidate.get("Plan").is_some()).then_some(candidate)
}

/// `getPlanNode`
pub fn plan_node(plan: &Value) -> Option<&Value> {
    plan.get("Query Plan").or_else(|| plan.get("Plan"))
}

fn num(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(Value::as_f64)
}

fn s(v: &Value, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str().map(str::to_string))
}

/// JS number printing for `{node["Actual Rows"]}` etc.
pub fn js_num(n: f64) -> String {
    if n.fract() == 0. && n.abs() < 1e15 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

pub type ToggleHandler = Rc<dyn Fn(String, &mut gpui::Window, &mut App)>;

/// `PlanNodeCard`. `toggled` holds node paths whose default expansion
/// (`depth < 2`) the user flipped.
pub fn plan_node_card(node: &Value, depth: usize, path: String, toggled: &HashSet<String>, on_toggle: ToggleHandler, cx: &App) -> AnyElement {
    let t = cx.tokens();
    let expanded = (depth < 2) != toggled.contains(&path);
    let children: Vec<Value> = node.get("Plans").and_then(Value::as_array).cloned().unwrap_or_default();
    let has_children = !children.is_empty();
    let actual_total = num(node, "Actual Total Time");
    let cost_color = match actual_total {
        Some(a) if a > 1000. => tw("red-500"),
        Some(a) if a > 100. => tw("amber-500"),
        Some(_) => tw("emerald-500"),
        None if num(node, "Total Cost").unwrap_or(0.) > 10000. => tw("amber-500"),
        None => t.muted_foreground,
    };
    let muted = t.muted_foreground;
    let mono_muted = |text: String| div().font_family(MONO).text_color(muted).child(text);
    let detail = |label: &str, value: String, color: gpui::Hsla| {
        div()
            .tw_text_xs()
            .text_color(muted)
            .flex()
            .gap_1()
            .child(div().text_color(with_alpha(t.foreground, 0.6)).child(format!("{label}:")))
            .child(div().font_family(MONO).text_color(color).child(value))
    };

    let mut stats = div().flex().items_center().gap_3().tw_text_xs().flex_wrap();
    if let Some(total) = actual_total {
        stats = stats
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_1()
                    .text_color(muted)
                    .child(Icon::new(IconName::Clock).size(px(10.)))
                    .child(div().font_family(MONO).text_color(cost_color).child(format!("{total:.2}ms"))),
            )
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap_1()
                    .text_color(muted)
                    .child(Icon::new(IconName::Database).size(px(10.)))
                    .child(div().font_family(MONO).child(format!("{} rows", js_num(num(node, "Actual Rows").unwrap_or(0.))))),
            );
        if let Some(loops) = num(node, "Actual Loops").filter(|l| *l > 1.) {
            stats = stats.child(
                div()
                    .flex()
                    .items_center()
                    .gap_1()
                    .text_color(muted)
                    .child(Icon::new(IconName::Zap).size(px(10.)))
                    .child(div().font_family(MONO).child(format!("{} loops", js_num(loops)))),
            );
        }
    } else {
        stats = stats
            .child(mono_muted(format!(
                "Cost: {:.2}..{:.2}",
                num(node, "Startup Cost").unwrap_or(0.),
                num(node, "Total Cost").unwrap_or(0.)
            )))
            .child(mono_muted(format!("Rows: {}", js_num(num(node, "Plan Rows").unwrap_or(0.)))));
    }

    let mut details = div().pt_1().flex().flex_col().gap(px(2.));
    if expanded {
        if let Some(f) = s(node, "Filter") {
            details = details.child(detail("Filter", f, with_alpha(tw("amber-500"), 0.8)));
        }
        for k in ["Index Cond", "Hash Cond", "Merge Cond"] {
            if let Some(v) = s(node, k) {
                details = details.child(detail(k, v, with_alpha(tw("blue-400"), 0.8)));
            }
        }
        if let Some(m) = s(node, "Sort Method") {
            let space = num(node, "Sort Space Used").filter(|v| *v != 0.).map(|v| format!(" ({}kB)", js_num(v))).unwrap_or_default();
            details = details.child(detail("Sort", format!("{m}{space}"), muted));
        }
        if let Some(l) = num(node, "Workers Launched") {
            let planned = num(node, "Workers Planned").map(js_num).unwrap_or_default();
            details = details.child(detail("Workers", format!("{}/{}", js_num(l), planned), muted));
        }
    }

    let title = div()
        .flex()
        .items_center()
        .gap_2()
        .flex_wrap()
        .child(
            div()
                .tw_text_xs()
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(t.foreground)
                .font_family(MONO)
                .child(s(node, "Node Type").unwrap_or_default()),
        )
        .children(s(node, "Relation Name").map(|r| mono_muted(format!("on {r}")).tw_text_xs()))
        .children(s(node, "Index Name").map(|r| mono_muted(format!("using {r}")).tw_text_xs()))
        .children(s(node, "Join Type").map(|j| {
            div()
                .tw_text_xs()
                .h_4()
                .px_1()
                .flex()
                .items_center()
                .border_1()
                .border_color(t.studio_border)
                .tw_rounded_md()
                .child(j)
        }));

    let toggle = on_toggle.clone();
    let p = path.clone();
    div()
        .border_l_2()
        .border_color(if depth == 0 { with_alpha(t.primary, 0.4) } else { t.studio_border })
        .child(
            div()
                .id(SharedString::from(format!("plan-{path}")))
                .flex()
                .items_start()
                .gap_2()
                .py(px(6.))
                .pr_3()
                .pl(px(depth as f32 * 16. + 12.))
                .cursor_pointer()
                .tw_rounded_lg()
                .hover(|st| st.bg(with_alpha(t.muted, 0.1)))
                .on_click(move |_, w, cx| toggle(p.clone(), w, cx))
                .child(if has_children {
                    div()
                        .mt(px(2.))
                        .flex_shrink_0()
                        .text_color(muted)
                        .child(Icon::new(if expanded { IconName::ChevronDown } else { IconName::ChevronRight }).size(px(12.)))
                        .into_any_element()
                } else {
                    div().w_3().flex_shrink_0().into_any_element()
                })
                .child(div().flex_1().min_w_0().flex().flex_col().gap(px(2.)).child(title).child(stats).child(details)),
        )
        .when(expanded && has_children, |d| {
            d.child(div().pb_1().children(children.iter().enumerate().map(|(i, c)| {
                plan_node_card(c, depth + 1, format!("{path}.{i}"), toggled, on_toggle.clone(), cx)
            })))
        })
        .into_any_element()
}
