//! 取引の中の編集を、プロジェクトの JSON（写し）に当てる（純粋＝ファイルに触らない・MV-0005 決定2・3）。
//!
//! ⚠️ ここでは**当てるだけ**。形と中身の検査は呼ぶ側（[`crate::Ops`]）が当てたあとに必ずする。
//! 既定を入れる・参照先を探すなど「意味の単位」の手伝いだけをし、正典の形を二重に決めない。

use mv_core::id::{new_id, IdKind};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

/// 当てられなかった操作。`index`＝`ops` の何番目か（0 から）。
#[derive(Debug, Clone, PartialEq)]
pub struct OpFailure {
    pub index: usize,
    pub message: String,
}

/// 取引の中の編集の名前（正典＝`mv-operations.json` の `applyTransaction` の `ops`）。⚠️ 一覧と食い違うと検査が落ちる。
pub const TX_OPS: &[&str] = &[
    "addLayer",
    "updateLayer",
    "removeLayer",
    "moveLayer",
    "addComposition",
    "updateComposition",
    "removeComposition",
    "updateProject",
];

/// 新しく発行した ID（何番目の操作が、何を作ったか）。
#[derive(Debug, Clone, PartialEq)]
pub struct Created {
    pub index: usize,
    pub kind: &'static str,
    pub id: String,
}

