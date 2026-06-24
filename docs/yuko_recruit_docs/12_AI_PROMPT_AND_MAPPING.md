# 12. AIプロンプト設計 & 変換仕様

> 本書は **AIへの入力（プロンプト）／構造化出力の強制／AI出力→内部データ変換** の正典である。
> AI出力スキーマは `schemas/ai-video-plan.schema.json`、内部データは `schemas/project.schema.json`、enum/定数/バインディングは `11_SCHEMA_REFERENCE.md`。
> `07_AI_SPEC.md` は背景・方針（例示）であり、矛盾時は本書を優先する。

---

## 1. 全体パイプライン

```text
[会社情報・素材・テンプレ概要] 
        │  (入力アセンブリ §4–6)
        ▼
   AIプロバイダ呼び出し（構造化出力を強制 §3）
        │
        ▼
   ai-video-plan JSON  ── 検証(§9 / 11.8) ── NG ─▶ 自動補正(§9 / 11.9) or 再生成(§9.3)
        │ OK
        ▼
   変換マッピング(§8)：採番・参照解決・clamp・初期化
        ▼
   内部 Part[] / Scene[]（project.json へ反映）
```

**原則（`CLAUDE.md §2`）**: AIは構成案のみ生成。生のAI出力を検証なしに `project.scenes` へ入れない。raw出力は `ai/latest_result.json` と `ai/history/` に保存（`03 §3`）。

---

## 2. AiProvider インターフェース

```ts
interface AiProvider {
  generateVideoPlan(input: GenerateVideoPlanInput): Promise<AiVideoPlan>;     // 構成案生成
  rewriteNarration(input: RewriteNarrationInput): Promise<{ text: string }>;  // セリフ言い換え(§10)
  reviewScript(input: ReviewScriptInput): Promise<ReviewResult>;             // 公開前チェック
  classifyAssets(input: ClassifyAssetsInput): Promise<AssetClassification[]>; // 素材説明の補助
}
```

- 戻り値 `AiVideoPlan` は `ai-video-plan.schema.json` に適合（適合しなければ Provider 層で例外）。
- 初期は **MockProvider** が固定の有効プランを返し（recruit=§7 のサンプル／general=発表調サンプル＝§7b に準じる・`videoKind` で切替）、全フローを通す。実プロバイダは Phase 5 / v0.2。

---

## 3. 構造化出力の強制（プロバイダ別）

出力スキーマは `ai-video-plan.schema.json`。**自由生成させずスキーマ強制**する。具体的なAPIパラメータ形は実装時に各SDKの最新仕様で確認すること（モデルID・厳密モードの制約は変わりうる）。

| Provider | 強制方式（概念） | 備考 |
|---|---|---|
| OpenAI | `response_format` の JSON Schema 指定 | 厳密(strict)モードは「全プロパティ required＋additionalProperties:false」を要求するため、任意項目は `nullable＋required` へ変換するか非strictで運用 |
| Claude（Anthropic） | 単一ツールを定義し `input_schema` に本スキーマ、`tool_choice` で当該ツールを強制 | ツール入力＝プラン本体。最新の tool use 仕様を実装時に確認 |
| Gemini | `responseMimeType: application/json` ＋ `responseSchema` | — |
| Mock | 固定サンプルを返す（recruit=§7／general=§7b に準じる・videoKind で切替） | テスト・オフライン・既定 |

- いずれの場合も**受信後に必ず ajv 等で再検証**する（モデルが逸脱する前提で二重化）。
- パース失敗・スキーマ不適合時は §9.3 のリカバリへ。

---

## 4. 入力アセンブリ方針

`generateVideoPlan` の入力に含めるもの（`07 §4`・送信前確認 `07 §5` を通過した範囲のみ）。**`videoKind`（recruit / general）で用途固有の情報を切り替え、システムプロンプト（§5／§5b）とユーザーメッセージ（§6／§6b）を分岐する（ADR-0011）**:

