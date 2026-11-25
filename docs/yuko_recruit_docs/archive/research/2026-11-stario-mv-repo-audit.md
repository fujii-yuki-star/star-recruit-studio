# すたりおMV（γ）着手前のリポジトリ再監査（2026-11-25）

> #1337 §15「着手時の最初の仕事」①。読み取りのみ（α は何も変えていない）。凍結点＝develop `dec9aadf`。
> 3方向（Rust 側／画面側／ビルド・配布・CI・資料）を並行で調べた結果のまとめ。

## 1. 全体像

- いまのリポジトリは**どこを見ても「ルート＝α ただ1つ」**の作り。
  - ルートの `package.json`／`vite.config.ts`（1420 番固定）／`index.html`／`tsconfig.json` が α そのもの。
  - Tauri は `src-tauri/` が1つ。Cargo のワークスペースは無い。
  - CI 4本・スクリプト・門番テスト・資料・スキル・レビュア・CLAUDE.md が α 前提。
- 使い回せる部品は意外と多いが、**どれも「同じ `src/`・同じ crate の中から直に使う」形**で書かれている。
- α の移動（モノレポ化）は「正典・門番・スクリプト・CI を全部書き換える」大工事になり、ADR-0074 の「α を変えない」と衝突する。

## 2. 共有できるもの（分類：S＝そのまま／S'＝小さく切れば／A＝α 専用／G＝γ も要るが作り直し）

### Rust（src-tauri）

| 部品 | 分類 | 注意 |
|---|---|---|
| proc（窓なし起動・Job で寿命を結ぶ） | S | 最有力 |
| disk（空き容量）・sysmem（空きメモリ） | S | |
| opener（アプリが作った場所だけ開く） | S | |
| trouble_log（記録） | S' | ファイル名 `stario.log` 固定・`local_llm` の掃除を呼んでいる |
| messages（断りの文） | S' | 共有分（開く・素材・文字起こし・ごみ箱）だけ切る |
| startup（起動の引数の読み方・終了コード） | S' | 枠だけ共有、引数一覧はアプリごと |
| assets（取り込み・読み出し・欠け検出・複製・ごみ箱） | S' | `projects/<id>` と β の一時の動画への寄り道を外す |
| ffmpeg.rs（9,847 行・本体約 5,080 行） | 汎用は推定約 1,500 行（S'）・残りは A | 汎用＝探索・実行・中止・コーデック判定・色の扱い（ADR-0069）・プローブ・サムネイル・波形・コマの取り出し・出力を原子的に置く処理。**場面を焼いてつなぐ書き出し本体は A（γ は G）** |
| transcribe（whisper） | S' | 入力とキャッシュの場所を呼ぶ側が渡す形に |
| 持ち込みフォント一式（lib.rs） | S' | |
| ai・local_llm・voicevox・voicevox_engine・packs・temp_sessions | A | γ に同梱 AI・VOICEVOX 同梱は無い（決定1） |

主な障害：
- **ハブの絡み**：`resolve_project_file`／`assets::project_dir` が β の一時の動画（temp_sessions）を経由する。`trouble_log`→`local_llm`、`transcribe`→`ffmpeg`＋`assets` など。共有するには「パスを引数で渡す」改修が先に要る。
- **`cfg!(dev)`**（ffmpeg.rs:1374）は tauri-build がアプリ crate にだけ出す。共有 crate に移すと開発時の `FFMPEG_PATH` が効かなくなり、clippy の `-D warnings` で落ちる。
- **ソース本文を読む検査が多数**（`include_str!("ffmpeg.rs")` 8か所、TS 側の tauriCommandGuard・noWindowSpawnGuard 等）＝移したコードは検査の目から外れて緑のまま素通りする。
- Cargo のワークスペース化で Cargo.lock と target がルートへ移る → releaseVersionGuard・CI の rust-cache・cargo audit・配布スクリプトが壊れる。
- Rust 側にプロキシ（重い素材の代理）を作る仕組みは無い（γ0.8 で新規）。

### 画面側（src）

| 部品 | 分類 |
|---|---|
| icons・NumberField・HelpTip・NoticeZone・ContextMenu・欄の配置メニュー | S |
| hooks：keyboardShortcut・escapeOwners・useFocusTrap・useKeepInViewport・usePointerDrag・useCanvasDrag・spaceFocus・音の試聴系 | S |
| opener・troubleLogFs・fileDropEvents・appFullscreen・appInfo・userFacingError | S |
| 純粋：history・reorder・search・schemaVersionCompare・color・opacity・previewZoom・autoScroll・SRT/VTT・fontSubset・fontAdvance・concurrency | S |
| DeleteConfirm・PickerList・ShortcutList・UndoRedoButtons・CollapsibleSection・PanelLayoutView・ColorPicker・useAppearance（ダークモード）・useDraftHistory・useDragReorder・dialog・appSettings・userFontFs・字幅の実測（fontMetrics・textWrap） | S'（文言の直書き・α の store や一覧への依存を外す） |
| 場面・テンプレ・声・ブランド・パック・タイムラインの store に依存するもの全部 | A |

