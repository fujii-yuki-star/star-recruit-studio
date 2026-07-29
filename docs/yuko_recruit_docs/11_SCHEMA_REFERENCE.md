# 11. スキーマ規範リファレンス（データの正典）

> 本書と `schemas/*.schema.json` が**データ仕様の正典**である。`03_DATA_SCHEMA.md` は解説（例示）であり、矛盾時は本書を優先する。
> 数値・enum・IDの「唯一の参照元」は本書 §3（enum）・§4（定数）。実装では文字列リテラル直書きを禁止し、定数モジュール経由で参照する（`CLAUDE.md §2-7`）。

---

## 1. スキーマ一覧とバージョニング

| スキーマ | ファイル | 対象 | 性質 |
|---|---|---|---|
| Project | `schemas/project.schema.json` | `project.json`（Asset/Part/Scene を内包） | 内部・永続 |
| Template | `schemas/template.schema.json` | 見た目パターン定義 | 内部・取込 |
| AiVideoPlan | `schemas/ai-video-plan.schema.json` | **AI出力**（内部Sceneとは別物） | 受信・一時 |
| TimelineProject | `schemas/timeline-project.schema.json` | **タイムライン編集プロジェクト**の `project.json`（場面を持たない別形式・ADR-0032） | 内部・永続 |

> TimelineProject の版：初期 `"1.0"`（#627）→ **`"1.1"`**（読み上げクリップ＝`kind:'voice'` ＋ `voice`、テンプレクリップの `textFontIds`/`character`/`slotClips` を追加＝いずれも任意追加・後方互換のマイナー・#628 模型）。

- 各スキーマは独立した `schemaVersion`（semver文字列）を持つ。初期は全て `"1.0"`。**project は ADR-0011 で `"1.1"`**（`videoKind`/`generalBrief` の追加・`additionalNotes` を companyInfo→トップレベルへ移動）、**ADR-0012 で `"1.2"`**（`videoSettings.width/height` を撤廃し `aspectRatio` を寸法の単一の真実に・`aspectRatio` に `9:16` を追加＝後方互換のマイナー）、**フォント選択で `"1.3"`**（`videoSettings.fontId`＝同梱フォントの id を追加・任意・後方互換のマイナー）、**標準BGM選択で `"1.4"`**（`bgmSettings.bundledBgmId`＝同梱BGMの id を追加・任意・後方互換のマイナー）、**場面ごとのフォントで `"1.5"`**（`scene.fontId`＝場面のフォントの id を追加・任意・null/未指定は動画全体を継承・後方互換のマイナー）、**FREE 図形の拡張で `"1.6"`**（freeLayout shape の `shapeType` に `rounded_rect`/`triangle`/`star`/`arrow`/`speech_bubble` を追加し `strokeColor`/`strokeWidth`＝枠線を追加・いずれも任意・後方互換のマイナー＝#173）、**テキストごとのフォントで `"1.7"`**（`FreeElement.fontId`＝FREE/パーツのテキスト要素ごと＋`scene.textFontIds`＝textKey 別のフォント上書きを追加・いずれも任意・後方互換のマイナー＝#178）、**掛け合いで `"1.8"`**（`scene.lines`＝NarrationLine[] のセリフ列＋`scene.subtitleEnabledDefault` を追加・いずれも任意・null/未指定は継承・`narration` 残置・後方互換のマイナー＝ADR-0015/#180）、**FREE 要素の回転で `"1.9"`**（`FreeElement.rotation`＝度・0以上360未満・任意・未指定=回転なし・後方互換のマイナー＝#208）、**FREE text の体裁で `"1.10"`**（`lineHeight`＝行間倍率0.5〜3＋`textAlign`＝揃え left/center/right を追加・縁取りは既存 `strokeColor`/`strokeWidth` を text にも適用・いずれも任意・後方互換のマイナー＝#209）、**FREE 要素の非表示/ロックで `"1.11"`**（`hidden`＝非表示・`locked`＝ロックを追加・いずれも任意・後方互換のマイナー＝レイヤー一覧・#210）、**掛け合いの行ごとの抑揚で `"1.12"`**（`NarrationLine.intonation`＝抑揚0.0〜2.0 を追加・任意・null/未指定は場面/動画の既定を継承・後方互換のマイナー＝#242）、**場面ごとの画像の収め方で `"1.13"`**（`scene.slotFits`＝スロット別の収め方上書き object を追加・任意・未指定はテンプレ層の `fit` を使用・後方互換のマイナー＝④）、**要素のグループ化で `"1.14"`**（`scene.groups`＝要素のグループ化（`Group[]`・自前 transform を持つ独立オブジェクト・ネスト可）を追加・任意・未指定＝グループ無し・後方互換のマイナー＝ADR-0022）、**場面横断タイムラインで `"1.15"`**（`timelineOverlay`＝場面横断タイムラインの上位編集〔場面アンカー＋絶対時間の `OverlayClip[]`。まず telop トラック〕を追加・任意・未指定＝場面射影のみ・後方互換のマイナー＝ADR-0018）、**場面ごとのBGMで `"1.16"`**（`scene.bgmSettings`＝場面のBGM設定〔`BgmSettings`〕を追加・任意・未指定＝プロジェクト既定〔`bgmSettings`〕を継承〔null=継承〕・`enabled:false` でこの場面は無音・後方互換のマイナー＝ADR-0018 ③(7)）、**要素アニメーション（キーフレーム）で `"1.17"`**（`timelineOverlay.animations`＝`ElementAnimation[]`〔場面内の1要素を時間で補間・FREE 要素／グループ id が対象・timelineOverlay 格納ゆえ AI/場面正準は不変〕を追加・任意・未指定＝アニメ無し＝静止・後方互換のマイナー＝ADR-0019 ④）、**動画スロット再生開始タイミングで `"1.18"`**（`scene.slotVideoStart`＝スロット別の再生開始モード〔`{ mode: withAnim/afterAnim/delay, delaySec? }`〕を追加・任意・未指定＝`withAnim`＝アニメと同時・スロット本体アニメ場面でのみ有効・後方互換のマイナー＝ADR-0027・#444）、**動画クリップ調整の per-use 上書きで `"1.19"`**（`scene.slotClips`＝スロット別のクリップ上書き〔`startSec`/`endSec`/`speed`/`useOriginalAudio`/`originalAudioVolume`。`fit` は除く＝`slotFits` が担う〕を追加・任意・未上書きフィールドは `asset.clip` を継承・後方互換のマイナー＝ADR-0028・#472）、**FREE 字幕要素で `"1.20"`**（`FreeElement.kind` に `subtitle`＝自由配置の字幕要素を追加し、`FreeElement.subtitleSource`＝字幕の対象〔`{kind:'narration'}`＝読み上げ `texts.subtitle`／`{kind:'allLines'}`＝掛け合いの全行／`{kind:'speaker', speaker}`＝特定の実効話者〕を追加・いずれも任意・**未指定＝後方互換**〔単独→読み上げ・掛け合い→全行へ無変換解決〕・後方互換のマイナー＝ADR-0029・#521）、**掛け合いの同時開始で `"1.21"`**（`NarrationLine.startWithPrevious`＝直前の行と**同時に**開始〔並行して重ねて流す・`true` の連続で N 人同時〕を追加・任意・未指定/`false`＝逐次〔従来どおり〕・`startSec` を保存しないので **V18〔重なり禁止〕に触れない**・後方互換のマイナー＝ADR-0031・#530）、**FREE 要素の任意表示名で `"1.22"`**（`FreeElement.name`＝重ね順一覧/選択チップの見分け用の任意表示名〔全 kind 共通。**テンプレの `Layer` に同等のフィールドは無い**＝テンプレ作成の一覧は種別名＋差し込み先で見分ける・#547 P2-4〕を追加・任意・**未指定＝種類＋連番の自動名にフォールバック**・後方互換のマイナー＝#525-12）、**FREE 字幕/文字の背景帯で `"1.23"`**（`FreeElement.background`＝FREE の text/subtitle 要素の背景帯〔可読性の下地・`{enabled?,color?,opacity?,radius?}`・通常字幕層 `layer.background` と同型〕を追加・任意・**未指定/`enabled:false`＝背景帯なし**・通常→FREE 化で移送〔ADR-0030〕・後方互換のマイナー＝#529）、**文字の体裁の場面別上書きで `"1.24"`**（`scene.textStyles`＝テキスト種別ごとの体裁上書き〔`{color?,fontSize?,fontWeight?,strokeColor?,strokeWidth?}`・`$defs/TextStyle`・制約は Layer/FreeElement の同名プロパティと同一〕を追加・任意・**各プロパティ未指定＝テンプレ層→既定を継承**〔触ったものだけ固有値〕・**配置/座標はテンプレ駆動のまま**〔§2-4 の対象は配置＝体裁は対象外・`textFontIds` と同型の前例踏襲〕・AI は生成しない〔利用者編集専用〕・後方互換のマイナー＝#555）。template は `aspectRatio` に `9:16` を追加（enum 追加＝非破壊で `"1.0"` 据え置き）、さらに Layer に `strokeColor`/`strokeWidth`＝text/subtitle の縁取りを追加（任意・後方互換のマイナー＝#275。template はマイグレーション機構を持たず、非破壊の追加は版を上げない方針＝aspectRatio 9:16 と同じ。さらに `template.groups`＝要素のグループ化（ADR-0022）と Layer の `rotation`＝回転（0以上360未満・FreeElement と同仕様・#307）も任意追加で版据え置き）。ai-video-plan は **`narrationLines`（掛け合い・任意追加）を加えても後方互換ゆえ `"1.0"` 据え置き**（AI出力は transient で永続化/migration 不要・optional 追加のため版を上げない＝ADR-0015 PR-G/#180）。
  - 移行: 既存 `"1.0"`〜`"1.6"` の project.json は読込時に `"1.7"` へ更新（`videoKind` 省略＝recruit 既定、`companyInfo.additionalNotes` をトップレベル `additionalNotes` へ移送、`videoSettings.width/height` を除去、`videoSettings.fontId` 未指定は既定フォントを補完、未知の `bgmSettings.bundledBgmId` は標準BGM未選択へ落とす、未知の `scene.fontId` は継承（未指定）へ落とす。`"1.5"`→`"1.6"` は FREE 図形種別・枠線の追加のみで版番号の付け替え以外の変換は不要＝#173。`"1.6"`→`"1.7"` はテキストごとのフォント追加のみで変換不要＝#178。`"1.7"`→`"1.8"` は掛け合い（`scene.lines`/`subtitleEnabledDefault`）の任意追加のみで変換不要＝ADR-0015/#180。`"1.8"`→`"1.9"` は FREE 要素の回転（`FreeElement.rotation`）の任意追加のみで変換不要＝#208。`"1.9"`→`"1.10"` は FREE text の体裁（`lineHeight`/`textAlign`）の任意追加のみで変換不要＝#209。`"1.10"`→`"1.11"` は FREE 要素の `hidden`/`locked` の任意追加のみで変換不要＝#210。`"1.11"`→`"1.12"` は `NarrationLine.intonation` の任意追加のみで変換不要＝#242。`"1.12"`→`"1.13"` は `scene.slotFits` の任意追加のみで変換不要＝④）。
