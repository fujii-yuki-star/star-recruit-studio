# 16. 用語集（Ubiquitous Language）

> 本書は用語の一本化が目的。**コード識別子は英語、画面表示は日本語**（`CLAUDE.md §6`）。
> **enum値の正典は [`11_SCHEMA_REFERENCE.md §3`](11_SCHEMA_REFERENCE.md)**。本書は索引＋平易な定義であり、値の網羅・制約は重複させず正典を参照する。

---

## 1. ユーザー向け用語 ⇄ 内部用語（正典）

通常UIでは左列の「画面表示」を使い、右列の「内部用語」は出さない（`CLAUDE.md §2-3`）。`01 §2.2`・`06 §3` を統合・正典化したもの。

| 画面表示（ユーザー向け） | 内部用語 | 補足 |
|---|---|---|
| 見た目パターン | template / テンプレート | レイアウト定義 |
| 素材 | asset / アセット | 画像・動画・BGM・ゆうこ・装飾等 |
| 場面 | scene / シーン | 動画の最小単位 |
| パート | part / パート | 場面のまとまり（章） |
| 表示場所 | slot / スロット | 素材を流し込む領域 |
| 動画を書き出す / 保存する | render / export / レンダリング | MP4生成 |
| 仕上がり確認 | preview / プレビュー | — |
| 内容チェック | validation / バリデーション | 検証 |
| 画面切り替え | transition / トランジション | fade等 |
| セリフ / ゆうこの声 | narration / ナレーション | 文＝セリフ、音声＝声 |
| 使用するAI | provider / プロバイダ | 外部AIの抽象化 |
| ゆうこ | character / キャラクター | 画面マスコット |
| 動画の種類（採用動画 / 一般動画・社内発表） | videoKind（recruit / general） | 用途。最初に選び以降を分岐（ADR-0011・`11 §3`） |

---

## 2. ドメイン用語（エンティティ・主要フィールド）

| 用語 | 意味 | 参照 |
|---|---|---|
| Project | プロジェクト全体（`project.json`）。設定＋assets＋parts＋scenes | `11 §7.1` |
| Asset | 統一素材（image/video/bgm/voice/yuko/decor/logo/qr） | `11 §7.2` |
| Part | 章。scene をまとめる | `11 §7.3` |
| Scene | 場面。templateId・assetRefs・texts・narration 等を持つ | `11 §7.4` |
| Template | 見た目パターン。canvas＋layers | `04` / `11 §7.5` |
| Layer | テンプレ内の描画要素（background/slot/text/subtitle/character/decor/shape/logo） | `11 §3.4` |
| assetRefs | scene が素材をレイヤーに割り当てる対応表。キー＝レイヤー id（見た目の切替で一致しなくなったキーは休眠として残る） | `11 §5` |
| character / poseAssetId | ゆうこの表示設定／使用する表情素材ID | `11 §7.4` / `17` |
| narration.status | 音声生成状態（none/pending/generated/failed） | `11 §3.5` / `15` |
| audioMix | シーン単位の音量上書き（null＝project継承） | `11 §6` |
| Warning | 検証・補正の結果（code/message/severity 等） | `11` / `15 §6` |
| AiVideoPlan | AIが返す動画構成案。内部Sceneとは別物 | `12` / `ai-video-plan.schema.json` |

---

## 3. 概念・アーキテクチャ用語

| 用語 | 意味 |
|---|---|
| AI構成案（ai-video-plan） | AIが生成する動画の設計JSON。映像そのものではない（`CLAUDE.md §2-1`） |
| 構造化出力（structured output） | AIにスキーマ準拠JSONを強制する仕組み（`12 §3`） |
| 変換（mapping） | AI出力→内部Scene への規則的変換（採番・解決・clamp・初期化）（`12 §8`） |
| バインディング | assetRefs キーとテンプレ layer id を一致で結ぶ契約＝一致するキーだけが描かれる（`11 §5`） |
| 解決順序 | 声・音量を scene＞project＞定数 で解決（`11 §6`） |
| 自動補正 | AI出力の軽微な問題をソフトが補正し warnings に記録（`11 §9`） |
| パリティ | プレビューと本番出力の見た目一致（`ADR-0001`） |
| A2ハイブリッド | 静止レイヤーをWeb描画でPNG化し、FFmpegで合成する方式（`ADR-0001`） |
| 静止レイヤーPNG化 | 文字・パネル等を透過PNGに焼く処理。テキストはFFmpegで描かない |
| シーン単位レンダリング | シーンごとに一時動画を作り結合（長尺・部分再生成に強い）（`05 §6`） |
| Provider抽象化 / MockProvider | AI/音声を差し替え可能にする層。初期はMockで全フロー（`12 §2`） |
| 公開前チェック | 誤字・誇大・個人情報等の事前確認（`01 §13`） |
| golden-file | 描画の期待画像と比較するテスト（`14 §5`） |
| fixtures | スキーマ準拠の参照データ。実装ターゲット兼テスト期待値（`fixtures/`） |

---

## 4. enum・コード値（索引）

値の正典は `11 §3`。エラーコード（`Warning.code`）の語彙は `15 §6`。

| enum | 平易な意味 | 正典 |
|---|---|---|
| purpose | 動画の目的（会社紹介・新卒採用 等） | `11 §3.1` |
| sceneCategory（sceneType / category） | 場面の種類（opening / photo_intro 等）。scene と template で共有 | `11 §3.2` |
| assetType | 素材の種別 | `11 §3.3` |
| layer.type / slotType / fit / textKey | テンプレ描画の種別・収め方・文字キー | `11 §3.4` |
| transition | 画面切り替え（none/fade、将来 slide等） | `11 §3.4` |
| narration.status / renderStatus | 音声生成・書き出しの状態 | `11 §3.5` / `15` |
| formality | 敬体の度合い（casual/standard/formal） | `11 §3.5` |
| poseTag | ゆうこの表情タグ（自由文字列） | `11 §3.5` / `17` |
| severity / Warning.code | エラーの重大度・コード語彙 | `15 §5,§6` |

---

## 5. 略語・外部固有名

| 語 | 意味 |
|---|---|
| FFmpeg | 動画合成・エンコードのツール（`13 §3`） |
| VOICEVOX | 音声合成エンジン。クレジット表記必須（`13 §4`） |
| ずんだもん | 既定の声に用いる音源キャラ（`13 §5`） |
| Tauri | デスクトップアプリ基盤（`CLAUDE.md §3`） |
| ajv | JSON Schema 検証ライブラリ（`14`） |
| LGPL / GPL | ソフトウェアライセンス（`13 §3`） |
| H.264 / AAC | 既定の映像／音声コーデック（`05 §4`） |
| TTS | 音声合成（Text-To-Speech） |
| BGM | 背景音楽 |
| EXIF | 画像の回転等メタデータ（`05 §8`） |
