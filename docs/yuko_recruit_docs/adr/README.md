# ADR（アーキテクチャ決定記録）

重要な設計判断は、コードを書く前にここへ記録する（`CLAUDE.md §8`）。
「なぜその選択をしたか」を残すことで、AIエージェント・人間の双方が後から判断を覆さずに済む／覆すときも前提を理解できる。

## 一覧

| ID | タイトル | 状態 |
|---|---|---|
| [0001](0001-rendering-parity.md) | プレビューと本番出力の一致方式（描画アーキテクチャ） | **Accepted** |
| [0002](0002-ffmpeg-codec.md) | FFmpegビルドとH.264コーデック方針（OpenH264） | **Accepted** |
| [0003](0003-narration-voice.md) | ナレーション音声とゆうこの関係（ずんだもん＝ナレーター） | **Accepted** |
| [0004](0004-rasterization-method.md) | 本番ラスタライズ手段の単一化（WebView CanvasでSVG→PNG） | **Accepted** |
| [0005](0005-voicevox-bundling.md) | VOICEVOX エンジンの同梱と自動起動 | **Accepted** |
| [0006](0006-video-slot-compositing.md) | 動画スロットの合成（動画ありシーンの書き出し） | **Accepted** |

## 状態の意味

- **Proposed**: 提案・検討中（未確定）。
- **Accepted**: 承認・有効。実装はこれに従う。
- **Superseded by ADR-XXXX**: 後続ADRに置き換えられた。
- **Deprecated**: 廃止。

新規ADRは [`0000-template.md`](0000-template.md) を複製して作成する。
