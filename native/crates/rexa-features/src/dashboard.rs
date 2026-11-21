//! SQL-backed dashboard editor. Stores per-connection dashboard definitions
//! in the same `dashboard_state` row used by the studio sidebar.

use gpui::{div, prelude::*, px, AnyView, App, AppContext, Context, Entity, Subscription, Task, Window};
use gpui_component::input::{Input, InputEvent, InputState, Textarea, TextareaState};
use gpui_component::scroll::ScrollableElement;
use rexa_core::{runtime, Registry, Session, TabSpec};
use rexa_ui::{ActiveTokens, Button, ButtonSize, IconName, Tw};
use rexa_drivers::{QueryResult, DEFAULT_ROW_LIMIT};
use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};

#[derive(Clone)]
struct Widget { id: String, title: String, sql: String, raw: Value, result: Option<QueryResult>, error: Option<String> }

pub struct Dashboard {
    session: Arc<Session>,
    dashboard_id: String,
    title: Entity<InputState>,
    widgets: Vec<Widget>,
    selected: Option<usize>,
    widget_title: Entity<InputState>,
    widget_sql: Entity<TextareaState>,
    busy: bool,
    message: Option<String>,
    load_task: Option<Task<()>>,
    _subs: Vec<Subscription>,
}

fn open_db() -> rusqlite::Result<Connection> {
    let db = Connection::open_with_flags(rexa_store::Store::database_path(), OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE)?;
    db.busy_timeout(Duration::from_secs(5))?;
    db.execute_batch("CREATE TABLE IF NOT EXISTS dashboard_state (connection_id INTEGER PRIMARY KEY, dashboards_json TEXT NOT NULL DEFAULT '[]', folders_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL DEFAULT 0);")?;
    Ok(db)
}
fn timestamp() -> i64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64) }
fn load_dashboards(connection_id: i64) -> Vec<Value> {
    let Ok(db) = open_db() else { return vec![] };
    let raw: Option<String> = db.query_row("SELECT dashboards_json FROM dashboard_state WHERE connection_id=?1", [connection_id], |r| r.get(0)).optional().ok().flatten();
    raw.and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}
