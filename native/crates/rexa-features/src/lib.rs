//! Port of cross-database feature areas: transfer, workflows, snapshots,
//! notes, dashboards, import/export, query advisor-free tooling.

use gpui::App;

mod notes;
mod dashboard;
mod snapshots;
mod workflows;

pub fn init(cx: &mut App) {
    notes::init(cx);
    dashboard::init(cx);
    snapshots::init(cx);
    workflows::init(cx);
}
