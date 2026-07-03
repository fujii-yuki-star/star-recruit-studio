# ADR-0021: テンプレ既定素材（template-owned default assets）

- **状態**: Accepted（2026-06-29・利用者要望／α-3 追加・実装は EPIC サブPR A〜D に分割。保存方式 A＝グローバル・ファイル保存を承認）
- **日付**: 2026-06-29
- **関連**: [`adr/0017`](0017-template-authoring-editor.md)（テンプレ作成エディタ・**本ADRが「`template.schema` 不変／1テンプレ=1ファイル」を一部改める**）/ [`adr/0008`](0008-free-layout-editor.md)（FREE 素材・fit）/ [`adr/0007`](0007-detailed-edit-mode.md)（単一パイプライン M-A）/ `template.schema.json`・`11 §1`（template の版方針）・`§2-4`（テンプレ駆動）・`§2-2`（検証してから内部へ）・`§4`（層分離）
- **対象**: ①見本への素材の自動流し込みを止める ②テンプレ編集で既定素材を登録できる ③使用時にテンプレ既定素材を自動反映（場面素材があれば優先）。**④（画像の「収め方」＝素材単位）は別タスク**（`project.schema`／本ADR外）。

---

## コンテキスト

### 現状（調査）
- **見本（管理画面）**：`looksShared.ts` の `buildSampleScene` が**プロジェクトの最初の画像を全 background/slot に、ロゴ・ゆうこも自動で流し込む**。利用者視点では「自分の写真が全テンプレに勝手に出る」邪魔な挙動。
- **テンプレ編集**（`LooksEditScreen`）：background レイヤーは**色のみ**で**素材画像を登録できない**。
- **schema**：`Layer.assetId`（`template.schema.json`）は**存在するが描画で未使用（休眠）**。描画（`layout.ts`）は background/slot/logo の素材を **`scene.assetRefs[layer.id]`** から取る。
- **テンプレ保存**：ADR-0017 で全プロジェクト共通（**グローバル**・`user_tmpl_NNN`・`appData/user_templates/<id>.json`）。テンプレは**横断資産**。

### 要望
テンプレ自身が**既定素材（背景など）を持てる**ようにし、**見本も使用時もそれを表示**。**プロジェクト側に素材があればそちら優先**。

---

## 決定の判断軸
1. **テンプレ駆動（§2-4）**：見た目（背景含む）はテンプレが決める、を**素材にも広げる**。
2. **単一パイプライン非汚染（ADR-0007/0017）**：通常の Template のまま。描画は既存経路に**フォールバックを1段足すだけ**。
3. **グローバル整合**：テンプレは横断資産ゆえ、テンプレ素材も**グローバル保存**・**プロジェクト非依存の id**。
4. **上書き優先（③）**：場面に素材があれば常にそちら。テンプレ既定は「無いときの既定」。

---

## 検討した選択肢

### 素材の保存方式
- **(A) グローバル・ファイル保存【採用】**：素材ファイルを `appData/user_templates/assets/<assetId>.<ext>` に複製。テンプレ JSON は `assetId`＋マニフェストで参照。URL 解決・書き出しは**実ファイル**ゆえ既存（プロジェクト素材）と同様に扱える。
- (B) base64 でテンプレ JSON に埋め込む：単一ファイル可搬は保てるが、**JSON が肥大**（背景写真で数百KB〜）・取込上限 1MB 超・書き出しは一時ファイル化が必要。可搬性より実用性を優先し**不採用**（将来の共有は bundle で対応）。

### 参照の持ち方（schema）
- **`Layer.assetId`（既存・休眠）を「テンプレ所有素材の id」として活性化【採用】** ＋ テンプレ直下に**任意の `assets` マニフェスト**（`[{ assetId, fileName, assetType }]`）を追加（ファイル解決・取込/書き出しの土台）。いずれも**任意・後方互換**ゆえ template 版は**据え置き**（`11 §1`＝非破壊追加で版を上げない）。