fn persist(connection_id: i64, dashboards: &[Value]) -> rusqlite::Result<()> {
    open_db()?.execute("INSERT INTO dashboard_state(connection_id,dashboards_json,folders_json,updated_at) VALUES(?1,?2,'[]',?3) ON CONFLICT(connection_id) DO UPDATE SET dashboards_json=excluded.dashboards_json,updated_at=excluded.updated_at", (connection_id, serde_json::to_string(dashboards).unwrap_or_else(|_| "[]".into()), timestamp()))?;
    Ok(())
}
fn parse_widgets(value: &Value) -> Vec<Widget> {
    value.get("widgets").and_then(Value::as_array).into_iter().flatten().map(|w| Widget {
        id: w.get("id").and_then(Value::as_str).unwrap_or_default().to_string(),
        title: w.get("title").and_then(Value::as_str).unwrap_or("Query").to_string(),
        sql: w.get("query").or_else(||w.get("sql")).and_then(Value::as_str).or_else(||w.pointer("/config_json/query").and_then(Value::as_str)).unwrap_or("SELECT 1").to_string(), raw:w.clone(), result: None, error: None,
    }).collect()
}
/// Dashboard widgets are read-only. Require exactly one SELECT statement;
/// this deliberately rejects WITH because some engines allow data-changing
/// CTEs and the generic driver has no portable read-only transaction wrapper.
fn validate_read_query(sql:&str)->Result<String,String>{
    let trimmed=sql.trim();
    if trimmed.is_empty(){return Err("Enter a SELECT query.".into());}
    let statement=trimmed.strip_suffix(';').unwrap_or(trimmed).trim();
    if statement.contains(';'){return Err("Dashboard widgets accept one statement at a time.".into());}
    let mut rest=statement;
    loop {
        rest=rest.trim_start();
        if let Some(after)=rest.strip_prefix("--") { rest=after.split_once('\n').map(|(_,tail)|tail).unwrap_or(""); continue; }
        if let Some(after)=rest.strip_prefix("/*") { let Some((_,tail))=after.split_once("*/") else{return Err("Close the SQL comment before the query.".into())};rest=tail;continue; }
        break;
    }
    if !rest.get(..6).is_some_and(|head|head.eq_ignore_ascii_case("select")) || rest.as_bytes().get(6).is_some_and(|b|b.is_ascii_alphanumeric()||*b==b'_') {
        return Err("Dashboard widgets currently allow SELECT queries only.".into());
    }
    Ok(statement.to_string())
}
impl Dashboard {
    fn new(params: &Value, session: Arc<Session>, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let raw_id=params.get("baseId").or_else(||params.get("id")).and_then(Value::as_str).unwrap_or("dashboard-default");
        let raw_id=raw_id.split("::pane::").next().unwrap_or(raw_id);
        let dashboard_id = raw_id.strip_prefix("dashboard-").unwrap_or(raw_id).to_string();
        let mut all = load_dashboards(session.connection.id);
        let item = all.iter().find(|d| d.get("id").and_then(Value::as_str) == Some(&dashboard_id)).cloned();
        let title_value = item.as_ref().and_then(|d| d.get("name")).and_then(Value::as_str).unwrap_or("Untitled dashboard").to_string();
        let title = cx.new(|cx| InputState::new(window, cx).default_value(title_value));
        let mut widgets = item.as_ref().map(parse_widgets).unwrap_or_default();
        let first_widget=widgets.first();
        let widget_title = cx.new(|cx| InputState::new(window, cx).placeholder("Widget title").default_value(first_widget.map(|w|w.title.clone()).unwrap_or_default()));
        let widget_sql = cx.new(|cx| TextareaState::new(window, cx).auto_grow(4, 14).default_value(first_widget.map(|w|w.sql.clone()).unwrap_or_else(||"SELECT 1".into())));
        if item.is_none() {
            all.push(json!({"id":dashboard_id,"name":"Untitled dashboard","widgets":[]}));
            if let Err(e) = persist(session.connection.id, &all) { eprintln!("Could not create dashboard: {e}"); }
        }
        if widgets.is_empty() { widgets.push(Widget { id: "welcome".into(), title: "Welcome".into(), sql: "SELECT 1".into(), raw:Value::Null, result: None, error: None }); }
        let title_sub = cx.subscribe(&title, |this, _, event: &InputEvent, cx| if matches!(event, InputEvent::Change) { this.save(cx); });
        let sql_sub = cx.subscribe(&widget_sql, |_this, _, event: &InputEvent, cx| if matches!(event, InputEvent::Change) { cx.notify(); });
        let mut this = Self { session, dashboard_id, title, widgets, selected: Some(0), widget_title, widget_sql, busy: false, message: None, load_task: None, _subs: vec![title_sub, sql_sub] };
        this.load_selected(cx);
        this
    }
    fn save(&mut self, cx: &mut Context<Self>) {
        let name = self.title.read(cx).value().trim().to_string();
        let widgets: Vec<Value> = self.widgets.iter().filter(|w| w.id != "welcome").map(|w| {
            let mut raw=w.raw.as_object().cloned().unwrap_or_default();
            raw.insert("id".into(),Value::String(w.id.clone()));raw.insert("title".into(),Value::String(w.title.clone()));
            raw.insert("query".into(),Value::String(w.sql.clone()));Value::Object(raw)
        }).collect();
        let mut all = load_dashboards(self.session.connection.id);
        let id=self.dashboard_id.clone();
        if let Some(existing) = all.iter_mut().find(|d| d.get("id").and_then(Value::as_str)==Some(&self.dashboard_id)) {
            if let Some(object)=existing.as_object_mut(){object.insert("name".into(),Value::String(if name.is_empty(){"Untitled dashboard".into()}else{name}));object.insert("widgets".into(),Value::Array(widgets));}
        } else { all.push(json!({"id":id,"name":if name.is_empty(){"Untitled dashboard".into()}else{name},"folderId":null,"widgets":widgets})); }
        self.message = persist(self.session.connection.id, &all).err().map(|e| format!("Save failed: {e}")).or(Some("Saved".into()));
        cx.notify();
    }
    fn load_selected(&mut self, cx: &mut Context<Self>) {
        let Some(index) = self.selected else { return };
        if index >= self.widgets.len() { return; }
        let sql = match validate_read_query(&self.widgets[index].sql) { Ok(s)=>s, Err(e)=>{self.widgets[index].error=Some(e);cx.notify();return;} };
        self.busy = true; self.widgets[index].error = None; self.message = None;
        let driver = self.session.driver.clone();
        self.load_task = Some(cx.spawn(async move |this, cx| {
            let result = runtime::spawn(async move { driver.execute_readonly(&sql, DEFAULT_ROW_LIMIT).await }).await;
            this.update(cx, |this, cx| {
                if let Some(i) = this.selected { if let Some(w) = this.widgets.get_mut(i) { match result { Ok(result) => { w.result = Some(result); w.error = None; }, Err(e) => { w.error = Some(format!("Query failed: {e}")); w.result = None; } } } }
                this.busy = false; cx.notify();
            }).ok();
        }));
    }
    fn choose(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        if index >= self.widgets.len() { return; }
        self.selected = Some(index);
        let w = &self.widgets[index];
        self.widget_title.update(cx, |s,cx| s.set_value(w.title.clone(), window, cx));
        self.widget_sql.update(cx, |s,cx| s.set_value(w.sql.clone(), window, cx));
        self.load_selected(cx); cx.notify();
    }
    fn add_widget(&mut self, cx: &mut Context<Self>) {
        let title = self.widget_title.read(cx).value().trim().to_string();
        let sql = match validate_read_query(&self.widget_sql.read(cx).value()) { Ok(s)=>s, Err(e)=>{self.message=Some(e);cx.notify();return;} };
        let id = format!("widget-{}", timestamp());
        let title=if title.is_empty(){"Query".into()}else{title};
        self.widgets.push(Widget { id:id.clone(), title:title.clone(), sql:sql.clone(), raw:json!({"id":id,"widgetType":"query","title":title,"query":sql,"x":0,"y":0,"width":8,"height":6}), result: None, error: None });
        self.selected = Some(self.widgets.len()-1); self.save(cx); self.load_selected(cx); cx.notify();
    }
    fn run(&mut self, cx: &mut Context<Self>) {
        let Some(i) = self.selected else { return };
        self.widgets[i].title = self.widget_title.read(cx).value().trim().to_string();
        self.widgets[i].sql = match validate_read_query(&self.widget_sql.read(cx).value()) { Ok(s)=>s, Err(e)=>{self.message=Some(e);cx.notify();return;} };
        self.save(cx); self.load_selected(cx);
    }
}
impl Render for Dashboard {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens().clone();
        let selected = self.selected.unwrap_or(0);
        div().size_full().flex().flex_col().bg(t.studio_bg).text_color(t.foreground)
            .child(div().flex().items_center().gap_3().px_5().py_3().border_b_1().border_color(t.border)
                .child(div().w(px(360.)).child(Input::new(&self.title).appearance(false)))
                .child(Button::new("dashboard-save").outline().size(ButtonSize::Sm).icon(IconName::Check).label("Save").on_click(cx.listener(|this,_,_,cx|this.save(cx))))
                .child(div().tw_text_xs().text_color(t.muted_foreground).child(self.message.clone().unwrap_or_else(|| "SQL dashboard".into()))))
            .child(div().flex().flex_1().min_h_0()
                .child(div().w(px(210.)).flex().flex_col().gap_1().p_3().border_r_1().border_color(t.border)
                    .children(self.widgets.iter().enumerate().map(|(i,w)| { let label=w.title.clone(); Button::new(format!("dashboard-widget-{i}")).when(i==selected,|b|b.secondary()).size(ButtonSize::Sm).label(label).on_click(cx.listener(move |this,_,window,cx|this.choose(i,window,cx))) }))
                    .child(Button::new("dashboard-add-widget").outline().size(ButtonSize::Sm).icon(IconName::Plus).label("Add query").on_click(cx.listener(|this,_,_,cx|this.add_widget(cx)))))
                .child(div().flex_1().min_w_0().flex().flex_col().gap_3().p_5()
                    .child(div().flex().gap_2().child(div().w(px(240.)).child(Input::new(&self.widget_title).appearance(false))).child(Button::new("dashboard-run").size(ButtonSize::Sm).icon(IconName::Play).label(if self.busy{"Running…"}else{"Run & save"}).on_click(cx.listener(|this,_,_,cx|this.run(cx)))))
                    .child(div().h(px(120.)).child(Textarea::new(&self.widget_sql).appearance(false)))
                    .when_some(self.selected.and_then(|i|self.widgets.get(i)).and_then(|w|w.error.clone()),|el,e|el.child(div().text_color(t.destructive).child(e)))
                    .when_some(self.selected.and_then(|i|self.widgets.get(i)).and_then(|w|w.result.as_ref()).cloned(),|el,r: QueryResult| {
                        el.child(div().flex_1().min_h_0().overflow_y_scrollbar().border_1().border_color(t.border).child(
                            div().flex().flex_col().children(std::iter::once(div().flex().gap_3().border_b_1().border_color(t.border).px_3().py_2().children(r.columns.iter().map(|c|div().w(px(180.)).tw_text_xs().font_weight(gpui::FontWeight::BOLD).child(c.clone())))).chain(r.rows.iter().take(250).map(|row|div().flex().gap_3().border_b_1().border_color(t.border).px_3().py_2().children(row.iter().map(|v|div().w(px(180.)).tw_text_xs().child(v.display().to_string()))))))))
                    })
                ))
    }
}
pub fn init(cx:&mut App) {
    Registry::tab(cx,"rexa-features-dashboard",|spec,session,window,cx| {
        let TabSpec::View{view,params}=spec else{return None};
        if view!="dashboard" { return None; }
        let params=params.clone(); Some(Into::<AnyView>::into(cx.new(|cx|Dashboard::new(&params,session,window,cx))))
    });
}
