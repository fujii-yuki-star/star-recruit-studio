# すたりおMV（γ）の資料

⚠️ **ここは γ（姉妹ソフト すたりおMV・#1337）の資料の置き場です。α（すたりお）の正典ではありません。**
α の規約（ルートの `CLAUDE.md` §2・§4・§5・§10・§11）は、ここと `apps/stario-mv/**` には当てはめません（ADR-0075 決定4）。

## いまあるもの

- 設計の大枠：[`ADR-0074`](../yuko_recruit_docs/adr/0074-stario-mv-gamma-design.md)（α 側に置いている＝α と γ の両方にかかる決定のため）
- 同居の境界：[`ADR-0075`](../yuko_recruit_docs/adr/0075-gamma-repo-boundary.md)（同上）
- コードと γ の規約：[`apps/stario-mv/`](../../apps/stario-mv/CLAUDE.md)（骨組み・2026-11-26）

- プロジェクトの形：[`adr/MV-0001`](adr/MV-0001-project-schema.md)・正典 [`schemas/mv-project.schema.json`](schemas/mv-project.schema.json)
- 描画の核の約束：[`adr/MV-0003`](adr/MV-0003-render-core.md)（時刻の値・座標の原点・合成・文字）
- 画面なしの書き出し：[`adr/MV-0004`](adr/MV-0004-headless-export.md)（MP4・H.264・音・守ること）
- 外部 AI の操作口：[`adr/MV-0005`](adr/MV-0005-ai-operations.md)（MCP とコマンド・取引・許す範囲）・操作の一覧の正典 [`schemas/mv-operations.json`](schemas/mv-operations.json)
- 素材の取り込み：[`adr/MV-0006`](adr/MV-0006-asset-import.md)（コピーか参照・種類と調べること・映像〔透過付きも〕・連番・SVG の描き方・映像の音）
- 編集画面：[`adr/MV-0008`](adr/MV-0008-edit-screen.md)（画面の変更も取引を通す・AI と同時に触るときは当て直す・タイムラインの操作・値の欄とキーフレームを打つ・プレビューで掴む・素材の一覧）
- γ0.2（動き）の段階と親子付け・ヌル：[`adr/MV-0010`](adr/MV-0010-gamma02-motion-plan.md)（描画の核から→画面・2.5D は γ0.2 の最後・グラフは値と速さ・ブラーは AE と同じ・親の変形を掛け不透明度は引き継がない・見た目を保って親を付ける）
- 入れ子のコンポジション：[`adr/MV-0011`](adr/MV-0011-precomp.md)（中を同じ描画の核で透明な地に描き作業の色空間のまま重ねる・中の時刻・中の音も鳴らす・プリコンポーズ）
- 速度変更・タイムリマップ：[`adr/MV-0012`](adr/MV-0012-time-remap.md)（そのフレームで見せる素材の秒・範囲の外は端で止める・音も沿って鳴らす〔高さも変わる〕・速度は直線のキーフレーム2つ＝欄を増やさない）
- モーションブラー：[`adr/MV-0013`](adr/MV-0013-motion-blur.md)（レイヤーとコンポジションの両方のスイッチ・シャッター角 180°／位相 −90°／サンプル 16・変形をぼかす・平均した絵に描画モードを1回・schemaVersion 0.2.0）
- レイヤー＋キーフレームの画面：[`adr/MV-0014`](adr/MV-0014-keyframe-timeline.md)（▸で値の行を開く・U・キーを選ぶ／動かす／消す・止める／イージーイーズ・J／K＝AE の型・形は変えない）
- イージングのグラフ：[`adr/MV-0015`](adr/MV-0015-graph-editor.md)（帯の場所をグラフに＝Shift+F3・値と速さ・取っ手を掴んで easeOut／easeIn を書く・キーを上下で値・形は変えない）
- 元に戻す・自動保存・復旧：[`adr/MV-0009`](adr/MV-0009-undo-history-recovery.md)（画面と AI の取引を1本の履歴に・動画のフォルダの history/ に 200 回分・AI にも undo/redo・錠は OS の錠・壊れたら履歴の最後から開く）
- プレビュー画面：[`adr/MV-0007`](adr/MV-0007-preview-screen.md)（描画の核の絵を窓へ写す・再生の時計と落としたコマ・外の変更をすぐ映す・操作のキー）
- プレビューの方式：[`adr/MV-0002`](adr/MV-0002-preview-native-window.md)（ネイティブの窓＋透明な画面を重ねる）・試作の結果 [`research/2026-11-preview-spike.md`](research/2026-11-preview-spike.md)

## これから置くもの（ADR-0075 決定3）

| 置き場 | 中身 |
|---|---|
| `schemas/` | γ のデータの正典（JSON Schema） |
| `adr/` | γ だけにかかる決定（番号は `MV-0001` から） |
| `guides/` | γ の作業の入口 |
