//! Port of the database-backed Supabase Auth and Storage studio tabs.

use gpui::{
    div, prelude::*, px, AnyElement, AnyView, App, AppContext, Context, Entity, SharedString,
    Window,
};
use gpui_component::scroll::ScrollableElement;
use rexa_core::{runtime, Session, TabSpec};
use rexa_drivers::{Kind, QueryResult};
use rexa_ui::widgets::{InputEvent, InputState};
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, Tw};
use serde_json::Value;
use std::sync::Arc;

pub fn build_tab(
    spec: &TabSpec,
    session: Arc<Session>,
    window: &mut Window,
    cx: &mut App,
) -> Option<AnyView> {
    let TabSpec::View { view, params } = spec else {
        return None;
    };
    let title = match view.as_str() {
        "auth-users" => "Authentication users",
        "auth-sessions" => "Authentication sessions",
        "auth-providers" => "Identity provider usage",
        "storage-files" => "Storage buckets",
        "storage-settings" => "Storage settings",
        "storage-policies" => "Storage policies",
        "storage-bucket" | "supabase-storage" => "Storage files",
        "edge-functions" => "Edge Functions",
        "edge-function" => "Edge Function",
        "edge-secrets" => "Edge Function secrets",
        "database-spacetimedb-schema" => "SpacetimeDB schema",
        "database-spacetimedb-reducers" => "SpacetimeDB reducers",
        "database-spacetimedb-logs" => "SpacetimeDB logs",
        "payments-plans" => "Billing plans",
        "payments-customers" => "Billing customers",
        "payments-subscriptions" => "Billing subscriptions",
        "payments-revenue" => "Billing revenue",
        "payments-webhooks" => "Billing webhooks",
        _ => return None,
    };
    Some(
        cx.new(|cx| DatabaseView::new(title, view, params, session, window, cx))
            .into(),
    )
}

pub struct DatabaseView {
    title: &'static str,
    view: String,
    bucket: Option<String>,
    focus_function: Option<String>,
    session: Arc<Session>,
    search: Entity<InputState>,
    result: QueryResult,
    loading: bool,
    busy_action: Option<String>,
    error: Option<String>,
    _subs: Vec<gpui::Subscription>,
}

