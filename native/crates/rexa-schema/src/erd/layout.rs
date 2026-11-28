//! Layout for the schema diagram: a port of the original's use of dagre
//! (`getLayoutedElementsViaDagre`: rankdir LR, align UR, nodesep 25, ranksep 50,
//! 24px node padding) and `getLayoutedElementsViaGrid` (dagre ranks become
//! columns 400px apart, rows sorted by dagre y, 120px row gap).
//!
//! dagre itself is approximated: cycles are broken by DFS, ranks come from
//! longest-path ranking (dagre runs network simplex on top), the order inside a
//! rank from barycenter sweeps, and y positions from stacking each rank and
//! nudging nodes toward their neighbours' barycenter without overlap (dagre uses
//! Brandes-Köpf). Disconnected tables keep dagre's behaviour of sitting in rank 0.

use std::collections::{HashMap, HashSet};

pub const NODE_WIDTH: f32 = 160.;
pub const ROW_HEIGHT: f32 = 22.;
pub const HEADER_HEIGHT: f32 = 22.;
const NODE_SEP: f32 = 25.;
const RANK_SEP: f32 = 50.;

#[derive(Clone, Debug, PartialEq)]
pub struct LayoutNode {
    pub id: String,
    pub height: f32,
}

/// `estimateTableHeight`.
pub fn estimate_height(columns: usize) -> f32 {
    HEADER_HEIGHT + columns as f32 * ROW_HEIGHT + 1.
}

struct Ranked {
    rank: HashMap<String, usize>,
    order: Vec<Vec<String>>,
    y: HashMap<String, f32>,
}

fn rank_and_order(nodes: &[LayoutNode], edges: &[(String, String)], pad: f32) -> Ranked {
    let ids: Vec<String> = nodes.iter().map(|n| n.id.clone()).collect();
    let idset: HashSet<&String> = ids.iter().collect();
    let mut edges: Vec<(String, String)> = edges.iter().filter(|(a, b)| a != b && idset.contains(a) && idset.contains(b)).cloned().collect();
    edges.sort();
    edges.dedup();
    // Acyclic: DFS, reverse back edges.
    let mut out: HashMap<&str, Vec<&str>> = HashMap::new();
    for (a, b) in &edges {
        out.entry(a.as_str()).or_default().push(b.as_str());
    }
    let mut state: HashMap<&str, u8> = HashMap::new();
    let mut back: HashSet<(String, String)> = HashSet::new();
    fn dfs<'a>(v: &'a str, out: &HashMap<&'a str, Vec<&'a str>>, state: &mut HashMap<&'a str, u8>, back: &mut HashSet<(String, String)>) {
        state.insert(v, 1);
        if let Some(ns) = out.get(v) {
            for &w in ns {
                match state.get(w).copied().unwrap_or(0) {
                    0 => dfs(w, out, state, back),
                    1 => {
                        back.insert((v.to_string(), w.to_string()));
                    }
                    _ => {}
                }
            }
        }
        state.insert(v, 2);
    }
    for id in &ids {
        if state.get(id.as_str()).copied().unwrap_or(0) == 0 {
            dfs(id, &out, &mut state, &mut back);
        }
    }
    let dag: Vec<(String, String)> = edges.iter().map(|(a, b)| if back.contains(&(a.clone(), b.clone())) { (b.clone(), a.clone()) } else { (a.clone(), b.clone()) }).collect();

    // Longest path from sinks (dagre's initial ranker), then normalize.
    let mut succ: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut pred: HashMap<&str, Vec<&str>> = HashMap::new();
    for (a, b) in &dag {
        succ.entry(a).or_default().push(b);
        pred.entry(b).or_default().push(a);
    }
    let mut rank_i: HashMap<String, i64> = HashMap::new();
    fn lp<'a>(v: &'a str, succ: &HashMap<&'a str, Vec<&'a str>>, memo: &mut HashMap<String, i64>) -> i64 {
        if let Some(r) = memo.get(v) {
            return *r;
        }
        let r = match succ.get(v) {
            Some(ws) if !ws.is_empty() => ws.iter().map(|w| lp(w, succ, memo) - 1).min().unwrap_or(0),
            _ => 0,
        };
        memo.insert(v.to_string(), r);
        r
    }
    for id in &ids {
        lp(id, &succ, &mut rank_i);
    }
    // Pull sources toward their successors (a cheap network-simplex tightening):
    // nodes without predecessors sit one rank before their nearest successor.
    for id in &ids {
        if pred.get(id.as_str()).map_or(true, |p| p.is_empty()) {
            if let Some(ws) = succ.get(id.as_str()) {
                if let Some(m) = ws.iter().map(|w| rank_i[*w] - 1).min() {
                    rank_i.insert(id.clone(), m);
                }
            }
        }
    }
    let min = rank_i.values().copied().min().unwrap_or(0);
    let rank: HashMap<String, usize> = rank_i.into_iter().map(|(k, v)| (k, (v - min) as usize)).collect();
    let max_rank = rank.values().copied().max().unwrap_or(0);
    let mut order: Vec<Vec<String>> = vec![Vec::new(); max_rank + 1];
    for id in &ids {
        order[rank[id]].push(id.clone());
    }
    // Barycenter sweeps on the undirected neighbour sets.
    let mut nb: HashMap<&str, Vec<&str>> = HashMap::new();
    for (a, b) in &dag {
        nb.entry(a).or_default().push(b);
        nb.entry(b).or_default().push(a);
    }
    for sweep in 0..8 {
        let ranks: Vec<usize> = if sweep % 2 == 0 { (1..order.len()).collect() } else { (0..order.len().saturating_sub(1)).rev().collect() };
        for r in ranks {
            let adj = if sweep % 2 == 0 { r - 1 } else { r + 1 };
            let pos: HashMap<&str, usize> = order[adj].iter().enumerate().map(|(i, s)| (s.as_str(), i)).collect();
            let cur = order[r].clone();
            let mut keyed: Vec<(f32, usize, String)> = cur
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let ps: Vec<usize> = nb.get(v.as_str()).map(|n| n.iter().filter_map(|w| pos.get(w).copied()).collect()).unwrap_or_default();
                    let bc = if ps.is_empty() { i as f32 } else { ps.iter().sum::<usize>() as f32 / ps.len() as f32 };
                    (bc, i, v.clone())
                })
                .collect();
            keyed.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.cmp(&b.1)));
            order[r] = keyed.into_iter().map(|k| k.2).collect();
        }
    }
    // y: stack each rank, then relax toward neighbour centers (no overlap).
    let h: HashMap<&str, f32> = nodes.iter().map(|n| (n.id.as_str(), n.height + pad)).collect();
    let mut y: HashMap<String, f32> = HashMap::new();
    for col in &order {
        let mut acc = 0.;
        for v in col {
            let hv = h[v.as_str()];
            y.insert(v.clone(), acc + hv / 2.);
            acc += hv + NODE_SEP;
        }
    }
    for _ in 0..4 {
        for col in &order {
            let mut prev_bottom = f32::NEG_INFINITY;
            for v in col {
                let hv = h[v.as_str()];
                let ys: Vec<f32> = nb.get(v.as_str()).map(|n| n.iter().filter_map(|w| y.get(*w).copied()).collect()).unwrap_or_default();
                let mut target = if ys.is_empty() { y[v] } else { ys.iter().sum::<f32>() / ys.len() as f32 };
                if target - hv / 2. < prev_bottom + NODE_SEP {
                    target = prev_bottom + NODE_SEP + hv / 2.;
                }
                y.insert(v.clone(), target);
                prev_bottom = target + hv / 2.;
            }
        }
    }
    Ranked { rank, order, y }
}

