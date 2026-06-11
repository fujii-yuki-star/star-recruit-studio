## 目的 / 背景
- このPRで解決したいことを1〜3行で記載

## PR向き先
- [ ] 作業ブランチから `develop` へのPRである
- [ ] 例外的に `main` へ出す場合は理由を本文に記載した

## 変更内容
- 変更点1
- 変更点2

## 確認項目（機械チェック）
- [ ] `npm run lint` が通る
- [ ] `npm run typecheck` が通る
- [ ] `npm test`（vitest）が緑
- [ ] `npm run build` が通る
- [ ] `npm run validate:schemas` が通る
- [ ] Rust変更がある場合 `cargo check --manifest-path src-tauri/Cargo.toml` が通る
- [ ]（一括）`npm run review` を実行した

## 品質ゲート（このプロジェクト固有 / CLAUDE.md §7 DoD）
- [ ] 通常UIに技術用語が漏れていない（JSON/テンプレート/レンダリング/Provider 等は出さない。`06_UI_SPEC §3` / `16_GLOSSARY`）
- [ ] 正典（`11_SCHEMA_REFERENCE` / `12_AI_PROMPT_AND_MAPPING` / `schemas/`）と矛盾しない（enum・定数を直書きしていない）
- [ ] ユーザー向けエラーは「原因」でなく「次の行動」を示す（`15_ERROR_STATE_MODEL`）
- [ ] APIキー・秘密情報・元動画をコミット/ログに含めていない（`13 §7`）

## 影響範囲
- [ ] Tauri command の追加/変更: あり・なし（ありの場合は本文に記載）
- [ ] 外部通信先の追加/変更: あり・なし（ありの場合は本文に記載）
- [ ] データスキーマ（`schemas/`）の変更: あり・なし（ありの場合は `11`/`12` も更新）

## UI変更がある場合
- [ ] スクリーンショットを添付した
- [ ] 主要操作の再現手順を記載した

## レビューポイント
- 見てほしい箇所・判断に迷った箇所

## 関連Issue
- Closes #

## AI利用メモ（任意）
- 利用したAIツール:
- 主な指示内容:
- 人手で確認した点:
