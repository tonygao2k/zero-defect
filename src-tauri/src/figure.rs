use crate::{
    ai::{numeric, str_value},
    db::text,
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
fn array<'a>(v: &'a Value, k: &str) -> Option<&'a Vec<Value>> {
    v.get(k)?.as_array()
}
fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|n| n.is_finite())
}
fn small_text(v: &Value, max: usize) -> Option<String> {
    let s = str_value(v);
    if s.is_empty() || s.chars().count() > max {
        None
    } else {
        Some(s)
    }
}
pub fn fold(cells: &[Value]) -> Option<Vec<usize>> {
    if cells.len() != 6 {
        return None;
    }
    let mut at = HashMap::new();
    for (index, c) in cells.iter().enumerate() {
        let row = c["row"].as_i64()?;
        let col = c["col"].as_i64()?;
        if at.insert((row, col), index).is_some() {
            return None;
        }
    }
    for &(r, c) in at.keys() {
        if at.contains_key(&(r + 1, c))
            && at.contains_key(&(r, c + 1))
            && at.contains_key(&(r + 1, c + 1))
        {
            return None;
        }
    }
    let mut states: Vec<Option<[usize; 6]>> = vec![None; 6];
    states[0] = Some([0, 1, 2, 3, 4, 5]);
    let mut todo = vec![0];
    while let Some(index) = todo.pop() {
        let row = cells[index]["row"].as_i64()?;
        let col = cells[index]["col"].as_i64()?;
        let state = states[index]?;
        for (dr, dc, roll) in [
            (0, 1, [4, 5, 2, 3, 1, 0]),
            (0, -1, [5, 4, 2, 3, 0, 1]),
            (1, 0, [3, 2, 0, 1, 4, 5]),
            (-1, 0, [2, 3, 1, 0, 4, 5]),
        ] {
            if let Some(&next) = at.get(&(row + dr, col + dc)) {
                let rolled = roll.map(|n| state[n]);
                if let Some(old) = states[next] {
                    if old != rolled {
                        return None;
                    }
                } else {
                    states[next] = Some(rolled);
                    todo.push(next);
                }
            }
        }
    }
    let faces = states
        .into_iter()
        .map(|s| s.map(|s| s[0]))
        .collect::<Option<Vec<_>>>()?;
    if faces.iter().collect::<HashSet<_>>().len() != 6 {
        None
    } else {
        Some(faces)
    }
}
pub fn validate(raw: &Value) -> Option<Value> {
    if raw.is_null() || raw == "" {
        return Some(Value::Null);
    }
    match text(raw, "type") {
        "cube_net" => {
            let mut cells = Vec::new();
            for c in array(raw, "cells")? {
                let row = number(&c["row"])?;
                let col = number(&c["col"])?;
                if row.fract() != 0.0
                    || col.fract() != 0.0
                    || !(0.0..=9.0).contains(&row)
                    || !(0.0..=9.0).contains(&col)
                {
                    return None;
                }
                cells.push(
                    json!({"row":row as i64,"col":col as i64,"text":small_text(&c["text"],4)?}),
                );
            }
            if cells
                .iter()
                .map(|c| text(c, "text"))
                .collect::<HashSet<_>>()
                .len()
                != 6
            {
                return None;
            }
            fold(&cells)?;
            Some(json!({"type":"cube_net","cells":cells}))
        }
        "number_line" => {
            let min = number(&raw["min"])?;
            let max = number(&raw["max"])?;
            let step = number(&raw["step"])?;
            if max <= min || step <= 0.0 || (max - min) / step > 20.0 {
                return None;
            }
            let mut marks = Vec::new();
            for m in array(raw, "marks")? {
                let value = number(&m["value"])?;
                if value < min || value > max {
                    return None;
                }
                marks.push(json!({"value":value,"label":small_text(&m["label"],4)?}));
            }
            if marks.is_empty()
                || marks.len() > 6
                || marks
                    .iter()
                    .map(|m| text(m, "label"))
                    .collect::<HashSet<_>>()
                    .len()
                    != marks.len()
            {
                return None;
            }
            Some(json!({"type":"number_line","min":min,"max":max,"step":step,"marks":marks}))
        }
        "bar_chart" => {
            let mut bars = Vec::new();
            for b in array(raw, "bars")? {
                let value = number(&b["value"])?;
                if value < 0.0 {
                    return None;
                }
                bars.push(json!({"value":value,"label":small_text(&b["label"],6)?}));
            }
            if bars.len() < 2
                || bars.len() > 8
                || bars.iter().all(|b| numeric(&b["value"]) == 0.0)
                || bars
                    .iter()
                    .map(|b| text(b, "label"))
                    .collect::<HashSet<_>>()
                    .len()
                    != bars.len()
            {
                return None;
            }
            let unit = str_value(&raw["unit"]);
            if unit.chars().count() > 6 {
                return None;
            }
            Some(json!({"type":"bar_chart","unit":unit,"bars":bars}))
        }
        "cube_stack" => {
            let rows = array(raw, "heights")?;
            if rows.is_empty() || rows.len() > 4 {
                return None;
            }
            let cols = rows[0].as_array()?.len();
            if cols == 0 || cols > 4 {
                return None;
            }
            let mut heights = Vec::new();
            let mut filled = HashSet::new();
            let mut total = 0;
            for (r, row) in rows.iter().enumerate() {
                let row = row.as_array()?;
                if row.len() != cols {
                    return None;
                }
                let mut out = Vec::new();
                for (c, h) in row.iter().enumerate() {
                    let n = number(h)?;
                    if n.fract() != 0.0 || !(0.0..=4.0).contains(&n) {
                        return None;
                    }
                    out.push(n as i64);
                    total += n as i64;
                    if n > 0.0 {
                        filled.insert((r as i64, c as i64));
                    }
                }
                heights.push(out);
            }
            if !(2..=12).contains(&total)
                || ![
                    heights[0].iter().any(|h| *h > 0),
                    heights.last()?.iter().any(|h| *h > 0),
                    heights.iter().any(|r| r[0] > 0),
                    heights.iter().any(|r| r[cols - 1] > 0),
                ]
                .iter()
                .all(|b| *b)
            {
                return None;
            }
            let first = *filled.iter().next()?;
            let mut seen = HashSet::from([first]);
            let mut todo = vec![first];
            while let Some((r, c)) = todo.pop() {
                for (dr, dc) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    let next = (r + dr, c + dc);
                    if filled.contains(&next) && seen.insert(next) {
                        todo.push(next);
                    }
                }
            }
            if seen.len() != filled.len() {
                return None;
            }
            Some(json!({"type":"cube_stack","heights":heights}))
        }
        _ => None,
    }
}
pub fn stack_count(figure: &Value, view: &str) -> Option<i64> {
    let rows = array(figure, "heights")?;
    let rows = rows
        .iter()
        .map(|r| r.as_array())
        .collect::<Option<Vec<_>>>()?;
    match view {
        "front" | "back" => Some(
            (0..rows.first()?.len())
                .map(|c| {
                    rows.iter()
                        .map(|r| r[c].as_i64().unwrap_or(0))
                        .max()
                        .unwrap_or(0)
                })
                .sum(),
        ),
        "left" | "right" => Some(
            rows.iter()
                .map(|r| r.iter().filter_map(Value::as_i64).max().unwrap_or(0))
                .sum(),
        ),
        "top" => Some(
            rows.iter()
                .map(|r| r.iter().filter(|h| h.as_i64().unwrap_or(0) > 0).count() as i64)
                .sum(),
        ),
        _ => None,
    }
}
pub fn opposite(figure: &Value, label: &str) -> Option<String> {
    let cells = array(figure, "cells")?;
    let faces = fold(cells)?;
    let index = cells.iter().position(|c| text(c, "text") == label)?;
    let opposite = faces[index] ^ 1;
    let other = faces.iter().position(|n| *n == opposite)?;
    Some(text(&cells[other], "text").to_owned())
}
pub fn infer(question: &str) -> &'static str {
    let q = question.replace(['*', '_', '$', '\\', ' '], "");
    if q.contains("展开图") {
        "cube_net"
    } else if q.contains("数轴") {
        "number_line"
    } else if q.contains("统计图") || q.contains("条形图") {
        "bar_chart"
    } else if regex::Regex::new(
        r"从[前后左右上正侧][^，。]{0,16}看.{0,8}(立体图形|正方体|小正方体)",
    )
    .unwrap()
    .is_match(&q)
    {
        "cube_stack"
    } else if regex::Regex::new(r"[上下左右如见]图|看图|图中|图示")
        .unwrap()
        .is_match(&q)
    {
        "other"
    } else {
        "none"
    }
}
