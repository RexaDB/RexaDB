//! RexaDB native: window setup and route → screen dispatch. All screens come
//! from feature crates via `rexa_core::Registry`.

use gpui::{
    div, point, prelude::*, px, size, AnyView, App, AppContext, Bounds, Context, Subscription,
    TitlebarOptions, Window, WindowBounds, WindowOptions,
};
use gpui_component::Root;
use rexa_core::{navigator, Registry, Route, RouteChanged};
use rexa_ui::ActiveTokens;

struct AppRoot {
    route: Route,
    view: Option<AnyView>,
    _nav: Subscription,
    _settings: Subscription,
}

impl AppRoot {
    fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let nav = navigator(cx);
        let sub = cx.subscribe_in(&nav, window, |this, nav, _: &RouteChanged, window, cx| {
            this.route = nav.read(cx).route.clone();
            this.view = Registry::build_screen(&this.route, window, cx);
            cx.notify();
        });
        let settings = rexa_settings::model::SettingsModel::global(cx);
        // `data-button-style` is applied at boot (SettingsModel::set only covers changes).
        let button_style = settings.read(cx).str("buttonStyle");
        rexa_ui::button::set_global_style(&button_style, cx);
        let settings_sub = cx.observe(&settings, |_, _, cx| cx.notify());
        let route = nav.read(cx).route.clone();
        let view = Registry::build_screen(&route, window, cx);
        Self { route, view, _nav: sub, _settings: settings_sub }
    }
}

impl Render for AppRoot {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let t = cx.tokens();
        let model = rexa_settings::model::SettingsModel::read(cx);
        let translucent = model.is_some_and(|m| m.bool("noiseBgTranslucent"));
        let zoom = model.map_or(100., |m| m.num("appZoom") as f32).clamp(50., 200.);
        window.set_rem_size(px(16. * zoom / 100.));
        window.set_background_appearance(if translucent { gpui::WindowBackgroundAppearance::Blurred } else { gpui::WindowBackgroundAppearance::Opaque });
        div()
            .size_full()
            .bg(if translucent { gpui::transparent_black() } else { t.studio_bg })
            .text_color(t.foreground)
            .font_family(rexa_ui::app_font::family(cx))
            .children(self.view.clone())
            .when(self.view.is_none(), |el| {
                el.flex().items_center().justify_center().child(format!("No screen registered for {:?}", self.route))
            })
    }
}

fn main() {
    // `rexadb --mcp`: the RexaDB MCP stdio server (lib/agents/mcp/external-stdio.ts).
    if std::env::args().any(|a| a == "--mcp") {
        if let Err(e) = rexa_ai::mcp::run_stdio() {
            eprintln!("[rexadb-mcp] fatal: {e:#}");
            std::process::exit(1);
        }
        return;
    }
    rexa_core::runtime::init();
    let app = gpui_platform::application().with_assets(rexa_ui::assets::Assets);
    app.run(|cx: &mut App| {
        rexa_ui::init(cx);
        let (theme_id, custom, studio) = rexa_store::Store::open()
            .map(|s| (s.setting("app_theme_id").ok().flatten(), s.setting("custom_app_themes").ok().flatten(), s.setting("studio_settings").ok().flatten()))
            .unwrap_or_default();
        // `.tui-mode` on the root (useGlobalStudioSettings → tuiMode).
        let tui = studio.and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok()).and_then(|v| v.get("tuiMode").and_then(|b| b.as_bool())).unwrap_or(false);
        rexa_ui::theme::set_tui_mode(tui);
        rexa_ui::theme::install(rexa_ui::theme::load_effective(theme_id.as_deref(), custom.as_deref()), cx);

        rexa_core::init(cx);
        rexa_connections::init(cx);
        rexa_studio::init(cx);
        rexa_grid::init(cx);
        rexa_sql::init(cx);
        rexa_schema::init(cx);
        rexa_settings::init(cx);
        rexa_ai::init(cx);
        rexa_features::init(cx);
        rexa_providers::init(cx);

        // Dev aid: REXA_ROUTE=studio:<id> opens a route directly.
        if let Ok(r) = std::env::var("REXA_ROUTE") {
            if let Some(id) = r.strip_prefix("studio:").and_then(|i| i.parse().ok()) {
                rexa_core::navigate(Route::Studio(id), cx);
            } else if let Some(screen) = r.strip_prefix("screen:") {
                rexa_core::navigate(Route::ConnectionScreen(screen.into()), cx);
            }
        }

        // tauri.conf.json: 1200×800, min 800×600, overlay title bar, traffic lights at (14, 21).
        // REXA_WINDOW_SIZE=WxH overrides the size (for side-by-side comparison with the old app).
        let (w, h) = std::env::var("REXA_WINDOW_SIZE")
            .ok()
            .and_then(|v| v.split_once('x').and_then(|(w, h)| Some((w.parse().ok()?, h.parse().ok()?))))
            .unwrap_or((1200., 800.));
        let bounds = Bounds::centered(None, size(px(w), px(h)), cx);
        cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                window_min_size: Some(size(px(800.), px(600.))),
                titlebar: Some(TitlebarOptions {
                    title: Some("RexaDB".into()),
                    appears_transparent: true,
                    traffic_light_position: Some(point(px(14.), px(16.))),
                }),
                ..Default::default()
            },
            |window, cx| {
                let root = cx.new(|cx| AppRoot::new(window, cx));
                cx.new(|cx| Root::new(root, window, cx))
            },
        )
        .expect("failed to open the main window");
        cx.activate(true);
    });
}
