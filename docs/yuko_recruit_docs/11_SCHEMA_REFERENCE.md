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

- 各スキーマは独立した `schemaVersion`（semver文字列）を持つ。初期は全て `"1.0"`。**project は ADR-0011 で `"1.1"`**（`videoKind`/`generalBrief` の追加・`additionalNotes` を companyInfo→トップレベルへ移動）、**ADR-0012 で `"1.2"`**（`videoSettings.width/height` を撤廃し `aspectRatio` を寸法の単一の真実に・`aspectRatio` に `9:16` を追加＝後方互換のマイナー）、**フォント選択で `"1.3"`**（`videoSettings.fontId`＝同梱フォントの id を追加・任意・後方互換のマイナー）、**標準BGM選択で `"1.4"`**（`bgmSettings.bundledBgmId`＝同梱BGMの id を追加・任意・後方互換のマイナー）、**場面ごとのフォントで `"1.5"`**（`scene.fontId`＝場面のフォントの id を追加・任意・null/未指定は動画全体を継承・後方互換のマイナー）、**FREE 図形の拡張で `"1.6"`**（freeLayout shape の `shapeType` に `rounded_rect`/`triangle`/`star`/`arrow`/`speech_bubble` を追加し `strokeColor`/`strokeWidth`＝枠線を追加・いずれも任意・後方互換のマイナー＝#173）、**テキストごとのフォントで `"1.7"`**（`FreeElement.fontId`＝FREE/パーツのテキスト要素ごと＋`scene.textFontIds`＝textKey 別のフォント上書きを追加・いずれも任意・後方互換のマイナー＝#178）、**掛け合いで `"1.8"`**（`scene.lines`＝NarrationLine[] のセリフ列＋`scene.subtitleEnabledDefault` を追加・いずれも任意・null/未指定は継承・`narration` 残置・後方互換のマイナー＝ADR-0015/#180）、**FREE 要素の回転で `"1.9"`**（`FreeElement.rotation`＝度・0以上360未満・任意・未指定=回転なし・後方互換のマイナー＝#208）、**FREE text の体裁で `"1.10"`**（`lineHeight`＝行間倍率0.5〜3＋`textAlign`＝揃え left/center/right を追加・縁取りは既存 `strokeColor`/`strokeWidth` を text にも適用・いずれも任意・後方互換のマイナー＝#209）、**FREE 要素の非表示/ロックで `"1.11"`**（`hidden`＝非表示・`locked`＝ロックを追加・いずれも任意・後方互換のマイナー＝レイヤー一覧・#210）、**掛け合いの行ごとの抑揚で `"1.12"`**（`NarrationLine.intonation`＝抑揚0.0〜2.0 を追加・任意・null/未指定は場面/動画の既定を継承・後方互換のマイナー＝#242）、**場面ごとの画像の収め方で `"1.13"`**（`scene.slotFits`＝スロット別の収め方上書き object を追加・任意・未指定はテンプレ層の `fit` を使用・後方互換のマイナー＝④）、**要素のグループ化で `"1.14"`**（`scene.groups`＝要素のグループ化（`Group[]`・自前 transform を持つ独立オブジェクト・ネスト可）を追加・任意・未指定＝グループ無し・後方互換のマイナー＝ADR-0022）、**場面横断タイムラインで `"1.15"`**（`timelineOverlay`＝場面横断タイムラインの上位編集〔場面アンカー＋絶対時間の `OverlayClip[]`。まず telop トラック〕を追加・任意・未指定＝場面射影のみ・後方互換のマイナー＝ADR-0018）、**場面ごとのBGMで `"1.16"`**（`scene.bgmSettings`＝場面のBGM設定〔`BgmSettings`〕を追加・任意・未指定＝プロジェクト既定〔`bgmSettings`〕を継承〔null=継承〕・`enabled:false` でこの場面は無音・後方互換のマイナー＝ADR-0018 ③(7)）、**要素アニメーション（キーフレーム）で `"1.17"`**（`timelineOverlay.animations`＝`ElementAnimation[]`〔場面内の1要素を時間で補間・FREE 要素／グループ id が対象・timelineOverlay 格納ゆえ AI/場面正準は不変〕を追加・任意・未指定＝アニメ無し＝静止・後方互換のマイナー＝ADR-0019 ④）、**動画スロット再生開始タイミングで `"1.18"`**（`scene.slotVideoStart`＝スロット別の再生開始モード〔`{ mode: withAnim/afterAnim/delay, delaySec? }`〕を追加・任意・未指定＝`withAnim`＝アニメと同時・スロット本体アニメ場面でのみ有効・後方互換のマイナー＝ADR-0027・#444）、**動画クリップ調整の per-use 上書きで `"1.19"`**（`scene.slotClips`＝スロット別のクリップ上書き〔`startSec`/`endSec`/`speed`/`useOriginalAudio`/`originalAudioVolume`。`fit` は除く＝`slotFits` が担う〕を追加・任意・未上書きフィールドは `asset.clip` を継承・後方互換のマイナー＝ADR-0028・#472）、**FREE 字幕要素で `"1.20"`**（`FreeElement.kind` に `subtitle`＝自由配置の字幕要素を追加し、`FreeElement.subtitleSource`＝字幕の対象〔`{kind:'narration'}`＝読み上げ `texts.subtitle`／`{kind:'allLines'}`＝掛け合いの全行／`{kind:'speaker', speaker}`＝特定の実効話者〕を追加・いずれも任意・**未指定＝後方互換**〔単独→読み上げ・掛け合い→全行へ無変換解決〕・後方互換のマイナー＝ADR-0029・#521）、**掛け合いの同時開始で `"1.21"`**（`NarrationLine.startWithPrevious`＝直前の行と**同時に**開始〔並行して重ねて流す・`true` の連続で N 人同時〕を追加・任意・未指定/`false`＝逐次〔従来どおり〕・`startSec` を保存しないので **V18〔重なり禁止〕に触れない**・後方互換のマイナー＝ADR-0031・#530）、**FREE 要素の任意表示名で `"1.22"`**（`FreeElement.name`＝重ね順一覧/選択チップの見分け用の任意表示名〔全 kind 共通・テンプレの `Layer.name` に相当〕を追加・任意・**未指定＝種類＋連番の自動名にフォールバック**・後方互換のマイナー＝#525-12）、**FREE 字幕/文字の背景帯で `"1.23"`**（`FreeElement.background`＝FREE の text/subtitle 要素の背景帯〔可読性の下地・`{enabled?,color?,opacity?,radius?}`・通常字幕層 `layer.background` と同型〕を追加・任意・**未指定/`enabled:false`＝背景帯なし**・通常→FREE 化で移送〔ADR-0030〕・後方互換のマイナー＝#529）、**文字の体裁の場面別上書きで `"1.24"`**（`scene.textStyles`＝テキスト種別ごとの体裁上書き〔`{color?,fontSize?,fontWeight?,strokeColor?,strokeWidth?}`・`$defs/TextStyle`・制約は Layer/FreeElement の同名プロパティと同一〕を追加・任意・**各プロパティ未指定＝テンプレ層→既定を継承**〔触ったものだけ固有値〕・**配置/座標はテンプレ駆動のまま**〔§2-4 の対象は配置＝体裁は対象外・`textFontIds` と同型の前例踏襲〕・AI は生成しない〔利用者編集専用〕・後方互換のマイナー＝#555）。template は `aspectRatio` に `9:16` を追加（enum 追加＝非破壊で `"1.0"` 据え置き）、さらに Layer に `strokeColor`/`strokeWidth`＝text/subtitle の縁取りを追加（任意・後方互換のマイナー＝#275。template はマイグレーション機構を持たず、非破壊の追加は版を上げない方針＝aspectRatio 9:16 と同じ。さらに `template.groups`＝要素のグループ化（ADR-0022）と Layer の `rotation`＝回転（0以上360未満・FreeElement と同仕様・#307）も任意追加で版据え置き）。ai-video-plan は **`narrationLines`（掛け合い・任意追加）を加えても後方互換ゆえ `"1.0"` 据え置き**（AI出力は transient で永続化/migration 不要・optional 追加のため版を上げない＝ADR-0015 PR-G/#180）。
  - 移行: 既存 `"1.0"`〜`"1.6"` の project.json は読込時に `"1.7"` へ更新（`videoKind` 省略＝recruit 既定、`companyInfo.additionalNotes` をトップレベル `additionalNotes` へ移送、`videoSettings.width/height` を除去、`videoSettings.fontId` 未指定は既定フォントを補完、未知の `bgmSettings.bundledBgmId` は標準BGM未選択へ落とす、未知の `scene.fontId` は継承（未指定）へ落とす。`"1.5"`→`"1.6"` は FREE 図形種別・枠線の追加のみで版番号の付け替え以外の変換は不要＝#173。`"1.6"`→`"1.7"` はテキストごとのフォント追加のみで変換不要＝#178。`"1.7"`→`"1.8"` は掛け合い（`scene.lines`/`subtitleEnabledDefault`）の任意追加のみで変換不要＝ADR-0015/#180。`"1.8"`→`"1.9"` は FREE 要素の回転（`FreeElement.rotation`）の任意追加のみで変換不要＝#208。`"1.9"`→`"1.10"` は FREE text の体裁（`lineHeight`/`textAlign`）の任意追加のみで変換不要＝#209。`"1.10"`→`"1.11"` は FREE 要素の `hidden`/`locked` の任意追加のみで変換不要＝#210。`"1.11"`→`"1.12"` は `NarrationLine.intonation` の任意追加のみで変換不要＝#242。`"1.12"`→`"1.13"` は `scene.slotFits` の任意追加のみで変換不要＝④）。