- **形式の判別（ADR-0032・#627）**: `project.json` の**トップレベル `format`** で決める。判定は **`format === "timeline"` か否か**の一点＝`"timeline"` ならタイムライン形式（`timeline-project.schema.json` で検証）、**それ以外（＝未指定）は場面形式**（`project.schema.json`）。**場面形式のファイルは `format` を書かない**（不在がそのまま「場面形式」を意味する＝既存データと同じ形。`project.schema` はトップレベル `additionalProperties:false` なので `format` を持つ場面形式ファイルは**検証を通らない**＝実装は書き込んではならない。CI の must-reject で固定）。`ProjectFormat` の `"scene"` は**読込時の解決値**（`resolveProjectFormat`）であって**永続化しない**。この非対称は意図的で、場面形式は ADR-0032 で凍結されており、情報量ゼロのフィールド追加のために `project.schema` を版上げしないため。`projectId` の採番は**両形式で共通**（`proj_YYYYMMDD_NNN`・一覧に同列で並ぶ）＝**id では判別しない**。timeline-project の `schemaVersion` は**場面形式とは独立に進む**（別文書＝初期 `"1.0"`。場面形式の 1.x バンプは timeline に波及しない、逆も同じ）。**素材・見た目設定・グループ・キーフレームは `project.schema.json` の `$defs` を `$ref` で共有する**（同梱フォント/同梱BGMの一覧も `$ref`＝増減を1か所で管理・`CLAUDE.md §2-7`）。**変換は片道**（場面→タイムラインへ焼き出して新規作成・元は残る）ゆえ、timeline→場面のマイグレーションは持たない。
- **互換性方針**: マイナー（`1.x`）＝後方互換の追加のみ。メジャー（`2.0`）＝破壊的変更で、読込時にマイグレーション関数を通す。未知のメジャーは読込拒否しユーザー向けに告知。
- **制約の是正（バンプ無し）**: schema の制約が**本書に文書化済みの契約と食い違っていた**場合、schema を本書へ合わせる修正は**版を上げない**（契約は元から本書のとおりで、追加でも破壊的変更でもない＝誤記の訂正）。条件＝①アプリの生成経路が新制約を既に満たす ②既存データが違反しても**読込は拒否されない**（範囲違反は非 structural＝`§8` V2・#416）こと。前例＝`scene.durationSec` を `minimum:0`→`exclusiveMinimum:0`（#586・`§7`）。①②が満たせない（既存データが読めなくなる/移行が要る）なら通常どおりメジャー＋マイグレーション。
- 読込時、`schemaVersion` 不在 or 未対応なら検証エラー（`§8`）。

---

## 2. 共通規約

### 2.1 ID採番

| 種別 | 形式 | 例 | 規則 |
|---|---|---|---|
| project | `proj_{YYYYMMDD}_{NNN}` | `proj_20260610_001` | 作成日＋連番 |
| part | `part_{NNN}` | `part_001` | プロジェクト内一意・3桁 |
| scene | `scene_{NNN}` | `scene_001` | プロジェクト内一意・3桁。作成順に採番（表示順は `order` が制御） |
| freeLayout 要素 | `free_{NNN}` | `free_001` | **scene 内一意**・3桁（ADR-0008・FREE テンプレの自由配置要素） |
| セリフ行 | `line_{NNN}` | `line_001` | **scene 内一意**・3桁以上（ADR-0015・掛け合いのセリフ列 `scene.lines`・#180） |
| グループ | `group_{NNN}` | `group_001` | **scene/template 内一意**・3桁以上（ADR-0022・要素のグループ化 `scene.groups`/`template.groups`・空き番号を埋める gap-fill） |
| overlay クリップ | `ovclip_{NNN}` | `ovclip_001` | **project 内一意**・3桁以上（ADR-0018・タイムラインの `timelineOverlay.clips`・gap-fill） |
| トラック | `track_{NNN}` | `track_001` | **タイムライン形式のみ**（ADR-0032）。project 内一意・3桁以上・gap-fill。**配列の順が重ね順**（後ろほど手前）＝id の大小は重ね順と無関係 |
| タイムラインのクリップ | `clip_{NNN}` | `clip_001` | **タイムライン形式のみ**（ADR-0032）。project 内一意・3桁以上・gap-fill。場面形式の `ovclip_NNN` とは**別物**（混在しない＝形式が違う） |
| アニメーション | `anim_{NNN}` | `anim_001` | **project 内一意**・3桁以上（ADR-0019 の `timelineOverlay.animations` ／ ADR-0032 の `animations`。両形式で同じ形式・gap-fill） |
| asset | `asset_{NNN}` または `asset_{slug}_{NNN}` | `asset_office_001` | 一意。`^[a-z0-9_]+$` |
| yuko asset | `yuko_{tag}_{NNN}` | `yuko_smile_001` | asset の一種（`assetType=yuko`） |
| bgm asset | `bgm_{slug}_{NNN}` | `bgm_bright_001` | asset の一種（`assetType=bgm`） |
| user template | `user_tmpl_{NNN}` | `user_tmpl_001` | **ユーザー作成テンプレの `templateId`**。**グローバル一意**（全プロジェクト横断）・3桁（999超は桁上がり）。`^[a-z0-9_]+$` 適合（`template.schema` 不変）。同梱テンプレは記述的id（`corp_title` 等）で名前空間が別＝接頭辞 `user_tmpl_` で判定（ADR-0017） |
| テンプレ所有素材 | `tmpl_asset_{NNN}` | `tmpl_asset_001` | **テンプレが持つ既定素材の id**（ADR-0021）。**グローバル一意**（`user_templates/assets/<id>.<ext>`）・3桁（999超は桁上がり）。`^tmpl_asset_[0-9]+$` 適合。`layer.assetId` から参照。**最大連番+1・番号再利用可**（テンプレ削除と同時に消える＝`user_tmpl_` の no-reuse とは別方針） |

- ID は不変。リネーム時も ID は変えず `displayName` を変える。
- AI出力JSON が参照する `assetId`/`templateId` は**既存のもののみ**有効（存在検証 §8）。
- **`user_tmpl_NNN` の採番は scene/part と別方針**：scene/part は空き番号を埋める（gap-fill）が、ユーザーテンプレは**最大連番+1**（削除した番号を再利用しない）。別プロジェクトの `scene.templateId` 参照が後発の別テンプレに化けるのを防ぐため＝払い出し済み最大連番を永続層が保持（ADR-0017）。読込時に万一 ID 衝突があれば後勝ち＋ログ警告。

### 2.2 単位・型の規約

- **座標・サイズ**: px。テンプレ座標空間は **`template.canvas`**（`aspectRatio` 由来＝`16:9`→1920×1080 / `9:16`→1080×1920・ADR-0012）。出力解像度の縮小はテンプレ canvas を基準に等比スケールする。
- **時間**: 秒（`Sec` 接尾辞）。小数可（例 `0.5`）。
- **色**: `#RRGGBB`（小文字可）。`opacity` は `0.0`〜`1.0`。
- **音量**: `0.0`〜`1.5`（1.0=原音）。
- **null = 継承**: scene 側の声・音量フィールドが `null`/未指定なら project 既定を継承（§6）。

---

## 3. enum カタログ（正典）

### 3.1 videoKind（動画の種類）＋ purpose（目的）

**videoKind**（`recruit` / `general`。**省略時は `recruit`**＝後方互換。ADR-0011）で用途を分け、`purpose` の許可値も種類で切り替える（`project.schema.json` の `if/then/else`）。

**recruit（採用・会社紹介）の purpose**

| code | UI表示（`06`） | 旧表記（廃止） |
|---|---|---|
| `company_intro` | 会社紹介 | — |
| `new_graduate` | 新卒採用 | ~~`new_graduate_recruit`~~ |
| `mid_career` | 中途採用 | — |
| `inexperienced_welcome` | 未経験歓迎 | — |
| `engineer` | エンジニア採用 | — |
| `info_session` | 会社説明会用 | — |
| `sns_short` | SNS向け短尺 | — |

**general（一般・社内発表）の purpose**

| code | UI表示（`06`） |
|---|---|
| `general_announcement` | 社内発表・全社共有 |
| `report` | 業績・活動報告 |
| `product_intro` | 製品・サービス紹介 |
| `general_other` | 汎用・その他 |

> `purpose` は**単一フィールド**で、`videoKind=recruit`（既定）なら採用 enum、`videoKind=general` なら一般 enum のみを許可する（混在不可）。
> 既存資料の `new_graduate_recruit`（01/03）・`company_intro`（07）は本表の code に統一する。

### 3.2 sceneCategory（= scene.sceneType ＝ template.category）

`opening` / `closing` / `photo_intro` / `video_intro` / `point_list` / `message` / `full_visual` / `chapter` / `no_yuko` / `free`

- scene.`sceneType` と template.`category` は**同一の値集合**を共有する。
- 割り当て規則: AIは `sceneType` に対し **`category` が一致する** templateId を選ぶ（不一致/不在は §9 で補正）。
- `hasYuko` は category ではなくテンプレに `character` レイヤーが存在するかで判定する（`no_yuko` は明示的にゆうこ無しを示す用途）。
- `free` は **FREE テンプレ（自由配置）専用・利用者の手動選択のみ**（AIは選ばない＝§12／`aiHint.recommendedSceneTypes` に含めない）。場面は `scene.freeLayout`（§7）で要素を持つ（ADR-0008）。

### 3.3 assetType

`image` / `video` / `bgm` / `voice` / `yuko` / `decor` / `logo` / `qr`

### 3.4 レンダリング系

| enum | 値 |
|---|---|
| `layer.type` | `background` / `slot` / `text` / `subtitle` / `character` / `decor` / `shape` / `logo` |
| `slotType` | `image_or_video` / `image` / `video` |
| `fit` | `cover` / `contain` / `stretch` |
| `textKey` | `title` / `main` / `subtitle` / `caption` / `url` |
| `layer.shapeType`（テンプレ shape レイヤー＝`layer.type=shape`） | `rect` / `ellipse` / `line`（定数 `LAYER_SHAPE_TYPE`・未指定=`rect`） |
| `transition`（MVP） | `none` / `fade` / `slide`（方向 `direction`: `left`/`right`/`up`/`down`）／（将来）`wipe` / `zoom`（ADR-0009） |
| `videoStartMode`（動画スロット再生開始・ADR-0027） | `withAnim` / `afterAnim` / `delay`（定数 `VIDEO_START_MODE`・未指定=`withAnim`。`delay` のみ `delaySec`≥0 が必須） |

> **`shapeType` は2系統**：テンプレ Layer（上記・`rect`/`ellipse`/`line`＝定数 `LAYER_SHAPE_TYPE`）と、FREE 自由配置の `freeLayout` shape（`rect`/`ellipse`/`rounded_rect`/`triangle`/`star`/`arrow`/`speech_bubble`＝定数 `FREE_SHAPE_TYPE`・§7.4 freeLayout／schema 1.6）は**別系統**（テンプレは `line` を含み、FREE は装飾図形を含む）。実装はそれぞれの定数モジュール経由で参照（§2-7）。

### 3.5 状態・その他

| enum | 値 |
|---|---|
| `narration.status`（音声生成） | `none` / `pending` / `generated` / `failed` |
| `renderStatus` | `idle` / `preparing` / `rendering` / `encoding` / `done` / `error` / `unsupported` / `cancelled`（ユーザー中止・#380）。`preparing` は保存先を選んでもらっている段（タイムライン形式・#631）＝**ここも走行中に数える**（ダイアログを開いている間に押し直しても二重に走らない）・まだ何も描いていないので進捗は出さない。**実行時のみ**（`project.json` に持たない＝`15 §1`）。`running` は進捗表示のため `rendering`（場面を焼く）／`encoding`（結合・字幕・BGM）に分かれる（#376）。`unsupported` はこの端末で書き出せない（#120・ADR-0013）。値の定義は `domain/export/exportProgress.ts` の `EXPORT_RUN_PHASES` が単一の参照元（§2-7） |
| `formality` | `casual` / `standard` / `formal` |
| `voiceId` | `voicevox_zundamon`（既定）ほか。形式 `^[a-z0-9_]+$` |
| `poseTag` | 自由文字列タグ（例 `smile` / `guide` / `bow` / `surprise` / `think` / `cheer`）。enum固定しない |

