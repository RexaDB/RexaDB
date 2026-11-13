//! Port of the studio shell: components/studio/{studio-interface,
//! studio-shell-sidebar,modern-pane-tabs,…}, components/app-shell, hooks/use-studio*.
//! Hosts tabs built through `rexa_core::Registry::build_tab`.

mod placeholder;
mod results;
pub mod split_layout;

use gpui::{App, AppContext};
use rexa_core::{Registry, Route};

pub fn init(cx: &mut App) {
    placeholder::init(cx);
    Registry::screen(cx, "rexa-studio", |route, window, cx| match route {
        Route::Studio(id) => {
            let id = *id;
            Some(
                cx.new(|cx| {
                    let mut ws = placeholder::Workspace::new(window, cx);
                    ws.connect(id, cx);
                    ws
                })
                .into(),
            )
        }
        _ => None,
    });
}
