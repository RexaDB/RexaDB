//! Port of cross-database feature areas: transfer, workflows, snapshots,
//! notes, dashboards, import/export, query advisor-free tooling.

use gpui::App;

mod notes;
mod dashboard;
mod advisor;
mod import_export;
mod snapshots;
mod workflows;

pub fn init(cx: &mut App) {
    notes::init(cx);
    dashboard::init(cx);
    advisor::init(cx);
    import_export::init(cx);
    snapshots::init(cx);
    workflows::init(cx);
}