---

## 4. 定数カタログ（正典）

| 定数 | 値 | 用途 |
|---|---:|---|
| `AI_SCENE_MIN_DURATION_SEC` | `3` | **AI 生成の目安**（下限）。手編集の制約ではない（#553） |
| `AI_SCENE_MAX_DURATION_SEC` | `15` | **AI 生成の目安**（上限の既定・テンプレ `aiHint.maxDurationSec` で上書き可）。手編集の制約ではない（#553） |
| `SCENE_DEFAULT_DURATION_SEC` | `8` | 既定シーン尺 |
| `TRANSITION_DEFAULT_SEC` | `0.5` | 既定トランジション長 |
| `VIDEO_TARGET_MAX_SEC_MVP` | `300` | MVP想定の目標上限（5分） |
| `VIDEO_HARD_MAX_SEC` | `600` | 将来含むハード上限（10分） |
| `MAX_SCENES_PER_VIDEO` | `80` | シーン数の異常検知上限 |
| `FPS` | `30` | 既定フレームレート |
| `WIDTH` × `HEIGHT` | `1920` × `1080` | 既定解像度 |
| `NARRATION_VOLUME` | `1.0` | ナレーション既定音量 |
| `BGM_VOLUME` | `0.25` | BGM既定音量 |
| `ORIGINAL_AUDIO_VOLUME` | `0.20` | 動画素材の元音声既定音量 |
| `MAX_NARRATION_LEN_DEFAULT` | `120` | ナレーション文字数上限の既定（テンプレで上書き可） |
| `MAX_SUBTITLE_LEN_DEFAULT` | `60` | 字幕文字数上限の既定（テンプレで上書き可） |
| `SEC_STEP` | `0.1` | 秒の**入力欄の刻み・表示の丸め・量子化**の格子（#561） |
| `STROKE_COLOR_ON_DARK` | `#ffffff` | 縁取り/枠線の既定色（**暗い下地**のとき）＝#275/#565 |
| `STROKE_COLOR_ON_LIGHT` | `#000000` | 縁取り/枠線の既定色（**明るい下地**のとき）＝#565 |
| `SHAPE_FILL_FALLBACK_COLOR` | `#ffffff` | 図形の `fillColor` 未指定時に**描く**色（新規作成の既定色とは別＝古いデータ向けの描画フォールバック） |

**秒の格子（`SEC_STEP`・#561）**：**秒（実数）が正準**（ADR-0023）で、0.1 の格子は
**入力欄の刻み・表示の丸め・場面分割の按分**にだけ使う（`quantizeSec` が単一の参照元＝欄の値と表示が食い違わない）。
**ドラッグ結果は量子化しない**：場面尺は実数を取りうる（`clampSceneDuration` は量子化しない）ので、
量子化すると**格子に乗らない場面境界への吸着が黙って捨てられる**（3.25 秒の境界へ合わせたのに 3.3 へ動く・ADR-0026①）。

**縁取り/枠線の既定色（#275／#565）**：`strokeWidth > 0` で `strokeColor` が未指定のときは、**下地**
（文字なら解決後の文字色／図形なら解決後の塗り）と**反対側**の既定色で描く。固定色にすると「白い文字に白い縁取り」で
**設定したのに何も起きない**（ADR-0026①）ため。**通常テンプレの文字層・FREE 要素（文字/字幕/図形）・編集画面の色見本**は
この規則を共有する（`resolveStrokeColor`＝単一の参照元・§2-7）。`strokeWidth` が `0`/未指定なら既定化しない
（＝縁取りなし。選んだ色は消さず残す）。

---

## 5. アセット ⇄ テンプレレイヤー バインディング契約（論点②）

**原則: レンダラーは `scene.assetRefs` のキーとテンプレの「素材を受けるレイヤー」の `id` を突き合わせて素材を流し込む。一致するキーだけが描かれ、「使用中」にも数えられる**（見た目を切り替えて一致しなくなったキーは**休眠**として残る＝下記「切替時の保持」）。

| レイヤー `type` | 素材の供給元 | バインドキー |
|---|---|---|
| `background` | `scene.assetRefs.background` | レイヤー `id`（= `background`） |
| `slot` | `scene.assetRefs[<layer.id>]`（例 `mainVisual`） | レイヤー `id` |
| `logo` | `scene.assetRefs.logo` | レイヤー `id`（= `logo`） |
| `character` | `scene.character.poseAssetId` | 専用（assetRefs を使わない） |
| `text` / `subtitle` | `scene.texts[<textKey>]` | レイヤーの `textKey` |
| `decor` / `shape` | テンプレ内 `assetId` / 図形定義 | 固定（シーン素材ではない） |

**規則**
- **描画・実効使用の条件**: テンプレ内の `background`/`slot`/`logo` レイヤーの `id` 集合に**含まれるキーだけ**が描かれ、「使用中の素材」に数えられる（`layoutScene` は層を辿って描く／`sceneActiveAssetIds`）。**保存データはこれを超えるキーを持ちうる**＝見た目を切り替えたとき差し込み先を失った割当は**休眠として残す**（ADR-0030 追補6・#547 P3-14。下の「切替時の保持」参照）。
- 値が `null`/未指定: テンプレ既定素材（`layer.assetId`）があればそれを表示（ADR-0021・場面素材が優先・無ければテンプレ既定へ委譲）。無ければ レイヤー `required=false` → 非表示、`required=true` → 検証警告（§8）。
- `slotType` と素材の `assetType` が不整合（例: `image` スロットに `video`）→ 補正/警告（§9）。
- 旧 `01_REQUIREMENTS.md` 例の `type:"asset" + assetRole` 表記は本契約（typed layer + id一致）に置き換える。
- **見た目パターン切替時の保持（issue #236 → ADR-0030 追補6・`switchSceneTemplate`）**：場面の `templateId` を変えても、`assetRefs` / `slotFits` / `texts` / `textFontIds` / `textStyles` / `freeLayout` は**どれも清算せず保持**する＝**非破壊往復**（別パターンへ変えて戻すと、その差し込み先・文字枠を持つ見た目で再び描かれる）。差し込み先を失ったキーは**休眠**（描かれず・使用中にも数えない＝上記「描画・実効使用の条件」）なのでダングリングは無害。`warnings` だけは旧テンプレ基準の検証結果なのでクリアする（再検証前提）。
  - ※ 当初（#236）は `assetRefs` のみ「新テンプレのスロット id へ清算」だったが、**`mainVisual` を持たない種類へ変えると写真の割当がその場で消え、元の種類へ戻しても復活しない**（`texts` は戻るのに非対称）ため、ADR-0030 の非破壊往復へ揃えた（#547 P3-14）。

**例**

```jsonc
// template.layers（抜粋）
{ "id": "background", "type": "background" }
{ "id": "mainVisual", "type": "slot", "slotType": "image_or_video", "required": true }
{ "id": "logo",       "type": "logo" }
{ "id": "yuko",       "type": "character", "required": false }

// scene
{
  "assetRefs": { "background": "asset_entrance_001", "mainVisual": null, "logo": "asset_logo_001" },
  "character": { "enabled": true, "characterId": "yuko", "poseAssetId": "yuko_smile_001" }
}
// → background レイヤー=asset_entrance_001 / logo レイヤー=asset_logo_001 /
//   mainVisual は null かつ required=true のため検証警告 / yuko レイヤー=yuko_smile_001
```

---

## 6. 声・音量の解決順序（論点⑤）

各フィールドについて **`シーン上書き` ＞ `プロジェクト既定` ＞ `システム定数`** の順に解決する。`null`/未指定は「継承」を意味する。

| 値 | シーン側（上書き可・null可） | プロジェクト側（既定） | システム定数 |
|---|---|---|---|
| voiceId | `scene.narration.voiceId` | `project.voiceSettings.defaultVoiceId` | `voicevox_zundamon` |
| speed / pitch / intonation | `scene.narration.{speed,pitch,intonation}` | `project.voiceSettings.*` | `1.0 / 0.0 / 1.0` |
| ナレーション音量 | `scene.audioMix.narrationVolume` | `project.voiceSettings.volume` | `NARRATION_VOLUME` |
| BGM音量 | `scene.audioMix.bgmVolume` | `project.bgmSettings.volume` | `BGM_VOLUME` |
| 元音声音量 | `scene.audioMix.originalAudioVolume` | — | `ORIGINAL_AUDIO_VOLUME` |

> `scene.audioMix` は本書で新設（`06_UI_SPEC.md` のこだわり編集「BGM音量/ナレーション音量」をデータ化）。全フィールド任意・null可。

---

## 7. フィールド表（主要エンティティ）

凡例: 必須=●／任意=○。制約は `schemas/` を正典とし、本表は要点のみ。

### 7.1 Project（`project.json`）

| フィールド | 型 | 必須 | 制約・既定 |
|---|---|:--:|---|
| schemaVersion | string | ● | `"1.2"`（ADR-0011 で 1.0→1.1・ADR-0012 で 1.1→1.2。§1） |
| videoKind | enum | ○ | `recruit`/`general`。省略時 `recruit`＝後方互換（§3.1・ADR-0011） |
| projectId | string | ● | §2.1 |
| projectName | string | ● | 1–80字 |
| purpose | string(enum) | ● | §3.1。**videoKind で許可値が変わる**（recruit→採用 enum／general→一般 enum）。AI出力 `videoPlan.purpose` の対応先 |
| createdAt / updatedAt | string(ISO8601) | ● | — |
| videoSettings | object | ● | §7.1.1 |
| companyInfo | object | ※ | §7.1.2。**`videoKind=recruit` のとき必須**（general では持たない・if/then/else） |
| generalBrief | object | ※ | §7.1.3。**`videoKind=general` のとき必須** |
| additionalNotes | string | ○ | 利用者の自由記述（AIへそのまま送る補足・**両用途共通**・≤1000字）。ADR-0011 で companyInfo 配下から**トップレベルへ移動** |
| toneSettings | object | ○ | tone / yukoPersonality / formality(enum) |
| voiceSettings | object | ● | defaultVoiceId / speed / pitch / intonation / volume |
| bgmSettings | object | ○ | enabled / assetId / bundledBgmId（同梱BGMの id・enum＝`domain/bgm/bgmCatalog`・schema 1.4 追加・任意）/ volume / loop / fadeInSec / fadeOutSec |
| assets | Asset[] | ● | §7.2 |
| parts | Part[] | ● | §7.3 |
| scenes | Scene[] | ● | §7.4 |
| timelineOverlay | object | ○ | §7.1.4。場面横断タイムラインの上位編集（場面アンカー＋絶対時間の `OverlayClip[]`）。未設定＝場面射影のみ。**AI/簡易は無視**（schema 1.15・ADR-0018） |

> **※ = 条件付き必須＋排他**（`videoKind` による。recruit→companyInfo 必須・generalBrief 禁止／general→generalBrief 必須・companyInfo 禁止＝`project.schema.json` の if/then/else ＋ `not`）。

