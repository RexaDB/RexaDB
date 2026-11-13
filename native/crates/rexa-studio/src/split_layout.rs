//! Port of lib/studio/split-layout.ts, lib/studio/tab-close.ts and
//! lib/studio/pane-close.ts: the split-pane tree, the tab → pane mapping and
//! the focus rules when tabs or panes close. Serialized exactly like the old
//! app (`connection_settings.split_view`), so both apps share the layout.

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};

pub const PANE_TAB_DELIMITER: &str = "::pane::";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SplitDirection {
    #[default]
    Vertical,
    Horizontal,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SplitNode {
    Pane {
        id: String,
    },
    Split {
        id: String,
        direction: SplitDirection,
        ratio: f32,
        first: Box<SplitNode>,
        second: Box<SplitNode>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PaneState {
    pub active_tab_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitViewState {
    pub enabled: bool,
    pub root: SplitNode,
    pub active_pane_id: String,
    pub pane_state: BTreeMap<String, PaneState>,
    pub tab_pane_map: BTreeMap<String, String>,
    pub next_pane_number: u32,
    pub next_split_number: u32,
}

impl SplitViewState {
    /// createDefaultSplitLayout
    pub fn new(active_tab_id: Option<String>) -> Self {
        let mut pane_state = BTreeMap::new();
        pane_state.insert("pane-1".to_string(), PaneState { active_tab_id });
        Self {
            enabled: false,
            root: SplitNode::Pane { id: "pane-1".into() },
            active_pane_id: "pane-1".into(),
            pane_state,
            tab_pane_map: BTreeMap::new(),
            next_pane_number: 2,
            next_split_number: 1,
        }
    }

    pub fn pane_ids(&self) -> Vec<String> {
        pane_ids(&self.root)
    }

    /// resolvePaneForTab
    pub fn pane_for_tab(&self, tab_id: &str) -> String {
        let ids = self.pane_ids();
        if let Some(mapped) = self.tab_pane_map.get(tab_id) {
            if ids.contains(mapped) {
                return mapped.clone();
            }
        }
        infer_pane_from_tab_id(tab_id, &ids).unwrap_or_else(|| first_pane_id(&self.root))
    }

    /// assignTabToPane
    pub fn assign_tab(&self, tab_id: &str, pane_id: &str, activate: bool) -> Self {
        let mut s = self.clone();
        if activate {
            s.active_pane_id = pane_id.to_string();
        }
        s.tab_pane_map.insert(tab_id.to_string(), pane_id.to_string());
        let current = self.pane_state.get(pane_id).and_then(|p| p.active_tab_id.clone());
        let active = if activate { Some(tab_id.to_string()) } else { current.or(Some(tab_id.to_string())) };
        s.pane_state.insert(pane_id.to_string(), PaneState { active_tab_id: active });
        s
    }

    /// activatePane
    pub fn activate_pane(&self, pane_id: &str, tab_id: Option<String>) -> Self {
        let mut s = self.clone();
        s.active_pane_id = pane_id.to_string();
        s.pane_state.insert(pane_id.to_string(), PaneState { active_tab_id: tab_id });
        s
    }

    /// splitPane
    pub fn split_pane(&self, pane_id: &str, direction: SplitDirection, on_right_or_bottom: bool) -> Self {
        let new_pane = format!("pane-{}", self.next_pane_number);
        let branch = format!("split-{}", self.next_split_number);
        let mut s = self.clone();
        s.enabled = true;
        s.root = split_node_at(&self.root, pane_id, &branch, &new_pane, direction, on_right_or_bottom);
        s.active_pane_id = new_pane.clone();
        s.pane_state.insert(new_pane, PaneState::default());
        s.next_pane_number += 1;
        s.next_split_number += 1;
        s
    }

    /// closePane
    pub fn close_pane(&self, pane_id: &str, open_tab_ids: &[String]) -> Self {
        let ids = self.pane_ids();
        if ids.len() <= 1 || !ids.iter().any(|p| p == pane_id) {
            return self.clone();
        }
        let (node, sibling) = remove_pane(&self.root, pane_id);
        let (Some(node), Some(sibling)) = (node, sibling) else { return self.clone() };
        let mut s = self.clone();
        s.pane_state.remove(pane_id);
        s.pane_state.entry(sibling.clone()).or_default();
        s.enabled = pane_ids(&node).len() > 1;
        s.root = node;
        s.active_pane_id = sibling;
        s.tab_pane_map.retain(|tab, _| open_tab_ids.contains(tab));
        s
    }

    /// updateSplitRatio
    pub fn set_ratio(&self, split_id: &str, ratio: f32) -> Self {
        fn update(node: &SplitNode, id: &str, r: f32) -> SplitNode {
            match node {
                SplitNode::Pane { .. } => node.clone(),
                SplitNode::Split { id: sid, direction, ratio, first, second } => SplitNode::Split {
                    id: sid.clone(),
                    direction: *direction,
                    ratio: if sid == id { r } else { *ratio },
                    first: Box::new(update(first, id, r)),
                    second: Box::new(update(second, id, r)),
                },
            }
        }
        let mut s = self.clone();
        s.root = update(&self.root, split_id, ratio);
        s
    }

    /// getTabsForPane
    pub fn tabs_for_pane(&self, tab_ids: &[String], pane_id: &str) -> Vec<String> {
        tab_ids.iter().filter(|t| self.pane_for_tab(t) == pane_id).cloned().collect()
    }

    /// normalizeSplitLayout
    pub fn normalize(&self, open_tab_ids: &[String], fallback_active: Option<&str>) -> Self {
        let ids = self.pane_ids();
        let fallback_pane = ids.first().cloned().unwrap_or_else(|| "pane-1".into());
        let open: HashSet<&String> = open_tab_ids.iter().collect();
        let mut map = BTreeMap::new();
        for tab in open_tab_ids {
            let resolved = self.pane_for_tab(tab);
            map.insert(tab.clone(), if ids.contains(&resolved) { resolved } else { fallback_pane.clone() });
        }
        let with_map = Self { tab_pane_map: map.clone(), ..self.clone() };
        let mut pane_state = BTreeMap::new();
        for pane in &ids {
            let pane_tabs = with_map.tabs_for_pane(open_tab_ids, pane);
            let candidate = self.pane_state.get(pane).and_then(|p| p.active_tab_id.clone());
            let active = match candidate {
                Some(c) if open.contains(&c) && pane_tabs.contains(&c) => Some(c),
                _ => pane_tabs.first().cloned(),
            };
            pane_state.insert(pane.clone(), PaneState { active_tab_id: active });
        }
        let mut next = Self {
            enabled: ids.len() > 1,
            active_pane_id: if ids.contains(&self.active_pane_id) { self.active_pane_id.clone() } else { fallback_pane },
            pane_state,
            tab_pane_map: map,
            ..self.clone()
        };
        if let Some(fallback) = fallback_active {
            if let Some(pane) = next.tab_pane_map.get(fallback).cloned() {
                if next.pane_state.contains_key(&pane) {
                    next.active_pane_id = pane.clone();
                    next.pane_state.insert(pane, PaneState { active_tab_id: Some(fallback.to_string()) });
                }
            }
        }
        next
    }
}

pub fn pane_ids(node: &SplitNode) -> Vec<String> {
    match node {
        SplitNode::Pane { id } => vec![id.clone()],
        SplitNode::Split { first, second, .. } => {
            let mut v = pane_ids(first);
            v.extend(pane_ids(second));
            v
        }
    }
}

pub fn first_pane_id(node: &SplitNode) -> String {
    match node {
        SplitNode::Pane { id } => id.clone(),
        SplitNode::Split { first, .. } => first_pane_id(first),
    }
}

fn infer_pane_from_tab_id(tab_id: &str, pane_ids: &[String]) -> Option<String> {
    let idx = tab_id.find(PANE_TAB_DELIMITER)?;
    let encoded = tab_id[idx + PANE_TAB_DELIMITER.len()..].split(PANE_TAB_DELIMITER).next()?;
    pane_ids.iter().find(|p| *p == encoded).cloned()
}

/// The tab id without its `::pane::<id>` suffix (getTabBaseId fallback).
pub fn base_tab_id(tab_id: &str) -> &str {
    tab_id.split(PANE_TAB_DELIMITER).next().unwrap_or(tab_id)
}

fn split_node_at(
    node: &SplitNode,
    pane_id: &str,
    branch: &str,
    new_pane: &str,
    direction: SplitDirection,
    on_right_or_bottom: bool,
) -> SplitNode {
    match node {
        SplitNode::Pane { id } if id == pane_id => {
            let new = Box::new(SplitNode::Pane { id: new_pane.into() });
            let old = Box::new(node.clone());
            let (first, second) = if on_right_or_bottom { (new, old) } else { (old, new) };
            SplitNode::Split { id: branch.into(), direction, ratio: 0.5, first, second }
        }
        SplitNode::Pane { .. } => node.clone(),
        SplitNode::Split { id, direction: d, ratio, first, second } => SplitNode::Split {
            id: id.clone(),
            direction: *d,
            ratio: *ratio,
            first: Box::new(split_node_at(first, pane_id, branch, new_pane, direction, on_right_or_bottom)),
            second: Box::new(split_node_at(second, pane_id, branch, new_pane, direction, on_right_or_bottom)),
        },
    }
}

/// removePaneFromNode: (new node or None if removed, sibling pane that takes focus)
fn remove_pane(node: &SplitNode, pane_id: &str) -> (Option<SplitNode>, Option<String>) {
    match node {
        SplitNode::Pane { id } => {
            if id == pane_id {
                (None, None)
            } else {
                (Some(node.clone()), None)
            }
        }
        SplitNode::Split { first, second, .. } => {
            let (left, left_sib) = remove_pane(first, pane_id);
            match left {
                None => return (Some((**second).clone()), Some(first_pane_id(second))),
                Some(l) if &l != first.as_ref() => {
                    let mut n = node.clone();
                    if let SplitNode::Split { first, .. } = &mut n {
                        *first = Box::new(l);
                    }
                    return (Some(n), left_sib);
                }
                _ => {}
            }
            let (right, right_sib) = remove_pane(second, pane_id);
            match right {
                None => (Some((**first).clone()), Some(first_pane_id(first))),
                Some(r) if &r != second.as_ref() => {
                    let mut n = node.clone();
                    if let SplitNode::Split { second, .. } = &mut n {
                        *second = Box::new(r);
                    }
                    (Some(n), right_sib)
                }
                _ => (Some(node.clone()), None),
            }
        }
    }
}

/// resolveTabCloseState (lib/studio/tab-close.ts)
pub struct TabClose {
    pub closed_pane_id: String,
    pub next_focused_tab_id: Option<String>,
    pub next_split_view: SplitViewState,
    pub next_tab_ids: Vec<String>,
}

pub fn resolve_tab_close(
    active_tab_id: Option<&str>,
    closed_tab_id: &str,
    open_tab_ids: &[String],
    split: &SplitViewState,
) -> TabClose {
    let closing_active = active_tab_id == Some(closed_tab_id);
    let next_tabs: Vec<String> = open_tab_ids.iter().filter(|t| *t != closed_tab_id).cloned().collect();
    let closed_pane = split.pane_for_tab(closed_tab_id);
    let mut without = split.clone();
    without.tab_pane_map.remove(closed_tab_id);
    let normalized = without.normalize(&next_tabs, if closing_active { None } else { active_tab_id });
    let original = split.tabs_for_pane(open_tab_ids, &closed_pane);
    let closed_index = original.iter().position(|t| t == closed_tab_id).unwrap_or(0);
    let next_pane_tabs = normalized.tabs_for_pane(&next_tabs, &closed_pane);
    let next_pane_active = if closed_index > 0 {
        next_pane_tabs.get((closed_index - 1).min(next_pane_tabs.len().saturating_sub(1))).cloned()
    } else {
        next_pane_tabs.first().cloned()
    };
    let target_pane = if closing_active { closed_pane.clone() } else { normalized.active_pane_id.clone() };
    let target_tab = if closing_active {
        next_pane_active
    } else {
        normalized.pane_state.get(&normalized.active_pane_id).and_then(|p| p.active_tab_id.clone())
    };
    let next_split = normalized.activate_pane(&target_pane, target_tab.clone());
    TabClose {
        closed_pane_id: closed_pane,
        next_focused_tab_id: if closing_active { target_tab } else { active_tab_id.map(str::to_string) },
        next_split_view: next_split,
        next_tab_ids: next_tabs,
    }
}

/// resolvePaneCloseState (lib/studio/pane-close.ts): (remaining tab ids, removed, next split, next active)
pub fn resolve_pane_close(
    open_tab_ids: &[String],
    split: &SplitViewState,
    pane_id: &str,
) -> (Vec<String>, Vec<String>, SplitViewState, Option<String>) {
    let (removed, remaining): (Vec<String>, Vec<String>) =
        open_tab_ids.iter().cloned().partition(|t| split.pane_for_tab(t) == pane_id);
    let next = split.close_pane(pane_id, &remaining).normalize(&remaining, None);
    let active = next.pane_state.get(&next.active_pane_id).and_then(|p| p.active_tab_id.clone());
    (remaining, removed, next, active)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parses_old_app_json() {
        let json = r#"{"enabled":false,"root":{"type":"pane","id":"pane-1"},"activePaneId":"pane-1","paneState":{"pane-1":{"activeTabId":"advisor"}},"tabPaneMap":{"sql-new-yj39cl2":"pane-1","advisor":"pane-1"},"nextPaneNumber":2,"nextSplitNumber":1}"#;
        let s: SplitViewState = serde_json::from_str(json).unwrap();
        assert_eq!(s.pane_for_tab("advisor"), "pane-1");
        let back = serde_json::to_string(&s).unwrap();
        assert!(back.contains("\"activePaneId\":\"pane-1\""));
    }

    #[test]
    fn split_then_close() {
        let s = SplitViewState::new(Some("a".into()));
        let s = s.split_pane("pane-1", SplitDirection::Vertical, false);
        assert!(s.enabled);
        assert_eq!(s.active_pane_id, "pane-2");
        let s = s.assign_tab("b", "pane-2", true);
        let tabs = ids(&["a", "b"]);
        let s = s.normalize(&tabs, None);
        assert_eq!(s.tabs_for_pane(&tabs, "pane-2"), ids(&["b"]));
        let (remaining, removed, next, active) = resolve_pane_close(&tabs, &s, "pane-2");
        assert_eq!(remaining, ids(&["a"]));
        assert_eq!(removed, ids(&["b"]));
        assert!(!next.enabled);
        assert_eq!(active.as_deref(), Some("a"));
    }

    #[test]
    fn closing_active_tab_focuses_left_neighbour() {
        let tabs = ids(&["a", "b", "c"]);
        let s = SplitViewState::new(Some("b".into())).normalize(&tabs, Some("b"));
        let r = resolve_tab_close(Some("b"), "b", &tabs, &s);
        assert_eq!(r.next_focused_tab_id.as_deref(), Some("a"));
        let r = resolve_tab_close(Some("a"), "a", &tabs, &s);
        assert_eq!(r.next_focused_tab_id.as_deref(), Some("b"));
        let r = resolve_tab_close(Some("a"), "c", &tabs, &s);
        assert_eq!(r.next_focused_tab_id.as_deref(), Some("a"));
    }

    #[test]
    fn pane_suffix_inference() {
        let s = SplitViewState::new(None).split_pane("pane-1", SplitDirection::Vertical, false);
        assert_eq!(s.pane_for_tab("sql-new-x::pane::pane-2"), "pane-2");
        assert_eq!(base_tab_id("table-a-b::pane::pane-2"), "table-a-b");
    }
}