- **【recruit のみ】会社情報**（companyName / industry / businessDescription / jobType / recruitTarget / strengths / desiredPerson / recruitUrl）。`strengths` は「アピールしたいこと（強み・伝えたい点）」として送る。
- **【general のみ】generalBrief**（title＝テーマ / agenda＝章立て・アジェンダ（string[]） / keyPoints＝伝えたい要点（string[]））。
- **補足・その他**（`additionalNotes`＝利用者の自由記述。**両用途共通**・**そのまま本文として送る**（重視するよう指示）・**schema 上限 1000 字**・空のときはセクションごと省略）。ADR-0011 で project トップレベルへ移動。
- 動画設定（purpose＝種類別の目的（recruit/general で許可 enum が変わる。**一般の値は `11 §3.1`＝正典更新②／PR #100 で定義**） / targetAudience / targetDurationSec / tone）【両用途共通】
- **利用可能な素材一覧**（assetId / assetType / displayName / description / aiDescription / tags）。**MVP はテキストのみ送信**（サムネイル・代表フレームは添付しない）。画像サムネイル添付（長辺 512px・`07 §4` 許可範囲）／動画の代表フレームは、画像対応の実プロバイダ整備後＝**ADR-0010 P3** で追加する（§2-6 の「代表フレームのみ」に沿う）。
- **利用可能な見た目パターン一覧（要約）**（`11 §7.5` の aiHint をもとに `templateId / category / useCase / requiredSlots / hasYuko / maxNarrationLength / maxSubtitleLength / maxDurationSec`）。`maxDurationSec` はシステムプロンプトの「見た目パターンに上限があれば従う」を AI が解決するために渡す（無い場合は省略）。
- **利用可能なゆうこ表情タグ一覧**（yuko asset の tags を集約）

### トークン/送信量の制御
- サムネイルは長辺 512px 程度へ縮小して添付（**ADR-0010 P3**。MVP は送信しない）。
- 素材が多い場合は説明・タグの充実した順に上位 N 件（既定 N=40）を送信し、超過分は送らない旨を `log` する（無言の打ち切りをしない）。
- テンプレは全 `template.json` ではなく要約のみ送る（`07 §6`）。

---

## 5. システムプロンプト（採用 recruit・確定版・日本語）

```text
あなたは採用動画の構成プランナーです。会社情報・利用可能な素材・利用可能な見た目パターン（テンプレート）をもとに、採用動画の構成案を作成します。

【厳守事項】
- あなたは動画や画像を生成しません。動画の「構成案」だけを作成します。
- 出力は指定スキーマ（ai-video-plan, schemaVersion "1.0"）に厳密準拠したJSONのみ。前後に説明文・見出し・コードフェンスを付けないこと。
- 各シーンに templateId を必ず設定し、「利用可能な見た目パターン一覧」に存在するIDのみ使用する。新しいIDを創作しない。
- assetRefs の値は「利用可能な素材一覧」に存在する assetId のみ。該当が無ければ null にする。
- sceneType は、選んだ templateId の category と同じ値にする（「利用可能な見た目パターン一覧」に無い sceneType は使わず、利用可能な見た目だけで構成する）。
- 各シーンは短く区切る（1シーンで1つの内容）。長い動画はパートに分けて整理する。
- narrationText は会社マスコット「ゆうこ」が話す、自然で親しみやすい日本語にする。各見た目パターンの maxNarrationLength を超えない。
- texts.subtitle は字幕用に短くする（各見た目パターンの maxSubtitleLength 以内）。ナレーションの要約でよい。
- texts.title / texts.main は画面に出す短い語句にする。
- durationSec は 3〜15 秒を目安にする。見た目パターンに上限があれば従う。
- 全シーンの合計尺を targetDurationSec に近づける。
- 誇大表現・差別的表現・事実と異なる断定を避ける。
- yukoPoseTag は場面に合う表情タグ（例：smile, guide, bow）を「利用可能なゆうこ表情タグ一覧」から選ぶ。ゆうこを出さない見た目パターンでは null にする。
- 素材に人物・社外秘が含まれそうな場合は reviewNotes に確認を促す一文を入れる。
```

