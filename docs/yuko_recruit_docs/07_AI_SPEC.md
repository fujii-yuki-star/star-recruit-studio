# AI機能仕様書

> ⚠️ **本書は背景・方針の「例示」です。** 実プロンプト本体・構造化出力の強制・AI出力→内部Scene変換・検証/補正の**正典は [`12_AI_PROMPT_AND_MAPPING.md`](12_AI_PROMPT_AND_MAPPING.md)**（データ正典は [`11_SCHEMA_REFERENCE.md`](11_SCHEMA_REFERENCE.md)）。矛盾時は正典を優先します。
> 注: 本書の `purpose` 値（`new_graduate_recruit` / `company_intro` 等）は `11 §3.1` の enum に統一済み。

## 1. 目的

本資料は、「すたりお（stario）」におけるAI機能の役割、送信情報、出力JSON、検証・補正方針を定義する。

---

## 2. AIの役割

AIは動画そのものを生成しない。

AIが担当するのは以下である。

- 動画全体の構成案作成
- パート構成作成
- シーン構成作成
- 使用素材案の選定
- 見た目パターン選定
- セリフ作成
- 字幕作成
- 採用向け表現チェック
- セリフ短縮・言い換え
- 公開前チェック補助

---

## 3. AI Provider方針

初期実装ではOpenAI APIを第一候補とする。

将来的に以下へ拡張できるProvider構造にする。

- OpenAI
- Claude
- Gemini
- Ollama / ローカルLLM
- MockProvider

### 推奨インターフェース

```ts
interface AiProvider {
  generateVideoPlan(input: GenerateVideoPlanInput): Promise<VideoPlanResult>;
  rewriteNarration(input: RewriteNarrationInput): Promise<RewriteNarrationResult>;
  reviewScript(input: ReviewScriptInput): Promise<ReviewScriptResult>;
  classifyAssets(input: ClassifyAssetsInput): Promise<ClassifyAssetsResult>;
}
```

---

## 4. 外部AIに送信する情報

送信許可：画像サムネイルまで送信してよい。
動画は元ファイル全体ではなく、代表フレームを送信する。

### 送信対象

- 会社情報
- 動画目的
- 採用対象
- 希望尺
- トーン
- 素材説明
- 画像サムネイル
- 動画代表フレーム
- 利用可能な見た目パターン一覧
- ゆうこ素材タグ一覧

### 原則送信しないもの

- ローカルファイルパス
- APIキー
- 元動画ファイル全体
- 不要な個人情報
- 社外秘資料

---

## 5. 送信前確認

外部AIへ送信する前に確認画面を表示する。

表示例：

```text
AIが動画案を作るために、以下の情報を送信します。

・会社情報
・動画の目的
・素材の説明
・画像サムネイル
・動画の代表フレーム

元の動画ファイルは送信しません。
送信してもよろしいですか？
```

---

## 6. AIに渡すテンプレート概要

AIにはtemplate.json全体ではなく、選択判断に必要な概要のみ渡す。

```json
{
  "templateId": "photo_text_panel_yuko_v1",
  "name": "写真＋説明パネル＋ゆうこ",
  "category": "photo_intro",
  "useCase": "オフィス紹介、社員紹介、仕事風景紹介",
  "requiredSlots": ["mainVisual", "title", "subtitle"],
  "hasYuko": true,
  "maxNarrationLength": 120,
  "maxSubtitleLength": 60
}
```

---

## 7. AI出力JSON仕様

```json
{
  "schemaVersion": "1.0",
  "videoPlan": {
    "title": "会社紹介動画",
    "purpose": "company_intro",
    "targetAudience": "新卒採用",
    "targetDurationSec": 300,
    "tone": "親しみやすい"
  },
  "parts": [
    {
      "partTitle": "オープニング",
      "summary": "動画の導入として会社名と雰囲気を伝える",
      "targetDurationSec": 15,
      "scenes": [
        {
          "sceneTitle": "はじめの挨拶",
          "sceneType": "opening",
          "templateId": "opening_yuko_right_v1",
          "durationSec": 8,
          "assetRefs": {
            "background": "asset_entrance_001",
            "mainVisual": null,
            "logo": "asset_logo_001"
          },
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
    }
  ],
  "reviewNotes": [
    "素材に人物が含まれるため公開前確認を推奨します。"
  ]
}
```

---

## 8. プロンプト方針

AIには以下を明確に指示する。

- 動画ファイルを生成しないこと
- JSONのみ返すこと
- 存在するtemplateIdのみ使用すること
- 存在するassetIdのみ使用すること
- 各シーンは短く分割すること
- 長尺動画ではパート単位で整理すること
- セリフはゆうこが話す自然な日本語にすること
- 採用動画として誇大表現を避けること
- 字幕は短めにすること

---

## 9. JSON検証

AI出力は必ず検証する。

### チェック項目

- JSONとしてパースできるか
- schemaVersionが対応範囲か
- partsが存在するか
- scenesが存在するか
- templateIdが存在するか
- assetIdが存在するか
- durationSecが範囲内か
- 必須テキストがあるか
- narrationTextがあるか
- 字幕が長すぎないか

---

## 10. 自動補正

| 問題 | 補正 |
|---|---|
| 存在しないtemplateId | 同categoryの標準テンプレートに置換 |
| 存在しないassetId | 未使用素材から候補を提示 |
| durationSecが短すぎる | 3秒に補正 |
| durationSecが長すぎる | 15秒またはテンプレート上限に補正 |
| yukoPoseTagが存在しない | default_yukoに置換 |
| 字幕が長い | 警告＋短縮ボタン表示 |

---

## 11. セリフ再生成

シーン単位で以下を指定できる。

- もっと短く
- もっと丁寧に
- もっと明るく
- もっと若手向けに
- もっとエンジニア向けに
- もっとカジュアルに
- 誤字脱字を直す

---

## 12. 公開前チェック

AIに以下を確認させる。

- 誤字脱字
- 不自然な日本語
- 誇大表現
- 差別的・不適切表現
- 採用動画としての違和感
- 個人情報らしき情報
- セリフが長すぎないか
- 字幕が読みづらくないか

---

## 13. 失敗時の扱い

AI生成に失敗した場合：

- エラーメッセージを非技術者向けに表示
- 再試行ボタン
- 手動でシーン作成するボタン
- 前回のAI結果があれば復元

表示例：

```text
動画案の作成に失敗しました。
通信状況やAI設定を確認して、もう一度お試しください。
手動で作成を始めることもできます。
```
