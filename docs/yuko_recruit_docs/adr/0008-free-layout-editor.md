# ADR-0008: FREE テンプレートの自由配置（scene.freeLayout）と配置エディタ

- **状態**: Proposed（2026-06-15・未レビュー。develop マージ＝レビュー通過で Accepted へ。実装は本ADR確定後）
- **日付**: 2026-06-15
- **関連**: [`0007-detailed-edit-mode.md`](0007-detailed-edit-mode.md)（詳細編集モード・FREE テンプレ方針／Phase 4）/ [`0001-rendering-parity.md`](0001-rendering-parity.md)（場面内は静止・同一描画でパリティ）/ [`0004-rasterization-method.md`](0004-rasterization-method.md)（WebView Canvas で SVG→PNG）/ [`0006-video-slot-compositing.md`](0006-video-slot-compositing.md)（動画スロット合成・複数動画は未解決#2）/ `CLAUDE.md §10`（タイムライン/キーフレームは対象外）/ `§2-4`（テンプレ駆動）/ `11 §3`（enum）/ `11 §5`（assetRefs バインディング）/ `11 §8`（検証ルール）/ `schemas/{project,template}.schema.json`

---

## コンテキスト

ADR-0007 で詳細編集モードと「FREE テンプレに自由配置を閉じ込める」方針（F-A）を決めた。Phase 4 はその核＝**ドラッグ＆ドロップで素材（画像/動画）・テキスト・図形を配置し、マウスでサイズ変更できる配置エディタ**（利用者要望）。本ADRは Phase 4 着手前に **`scene.freeLayout` の確定スキーマ・座標系・描画/書き出し・編集UX・検証・段階分割**を確定する（ADR-0007 の宿題）。

不変条件（崩さない）: **場面内は静止レイアウト**（ADR-0001。動くのは動画スロットの中身と音声のみ）。自由配置は「静止レイアウトを自由に組む」操作であって**タイムライン編集ではない**（§10 の範囲内）。描画は既存の `layout→SVG→PNG→FFmpeg`（ADR-0001/0004/0006）を流用し、**新しい描画エンジンは作らない**。

## 検討した選択肢

- **(A) `scene.freeLayout` に要素配列を持たせ、FREE テンプレ場面でのみ使う**【採用】: 通常テンプレは座標固定のまま（§2-4 維持）。FREE 場面だけが要素ごとの座標/サイズ/スタイルを持つ。描画は freeLayout を既存パイプラインに流す。
- (B) テンプレ自体を編集可能にする（テンプレ作成エディタ）— §10 で対象外。不採用。
- (C) 既存 `assetRefs` を座標付きに拡張 — assetRefs は「テンプレ層 id → assetId」のバインディング（11 §5）で座標を持たない設計。意味が壊れる。不採用。

## 決定

> **(A) を採用。** `category: free` のテンプレを選んだ場面に限り、**`scene.freeLayout`（要素配列）**で text/画像/動画/図形を自由配置できる。座標系はテンプレ canvas（1920×1080）基準。描画・書き出しは既存パイプライン流用。編集は段階導入（数値入力→ドラッグ/リサイズ）。

### `scene.freeLayout` スキーマ（確定案）

要素配列。各要素は共通の矩形＋重なり順を持ち、`kind` 別に内容を持つ。`kind` は **layer.type 語彙に合わせる**（11 §3.4。`image` は使わず素材は `slot`）。

```jsonc
"freeLayout": [
  { "id": "free_001", "kind": "slot",  "x": 80, "y": 140, "w": 760, "h": 600, "zIndex": 10,
    "assetId": "asset_003", "fit": "cover" },              // 画像/動画（assetId 直接参照）
  { "id": "free_002", "kind": "text",  "x": 900, "y": 160, "w": 900, "h": 200, "zIndex": 20,
    "text": "会社紹介", "fontSize": 64, "color": "#FFFFFF", "fontWeight": "bold" },
  { "id": "free_003", "kind": "shape", "x": 880, "y": 140, "w": 940, "h": 240, "zIndex": 15,
    "shapeType": "rect", "fillColor": "#000000", "opacity": 0.4, "radius": 12 }
]
```

