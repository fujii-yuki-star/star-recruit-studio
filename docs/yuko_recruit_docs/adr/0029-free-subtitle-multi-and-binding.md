# ADR-0029: FREE 自由配置の「字幕」要素＝複数配置＋対象（読み上げ／話者）への紐づけ

- **状態**: Accepted（2026-07-14・#520 で設計3論点確定＋利用者スコープ決定／実装は段階＝PR-A 済）
- **日付**: 2026-07-14
- **関連**: [`adr/0008`](0008-free-layout-editor.md)（FREE 自由配置・`scene.freeLayout`）/ [`adr/0015`](0015-dialogue-timeline-model.md)（掛け合い＝セリフ列・`sceneLines()`・行ごと `speaker`/`subtitleText`/`subtitleEnabled`）/ [`adr/0001`](0001-rendering-parity.md)（プレビュー＝書き出しのパリティ）/ [`adr/0023`](0023-integrated-timeline-editing.md)（α-5 統合タイムライン）/ `11_SCHEMA_REFERENCE.md §7`（FreeElement）/ `schemas/project.schema.json`（`$defs.FreeElement`）/ `CLAUDE.md §2-3, §10, §11`
- **対象**: #518（FREE 字幕要素・**再スコープ元**）→ 本 ADR 承認後に新 EPIC を起票（α-5 目標・0.4.x で前倒しも可）

---

## コンテキスト

0.4.0 の動作確認で「**FREE テンプレでも読み上げ字幕を出したい**」という要望が挙がり、#518 で自由配置に「字幕」要素（`FreeElement.kind='subtitle'`）を追加した。#518 の実装は、字幕要素を**場面の単一字幕**（単独読み上げ＝`scene.texts.subtitle`、掛け合い＝`sceneLines()` の行字幕列）へ束ねる前提で、その帰結として「**場面に字幕は1つ**」という制約を必要とした。

再レビュー（2026-07-14）で、この単一制約が**中途半端**であることが P1 として指摘された：

- 右クリックの「複製」は種別を問わず出るため、字幕でも押せてしまい**黙って何も起きない**（`FreeLayoutOverlay` → `SceneEditScreen` → `freeLayoutOps` で拒否されるが利用者には無反応）＝§2-5「操作できるのに無反応」。
- 単一制約が**正典・スキーマ・ドメイン全体では担保されていない**（`project.schema.json` は配列要素の型だけ検証・`addFreeElement` は2つ目を作れる・手編集/読込で2つあると `layout.ts` が両方描画＝二重描画）。

レビューは「単一制約を `minContains:0`/`maxContains:1` ＋ ドメイン防御 ＋ 既存不正データの是正で**固める**」ことを妥当としている。**この PR の前提の下ではその指摘は正しい。**

しかし利用者の製品方針は**逆**である（2026-07-14・本音として明言）：

> 字幕は**複数配置**できて、**字幕欄とセリフを紐づけ**られるようにしたい。掛け合いのときは、それぞれのセリフをどの字幕欄に紐づけるかも操作できるようにしたい。**拡張性・自由度をユーザーに保証したい。**

したがって「1 場面 1 字幕」という**前提そのものを変える**のが正しい。単一制約を今固めて α-5 で巻き戻すのは、コードの使い捨てに加え、利用者に「1 つに減らして」→ 後で「複数 OK」という**逆流**を強いる（§2-4/§9 に反する筋の悪い作り込み）。

**好都合な事実**：掛け合いモデル（ADR-0015）で、`scene.lines[]` は既に行ごとに `speaker`（数値）・`subtitleText`・`subtitleEnabled` を持ち、`sceneLines()` が実効セリフ列を一元解決する。つまり「どの話者がどの行を話すか」のデータは**既にある**。不足しているのは、**字幕要素が「自分は何を表示するか（対象）」を宣言する手段**だけ ＝ 小さな additive 追加で成立する。

---

## 判断軸

- **拡張性・自由度**（利用者方針・最優先）：複数字幕と対象紐づけを素直に表現できる。
- **パリティ**（ADR-0001）：プレビュー＝書き出しは共有 `layoutScene(scene, template, t)` を通す（近似しない・memory）。
- **後方互換**（§5）：既存 project は無変換で動く。null／未指定＝継承。additive マイナーバンプ。
- **正典の単一参照**（§2-7/§6）：対象の種別 enum は正典化し直書きしない。#518 の `case 'subtitle'` 直書き（P3）も是正。
- **推測で埋めない**（§9-2）：紐づけの粒度など未定は本 ADR の「未解決の論点」で確認してから実装。
- **UI 用語**（§2-3）：「字幕の対象」「話者」等の利用者語のみ。`speaker` 番号や `elementId` は非表示。