/// `ops` を順に当てる。1つでも当てられなければ、そこで止めて理由を返す（写しは捨てる前提）。
pub fn apply_ops(doc: &mut Value, ops: &[Value]) -> Result<Vec<Created>, OpFailure> {
    let mut created = Vec::new();
    for (index, op) in ops.iter().enumerate() {
        let fail = |message: String| OpFailure { index, message };
        let name = op.get("op").and_then(Value::as_str).unwrap_or("");
        match name {
            "addLayer" => {
                let comp_id = comp_id_or_main(doc, op.get("compositionId"));
                let ci = find_comp(doc, &comp_id).ok_or_else(|| {
                    fail(format!(
                        "コンポジション {comp_id} が見つかりません。inspect で ID を確かめてください。"
                    ))
                })?;
                let Some(Value::Object(src)) = op.get("layer") else {
                    return Err(fail(
                        "layer にレイヤーの中身（オブジェクト）を書いてください。".into(),
                    ));
                };
                let mut layer = src.clone();
                let comp = &doc["compositions"][ci];
                fill_layer_defaults(&mut layer, comp);
                let id = layer["id"].as_str().unwrap_or_default().to_string();
                let layers = comp_layers_mut(doc, ci);
                let at = op
                    .get("index")
                    .and_then(Value::as_u64)
                    .map(|i| i as usize)
                    .unwrap_or(0)
                    .min(layers.len());
                layers.insert(at, Value::Object(layer));
                created.push(Created {
                    index,
                    kind: "layer",
                    id,
                });
            }
            "updateLayer" => {
                let id = str_arg(op, "layerId");
                let (ci, li) = find_layer(doc, id).ok_or_else(|| fail(layer_missing(id)))?;
                let patch = op.get("patch").cloned().unwrap_or(Value::Null);
                forbid_keys(&patch, &["id"], "レイヤーの ID は変えられません。").map_err(&fail)?;
                merge_patch(&mut doc["compositions"][ci]["layers"][li], &patch);
            }
            "removeLayer" => {
                let id = str_arg(op, "layerId");
                let (ci, li) = find_layer(doc, id).ok_or_else(|| fail(layer_missing(id)))?;
                comp_layers_mut(doc, ci).remove(li);
            }
            "moveLayer" => {
                let id = str_arg(op, "layerId");
                let (ci, li) = find_layer(doc, id).ok_or_else(|| fail(layer_missing(id)))?;
                let layers = comp_layers_mut(doc, ci);
                let l = layers.remove(li);
                let at = op
                    .get("index")
                    .and_then(Value::as_u64)
                    .map(|i| i as usize)
                    .unwrap_or(0)
                    .min(layers.len());
                layers.insert(at, l);
            }
            "addComposition" => {
                let Some(Value::Object(src)) = op.get("composition") else {
                    return Err(fail(
                        "composition にコンポジションの中身（オブジェクト）を書いてください。"
                            .into(),
                    ));
                };
                let mut c = src.clone();
                forbid_keys(
                    &Value::Object(c.clone()),
                    &["layers"],
                    "レイヤーは addLayer で足してください（addComposition の layers は使えません）。",
                )
                .map_err(&fail)?;
                c.entry("id")
                    .or_insert_with(|| json!(new_id(IdKind::Composition)));
                c.entry("background").or_insert_with(|| json!([0, 0, 0, 1]));
                c.entry("markers").or_insert_with(|| json!([]));
                c.insert("layers".into(), json!([]));
                let id = c["id"].as_str().unwrap_or_default().to_string();
                compositions_mut(doc).push(Value::Object(c));
                created.push(Created {
                    index,
                    kind: "composition",
                    id,
                });
            }
            "updateComposition" => {
                let id = str_arg(op, "compositionId");
                let ci = find_comp(doc, id).ok_or_else(|| fail(comp_missing(id)))?;
                let patch = op.get("patch").cloned().unwrap_or(Value::Null);
                forbid_keys(
                    &patch,
                    &["id", "layers"],
                    "コンポジションの ID と layers は updateComposition では変えられません（レイヤーはレイヤーの操作で）。",
                )
                .map_err(&fail)?;
                merge_patch(&mut doc["compositions"][ci], &patch);
            }
            "removeComposition" => {
                let id = str_arg(op, "compositionId");
                let ci = find_comp(doc, id).ok_or_else(|| fail(comp_missing(id)))?;
                if doc["mainCompositionId"].as_str() == Some(id) {
                    return Err(fail(
                        "書き出しの既定のコンポジションは外せません。先に updateProject で mainCompositionId を別のものにしてください。".into(),
                    ));
                }
                compositions_mut(doc).remove(ci);
            }
            "updateProject" => {
                let patch = op.get("patch").cloned().unwrap_or(Value::Null);
                if let Value::Object(m) = &patch {
                    if let Some(k) = m
                        .keys()
                        .find(|k| !["name", "settings", "mainCompositionId"].contains(&k.as_str()))
                    {
                        return Err(fail(format!(
                            "updateProject で変えられるのは name・settings・mainCompositionId だけです（{k} は変えられません）。"
                        )));
                    }
                }
                merge_patch(doc, &patch);
            }
            other => {
                return Err(fail(format!(
                    "「{other}」という編集はありません（使えるのは {}）。",
                    TX_OPS.join("・")
                )))
            }
        }
    }
    Ok(created)
}

/// JSON Merge Patch（RFC 7386）。
pub fn merge_patch(target: &mut Value, patch: &Value) {
    let Value::Object(p) = patch else {
        *target = patch.clone();
        return;
    };
    if !target.is_object() {
        *target = Value::Object(Map::new());
    }
    let t = target.as_object_mut().expect("直前でオブジェクトにした");
    for (k, v) in p {
        if v.is_null() {
            t.remove(k);
        } else {
            merge_patch(t.entry(k.clone()).or_insert(Value::Null), v);
        }
    }
}

