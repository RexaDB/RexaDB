//! Window root: routes between the Connections home and an open connection,
//! like the old app's `/` and `/studio` pages.

use crate::connections::{ConnectionsEvent, ConnectionsScreen};
use crate::workspace::Workspace;
use gpui::{prelude::*, Context, Entity, Subscription, Window};

enum Screen {
    Connections(Entity<ConnectionsScreen>),
    Studio(Entity<Workspace>),
}

pub struct AppRoot {
    screen: Screen,
    _subscription: Option<Subscription>,
}

impl AppRoot {
    pub fn new(window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mut this = Self { screen: Screen::Connections(cx.new(|cx| ConnectionsScreen::new(window, cx))), _subscription: None };
        this.subscribe(window, cx);
        this
    }

    fn subscribe(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Screen::Connections(screen) = &self.screen {
            self._subscription = Some(cx.subscribe_in(screen, window, |this, _, event, window, cx| match event {
                ConnectionsEvent::Open(conn) => {
                    let id = conn.id;
                    let workspace = cx.new(|cx| {
                        let mut ws = Workspace::new(window, cx);
                        ws.connect(id, cx);
                        ws
                    });
                    this.screen = Screen::Studio(workspace);
                    cx.notify();
                }
            }));
        }
    }
}

impl Render for AppRoot {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        match &self.screen {
            Screen::Connections(s) => s.clone().into_any_element(),
            Screen::Studio(s) => s.clone().into_any_element(),
        }
    }
}