- **互換性方針**: マイナー（`1.x`）＝後方互換の追加のみ。メジャー（`2.0`）＝破壊的変更で、読込時にマイグレーション関数を通す。未知のメジャーは読込拒否しユーザー向けに告知。
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
| `renderStatus` | `idle` / `running` / `completed` / `failed` / `cancelled`（ユーザー中止・#380） |
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

---

## 5. アセット ⇄ テンプレレイヤー バインディング契約（論点②）

**原則: `scene.assetRefs` のキーは、テンプレの「素材を受けるレイヤー」の `id` と一致させる。レンダラーは id 一致で素材を流し込む。**

| レイヤー `type` | 素材の供給元 | バインドキー |
|---|---|---|
| `background` | `scene.assetRefs.background` | レイヤー `id`（= `background`） |
| `slot` | `scene.assetRefs[<layer.id>]`（例 `mainVisual`） | レイヤー `id` |
| `logo` | `scene.assetRefs.logo` | レイヤー `id`（= `logo`） |
| `character` | `scene.character.poseAssetId` | 専用（assetRefs を使わない） |
| `text` / `subtitle` | `scene.texts[<textKey>]` | レイヤーの `textKey` |
| `decor` / `shape` | テンプレ内 `assetId` / 図形定義 | 固定（シーン素材ではない） |

