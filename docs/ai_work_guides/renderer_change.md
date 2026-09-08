# プレビュー・書き出しの描画を変える

`src/renderer/**`（`layout` / `sceneSvg` / `preview` / `export`）を変える作業。

## 必読

| 資料 | 範囲 | なぜ |
|---|---|---|
| [`adr/0001`](../yuko_recruit_docs/adr/0001-rendering-parity.md) | 全文（4,000字ほど） | **プレビュー＝書き出し**の作り方（A2ハイブリッド／per-frame） |
| [`05_RENDERING_SPEC.md`](../yuko_recruit_docs/05_RENDERING_SPEC.md) | **全文でよい（4,948字）** | 描画順・収め方・字幕・音量・トランジション |
| [`11_SCHEMA_REFERENCE.md`](../yuko_recruit_docs/11_SCHEMA_REFERENCE.md) | **§5 バインディング契約**（2,878字）・**§6 声・音量の解決順序**（754字） | `assetRefs[layer.id] ?? layer.assetId` などの解決順 |

## 必要なら読む

| 条件 | 読むもの |
|---|---|
| タイムライン形式の描画 | `11 §7.6.4`（1フレームの描き方）・`§7.6.5`（書き出し）＋[`timeline_change.md`](timeline_change.md) |
| アニメ・キーフレーム | [`adr/0019`](../yuko_recruit_docs/adr/0019-keyframe-animation-model.md) |
| 動画素材の合成 | [`adr/0026`](../yuko_recruit_docs/adr/0026-alpha4-behavior-consistency.md)（挙動一致の4つの判断軸） |
| FFmpeg・コーデック | [`adr/0013`](../yuko_recruit_docs/adr/0013-h264-via-media-foundation.md)＋`13 §3` |
| フォント | [`adr/0038`](../yuko_recruit_docs/adr/0038-user-fonts.md)（**読み込み済みの字体しか焼けない**） |

## 読まない

- `06_UI_SPEC.md`（画面を触らないなら）
- `12_AI_PROMPT_AND_MAPPING.md`
- `01`〜`04`・`07`〜`10`

## よく踏むところ

- **プレビュー側だけ近似で書く**＝正準関数（`layoutScene` / `layoutToSvg` / `frameTimeSec` / `clipTimeAtSceneTime` / `audioCuesAt`）を**呼ぶ**。写した瞬間にパリティが2実装になる
- **描けないものを黙って静止画にする**＝断る（ADR-0026④・#434）
- **合成の単位を跨いで帯分割する**＝タイムラインの書き出しは**常に全フレーム描画**（`11 §7.6.5`）
- **golden を作り直して緑にする**＝差分が出た理由を先に説明する（`14 §5`）

## 終わったら

golden-file テスト（`14 §5`）と変異チェック。`05` と `11` の該当節を同じ PR で直す。