> モデル・温度などの生成パラメータは実装時に決定（決定論性のため temperature は低め推奨）。

---

## 5b. システムプロンプト（一般・社内発表 general・確定版・日本語）

> `videoKind=general` のとき §5 の代わりに使う。会社紹介ではなく**発表・説明の構成案**を作る。共通ルール（templateId 必須・sceneType=category・尺・表情タグ・出力契約）は §5 と同じ。

```text
あなたは社内向け・一般向け動画の構成プランナーです。動画のテーマ・構成（章立て）・伝えたい要点・利用可能な素材・利用可能な見た目パターン（テンプレート）をもとに、発表・説明動画の構成案を作成します。

【厳守事項】
- あなたは動画や画像を生成しません。動画の「構成案」だけを作成します。
- 出力は指定スキーマ（ai-video-plan, schemaVersion "1.0"）に厳密準拠したJSONのみ。前後に説明文・見出し・コードフェンスを付けないこと。
- 各シーンに templateId を必ず設定し、「利用可能な見た目パターン一覧」に存在するIDのみ使用する。新しいIDを創作しない。
- assetRefs の値は「利用可能な素材一覧」に存在する assetId のみ。該当が無ければ null にする。
- sceneType は、選んだ templateId の category と同じ値にする（一覧に無い sceneType は使わず、利用可能な見た目だけで構成する）。
- 「構成（章立て）」をパート（parts）に対応させ、各章を短いシーンに分ける（1シーンで1つの内容）。
- 「伝えたい要点」を各シーンの texts や narrationText に反映し、要点が漏れないようにする。
- narrationText は会社マスコット「ゆうこ」が話す、対象視聴者に合った自然な日本語にする。各見た目パターンの maxNarrationLength を超えない。
- texts.subtitle は字幕用に短くする（maxSubtitleLength 以内）。texts.title / texts.main は画面に出す短い語句にする。
- durationSec は 3〜15 秒を目安にする。見た目パターンに上限があれば従う。全シーンの合計尺を targetDurationSec に近づける。
- 誇大表現・差別的表現・事実と異なる断定を避ける。社外秘・個人情報が含まれそうな場合は reviewNotes に確認を促す一文を入れる。
- yukoPoseTag は場面に合う表情タグを「利用可能なゆうこ表情タグ一覧」から選ぶ。ゆうこを出さない見た目パターンでは null にする。
- purpose は一般の種別（general_announcement / report / product_intro / general_other）に沿った内容にする。
```

> ゆうこの口調は対象視聴者に合わせて調整可（フォーマル寄せ等は ADR-0011 未解決#10）。

---

## 6. ユーザーメッセージ テンプレート（採用 recruit）

```text
# 会社情報
会社名: {{companyName}}
業種: {{industry}}
事業内容: {{businessDescription}}
募集職種: {{jobType}} / 採用対象: {{recruitTarget}}
アピールしたいこと（強み・伝えたい点）: {{strengths}}
求める人物像: {{desiredPerson}}
採用ページ: {{recruitUrl}}

# 動画の方針
目的(purpose): {{purpose}}
ターゲット: {{targetAudience}}
希望尺(秒): {{targetDurationSec}}
トーン: {{tone}}

# 補足・その他（利用者からの自由記述。動画づくりで特に重視する）
{{additionalNotes}}

# 利用可能な見た目パターン（このIDのみ使用可）
{{#each templates}}
- templateId={{templateId}} / category={{category}} / hasYuko={{hasYuko}}
  useCase={{useCase}} / requiredSlots={{requiredSlots}}
  maxNarration={{maxNarrationLength}} / maxSubtitle={{maxSubtitleLength}} / maxDuration={{maxDurationSec}}
{{/each}}

# 利用可能な素材（このassetIdのみ使用可）
{{#each assets}}
- assetId={{assetId}} / type={{assetType}} / name={{displayName}}
  説明={{description}} / AI解析={{aiDescription}} / tags={{tags}}
{{/each}}
（画像素材のサムネイル添付は **ADR-0010 P3**。MVP のユーザーメッセージは**テキストのみ**でこの行は出さない）

# 利用可能なゆうこ表情タグ
{{yukoPoseTags}}
```