### id 名前空間
- テンプレ所有素材 id ＝ **`tmpl_asset_NNN`**（プロジェクトの `asset_*` と区別＝URL 解決の振り分けに使う・グローバル一意）。

---

## 決定

> **テンプレは「既定素材」を持てる。素材ファイルはグローバル（`user_templates/assets`）に保存し、`Layer.assetId`＋テンプレ `assets` マニフェストで参照する。描画は `scene.assetRefs[layer.id] ?? layer.assetId` で解決し、場面素材があれば常に優先。見本・使用時ともテンプレ既定素材を表示し、プロジェクト写真の自動流し込み（`buildSampleScene`）はやめる。**

### ① 見本（管理画面）
- `buildSampleScene` は background/slot/logo に**プロジェクト素材を入れない**。テンプレ既定素材（`layer.assetId`）があれば描画、無ければ**プレースホルダ枠**（「素材」表示）。テキストは従来どおり見本文。character（ゆうこ）は既定ポーズのまま（テンプレ所有素材ではない）。

### ② 編集（LooksEditScreen）
- background/slot（＋任意で logo）レイヤーに**「既定の素材を登録」**を追加。ファイル選択 → グローバル `assets` へ複製（Tauri）→ `tmpl_asset_NNN` を採番し `layer.assetId`＋マニフェストへ記録。**「外す」で解除**。収め方（fit）は既存。
- `decor` は非開放のまま（ADR-0017）。

### ③ 使用時（描画・場面適用）
- `layout.ts`：background/slot/logo の素材を **`scene.assetRefs[layer.id] ?? layer.assetId ?? null`** で解決（**場面が優先**・テンプレ既定はフォールバック）。
- 場面編集の「使用素材」：テンプレ既定が入っているスロットは既定を表示しつつ、**プロジェクト素材で差し替え可**（差し替え＝`scene.assetRefs` に入る＝優先）。

### 保存・解決（infrastructure・§4）
- 新 Tauri コマンド：`import_template_asset`（ファイル複製＋id 返却）／`load_template_asset_urls`（assetId→URL）／テンプレ削除時の**未使用素材の掃除**。
- 起動時に `loadUserTemplates` と並べてテンプレ素材 URL を読み、**`assetSrcById` に統合**（プロジェクト素材と同じ解決マップ＝描画・書き出し共通）。
- 書き出し（`buildExportScenes`）：`tmpl_asset_*` も実ファイル解決ゆえ既存経路で対応（パス解決にテンプレ素材ディレクトリを追加）。

### 崩さない不変条件
- **通常の Template のまま**（描画・選択・AI 除外は ADR-0017 のまま）。**AI 入力は引き続き `user_tmpl_` 除外**（テンプレ素材は AI に無関係）。
- **検証（§2-2）**：`assets` マニフェスト・`assetId` を `template.schema` に追加し ajv ゲートを通す。
- **削除整合**：テンプレ削除時に所有素材ファイルも掃除。場面が `tmpl_asset_` を参照することは無い（場面は `assetRefs` に自分の `asset_*` を持つ・テンプレ既定は参照時フォールバックのみ）。

### 正典の追補（実装PRで）
- `template.schema.json`：`assets`（任意）＋ `Layer.assetId` の用途明記（**版据え置き**＝`11 §1`）。
- `11 §2.x`：`tmpl_asset_NNN`（テンプレ所有素材・グローバル）を ID 表へ。
- ADR-0017 の「`template.schema` 不変／1テンプレ=1ファイル」を**本ADRが一部改める**旨を注記。

---