**7.1.1 videoSettings**: aspectRatio(enum `16:9`/`9:16`) ● / fps(=30) ● / targetDurationSec(≤`VIDEO_TARGET_MAX_SEC_MVP`) ● / maxDurationSec(≤`VIDEO_HARD_MAX_SEC`) ● / fontId(enum＝同梱フォントの id ○・schema 1.3 追加・未指定は既定フォント＝`domain/font/fontCatalog`)（**寸法は保存しない**＝`aspectRatio` を単一の真実とし `dimsForOrientation` で導出。`16:9`→1920×1080 / `9:16`→1080×1920・ADR-0012。出力解像度の縮小は書き出し時の選択）
**7.1.2 companyInfo**（`videoKind=recruit` のとき必須）: companyName ● / industry ○ / businessDescription ○ / recruitTarget ○ / jobType ○ / strengths(string[]) ○ / desiredPerson ○ / recruitUrl(uri) ○
**7.1.3 generalBrief**（`videoKind=general` のとき必須）: title ●（テーマ・**1〜100字**） / agenda(string[]) ○（章立て・アジェンダ・**最大20件／各100字**） / keyPoints(string[]) ○（伝えたい要点・**最大20件／各100字**） / targetAudience ○（対象視聴者・**100字**。ADR-0011 #12 で追加）。**要素数・文字数の上限は ADR-0011 #4 で確定（任意項目の追加・上限付与ゆえ schemaVersion は 1.1 据え置き）。**
**7.1.4 timelineOverlay**（ADR-0018・2モデル方式・任意・schema 1.15）: clips(`OverlayClip[]`) ○。**OverlayClip**: id(`ovclip_NNN`・project 内一意) ● / track(enum＝現状 `telop` のみ・将来 audio/bgm) ● / anchorSceneId(`scene_NNN`・任意＝**有れば場面相対**〔startSec=場面開始からの相対秒〕／**無ければ絶対時間**〔startSec=グローバル秒〕) / startSec(≥0) ● / durationSec(>0) ● / text(テロップ文言) ○。`compileTimeline` が「アンカー場面のグローバル開始＋startSec」（絶対は 0 基準）で該当トラックへ合成し、**不明/除外アンカーは描画で無視**（V_overlay・§8）。**AI 出力・場面正準は不変**（AI/簡易は overlay を生成/編集しない）。audio/bgm トラックは後続。
**animations（④・ADR-0019・schema 1.17・任意）**: `ElementAnimation[]`。**ElementAnimation**: id(`anim_NNN`・project 内一意) ● / sceneId(`scene_NNN`) ● / targetId(FREE 要素／グループ id) ● / keyframes(`Keyframe[]`・timeSec 昇順) ●。**Keyframe**: timeSec(場面ローカル秒・≥0) ● / x / y / scale(>0) / opacity(0〜1) / rotation / easing(`linear`/`ease-in-out`) ○。設定したプロパティのみ**独立に補間**・値は**絶対上書き**・区間外は端でクランプ。`layoutScene(scene, template, {timeSec, animations})` が補間して対象要素へ適用＝**preview/export 同一関数でフレーム単位パリティ**（ADR-0001/0019・per-frame）。AI/場面正準は不変（AI はアニメを生成しない・`12` 不変）。
**テロップの実描画**：画面**上部の帯**（キャンバス比の既定ジオメトリ＝`renderer/layout.ts` の `overlayTelopItem` が単一参照元。白字・黒縁取り・中央揃え・**動画全体フォント**）。プレビューは `layoutScene` の `telops` オプションで同一 item を描き、書き出しは同一 item を**透過帯PNG**に焼いて**結合後の動画へ `overlay`（`enable='between(t,S,E)'`・グローバル秒）で合成**＝プレビュー＝書き出しのパリティ（ADR-0001/0004）。場面またぎ・遷移中・動画スロット場面でも時刻どおりに表示される。
**並行テロップ（③(8)）**：時間が重なるテロップは**段（row）**に自動割当して縦に積む（`assignTelopRows`＝貪欲な区間分割・最小段数）。段はプレビューと書き出しで一貫（同一 run 定義）＝重なっても潰れず全て読める。段は overlay データから導出＝**schema 変更なし**（保存しない）。

### 7.2 Asset

| フィールド | 型 | 必須 | 制約 |
|---|---|:--:|---|
| assetId | string | ● | §2.1 |
| assetType | enum | ● | §3.3 |
| displayName | string | ● | ユーザー表示名 |
| filePath | string | ● | プロジェクト相対 |
| thumbnailPath | string | ○ | — |
| mimeType | string | ○ | — |
| tags | string[] | ○ | yuko の poseTag もここ |
| description | string | ○ | ユーザー記入 |
| aiDescription | string | ○ | AI解析結果 |
| isPublicChecked | boolean | ○ | 既定 false |
| isDefaultYuko | boolean | ○ | `yuko` のみ。poseTag解決の既定（§12.8） |
| clip | object | ○ | `video` のみ: startSec / endSec / useOriginalAudio / originalAudioVolume / fit / speed（0.5–2.0・再生速度・既定1.0・尺は不変） |
| metadata | object | ○ | width / height / durationSec / hasAudio |

### 7.3 Part

partId ● / title ● / description ○ / order(int≥1) ● / sceneIds(string[]) ● / targetDurationSec ○

### 7.4 Scene

| フィールド | 型 | 必須 | 制約・既定 |
|---|---|:--:|---|
| sceneId | string | ● | §2.1 |
| partId | string | ● | 既存 part を参照 |
| order | int | ● | ≥1 |
| sceneType | enum | ● | §3.2 |
| templateId | string | ● | 既存テンプレ参照 |
| fontId | enum | ○ | 場面のフォント（同梱フォントの id・`domain/font/fontCatalog`）。null/未指定＝動画全体（`videoSettings.fontId`）を継承（1.5 追加） |
| textFontIds | object | ○ | テキスト種別（textKey）ごとのフォント上書き（`{title?,main?,subtitle?,caption?,url?}`＝同梱フォントの id）。未設定の種別は `fontId`→動画全体→既定を継承（1.7 追加・#178） |
| textStyles | object | ○ | テキスト種別（textKey）ごとの**体裁**上書き（`{title?,main?,subtitle?,caption?,url?}`＝各 `TextStyle`＝`{color?,fontSize?,fontWeight?,strokeColor?,strokeWidth?}`）。**各プロパティ未指定＝テンプレ層（`layer.*`）→既定を継承**＝触ったものだけ固有値。**配置/座標は対象外**（テンプレ駆動＝§2-4）。AI は生成しない（1.24 追加・#555） |
| durationSec | number | ● | `> 0`（schema も `exclusiveMinimum:0` で一致＝#586 で矛盾解消。**場面ごとの上限/下限は持たない**・#553）。手編集の確定は §9 で `(0, VIDEO_HARD_MAX_SEC]` へ自動補正。AI 生成時のみ目安 `[AI_SCENE_MIN, テンプレ上限 or AI_SCENE_MAX]` へ寄せる |
| assetRefs | object | ● | §5。値は既存 assetId or null |
| character | object | ● | enabled / characterId / poseAssetId(既存 yuko asset or null) |
| texts | object | ● | title / main / subtitle / caption / url（各 string、テンプレ必須キーは必須） |
| narration | object | ● | text ● / voiceId○ / speed○ / pitch○ / intonation○ / voicePath○ / status(enum) ● |
| audioMix | object | ○ | §6（全フィールド任意・null可） |
| transition | object | ○ | in/out(enum) / durationSec（既定 `TRANSITION_DEFAULT_SEC`）/ direction(enum `left`/`right`/`up`/`down`・slide 用・ADR-0009) |
| warnings | Warning[] | ● | 検証・補正の結果（空配列可） |
| freeLayout | FreeElement[] | ○ | **有効なのは FREE テンプレの場面のみ**（描画/編集/事前確認/素材使用は `templateOf(scene).category===free` でゲート）。**通常テンプレへ切り替えても休眠データとして保持**し、FREE へ戻すと復元（`texts` 休眠と同じ・ADR-0030／#236）。通常→FREE 切替時は表示中の内容（スロット素材＋文字＋**体裁**〔`textStyles` 解決後の実効値＝#555〕）を旧テンプレ幾何ごと自動変換（seed）。**ただし文字/字幕の枠高だけは「同じ行数が入る高さ」へ広げる**＝通常は `maxLines`（既定2）で行数が決まるのに対し FREE は枠高から行数を導出するため、そのまま持ち込むと行が減って文字が切り詰められる（縮めはしない＝回転の中心が動かないように・#555 レビュー P1）。自由配置要素（ADR-0008・id=`free_NNN`(scene内一意)・kind: slot/text/shape/**subtitle**（字幕＝ADR-0029・1.20）・x/y/w/h は canvas基準で w>0/h>0。shape の `shapeType`＝rect/ellipse/rounded_rect/triangle/star/arrow/speech_bubble、枠線/縁取り `strokeColor`/`strokeWidth`（shape=枠線・text=文字の縁取り＝#209。**太さ>0 で色が未指定なら下地と反対の既定色**で描く＝§4・#565）は任意・1.6。text の `fontId`（同梱フォント・null/未指定＝場面/全体を継承）は任意・1.7。`rotation`＝回転角（度・0以上360未満・中心を軸に時計回り・未指定=回転なし・360=0は除外）は任意・1.9＝#208。text の `lineHeight`＝行間（倍率0.5〜3・未指定=1.3）＋`textAlign`＝揃え（left/center/right・未指定=left）は任意・1.10＝#209。`hidden`＝非表示（true で描画/操作対象から除外）・`locked`＝ロック（true で移動/拡縮を禁止）は任意・1.11＝#210。`name`＝任意の表示名（重ね順一覧/選択チップの見分け用・全 kind 共通・未指定=種類＋連番の自動名）は任意・1.22＝#525-12。`background`＝text/subtitle の背景帯（可読性の下地・`{enabled,color,opacity,radius}`・通常字幕層 `layer.background` と同型・未指定/`enabled:false`=なし・通常→FREE で移送）は任意・1.23＝#529） |
| lines | NarrationLine[] | ○ | 掛け合い：時間順のセリフ列（§7.4b）。あれば実効タイムライン（`sceneLines()`）。未設定＝単一 `narration` を1行とみなす（1.8・ADR-0015・#180） |
| subtitleEnabledDefault | bool | ○ | 場面の字幕既定 ON/OFF（行 `subtitleEnabled` 未指定時に継承・1.8） |
| slotFits | object | ○ | 場面ごと・スロット別の画像の収め方上書き（キー＝テンプレの `background`/`slot`/`logo` の layer.id、値＝`cover`/`contain`/`stretch`）。未指定＝テンプレ層の `fit` を使用（1.13・④）。**見た目切替で一致しなくなったキーは休眠として残る（§5 と同じ）** |
| slotClips | object | ○ | 場面ごと・スロット別の**動画クリップ調整の per-use 上書き**（キー＝スロットの layer.id、値＝`{ startSec?, endSec?, speed?, useOriginalAudio?, originalAudioVolume? }`）。`fit` は含めない（per-use は `slotFits`）。未上書きフィールドは `asset.clip`（素材既定）を**継承**（`slotClips ?? asset.clip ?? 既定`・null=継承 §6）。scenes に載るので**Undo 可**（ADR-0020）。同じ動画を場面ごと別範囲で使える（1.19・ADR-0028・#472） |
| slotVideoStart | object | ○ | 動画スロット本体アニメの再生開始タイミング（キー＝スロットの layer.id、値＝`{ mode, delaySec? }`）。`mode`＝`withAnim`（アニメと同時・既定）/`afterAnim`（アニメの後）/`delay`（`delaySec`≥0 秒だけ遅らせて途中から）。**`mode=delay` は `delaySec` 必須**（schema if/then で強制＝「途中から」が黙って「同時」に落ちない）。`delaySec` は `mode=delay` のときのみ意味を持ち、**保存値は上限なし・描画で `[0, animEnd]` にクランプ**（UI のスライダー上限＝アニメ長で頭打ち＝保存値と実効値を一致させる）。**mode を `delay` 以外へ切り替えたら `delaySec` は落とす**（stale 値を残さない・アニメ削除時のエントリ破棄と同流儀）。**スロット本体がアニメ対象の場面でのみ効く**（`slotIsAnimated`）。未指定＝`withAnim`（1.18・ADR-0027・#444） |
| groups | Group[] | ○ | 要素のグループ化（メンバー＝`freeLayout` 要素 id、ネストで group id も可。グループ自身の `transform` を持つ）。未設定＝グループ無し（1.14・ADR-0022） |
| bgmSettings | object | ○ | 場面ごとのBGM（`BgmSettings`）。未指定＝プロジェクト既定（`bgmSettings`）を継承（null=継承）。`enabled:false` でこの場面は無音。`compileTimeline` は実効BGM（場面 ?? プロジェクト）が同じソースの連続場面を1区間にまとめる（連続する同曲は途切れない）（1.16・ADR-0018 ③(7)） |