/// 新しいレイヤーに、書かれなかった項目の既定を入れる（AE が新しいレイヤーに入れる値に合わせる＝MV-0005 決定2）。
pub fn fill_layer_defaults(layer: &mut Map<String, Value>, comp: &Value) {
    let w = comp["width"].as_f64().unwrap_or(0.0);
    let h = comp["height"].as_f64().unwrap_or(0.0);
    let dur = comp["durationFrames"].as_i64().unwrap_or(0);
    layer
        .entry("id")
        .or_insert_with(|| json!(new_id(IdKind::Layer)));
    for (k, v) in [
        ("enabled", json!(true)),
        ("locked", json!(false)),
        ("inFrame", json!(0)),
        ("outFrame", json!(dur)),
        ("startFrame", json!(0)),
        ("parentId", Value::Null),
        ("blendMode", json!("normal")),
        ("trackMatte", Value::Null),
        ("masks", json!([])),
        ("effects", json!([])),
        ("markers", json!([])),
    ] {
        layer.entry(k).or_insert(v);
    }
    // 単色の大きさ＝書かなければコンポジションと同じ
    if layer.get("type").and_then(Value::as_str) == Some("solid") {
        if let Some(Value::Object(s)) = layer.get_mut("solid") {
            s.entry("width").or_insert(json!(w as u64));
            s.entry("height").or_insert(json!(h as u64));
        }
    }
    let anchor = match layer.get("type").and_then(Value::as_str) {
        Some("solid") => {
            let s = &layer["solid"];
            [
                s["width"].as_f64().unwrap_or(w) / 2.0,
                s["height"].as_f64().unwrap_or(h) / 2.0,
            ]
        }
        _ => [0.0, 0.0],
    };
    let t = layer
        .entry("transform")
        .or_insert_with(|| Value::Object(Map::new()));
    if let Value::Object(t) = t {
        for (k, v) in [
            ("anchor", json!({ "value": anchor })),
            ("position", json!({ "value": [w / 2.0, h / 2.0] })),
            ("scale", json!({ "value": [1, 1] })),
            ("rotation", json!({ "value": 0 })),
            ("opacity", json!({ "value": 1 })),
        ] {
            t.entry(k).or_insert(v);
        }
    }
}

/// 2つのプロジェクトの JSON の差（足した・消した・変わった ID）。
pub fn diff(before: &Value, after: &Value) -> Value {
    let comps = |d: &Value| -> BTreeMap<String, Value> {
        d["compositions"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|c| {
                let mut c = c.clone();
                // コンポジションの「変わった」＝レイヤー以外の項目か、レイヤーの並び
                let order: Vec<Value> = c["layers"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|l| l["id"].clone())
                    .collect();
                c["layers"] = Value::Array(order);
                (c["id"].as_str().unwrap_or_default().to_string(), c)
            })
            .collect()
    };
    let layers = |d: &Value| -> BTreeMap<String, Value> {
        let mut m = BTreeMap::new();
        for c in d["compositions"].as_array().into_iter().flatten() {
            for l in c["layers"].as_array().into_iter().flatten() {
                let mut l = l.clone();
                l["$composition"] = c["id"].clone();
                m.insert(l["id"].as_str().unwrap_or_default().to_string(), l);
            }
        }
        m
    };
    let project_changed = ["name", "settings", "mainCompositionId"]
        .iter()
        .any(|k| before[k] != after[k]);
    json!({
        "project": project_changed,
        "compositions": id_diff(&comps(before), &comps(after)),
        "layers": id_diff(&layers(before), &layers(after)),
    })
}

fn id_diff(a: &BTreeMap<String, Value>, b: &BTreeMap<String, Value>) -> Value {
    let ka: BTreeSet<&String> = a.keys().collect();
    let kb: BTreeSet<&String> = b.keys().collect();
    json!({
        "added": kb.difference(&ka).collect::<Vec<_>>(),
        "removed": ka.difference(&kb).collect::<Vec<_>>(),
        "changed": ka.intersection(&kb).filter(|k| a[**k] != b[**k]).collect::<Vec<_>>(),
    })
}

fn str_arg<'a>(op: &'a Value, key: &str) -> &'a str {
    op.get(key).and_then(Value::as_str).unwrap_or("")
}

fn layer_missing(id: &str) -> String {
    format!("レイヤー {id} が見つかりません。inspect で ID を確かめてください。")
}

fn comp_missing(id: &str) -> String {
    format!("コンポジション {id} が見つかりません。inspect で ID を確かめてください。")
}