## 結果・影響
- **新規**：(1) テンプレ素材のグローバル保存（Tauri import/load/cleanup）＋URL 統合、(2) 編集UIの素材登録、(3) 描画フォールバック（layout）、(4) 見本の改修（`buildSampleScene`）、(5) 書き出しのパス解決追加、(6) schema 追補＋検証。
- **段階出荷（サブPR）**：
  - **A** 描画フォールバック＋見本改修（**① 即時改善**＝テンプレ素材未登録でもプレースホルダ化し、プロジェクト写真の自動流し込みを停止）。
  - **B** グローバル保存（Tauri）＋schema（`assets`/`assetId`）＋URL 解決。
  - **C** 編集の素材登録UI（②）。
  - **D** 書き出しのパス解決（`tmpl_asset_*`）。
- **可搬性**：素材を持つテンプレは**単一 JSON では共有不可**（取込/書き出しの bundle 化は将来・現 import は素材なしテンプレ向けに維持）。
- **④（画像の収め方＝素材単位）は本ADR外**＝`project.schema`（Asset）の別タスクで対応（動画の `clip.fit` と一貫）。

## 未解決（実装で確定）
1. `assets` マニフェストの最小項目（`fileName`/`assetType` 以外に寸法・元名の要否）。
2. `tmpl_asset` の URL 解決を**起動時一括**にするか遅延にするか（テンプレ数×素材数の規模次第）。
3. 場面編集UIで「テンプレ既定が入っている」ことの見せ方（差し替え／既定に戻す導線）。
4. 取込（他者テンプレ）で素材ファイル欠落時の扱い（プレースホルダ＋警告）。

---

## 実装で確定（PR B＝storage 基盤・2026-06-29）

実装に入って下記を確定（未解決1・2を解消）。

- **マニフェスト不要（schema 追加なし）**：テンプレ所有素材＝**レイヤーの `assetId`（`tmpl_asset_NNN`）の集合**。保存ファイル名 `<assetId>.<ext>` が id を内包するため、ディレクトリ走査で id→URL を解決でき、取込/書き出し/掃除も**レイヤー参照から導出**できる。よって `template.schema` への `assets` 追加は**やめ**、休眠 `Layer.assetId`（既存）の活性化のみ＝**版・schema 変更なし**（ADR-0017「1テンプレ=1ファイル」の緩和は「素材ファイルが別途付く」点のみ／JSON 自体は不変）。
- **URL 解決は data URL**（asset:// ではなく）：`assetProtocol.scope` は現状 `$APPDATA/projects/**` のみで、テンプレ素材ディレクトリ（`$APPDATA/user_templates/assets`）を scope に足すと **asset:// の scope/キャッシュ周りが実機でしか検証できない**（[[tauri-packaged-gotchas]]）。テンプレ素材は**少数・起動時一括ロード**ゆえ data URL のメモリ影響は小さく、確実性を優先。
- **保存先**：`appData/user_templates/assets/<tmpl_asset_NNN>.<ext>`（Tauri: `import_template_asset` / `load_template_assets` / `delete_template_asset`）。`templateAssetFs`（infra）が wrap（非 Tauri は no-op）。
- **ストア合流（`templateAssetSrcById`）＋ ScenePreview の解決合流・テンプレ削除時の素材掃除は PR C**（編集UIと同時に配線し実機で検証）。**書き出しの解決は PR D**。
- **孤立素材の掃除（#299・α-4）**：下書き破棄（素材ファイルは選択時に即保存）やテンプレ削除時の削除失敗で残る孤立ファイル（`tmpl_asset_*`）は、次回起動の `loadUserTemplates` に相乗りして**安全条件下でのみ**掃除する（純粋関数 `orphanTemplateAssetIds`）。安全条件＝読込が確実に成功し**全テンプレが健全に揃った**とき（`loadUserTemplates` が `{templates, complete}` を返し `complete=true`）だけ、全テンプレの `layer.assetId` 参照集合に**無い** disk 上ファイルを削除。**読込失敗/破損/検証却下時は何もしない**＝「空が返った瞬間に全削除＝データ消失」を防ぐ。影響は disk 容量のみ。