---

## 検討した選択肢

**(1) 単一 vs 複数**
- (1a) **場面に字幕は1つ**を固める（レビュー案：schema `maxContains:1`＋ドメイン防御＋既存是正）。前提据え置き・実装は明快だが**利用者方針と真逆**。α-5 で巻き戻す使い捨て＋利用者への逆流。**不採用**。
- (1b) **複数配置可**にし、各字幕要素に「**対象**（source）」を持たせる。二重描画は「別対象＝別文」で解消。additive。**採用**。

**(2) 紐づけ（対象）の粒度**
- (2a) **ボックスが対象を選ぶ**：字幕要素が `対象`＝`読み上げ` / `話者N` / `全部` を持つ。話者数に比例（行数ではない）・「話者A＝上のボックス／話者B＝下のボックス」を最小 UI で表現。掛け合いの一般ケースを軽く覆う。
- (2b) **行がボックスを選ぶ**：各セリフ行が「どの字幕ボックスに出すか（`subtitleTarget=elementId`）」を持つ。行単位で細かく振り分け（利用者の「それぞれのセリフをどの字幕欄に」に直対応）。柔軟だが、行が FREE 要素 id と結合し**要素削除時に迷子**になる・UI が重い。
- (2c) **両立**：(2a) を基本の解決経路（話者→ボックス）とし、(2b) を任意の上書き層（この行だけ別ボックス）として重ねる。基本は軽く、細かい要望も満たす。**推奨（要確認）**。

**(3) 二重描画（レビュー P1 の本質）**
- 対象が**別**なら別文が出る＝これは機能（話者別・上下）で、二重描画ではない。
- 対象が**同じ**2ボックス（例：どちらも `読み上げ`）は同一文が2箇所に出る。**利用者の明示配置なら許容**しつつ、UI で**やんわり注意**（§2-5 の流儀・エラーにしない）。破壊的な自動削除はしない。

**(4) 単独読み上げ場面**
- `対象=読み上げ`（`texts.subtitle`）の字幕を1つ、が既定の姿（#518 の単独字幕編集欄はそのまま活きる）。複数配置は禁止しない（同一文の複製は (3) の注意対象）。

---

## 決定（Proposed）

> **FREE の「字幕」要素を複数配置可能にし、各要素に「対象（`subtitleSource`）」を持たせる。** 対象は**基本＝ボックスが対象を選ぶ (2a)**（`読み上げ` / 掛け合いの `話者N` または `全部`）とし、**行→ボックスの上書き (2b) は任意層として重ねられる (2c)**。`layout.ts` は字幕要素ごとに、**書き出しと同じ正準経路（`sceneSegmentSpecs` を `segmentAt` で直結・字幕解決に `activeLineIndexAt` は使わない）から作った「その瞬間のセグメント」**（`lineId`・`isGap`・行字幕）と、**音声生成と同じ実効話者**（`resolveLineVoice` の base）で表示テキストを解決する。したがって**プレビューの「現在の行選択」と書き出しの「セグメント処理」が同一の正準状態を消費**し、**二重描画は「別対象＝別文」で構造的に解消**する。**「場面に字幕は1つ」の制約（schema 上限・破壊的移行）は導入しない。** 既存データ（対象未指定）は現状挙動（単独＝読み上げ／掛け合い＝全行）へ**無変換で解決**する。プレビュー＝書き出しは共有 `layoutScene` を通しパリティを維持する（ADR-0001／memory：近似せず正準関数を共有）。

### モデル定義（target・schema は additive／§9-2 で最終確認）