- 共通: **`id`（`free_NNN`・必須・scene 内一意＝別 scene と重複可）**＝選択/ドラッグ/zIndex変更/削除で要素を見失わないための安定キー（配列 index は不可）・`kind`（`slot`/`text`/`shape`）・`x`/`y`/`w`/`h`（canvas 基準・整数・**`w>0` かつ `h>0`＝schema `exclusiveMinimum: 0`**）・`zIndex`。
- `slot`: `assetId`（string|null）・`fit`（cover/contain/stretch）。**素材は assetId で直接参照**（assetRefs は使わない＝ADR-0007 §F）。
- `text`: `text`（表示文字）・`fontSize`・`color`・`fontWeight`（normal/bold）。MVP はこの範囲（影/縁取りは未対応＝未解決論点）。フォントは同梱 OFL のみ（§13）＝**MVP は単一フォントのため `fontFamily` は持たない**（将来フォント複数化/選択時にマイナー追加）。
- `shape`: `shapeType`（**rect/ellipse のみ**）・`fillColor`・`opacity`・`radius`。テンプレ Layer の `shapeType` は `line` も持つが、線は矩形(x/y/w/h)ベースの freeLayout とモデルが異なるため **MVP 対象外**（将来別途検討＝未解決論点）。
- 任意フィールド。通常テンプレ場面は `freeLayout` 未設定（後方互換）。

### `category: free`（FREE テンプレ）

- `template.category` enum に **`free`** を追加。**共有 enum（11 §3.2）**のため `scene.sceneType`（`SceneCategory`）にも `free` を追加する。
- **AI は free を選ばない**（`aiHint.recommendedSceneTypes` に含めない＋ §12 プロンプトで除外）。FREE は**利用者の手動選択専用**。
- FREE テンプレは**組み込みの1つ**（テンプレ作成エディタではない）。`layers` は最小（背景レイヤー1つ）で、内容は `freeLayout` に乗せる。標準 FREE テンプレが無い環境では FREE を選べない（11 §9 補正）。
- **Phase 4a の正典反映（同時更新必須）**: `free` は次の3箇所に**同時追加**する — (1) `11 §3.2`（カテゴリ一覧テキスト）・(2) `project.schema.json` の `SceneCategory` enum・(3) `template.schema.json` の `category` enum。一方、`template.schema.json` の `aiHint.recommendedSceneTypes` の items enum には **`free` を追加しない**（AI に選ばせないため）。さらに **(4) `11 §2.1` の ID 採番表に `freeLayout` 要素＝`free_{NNN}`（scene 内一意・3桁ゼロ詰め）を追記**する。

### 座標系・素材参照

- 座標はテンプレ canvas（1920×1080）。エディタは縮小表示し、**マウス座標 px → canvas 座標**へ換算して保存（端数は丸め）。
- FREE 場面の `slot` 素材は `assetId` 直接参照。レンダラーは「通常テンプレ＝assetRefs 経由」と「FREE＝freeLayout[].assetId 直接」の**2経路を分岐**（ADR-0007 §F）。

### 描画・書き出し（既存パイプライン流用）

- **静止要素（text/shape/画像 slot）**: `layout/sceneSvg` を拡張し、freeLayout 要素を zIndex 順に SVG へ描画→PNG（ADR-0004）。通常テンプレ層（背景）の上に重ねる。**`text` はユーザー入力なので、SVG 埋め込み前に HTML エンティティエスケープ（`& < > " '` 等）を必ず適用する**（既存テキスト描画と同方針）。
- **動画要素（slot に動画 assetId）**: ADR-0006 のオーバーレイ（下PNG→動画→上PNG透過）を**要素の矩形**に適用。`splitVideoSceneSvg` を freeLayout 対応に一般化。**MVP は1場面1動画**（ADR-0006 未解決#2）。
- 場面尺・音声（ナレ/BGM/元音声）は既存どおり。**新フィルタ不要**（自由配置は静止＝既存の still 経路＋動画は ADR-0006 経路）。

### 編集 UX と段階分割

- 同一画面（場面編集）に FREE 場面用の配置エディタを出す。**配置エディタは FREE 場面の主編集面なので「詳細編集」トグルには隠さず常時表示する**（Phase 4a-3b で確定・当初案の「詳細編集配下」から変更）。理由: FREE 場面の内容は `freeLayout` そのもので、唯一の編集手段をトグル裏に隠すと §2-4（直感性）に反するため。FREE 場面では効かないタイトル/字幕欄は出さない（文字は配置エディタの text 要素で置く）。「詳細編集」トグルは引き続き動画クリップの細かい調整・画面の切り替え等（ADR-0007 Phase 3a）を司り、将来の要素別の微調整（4b のドラッグ吸着など）をここに置く余地は残す。
- **ドラッグで配置・角ハンドルでサイズ変更**（マウス）＋ **位置/サイズの数値入力**（キーボード代替＝アクセシビリティ）。選択・重なり順（前/後）・削除。
- 段階（producer/consumer を各段で成立させる）:
  - **Phase 4a**: `scene.freeLayout`＋`category: free` スキーマ確定／FREE テンプレ追加／**描画・書き出し**（静止要素）／**基本エディタ**（素材・テキスト・図形を追加、位置/サイズは数値入力、zIndex、削除）。← ドラッグ無しでも使える。
  - **Phase 4b**: キャンバス上の**ドラッグ移動＋リサイズハンドル**（マウス）。任意で吸着/グリッド。
  - **Phase 4c**: **動画要素**（ADR-0006 を要素矩形へ・1場面1動画）＋仕上げ。