**7.4b NarrationLine**（掛け合いのセリフ列 `scene.lines` の1行・1.8・ADR-0015・#180）: lineId ●（`line_NNN`・scene 内一意・§2.1） / text ●（読み上げ） / speaker ○（VOICEVOX 話者番号＝#177 `voiceCatalog`・null/未指定＝既定声を継承） / speed ○ / pitch ○ / intonation ○（抑揚0.0〜2.0・null/未指定＝場面/動画の既定を継承・1.12＝#242） / subtitleText ○（字幕文・未指定＝text を流用＝追加B） / subtitleEnabled ○（行の字幕 ON/OFF・未指定＝`subtitleEnabledDefault`→書き出し既定を継承） / startSec ○（簡易手動タイミング・未指定＝自動逐次） / startWithPrevious ○（直前の行と**同時に**開始＝並行・`true` の連続で N 人同時・未指定/`false`＝逐次・1.21＝ADR-0031・#530） / voicePath ○ / status(enum) ●。**行の声は数値 `speaker`（`Narration.voiceId`(文字列) の逆変換は持たない・ADR-0015）。**

### 7.5 Template（要点。詳細は `04` ＋ `schemas/template.schema.json`）

schemaVersion ● / templateId ● / name ● / description ○ / category(enum) ● / aspectRatio(enum `16:9`/`9:16`) ● / canvas{width,height} ● / aiHint{useCase, recommendedSceneTypes[], maxNarrationLength, maxSubtitleLength} ○ / defaults{durationSec, transitionIn, transitionOut, backgroundColor} ○ / layers(Layer[]) ●

### 7.6 TimelineProject（タイムライン形式の `project.json`・ADR-0032・#627）

**場面（`parts`/`scenes`）を持たない別文書**。キャンバスは常に自由配置＝**FREE（空間の自由）× タイムライン（時間の自由）**。**AI はこの形式を生成しない**（AI の関与は場面形式まで＝ADR-0007 の単一パイプラインは場面側で不変）。

schemaVersion ●（`"1.0"`） / format ●（`"timeline"`・§1 の形式判別） / projectId ●（`proj_YYYYMMDD_NNN`・場面形式と共通採番） / projectName ● / createdAt ● / updatedAt ● / sourceProjectId ○（焼き出し元の場面形式 project。**記録のみで元は書き換えない**・完全新規なら未指定） / videoSettings ●（`$ref` 共有） / voiceSettings ●（`$ref` 共有。**タイムライン側でも声を作れる**） / assets ●（`Asset[]`・`$ref` 共有。**焼き出し時はコピー**＝自己完結・ADR-0024 (6)） / tracks ●（`Track[]`） / clips ●（`TimelineClip[]`） / groups ○（`Group[]`・`$ref` 共有。members はクリップ id／ネストでグループ id） / animations ○（`ClipAnimation[]`）

**Track**: id ●（`track_NNN`・§2.1） / kind ●（enum `visual`／`audio`＝置けるクリップの種別を決める） / name ○（未指定＝種別＋連番の自動名） / hidden ○（描画・書き出しから除外＝音声は無音） / locked ○（移動・トリムを禁止）。**配列の順＝重ね順（後ろほど手前）**・UI では上が手前に見せる。

**TimelineClip** ＝ **「FREE 要素 ＋ 時間」**。空間の語彙は `FreeElement`（ADR-0008）と**同じもの**を使う＝**描画は `layoutScene` の FREE 分岐を共有**（パリティを二重に作らない・ADR-0001）。
- 共通: id ●（`clip_NNN`） / kind ●（enum `slot`/`text`/`shape`/`subtitle`/`template`/`audio`/`voice`） / trackId ●（`track_NNN`） / startSec ●（≥0・タイムライン先頭からの秒） / durationSec ●（>0） / name ○
- 空間（`FreeElement` と同義）: x / y / w(>0) / h(>0) / rotation(0以上360未満) / assetId / fit(enum) / text / fontSize(>0) / color / fontWeight / fontId（同梱フォント一覧は `$ref` 共有） / lineHeight / textAlign / shapeType(enum) / fillColor / opacity / radius / strokeColor / strokeWidth / background{enabled,color,opacity,radius} / hidden / locked ○
- `kind='template'`（**テンプレを素材として置く**・差し込み口が生きている）: templateId ● / assetRefs ○ / texts ○ / textStyles ○ / slotFits ○ / textFontIds ○（テキスト種別ごとのフォント・枠全体は `fontId`） / character ○（立ち絵の表示と表情・`$ref` 共有） / slotClips ○（差し込み口ごとの動画の範囲/速度/元音声・`$ref` 共有・ADR-0028）
- `kind='audio'`: bundledBgmId ○（同梱BGM一覧は `$ref` 共有・`assetId` と排他） / volume ○ / fadeInSec ○ / fadeOutSec ○
- `kind='voice'`（**読み上げ**・ADR-0032 決定7）: voice ●（`TimelineVoice`・**schema の if/then で必須**＝中身の無い声を作らせない） / volume ○
- 素材のトリム（非破壊・ADR-0024）: sourceStartSec ○（素材のどこから使うか） / speed ○（>0）。**`kind='template'` の `slotClips` とは別物**＝こちらは自分が持つ素材、あちらは枠の中の差し込み口ごと。
- **kind 別の必須は domain 検証で担保**（`FreeElement` と同じ流儀＝§8）。ただし `voice` だけは schema の `if/then` でも必須にする（「空の声」は描画既定で補えないため）。

**TimelineVoice**（読み上げクリップの中身・1.1）: text ●（読み上げる文。**画面に出す字幕は別の字幕クリップが持つ**） / speaker ○（VOICEVOX 話者番号・null/未指定＝プロジェクト既定を継承） / speed ○（**話速**） / pitch ○ / intonation ○ / voicePath ○（生成済み音声の保存先） / status ●（enum）。制約は `NarrationLine` の同名プロパティを **`$ref` で共有**（増減を1か所で管理・`§2-7`）。
- **場面形式の `NarrationLine` から時間の語彙を除いたもの**＝`startSec`/`startWithPrevious` はクリップの `startSec` とトラックが担い、`subtitleText`/`subtitleEnabled` は字幕クリップが担う（`additionalProperties:false` で混入を弾く）。
- **入れ子にしている理由**＝クリップ直下の `text`（表示する文字）・`speed`（素材の再生速度）と**語が衝突する**ため。読み上げ文と話速は別概念なので、同じ名前で違う意味を持たせない（ADR-0026②）。
- **`audio` と `voice` を種別で分ける理由**＝音の出どころが違う。`audio` は素材/同梱BGM（`assetId`/`bundledBgmId`）、`voice` は**中身**（読み上げ文＋話者）。重ねて指定すると §8 V25 で警告。

**ClipAnimation**: id ●（`anim_NNN`） / targetId ●（クリップ id またはグループ id） / keyframes ●（`Keyframe[]`・`$ref` 共有）。**`timeSec` は「クリップの先頭からの秒」**＝場面形式の `ElementAnimation`（場面ローカル秒）と**そこだけ意味が違う**。補間の規則（設定したプロパティのみ独立補間・絶対上書き・区間外はクランプ）は §7.4 の `Keyframe` と共通。 **グループを対象にしたときの起点は「所属クリップのうち最も早い開始秒」**（#629）＝焼き出しは1場面のクリップをまとめてグループにするので、どのメンバーも同じ開始秒になり、クリップ対象と起点が揃う。

#### 7.6.1 焼き出し（場面形式 → 本形式・片道・ADR-0032 決定16/17・#628）

domain の純粋関数 **`bakeTimelineProject`（`src/domain/timeline/bake.ts`）** が `Project`（場面形式）から `TimelineProject` を新規に組み立てる。**元の `Project` は読むだけ**（片道＝決定16。焼き直しは常に別の新規）。時間軸は書き出しと同じ `resolveTransition` + `transitionTimeline` を共有するので、焼く前に場面形式で書き出した尺と一致する（ADR-0001 の入口）。

| 場面形式 | 本形式 |
|---|---|
| **どの場面も**（見た目パターンの層） | **最背面に `kind:'template'` のクリップ**（`templateId` と差し込み口〔`assetRefs`/`texts`/`textStyles`/`slotFits`/`textFontIds`/`character`/`slotClips`/`fontId`〕を持ったまま＝決定5）。**FREE でも置く**＝FREE テンプレも `background` 層などを持ち動画に出るため（`layoutScene` は category を問わず層を描いてから自由配置を重ねる） |
| 通常テンプレの場面 | 上記だけ＝**1場面1クリップ** |
| FREE の場面 | 上記の**上に要素ごとのクリップ**（`freeLayout` の重ね順で列へ）＋**1場面=1グループ**（見た目パターンのクリップもメンバー）。場面内の `groups` は入れ子で残す |
| `scene.lines` / `scene.narration` | **`kind:'voice'` のクリップ**（行ごと）。同時開始（ADR-0031）は**列を分ける**だけ＝決定8。読み上げ文が空の行はクリップにしない |
| BGM（`bgmSettings`・場面 ?? プロジェクト） | 鳴っている区間ごとに **`kind:'audio'` のクリップ**（`groupBgmRuns` を共有） |
| `transition`（**実効の切り替え**＝`resolveTransition` の結果） | **キーフレーム**（決定19）。`fade`＝手前の場面の不透明度（入る側が手前なら 0→1／出ていく側が手前なら 1→0）、`slide`＝**両方が一緒に動く**（FFmpeg の `slideleft` 等と同じ）、`none`＝なし |
| `timelineOverlay.animations`（FREE 場面のアニメ） | `ClipAnimation`（場面ローカル秒＝クリップローカル秒。要素クリップは場面の先頭から始まるため） |
| `assets` | **焼く範囲で実際に使うものだけ**（`sceneActiveAssetIds`＝休眠の割当は数えない）＋鳴っている BGM の音源。実ファイルは**コピー**（決定13＝自己完結・ADR-0024 (6)） |

