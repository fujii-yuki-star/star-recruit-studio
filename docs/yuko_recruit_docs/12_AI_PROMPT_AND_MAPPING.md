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
   【同梱の AI のみ】ソフトで整える(§8.7) ── もう一度 検証(§9)
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
| Gemini | `responseMimeType: application/json`（JSONモード）＋ プロンプトでスキーマ強制 | `responseSchema` は本スキーマの `assetRefs`（patternProperties の動的キーマップ）が Gemini 非対応のため**不採用**。代わりに受信前正規化＋再検証で頑健化（自動リトライはしない＝無料枠配慮・再試行は手動。実装＝`sanitizeVideoPlan` / `geminiProvider`） |
| Mock | 固定サンプルを返す（recruit=§7／general=§7b に準じる・videoKind で切替） | テスト・オフライン・既定 |

- いずれの場合も**受信後に必ず ajv 等で再検証**する（モデルが逸脱する前提で二重化）。
- **受信前正規化**：再検証の前に、正典スキーマに無いキーを各階層で除去する（LLM が足しがちな余計キーで `additionalProperties:false` 不適合になる間欠失敗を無害化。型・値は変えないので必須欠落・型違い・enum 外は再検証で捕捉＝§2-2 不変）。
- **自動リトライはしない**：無料枠の API を勝手に再送しない方針。検証不適合なら §9.3 のリカバリ（利用者が「もう一度試す」or 手動作成）へ。受信前正規化で1回でも通りやすくしておく。

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
  - 実装（#585）＝**選定は共有の純粋関数 `selectAssetsForSend`**（`domain/ai/assetSendText.ts`・N は `AI_ASSET_SEND_MAX`）。
    **プロンプト組み立てと送信前確認（`ConfirmScreen`）が必ずこれを共有する**＝「画面で見せた内容」と「実際に送る内容」が
    ズレない（§2-6・ADR-0026②）。片方だけ絞ると確認画面が嘘になるため、**送信側だけの実装は不可**。
  - 「無言の打ち切りをしない」は **送信前確認に件数と次の行動を出す**（「残りN件は送りません。説明やタグを足すか、
    使わない素材を減らしてください」＝§2-5）ことで満たし、`log`（`console.info`）は診断用に送信実行側（provider）へ置く
    （`domain` は副作用を持たない＝`CLAUDE.md §4`）。
  - 上限以下のときは**並べ替えない**（利用者が見慣れた順のまま）。超過時のみ充実度で選び、**同点は元の並びを保つ**
    （安定＝同じ入力なら毎回同じ送信内容＝AI 応答の再現性）。充実度は**名前（ファイル名）では差をつけない**
    （取り込みで必ず付くので順位に効かない）＝説明・AI解析・タグの有無と長さで見る。
- テンプレは全 `template.json` ではなく要約のみ送る（`07 §6`）。

### 4b. 写真の自動説明（同梱の AI・取り込み時・ADR-0052 決定4）

