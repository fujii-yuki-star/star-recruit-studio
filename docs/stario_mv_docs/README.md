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
- プレビューの方式：[`adr/MV-0002`](adr/MV-0002-preview-native-window.md)（ネイティブの窓＋透明な画面を重ねる）・試作の結果 [`research/2026-11-preview-spike.md`](research/2026-11-preview-spike.md)

## これから置くもの（ADR-0075 決定3）

| 置き場 | 中身 |
|---|---|
| `schemas/` | γ のデータの正典（JSON Schema） |
| `adr/` | γ だけにかかる決定（番号は `MV-0001` から） |
| `guides/` | γ の作業の入口 |
