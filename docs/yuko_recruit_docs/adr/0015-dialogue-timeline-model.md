# ADR-0015: 掛け合い＝場面のセリフ列（ミニタイムライン）モデル

- **状態**: Proposed（Draft・2026-06-25・#180）— **合意後にサブPRへ分割**して実装する
- **日付**: 2026-06-25
- **関連**: `11_SCHEMA_REFERENCE.md §6,§7,§1` / `12_AI_PROMPT_AND_MAPPING.md` / [`adr/0003`](0003-narration-voice.md)（複数話者・動的クレジット＝#177）/ [`adr/0009`](0009-scene-transitions.md) / `CLAUDE.md §10`（MVP 非対象＝本格タイムライン編集）
- **対象 issue**: #180（EPIC）＝ req7b（セリフごと別ボイス）＋追加A（経過秒でテキスト変化）＋追加B（セリフ連動の自動字幕・ON/OFF）

---

## コンテキスト

現在、1場面のナレーションは **単一**（`Scene.narration: Narration`）で、字幕は **静的な1文字列**（`scene.texts['subtitle']`＝AI が要約を1つ生成）。**時間（経過秒）の次元はデータ・描画・書き出しのどこにも無い**。この前提が広範に埋まっている（探索で確認）:

- 解決: `resolveNarrationVoice`（`voiceProvider.ts`）/ `resolveNarrationVolume`（`audioMix.ts`）は **場面1声・1音量**。
- 生成: `projectStore.generateNarration` は **場面1回 synthesize**、`narrationAudioById: Record<sceneId, string>`（**場面1音声**）、`voicePath`（`voices/<sceneId>.wav`・**場面1ファイル**）、`NarrationStatus`（**場面1状態**）。
- 書き出し: `NarrationFor → {audioBase64, narrationVolume}`（**場面1音声**）、`buildExportScenes`/`ffmpegExport` も場面1音声前提。
- プレビュー: `PreviewScreen` は `narrationAudioById[sceneId]` を**場面1再生**。
- 字幕: 描画は template の `type:'subtitle'` レイヤー＋`isSubtitle` で、文言は `scene.texts['subtitle']`。ON/OFF は書き出しの `withSubtitle`（**場面横断の一括**のみ）。

「掛け合い」を実現するには、場面のナレーションを **時間順のセリフ列（ミニタイムライン）** に拡張し、上記の「場面=1音声/1字幕/時間なし」前提を解く必要がある。一方 `CLAUDE.md §10` は **本格タイムライン編集を MVP 非対象** とするため、**自動逐次を既定**とし、手動は**場面内・単一トラックの簡易タイミング（開始秒）に限る**（複数トラック/キーフレームは持たない＝§10 をこの範囲に狭める＝ADR-0012 先例）。

---

## 検討した選択肢

**(1) モデルの置き場所**
- (1a) `scene.narration` を**廃止**して `scene.lines` に**置換** → 破壊的＝`schemaVersion` メジャー（2.0）。読込拒否リスク・全層同時改修で sub-PR が大きくなる。**不採用**。
- (1b) `scene.lines?` を**任意追加**（後方互換のマイナー＝1.8）。`narration` は単一行の表現として**残す**。実効タイムライン＝`lines` があればそれ、無ければ `narration` を1行とみなす（ドメイン関数 `sceneLines()` で一元化）。既存データは無変換で動く。**採用**。

**(2) 行の時間（タイミング）**
- (2a) **自動逐次のみ**（手動なし）＝行を順に並べ各行尺＝音声長。最小だが、間（ま）や被せの調整ができない。
- (2b) **本格タイムライン**（複数トラック・キーフレームアニメ・場面横断） → `§10` 非対象。**不採用**。
- (2c) **自動逐次を既定＋簡易手動タイミング**（行ごと任意 `startSec`・場面内の単一トラックで開始秒を調整）。複数トラック/キーフレームは持たない。**採用**（#180 の意図＝掛け合いの「間」を作れる）。**`§10` の「本格タイムライン編集」除外を、ADR-0012（縦型対応で §10 を改訂した先例）と同様に「場面内・単一トラックの簡易タイミングは対象」と狭める。**

**(3) 行ごとの声（req7b）**
- (3a) 文字列 `voiceId`（既存 `Narration.voiceId` 流儀）→ 12キャラ分の voiceId 文字列を新設する手間・二重定義。
- (3b) **数値 `speaker`**（#177 の `voiceCatalog` をそのまま参照）＋ `creditForSpeaker` を流用。**採用**（#177 と一貫・クレジット動的化を流用）。

**(4) 書き出しの複数音声**
- (4a) 場面内で全行音声を**1トラックに連結**して既存の場面1音声経路へ → 追加A（行ごとに画面の文字が変わる）が表現できない（フレームが1枚のまま）。**不採用**。
- (4b) **行＝セグメント**：多行場面は「行ごとのフレーム（その行の字幕/文字）＋その行の音声＋その行の尺」の**セグメント列**として書き出す（単一行場面は現状どおり1セグメント）。既存の「フレーム＋音声＋尺」単位を**行へ一般化**。**採用**。