素材一覧の `aiDescription`・`tags` は、**取り込んだときに同梱の AI が写真を読んで付ける**（説明の無い写真は動画案でほぼ使われない＝ADR-0052 の実測）。
- **いつ読むか**＝素材を**取り込んだとき**（ファイル・パス・素材ライブラリ・動画から切り出した1コマのどの道でも）と、**動画を開いたとき**（説明がまだ無い写真・動画だけ＝前の版で取り込んだ素材や、読み終える前に閉じた素材も拾う・#1317）。取り込みの `await` には入れず、裏で**1枚ずつ順に**読む（`src/app/store/assetDescribeQueue.ts`）。同じ写真はこの画面を開いている間に**読み直さない**（読めなかった・捨てた写真も）。読んでいる間に別の動画を開いたら当てない。**書き出し中は当てるのを待つ**（書き出し中は素材の編集を止めている＝自動保存を走らせない）。同梱されていなければ何もしない（説明が付かないだけ・画面に何も出さない）。当てたら未保存に戻す（素材は取り消しの履歴に載らない＝ADR-0020）。
  ⚠️ ~~取り込んだ直後に別の動画を開くと、まだ読んでいない写真は読まれないまま~~ → **#1317 で開き直せば拾う**（同じ動画を開き直したときも、捨てた仕事は「試した」から外して読み直す）。
  ⚠️ ~~既に取り込み済みの素材には付けない~~ → **#1317 で「開いたときに説明の無いものを読む」**（**同梱の AI を選んでいるときだけ**＝Gemini を選んだ人の起動のたびに AI の部品を起こさない／**場面形式だけ**＝タイムライン形式は開いても読まない）。⚠️ **開いただけで「更新日時」が進むことがある**＝説明を付けると未保存になり自動保存されるため（付けた説明を失わないため・許容）。写真を**差し替えても説明は読み直さない**（前の説明が残る＝AI が書いたか利用者が書いたかを区別する欄が無い・利用者判断）。**書き出し中は読み始めない・当てない**（CPU を書き出しに渡す）。
- **直す**＝素材画面の「AI解析」の欄（写真・動画だけ）。送信前確認の「AI解析」と同じ名前。
**このパソコンの中で読む**ので外部送信ではない（`CLAUDE.md §2-6` に当たらない）。付けた説明は既存の欄に入り、Gemini を選んだときは送信前確認に「AI解析」として出る（§4 の素材一覧と同じ道）。

- **読むもの**＝写真は本体、動画は**代表の1コマ**（取り込み時に作るサムネイル）。**元の動画ファイルは読まない**。ゆうこ・ロゴ・BGM は読まない（`describeTarget`）。
- **読まないもの**＝`aiDescription` が既にある素材（**利用者が直した値を AI が上書きしない**）。着地の直前にもう一度見る（待っている間に書かれたら当てない）。タグは**利用者のタグが無いときだけ**付ける（`applyAssetDescription`）。
- **指示と出力の形**＝説明は日本語の1文・`ASSET_DESCRIPTION_MAX_LENGTH` 字以内・見えていることだけ（推測で会社名・人の名前・地名を書かない）。タグは `ASSET_AI_TAGS_MAX` 個まで・1つ `ASSET_AI_TAG_MAX_LENGTH` 字以内（値は `11 §4`）。手がかりとして素材の名前（`displayName`＝利用者が付けたもの）を添える。`{"description","tags"}` を字数の上限つきの schema で縛り、**戻った値の長さはこちらでも確かめる**（越えた説明は捨てる＝付けない・越えたタグは落とす）。実装は `src/domain/ai/describeAssetRequest.ts`。
- **呼び出し**＝Rust の `local_ai_describe_image`（プロジェクトの中の相対パスだけ・写真の拡張子〔jpg・png〕だけ・`IMAGE_MAX_BYTES`〔20MB〕を越える写真は読まない）。写真は data URL にして**このパソコンの中の llama-server にだけ**渡す。視覚の部品（`mmproj`・`local-llm-build.md`）が同梱されていて照合が合うときだけ読める。
  ⚠️ **動画案づくりの「やめる」の世代に乗せない**＝取り込みの裏で読んでいる最中に動画案を作っても、互いを止めない。写真を読む口が llama-server を起動している間に来た動画案づくりも、起動待ちの間に「やめる」で止められる。
  ⚠️ **プロキシを通さない**（相手は必ず 127.0.0.1＝パソコンのプロキシ設定で社内プロキシへ出さない）。

---

## 5. システムプロンプト（採用 recruit・確定版・日本語）