- スキーマ拡張（`category: free`・`scene.freeLayout`）は **Phase 4a で正典（11/schemas）へ反映**。schemaVersion は**後方互換追加＝マイナー（1.x）**（11 §1）。

### 検証ルール拡張（11 §8）

Phase 4a で freeLayout 用の検証を追加（既存 V1–V11 に追記）:
- `slot` 要素の `assetId` が `project.assets` に実在するか（V4 相当）。
- kind 別必須: `slot`→assetId（`null` 可＝空スロット）・**`fit` は assetId が非 null のとき必須**、`text`→text、`shape`→shapeType。
- `w > 0` かつ `h > 0`（型レベルの必須＝schema `exclusiveMinimum: 0`）。
- 座標/サイズが canvas（1920×1080）範囲を著しく外れていないか（警告＝行動は止めない。警告文言は §2-5 に従い「次の行動」を示す）。
- 検証は domain の純粋関数として実装し、§7 に従いユニットテストを必須にする（DoD）。

**実装メモ（Phase 4a-3a で確定）**: 上記のうち kind 別の**構造的「必須」**（`slot` の `fit` が assetId 非 null 時・`shape` の `shapeType`）は **schema（`exclusiveMinimum`/enum・将来 if/then）＋ renderer 既定（fit 未指定＝cover・shapeType 未指定＝rect）で担保**し、domain 検証関数 `validateFreeLayout` は**意味検証**（assetId 実在・text 空・サイズ正値・canvas 著しい逸脱）に限定する。`fit` は §2-3 の技術用語のため UI 警告には出さない。正典の検証番号は `11 §8 V12–V15`、エラーコードは `15 §6`。サイズ不正（V13）時は矩形が確定しないため canvas 逸脱（V14）判定はスキップし二重警告を避ける。

## 結果・影響

- 通常テンプレ場面・既存の書き出し/プレビューは**原則無改修**（freeLayout 未設定＝従来動作）。
- `renderer`（layout/sceneSvg/videoSceneSplit）に freeLayout 描画・動画分割の一般化を追加。`domain` に freeLayout 型＋検証（純粋・テスト）。
- 大きさゆえ 4a→4b→4c に分割。各段で typecheck/lint/test/cargo 緑・ブラウザ/`tauri dev` 動確。

## 未解決の論点

1. **テキスト装飾の範囲**: 影・縁取り・行間・背景ボックスをどこまで（MVP は text/fontSize/color/fontWeight）。
2. **複数動画**を FREE 場面で許すか（ADR-0006 未解決#2。MVP は1）。**Phase 4c の実装＝最初に見つかった動画 slot 要素のみオーバーレイ合成し、2つ目以降の動画 slot は静止表示**（`findVideoSlot` が最初の1件を返す）。誤って複数動画を置いたときの UI ガード（2つ目の動画 slot に警告／合成対象の明示）は将来課題。
3. **吸着/グリッド・整列ガイド**の有無（4b）。
4. **取り消し（undo）**の範囲（場面編集全体の課題）。
5. FREE テンプレの**見た目パターン一覧（Looks）での扱い**（プレビューの出し方・空の器の見せ方）。
6. ~~`freeLayout` 要素 id の要否~~ → **確定（本ADR・指摘1対応）**: 各要素は `id`（`free_NNN`・scene 内一意）を**必須**で持つ（配列 index は使わない＝選択/ドラッグ/並べ替え/削除の安定化）。
7. **`shape` の `line`**: テンプレ Layer には有るが freeLayout は MVP で rect/ellipse のみ。線（矩形と別モデル）を将来サポートするか。
8. **FREE slot 動画のクリップ調整 UI**: 通常スロットは詳細編集で fit/使う範囲/再生速度/元音声を編集できるが、FREE slot 要素は素材選択と fit のみ（Phase 4c）。範囲/速度/元音声は `asset.clip` の既定値で合成される。要素ごとのクリップ調整 UI を将来追加するか（`asset.clip` は素材単位なので、要素単位にするか素材単位のまま流用するかも論点）。