impl DatabaseView {
    fn new(
        title: &'static str,
        view: &str,
        params: &Value,
        session: Arc<Session>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let search = cx.new(|cx| InputState::new(window, cx).placeholder("Search results…"));
        let subs = vec![cx.subscribe(&search, |_, _, event: &InputEvent, cx| {
            if matches!(event, InputEvent::Change) {
                cx.notify();
            }
        })];
        let bucket = params
            .get("bucketName")
            .or_else(|| params.get("bucket"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        let focus_function = params
            .get("functionName")
            .or_else(|| params.get("name"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        let mut this = Self {
            title,
            view: view.to_owned(),
            bucket,
            focus_function,
            session,
            search,
            result: QueryResult::default(),
            loading: false,
            busy_action: None,
            error: None,
            _subs: subs,
        };
        this.load(cx);
        this
    }

    fn sql(&self) -> Option<String> {
        let dialect = self.session.driver.dialect();
        match self.view.as_str() {
            "auth-users"
            | "edge-functions"
            | "edge-function"
            | "edge-secrets"
            | "database-spacetimedb-schema"
            | "database-spacetimedb-reducers"
            | "database-spacetimedb-logs" => None,
            "auth-sessions" => Some("SELECT * FROM auth.sessions ORDER BY created_at DESC LIMIT 500".into()),
            "auth-providers" => Some("SELECT provider, count(*) AS identity_count FROM auth.identities GROUP BY provider ORDER BY provider".into()),
            "storage-files" | "storage-settings" if self.bucket.is_none() => Some("SELECT id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at FROM storage.buckets ORDER BY name LIMIT 500".into()),
            "storage-bucket" | "supabase-storage" | "storage-files" => {
                let bucket = self.bucket.as_deref().unwrap_or_default().replace('\'', "''");
                Some(format!("SELECT id, name, bucket_id, created_at, updated_at, metadata FROM storage.objects WHERE bucket_id = {} ORDER BY name LIMIT 500", dialect.quote_str(&bucket)))
            }
            "storage-policies" => Some("SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check FROM pg_policies WHERE schemaname = 'storage' ORDER BY tablename, policyname".into()),
            "storage-settings" => Some("SELECT * FROM storage.buckets ORDER BY name LIMIT 500".into()),
            "payments-plans" => Some("SELECT p.internal_id, p.id, p.name, p.\"group\", p.is_default, p.price_amount, p.price_interval, p.price_currency, p.stripe_product_id, p.stripe_price_id, (SELECT count(*) FROM paykit.subscription s WHERE s.product_internal_id = p.internal_id AND s.status IN ('active','trialing') AND s.canceled = false AND s.ended_at IS NULL) AS active_subs FROM paykit.product p ORDER BY p.price_amount NULLS FIRST, p.id LIMIT 500".into()),
            "payments-customers" => Some("SELECT c.id, c.email, c.name, c.stripe_customer_id, c.created_at, (SELECT count(*) FROM paykit.subscription s WHERE s.customer_id = c.id AND s.status IN ('active','trialing') AND s.canceled = false AND s.ended_at IS NULL) AS active_subs, (SELECT count(*) FROM paykit.subscription s WHERE s.customer_id = c.id) AS total_subs FROM paykit.customer c ORDER BY c.created_at DESC LIMIT 200".into()),
            "payments-subscriptions" => Some("SELECT s.id, s.customer_id, c.email AS customer_email, s.product_internal_id, p.name AS plan_name, s.status, s.canceled, s.cancel_at_period_end, s.current_period_end_at, s.quantity, s.updated_at FROM paykit.subscription s LEFT JOIN paykit.customer c ON c.id = s.customer_id LEFT JOIN paykit.product p ON p.internal_id = s.product_internal_id ORDER BY s.updated_at DESC LIMIT 200".into()),
            "payments-revenue" => Some("SELECT (SELECT coalesce(sum(amount), 0) FROM paykit.invoice WHERE status = 'paid') AS paid_total, (SELECT count(*) FROM paykit.subscription WHERE status IN ('active','trialing') AND canceled = false AND ended_at IS NULL) AS active_subs, (SELECT count(*) FROM paykit.customer) AS customers, (SELECT count(*) FROM paykit.invoice WHERE status = 'failed') AS failed_invoices".into()),
            "payments-webhooks" => Some("SELECT id, type, status, error, received_at, processed_at, stripe_event_id FROM paykit.webhook_event ORDER BY received_at DESC LIMIT 200".into()),
            _ => None,
        }
    }

    fn load(&mut self, cx: &mut Context<Self>) {
        self.loading = true;
        self.error = None;
        cx.notify();
        let driver = self.session.driver.clone();
        let sql = self.sql();
        let view = self.view.clone();
        let focus_function = self.focus_function.clone();
        let task = runtime::spawn(async move {
            if (view.starts_with("auth-")
                || view.starts_with("storage-")
                || view == "supabase-storage")
                && !matches!(driver.kind(), Kind::Postgres | Kind::SupabaseMgmt)
            {
                anyhow::bail!(
                    "This view requires a PostgreSQL or Supabase Management API connection."
                );
            }
            if (view.starts_with("edge-") || view == "edge-function")
                && driver.kind() != Kind::SupabaseMgmt
            {
                anyhow::bail!(
                    "Supabase Edge resources require a Supabase Management API connection."
                );
            }
            if view.starts_with("payments-")
                && !matches!(driver.kind(), Kind::Postgres | Kind::SupabaseMgmt)
            {
                anyhow::bail!("PayKit billing data requires a PostgreSQL or Supabase Management API connection.");
            }
            if view.starts_with("database-spacetimedb-") && driver.kind() != Kind::SpacetimeDb {
                anyhow::bail!("This view requires a SpacetimeDB connection.");
            }
            if view == "auth-users" {
                let users = driver.supabase_auth_users().await?;
                let columns = vec!["id", "email", "phone", "role", "providers", "created_at"];
                let rows = users
                    .into_iter()
                    .map(|u| {
                        vec![
                            rexa_drivers::Cell::Text(u.id),
                            u.email
                                .map(rexa_drivers::Cell::Text)
                                .unwrap_or(rexa_drivers::Cell::Null),
                            u.phone
                                .map(rexa_drivers::Cell::Text)
                                .unwrap_or(rexa_drivers::Cell::Null),
                            rexa_drivers::Cell::Text(u.role),
                            rexa_drivers::Cell::Text(u.providers.join(", ")),
                            u.created_at
                                .map(rexa_drivers::Cell::Text)
                                .unwrap_or(rexa_drivers::Cell::Null),
                        ]
                    })
                    .collect();
                Ok(QueryResult {
                    columns: columns.into_iter().map(str::to_owned).collect(),
                    rows,
                    ..Default::default()
                })
            } else if view == "edge-functions" || view == "edge-function" {
                let functions = driver.supabase_edge_functions().await?;
                let functions: Vec<Value> = functions
                    .into_iter()
                    .filter(|function| {
                        focus_function.as_ref().is_none_or(|name| {
                            function
                                .get("slug")
                                .or_else(|| function.get("name"))
                                .and_then(Value::as_str)
                                == Some(name)
                        })
                    })
                    .collect();
                Ok(json_result(
                    &[
                        "slug",
                        "status",
                        "version",
                        "verify_jwt",
                        "entrypoint_path",
                        "created_at",
                    ],
                    functions,
                ))
            } else if view == "edge-secrets" {
                let secrets = driver.supabase_edge_secrets().await?;
                // The Management API returns only secret metadata. Never
                // include a `value` field even if an API response changes.
                Ok(json_result(&["name", "updated_at"], secrets))
            } else if view == "database-spacetimedb-schema" {
                let module = driver.spacetimedb_module().await?;
                Ok(json_result(
                    &["module_definition"],
                    vec![
                        serde_json::json!({ "module_definition": serde_json::to_string_pretty(&module)? }),
                    ],
                ))
            } else if view == "database-spacetimedb-reducers" {
                let module = driver.spacetimedb_module().await?;
                let reducers = module
                    .pointer("/sections")
                    .and_then(Value::as_array)
                    .and_then(|sections| {
                        sections.iter().find_map(|section| section.get("Reducers"))
                    })
                    .and_then(Value::as_array)
                    .cloned()
                    .or_else(|| module.get("reducers").and_then(Value::as_array).cloned())
                    .unwrap_or_default();
                let reducers = reducers
                    .into_iter()
                    .map(|reducer| {
                        let name = reducer
                            .pointer("/source_name/some")
                            .and_then(Value::as_str)
                            .or_else(|| reducer.get("source_name").and_then(Value::as_str))
                            .or_else(|| reducer.get("name").and_then(Value::as_str))
                            .unwrap_or("(unnamed)");
                        let args = reducer
                            .get("params")
                            .or_else(|| reducer.get("args"))
                            .and_then(|params| params.get("elements").or(Some(params)))
                            .and_then(Value::as_array)
                            .map(|args| {
                                args.iter()
                                    .map(|arg| {
                                        arg.pointer("/name/some")
                                            .and_then(Value::as_str)
                                            .or_else(|| arg.get("name").and_then(Value::as_str))
                                            .unwrap_or("arg")
                                    })
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            })
                            .unwrap_or_default();
                        serde_json::json!({ "name": name, "arguments": args })
                    })
                    .collect();
                Ok(json_result(&["name", "arguments"], reducers))
            } else if view == "database-spacetimedb-logs" {
                let logs = driver.spacetimedb_logs(250).await?;
                Ok(json_result(&["time", "level", "target", "message"], logs))
            } else if let Some(sql) = sql {
                driver.execute_readonly(&sql, 500).await
            } else {
                anyhow::bail!("This provider view is not available for the current connection.")
            }
        });
        cx.spawn(async move |this, cx| {
            let outcome = task.await;
            this.update(cx, |this, cx| {
                this.loading = false;
                match outcome {
                    Ok(result) => {
                        this.result = result;
                        this.error = None;
                    }
                    Err(error) => this.error = Some(format!("{error:#}")),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn run_zero_arg_reducer(&mut self, reducer: String, cx: &mut Context<Self>) {
        if self.busy_action.is_some() {
            return;
        }
        self.busy_action = Some(reducer.clone());
        cx.notify();
        let driver = self.session.driver.clone();
        let task =
            runtime::spawn(async move { driver.call_spacetimedb_reducer(&reducer, &[]).await });
        cx.spawn(async move |this, cx| {
            let result = task.await;
            this.update(cx, |this, cx| {
                this.busy_action = None;
                match result {
                    Ok(()) => {
                        rexa_ui::Toast::success("Reducer completed").show(cx);
                        this.load(cx);
                    }
                    Err(error) => {
                        rexa_ui::Toast::error(format!("Reducer failed: {error:#}")).show(cx);
                    }
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }
}

fn json_result(columns: &[&str], values: Vec<Value>) -> QueryResult {
    QueryResult {
        columns: columns.iter().map(|name| (*name).to_owned()).collect(),
        rows: values
            .iter()
            .map(|value| {
                columns
                    .iter()
                    .map(|name| {
                        value
                            .get(*name)
                            .map(|cell| match cell {
                                Value::Null => rexa_drivers::Cell::Null,
                                Value::String(text) => rexa_drivers::Cell::Text(text.clone()),
                                other => rexa_drivers::Cell::Text(other.to_string()),
                            })
                            .unwrap_or(rexa_drivers::Cell::Null)
                    })
                    .collect()
            })
            .collect(),
        ..Default::default()
    }
}

impl Render for DatabaseView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let query = self.search.read(cx).value().trim().to_lowercase();
        let columns = self.result.columns.clone();
        let mut rows: Vec<Vec<String>> = self
            .result
            .rows
            .iter()
            .map(|row| row.iter().map(|cell| cell.display().to_owned()).collect())
            .collect();
        if !query.is_empty() {
            rows.retain(|row| {
                row.iter()
                    .any(|value| value.to_lowercase().contains(&query))
            });
        }
        let header: Vec<AnyElement> = columns
            .iter()
            .map(|column| {
                div()
                    .flex_1()
                    .min_w(px(110.))
                    .truncate()
                    .px_3()
                    .py_2()
                    .tw_text_xs()
                    .text_color(t.muted_foreground)
                    .child(column.clone())
                    .into_any_element()
            })
            .collect();
        let body: Vec<AnyElement> = rows
            .iter()
            .enumerate()
            .map(|(index, row)| {
                let bucket_name = (self.view == "storage-files" && self.bucket.is_none())
                    .then(|| row.get(1).cloned())
                    .flatten();
                let function_name = (self.view == "edge-functions")
                    .then(|| row.first().cloned())
                    .flatten();
                let reducer_name = (self.view == "database-spacetimedb-reducers")
                    .then(|| row.first().cloned())
                    .flatten();
                let reducer_has_args = row.get(1).is_some_and(|args| !args.is_empty());
                let mut line = div()
                    .flex()
                    .items_center()
                    .min_w_0()
                    .border_b_1()
                    .border_color(t.border)
                    .hover(|d| d.bg(t.muted));
                for (i, cell) in row.iter().enumerate() {
                    line = line.child(
                        div()
                            .flex_1()
                            .min_w(px(110.))
                            .truncate()
                            .px_3()
                            .py_2()
                            .tw_text_xs()
                            .child(cell.clone())
                            .id(SharedString::from(format!("provider-cell-{index}-{i}"))),
                    );
                }
                if let Some(reducer) = reducer_name {
                    let can_run = !reducer_has_args;
                    let busy = self.busy_action.as_deref() == Some(reducer.as_str());
                    line = line.child(
                        Button::new(SharedString::from(format!("spacetime-run-{reducer}")))
                            .outline()
                            .size(ButtonSize::Xs)
                            .label(if busy { "Running…" } else if can_run { "Run" } else { "Needs arguments" })
                            .disabled(!can_run || busy || self.busy_action.is_some())
                            .on_click(cx.listener(move |this, _, _, cx| this.run_zero_arg_reducer(reducer.clone(), cx))),
                    );
                }
                if let Some(bucket_name) = bucket_name {
                    rexa_ui::Button::new(SharedString::from(format!(
                        "storage-bucket-row-{bucket_name}"
                    )))
                    .ghost()
                    .w_full()
                    .child(line)
                    .on_click(move |_, _, cx| {
                        let id = format!("storage-bucket-{bucket_name}");
                        rexa_core::open_tab(
                            TabSpec::View {
                                view: "storage-bucket".into(),
                                params: serde_json::json!({ "id": id, "bucketName": bucket_name }),
                            },
                            cx,
                        );
                    })
                    .into_any_element()
                } else if let Some(function_name) = function_name {
                    rexa_ui::Button::new(SharedString::from(format!("edge-function-row-{function_name}")))
                        .ghost()
                        .w_full()
                        .child(line)
                        .on_click(move |_, _, cx| {
                            let id = format!("edge-function-{function_name}");
                            rexa_core::open_tab(
                                TabSpec::View {
                                    view: "edge-function".into(),
                                    params: serde_json::json!({ "id": id, "functionName": function_name }),
                                },
                                cx,
                            );
                        })
                        .into_any_element()
                } else {
                    line.into_any_element()
                }
            })
            .collect();
        div().size_full().flex().flex_col().bg(t.background).text_color(t.foreground)
            .child(div().flex().items_center().gap_3().px_5().py_3().border_b_1().border_color(t.border)
                .child(div().flex_1().tw_text_sm().font_weight(gpui::FontWeight::MEDIUM).child(self.bucket.as_ref().map(|bucket| format!("{} / {bucket}", self.title)).unwrap_or_else(|| self.title.to_owned())))
                .child(div().w(px(260.)).child(rexa_ui::TextInput::new(&self.search)))
                .child(Button::new("provider-view-refresh").outline().size(ButtonSize::Sm).icon(IconName::RefreshCw).label("Refresh").disabled(self.loading).on_click(cx.listener(|this, _, _, cx| this.load(cx))))
                .child(div().tw_text_xs().text_color(t.muted_foreground).child(format!("{} rows", rows.len()))))
            .when((self.view.starts_with("auth-") || self.view.starts_with("storage-") || self.view == "supabase-storage") && self.session.driver.kind() != Kind::Postgres && self.session.driver.kind() != Kind::SupabaseMgmt, |el| el.child(div().px_5().py_2().tw_text_xs().text_color(t.muted_foreground).child("This view reads Supabase Auth and Storage tables from a PostgreSQL connection.")))
            .when_some(self.error.clone(), |el, error| el.child(div().mx_5().my_3().p_3().text_color(t.destructive).tw_text_xs().child(error)))
            .when(self.loading, |el| el.child(div().flex_1().flex().items_center().justify_center().tw_text_sm().text_color(t.muted_foreground).child("Loading…")))
            .when(!self.loading && self.error.is_none(), |el| el.child(div().flex().items_center().min_w_0().bg(t.muted).children(header)).child(div().flex_1().min_h_0().overflow_y_scrollbar().children(body)))
    }
}

#[cfg(test)]
mod tests {
    use super::json_result;
    use serde_json::json;

    #[test]
    fn secret_results_expose_metadata_only() {
        let result = json_result(
            &["name", "updated_at"],
            vec![
                json!({ "name": "STRIPE_SECRET_KEY", "updated_at": "today", "value": "must-not-render" }),
            ],
        );
        assert_eq!(result.columns, ["name", "updated_at"]);
        assert_eq!(result.rows[0][0].display(), "STRIPE_SECRET_KEY");
        assert_eq!(result.rows[0][1].display(), "today");
        assert_eq!(result.rows[0].len(), 2);
    }
}