```text
あなたは採用動画の構成プランナーです。会社情報・利用可能な素材・利用可能な見た目パターン（テンプレート）をもとに、採用動画の構成案を作成します。

【厳守事項】
- あなたは動画や画像を生成しません。動画の「構成案」だけを作成します。
- 出力は指定スキーマ（ai-video-plan, schemaVersion "1.0"）に厳密準拠したJSONのみ。前後に説明文・見出し・コードフェンスを付けないこと。出力例にあるキーだけを使い、どの階層にも新しいキーを足さないこと。
- 各シーンに templateId を必ず設定し、「利用可能な見た目パターン一覧」に存在するIDのみ使用する。新しいIDを創作しない。
- assetRefs の値は「利用可能な素材一覧」に存在する assetId のみ。該当が無ければ null にする。
- 値が無い任意項目は null や空配列を入れず、キーごと省略する。narrationText は原則として各シーンに空でない文字列を入れ（掛け合いで narrationLines を使う場面は省略可）、assetRefs は対象スロットが無ければ（キーごと）省略する。
- sceneType は、選んだ templateId の category と同じ値にする（「利用可能な見た目パターン一覧」に無い sceneType は使わず、利用可能な見た目だけで構成する）。
- 各シーンは短く区切る（1シーンで1つの内容）。長い動画はパートに分けて整理する。
- narrationText は会社マスコット「ゆうこ」が話す、自然で親しみやすい日本語にする。各見た目パターンの maxNarrationLength を超えない。
- 掛け合い（複数の声で交互に話す）にしたい場面に限り、narrationText の代わりに narrationLines（[{ text, voiceCharacter, subtitle? }] の配列）で行ごとに分けてよい。voiceCharacter は声のキャラ名（例「ずんだもん」「四国めたん」）。その場面の narrationText は省略してよい。掛け合いが不要なら narrationText（単一）にする。
- texts.subtitle は字幕用に短くする（各見た目パターンの maxSubtitleLength 以内）。ナレーションの要約でよい。
- texts.title / texts.main は画面に出す短い語句にする。
- durationSec は 3〜15 秒を目安にする。見た目パターンに上限があれば従う。
- 全シーンの合計尺を targetDurationSec に近づける。
- 場面は全部で 80 個までにする。超えそうなら内容をまとめて場面の数を減らす（細切れにしない）。
- 誇大表現・差別的表現・事実と異なる断定を避ける。
- yukoPoseTag は場面に合う表情タグ（例：smile, guide, bow）を「利用可能なゆうこ表情タグ一覧」から選ぶ。ゆうこを出さない見た目パターンでは null にする。
- 素材に人物・社外秘が含まれそうな場合は reviewNotes に確認を促す一文を入れる。
```

> モデル・温度などの生成パラメータは実装時に決定（決定論性のため temperature は低め推奨）。
>
> ※ `narrationText` は品質のためプロンプトで「必須」と指示するが、**schema 上は null/空を許容**する（§5b も同様）。AI が空で返しても1回で通すための防御で、受信前正規化＋変換で空に整え「無音シーン」として成立させる（§3・§8.4）。

---

## 5b. システムプロンプト（一般・社内発表 general・確定版・日本語）

> `videoKind=general` のとき §5 の代わりに使う。会社紹介ではなく**発表・説明の構成案**を作る。共通ルール（templateId 必須・sceneType=category・尺・表情タグ・出力契約）は §5 と同じ。