```ts
// 対象＝字幕要素が「何を表示するか」。判別可能 union・値は domain 定数として正典化（§2-7）。
type SubtitleSource =
  | { kind: 'narration' }                        // 読み上げ（texts.subtitle・単独ナレーション）
  | { kind: 'allLines' }                         // 掛け合い：全行（話者で絞らない）
  | { kind: 'speaker'; speaker: SpeakerKey };    // 掛け合い：特定の実効話者の行のみ

// 実効話者の識別子（音声生成と同じ空間・P1-2）。number|null では既定声（voiceId 由来）を表せないため判別 union にする。
type SpeakerKey =
  | { kind: 'catalog'; speaker: number }         // 明示話者（voiceCatalog の speaker 番号）
  | { kind: 'default' };                         // 既定声の行（inherited voiceId＝catalog 番号を持たない・場面の既定へ動的追従）

// FreeElement（kind:'subtitle'）へ任意追加（既存フィールドは不変）
interface FreeElementSubtitle {
  // …既存（id/kind/x/y/w/h/font/color/stroke/zIndex/rotation/hidden 等）…
  subtitleSource?: SubtitleSource;   // 未指定＝後方互換（単独→narration・掛け合い→allLines）
}

// (2b) 上書き層（任意・後日／α-5 で判断）：行が特定ボックスを指名
interface NarrationLine {            // ADR-0015
  // …既存…
  subtitleTarget?: string | null;    // FREE 字幕要素の id。有効時＝その欄に「だけ」出す（排他・P2）／未指定・参照切れ＝(2a) 実効話者解決へ
}
```

**【正準入力】時刻 `t` だけでは有効行を決められない（レビュー P1-1）。** 掛け合いの自動逐次は行の音声長（`lineDurations`）で区間が決まり、先頭の「間」（`isGap`）や 0 秒行の除外もある。**`lineSegments`＋`activeLineIndexAt` では不十分**＝`activeLineIndexAt` は該当区間が無いと**先頭行(0)を返す**ため、先頭の「間」を `null` にできず、書き出しの `sceneSegmentSpecs`（`isGap` 明示・0秒行除外）とズレる（これが P1-1 の核心）。よって **`SubtitleMoment` は `sceneSegmentSpecs` を直接正準入力にする共通関数から作る**：

```ts
// 場面の正準セグメント列（＝書き出しと同一）から「時刻 t のセグメント」を1つ返す共通関数（プレビュー用）。
function segmentAt(scene: Scene, lineDurations: Record<string, number>, t: number): SceneSegmentSpec;
//   ＝ sceneSegmentSpecs(scene, lineDurations) を [startSec, startSec+durationSec) で走査（末尾セグメントは端を含む）。

// フレーム/セグメントごとに 1 回だけ作る正準状態（プレビューと書き出しで共有）。
interface SubtitleMoment {
  segment: SceneSegmentSpec;   // 現在のセグメント。isGap＝間／lineId＝掛け合い行／subtitleText＝sceneSegmentSpecs 解決済み字幕
}
// el ごとの解決はこの正準状態を消費する（t 依存の再計算をしない＝プレビュー=書き出し）。
function resolveSubtitleForElement(el: FreeElementSubtitle, scene: Scene, moment: SubtitleMoment): string | null;
```

> **PR-A 実装での確定（voiceBase は不要と判明）**：`SubtitleMoment` に当初含めた `voiceBase` は実装で不要と確定した。実効話者の判定は `effectiveSpeakerKey(line)`＝`characterForSpeaker(line.speaker)` があれば `{catalog, speaker}`／無ければ `{default}` で、`resolveLineVoice` の「有効 speaker か・null なら base 声」という**分岐と1対1に対応**する。既定声（`{default}`）は**場面ごとに1つ**ゆえ voiceId の実値は不要（場面内で一意のバケツ）。よって音声との整合（ADR-0026②）は保ったまま `voiceBase` を落とし、`SubtitleMoment = { segment }`・`effectiveSpeakerKey(line)` とした（ADR は「キー表現の確定は PR-A」に従い本確定を反映）。

- **プレビュー**は `segmentAt(scene, lineDurations, t)` で `moment.segment` を作る（既存 `firstFrameBoundary`/`boundaryFrameFromSpec` が `sceneSegmentSpecs` の端セグメントから状態を作る流儀を、任意 `t` へ一般化）。
- **書き出し**は `sceneSegmentSpecs` を反復する**その時の現在セグメント**をそのまま `moment.segment` に渡す。**両者が同一の `sceneSegmentSpecs` 出力を消費**するので、間（`isGap`）・全 0 秒・自動逐次（音声長）を**確実に一致**させられる（別経路の再判定を作らない）。

**【話者解決】「話者で絞る」は実効話者で比較する（レビュー P1-2）。** `line.speaker` が未指定/カタログ外なら、実際の声は場面/プロジェクト既定（`resolveLineVoice`＝`base.voiceId`）へ継承される（null＝「声なし」ではない・ADR-0015）。生の `line.speaker` で絞ると「**既定の声で話す行**」がどの話者ボックスにも出ない。よって:

