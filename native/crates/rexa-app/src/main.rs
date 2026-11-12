mod app;
mod assets;
mod connections;
mod images;
mod providers;
mod results;
mod runtime;
mod theme;
mod tracked_text;
mod workspace;

use gpui::{point, px, size, App, AppContext, Bounds, TitlebarOptions, WindowBounds, WindowOptions};
use gpui_component::Root;

fn main() {
    runtime::init();
    let app = gpui_platform::application().with_assets(assets::Assets);
    app.run(|cx: &mut App| {
        gpui_component::init(cx);
        let (theme_id, custom) = rexa_store::Store::open()
            .map(|s| (s.setting("app_theme_id").ok().flatten(), s.setting("custom_app_themes").ok().flatten()))
            .unwrap_or_default();
        theme::install(theme::load(theme_id.as_deref(), custom.as_deref()), cx);

        // tauri.conf.json: 1200×800, min 800×600, overlay title bar, traffic lights at (14, 21).
        // REXA_WINDOW_SIZE=WxH overrides the size (used to compare against the old app).
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
                let root = cx.new(|cx| app::AppRoot::new(window, cx));
                cx.new(|cx| Root::new(root, window, cx))
            },
        )
        .expect("failed to open the main window");
        cx.activate(true);
    });
}