### 6b. ユーザーメッセージ テンプレート（一般・社内発表 general）

> `videoKind=general` のとき §6 の代わりに使う。会社情報の代わりに generalBrief（テーマ／章立て／要点）を渡す。素材・見た目パターン・表情タグ・補足は §6 と共通。

```text
# 動画のテーマ
タイトル/テーマ: {{title}}

# 構成（章立て・アジェンダ）
{{#each agenda}}
- {{this}}
{{/each}}

# 伝えたい要点
{{#each keyPoints}}
- {{this}}
{{/each}}

# 動画の方針
種別(purpose): {{purpose}}
対象視聴者: {{targetAudience}}
希望尺(秒): {{targetDurationSec}}
トーン: {{tone}}

# 補足・その他（利用者からの自由記述。動画づくりで特に重視する）
{{additionalNotes}}

# 利用可能な見た目パターン（このIDのみ使用可）
{{#each templates}}
- templateId={{templateId}} / category={{category}} / hasYuko={{hasYuko}}
  useCase={{useCase}} / requiredSlots={{requiredSlots}}
  maxNarration={{maxNarrationLength}} / maxSubtitle={{maxSubtitleLength}} / maxDuration={{maxDurationSec}}
{{/each}}

# 利用可能な素材（このassetIdのみ使用可）
{{#each assets}}
- assetId={{assetId}} / type={{assetType}} / name={{displayName}}
  説明={{description}} / AI解析={{aiDescription}} / tags={{tags}}
{{/each}}
（画像素材のサムネイル添付は **ADR-0010 P3**。MVP のユーザーメッセージは**テキストのみ**でこの行は出さない）

# 利用可能なゆうこ表情タグ
{{yukoPoseTags}}
```

---

## 7. few-shot（入力→出力サンプル）

出力例（`ai-video-plan.schema.json` 適合。MockProvider は recruit でこれを返す。general は §7b に準じた発表サンプルを返す）:

```json
{
  "schemaVersion": "1.0",
  "videoPlan": {
    "title": "株式会社サンプル 会社紹介",
    "purpose": "new_graduate",
    "targetAudience": "新卒採用",
    "targetDurationSec": 60,
    "tone": "親しみやすい"
  },
  "parts": [
    {
      "partTitle": "オープニング",
      "summary": "会社名と雰囲気を伝える導入",
      "targetDurationSec": 16,
      "scenes": [
        {
          "sceneTitle": "はじめの挨拶",
          "sceneType": "opening",
          "templateId": "opening_yuko_right_v1",
          "durationSec": 8,
          "assetRefs": { "background": "asset_entrance_001", "logo": "asset_logo_001" },
          "yukoPoseTag": "smile",
          "texts": {
            "title": "株式会社サンプルへようこそ",
            "main": "若手が活躍できる職場です",
            "subtitle": "今日は会社の魅力を紹介します。"
          },
          "narrationText": "こんにちは、ゆうこです。今日は株式会社サンプルの魅力を紹介します。",
          "notes": "冒頭なので明るい印象にする"
        }
      ]
    },
    {
      "partTitle": "会社紹介",
      "summary": "オフィスと働く環境",
      "targetDurationSec": 44,
      "scenes": [
        {
          "sceneTitle": "オフィス紹介",
          "sceneType": "photo_intro",
          "templateId": "photo_left_text_right_yuko_v1",
          "durationSec": 10,
          "assetRefs": { "mainVisual": "asset_office_001" },
          "yukoPoseTag": "guide",
          "texts": {
            "title": "明るいオフィス",
            "main": "相談しやすい雰囲気",
            "subtitle": "風通しの良い職場で働けます。"
          },
          "narrationText": "私たちのオフィスは、明るく相談しやすい雰囲気です。"
        }
      ]
    }
  ],
  "reviewNotes": [
    "素材に人物が含まれるため公開前に映り込みを確認してください。"
  ]
}
```

