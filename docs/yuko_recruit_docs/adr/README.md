# ADR（アーキテクチャ決定記録）

重要な設計判断は、コードを書く前にここへ記録する（`CLAUDE.md §8`）。
「なぜその選択をしたか」を残すことで、AIエージェント・人間の双方が後から判断を覆さずに済む／覆すときも前提を理解できる。

## 一覧

| ID | タイトル | 状態 |
|---|---|---|
| [0001](0001-rendering-parity.md) | プレビューと本番出力の一致方式（描画アーキテクチャ） | **Accepted**／一部 Superseded（0019・場面内静止のみ） |
| [0002](0002-ffmpeg-codec.md) | FFmpegビルドとH.264コーデック方針（OpenH264） | **Accepted** |
| [0003](0003-narration-voice.md) | ナレーション音声とゆうこの関係（ずんだもん＝ナレーター） | **Accepted** |
| [0004](0004-rasterization-method.md) | 本番ラスタライズ手段の単一化（WebView CanvasでSVG→PNG） | **Accepted** |
| [0005](0005-voicevox-bundling.md) | VOICEVOX エンジンの同梱と自動起動 | **Accepted** |
| [0006](0006-video-slot-compositing.md) | 動画スロットの合成（動画ありシーンの書き出し） | **Accepted** |
| [0007](0007-detailed-edit-mode.md) | 詳細編集モードと FREE テンプレート（場面の作り込み） | **Accepted** |
| [0008](0008-free-layout-editor.md) | FREE テンプレートの自由配置（scene.freeLayout）と配置エディタ | **Accepted** |
| [0009](0009-scene-transitions.md) | 場面間トランジション（フェード／スライド） | **Accepted** |
| [0010](0010-real-ai-provider.md) | 実 AI プロバイダ（Gemini／OpenAI）と APIキー・外部送信 | **Accepted** |
| [0011](0011-video-kinds-and-stario.md) | 動画の用途拡張（採用／一般・社内発表の2系統）と製品名 stario | **Accepted** |
| [0012](0012-aspect-ratio-and-portrait.md) | 画面比率の拡張と縦型動画（9:16・1080×1920）対応 | **Accepted** |
| [0013](0013-h264-via-media-foundation.md) | H.264 書き出しを Media Foundation（h264_mf）主経路に | **Accepted** |
| [0014](0014-component-test-foundation.md) | コンポーネント/対話テスト基盤（Vitest + Testing Library + jsdom） | **Accepted** |
| [0015](0015-dialogue-timeline-model.md) | 掛け合い＝場面のセリフ列（ミニタイムライン）モデル | **Accepted** |
| [0016](0016-detailed-editing-completion-roadmap.md) | 詳細編集の完全化（ロードマップ／アンブレラ・α-3〜） | **Proposed** |
| [0017](0017-template-authoring-editor.md) | テンプレ作成・編集エディタ（ユーザーテンプレート） | **Accepted** |
| [0018](0018-cross-scene-timeline-model.md) | 場面横断タイムライン／複数トラックのモデル（③・2モデル方式・α-4 実装中） | **Accepted** |
| [0019](0019-keyframe-animation-model.md) | キーフレーム／場面内アニメ（④・per-frame・FREE要素＋グループ・実装時に ADR-0001 を部分 supersede） | **Accepted** |
| [0020](0020-undo-redo-model.md) | 取り消し/やり直し（Undo/Redo）モデル | **Accepted** |
| [0021](0021-template-owned-assets.md) | テンプレ既定素材（template-owned default assets・場面素材優先のフォールバック） | **Accepted** |
| [0022](0022-element-grouping.md) | 要素のグループ化（groups＋独自transform・FREE/テンプレ両エディタ） | **Accepted** |
| [0023](0023-integrated-timeline-editing.md) | 統合タイムライン編集（再生ヘッド＋同期プレビュー・上位仕上げ編集面・α-5 主軸） | **Proposed** |
| [0024](0024-non-destructive-editing-model.md) | 非破壊編集モデル（Asset＝源泉／使用単位＝非破壊の範囲参照・解析キャッシュ・VoiceClip 方向） | **Proposed** |
| [0025](0025-credit-display-modes.md) | クレジット表示方式（常時/最初/最後/両方/非表示・既定=最初と最後・About 必須維持・α-6） | **Accepted**（0003 を一部 supersede） |
| [0026](0026-alpha4-behavior-consistency.md) | α-4 挙動一致の原則（設定どおり・経路間統一・プレビュー=書き出し。間×遷移=切替尺優先／複数動画スロット／動画実再生／collapse撤去／分割失敗の表面化／動画×アニメ解除） | **Accepted**（0006 の2枚固定を一部改め・0019 の動画スロット除外を解除方向） |
| [0027](0027-video-slot-start-timing.md) | 動画スロット本体アニメの再生開始タイミング（同時／途中／アニメ後・`scene.slotVideoStart` モード明示・schema 1.18・#442 後続） | **Accepted**（実装は段階） |
| [0028](0028-per-use-clip-and-undo.md) | 動画クリップ調整を per-use 上書き（`scene.slotClips`）にして Undo 可能に（ADR-0024 決定1 の確定・#472） | **Accepted** |
| [0029](0029-free-subtitle-multi-and-binding.md) | FREE 字幕要素＝複数配置＋対象（読み上げ／話者）への紐づけ（#518 再スコープ・単一制約は固めない） | **Proposed** |

## 状態の意味

- **Proposed**: 提案・検討中（未確定）。
- **Accepted**: 承認・有効。実装はこれに従う。
- **Superseded by ADR-XXXX**: 後続ADRに置き換えられた。
- **Deprecated**: 廃止。

新規ADRは [`0000-template.md`](0000-template.md) を複製して作成する。
