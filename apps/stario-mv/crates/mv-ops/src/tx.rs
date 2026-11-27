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
    "splitLayer",
    "addComposition",
    "updateComposition",
    "removeComposition",
    "updateProject",
    "importAsset",
    "removeAsset",
];

/// 取り込みの下ごしらえ（[`crate::import`]）が `importAsset` に書き足す、素材の記録の鍵。
/// ⚠️ ここ（純粋）ではファイルを調べない・写さない＝調べた結果だけを受け取る。
pub const RESOLVED_ASSET: &str = "$asset";

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
                let asset = layer
                    .get("assetId")
                    .and_then(Value::as_str)
                    .and_then(|aid| {
                        doc["assets"]
                            .as_array()?
                            .iter()
                            .find(|a| a["id"].as_str() == Some(aid))
                            .cloned()
                    });
                let comp = &doc["compositions"][ci];
                fill_layer_defaults(&mut layer, comp, asset.as_ref());
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
            "splitLayer" => {
                // AE の「レイヤーを分割」（MV-0008 決定4）＝元は frame で終わり、写しが frame から始まって元の1つ上に置かれる
                let id = str_arg(op, "layerId");
                let (ci, li) = find_layer(doc, id).ok_or_else(|| fail(layer_missing(id)))?;
                let at = op.get("frame").and_then(Value::as_i64).unwrap_or(-1);
                let orig = &doc["compositions"][ci]["layers"][li];
                let (inf, outf) = (
                    orig["inFrame"].as_i64().unwrap_or(0),
                    orig["outFrame"].as_i64().unwrap_or(0),
                );
                if !(inf < at && at < outf) {
                    return Err(fail(format!(
                        "フレーム {at} はレイヤー {id} の見えている範囲（inFrame {inf}〜outFrame {outf}）の内側ではありません。分けるフレームは inFrame より後・outFrame より前にしてください。"
                    )));
                }
                let new_layer_id = match op.get("id").and_then(Value::as_str) {
                    Some(given) if mv_core::id::is_valid_id(IdKind::Layer, given) => given.to_string(),
                    Some(given) => {
                        return Err(fail(format!(
                            "id「{given}」はレイヤーの ID の形ではありません。newIds（kind: layer）で発行した ID を渡すか、id を省いてください。"
                        )))
                    }
                    None => new_id(IdKind::Layer),
                };
                let mut copy = orig.clone();
                copy["id"] = json!(new_layer_id);
                copy["inFrame"] = json!(at);
                doc["compositions"][ci]["layers"][li]["outFrame"] = json!(at);
                // 0＝最前面＝元の位置に入れると、元は1つ下（奥）へずれる＝写しが元の上
                comp_layers_mut(doc, ci).insert(li, copy);
                created.push(Created {
                    index,
                    kind: "layer",
                    id: new_layer_id,
                });
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
            "importAsset" => {
                let Some(Value::Object(a)) = op.get(RESOLVED_ASSET) else {
                    return Err(fail(
                        "素材を調べられていません（すたりおMV の不具合）。".into(),
                    ));
                };
                let id = a["id"].as_str().unwrap_or_default().to_string();
                assets_mut(doc).push(Value::Object(a.clone()));
                created.push(Created {
                    index,
                    kind: "asset",
                    id,
                });
            }
            "removeAsset" => {
                let id = str_arg(op, "assetId");
                let i = doc["assets"]
                    .as_array()
                    .and_then(|v| v.iter().position(|a| a["id"].as_str() == Some(id)))
                    .ok_or_else(|| {
                        fail(format!(
                            "素材 {id} が見つかりません。inspect で ID を確かめてください。"
                        ))
                    })?;
                assets_mut(doc).remove(i);
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
/// 素材を指すレイヤー（`asset`）は、種類を素材から決め、アンカーを素材の中心・長さを素材の長さにする（MV-0006 決定3）。
pub fn fill_layer_defaults(layer: &mut Map<String, Value>, comp: &Value, asset: Option<&Value>) {
    let w = comp["width"].as_f64().unwrap_or(0.0);
    let h = comp["height"].as_f64().unwrap_or(0.0);
    let comp_dur = comp["durationFrames"].as_i64().unwrap_or(0);
    // 始まり（書かれていれば、そこから＝素材をタイムラインの途中へ置く・MV-0008 決定4）
    let start = layer.get("inFrame").and_then(Value::as_i64).unwrap_or(0);
    // 長さ（素材の長さ・無ければコンポジションの終わりまで）
    let mut len: Option<i64> = None;
    let mut asset_center = None;
    if let Some(a) = asset {
        let kind = a["kind"].as_str().unwrap_or_default();
        let ty = match kind {
            "video" | "imageSequence" => "video",
            "audio" => "audio",
            _ => "image",
        };
        layer.entry("type").or_insert(json!(ty));
        let m = &a["meta"];
        if let (Some(aw), Some(ah)) = (m["width"].as_f64(), m["height"].as_f64()) {
            asset_center = Some([aw / 2.0, ah / 2.0]);
        }
        // 素材の長さ（秒）→ コンポジションのコマ数（コンポジションより長ければそこまで）
        let comp_fps =
            comp["fps"]["num"].as_f64().unwrap_or(0.0) / comp["fps"]["den"].as_f64().unwrap_or(1.0);
        let fps_of =
            |f: &Value| f["num"].as_f64().unwrap_or(0.0) / f["den"].as_f64().unwrap_or(1.0);
        let secs = match kind {
            "imageSequence" => m["frameCount"]
                .as_f64()
                .zip(Some(fps_of(&m["fps"])).filter(|f| *f > 0.0))
                .map(|(n, f)| n / f),
            "video" | "audio" => m["durationSec"].as_f64(),
            _ => None,
        };
        if let Some(secs) = secs {
            len = Some((secs * comp_fps - 1e-6).ceil().max(1.0) as i64);
        }
    }
    layer
        .entry("id")
        .or_insert_with(|| json!(new_id(IdKind::Layer)));
    // 終わり＝始まり＋素材の長さ（コンポジションの終わりまで）。素材の長さが無ければコンポジションの終わり。
    // ⚠️ 終わりより後に始めたときは、素材の長さ（無ければ1コマ）だけ見せる＝空の範囲を作らない
    let out = match len {
        Some(n) if start + n <= comp_dur || start >= comp_dur => start + n,
        Some(_) => comp_dur,
        None if start < comp_dur => comp_dur,
        None => start + 1,
    };
    for (k, v) in [
        ("enabled", json!(true)),
        ("locked", json!(false)),
        ("inFrame", json!(start)),
        ("outFrame", json!(out)),
        ("startFrame", json!(start)),
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
        _ => asset_center.unwrap_or([0.0, 0.0]),
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
    let assets = |d: &Value| -> BTreeMap<String, Value> {
        d["assets"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|a| (a["id"].as_str().unwrap_or_default().to_string(), a.clone()))
            .collect()
    };
    json!({
        "project": project_changed,
        "assets": id_diff(&assets(before), &assets(after)),
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

fn assets_mut(doc: &mut Value) -> &mut Vec<Value> {
    if !doc["assets"].is_array() {
        doc["assets"] = json!([]);
    }
    doc["assets"].as_array_mut().expect("直前で配列にした")
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

    fn two_layers() -> Value {
        json!({"compositions": [{"id": "cmp_A", "layers": [
            {"id": "lyr_FRONT", "inFrame": 0, "outFrame": 100, "startFrame": 0},
            {"id": "lyr_X", "inFrame": 10, "outFrame": 50, "startFrame": 5, "name": "x",
             "transform": {"opacity": {"keyframes": [{"frame": 12, "value": 0}]}}}
        ]}]})
    }

    #[test]
    fn splitlayer_は元を今の時刻で終え_写しを元の上に置く() {
        let mut d = two_layers();
        let c = apply_ops(
            &mut d,
            &[json!({"op": "splitLayer", "layerId": "lyr_X", "frame": 30})],
        )
        .unwrap();
        let ls = d["compositions"][0]["layers"].as_array().unwrap();
        assert_eq!(ls.len(), 3);
        assert_eq!(ls[0]["id"], "lyr_FRONT", "ほかのレイヤーの並びは変えない");
        let copy = &ls[1];
        let orig = &ls[2];
        assert_eq!(orig["id"], "lyr_X");
        assert_eq!(
            (orig["inFrame"].as_i64(), orig["outFrame"].as_i64()),
            (Some(10), Some(30))
        );
        assert_eq!(
            (copy["inFrame"].as_i64(), copy["outFrame"].as_i64()),
            (Some(30), Some(50))
        );
        assert_eq!(
            copy["startFrame"], 5,
            "素材の時刻はずらさない＝絵は切れ目でつながる"
        );
        assert_eq!(copy["transform"], orig["transform"], "キーフレームも同じ");
        assert_eq!(copy["name"], "x");
        assert_ne!(copy["id"], orig["id"]);
        assert!(mv_core::id::is_valid_id(
            IdKind::Layer,
            copy["id"].as_str().unwrap()
        ));
        assert_eq!(
            c,
            vec![Created {
                index: 0,
                kind: "layer",
                id: copy["id"].as_str().unwrap().into()
            }]
        );
    }

    #[test]
    fn splitlayer_は範囲の外と端では断り_渡した_id_を使う() {
        for at in [10, 50, 9, 51] {
            let mut d = two_layers();
            let e = apply_ops(
                &mut d,
                &[json!({"op": "splitLayer", "layerId": "lyr_X", "frame": at})],
            )
            .unwrap_err();
            assert!(
                e.message.contains("内側ではありません"),
                "{at}: {}",
                e.message
            );
        }
        let mut d = two_layers();
        let given = new_id(IdKind::Layer);
        apply_ops(
            &mut d,
            &[json!({"op": "splitLayer", "layerId": "lyr_X", "frame": 11, "id": given})],
        )
        .unwrap();
        assert_eq!(d["compositions"][0]["layers"][1]["id"], json!(given));
        let mut d = two_layers();
        let e = apply_ops(
            &mut d,
            &[json!({"op": "splitLayer", "layerId": "lyr_X", "frame": 11, "id": "bad"})],
        )
        .unwrap_err();
        assert!(e.message.contains("ID の形ではありません"));
        let e = apply_ops(
            &mut d,
            &[json!({"op": "splitLayer", "layerId": "lyr_NONE", "frame": 11})],
        )
        .unwrap_err();
        assert!(e.message.contains("見つかりません"));
    }

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
        fill_layer_defaults(&mut l, &comp, None);
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
        fill_layer_defaults(&mut t, &comp, None);
        assert_eq!(t["transform"]["anchor"], json!({"value": [0.0, 0.0]}));
        // 素材を指すレイヤー＝種類は素材から・アンカーは素材の中心・長さは素材の長さ
        let comp = json!({"width": 1280, "height": 720, "durationFrames": 300, "fps": {"num": 30, "den": 1}});
        let video = json!({"id": "ast_X", "kind": "video", "meta": {"width": 640, "height": 360, "durationSec": 2.5}});
        let mut v = json!({"name": "v", "assetId": "ast_X"})
            .as_object()
            .unwrap()
            .clone();
        fill_layer_defaults(&mut v, &comp, Some(&video));
        assert_eq!(v["type"], "video");
        assert_eq!(v["outFrame"], json!(75));
        assert_eq!(v["transform"]["anchor"], json!({"value": [320.0, 180.0]}));
        let seq = json!({"id": "ast_S", "kind": "imageSequence", "meta": {"width": 10, "height": 10, "frameCount": 48, "fps": {"num": 24, "den": 1}}});
        let mut q = json!({"name": "q", "assetId": "ast_S"})
            .as_object()
            .unwrap()
            .clone();
        fill_layer_defaults(&mut q, &comp, Some(&seq));
        assert_eq!(
            q["outFrame"],
            json!(60),
            "48 コマ÷24fps＝2 秒＝30fps で 60 コマ"
        );
        let long = json!({"id": "ast_A", "kind": "audio", "meta": {"durationSec": 600.0}});
        let mut a = json!({"name": "a", "assetId": "ast_A"})
            .as_object()
            .unwrap()
            .clone();
        fill_layer_defaults(&mut a, &comp, Some(&long));
        assert_eq!(a["type"], "audio");
        assert_eq!(
            a["outFrame"],
            json!(300),
            "コンポジションより長ければそこまで"
        );
        // 途中から始める＝終わりと素材の時刻 0 もそこから（コンポジションの終わりで止める）
        let mut late = json!({"name": "v", "assetId": "ast_X", "inFrame": 100})
            .as_object()
            .unwrap()
            .clone();
        fill_layer_defaults(&mut late, &comp, Some(&video));
        assert_eq!(
            (
                late["inFrame"].as_i64(),
                late["outFrame"].as_i64(),
                late["startFrame"].as_i64()
            ),
            (Some(100), Some(175), Some(100))
        );
        let mut end = json!({"name": "v", "assetId": "ast_X", "inFrame": 260})
            .as_object()
            .unwrap()
            .clone();
        fill_layer_defaults(&mut end, &comp, Some(&video));
        assert_eq!(
            end["outFrame"],
            json!(300),
            "コンポジションの終わりで止める"
        );
        let mut past = json!({"name": "v", "assetId": "ast_X", "inFrame": 320})
            .as_object()
            .unwrap()
            .clone();
        fill_layer_defaults(&mut past, &comp, Some(&video));
        assert_eq!(
            past["outFrame"],
            json!(395),
            "終わりより後なら素材の長さだけ（空にしない）"
        );
        let mut solid_late =
            json!({"name": "s", "type": "solid", "solid": {"color": [1,0,0,1]}, "inFrame": 50})
                .as_object()
                .unwrap()
                .clone();
        fill_layer_defaults(&mut solid_late, &comp, None);
        assert_eq!(
            solid_late["outFrame"],
            json!(300),
            "素材の無いものはコンポジションの終わりまで"
        );
        let img = json!({"id": "ast_I", "kind": "svg", "meta": {"width": 100, "height": 50}});
        let mut i = json!({"name": "i", "assetId": "ast_I", "type": "image"})
            .as_object()
            .unwrap()
            .clone();
        fill_layer_defaults(&mut i, &comp, Some(&img));
        assert_eq!(i["outFrame"], json!(300), "画像はコンポジションの全体");
        assert_eq!(t["transform"]["anchor"], json!({"value": [0.0, 0.0]}));
    }
}
