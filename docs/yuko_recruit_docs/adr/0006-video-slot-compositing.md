# ADR-0006: 動画スロットの合成（動画ありシーンの書き出し）

- **状態**: Accepted（2026-06-13 承認・スパイク実証済み）
- **日付**: 2026-06-13
- **関連**: [`0001-rendering-parity.md`](0001-rendering-parity.md)（A2ハイブリッド・残③）/ [`0004-rasterization-method.md`](0004-rasterization-method.md) / [`0002-ffmpeg-codec.md`](0002-ffmpeg-codec.md) / `05_RENDERING_SPEC.md §6` / `11 §4,§6` / `schemas/template.schema.json`(layer.slotType) / `01 §5.4`（動画素材の設定）

---

## コンテキスト

現状の書き出し（V-C1〜C3）は **静止画(PNG)シーンのみ**で、テンプレの動画スロット（`slotType: video` / `image_or_video` に動画素材が割り当たった場合）を合成できない。本製品は「採用**動画**」が主目的で、実写の動画クリップを使えることは中核機能。

ADR-0001 は方式 **A2ハイブリッド**を採択し、動画ありシーンを「`下PNG（zIndex<動画）` → `動画スロット（FFmpegでスケール/配置）` → `上PNG（zIndex>動画）`」を `overlay` で重ねる、と方針だけ示していた（残課題③＝実機未確認）。本ADRはこれを**実装可能なレベルに具体化**し、スパイクで実証する。

前提（ADR-0001）：シーン内レイアウトは静止（動くのは動画スロットの中身と音声のみ）。テキスト等の描画はWebView（ADR-0004）が担い、FFmpegは動画・音声・尺・結合・エンコードに限定。

## 検討した選択肢

- **(A) 下PNG ＋ 動画(slotへスケール/配置) ＋ 上PNG(透過) を overlay**（ADR-0001 A2 の具体化）【採用】
- (B) 全フレームをWeb描画してフレーム列→動画（ADR-0001 選択肢C）— シーン内アニメが要る将来向け。MVPでは過剰・低速。
- (C) 動画を画面全面の背景として敷き、スロットを無視 — テンプレート駆動（座標はテンプレが決める）に反し、文字/ゆうことの重なり順も壊れる。不採用。

## 決定

> **(A) を採用する。** 動画ありシーンは、静止レイヤーを**動画スロットの zIndex を境に下/上 2枚の透過PNG**へ分け、FFmpegで `下PNG → 動画(スケール/配置) → 上PNG` を `overlay` で重ねる。音声はシーンごとに **ナレーション ＋ 元動画音声** を `amix` し、最後に **BGM** を全体へ重ねる（既存 V-C3 の最終ミックスを再利用）。

### 具体仕様

- **動画シーンの判定**: シーンのスロット層（`layer.type='slot'`）に解決された素材が `assetType='video'`。
- **下/上PNGの分割**: 静止レイヤーを `zIndex < slot.zIndex` を下PNG、`zIndex > slot.zIndex` を上PNG（透過）に分けてラスタライズ（ADR-0004＝WebView Canvas／検証はresvg）。動画なしシーンは従来どおり1枚PNG。
- **スケール/配置（fit）**: `cover`=`scale=...:force_original_aspect_ratio=increase,crop`、`contain`=`decrease`＋`pad`、`stretch`=`scale`そのまま。スロット矩形 `(x,y,w,h)` へ `overlay`。
- **クリップ尺**: `asset.clip.startSec..endSec`（`01 §5.4`）で `-ss/-t` 切り出し。クリップがシーン尺より短い場合はループ又は最終フレーム保持（実装時に確定）。
- **音声（§4/§6）**: `narration(NARRATION_VOLUME=1.0) ＋ 元動画音声(originalAudioVolume 既定 0.2、useOriginalAudio=false なら無し)` を `amix`。元音声が無いクリップは無音。BGM(0.25)は全体へ（既存 `mix_bgm_args`）。
- **責務**: FFmpegは動画スケール/配置・overlay・amix・尺・H.264/AACのみ（ADR-0001）。描画はしない。

## 結果・影響

- `ffmpeg.rs` に**動画シーン用の合成経路**を追加（既存の静止画 `scene_clip_args` と分岐）。引数生成は純粋関数＋cargo E2Eで検証可能。
- `renderer/export` のラスタライズは、動画ありシーンで**下/上2枚の透過PNG**を出す（`buildExportScenes` 拡張）。`sceneSvg` はスロット層を「動画あり時は描かない（透過）」に対応。
- 書き出し入力（`ExportSceneInput`）に動画クリップ参照・スロット矩形・clip設定・下/上PNGを追加。
- **ADR-0001 残課題③（動画ありシーンの overlay 実機確認）をスパイクで前進**（下記）。実アプリ(tauri dev)での目視確認は実装時に行う。

## 未解決の論点

1. **色空間／ガンマ**：PNG overlay と動画フレームの色差（ADR-0001 残③/④と同件）。`yuv420p` 統一で緩和、残差は実機確認。
2. **複数動画スロット**を持つテンプレへの一般化（MVPは1スロット想定）。
3. **トランジション（xfade）との併用**：動画シーン同士／静止シーンとの境界。
4. **クリップ < シーン尺**時の扱い（ループ／フリーズ）と、`>` 時のトリム挙動の確定。
5. 下/上2枚化に伴う**長尺・多シーンのメモリ／所要時間**。

## スパイク結果（2026-06-13）

`scripts/adr0006-overlay-spike.ts`（`npm run spike:overlay`、出力 `.spike/`）で A2 の動画ありシーン合成を実FFmpegで実証した。

- 下/上PNGを **resvg**（alpha保持）で生成（上は透過＝スロット領域は描かない）。
- 「素材動画」＝`testsrc2`＋元音声(sine)、ナレーション/BGMは sine で代用。
- 合成チェーン：`[below][clip(cover→slot)]overlay → [bg1][above]overlay`（映像）＋`[narr(1.0)][orig(0.2)]amix`（音声）→ さらに `BGM(0.25)` を全体へ `amix`。
- **出力**：`.spike/overlay_final.mp4` ＝ **1920×1080 / h264(High) / yuv420p / 30fps ＋ aac 44100Hz stereo / Duration 4.00s**。フィルタグラフが実FFmpegで通り、有効なMP4を生成することを確認。
- FFmpegは spike用 `libx264`（本番は ADR-0002 の `libopenh264` へ無改修差し替え）。
- **残**：overlay の**見た目（配置・色）の目視確認**は実アプリ実装時。下/上PNGの zIndex分割を `renderer/export` に実装し、`ffmpeg.rs` に overlay 経路を追加する（本ADRの実装フェーズ）。
