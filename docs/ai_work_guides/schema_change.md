# 保存する形（schema）を変える

`docs/yuko_recruit_docs/schemas/*.schema.json` と、それを読む `domain/**/persistence` を変える作業。

## 必読

| 資料 | 範囲 | なぜ |
|---|---|---|
| [`11_SCHEMA_REFERENCE.md`](../yuko_recruit_docs/11_SCHEMA_REFERENCE.md) | **§1 スキーマ一覧とバージョニング**（12,975字） | 版の上げ方・移行・**共有 `$defs` を変えたら参照する全形式を同時にバンプ** |
| 同上 | **11 §2 共通規約**（4,216字） | 追加の作法・`additionalProperties` |
| 同上 | **11 §3 enum カタログ**・**11 §4 定数カタログ**（計 5,877字） | ⚠️ 直書き禁止の出どころ（`CLAUDE.md §2-7`） |
| 同上 | **11 §8 検証ルール**（5,182字） | V1〜V30。足すなら番号を続ける |
| 触る `schemas/*.schema.json` | 全文 | 実体が正典 |

フィールド表（`11 §7`）は**触るエンティティの小節だけ**：`11 §7.1 Project` 7,054／`11 §7.2 Asset` 697／`11 §7.4 Scene` 6,039／`11 §7.6 TimelineProject` **71,784**。

## 必要なら読む

| 条件 | 読むもの |
|---|---|
| `Scene` に足す | **止まって確認**＝場面形式は凍結（ADR-0032 の線引き＝`Scene` への新フィールドは凍結側） |
| AI 出力（`ai-video-plan`）を触る | [`ai_transform.md`](ai_transform.md) |
| 版を上げる | `src/domain/project/persistence.ts` の `PROJECT_SCHEMA_VERSION` / `src/domain/timeline/types.ts` の `TIMELINE_SCHEMA_VERSION`。**`scripts/validate-schemas`** の must-accept / must-reject に例を足す |
| 既に作った動画の挙動が変わる | `CLAUDE.md §2-5`＝**読み込んだ前の版には旧挙動を書き込む**（版で絞る） |

## 読まない

- `03_DATA_SCHEMA.md`・`07_AI_SPEC.md` の JSON（**例示**であって正典ではない・`CLAUDE.md §0`）
- `06_UI_SPEC.md`（画面を触らないなら）

## よく踏むところ

- **共有 `$defs` を片方だけバンプする**＝`VideoSettings` / `FontId` などは project と timeline の両方が `$ref` している。**同時に上げる**（過去に1回漏れた＝ADR-0038）
- **`schemaVersion` を上げずに保存できる形を足す**＝保存はできるが検証で落ちる／古いアプリで開けない
- **描画に繋がないまま save-able な形だけマージする**（PR #521 レビュー P1）＝機能 PR で一括バンプする
- **移行を書かずに破壊的変更をする**（`11 §1`）

## 終わったら

`npm run validate:schemas`（`check:frontend` に含まれる）→ **`11` の該当節を同じ PR で直す** → `/canon-check`。