/// `getLayoutedElementsViaDagre`: top-left positions keyed by table name.
pub fn dagre(nodes: &[LayoutNode], edges: &[(String, String)]) -> HashMap<String, (f32, f32)> {
    let pad = 24.;
    let r = rank_and_order(nodes, edges, pad);
    let h: HashMap<&str, f32> = nodes.iter().map(|n| (n.id.as_str(), n.height + pad)).collect();
    let w = NODE_WIDTH + pad;
    let mut out = HashMap::new();
    let (mut min_x, mut min_y) = (f32::INFINITY, f32::INFINITY);
    for (ri, col) in r.order.iter().enumerate() {
        let cx = ri as f32 * (w + RANK_SEP) + w / 2.;
        for v in col {
            let (x, y) = (cx - w / 2., r.y[v] - h[v.as_str()] / 2.);
            min_x = min_x.min(x);
            min_y = min_y.min(y);
            out.insert(v.clone(), (x, y));
        }
    }
    let (ox, oy) = (if min_x.is_finite() { (-min_x).max(0.) } else { 0. }, if min_y.is_finite() { (-min_y).max(0.) } else { 0. });
    for p in out.values_mut() {
        p.0 += ox;
        p.1 += oy;
    }
    out
}

/// `getLayoutedElementsViaGrid`.
pub fn grid(nodes: &[LayoutNode], edges: &[(String, String)]) -> HashMap<String, (f32, f32)> {
    const COL_SEP: f32 = 240.;
    const ROW_SEP: f32 = 120.;
    let r = rank_and_order(nodes, edges, 0.);
    let h: HashMap<&str, f32> = nodes.iter().map(|n| (n.id.as_str(), n.height)).collect();
    let mut cols = r.order.clone();
    for c in cols.iter_mut() {
        c.sort_by(|a, b| r.y[a].partial_cmp(&r.y[b]).unwrap_or(std::cmp::Ordering::Equal));
    }
    let mut row_h: Vec<f32> = Vec::new();
    for c in &cols {
        for (i, v) in c.iter().enumerate() {
            if row_h.len() <= i {
                row_h.push(0.);
            }
            row_h[i] = row_h[i].max(h[v.as_str()]);
        }
    }
    let mut off = vec![0.; row_h.len()];
    for i in 1..row_h.len() {
        off[i] = off[i - 1] + row_h[i - 1] + ROW_SEP;
    }
    let _ = &r.rank;
    let mut out = HashMap::new();
    for (ci, c) in cols.iter().enumerate() {
        for (ri, v) in c.iter().enumerate() {
            out.insert(v.clone(), (ci as f32 * (NODE_WIDTH + COL_SEP), off[ri]));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn referencing_tables_sit_left_of_referenced() {
        let n = |id: &str| LayoutNode { id: id.into(), height: 60. };
        let nodes = vec![n("orders"), n("users"), n("items"), n("lonely")];
        let edges = vec![("orders".into(), "users".into()), ("items".into(), "orders".into()), ("users".into(), "users".into())];
        let p = dagre(&nodes, &edges);
        assert!(p["items"].0 < p["orders"].0 && p["orders"].0 < p["users"].0);
        let g = grid(&nodes, &edges);
        assert_eq!(g["items"].0, 0.);
        assert_eq!(g["users"].0, 2. * 400.);
    }
}
