//! The studio's icon sources: lib/icon-theme/solar-icons.tsx (Solar "Linear"
//! weight, exported to assets/brand/solar) and lib/icon-theme/lucide-react.tsx
//! (plain Lucide, served by gpui-kit-assets under `icons/<kebab>.svg`).

use gpui::{prelude::*, px, svg, Hsla, Svg};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Ico {
    /// File stem in assets/brand/solar.
    Solar(&'static str),
    /// Lucide kebab-case name.
    Lucide(&'static str),
}

impl Ico {
    pub fn path(self) -> String {
        match self {
            Ico::Solar(n) => format!("brand/solar/{n}.svg"),
            Ico::Lucide(n) => format!("icons/{n}.svg"),
        }
    }

    pub fn el(self, size: f32, color: Hsla) -> Svg {
        svg().path(self.path()).size(px(size)).flex_shrink_0().text_color(color)
    }
}

// solar-icons.tsx names → Solar files.
pub const S_WIDGET: Ico = Ico::Solar("widget"); // LayoutDashboard
pub const S_FILE: Ico = Ico::Solar("file"); // FileText
pub const S_DATABASE: Ico = Ico::Solar("database");
pub const S_LAYERS: Ico = Ico::Solar("layers");
pub const S_CODE_SQUARE: Ico = Ico::Solar("code-square"); // SquareTerminal
pub const S_WORKFLOW: Ico = Ico::Solar("branching-paths-down");
pub const S_WALLET: Ico = Ico::Solar("wallet-money");
pub const S_HOUSE: Ico = Ico::Solar("house");
pub const S_USERS: Ico = Ico::Solar("users-group-rounded");
pub const S_SETTINGS: Ico = Ico::Solar("settings-minimalistic");
pub const S_LEFT: Ico = Ico::Solar("alt-arrow-left");
pub const S_RIGHT: Ico = Ico::Solar("alt-arrow-right");
pub const S_DOWN: Ico = Ico::Solar("alt-arrow-down");
pub const S_SEARCH: Ico = Ico::Solar("minimalistic-magnifier");
pub const S_PEN: Ico = Ico::Solar("pen-new-square"); // SquarePen
pub const S_CODE2: Ico = Ico::Solar("code-2");
pub const S_SHIELD: Ico = Ico::Solar("shield");
pub const S_FOLDER: Ico = Ico::Solar("folder");
pub const S_FOLDER_OPEN: Ico = Ico::Solar("folder-open");
pub const S_CHECK: Ico = Ico::Solar("check-circle");
pub const S_HISTORY: Ico = Ico::Solar("history");
pub const S_USER: Ico = Ico::Solar("user");
pub const S_CHART: Ico = Ico::Solar("chart");
pub const S_TABLE: Ico = Ico::Solar("huge-layout-table-02"); // Table2
pub const S_TABLE_EDITOR: Ico = Ico::Solar("table-editor");
pub const S_AUTH: Ico = Ico::Solar("auth");

pub fn lucide(name: &'static str) -> Ico {
    Ico::Lucide(name)
}