- **自由配置の場面かどうかの判定**（`isFreeScene`）：**見た目が解決できるならその `category` が正**（描画＝`layoutScene` と同じ規則ゆえ、通常テンプレに残った休眠 `freeLayout` は焼かない＝ADR-0030）。**解決できないときだけ `scene.sceneType`** へ落ちる＝見た目が見つからない場面でも `freeLayout`・グループ・場面内アニメを黙って落とさない（§2-5）。素材の絞り込み（`sceneActiveAssetIds`）は見た目未解決だと自由配置を数えないため、この場合だけ焼き出し側が要素の素材を足す（焼いたのに素材が無い状態にしない）。
- **列（トラック）の割り当て**：1場面ぶんの列は必ず**連続した並び**で取り、空いた列は下から詰め直す。これで（a）同一トラックの時間の重なりが起きない（§8 V24）、（b）切り替えで重なる2場面は**片方が丸ごともう片方より手前**になる（層が互い違いに挟まらない）＝切り替えを場面まるごとの不透明度で表せる。入る側を常に手前へ固定はしない（切り替えのたびに列が増えるため）。
- **範囲の先頭場面の入場の切り替えは効かない**（切り替え元が範囲の外＝`compileTimeline` の `boundaryDs[0]=0` と同じ）。
- **字幕**：本形式に「対象（`subtitleSource`・ADR-0029）」の語彙は無い（連動は #633）。**時間で変わらないものだけ焼く**＝(1) セリフ列（`scene.lines`）が無い場面のテンプレ字幕層は `texts` で出る、(2) FREE の字幕ボックスで対象＝読み上げのものは、いま出ている文を `text` に焼き付ける。**行に追従するもの**（テンプレ字幕層×`lines` あり〔**1行でも**行の字幕へ差し替わる〕／FREE の字幕ボックスで対象＝全部・話者）は焼けないので `BakeNote` で知らせる。判定は**実際に表示されているものだけ**（非表示・OFF・空は失われるものが無い）。
- **運ぶファイル**（`bakedFilePaths`）＝素材の本体（`filePath`）・動画の代表フレーム（`thumbnailPath`）・**作成済みの読み上げ音声**（`voice.voicePath`）。相対パスの構造（`assets/…`・`voices/…`）はそのまま保つので、焼いた文書のパスを書き換えない。実体のコピーと容量の計測は infrastructure（`copy_project_files` / `project_files_size`）。**焼く前に元を保存する**＝ディスクにあるファイルを運ぶので、保存していない声が抜け落ちない（元の中身は変えない＝片道）。
- **形式の判別は読込の入口で**（§1）：`format:'timeline'` の文書は場面形式として読み込まず、**版の話にすり替えず**「形式が違う」と断る（`parseProjectDoc`・15 §6）。
- **持っていけないもの**は黙って落とさず `BakeNote` で返す（§2-5）：上記の**行に追従する字幕**（声と字幕の連動＝#633 と同時に入れる）／**動画の差し込み口の再生開始タイミング**（ADR-0027 の `slotVideoStart`＝本形式に置き場が無い）。コード語彙は `15 §6`（`BAKE_*`）。

#### 7.6.2 読込と尺（#629）

- **読込の順序＝形式 → 版 → スキーマ**（`parseTimelineProjectDoc`）。版は本形式だけで独立に進むので、**形式違いを版の話にすり替えない**（文言は `15 §6`）。**同じメジャーなら開く**＝`migrateTimelineProject` で現行版へ引き上げてから検証する（完全一致にすると additive バンプ1回で既存の焼き出しが全部開けなくなる・場面形式と同じ流儀）。**中身の入れ替えが要るバンプでは実際の変換を足すこと**。
- **動画全体の尺＝いちばん後ろまで伸びているクリップの終わり**（`timelineDurationSec`）。場面形式の「場面尺の合計」と違い、**置いていない時間（隙間）も含む**（再生ヘッドの上限・書き出しの長さの基準）。
- **その時刻の絵を描く時刻はフレームへ量子化する**（`frameTimeSec`）＝**格子へ落としてから**最後のフレームで頭打ちにする。落とさずにクランプすると、尺が格子に乗っていないとき**書き出しに存在しない時刻**の絵を描く。末尾を1フレーム手前へ寄せるのは、クリップの生存区間が半開で、尺のちょうど末尾ではどのクリップも外れて画面が真っ白になるため（場面形式の再生ヘッドは区間を閉じて「最後のフレームで場面が消えない」＝挙動を揃える）。
- **格子・実効 fps・位置のクランプは `domain/timeline/playback.ts` に1つずつ**（`quantizeToFrameSec` / `effectiveFps` / `clampTimelinePlayheadSec`）。描画（`frameTimeSec`）と再生が同じものを通る＝同じ規則を層をまたいで書かない（§6）。

#### 7.6.2.1 連続再生（#630）

`playbackTick(fromSec, elapsedSec, totalSec, fps)`（純粋）が「経過秒 → 見せる時刻」を決め、時計（`performance.now`／`requestAnimationFrame`）は app が持つ。

- **経過は「再生を始めた実時刻」から測る**（毎フレームの差分を足し込まない）＝端末が重くてフレームが落ちても、再生位置が実時間から遅れていかない（音を足したときの土台）。
- **ループしない**＝尺の終わりで自動的に止まる（書き出しと同じ長さで終わる）。**終端の判定は量子化の前**に行う（丸めて1フレーム手前になると永久に終われない）。
- **終端にいるときに再生を押したら先頭から**（`playbackStartSec`）＝押しても動かない状態を作らない。何も置いていない動画では始めない。
- **再生中に位置を動かしたら時計を測り直す**（世代番号を effect の依存にする。`playheadSec` を依存にすると effect 自身が更新して回り続ける）。時計自身の更新は**別の入口**を通し、世代番号を上げない。
- **編集・取り消しで再生を止める**（ADR-0032 追補の決定）。走っている位置を掴む操作（「再生位置へ」等）は**再生中は押させない**＝同じ操作の結果が毎回変わるのを防ぐ。ADR-0023 は「再生しながら編集」を志向していたが、位置を使う操作と両立しないため本形式では**止める**を採る。
- **尺が縮んだら位置を収める**（消した部品より後ろに取り残さない）。
- 画面を離れたら止める（`isPlaying` は文書の寿命、時計は画面の寿命）。

#### 7.6.2.2 音の鳴らし方（#630）

`audioCuesAt(doc, timeSec)`（純粋）が「その瞬間に鳴っている音」を返し、鳴らすのは app（`useTimelineAudio`）。
**時刻から一意に決まる**ので、途中から再生してもシークしても同じ結果になる（絵と同じ考え方）。

- **鳴る区間は `[startSec, startSec+durationSec)`**（絵と同じ半開＝V24 と揃える）。
- **隠したら鳴らない**：`track.hidden` は既定どおり無音、**`clip.hidden` も無音**（絵と同じ扱い＝見えないのに聞こえる、を作らない）。
- **音量の解決**（null=継承＝§6 と同じ流儀）：`voice` は `clip.volume` → `voiceSettings.volume` → `NARRATION_VOLUME`／`audio` は `clip.volume` → `BGM_VOLUME`。値域は `clampVolume`（0〜1.5）を共有。**既定を 1.0 で決め打ちにしない**＝焼き出しは指定が無いと `volume` を書かないので、BGM が場面形式の4倍で鳴る。
- **100%超は再生では上げない**（`HTMLAudioElement.volume` は 0〜1）。場面形式のプレビューは GainNode で増幅しており、本形式は**未対応**（書き出しを作るときに揃える）。
- **フェードは各端を尺の半分までに切り詰めてから掛ける**＝書き出しの BGM ミックス（`planBgmMix`）と同じ規則。規則を2つ持つとプレビューと書き出しの音が違う（ADR-0001）。
- **頭出しは `clipTimeAtSceneTime` を共有**（`sourceStartSec + 経過×speed`）。**`speed` は鳴らす側の `playbackRate` にも入れる**（頭出しだけ合わせるとずれ続ける）。
- **BGM（`kind:'audio'`）は素材が短くても鳴り続ける**（ループ＝場面形式のプレビュー・書き出しと同じ）。読み上げは繰り返さない。
- **音源は「音源の中身」で見分けて先に読む**（`audioSourceKey`）＝同じ曲を使う複数のクリップで使い回し、セッション中に増えたクリップ（複製）も読み直さずに鳴る。鳴らす瞬間に読みに行くと頭が欠ける。
- **音の出どころは種別で決める**（`voice` は `voice.voicePath` のみ・`audio` は `bundledBgmId`/`assetId`）＝優先順で黙って吸収しない（重複は §8 V25 が警告する）。
- **読めなかった音源・鳴らせなかった部品は、その部品だけ無音**（動画全体を開けなくしない）。鳴らせなかったものは**再試行しない**（毎フレーム要素を作り直さない）。案内は `15 §6` の `TIMELINE_AUDIO_SOURCE_MISSING`。
- 画面が隠れたら再生を止める＝時計（rAF）が止まっている間に**音だけ実時間で進む**のを防ぐ。
- **まだ鳴らないもの**（#630 の範囲外）：動画素材（`kind:'slot'`）と見た目パターンの差し込み口（`slotClips.useOriginalAudio`・ADR-0028）の**元音声**。書き出し（#631）で扱う。
- **焼き出しはスキーマに適合しない結果を保存しない**＝一覧に出るのに開けない動画を作らない（読込側が適合を要求するため・ADR-0026④）。

#### 7.6.3 編集操作（#629）

domain の純粋関数 **`src/domain/timeline/edit.ts`**。**置けない操作は黙って別の結果にしない**＝勝手に近くへ寄せたり上書きしたりせず、**置けなかった理由**（`15 §6` の `TIMELINE_EDIT_*`）を返す（§2-5・ADR-0026④）。

- **置ける条件は1か所**（`placementIssue`）＝列が実在・列の種別が合う（V23）・列が固定でない・同じ列で時間が重ならない（V24）。判定の規則は `validateTimelineDoc` と同じものを使う。
- **移動**は開始を 0 より前に出さない。**トリム**は動かした端だけを動かし、反対の端は据え置く。クランプは**端の編集の単一の参照元 `applyClipEdge`（#561）へ委譲**し、最小の長さは `TIMELINE_MIN_CLIP_SEC`（§2-7）＝自前で「長さを引き算してから丸める」と下限をわずかに割る。
- **何も変わらない操作は文書をそのまま返す**（同一参照）＝呼び出し側が履歴へ積まずに済む（取り消しが空振りしない）。
- **固定した列（`locked`）は動かせないだけでなく消せない**＝「動かせないのに消せる」という非対称を作らない（ADR-0026②）。固定の切替は画面に出す（案内した「次の行動」に到達できる）。
- **複製した読み上げは作成済みの音声を引き継がない**（場面形式の場面複製と同じ＝「作成済みに見えるのに別の部品の音声を指す」を作らない）。
- **削除はグループ・キーフレームの参照も片づける**（V26）。中身が無くなったグループは畳む。落とすのは**今回消したもの**と**畳んだグループ**への参照だけで、**元から参照切れだったものは触らない**（V26 は「描画で無視」＝掃除は `danglingTimelineRefs` を使う側の役割）。
- **列を消すと、その列のクリップも一緒に消える**（行き場が無くなるため）。消える数は `clipCountOnTrack` で事前に分かる＝画面が確認を出す。
- **重ね順は列の並べ替えそのもの**（`moveTrackOrder`）＝配列の並びだけで決まる（§7.6）。
- 取り消し/やり直しは**文書まるごとのスナップショット**（`domain/project/history` を共有）。**何も変わらない操作は履歴へ積まない**＝取り消しが空振りしない。**戻した文書に無いクリップは選択から外す**（消えたものを選んだままにしない）。
- **編集は自動保存する**（場面形式と同じ「閉じても消えない」＝ADR-0026②）。**スキーマに適合しないものは書かない**（焼き出しと同じ判断＝一覧に出るのに開けない動画を作らない）。保存中に更に編集されていたら「保存しました」にしない。
- 置ける条件の判定（V23 の対応表＝`trackKindForClip`／V24 の重なり＝`spansOverlap`）は **`validateTimelineDoc` から export して共有**する＝検証と編集で規則が割れない。
- **見た目パターンのクリップは差し込み口が生きている**（ADR-0032 決定5・#632）＝置いたあとも素材の入れ替えと
  文字の書き換えができる（`setClipAssetRef` / `setClipText`）。
  - **「なし」はキーごと落とす**。`null` と未指定は解決が同じ（どちらもテンプレ既定素材へ落ちる＝`§5`）ので、
    `null` を残すと**絵は変わらないのに文書だけ変わる**＝取り消しが1段空振りする。テンプレ既定素材を
    「なし」で消せないのは場面形式と同じ挙動（ADR-0026②）。
  - 文字は**空にしたらキーごと落とす**（空文字と未入力を別扱いにしない＝場面形式の `texts` と同じ解決）。
  - **固定した列（`locked`）の部品は中身も変えられない**＝「動かせない・消せないのに中身は変えられる」という
    非対称を作らない（ADR-0026②）。画面は欄自体を押せなくして理由を出す（入力が黙って戻らない）。