### 7b. few-shot（一般・社内発表 general）

`videoKind=general` のときは §7 の代わりに**発表・説明向けの出力例**を few-shot に使う（実体＝`fixtures/ai-video-plan.general.sample.json`・`ai-video-plan.schema.json` 適合・`validate:schemas` 済）。採用例と**同じキー名・入れ子・型**で、内容を発表向けにしたもの。要点：

- **`videoPlan.purpose`** は一般 enum（例 `report`）。`targetAudience` は対象視聴者（例「全社員」）、`tone` は発表向け（例「丁寧・落ち着いた」）。
- **章立て（agenda）を `parts` に対応**させ、各章を短いシーンに割る（導入／本題／まとめ）。
- **伝えたい要点を `texts`／`narrationText` に反映**（数値・結論を簡潔に）。会社紹介調の言い回しは避ける。
- **`templateId`／`sceneType` は利用可能な見た目の範囲**で選ぶ（例 opening / photo_intro）。新規テンプレは作らない。
- **`targetDurationSec` と尺配分**：全シーンの `durationSec` の合計を `targetDurationSec` に合わせる（このサンプルは約60秒）。各シーンは §5b の目安（3〜15秒）に収め、必要なシーン数に分ける。最終的な尺は利用者の希望値に合わせる。
- 社外秘・個人情報の懸念は `reviewNotes` に一文を入れる。

> few-shot の実体は fixture を**単一参照元**とする（プロンプト組立 `buildVideoPlanRequest` が `videoKind` で §7／§7b の例を切り替えて読み込む）。

---

## 8. AI出力 → 内部 Scene 変換マッピング（論点①・最重要）

`ai-video-plan` を `project.parts[] / project.scenes[]` へ変換する規則。**この変換と検証(§9)を通さない限り内部データにしない。**

### 8.1 ヘッダ・パート

| AI出力 | 内部 | 規則 |
|---|---|---|
| `videoPlan.title` | `project.projectName` | projectName が空のときのみ採用（ユーザー入力を優先） |
| `videoPlan.purpose` | `project.purpose` | ユーザー選択値を正とし、不一致なら警告のみ（上書きしない） |
| `parts[i]` | `Part` | `partId=part_{連番}` / `title=partTitle` / `description=summary` / `order=i+1` / `targetDurationSec` / `sceneIds=[配下scene]` |

### 8.2 シーン（`parts[i].scenes[j]` → `Scene`）

| AI出力 | 内部 Scene | 規則 |
|---|---|---|
| —（採番） | `sceneId` | `scene_{グローバル連番}`（プロジェクト内一意・3桁） |
| 親part | `partId` | 親 Part の id |
| —（並び） | `order` | 出現順の連番 |
| `sceneType` | `sceneType` | enum検証。不正なら template の category から推定 or `photo_intro` |
| `templateId` | `templateId` | 実在検証（V3）。不在→同 category 標準テンプレへ補正（§9）。**プロジェクトの向き(`aspectRatio`)と不一致なら同 category・同向きへ補正**（ADR-0012・B4。AI出力は向き非依存で、向きはプロジェクト側の正典） |
| `durationSec` | `durationSec` | `clamp(3, テンプレ上限 or 15)`（`11 §4`） |
| `assetRefs` | `assetRefs` | 各 assetId を実在検証（V4）。不在→`null`＋警告。キーはテンプレ slot/background/logo の id（`11 §5`） |
| `yukoPoseTag` | `character` | §8.3 で解決 |
| `texts.*` | `texts.*` | テンプレ必須 textKey が欠けたら警告。長さ>上限→警告（V8、自動切詰めしない） |
| `narrationText` | `narration.text` | §8.4 で初期化 |
| `notes` | （破棄 or `warnings` 参考） | 内部保持は任意 |
| `reviewNotes` | プロジェクトの公開前チェックへ | UI表示用に保持 |