**規則**
- `assetRefs` のキー集合 ⊆ テンプレ内の `background`/`slot`/`logo` レイヤーの `id` 集合。
- 値が `null`/未指定: テンプレ既定素材（`layer.assetId`）があればそれを表示（ADR-0021・場面素材が優先・無ければテンプレ既定へ委譲）。無ければ レイヤー `required=false` → 非表示、`required=true` → 検証警告（§8）。
- `slotType` と素材の `assetType` が不整合（例: `image` スロットに `video`）→ 補正/警告（§9）。
- 旧 `01_REQUIREMENTS.md` 例の `type:"asset" + assetRole` 表記は本契約（typed layer + id一致）に置き換える。
- **見た目パターン切替時の清算（issue #236・`switchSceneTemplate`）**：場面の `templateId` を変えたら、`assetRefs` は**新テンプレのスロット id へ清算**する（上記キー集合の不変条件を保つ＝ダングリング防止）。一方 **`texts` / `textFontIds` / `textStyles` は清算せず保持**する＝これらは固定の `TextKey` enum（§3.4）がキーで**テンプレ非依存ゆえダングリングにならず**、別パターンへ変えて戻したとき入力が復元される（描画は未使用 textKey を無視）。`assetRefs` と**非対称だが意図的**（保持を採用）。

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
| durationSec | number | ● | `> 0`（**場面ごとの上限/下限は持たない**・#553）。手編集の確定は §9 で `(0, VIDEO_HARD_MAX_SEC]` へ自動補正。AI 生成時のみ目安 `[AI_SCENE_MIN, テンプレ上限 or AI_SCENE_MAX]` へ寄せる |
| assetRefs | object | ● | §5。値は既存 assetId or null |
| character | object | ● | enabled / characterId / poseAssetId(既存 yuko asset or null) |
| texts | object | ● | title / main / subtitle / caption / url（各 string、テンプレ必須キーは必須） |
| narration | object | ● | text ● / voiceId○ / speed○ / pitch○ / intonation○ / voicePath○ / status(enum) ● |
| audioMix | object | ○ | §6（全フィールド任意・null可） |
| transition | object | ○ | in/out(enum) / durationSec（既定 `TRANSITION_DEFAULT_SEC`）/ direction(enum `left`/`right`/`up`/`down`・slide 用・ADR-0009) |
| warnings | Warning[] | ● | 検証・補正の結果（空配列可） |
| freeLayout | FreeElement[] | ○ | **有効なのは FREE テンプレの場面のみ**（描画/編集/事前確認/素材使用は `templateOf(scene).category===free` でゲート）。**通常テンプレへ切り替えても休眠データとして保持**し、FREE へ戻すと復元（`texts` 休眠と同じ・ADR-0030／#236）。通常→FREE 切替時は表示中の内容（スロット素材＋文字＋**体裁**〔`textStyles` 解決後の実効値＝#555〕）を旧テンプレ幾何ごと自動変換（seed）。**ただし文字/字幕の枠高だけは「同じ行数が入る高さ」へ広げる**＝通常は `maxLines`（既定2）で行数が決まるのに対し FREE は枠高から行数を導出するため、そのまま持ち込むと行が減って文字が切り詰められる（縮めはしない＝回転の中心が動かないように・#555 レビュー P1）。自由配置要素（ADR-0008・id=`free_NNN`(scene内一意)・kind: slot/text/shape/**subtitle**（字幕＝ADR-0029・1.20）・x/y/w/h は canvas基準で w>0/h>0。shape の `shapeType`＝rect/ellipse/rounded_rect/triangle/star/arrow/speech_bubble、枠線/縁取り `strokeColor`/`strokeWidth`（shape=枠線・text=文字の縁取り＝#209）は任意・1.6。text の `fontId`（同梱フォント・null/未指定＝場面/全体を継承）は任意・1.7。`rotation`＝回転角（度・0以上360未満・中心を軸に時計回り・未指定=回転なし・360=0は除外）は任意・1.9＝#208。text の `lineHeight`＝行間（倍率0.5〜3・未指定=1.3）＋`textAlign`＝揃え（left/center/right・未指定=left）は任意・1.10＝#209。`hidden`＝非表示（true で描画/操作対象から除外）・`locked`＝ロック（true で移動/拡縮を禁止）は任意・1.11＝#210。`name`＝任意の表示名（重ね順一覧/選択チップの見分け用・全 kind 共通・未指定=種類＋連番の自動名）は任意・1.22＝#525-12。`background`＝text/subtitle の背景帯（可読性の下地・`{enabled,color,opacity,radius}`・通常字幕層 `layer.background` と同型・未指定/`enabled:false`=なし・通常→FREE で移送）は任意・1.23＝#529） |
| lines | NarrationLine[] | ○ | 掛け合い：時間順のセリフ列（§7.4b）。あれば実効タイムライン（`sceneLines()`）。未設定＝単一 `narration` を1行とみなす（1.8・ADR-0015・#180） |
| subtitleEnabledDefault | bool | ○ | 場面の字幕既定 ON/OFF（行 `subtitleEnabled` 未指定時に継承・1.8） |
| slotFits | object | ○ | 場面ごと・スロット別の画像の収め方上書き（キー＝テンプレの `background`/`slot`/`logo` の layer.id、値＝`cover`/`contain`/`stretch`）。未指定＝テンプレ層の `fit` を使用（1.13・④） |
| slotClips | object | ○ | 場面ごと・スロット別の**動画クリップ調整の per-use 上書き**（キー＝スロットの layer.id、値＝`{ startSec?, endSec?, speed?, useOriginalAudio?, originalAudioVolume? }`）。`fit` は含めない（per-use は `slotFits`）。未上書きフィールドは `asset.clip`（素材既定）を**継承**（`slotClips ?? asset.clip ?? 既定`・null=継承 §6）。scenes に載るので**Undo 可**（ADR-0020）。同じ動画を場面ごと別範囲で使える（1.19・ADR-0028・#472） |
| slotVideoStart | object | ○ | 動画スロット本体アニメの再生開始タイミング（キー＝スロットの layer.id、値＝`{ mode, delaySec? }`）。`mode`＝`withAnim`（アニメと同時・既定）/`afterAnim`（アニメの後）/`delay`（`delaySec`≥0 秒だけ遅らせて途中から）。**`mode=delay` は `delaySec` 必須**（schema if/then で強制＝「途中から」が黙って「同時」に落ちない）。`delaySec` は `mode=delay` のときのみ意味を持ち、**保存値は上限なし・描画で `[0, animEnd]` にクランプ**（UI のスライダー上限＝アニメ長で頭打ち＝保存値と実効値を一致させる）。**mode を `delay` 以外へ切り替えたら `delaySec` は落とす**（stale 値を残さない・アニメ削除時のエントリ破棄と同流儀）。**スロット本体がアニメ対象の場面でのみ効く**（`slotIsAnimated`）。未指定＝`withAnim`（1.18・ADR-0027・#444） |
| groups | Group[] | ○ | 要素のグループ化（メンバー＝`freeLayout` 要素 id、ネストで group id も可。グループ自身の `transform` を持つ）。未設定＝グループ無し（1.14・ADR-0022） |
| bgmSettings | object | ○ | 場面ごとのBGM（`BgmSettings`）。未指定＝プロジェクト既定（`bgmSettings`）を継承（null=継承）。`enabled:false` でこの場面は無音。`compileTimeline` は実効BGM（場面 ?? プロジェクト）が同じソースの連続場面を1区間にまとめる（連続する同曲は途切れない）（1.16・ADR-0018 ③(7)） |