fn forbid_keys(patch: &Value, keys: &[&str], message: &str) -> Result<(), String> {
    match patch {
        Value::Object(m) if keys.iter().any(|k| m.contains_key(*k)) => Err(message.into()),
        Value::Object(_) => Ok(()),
        _ => Err("patch にはオブジェクトを書いてください（JSON Merge Patch）。".into()),
    }
}

fn comp_id_or_main(doc: &Value, given: Option<&Value>) -> String {
    given
        .and_then(Value::as_str)
        .or_else(|| doc["mainCompositionId"].as_str())
        .unwrap_or_default()
        .to_string()
}

fn find_comp(doc: &Value, id: &str) -> Option<usize> {
    doc["compositions"]
        .as_array()?
        .iter()
        .position(|c| c["id"].as_str() == Some(id))
}

fn find_layer(doc: &Value, id: &str) -> Option<(usize, usize)> {
    for (ci, c) in doc["compositions"].as_array()?.iter().enumerate() {
        if let Some(li) = c["layers"]
            .as_array()
            .and_then(|ls| ls.iter().position(|l| l["id"].as_str() == Some(id)))
        {
            return Some((ci, li));
        }
    }
    None
}

fn compositions_mut(doc: &mut Value) -> &mut Vec<Value> {
    if !doc["compositions"].is_array() {
        doc["compositions"] = json!([]);
    }
    doc["compositions"]
        .as_array_mut()
        .expect("直前で配列にした")
}

fn comp_layers_mut(doc: &mut Value, ci: usize) -> &mut Vec<Value> {
    let c = &mut doc["compositions"][ci];
    if !c["layers"].is_array() {
        c["layers"] = json!([]);
    }
    c["layers"].as_array_mut().expect("直前で配列にした")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_patch_は_rfc7386_どおり() {
        let mut t = json!({"a": 1, "b": {"c": 2, "d": 3}, "e": [1, 2]});
        merge_patch(
            &mut t,
            &json!({"a": null, "b": {"c": 9}, "e": [3], "f": {"g": 1}}),
        );
        assert_eq!(t, json!({"b": {"c": 9, "d": 3}, "e": [3], "f": {"g": 1}}));
        // オブジェクトでない所へオブジェクトを当てると、置き換えてから当てる
        let mut t = json!({"a": 1});
        merge_patch(&mut t, &json!({"a": {"b": null, "c": 1}}));
        assert_eq!(t, json!({"a": {"c": 1}}));
    }

    #[test]
    fn 既定は書かれていない項目にだけ入る() {
        let comp = json!({"width": 1280, "height": 720, "durationFrames": 60});
        let mut l =
            json!({"name": "x", "type": "solid", "solid": {"color": [1,0,0,1]}, "locked": true,
            "transform": {"opacity": {"value": 0.5}}})
            .as_object()
            .unwrap()
            .clone();
        fill_layer_defaults(&mut l, &comp);
        assert_eq!(l["locked"], json!(true), "書いた値は残す");
        assert_eq!(l["enabled"], json!(true));
        assert_eq!(l["outFrame"], json!(60));
        assert_eq!(l["solid"]["width"], json!(1280));
        assert_eq!(l["solid"]["height"], json!(720));
        assert_eq!(l["transform"]["anchor"], json!({"value": [640.0, 360.0]}));
        assert_eq!(l["transform"]["position"], json!({"value": [640.0, 360.0]}));
        assert_eq!(l["transform"]["opacity"], json!({"value": 0.5}));
        assert!(mv_core::id::is_valid_id(
            IdKind::Layer,
            l["id"].as_str().unwrap()
        ));
        // 文字のアンカーは (0,0)
        let mut t = json!({"name": "t", "type": "text"})
            .as_object()
            .unwrap()
            .clone();
        fill_layer_defaults(&mut t, &comp);
        assert_eq!(t["transform"]["anchor"], json!({"value": [0.0, 0.0]}));
    }
}
