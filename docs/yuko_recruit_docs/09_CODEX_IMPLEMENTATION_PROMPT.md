# Codex向け実装指示書

## 1. 前提

あなたは「ゆうこ採用ムービーメーカー」というPC向け動画制作支援ソフトを実装します。

主利用者は非技術者の採用担当者です。
本ソフトは、AIが動画そのものを生成するのではなく、AIが動画構成JSONを生成し、ソフトがテンプレートに沿って画像・動画・テキスト・ゆうこ素材・音声・BGMを機械的に配置してMP4を生成する方式です。

---

## 2. 重要方針

- 通常UIにJSON、FFmpeg、LLM、Providerなどの技術用語を出さないこと。
- 内部データはJSONで管理すること。
- AI出力は必ず検証してからシーンカード化すること。
- まずは16:9 / 1920x1080 / 30fpsの横動画を対象とすること。
- テンプレートはJSONで定義し、後から追加可能にすること。
- ゆうこ素材はテンプレートに従って配置すること。
- ゆうこは常時表示ではなく、テンプレート・シーンごとに表示有無を持つこと。
- 動画素材は開始秒・終了秒・元音声ON/OFFを設定可能にすること。
- BGMは標準BGMとユーザー追加BGMの両方に対応すること。

---

## 3. 推奨技術構成

- アプリ：Tauri
- UI：React + TypeScript
- 状態管理：Zustand等、軽量なものでよい
- 保存：ローカルJSONファイル
- 動画処理：FFmpeg
- 音声合成：VOICEVOX連携を想定
- AI：Provider抽象化し、初期はMockProviderから開始

---

## 4. 最初に実装する範囲

### Step 1：プロジェクト雛形

- Tauri + React + TypeScriptのプロジェクトを作成する。
- `src/domain`、`src/renderer`、`src/ai`、`src/voice`、`src/template` などの責務別ディレクトリを用意する。

### Step 2：データ型定義

以下の型をTypeScriptで定義する。

- Project
- Asset
- Part
- Scene
- Template
- TemplateLayer
- VoiceSettings
- BgmSettings
- AiVideoPlan
- RenderJob

参照資料：`03_DATA_SCHEMA.md`

### Step 3：プロジェクト保存

- 新規プロジェクト作成
- project.json保存
- project.json読み込み
- プロジェクトフォルダ作成

### Step 4：素材登録

- 画像登録
- 動画登録
- BGM登録
- ゆうこ素材登録
- サムネイル表示
- 素材説明文編集

### Step 5：テンプレート読み込み

- templatesフォルダからtemplate.jsonを読み込む。
- テンプレート一覧を表示する。
- サムネイルを表示する。
- 不正なテンプレートはエラー扱いにする。

### Step 6：シーンカード編集

- パート作成
- シーン作成
- シーン削除
- シーン複製
- 並び替え
- セリフ編集
- 字幕編集
- 素材差し替え
- 見た目パターン変更

### Step 7：プレビュー

- template.layersをもとにHTMLまたはCanvasで描画する。
- 画像、テキスト、字幕、ゆうこ素材、装飾パネルを表示する。
- 動画素材は最低限再生できればよい。

### Step 8：音声生成の土台

- VoiceProviderインターフェースを作る。
- 初期はMockVoiceProviderでダミー音声または未生成状態を扱う。
- 後からVOICEVOX連携を差し込める設計にする。

### Step 9：AI Providerの土台

- AiProviderインターフェースを作る。
- 初期はMockProviderで固定JSONを返す。
- AI結果を検証し、シーンカードへ変換する。

### Step 10：簡易MP4出力

- FFmpegを呼び出して、画像＋字幕＋音声から短いMP4を生成する。
- 最初は1シーンだけでよい。
- 次に複数シーン結合へ拡張する。

---

## 5. 推奨ディレクトリ構成

```text
src/
  app/
    screens/
    components/
    hooks/
  domain/
    project/
    asset/
    scene/
    template/
    voice/
    render/
    ai/
  infrastructure/
    fileSystem/
    ffmpeg/
    voicevox/
    aiProviders/
  renderer/
    preview/
    export/
  utils/
```

---

## 6. 実装時の注意

- AI API連携より先にMockProviderで全体フローを通すこと。
- FFmpeg出力より先にアプリ内プレビューを作ること。
- テンプレート作成エディタは初期対象外。
- 完全な動画編集タイムラインは初期対象外。
- 画面文言は採用担当者向けにすること。

---

## 7. 完了条件

初期実装の完了条件：

- Mock AIから返した動画構成JSONをシーンカード化できる。
- シーンカードを編集できる。
- テンプレートに沿ってプレビュー表示できる。
- 画像、テキスト、ゆうこ素材を含む短いMP4を生成できる。
- project.jsonを保存・読み込みできる。

---

## 8. 禁止・後回し事項

初期実装では以下を行わない。

- 本格的なタイムラインエディタ
- キーフレームアニメーション
- 3D演出
- Live2D
- 複雑なエフェクト
- テンプレート作成エディタ
- 全AI Provider対応

---

## 9. 開発の進め方

小さく実装し、必ず動く単位でコミットすること。

推奨コミット単位：

1. app scaffold
2. domain types
3. project save/load
4. asset import
5. template loader
6. scene editor
7. preview renderer
8. mock AI import
9. voice mock
10. ffmpeg export prototype