主な障害：
- 文言の置き場 `app/uiLabels.ts`（2,419 行）が α の domain 型を大量に import している＝丸ごと共有できない。部品側も「uiLabels 依存」と「直書き」が混在。
- `isTauri()` が 17 か所以上に写されていて正が無い。
- `theme.css`（2,194 行）にトークンと α 専用クラスが混在（トークン・ダーク版・`.dense`・汎用部品は共有できる）。
- import が全部相対パス・パスの別名なし。

### ビルド・CI・資料

- CI：`ci.yml`／`test-ci.yml`／`security-ci.yml` が `src-tauri` 決め打ち。`claude-code-review.yml:75` は α の正典で全 PR をレビューする。
- vitest・eslint は既定でリポジトリ全体を拾う＝`apps/` に γ を置くと α の設定で γ のテストが走る（除外が要る）。
- 門番テスト：`src` を丸ごと歩き件数を実数で固定（screenTermScan 2942・styleClassGuard 253・tauriCommandGuard 111 など）。**γ を `src/` の中に置くと誤検出**（特に layerTypeLiteralGuard の `'text'`／`'shape'`、uiTerms の「キーフレーム」「レイヤー」等の禁止語）。**外に置けば誤検出は無いが守りも効かない**。
- 同梱物：`bundle.resources` に5つ（VOICEVOX・ffmpeg・local_llm・transcribe・tutorials）。γ は ffmpeg と transcribe の2つだけ参照すれば決定1 と一致する。
- 正典・スキル・レビュア：ルートの `CLAUDE.md` は毎セッション全文が読まれ、§2（AI は動画を作らない・テンプレ駆動・技術用語禁止）・§5（`part_NNN` の採番）・§10・§11 が γ の方針と食い違う。**γ の作業中にこれを当てはめると誤った押し返しが起きる**。`CLAUDE.md` の文字数は上限 16,000 に対して残り約 25 字。
- 同時に dev 起動するとポート 1420 が衝突する。

## 3. 置き方の3案

| 案 | 中身 | 評価 |
|---|---|---|
| **A（推奨）** | **α は1ファイルも動かさず**、`apps/stario-mv/` に γ を独立して新設（独自の package.json・lock・vite・tsconfig・src-tauri・Cargo.lock・tauri.conf.json・identifier）。ルートは除外の設定だけ（vitest・eslint・.gitignore）。CI は `mv-ci.yml` を新設 | α の門番・スクリプト・CI・正典を書き換えない。共有は当面「参照」か「小さな写し」になる |
| B | ルートを npm／Cargo のワークスペース親にし、α はルートに残す | 共有は最初から正しくできるが、Cargo.lock と target がルートへ移り α の配布手順・門番・CI が壊れる |
| C | 最初から α を `apps/stario/` へ移す（完全なモノレポ） | 最終形はきれいだが、門番・資料・スキルのリンクが数十か所赤くなる。α を大きく変える |

## 4. 推奨する進め方（案A）

1. **同梱物とフォントは参照で共有**：γ の `tauri.conf.json` の `bundle.resources` で `src-tauri/resources/ffmpeg`・`transcribe` を指す（ファイルは動かさない）。`public/fonts` も同様。
2. **小さく安定した部品は γ 側へ写す**（proc・disk・isTauri・hooks・純粋関数など。数百行規模）。写した元を記録して、どれが写しかを追えるようにする。
3. **FFmpeg まわりは γ 側で新しく書く**（α を手本にする）。γ の書き出しは GPU で描いたコマを受けて透過付きの形式でも書き出す＝α の「場面を焼いてつなぐ」とは別物。汎用の約 1,500 行も、パスを引数にする改修なしには切り出せない。
4. **本格的な切り出し（`crates/stario-media`・`packages/ui` 等）は後で**：写しが膨らんで二重管理の害が出てから、または α を大きく触る機会（一般配布の前の整理など）に、ADR を1本立てて1つの PR でまとめて行う。
5. **γ の規約と資料は別に置く**：`apps/stario-mv/` 直下の CLAUDE.md（Claude Code は下の階層の CLAUDE.md を追加で読む）・`docs/stario_mv_docs/`（schemas・adr・guides）。ルートの `CLAUDE.md` 冒頭に「`apps/stario-mv/**` では γ の規約が優先し、§2・§4・§5・§10・§11 は当てはめない」旨を1〜2行（文字数の上限の扱いを決める必要がある）。
6. **γ の門番は γ 用に作る**（α の門番の走査範囲は変えない）。

## 出典

- Rust 側・画面側・ビルド側の3調査（本セッションの読み取り調査。各指摘に file:line あり）。