- 対象 `speaker`（`SpeakerKey`）は **実効話者**（音声生成と同じ）で比較する。判定は**共有純粋関数** `effectiveSpeakerKey(line): SpeakerKey`（`characterForSpeaker(line.speaker)!=null` → `{kind:'catalog', speaker}`／それ以外 → `{kind:'default'}`）で行う＝`resolveLineVoice` の catalog/null 分岐と同型で音声と同じ話者（ADR-0026②「同概念同挙動」）。**voiceBase は不要**（上記 PR-A 確定：`{default}` は場面内で一意ゆえ voiceId 実値を要さない）。
- これで **`number|null` の型矛盾を解消**する（P1-2）：`null`＝全行 は `{kind:'allLines'}` として別種別に分離、既定声は `{kind:'default'}`。**`{kind:'default'}` は場面の既定声へ動的追従**（既定声を変えると追従・voiceId 直書き保存はしない）。UI は**その場面に実在する `SpeakerKey` だけ**を選択肢に出す。

**【解決（layout）】** `template.category==='free'` の各 `subtitle` 要素で `subtitleSource ?? 既定` を `moment` で解決:
  - `moment.segment.isGap`（間）→ **常に非表示**（どの対象でも）。
  - `narration` → `scene.texts.subtitle`（`subtitleEnabledDefault===false` は空）。
  - `allLines` → `moment.segment.subtitleText`（`sceneSegmentSpecs` 解決済み・`null` は非表示）。
  - `speaker` → `moment.segment.lineId` の行の `effectiveSpeakerKey` が一致するときのみ、その行字幕を表示（不一致は非表示＝別ボックスが受ける）。
  - **(2b) 排他ルーティング（P2）**：`moment.segment.lineId` の行が**有効な** `subtitleTarget` を持つとき、その行は**指定先の欄に「だけ」出す**＝指定先（`el.id===subtitleTarget`）は表示、**他の全ボックス（話者別・`allLines` 含む）は非表示**（＝二重表示を作らない）。参照切れ・未指定の行のみ (2a) の話者/`allLines` 解決に従う。
- **描画は既存経路**：解決テキストを既存の字幕 `LayoutItem`（`isSubtitle:true`）として積む。掛け合い／アニメ／プレビュー／書き出しは共有 `layoutScene`（ADR-0001・per-frame は ADR-0019）を通り**パリティ不変**。
- **二重描画の扱い**：別対象＝別文（機能）。同一対象の重複は UI で注意（§2-5・破壊しない）。(2b) は上記の排他で二重表示を作らない。

**【参照切れ】(2b) の `subtitleTarget` は FREE 要素 id を直接持つため、対象欄の削除で迷子になり得る（レビュー P2）。黙って字幕を消さない**（§2-5／ADR-0026④）:
- **要素削除時**：削除される字幕要素を指す全行の `subtitleTarget` を**解除**し、(2a) の実効話者解決へ戻す（＝その行は話者ボックス/全部ボックスに出続ける）。FREE 要素削除の domain 操作（`freeLayoutOps`）に1か所追加。
- **保存データの検証**：読込時、実在しない要素 id や `subtitle` 以外を指す `subtitleTarget` を**検知して解除**（`15 §6` の警告＋自動修復・「字幕の割り当て先が見つからないので話者ごとの表示に戻します」）。
- **受け入れ条件**：削除→フォールバック・壊れ参照→修復・**どのケースでも行の字幕が消えない**／有効な指定先がある行は**指定先だけに1回表示（他の話者・allLines ボックスに二重表示しない）**、をテスト（PR-D）。

### 移行（additive マイナーバンプ・変換不要）

- `FreeElement.subtitleSource`（＋採用時 `NarrationLine.subtitleTarget`）を**任意追加**。既存フィールドは不変。旧データは未指定＝現状挙動へ解決（`sceneLines()` と同型の後方互換）。
- **#518 の schema 1.20（`kind:'subtitle'` の追加）は本機能へ畳み込む**：単独の 1.20 として develop へ入れず、**subtitle 種別＋ `subtitleSource` を機能 PR で一括バンプ**（develop 現行 1.19 → 機能版・移行不要）。版番号・`PROJECT_SCHEMA_VERSION`・`validate-schemas.mjs` の許可/拒否ケースは実装 PR で確定。