**7.4b NarrationLine**（掛け合いのセリフ列 `scene.lines` の1行・1.8・ADR-0015・#180）: lineId ●（`line_NNN`・scene 内一意・§2.1） / text ●（読み上げ） / speaker ○（VOICEVOX 話者番号＝#177 `voiceCatalog`・null/未指定＝既定声を継承） / speed ○ / pitch ○ / intonation ○（抑揚0.0〜2.0・null/未指定＝場面/動画の既定を継承・1.12＝#242） / subtitleText ○（字幕文・未指定＝text を流用＝追加B） / subtitleEnabled ○（行の字幕 ON/OFF・未指定＝`subtitleEnabledDefault`→書き出し既定を継承） / startSec ○（簡易手動タイミング・未指定＝自動逐次） / startWithPrevious ○（直前の行と**同時に**開始＝並行・`true` の連続で N 人同時・未指定/`false`＝逐次・1.21＝ADR-0031・#530） / voicePath ○ / status(enum) ●。**行の声は数値 `speaker`（`Narration.voiceId`(文字列) の逆変換は持たない・ADR-0015）。**

### 7.5 Template（要点。詳細は `04` ＋ `schemas/template.schema.json`）

schemaVersion ● / templateId ● / name ● / description ○ / category(enum) ● / aspectRatio(enum `16:9`/`9:16`) ● / canvas{width,height} ● / aiHint{useCase, recommendedSceneTypes[], maxNarrationLength, maxSubtitleLength} ○ / defaults{durationSec, transitionIn, transitionOut, backgroundColor} ○ / layers(Layer[]) ●

