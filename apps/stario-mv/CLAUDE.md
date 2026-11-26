# CLAUDE.md — すたりおMV（γ）AI開発ガイド

> このファイルは `apps/stario-mv/**` を触るときに追加で読まれる、**姉妹ソフト すたりおMV（γ）の規約**です。
> ⚠️ **ルートの `CLAUDE.md`（α＝すたりお の規約）の §2・§4・§5・§10・§11 はここでは当てはめない**（ADR-0075 決定4）。
> ⚠️ まだ骨組みの段階（#1337 §15 ④）。規約は γ の作業が進むにつれて足す（決めたことは MV-0001 以降の ADR に残してから書く）。

## 0. 正典

| 区分 | 場所 |
|---|---|
| 設計の大枠 | [`ADR-0074`](../../docs/yuko_recruit_docs/adr/0074-stario-mv-gamma-design.md)（製品の分け方・データの形・外部 AI の操作口・機能・プラグイン・版の割り振り） |
| 同居の境界 | [`ADR-0075`](../../docs/yuko_recruit_docs/adr/0075-gamma-repo-boundary.md)（置き方・共有・資料の置き場） |
| γ の資料 | [`docs/stario_mv_docs/`](../../docs/stario_mv_docs/README.md)（schema・ADR は `MV-0001` から） |

## 1. 製品一行

自宅の上位 PC で**本人だけが使う**、高度なタイムライン編集・モーショングラフィックス・MV 制作の道具。**利用者が持ち込む外部 AI（Claude・Codex 等）に操作させる**ことが大前提（同梱の AI は無い）。

## 2. 原則（ADR-0074 から）

1. **α を変えない**。α のファイルに手を入れる必要が出たら、作業を止めて利用者に確認する（ADR-0075）。
2. **外部 AI の書き込みも必ず検査を通す**（JSON Schema が正典・取引の単位で反映）。⚠️ 操作を足すときは一覧（`mv-operations.json`）と `mv-ops` を同時に変える＝片方だけだと検査が落ちる。
3. **プレビュー＝書き出し**＝同じ描画のコードを両方で通す（Rust の wgpu・**プレビューもネイティブの窓に描き、透明な画面を上に重ねる**＝MV-0002）。
4. **黙って別の結果にしない**（壊れた式・動かないプラグインは知らせて書き出しを止める）。
5. **γ からネットへ送らない**（外へ送るのは AI 側の仕事）。
6. **開発する PC の性能で技術を制限しない**（使うのは上位 PC）。

## 3. 置き方と共有（ADR-0075）

- γ のものは全部 `apps/stario-mv/` の中（独自の package.json・lock・vite・tsconfig・src-tauri）。開発サーバは **1430 番**（α は 1420）。
- Rust は `apps/stario-mv/Cargo.toml` を根にしたワークスペース。**芯は `crates/mv-core`**（プロジェクトの形・検査・読み書き・時刻の値＝画面にも Tauri にも依存しない＝MV-0001 追補）。**描画の核は `crates/mv-render`**（プレビュー・書き出し・外部 AI の「1コマ描く」が全部これを通す＝MV-0002・MV-0003）。**書き出しは `crates/mv-export`**（コマンド `stario-mv-export`＝MV-0004）。**アプリ（`src-tauri`）はプレビューの糸を持ち、描画の核の絵を窓へ写すだけ**（画面は命令を送る＝MV-0007）。**外部 AI の操作口は `crates/mv-ops`**（MCP とコマンド `stario-mv-ai`＝中身は1つ・操作の一覧の正典は `docs/stario_mv_docs/schemas/mv-operations.json`＝MV-0005）。
- α の部品を写したら [`COPIED_FROM.md`](COPIED_FROM.md) に1行足す。参照（同梱の ffmpeg・transcribe）もそこに書く。
- ⚠️ ルートの α の門番テスト・CI は γ を見ない。γ の検査は γ の中で回す：
  - `npm run check:frontend`（lint→typecheck→test→build）
  - `npm run check:rust`（check→fmt→clippy）・`npm run check:rust:test`
  - CI は `.github/workflows/mv-ci.yml`

## 4. 進め方

- push・PR の前に利用者の許可を取る。新しく書いた検査は、壊して赤くなることを確かめる（変異チェック）。
- α・β の不具合や急ぎの依頼は γ より優先する（#1337 の着手判断 2026-11-25）。
