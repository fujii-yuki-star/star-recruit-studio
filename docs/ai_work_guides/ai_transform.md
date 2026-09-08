# AI 出力の検証・変換を変える

外部 AI が返す `ai-video-plan` を、内部の `Scene` へ落とす経路（`src/domain/ai/**`）を変える作業。

## 必読

| 資料 | 範囲 | なぜ |
|---|---|---|
| [`12_AI_PROMPT_AND_MAPPING.md`](../yuko_recruit_docs/12_AI_PROMPT_AND_MAPPING.md) | **§8 変換マッピング**・**§9 検証・補正・リカバリ**（正典・全体でも 15,881字） | 何をどう写すか／落とすかの規範 |
| [`docs/yuko_recruit_docs/schemas/ai-video-plan.schema.json`](../yuko_recruit_docs/schemas/ai-video-plan.schema.json) | 全文（90行） | AI 出力の実体 |
| [`11_SCHEMA_REFERENCE.md`](../yuko_recruit_docs/11_SCHEMA_REFERENCE.md) | **§2 ID採番**・**§9 自動補正ルール**（計 6,300字ほど） | `part_NNN`/`scene_NNN` の採番・clamp |

## 必要なら読む

| 条件 | 読むもの |
|---|---|
| プロンプトや送信内容を変える | `12 §4`〜`12 §7`＋**`CLAUDE.md §2-6`（外部送信は事前確認・元動画は送らない）** |
| Provider を足す | [`adr/0010`](../yuko_recruit_docs/adr/0010-real-ai-provider.md)＋`12 §2`・`§3` |
| 用途（採用／一般）で分ける | [`adr/0011`](../yuko_recruit_docs/adr/0011-video-kinds-and-stario.md)＋`12 §5b` |
| 出力に無い概念を足したくなった | **止まって確認**＝AI が触るのは場面形式まで（ADR-0032）。グループ・キーフレーム・タイムラインは AI 出力に無い（ADR-0007 単一パイプライン） |

## 読まない

- `07_AI_SPEC.md`（**例示**。`12` と食い違ったら `12` が正しい：`CLAUDE.md §0`）
- `06_UI_SPEC.md`・`05_RENDERING_SPEC.md`
- タイムライン関係すべて（`11 §7.6` と `06 §12`、ADR-0032 の実装詳細）

## よく踏むところ

- **検証を通さず `project.scenes` へ流す**＝`CLAUDE.md §2-2` の一発アウト。順は必ず **検証 → 自動補正 → 変換**
- **enum を勝手に増やす**（`CLAUDE.md §9-2`）＝正典に無い値は足さない。足すなら ADR
- **落としたものを黙って落とす**＝落とすなら理由を返す（`15 §6`）

## 終わったら

`CLAUDE.md §7`「必ず自動テストを書く対象」の筆頭なので、**純粋関数のテスト＋変異チェックは必須**。`12` の該当節を同じ PR で直す。