---

## 8. 検証ルール（コード化可能な形）

AI出力・テンプレ・プロジェクト読込時に実行。**JSON Schema で表現できるもの**＝型・必須・enum・範囲（`schemas/` に内包）。**Schema で表せない相互参照・横断条件**＝下記をドメインで実装。

| # | チェック | 失敗時 |
|---|---|---|
| V1 | JSONパース可 / `schemaVersion` 対応範囲 | 致命: 再生成 or 読込拒否 |
| V2 | スキーマ適合（型・必須・enum・範囲） | 致命 or 補正（§9） |
| V3 | `templateId` が実在 | 補正（§9） |
| V4 | `assetRefs` の各 assetId が実在 | 補正/警告（§9） |
| V5 | `poseAssetId`（解決後）が実在 yuko asset | 既定yukoへ置換（§9） |
| V6 | テンプレ必須スロット/必須テキストが埋まっている | 警告（required=true のみ） |
| V7 | `durationSec` が範囲内（手編集＝`>0`／AI 生成＝目安 `[3, テンプレ上限 or 15]`・#553） | clamp（§9） |
| V8 | テキスト長 ≤ テンプレ上限（`maxNarrationLength`等） | 警告＋短縮提案 |
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

> V12–V15 は ADR-0008 §8。FREE テンプレ場面（`sceneType=free`）の `freeLayout` を対象とし、domain の純粋関数 `validateFreeLayout`（`src/domain/project/freeLayout.ts`）で実装。`free_NNN` 要素ごとに `Warning.field=freeLayout.<id>` を付す。V13 が不正なら矩形が確定しないため V14 はスキップ（二重警告を避ける）。
> kind 別の構造的「必須」（`slot` の `fit` が assetId 非null時・`shape` の `shapeType`）は **Schema（`exclusiveMinimum`/enum）＋ renderer 既定（fit 未指定=cover・shapeType 未指定=rect）で担保＝V2 相当**とし、上記 domain 検証（意味検証）の対象外。`fit` は §2-3 の技術用語のため UI 警告に出さない。
> V16–V19 は ADR-0015。掛け合いのセリフ列（`scene.lines`）を対象とし、domain の純粋関数 **`validateSceneLines`（`src/domain/project/narrationLines.ts`・PR-C）** が `Warning[]` を返す（V16 重複/V17 範囲/V18 順序/V19 speaker 実在）。コード語彙は `15 §6`（`LINE_*`）。**自動補正（再採番/clamp）の適用は lines を編集・生成する段（PR-C2/PR-F）**。`scene.lines` 不在（単一 narration）の場面は対象外（`sceneLines()` が1行へ解決）。番号は §8 の続き。