### 8.3 ゆうこ（poseTag → character）解決

1. テンプレに `character` レイヤーが**無い**、または `yukoPoseTag=null` → `character.enabled=false`, `poseAssetId=null`。
2. ある場合: `yukoPoseTag` に一致する `tags` を持つ **yuko asset** を探す → `poseAssetId` に設定、`enabled=true`。
3. 一致なし → 既定 yuko（`isDefaultYuko=true`、無ければ先頭の yuko asset）を採用＋警告。
4. yuko asset が皆無 → レイヤーが `required=false` なら `enabled=false`、`required=true` なら警告。
- `characterId` は既定 `"yuko"`。

### 8.4 ナレーション初期化

```jsonc
"narration": {
  "text": <narrationText>,
  "voiceId": null,        // null=project.voiceSettings を継承（11 §6）
  "speed": null, "pitch": null, "intonation": null,
  "voicePath": null,
  "status": "none"        // 音声は後でシーン単位生成
}
```

### 8.5 トランジション・音量

- `transition`: AI出力に無ければ テンプレ `defaults.transitionIn/Out`、それも無ければ `in:"fade", out:"fade"`、`durationSec=TRANSITION_DEFAULT_SEC(0.5)`。
- `audioMix`: 生成しない（未指定＝project既定を継承。`11 §6`）。

### 8.6 後処理

- `Part.sceneIds` と `Scene.partId` の整合を再構築（V11）。
- 合計尺 > `videoSettings.maxDurationSec` → 警告（V9）。シーン数 > 80 → 警告（V10）。
- すべての補正・警告は該当 `Scene.warnings[]`（必要に応じプロジェクト単位）へ記録し、UIには件数＋「対応内容」を非技術語で提示（`01 §6.7`）。

---

## 9. 検証・補正・リカバリ

- 検証ルール: `11 §8`（V1–V11）。Schemaで表せる範囲は ajv、相互参照はドメインで実装。
- 自動補正ルール: `11 §9`。補正は記録し、ユーザーに「3件を自動調整、1件は確認が必要」のように見せる。

### 9.3 失敗時リカバリ（`07 §13`）
- パース不能/スキーマ重大不適合: ユーザー向けに「動画案の作成に失敗しました。…もう一度お試しください。手動で作成も始められます。」を表示。
- 操作: ①再試行 ②手動でシーン作成 ③前回 `ai/latest_result.json` から復元（**③は post-α・未実装。現状UIは①②のみ**＝復元しない導線で誤誘導しないため、③の導線は出さない）。

---

## 10. セリフ再生成（rewriteNarration）

シーン単位でプリセット指示を渡す（`07 §11`）。入力に元セリフ＋会社トーン＋文字数上限を含め、出力は1文字列。

| プリセット | 指示の主旨 |
|---|---|
| もっと短く | 文字数を減らし要点を残す |
| もっと丁寧に | 敬体・丁寧表現へ |
| もっと明るく | ポジティブで親しみやすく |
| 若手向けに | 若手求職者に響く語り口 |
| エンジニア向けに | 技術職に伝わる具体性 |
| もっとカジュアルに | くだけた口調 |
| 誤字脱字を直す | 表記のみ修正、意味は保持 |

---

## 11. 関連

- AI出力スキーマ: `schemas/ai-video-plan.schema.json`
- 内部データ・enum・定数・バインディング・解決順序: `11_SCHEMA_REFERENCE.md`
- 背景・方針: `07_AI_SPEC.md`