---

## 決定

> **場面のナレーションを「セリフ列」`scene.lines: NarrationLine[]`（任意・後方互換のマイナー＝schemaVersion 1.8）へ拡張する。** 行は**自動逐次を既定**としつつ**行ごとに開始秒（`startSec`）を簡易調整できる**（場面内・単一トラック）。**行ごとに話者（#177 カタログの speaker）・字幕・字幕 ON/OFF** を持てる。実効タイムラインは `sceneLines(scene)`（`lines` があればそれ、無ければ `narration` を1行とみなす）で一元的に解決し、**既存データ（単一 narration）は無変換で動く**。書き出し・プレビューは **行＝セグメント** として一般化する。**複数トラック/キーフレームアニメ/場面横断タイムラインは導入しない（§10 はこの範囲に狭める＝ADR-0012 先例）。**

### モデル定義（target）

```ts
interface NarrationLine {
  lineId: string;            // line_NNN（scene 内一意・採番は 11.2 に準拠）
  text: string;              // 読み上げ（話す）テキスト
  speaker?: number | null;   // VOICEVOX speaker（#177 voiceCatalog）。null/未指定＝場面/動画の既定声を継承
  speed?: number | null;     // null/未指定＝継承（11.6）
  pitch?: number | null;     // 〃
  subtitleText?: string | null;  // 画面字幕の文言。未指定＝text を字幕に流用（追加B）
  subtitleEnabled?: boolean;     // この行の字幕 ON/OFF。未指定＝場面/書き出し既定を継承（追加B）
  startSec?: number;         // 明示開始秒（任意・簡易手動タイミング）。未指定＝直前行の積み上げ＝自動逐次
  voicePath?: string | null; // 生成済み音声の保存先（行ごと＝voices/<sceneId>_<lineId>.wav）
  status: NarrationStatus;   // none|pending|generated|failed（行ごと）
}

// Scene へ任意追加（既存フィールドは不変）
interface Scene {
  // …既存…
  narration: Narration;       // 残置：単一行の表現・後方互換（lines があるとき lines[0] を mirror）
  lines?: NarrationLine[];     // 追加（1.8）：あれば実効タイムライン。1行＝単一ナレーションと等価
  subtitleEnabledDefault?: boolean; // 追加（任意）：場面の字幕既定（行が未指定のとき継承）
}
```

- **実効タイムライン**: `sceneLines(scene)` ＝ `scene.lines?.length ? scene.lines : [lineFromNarration(scene.narration)]`。**全消費側はこの関数を通す**（store/描画/書き出し/プレビュー/台本/precheck）。
- **声の解決（11.6 拡張）**: 行の実効話者 ＝ `line.speaker` →（未指定なら）場面/プロジェクト既定声（既存 `resolveNarrationVoice` の voiceId→speaker 経路）→ アプリ設定（`getVoicevoxSpeaker`・#177）→ `DEFAULT_SPEAKER`。
- **クレジット（ADR-0003）**: 動画全体で**使用した全 speaker を重複排除**し `creditForSpeaker` で列挙（焼き込み＋About）。req7a（#177）の動的クレジットを流用。
- **字幕（追加B）**: 行が `subtitleEnabled`（未指定は `scene.subtitleEnabledDefault` →書き出し `withSubtitle`）のとき、`subtitleText ?? line.text` を字幕として描く。`lines` 駆動時は `texts['subtitle']`（静的）より行字幕を優先。
- **文字の時間変化（追加A）**: 画面の字幕/キャプションは**その時刻に有効な行**の字幕で描く。プレビューの静止フレームは選択中の行（既定は先頭行）を表示。書き出しは行＝セグメントで切り替わる。
- **尺**: `scene.durationSec` は**場面の権威尺のまま**。行音声長の合計から**推奨尺を提示**し、超過は警告（`§8`／既存の overflow 警告に倣う）。MVP は「合計に合わせる」を基本運用とし、行を場面尺内に収める。
- **タイミング**: 行は `startSec` 昇順・**非重複**（重なりは検証で警告/補正）。`startSec` 未指定は直前行の終わり（自動逐次）。行間の**間（無音）**を許容し、その間は直前フレームを保持。手動は**単一トラックの開始秒のみ**（尺・トラック数は増やさない）。

### 移行（1.7 → 1.8・後方互換のマイナー）

- `scene.lines`・`NarrationLine`・`scene.subtitleEnabledDefault` を**任意追加**。既存 `narration`/`texts` は不変。**変換不要の版番号付け替え**（1.5→1.6・1.6→1.7 と同型）＝旧データは `lines` 不在＝`sceneLines()` が `narration` を1行に写して動く。
- 書き込み時、`lines` があるとき `narration` を `lines[0]`（text/status）に **mirror**（旧バージョン/外部リーダ向けの後方可読性）。
- `schemas/project.schema.json`（`$defs.NarrationLine` 追加・Scene に `lines`）＋ `PROJECT_SCHEMA_VERSION='1.8'` ＋ `migrateProject` ＋ サンプル fixture ＋ `validate-schemas.mjs` の許可/拒否ケース ＋ `11 §1/§7` を同 PR で同期。