---

## 実装計画（サブ PR・各 PR で `check:frontend` 緑＋`/canon-check`）

1. **本 ADR**（合意）＋ 新 EPIC 起票（#518 を再スコープ）。
2. **PR-A モデル＋解決【実装済・schema 1.20】**：`SubtitleSource`／`SpeakerKey` 判別 union（`types.ts`）・domain 定数（`SUBTITLE_SOURCE_KIND`/`SPEAKER_KEY_KIND`・`enums.ts`）、**共通 `segmentAt(scene, lineDurations, t)`＝`sceneSegmentSpecs` を直接正準入力にする（P1-1・`lineTimeline.ts`）**、**正準状態 `SubtitleMoment{segment}`＋`effectiveSpeakerKey(line)`＋`resolveSubtitleForElement(el, scene, moment)`（`subtitleBinding.ts`）**、`FreeElement.kind='subtitle'`＋`subtitleSource`（schema additive 1.19→1.20・`createFreeElement` に字幕バー既定）、検証（許可/拒否）。**挙動不変**（描画/UI は未接続＝PR-B/PR-C）。純粋ロジックのフルテスト済（`segmentAt(t)` が `sceneSegmentSpecs` の同区間・間/0秒行で `isGap`／`effectiveSpeakerKey` が `resolveLineVoice` の catalog/default と一致）。
3. **PR-B 描画（複数対象）**：`layout.ts` の `subtitle` 要素を `SubtitleMoment` 経由の対象解決へ（`FREE_ELEMENT_KIND.subtitle` 参照＝#518 P3 の enum 直書き是正も同時）。**プレビューは `segmentAt(scene, lineDurations, t)`、書き出しは `sceneSegmentSpecs` の現在セグメントから同じ `moment` を作る（字幕解決に `activeLineIndexAt` は使わない）**（別経路の再判定を作らない）。単独／掛け合い／複数ボックスの golden（プレビュー＝書き出し一致）。
4. **PR-C UI（複数＋対象選択）**：字幕要素の複数追加、要素ごとの「対象」選択（掛け合い時は**その場面に実在する実効話者キー**／全部）、単独読み上げの `texts.subtitle` 編集欄（#518 の欄を包含）。**右クリック「複製」を字幕でも自然に許可**（複数可ゆえ no-op 問題は消える）＝レビュー P1 も解消。同一対象重複のやんわり注意（§2-5）。コンポーネントテスト（単独＝入力欄／掛け合い＝話者紐づけ／複製が機能）。
5. **PR-D（任意・α-5 判断）行→ボックス上書き (2b)＋参照切れ処理**：`NarrationLine.subtitleTarget` と割り当て UI。**有効な指定先がある行は指定先だけに排他表示（P2）／要素削除で指す行の `subtitleTarget` を解除して (2a) へ戻す（`freeLayoutOps`）／読込検証で壊れ参照を検知・修復（`15 §6` 警告）**。受け入れ条件＝**削除・壊れ参照でも字幕が消えず・指定先では二重表示しない**（テスト必須）。統合タイムライン（ADR-0023）と整合。

---

## 結果・影響

- **後方互換**：旧 project.json は無変換で動作（additive マイナー・§1 互換方針）。
- **正典同期**：`11 §7`（FreeElement に `subtitleSource`・意味）／`schemas/project.schema.json`（additive・版バンプ）／[`adr/0008`](0008-free-layout-editor.md)（「字幕は場面1つ」→「複数可・対象紐づけ」へ追補・#518 の 1.20 追補を本 ADR に統合）／[`adr/0015`](0015-dialogue-timeline-model.md)（「場面の単一字幕ストリーム」→「複数ボックス・話者別」へ拡張）を実装 PR で同期。
- **§10/§11**：§10（MVP 非対象）には抵触しない（FREE 拡張・本格タイムラインではない）。§11 に本 ADR を **Proposed** として追記。
- **UI 文言（§2-3/§2-5）**：「字幕の対象」「話者」「全部」等の利用者語。`speaker` 番号・要素 id・`subtitleSource` は非表示。同一対象重複は「次の行動」を示す注意に留める。
- **テスト（§7）**：`resolveSubtitleForElement`（対象解決・実効話者絞り込み・**`sceneSegmentSpecs` と一致する有効行**・継承）＋`effectiveSpeakerKey`（`resolveLineVoice` と一致）を純粋関数でフルテスト。`layout` は複数字幕の golden（プレビュー＝書き出し）。参照切れの解除/修復。schema 許可/拒否。UI はコンポーネントテスト。
- **#518 の扱い**：単一制約を固める方向では**マージしない**。ブランチ `feat/free-subtitle-element` の scaffolding（enum・layout case・UI フォーム・`texts.subtitle` 編集）は本機能の土台として流用し、PR は draft 化・再スコープ。

