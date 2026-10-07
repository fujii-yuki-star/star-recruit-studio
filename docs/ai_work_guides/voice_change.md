# 声を作る・音を混ぜる

VOICEVOX 連携（`src/infrastructure/voicevox*`）・読み上げ・BGM・音量まわりを変える作業。

## 必読

| 資料 | 範囲 | なぜ |
|---|---|---|
| [`11_SCHEMA_REFERENCE.md`](../yuko_recruit_docs/11_SCHEMA_REFERENCE.md) | **§6 声・音量の解決順序**（754字） | `null` = 継承の解き方 |
| [`05_RENDERING_SPEC.md`](../yuko_recruit_docs/05_RENDERING_SPEC.md) | **§13 音声合成**・**§14 音量ミックス** | 混ぜ方の規範 |
| [`adr/0003`](../yuko_recruit_docs/adr/0003-narration-voice.md) | 全文 | ずんだもん＝**ナレーター**（ゆうこ固有の声とは称さない）・クレジット |

## 必要なら読む

| 条件 | 読むもの |
|---|---|
| 掛け合い・同時2ボイス | [`adr/0015`](../yuko_recruit_docs/adr/0015-dialogue-timeline-model.md)・[`adr/0031`](../yuko_recruit_docs/adr/0031-simultaneous-dual-voice.md) |
| クレジット表示 | [`adr/0025`](../yuko_recruit_docs/adr/0025-credit-display-modes.md)（**About は必須で不変**） |
| 読み方辞書 | [`adr/0037`](../yuko_recruit_docs/adr/0037-reading-dictionary.md)（**他の VOICEVOX の辞書を壊さない**・突き合わせは言葉で） |
| ダッキング・ノーマライズ | [`adr/0032`](../yuko_recruit_docs/adr/0032-timeline-project-format.md) 追補4＋`11 §7.1.1`（設定は**プロジェクト単位**・`Scene` に足さない） |
| エンジンの同梱・起動 | [`adr/0005`](../yuko_recruit_docs/adr/0005-voicevox-bundling.md)＋`13 §4` |
| タイムライン側で声を作る | `11 §7.6.2.4`＋[`timeline_change.md`](timeline_change.md) |

## 読まない

- `06_UI_SPEC.md`（欄を触らないなら）
- `12_AI_PROMPT_AND_MAPPING.md`（読みは `ai-video-plan` に現れない）
- `11 §7.6` の描画まわり

## よく踏むところ

- **既定 1.0 で決め打つ**＝`null` は継承。解決順は `11 §6` に1つ（決め打つと BGM が4倍になる、が実際に起きた）
- **作った声を黙って捨てる／黙って古い声を使う**＝文・話者・話し方が変わったらその声は使わない（`sameSynthInput`）
- **反映できないのに成功にする**＝辞書を送れないときは断る（ADR-0037・`CLAUDE.md §2-5`）
- **声そのものを下げる**＝ダッキングの対象は BGM（自分で自分を下げない）
- **同梱エンジンを直に起こす**＝Windows で**黒い窓が開いて消える**。`src-tauri` 側は必ず `proc::no_window_command` を通す（門番＝`src/test/noWindowSpawnGuard.test.ts`・#1107）

## 終わったら

音量ミックスは `CLAUDE.md §7`「必ずテストを書く対象」。純粋関数のテスト＋変異チェック。