- **見た目パターンは素材として置ける**（ADR-0032 決定6・#632＝`addTemplateClip`）。置き先の列・時刻は指定で、
  空いていなければ置かない（寄せない・上書きしない）。**長さはテンプレを受け取って domain で決める**
  （`defaultDurationForTemplate`＝場面形式の「新しい場面」と同じ関数）＝同じテンプレが形式や呼び出し口に
  よって違う長さで出てこない（ADR-0026②）。**向きが違う見た目パターンは置かない**（層の座標がそのまま
  使われて画面外へ出る＝検証にも書き出しにも引っかからないまま出てしまう。画面も一覧を向きで絞る）。
  **箱（`x/y/w/h`）は持たない**＝未指定は画面いっぱい（`clipBox`）で、
  焼き出しと同じ持ち方＝向きを変えたときに片方だけ古い大きさで残らない。

#### 7.6.4 1フレームの描き方（#629）

`layoutTimelineAt(doc, timeSec, {templateOf})`（`src/renderer/timelineLayout.ts`・純粋関数）が「その瞬間の絵」を `SceneLayout` へ解決する。**1クリップの中身は `layoutScene` に委ねる**（テンプレのクリップは Scene へ、自由配置のクリップは FREE 要素1つの Scene へ写す）＝**描画の核は場面形式と共有**し、パリティ（ADR-0001）を二重に作らない。ここが担うのは「並べ方」だけ。

- **重ね順は `tracks` の並び順だけ**（後ろほど手前）。同一トラック内は時間が重ならない（§8 V24）ので一意に決まる。
- 生きている区間は **`[startSec, startSec+durationSec)`**（V24 と同じ半開区間）。
- **隠したトラック・隠したクリップ・隠したグループのメンバー・音のクリップ（`audio`/`voice`）は描かない。**
- **見た目が見つからないクリップは描かない**（他のクリップは描く。案内は呼び出し側＝§2-5）。
- **クリップは中身の座標系**。クリップに掛かる変形（グループ → 自身のキーフレームの順）はまず**クリップの箱**に効かせ、その**箱の動きを相似変換として中身へまとめて持ち込む**。中身のアイテムごとに拡縮を掛けると**各アイテム自身の中心**まわりになり、テンプレのクリップ（層が複数）でグループ中心まわりの剛体変形（`composeGroupGeometry`）とずれる。相似変換は「拡大率・回転角・1点の移り先」で決まるので、グループのアンカーは箱の中心の移り先に畳み込まれる。
- 不透明度だけは幾何と違い**クリップ全体に等しく効く**ので、アイテムへ掛けずに**合成の単位**（`LayoutItem.composite = { key, opacity }`）として渡し、`sceneSvg` が**連続する同じキーを `<g opacity>` で1枚にしてから**掛ける（ADR-0032 決定19・#631）。アイテムごとに掛けると層が重なる所で下が透け、`xfade=fade`（線形ブレンド）と別の絵になる。アイテム自身の `opacity`（FREE 要素の濃さ）は**触らない**＝潰さない／区間外クランプで 1 に化けない。
- **合成の単位は α の出どころで決まる**：クリップ自身のキーフレームならクリップ、**グループのキーフレームならグループ全体**（FREE 場面の切り替えが場面まるごと1枚になる＝要素どうしがフェード中だけ互いに透ける、を防ぐ）。グループのメンバーは連続した列に並ぶ（`TrackAllocator`）ので、並びも1かたまりになる。
- **場面形式は `composite` を設定しない**＝この仕組みは場面形式の出力に影響しない。
- ⚠️ **書き出しの帯分割（`videoSceneSplit`）は合成の単位を跨いで切る**（動画スロットを穴にして下/中/上へ割る）。タイムライン形式の書き出しでこれを再利用すると1枚合成が崩れ、クリップ全体のフェードが動画スロットへ乗らない。**#631 では per-frame の全描画へ倒す**（ADR-0032 決定10「迷ったら全フレーム描画」）か、跨ぐときは分割を拒否して理由を返すこと。
- **字幕のクリップ**（`kind:'subtitle'`）は、焼き付けた文言（`clip.text`）を `texts.subtitle` として渡す。FREE 字幕要素は表示文を「対象」から解決する（ADR-0029）が本形式に対象の語彙が無いため、これが無いと §7.6.1 で「黙って消さない」ために焼き付けた字幕が**受け側で1つも描かれない**。
- **文字のフォント**：クリップ全体の `fontId` は**種別ごとの指定（`textFontIds`）が無いときの受け皿**としてアイテムへ落とす。場面形式はフレーム単位の `fontFamily` で効かせるが、1フレームに複数クリップが混ざる本形式ではそれができない（テンプレのクリップだけ黙って既定へ戻るのを防ぐ・ADR-0026②）。
- **見た目の下地**（`template.defaults.backgroundColor`）は、そのクリップの箱ぶんの塗りとして最背面へ足す＝背景の層を持たない見た目でも下地が黙って白にならない。


---

#### 7.6.5 書き出し（#631）

**常に全フレーム描画**（ADR-0032 決定22）。`timelineFramePlan(doc)` が何フレーム描くかを決め、
`frameTimeAt(i, fps)` の時刻で `layoutTimelineAt` を回して1枚ずつ焼く＝**プレビューと同じ1経路**。

置き場所は `src/domain/timeline/export.ts`（domain の純粋関数＝§4）。

- **出力の尺はフレーム数から導く**（`frameCount / fps`）＝端数の尺でも映像と音の長さが食い違わない。
  端数は**切り上げ**＝置いたものが末尾で切れない（四捨五入は下へ丸まる尺で語尾が落ちる）。切り上げても
  最後のフレームの時刻は必ず尺の中なので空白のフレームは増えない。何も置いていない動画は 0 フレーム
  （呼び出し側が書き出しを止める）／とても短くても最低1フレーム。
- **フレームの時刻はプレビューと同じ格子**（`k / fps`）＝見た絵と書き出した絵が一致する。
  **格子点をもう一度量子化しない**（掛け算の誤差で1つ前のフレームへ落ち、同じ絵を2枚焼く）。
- **音は `timelineAudioRuns(doc)` が「どこに・どれだけ・どの音量で」置くかを返す**。場面形式の BGM 区間
  （`BgmRunInput`）と同じ形なので、**混ぜる側（FFmpeg の adelay/atrim/afade/amix）は作り直さない**。
  音量とフェードは**再生と同じ関数**（`clipBaseVolume` / `clipFadeSec`）から採る。
- **音源ファイルの拡張子も渡す**（`fileExt`）。音源キーからは復元できない（同梱BGMの id・読み上げの保存先は
  拡張子を持たない）ので、同梱BGM＝目録／持ち込み＝素材の保存先／読み上げ＝音声の保存先から採る＝
  **実際のファイルに合わせる**（判らないときだけ既定）。切り出しの規則は `fileExtension`（domain）と共有。
- **トリム（`sourceStartSec`）と速度（`speed`）も渡す**。受け口が無いと「素材の途中から」「倍速」が黙って
  無視され、聞いた音と書き出した音が違う（`BgmRunInput.sourceStartSec`/`speed`・未指定＝頭から・等速）。
  切り出しは**素材の時間**で見る（速度ぶん長く読む）ので、置いた長さは速度を変えても変わらない。
  速度が `atempo` 1段の範囲（0.5〜2.0）を外れるときは**掛け算で分ける**＝値を丸めない（ADR-0026①）。
- **繰り返すのは音のクリップ**（同梱BGM・持ち込みの音＝`loop`）。**読み上げは繰り返さない**。場面形式の
  BGM 混合は常にループする実装なので、この区別を渡さないと**読み上げが繰り返されて言葉が二重に鳴る**
  （`BgmRunInput.loopSource`・未指定＝従来どおりループ）。
- **⚠️ 動画クリップの元音声はまだ扱えない**（`kind:'slot'` は音源を持たない＝`timelineAudioRuns` に出ない）。
  絵も1枚の静止画として描かれるので、**動画の素材を置いてあるだけで書き出しを断る**
  （`timelineExportBlockers`＝静止画＋無音の動画を成功として出さない・ADR-0026④）。
  **見た目パターンが見つからない部品があるときも断る**（描かれない＝そこが丸ごと絵から消えるので、
  警告だけで通さない＝場面形式の書き出し停止と同じ扱い）。判定材料（読み込めている見た目の一覧）が
  渡されないときは見ない＝**嘘の理由を出さない**。
- **描くのは `buildTimelineFrames`**（`renderer/export`）＝`layoutTimelineAt(doc, t)` → SVG → PNG を
  フレーム数ぶん回し、1枚ずつディスクへ逃がす（数千フレームの base64 を配列に溜めない）。**プレビューと
  同じ入力**（見た目パターン・素材の src）を画面から受け取る＝見えているものがそのまま出る（ADR-0001）。
  出来上がりは場面形式の**アニメ場面と同じ形**（`framesDir`＋`fps`＋`durationSec`）なので、**FFmpeg 側は
  `frames_scene_args` をそのまま使う**＝書き出しの IPC を増やさない。
- **走っている間は文書と入力を固定する**。描くのに使うもの（素材の表示先・音源）は**始めた時点のものを
  取っておく**＝途中で別の動画を開かれても混ざらない。さらに**書き出し中は別の動画を開けず・編集も
  取り消しもできない**（`TIMELINE_EDIT_EXPORTING`）＝焼くのは始めた時点の文書なので、入らない編集を
  受け付けて「直したのに反映されていない動画」を成功にしない（ADR-0026①）。
- **形式をまたいで同時に書き出さない**（`exportLock`）。場面形式とタイムライン形式は別の状態を持つが、
  一時ファイルの置き場はアプリで1つ（片づけは置き場を丸ごと消す）＝片方が相手のフレームを消して
  壊れた動画が出る。どちらの入口でも同じ締めを見て、走っている間は始めない（§2-5 で理由を出す）。
