//! Dev screen for working on the SQL editor without the studio shell:
//! `REXA_ROUTE=screen:dev-sql:<connection id>` (or `dev-sql-history:<id>`,
//! `dev-sql-panel:<id>`).

use gpui::{div, prelude::*, AnyView, Context, SharedString, Window};
use rexa_core::TabSpec;
use rexa_ui::ActiveTokens;

pub struct DevSqlScreen {
    view: Option<AnyView>,
    status: SharedString,
}

impl DevSqlScreen {
    pub fn new(connection_id: i64, which: &'static str, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let conn = rexa_store::Store::open().ok().and_then(|s| s.connections().ok()).and_then(|l| l.into_iter().find(|c| c.id == connection_id));
        let Some(conn) = conn else {
            return DevSqlScreen { view: None, status: format!("No connection {connection_id}").into() };
        };
        let task = rexa_core::connect(conn, cx);
        cx.spawn_in(window, async move |this, cx| {
            let res = task.await;
            this.update_in(cx, |this, window, cx| {
                match res {
                    Ok(session) => {
                        let spec = match which {
                            "history" => TabSpec::View { view: "history".into(), params: serde_json::Value::Null },
                            "panel" => TabSpec::View { view: "sql-sheet".into(), params: serde_json::json!({}) },
                            _ => {
                                // REXA_DEV_SQL preloads the editor; REXA_DEV_RUN=1 runs it.
                                let sql = std::env::var("REXA_DEV_SQL").unwrap_or_default();
                                let editor = cx.new(|cx| {
                                    crate::sql_editor::SqlEditor::new(session, "sql-new-dev".into(), "Query".into(), sql, window, cx)
                                });
                                if std::env::var("REXA_DEV_RUN").is_ok() {
                                    editor.update(cx, |e, cx| e.handle_run_query(None, cx));
                                }
                                this.view = Some(editor.into());
                                cx.notify();
                                return;
                            }
                        };
                        this.view = rexa_core::Registry::build_tab(&spec, session, window, cx);
                    }
                    Err(e) => this.status = format!("{e:#}").into(),
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
        DevSqlScreen { view: None, status: "Connecting…".into() }
    }
}

impl Render for DevSqlScreen {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens();
        div()
            .size_full()
            .flex()
            .flex_col()
            .bg(t.studio_bg)
            .pt(gpui::px(36.))
            .children(self.view.clone())
            .when(self.view.is_none(), |d| d.items_center().justify_center().child(self.status.clone()))
    }
}