## 決定済み（レビュー #520 で確定した設計論点）

- **[P1-1 正準入力＝`sceneSegmentSpecs` 直結]**（初版の `lineSegments`＋`activeLineIndexAt` を訂正）：`activeLineIndexAt` は該当区間なしで**先頭行を返す**ため先頭の「間」を `null` にできない。**`SubtitleMoment` は `sceneSegmentSpecs` を直接正準入力にする共通関数 `segmentAt(scene, lineDurations, t)` から作る**。プレビューは「時刻 t のセグメント」、書き出しは「現在のセグメント」を渡し、**同一の `sceneSegmentSpecs` 出力**を消費＝間（`isGap`）・全 0 秒・自動逐次を確実に一致（ADR-0001/0026③）。
- **[P1-2 実効話者＋保存型の判別 union]**：`lines.speaker` は**実効話者（音声生成と同じ）で比較**（生の `line.speaker` ではない）。`number|null` は既定声（voiceId 由来）を表せず矛盾するため、**`SubtitleSource` を判別 union に**（`narration`／`allLines`／`speaker:{catalog:number | default}`）。共有 `effectiveSpeakerKey(line): SpeakerKey`（catalog あり→`{catalog}`／なし→`{default}`）で判定＝`resolveLineVoice` の catalog/null 分岐と同型。`{default}` は場面の既定声へ動的追従（voiceId 直書き保存はしない・場面内で一意ゆえ voiceBase 実値は不要＝PR-A 確定）。既定声の行も正しく話者ボックスへ（ADR-0026②）。
- **[P2 参照切れ＋排他ルーティング]**：有効な `subtitleTarget` を持つ行は**指定先の欄だけに排他表示**（他の話者・`allLines` ボックスは非表示＝二重表示しない）。`subtitleTarget` は**要素削除で解除→(2a) へフォールバック／読込検証で壊れ参照を修復**（`15 §6` 警告）。**どのケースでも字幕を黙って消さない**（§2-5／ADR-0026④）。受け入れ条件とテストを PR-D へ。

## スコープ・リリースの決定（利用者・2026-07-14）

1. **紐づけ粒度＝(2a) 先行・(2b) は α-5**：初回は **(2a) ボックス→実効話者**（`narration`/`allLines`/`speaker`）まで。**(2b) 行→ボックス（`NarrationLine.subtitleTarget`・排他ルーティング）は α-5 の統合タイムライン（ADR-0023）へ回す**（per-line 割当 UI が重く統合編集面と重なるため）。よって PR-A の schema は `subtitleTarget` を含めない（`FreeElement.subtitleSource` のみ・1.20）。
2. **同一対象の重複**：許容＋やんわり注意（PR-C で実装・破壊しない・§2-5）。
3. **リリース段＝0.4.2 前倒し**：本機能は **0.4.2**（0.4.1＝#517/#519 の直後）。**schema 1.20 は 0.4.1 に混ぜない**＝PR-A は 0.4.1 を develop→main で切ってから develop へマージ（0.4.1 に描画/UI 無しの字幕 schema が載らないように）。

## 未解決の論点

- **既存 `template.schema` の subtitle 層との関係**：通常テンプレの `type:'subtitle'` 層（ADR-0015）は据え置き。FREE の複数対象はこの ADR の範囲（通常テンプレへの複数字幕は対象外・将来検討）。
- **(2b) の詳細（α-5）**：`NarrationLine.subtitleTarget` の schema・排他ルーティング・参照切れ修復（本 ADR「決定済み [P2]」）は α-5 の実装 PR で。

> P1-1/P1-2/P2 は #520 で確定。スコープ（(2a) 先行・0.4.2）は利用者決定。**PR-A（モデル＋解決・schema 1.20）実装済＝0.4.1 リリース後に develop へマージ**。PR-B（描画）→ PR-C（UI・複数追加＋対象選択）が続く。#518 は本機能に置換（draft・scaffolding 流用）。