- **同梱フォントは描く前にそろえる**（`loadExportFonts`）。ラスタライズは読み込み済みの字体しか使えず、
  画面に出ていない字を焼くと**プレビューと違う字**になる。動画全体のフォント（`videoSettings.fontId`）は
  部品ごとの指定が無いときの受け皿として渡す（`11 §6` 継承・渡さないと既定の字体へ化ける）。
- **クレジット（VOICEVOX）は毎フレーム焼き込む**（ADR-0003・`13 §4`）。出すキャラは**その時刻に
  しゃべっている声**（`creditSpeakerAt`＋`creditForLine`）＝場面形式の掛け合いと同じ挙動（ADR-0026②）。
  誰もしゃべっていない時刻は動画の既定の声＝**クレジットが消える瞬間を作らない**。
  プレビューも同じものを出す（見えていたものと違う動画を出さない）。

## 8. 検証ルール（コード化可能な形）

AI出力・テンプレ・プロジェクト読込時に実行。**JSON Schema で表現できるもの**＝型・必須・enum・範囲（`schemas/` に内包）。**Schema で表せない相互参照・横断条件**＝下記をドメインで実装。

| # | チェック | 失敗時 |
|---|---|---|
| V1 | JSONパース可 / `schemaVersion` 対応範囲 | 致命: 再生成 or 読込拒否 |
| V2 | スキーマ適合（型・必須・enum・範囲） | 致命 or 補正（§9） |
| V3 | `templateId` が実在 | 取り込み時＝補正（§9）／既存場面＝警告のみ（置換しない・`15 §6`） |
| V4 | `assetRefs` の各 assetId が実在 | 補正/警告（§9） |
| V5 | `poseAssetId`（解決後）が実在 yuko asset | 既定yukoへ置換（§9） |
| V6 | テンプレ必須スロット/必須テキストが埋まっている | 警告（required=true のみ） |
| V7 | `durationSec` が範囲内（手編集＝`>0`／AI 生成＝目安 `[3, テンプレ上限 or 15]`・#553） | clamp（§9） |
| V8 | テキスト長 ≤ テンプレ上限（`maxNarrationLength`等）。**掛け合い（`lines`/`narrationLines`）があるときは各行が対象**（単一 `narration` はその1行）＝生成時（`transformPlan`）と公開前チェック（`sceneLines`）で**同じ対象**を見る（#569・ADR-0026②）。閾値の継承順はテンプレ `aiHint` → 既定定数で両者共通（#568） | 警告＋短縮提案 |
| V9 | 合計尺 ≤ `videoSettings.maxDurationSec` | 警告 |
| V10 | シーン数 ≤ `MAX_SCENES_PER_VIDEO` | 警告（異常検知） |
| V11 | `part.sceneIds` と `scenes[].partId` の整合 | 致命: 再構築 |
| V12 | `scene.freeLayout[]`（slot）の `assetId`（非null時）が実在素材か | 警告（`ASSET_NOT_FOUND`） |
| V13 | `scene.freeLayout[]` の `w>0` かつ `h>0` | 警告（`FREE_ELEMENT_INVALID_SIZE`） |
| V14 | `scene.freeLayout[]` が canvas を著しく逸脱していない（矩形が画面と全く重ならない場合のみ。一部のはみ出しは演出として許容） | 警告（`FREE_ELEMENT_OUT_OF_BOUNDS`） |
| V15 | `scene.freeLayout[]`（text）の文字が空でない | 警告（`FREE_TEXT_EMPTY`・info） |
| V16 | `scene.lines[]` の `lineId` が scene 内一意 | 致命: 再採番 |
| V17 | `scene.lines[]` の `startSec` が `[0, scene.durationSec]` | clamp/警告（§9） |
| V18 | `scene.lines[]` を `startSec` 昇順・時間重複なし（`startWithPrevious` の行は**同時開始＝並行**ゆえ対象外＝`startSec` を持たない・ADR-0031） | 警告/補正（§9） |
| V19 | `scene.lines[]` の `speaker` が `voiceCatalog` に実在 | 既定声へ補正＋警告（§9） |
| V20 | `scene.groups[]`/`template.groups[]` の `members` が実在 id を参照（要素/レイヤー、ネストで group id） | 描画で無視（堅牢性）＋削除経路で除去（`removeMembersFromGroups`・ADR-0022 V_group・#308） |
| V21 | `timelineOverlay.clips[]` の `anchorSceneId`（指定時）が実在 scene を参照 | 描画で無視（堅牢性・`compileTimeline` が合成時に skip・**V_overlay**・ADR-0018） |
| V22 | `clips[].trackId` が実在 track を参照 | 警告（`TIMELINE_TRACK_NOT_FOUND`）＝描画・書き出しから外れるので黙って消さない（§2-5） |
| V23 | `clips[].kind` が track の `kind` と合う（`audio` は audio トラック・それ以外は visual トラック） | 警告（`TIMELINE_CLIP_TRACK_KIND`） |
| V24 | **同一トラック内でクリップの時間が重ならない**（`[startSec, startSec+durationSec)` が互いに素・端が接するのは可） | 警告（`TIMELINE_CLIP_OVERLAP`）＝重ねたいならトラックを足す |
| V25 | `clips[]` の `assetId`（非null時）が実在素材／**音の出どころ**（`assetId`／`bundledBgmId`／`kind='voice'`）が**高々1つ** | 警告（`ASSET_NOT_FOUND` / `TIMELINE_AUDIO_SOURCE_CONFLICT`） |
| V26 | `groups[].members` ／ `animations[].targetId` が実在クリップ or グループを参照 | 描画で無視（堅牢性・V20 と同じ扱い） |
| V27 | `clips[].character.poseAssetId`（非null時）が実在 yuko 素材（場面形式 V5 と同じ観点） | 警告（`ASSET_NOT_FOUND`・field は `clips.<id>.character`） |
| V28 | `kind='voice'` の読み上げ文が空白だけでない／`voice` は読み上げクリップにだけ付く | 警告（`TIMELINE_VOICE_TEXT_EMPTY`＝info・`TIMELINE_VOICE_ON_NON_VOICE`） |

> V22–V28 は **タイムライン形式（ADR-0032・#627／読み上げは #628）**。domain の純粋関数 **`validateTimelineDoc`（`src/domain/timeline/validateTimelineDoc.ts`）** が `Warning[]` を返す。**V24 が本形式の要**＝同一トラックで時間が重ならないので、**重ね順は tracks の並び順だけで一意に決まる**（クリップごとの zIndex を持たない）。ID 一意（`clip_NNN`/`track_NNN`/`anim_NNN`）は V16 と同じ扱いで再採番。番号は §8 の続き。

> V12–V15 は ADR-0008 §8。FREE テンプレ場面（`sceneType=free`）の `freeLayout` を対象とし、domain の純粋関数 `validateFreeLayout`（`src/domain/project/freeLayout.ts`）で実装。`free_NNN` 要素ごとに `Warning.field=freeLayout.<id>` を付す。V13 が不正なら矩形が確定しないため V14 はスキップ（二重警告を避ける）。
> kind 別の構造的「必須」（`slot` の `fit` が assetId 非null時・`shape` の `shapeType`）は **Schema（`exclusiveMinimum`/enum）＋ renderer 既定（fit 未指定=cover・shapeType 未指定=rect）で担保＝V2 相当**とし、上記 domain 検証（意味検証）の対象外。`fit` は §2-3 の技術用語のため UI 警告に出さない。
> V16–V19 は ADR-0015。掛け合いのセリフ列（`scene.lines`）を対象とし、domain の純粋関数 **`validateSceneLines`（`src/domain/project/narrationLines.ts`・PR-C）** が `Warning[]` を返す（V16 重複/V17 範囲/V18 順序/V19 speaker 実在）。コード語彙は `15 §6`（`LINE_*`）。**自動補正（再採番/clamp）の適用は lines を編集・生成する段（PR-C2/PR-F）**。`scene.lines` 不在（単一 narration）の場面は対象外（`sceneLines()` が1行へ解決）。番号は §8 の続き。

---

## 9. 自動補正ルール（論点⑥・`07 §10` を定数で統一）

| 問題 | 補正 |
|---|---|
| 存在しない `templateId` | **取り込み時（AI出力→場面への変換）のみ**、同 `category`・同 `orientation` の標準テンプレ（マイ見た目を除く）へ置換（無ければ警告し選択を促す）。**既存プロジェクトの場面は置換しない**＝警告のまま書き出しを停止し、標準へ寄せるのは利用者の明示操作「まとめて標準にする」（`15 §6` `TEMPLATE_NOT_FOUND`・#547） |
| テンプレの `aspectRatio` がプロジェクトの向きと不一致 | 同 `category`・同 `orientation` のテンプレへ置換（無ければ警告・原状維持／ADR-0012・B4）。**取り込み時はマイ見た目を当て先にしない**（ADR-0017）／利用者が向きを変える操作ではマイ見た目も当て先にする |
| 存在しない `assetId` | `null` にし、未使用素材から候補提示（警告） |
| `durationSec <= 0` / NaN（**手編集の確定時**） | `SCENE_DEFAULT_DURATION_SEC`（8秒）へ＝壊れた入力の既定（0秒の場面は作らない・#553） |
| `durationSec > VIDEO_HARD_MAX_SEC`（**手編集の確定時**） | `VIDEO_HARD_MAX_SEC`（600秒）へ＝1場面に効く唯一の硬い天井（#553） |
| `durationSec < AI_SCENE_MIN_DURATION_SEC`（**AI 生成時のみ**） | `AI_SCENE_MIN_DURATION_SEC`（3秒）へ＝生成のペース配分の目安（手編集は縛らない・#553） |
| `durationSec >` テンプレ上限（**AI 生成時のみ**） | テンプレ `aiHint.maxDurationSec`（無ければ `AI_SCENE_MAX_DURATION_SEC`=15秒）へ。**手編集は縛らない**（`VIDEO_HARD_MAX_SEC` で頭打ち・#553） |
| テンプレ上限が生成の下限を下回る（`aiHint.maxDurationSec < AI_SCENE_MIN_DURATION_SEC`） | **上限を優先**（範囲は上限の1点へ潰れる）＝#607。下限は全テンプレ共通の既定で per-template の上書きが無いのに対し、上限は**そのテンプレについて作者が明示した値**なので、具体的な宣言を一般的な既定より優先する（ADR-0026①）。どちらも #553 の「生成の目安」で硬い制約ではないため、`durationSec > 0`（`§7`）は保たれる。警告は既存の `DURATION_CLAMPED` のまま（`aiHint` は作成エディタ非開放＝利用者に別の次の行動が無い・`§2-5`） |
| `poseTag` 解決不可 / `poseAssetId` 不在 | 既定yuko（`isDefaultYuko` → 無ければ先頭 yuko）へ。yuko素材皆無かつ character 任意 → 非表示 |
| テキストがテンプレ上限超過 | 警告＋「AIで短くする」提示（自動切詰めはしない） |

補正は `scene.warnings[]` に記録し、UIには件数と「対応内容」を非技術語で表示（`01 §6.7`）。

---

## 10. 関連

- 実スキーマ: `schemas/project.schema.json` / `schemas/template.schema.json` / `schemas/ai-video-plan.schema.json`
- AI出力→内部Scene の変換マッピング: `12_AI_PROMPT_AND_MAPPING.md §8`
- 解説（例示）: `03_DATA_SCHEMA.md` / `04_TEMPLATE_SPEC.md`