### AI 出力（ai-video-plan・追加）

- `AiScene` に `narrationLines?: [{ text, speaker?|character?, subtitle?, subtitleEnabled? }]` を**任意追加**（`narrationText`/`texts.subtitle` は残置）。ai-video-plan `schemaVersion` 1.0→1.1（後方互換の追加）。
- マッピング（`transformPlan`）: `narrationLines` があれば `scene.lines` へ、無ければ従来どおり `narrationText`→`narration`（単一）。`12` のプロンプトに掛け合いの指針を追記（行数・各行長・話者指定の任意）。

---

## 実装計画（サブPR・各 PR で check:frontend 緑＋canon-check）

1. **本 ADR**（合意）。
2. **PR-B モデル＋移行**: `NarrationLine`/`scene.lines`、schema 1.8、`sceneLines()`/`lineFromNarration()` アクセサ、検証。**挙動不変**（全消費側はアクセサ経由＝既存は1行に解決）。純粋ロジックのテスト（採番・移行・アクセサ）。
3. **PR-C 行ごと音声生成・保存**: `narrationAudioById` を **(sceneId,lineId) キー**へ、`voiceFs` を行ごとパスへ、生成/状態を行ごとへ。`narrationProgress` を行集計へ。
4. **PR-D 描画（追加A＋追加B）**: 時刻→有効行→字幕/文字の切替、行ごと字幕 ON/OFF、場面/書き出しの既定継承。
5. **PR-E 書き出し（行＝セグメント）**: 多行場面をセグメント列へ一般化（フレーム＋音声＋尺）。`buildExportScenes`/`ffmpegExport` をセグメント単位へ。
6. **PR-F UI（req7b＋簡易タイミング）**: セリフ列の追加/並べ替え/削除、行ごと話者選択（#177 カタログ）、行ごと字幕 ON/OFF・文言、**行ごと開始秒の簡易調整（場面内・単一トラックのミニタイムライン）**。既存の単一ナレーション編集は「1行」として自然に包含。
7. **PR-G AI 出力**: ai-video-plan の複数行＋マッピング＋`12` 追記。

---

## 結果・影響

- **後方互換**: 旧 project.json（単一 narration）は無変換で動作（minor 1.8・`§1` 互換方針に適合）。
- **§10 改訂**: 「本格タイムライン編集（MVP非対象）」を、**場面内・単一トラックのセリフ簡易タイミング（startSec 調整）は対象**へ狭める（複数トラック/キーフレームアニメ/場面横断タイムラインは引き続き非対象）。ADR Accepted 時に `CLAUDE.md §10` を ADR-0012 と同様の注記で更新する。
- **正典同期**: `11`（§6 声の解決を行へ拡張・§7 に NarrationLine・§1 に 1.8）、`12`（掛け合いプロンプト/マッピング）、`schemas/`（project 1.8・ai-video-plan 1.1）、`ADR-0003`（複数話者の使用＝本 ADR が具体化）。
- **UI 文言（§2-3/§2-5）**: 「セリフ」「声（キャラクター）」等の利用者語のみ。`lineId`/`speaker` 番号等は非表示。
- **テスト（§7）**: 採番・移行・`sceneLines` 解決・声/音量の継承・字幕の有効行解決・行音声の連結尺、をいずれも純粋関数でテスト。書き出しは golden 方針に追従。

## 未解決の論点 / 確認ポイント

1. **モデル方針（合意済み・#180）**: `lines` を**任意追加（1.8・narration 残置）**で進める。置換＝2.0 は不採用。
2. **タイミング（合意済み・#180）**: **自動逐次を既定＋簡易手動 `startSec`（場面内・単一トラック）**。複数トラック/キーフレームは非対象。これに伴い **§10 を上記のとおり狭める**（Accepted 時に `CLAUDE.md §10` へ反映）。
3. **行の声の表現（推奨・要確認）**: 行は**数値 speaker（#177 カタログ）**で表す（文字列 voiceId ではなく）。
4. **字幕の既定（合意済み・#180）**: 行 `subtitleText` 未指定時は **`line.text` を字幕に流用**。`lines` 駆動時は静的 `texts['subtitle']` を上書き。
5. **尺の扱い（推奨・要確認）**: `scene.durationSec` を権威尺のままにし、行音声合計の超過は**警告**に留める（自動延長しない）。
6. **書き出し単位（推奨・要確認）**: 多行を**行＝セグメント**で焼く（追加A 実現のため）。

> 1/2/4 は合意済み（#180）。3/5/6 を確認のうえ PR-B（モデル＋移行）から着手する。