```text
あなたは社内向け・一般向け動画の構成プランナーです。動画のテーマ・構成（章立て）・伝えたい要点・利用可能な素材・利用可能な見た目パターン（テンプレート）をもとに、発表・説明動画の構成案を作成します。

【厳守事項】
- あなたは動画や画像を生成しません。動画の「構成案」だけを作成します。
- 出力は指定スキーマ（ai-video-plan, schemaVersion "1.0"）に厳密準拠したJSONのみ。前後に説明文・見出し・コードフェンスを付けないこと。出力例にあるキーだけを使い、どの階層にも新しいキーを足さないこと。
- 各シーンに templateId を必ず設定し、「利用可能な見た目パターン一覧」に存在するIDのみ使用する。新しいIDを創作しない。
- assetRefs の値は「利用可能な素材一覧」に存在する assetId のみ。該当が無ければ null にする。
- 値が無い任意項目は null や空配列を入れず、キーごと省略する。narrationText は原則として各シーンに空でない文字列を入れ（掛け合いで narrationLines を使う場面は省略可）、assetRefs は対象スロットが無ければ（キーごと）省略する。
- sceneType は、選んだ templateId の category と同じ値にする（一覧に無い sceneType は使わず、利用可能な見た目だけで構成する）。
- 「構成（章立て）」をパート（parts）に対応させ、各章を短いシーンに分ける（1シーンで1つの内容）。
- 「伝えたい要点」を各シーンの texts や narrationText に反映し、要点が漏れないようにする。
- narrationText は会社マスコット「ゆうこ」が話す、対象視聴者に合った自然な日本語にする。各見た目パターンの maxNarrationLength を超えない。
- 掛け合い（複数の声で交互に話す）にしたい場面に限り、narrationText の代わりに narrationLines（[{ text, voiceCharacter, subtitle? }] の配列）で行ごとに分けてよい。voiceCharacter は声のキャラ名（例「ずんだもん」「四国めたん」）。その場面の narrationText は省略してよい。掛け合いが不要なら narrationText（単一）にする。
- texts.subtitle は字幕用に短くする（maxSubtitleLength 以内）。texts.title / texts.main は画面に出す短い語句にする。
- durationSec は 3〜15 秒を目安にする。見た目パターンに上限があれば従う。全シーンの合計尺を targetDurationSec に近づける。
- 場面は全部で 80 個までにする。超えそうなら内容をまとめて場面の数を減らす（細切れにしない）。
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
| `assetRefs` | `assetRefs` | 各 assetId を実在検証（V4）。不在→`null`＋警告。キーはテンプレ slot/background/logo の id（`11 §5`）。**同梱の AI の経路では空いている差し込み口をソフトが埋める**（§8.8）＝V6 はその後に見る |
| `yukoPoseTag` | `character` | §8.3 で解決 |
| `texts.*` | `texts.*` | テンプレ必須 textKey が欠けたら警告。長さ>上限→警告（V8、自動切詰めしない） |
| `narrationText` | `narration.text` | §8.4 で初期化 |
| `narrationLines[]` | `scene.lines[]`（掛け合い・#180） | あれば行ごとに変換：`lineId=line_NNN`（§2.1）、`text`、`voiceCharacter`→`speaker`（voiceCatalog・未知は既定声＋`LINE_SPEAKER_UNKNOWN` 警告）、`subtitle`→`subtitleText`、`subtitleEnabled`、`status=none`。無ければ単一 `narration` のまま（後方互換）。ADR-0015 |
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
  "text": <narrationText ?? "">,  // null/省略時は空文字＝無音シーン（自動リトライせず1回で通すための許容。後から場面編集で追加可）
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
- 合計尺 > `videoSettings.maxDurationSec` → 警告（V9）。シーン数 > 80 → 警告（V10）。⚠️ **断るのは取り込む側**（#1222）＝`projectStore` が反映せずに断る（`AI_SCENE_LIMIT_EXCEEDED`）。この警告は**変換の記録**であって、止める役ではない。⚠️ **先に伝えてある**＝`§5`／`§5b` のプロンプトに「場面は全部で80個まで」。
- すべての補正・警告は該当 `Scene.warnings[]`（必要に応じプロジェクト単位）へ記録し、UIには件数＋「対応内容」を非技術語で提示（`01 §6.7`）。

### 8.7 同梱の AI の動画案をソフトで整える（ADR-0052 段階1・#1291）

**同梱の AI**（このパソコンの中・ADR-0051）の経路だけ、検証（§9）に通った `ai-video-plan` を**変換（§8.1〜8.6）の前に**
ソフトが機械的に決められることで整え、**もう一度同じ検証を通してから**変換へ渡す（`§2-2`）。⚠️ **Gemini の経路は変えない**
（ADR-0052 決定3「当面そのまま」）。⚠️ **ai-video-plan の形は変えない**＝入出力とも同じ schema。
⚠️ **場面を足さない・消さない・場面の種類（`sceneType`）を変えない**＝話の流れは AI の判断（ADR-0052 決定1）。
実装は `src/domain/ai/refineVideoPlan.ts`（純粋関数）／呼び出しは `LocalVideoPlanProvider`。

順番に意味がある（前の段が後の段の入力を変える）：

| 順 | 何を | 規則 |
|---|---|---|
| 1 | **固有名詞** | 指示文（§6）の出力フォーマットの末尾に「会社名は `{会社名}`、採用ページの URL は `texts.url` に `{採用ページ}` と書く」を足し（**採用で・入力に値があるときだけ**）、few-shot（§7）の例の会社名 `株式会社サンプル` も `{会社名}` にして見せる（例の名前を書き写させない）。返った案の**すべての文字の欄**（題名・パート名・要約・場面名・`texts.*`・語り・掛け合い・`reviewNotes`）で印を入力の値へ置き換える（全角の括弧・二重の括弧も拾う。**値の無い印は空**＝印のまま画面に出さない）。さらに**崩れた会社名**（「株式会社サンプル物流」→「株式会社サンプル」＝会社の種類の語〔株式会社など〕に続く本体が途中で切れたもの。本体の先頭2字以上が一致し、続く字が名前の続きになりえない〔漢字・カタカナ・英数字・長音でない〕とき。**種類の語が後ろに付く会社名**〔「サンプル物流株式会社」→「サンプル株式会社」〕も同じ規則で、前の字が名前の続きになりえないとき）を入力の会社名に直す。`texts.url` が空でなく採用ページと違えば採用ページにする |
| 2 | **見た目の選び直し** | 場面の種類の中で、AI に渡したのと同じ見た目の要約（§4）から選ぶ。候補は**当てた素材が全部入る**（差し込み口の数が足りる）ものだけ。点（小さいほど良い・**中身を消す方向がいちばん重い**）＝表情の指定があるのにゆうこのいない見た目 1000（立ち絵が黙って消える）／直前の場面と同じ見た目 100／語りが上限を越える 10／表情の指定が無いのにゆうこのいる見た目 3／AI の選択と違う 1（**他の条件が同じなら AI の選択を残す**）。移すときは差し込み口の素材を順に移す（同じ id の口はそのまま・背景など差し込み口以外の鍵は動かさない）。⚠️ **AI の `templateId` が一覧に無い・種類と合わない場面は選び直さない**＝§8.2 の補正と警告に任せる（どの鍵が差し込み口か分からないので、ここで移すと写真が新しい見た目に無い鍵に残ったまま**警告も出ない**＝ADR-0026④）。連続の判定では直前の見た目として数える |
| 3 | **文字数の上限越え** | 見る対象と上限の継承は §8.2 の長さの助言（V8）と同じ（語り＝`maxNarrationLength`／字幕＝`maxSubtitleLength`／無ければ `11 §4` の既定。掛け合いは各行、字幕を省いた行は語りが字幕に出るので字幕の上限でも見る＝そのときは**字幕だけ**を付け、語りは縮めない）。越えた文だけ同梱の AI に短く言い直させる（§10「もっと短く」と同じ趣旨・出力は `{"text"}` を字数の上限つきで縛る＝`shortenTextRequest.ts`）。**会社名は `{会社名}` にしてから渡し**（上限は印の分だけ短く渡す）、戻ったら差し込み・崩れを直す。**返った文の長さはこちらで確かめ直す**＝空・上限越え・失敗なら**元の文を残す**（黙って切らない。変換の長さの助言がそのまま出る）。⚠️ **次のときは残りの言い直しを頼まない**＝「やめる」が押された／次の動画案づくりが始まった／**呼び出し**が1回でも失敗した（Rust の止める合図は走っている1回にしか効かず、呼ぶたびに新しい生成として数えられる＝押した後に次の言い直しが走り出したり、古い回の言い直しが新しい回を「やめた」扱いにして壊したりしないように） |
| 4 | **尺の配分** | 各場面の下限＝語りを読み切る長さ（字数 ÷（`NARRATION_CHARS_PER_SEC`×動画全体の声の速さ `voiceSettings.speed`）＋`NARRATION_SCENE_PADDING_SEC`・`11 §4`・#1318。掛け合いは行を足す）を 0.1 秒へ切り上げ、`AI_SCENE_MIN_DURATION_SEC` 以上。上限＝見た目の `maxDurationSec`（無ければ `AI_SCENE_MAX_DURATION_SEC`）。**上限が下限より優先**（§8.2 の clamp と同じ・#607）。下限の合計が**利用者の目標の尺**（AI が書いた `videoPlan.targetDurationSec` ではない）に足りなければ、余りを **AI が付けた尺の比**で上限まで配る。下限の合計が目標を越えるなら下限のまま（**語りを切らない**＝尺を越える。点数で見る）。結果は 0.1 秒（`SEC_STEP`）の格子（見た目の上限が格子に乗らないときは丸めで上限を越えないよう上限で押さえる） |

整えた内容（固有名詞の数・見た目を変えた数・言い直せた/言い直せなかった数）は `console.info` に残す（画面には出さない）。
整えた案がもう一度の検証に通らなければ（整える処理の不具合）、**検証済みの整える前の案**を使う（「読み取れなかった」とは言わない＝利用者の次の行動にならない）。
点数（ADR-0052 決定7）は `scripts/local-llm/eval-real-prompt.ts`＋`planScore.ts`、結果の記録は `local-llm-build.md`。

### 8.8 写真・動画の割り当て（同梱の AI のみ・ADR-0052 決定2・5・#1292）

**同梱の AI の経路だけ**、変換（§8.2）の中で、**空いている差し込み口**へソフトが写真・動画を当てる（`TransformContext.autoAssignAssets`・実装は `src/domain/ai/assignAssets.ts`）。⚠️ Gemini の経路は変えない（ADR-0052 決定3）。

- **AI に書かせるもの**＝指示文（§6）の末尾に「各シーンの `notes` に、その場面で見せたい写真・動画の中身を短く書く（例「倉庫で働く人の写真」）。`assetRefs` は素材がはっきり合うときだけ入れ、迷ったら省略する」を足す（**素材が1つでもあるときだけ**・`VISUAL_WISH_RULE`）。`notes` は schema に在る任意の欄＝**`ai-video-plan` の形は変えない**（ADR-0052 決定3 の「下書きの schema」は、この形で足りないと点数で分かったときに足す）。
- **比べ方**＝場面の言葉（`notes`・場面名・画面の文字・語り・掛け合いの行）と、素材の言葉（名前・説明・AI解析〔§4b〕・タグ）を**1つずつ別々に**2字の並びで比べ、素材の言葉の並びのうち場面の言葉にもある割合の**いちばん高いもの**を点（0〜1）にする（ファイル名 `IMG_1234` などが説明の重なりを薄めない）。
- **当て方**＝①点が `ASSET_MATCH_MIN_SCORE`（`11 §4`）以上の組を、点の高い順に（同点は場面の順・素材の順）②**余った素材を残った口へ場面の順に**（同じ口の中では点の高い素材から・なるべく全部使う＝決定5）。**同じ素材を重ねない**・**AI が当てた素材は動かさず、ほかの場面にも使わない**・入れられるかは手で選ぶときと同じ規則（`isAssignableToLayer`＝写真だけの口に動画を入れない）・当てるのは `slot` 層だけ（背景・ロゴは当てない）・ゆうこ・ロゴ・BGM は当てない。
- **自信の低い割り当て**（点が `ASSET_MATCH_MIN_SCORE` 未満＝②の余りを含む）には場面の警告 `ASSET_AUTO_ASSIGNED`（info・`15 §6`）を付ける＝**成功のふりをしない**（ADR-0026④）。自信のある割り当てには付けない。
- **V6（必須の差し込み口が空）は割り当ての後に見る**＝埋めた口を「まだ選ばれていません」と言わない。
- ⚠️ **差し込み口の無い場面（箇条書きなど）には当てない**＝場面の種類を変えるのは AI の判断（決定1）。写真が余っても種類は変えない（余りは点数で見る＝決定8 の見直しの候補）。
- 「空いている口」＝鍵が無い・`null`（AI が明示的に空にした口も埋める）。「使っている素材」＝**その場面の見た目に在る層の鍵**に入ったものだけ（`11 §5`＝一致する鍵だけが描かれる＝向きの補正で見た目が替わって描かれなくなった鍵の素材は、ほかの口に当てる）。
- ⚠️ 印（`ASSET_AUTO_ASSIGNED`）は、利用者が素材を選び直しても自動では消えない（`REQUIRED_SLOT_EMPTY` と同じ＝変換の記録）。

### 8.9 写真の場面の数（同梱の AI のみ・ADR-0052 追補5＝利用者判断 C・#1292）

場面の種類を決めるのは AI のまま（ADR-0052 決定1）。ソフトは**見せる選択肢を機械的に絞る**だけ。

- **写真・動画が1件も無いとき**＝差し込み口のある見た目（要約の `requiredSlots` が空でないもの）を**見た目パターン一覧から外して**AI に渡す（`templatesForAssets`）。§8.7 の整える段も同じ一覧を使う。⚠️ 外すと1つも残らないなら外さない。
- ⚠️ **写真・動画の件数は伝えない**＝試したが小さいモデルが安定して従わず、「N 個作る」と言い切ると場面が膨らんだ（ADR-0052 追補5 の実測）。余った写真は使われないまま残る（§8.8 の割り当ては差し込み口のある場面にだけ当てる）。
- 実装は `LocalVideoPlanProvider`（生成の前に一覧を絞る）。Gemini の経路は変えない。

---

## 9. 検証・補正・リカバリ

- 検証ルール: `11 §8`（V1–V11）。Schemaで表せる範囲は ajv、相互参照はドメインで実装。
- 自動補正ルール: `11 §9`。補正は記録し、ユーザーに「3件を自動調整、1件は確認が必要」のように見せる。

### 9.3 失敗時リカバリ（`07 §13`）
- パース不能/スキーマ重大不適合: ユーザー向けに「動画案の作成に失敗しました。…もう一度お試しください。手動で作成も始められます。」を表示。
- 操作: ①再試行 ②手動でシーン作成 ③前回 `ai/latest_result.json` から復元（**③は post-α・未実装。現状UIは①②のみ**＝復元しない導線で誤誘導しないため、③の導線は出さない）。

---

## 10. 編集の途中の AI 補助（ADR-0053）

> ⚠️ 以前ここにあった「セリフ再生成（rewriteNarration）」のプリセット7種（`07 §11`）は**実装されないまま**だった。
> ADR-0053 で**同梱の AI が得意な大きさ**（1文・数秒）に絞って書き直した。`07 §11` は例示として残る（正典はここ）。

場面編集の欄ごとにボタンを置き、**同梱の AI だけ**に頼む（設定で Gemini を選んでいても外へは送らない＝`§2-6`）。
**候補を最大 `ASSIST_CANDIDATES`（3）個**返させ、**検証してから**見せ（`§2-2`）、利用者が「使う」を押した候補だけを場面へ当てる。

| ボタン（欄） | 種類 | 字数の上限 | 指示の主旨 |
|---|---|---|---|
| 短く（セリフ） | `shorten` | 今の文の 7 割（`maxNarrationLength` も越えない） | 意味と要点を保って短く |
| 丁寧に（セリフ） | `polite` | `maxNarrationLength`（無ければ `MAX_NARRATION_LEN_DEFAULT`） | 丁寧で落ち着いた「です・ます」 |
| やわらかく（セリフ） | `soft` | 同上 | 話しかけるような、親しみやすい言い方 |
| 尺に合わせる（セリフ） | `fitDuration` | 表示時間で読み切れる字数＝`(durationSec − NARRATION_SCENE_PADDING_SEC) × NARRATION_CHARS_PER_SEC × その場面の声の速さ`（`11 §4`・#1318） | 要点を残して、その字数以内に。**もう収まっていれば AI を呼ばない** |
| 語りから作る（字幕） | `subtitle` | `maxSubtitleLength` と `ASSIST_SUBTITLE_TARGET_LENGTH`（30）の短い方 | 語りの要点を字幕に（内容を足さない） |
| 候補を出す（見出し） | `title` | `ASSIST_TITLE_MAX_LENGTH`（20） | 場面の短い見出し（文にしない＝名詞で終わる）。**掛け合いの場面も出す**＝元は行をつないだ語り（`sceneSpokenText`・#1316） |
| 短く／丁寧に／やわらかく（**掛け合いの各行**） | `shorten`/`polite`/`soft` | 上と同じ | 行ごとに頼む（#1316）。「使う」でその行だけ書き換え、その行の声は作り直しが要る状態に戻る。行には表示時間が無いので「尺に合わせる」は出さない |
| 題名の候補（**動画の名前**の横） | `videoTitle` | `ASSIST_VIDEO_TITLE_MAX_LENGTH`（24） | 主題（会社名／発表の題）と場面の語りを頭から（`videoTitleSource`・`ASSIST_VIDEO_SUMMARY_MAX_LENGTH` 字まで）を材料に、文にしない題名（#1316） |

- 割合・上限・数は `11 §4`（`ASSIST_*`）。**上限が `ASSIST_MIN_LENGTH`（8 字）未満なら頼まない**（言い直しても意味が残らない）＝`AI_ASSIST_NOT_NEEDED`。
- **掛け合いの場面では字幕・見出しのボタンを出さない**（`narration.text` が行の編集に追従しないため＝ADR-0053）。セリフ欄そのものも掛け合いでは行ごとの欄になるので出ない。
- **頼んだ時点の文と食い違った候補は出さない**（待つ間・見ている間に元の文や見た目パターンが変わったとき）。
- **公開前チェックから**（ADR-0053 決定2）：「セリフの長さ」→`shorten`、「早口になる場面」→`fitDuration` を、開いた場面のセリフ欄で1回だけ頼む。
- 共通の指示：**元の文に無い事実（数字・制度・評価）を足さない**／会社名は `{会社名}` にして渡す（`§8.7` と同じ。戻すと伸びる分だけ短い上限を渡す）。
- 出力の形＝`{"candidates": string[]}`（`maxItems`＝3）。llama-server の文法で縛る。⚠️ **字数は形で縛らない**（各 `maxLength` は上限の2倍＝暴走よけ）＝文法で字数を縛ると**上限の字で途中で切られた文**が出た（実測＝「…届けてい」）。字数は検証で見る。
- 検証（`parseAssistCandidates`）：文字でない・空・**会社名を戻した後で**上限越え・元と同じ・重なりを落とす。括弧（「」）の囲みは外す・改行は消す・数字と和文の間の空白を詰める・崩れた会社名は直す。**1つも残らなければ `AI_ASSIST_FAILED`**（場面は変えない）。
- 呼び出しは Rust の `local_ai_assist`＝動画案づくりの「やめる」の世代に**乗せない**（写真を読む口と同じ）。
- 実装：`src/domain/ai/assist.ts`（純粋関数）・`src/app/components/AiSuggest.tsx`（画面）。

---

## 11. 関連

- AI出力スキーマ: `schemas/ai-video-plan.schema.json`
- 内部データ・enum・定数・バインディング・解決順序: `11_SCHEMA_REFERENCE.md`
- 背景・方針: `07_AI_SPEC.md`
