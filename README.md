# star-recruit-studio（すたりお / stario・旧称：ゆうこ採用ムービーメーカー）

採用担当者が会社情報と写真・動画を入力すると、AIが**動画構成案**とマスコット「ゆうこ」のセリフを生成し、ソフトが**見た目パターン（テンプレート）に沿って機械的に**動画を組み立て、プレビューとMP4出力ができる **Windows 向け採用動画制作支援ソフト**。

> AIは動画を生成しない。AIは構成JSON（`ai-video-plan`）を返し、検証・変換を経てソフトがテンプレートで動画化する。

## ステータス
Phase 0（技術検証）。ドメインの検証・変換パイプライン、共有レンダラ（レイアウト→SVG）まで実装。詳細は `docs/yuko_recruit_docs/02_MVP_ROADMAP.md`。

## 技術スタック
Tauri v2 / React 19 + TypeScript（Vite）/ Rust / FFmpeg(OpenH264) / VOICEVOX / AIプロバイダ抽象（初期 Mock）。詳細・ライセンスは `docs/yuko_recruit_docs/13_DEPENDENCIES_AND_LICENSING.md`。

## セットアップ / 開発
```bash
npm install
npm run tauri dev     # アプリ起動（Rust + WebView）
npm run dev           # フロントのみ
npm test              # ユニットテスト（vitest）
npm run review        # lint + typecheck + test + schemas + build + cargo 各種
```

## ディレクトリ
```
src/
  app/            UI（screens / components / hooks）。技術用語を出さない層
  domain/         純粋ドメイン（型・検証・変換・計算）。副作用なし
  infrastructure/ 外部連携（fileSystem / ffmpeg / voicevox / aiProviders）
  renderer/       preview / export（ADR-0001：静止レイヤーをWeb描画→PNG→FFmpeg合成）
  utils/
src-tauri/        Rust（Tauri）
docs/yuko_recruit_docs/   設計資料（正典は 11/12/15 + schemas/、ADRは adr/）
scripts/          検証・実験スクリプト
```

## 正典（読む順）
1. `CLAUDE.md` — AI開発規約・絶対原則・資料の地図
2. `docs/yuko_recruit_docs/README.md` — 資料索引
3. `11_SCHEMA_REFERENCE.md` ＋ `schemas/`、`12_AI_PROMPT_AND_MAPPING.md`、`15_ERROR_STATE_MODEL.md`

## 開発フロー / 品質
- ブランチ：作業ブランチ → **`develop`** へPR（`main` は安定）。詳細は `CONTRIBUTING.md`。
- CI：lint / typecheck / build / schema検証 / vitest / cargo check・fmt・clippy・test / gitleaks / 依存監査。PRコメント `@claude` で AIレビュー。
- 秘密情報はコミット禁止（`.env.example` 参照・OSキーチェーン保管）。

## ライセンス
未定（`13` の依存・ライセンス整理を参照）。