---

## 9. 自動補正ルール（論点⑥・`07 §10` を定数で統一）

| 問題 | 補正 |
|---|---|
| 存在しない `templateId` | 同 `category` の標準テンプレへ置換（無ければ警告し選択を促す） |
| テンプレの `aspectRatio` がプロジェクトの向きと不一致 | 同 `category`・同 `orientation` のテンプレへ置換（無ければ警告・原状維持／ADR-0012・B4） |
| 存在しない `assetId` | `null` にし、未使用素材から候補提示（警告） |
| `durationSec <= 0` / NaN（**手編集の確定時**） | `SCENE_DEFAULT_DURATION_SEC`（8秒）へ＝壊れた入力の既定（0秒の場面は作らない・#553） |
| `durationSec > VIDEO_HARD_MAX_SEC`（**手編集の確定時**） | `VIDEO_HARD_MAX_SEC`（600秒）へ＝1場面に効く唯一の硬い天井（#553） |
| `durationSec < AI_SCENE_MIN_DURATION_SEC`（**AI 生成時のみ**） | `AI_SCENE_MIN_DURATION_SEC`（3秒）へ＝生成のペース配分の目安（手編集は縛らない・#553） |
| `durationSec >` テンプレ上限（**AI 生成時のみ**） | テンプレ `aiHint.maxDurationSec`（無ければ `AI_SCENE_MAX_DURATION_SEC`=15秒）へ。**手編集は縛らない**（`VIDEO_HARD_MAX_SEC` で頭打ち・#553） |
| `poseTag` 解決不可 / `poseAssetId` 不在 | 既定yuko（`isDefaultYuko` → 無ければ先頭 yuko）へ。yuko素材皆無かつ character 任意 → 非表示 |
| テキストがテンプレ上限超過 | 警告＋「AIで短くする」提示（自動切詰めはしない） |

補正は `scene.warnings[]` に記録し、UIには件数と「対応内容」を非技術語で表示（`01 §6.7`）。

---

## 10. 関連

- 実スキーマ: `schemas/project.schema.json` / `schemas/template.schema.json` / `schemas/ai-video-plan.schema.json`
- AI出力→内部Scene の変換マッピング: `12_AI_PROMPT_AND_MAPPING.md §8`
- 解説（例示）: `03_DATA_SCHEMA.md` / `04_TEMPLATE_SPEC.md`
