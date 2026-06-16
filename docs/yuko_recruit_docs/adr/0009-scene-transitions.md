# ADR-0009: 場面間トランジション（フェード／スライド）

- **状態**: Proposed（2026-06-16・未レビュー。develop マージ＝レビュー通過で Accepted へ。実装は本ADR確定後）
- **日付**: 2026-06-16
- **関連**: [`0001-rendering-parity.md`](0001-rendering-parity.md)（場面内は静止・同一描画でパリティ）/ [`0006-video-slot-compositing.md`](0006-video-slot-compositing.md)（動画合成・**未解決#3＝xfade 併用**）/ [`0002-ffmpeg-codec.md`](0002-ffmpeg-codec.md)（コーデック）/ `CLAUDE.md §10`（タイムライン/キーフレーム編集は対象外）/ `§2-4`（テンプレ駆動）/ `11 §3`（`TransitionType` enum）/ `11 §4`（`TRANSITION_DEFAULT_SEC`）/ `schemas/project.schema.json`（`scene.transition`）

---

## コンテキスト

利用者要望：**場面の切り替えにフェードイン／アウト・縦／横スライドの動き**を付けたい。動きは**場面"間"の遷移演出**に限り、**場面"内"は静止**（ADR-0001。動くのは動画スロットの中身と音声のみ）を崩さない＝タイムライン編集ではない（§10 の範囲内）。

現状の書き出しは、各場面を MP4 に焼き（still or 動画合成）→ **concat demuxer ＋ `-c copy`** で無劣化結合（`ffmpeg.rs encode_jobs`）。トランジションは境界で**2クリップを時間的に重ねる**（xfade）ため、その区間は**再エンコード**が要る＝結合段の作り替えが必要。これは ADR-0006 未解決#3（xfade 併用）に対応する。

不変条件: 場面内は静止（ADR-0001）。プレビューは場面単位（場面内 SVG）。トランジションは**書き出しの結合段の演出**。

## 検討した選択肢

- **(A) per-scene MP4 を従来どおり焼いた後、xfade フィルタグラフで順次連結する（トランジションあり時のみ再エンコード／全 none 時は従来 concat copy を維持）**【採用】: 既存のシーン単位 MP4 生成（still/動画合成）を流用でき、変更は「結合段」に閉じる。失敗時の切り分けも段階的。
- (B) 全場面を1つの巨大フィルタグラフで一括生成 — 入力多数・複雑・メモリ負荷大、部分失敗の切り分けが困難。不採用。
- (C) WebView（クライアント）側で遷移フレームを合成 — §10／ADR-0001（描画は SVG→PNG→FFmpeg）と矛盾し重い。不採用。

## 決定

> **(A) を採用。** 場面境界 A→B の遷移は **B 側の `transition.in`** が司る（B がどう入ってくるか）。MVP の遷移種別＝**none / fade / slide（方向 left/right/up/down）**。遷移時間 D＝`transition.durationSec`（既定 `TRANSITION_DEFAULT_SEC`=0.5・clamp）。xfade は隣接2クリップを D 秒重ねる＝**総尺 = Σ(durationSec) − Σ(D)**。

### データ（`scene.transition` 拡張）

- 既存: `transition: { in?: TransitionType, out?: TransitionType, durationSec?: number }`（`TransitionType` = none/fade/slide/wipe/zoom）。
- 追加: **`direction?: 'left' | 'right' | 'up' | 'down'`**（`type='slide'` のときのみ有効）。`TransitionType` enum は**維持**（wipe/zoom は MVP 対象外＝指定されても fade にフォールバック）。schema/enum へ後方互換追加（マイナー）。
- 境界 A→B の演出 = **B.transition.in（＋ direction）**。
  - **先頭場面の扱い**: 先頭場面は「切り替え元が無い」ため、SceneEdit では遷移設定を**出さない**（先頭であることが分かるよう「最初の場面です」等のヒントのみ）。データ上 `transition.in` が入っていても先頭は書き出しで無視（黒からのフェードイン等は将来）。
  - **`direction` は MVP では単一フィールド＝`in` に適用**。`transition.out` は当面 `in` とミラー（SceneEdit が in/out 同値で設定）で末尾 exit 演出用に予約（未解決#1）。将来 out を独立演出にする場合は、in 方向と out 方向が異なり得る（例「左から入って右へ出る」）ため `inDirection`/`outDirection` への分離を検討する。
- 解決は domain の純粋関数（`resolveTransition(prev, next)` 相当）で、enum 検証・wipe/zoom フォールバック・D の clamp（`0 ≤ D < min(隣接場面尺)`）を行う＝§7 テスト必須。

### FFmpeg（書き出し）

- **全場面が none** → 従来の **concat `-c copy`**（高速・無劣化）を維持（回帰なし）。
- **1つでも遷移あり** → **xfade パイプライン**：per-scene MP4 を順に xfade で連結。
  - 映像: `xfade=transition=fade|slideleft|slideright|slideup|slidedown:duration=D:offset=O`。`O` = それまでの**実効累積尺**（Σ前場面尺 − Σ既適用 D）。
  - 音声: `acrossfade=d=D`。per-scene MP4 は既に**「映像＋AAC音声」で統一**済み（`ffmpeg.rs`＝無音場面も AAC 無音トラックを持つ。concat copy 成立の前提）なので、両入力とも有効な音声があり acrossfade は成立する（無音の `apad` は per-scene 生成側で担保済み＝filtergraph 側の特別扱い不要）。
  - 再エンコード（OpenH264／libx264・ADR-0002）。`-c copy` は使えない。
- **offset／実効尺の算定は domain の純粋関数**（テスト）。Rust は filtergraph 文字列の生成＋実行（`xfade_args` 純粋関数＋cargo test）。

### プレビュー / UX

- **プレビューは場面単位のまま**（場面内静止＝ADR-0001）。トランジションは**書き出しでのみ反映**（動画スロット合成と同方針）。
- SceneEdit「画面の切り替え」を **none／フェード／スライド（左右）／スライド（上下）** 等へ拡張し、slide 時に方向を選ばせる（文言は §2-3 技術用語なし・例「スライド（左へ）」）。
- 「プレビューでは確認できません。書き出すと切り替わります」案内。通し再生プレビューは将来課題（未解決#5）。

### 段階分割（producer/consumer を各段で成立）

- **T1**: データ（`direction` 追加）＋**正典更新**（`11 §3.4` の `transition(MVP)` 表記で slide を「将来」→MVP へ昇格・`schemas/project.schema.json` の `transition` に `direction` を後方互換追加）＋ 純粋ロジック（`resolveTransition`・実効尺/offset 計算・D clamp・wipe/zoom フォールバック）＋ SceneEdit UI（種別＋方向・先頭場面は遷移UIを出さない）。テスト必須。**書き出しは未接続（concat copy のまま）**。
  - **dead-UI 防止**: T1 と T2 は**同一マイルストーン内で連続して完了**させる。やむを得ず T1 を単独でリリースする場合は、SceneEdit の遷移設定に「**近日対応予定・現在は書き出しに反映されません**」案内を必ず表示する（プレビュー未反映を説明する「書き出すと切り替わります」とは別物）。
- **T2**: 書き出し＝xfade パイプライン（Rust filtergraph・audio acrossfade・全 none 時 fallback copy）。`xfade_args` 純粋関数＋cargo test、`tauri dev` で実 MP4 E2E。
- **T3**: 仕上げ（プレビュー案内の磨き込み・極短場面/先頭末尾の扱い・BGM との整合確認）。
- schemaVersion は後方互換追加＝マイナー（1.x）。

## 結果・影響

- 全 none のプロジェクト・既存書き出しは**原則無改修**（concat copy 維持＝回帰なし・高速・無劣化）。
- トランジションあり時のみ再エンコード（時間増・品質は ADR-0002 コーデックで一定）。
- `domain` にトランジション解決＋尺/offset 計算（純粋・テスト）。`renderer/export` と Rust に xfade 結合を追加。
- **ADR-0001 §MVPの前提**の「シーン間トランジションは none/fade のみ」は本 ADR の採用で **slide を追加**（ADR-0001 側も追記済み）。場面"内"が静止である不変条件は変わらない。
- **AI は slide を選ばない（決定）**: 遷移の slide/direction は**利用者の手動設定専用**（FREE と同方針）。`ai-video-plan.schema.json` の transition は従来どおり（`direction` 追加なし）、`12 §8.5` の既定（in/out=fade）も維持。AI は none/fade を既定で出し、利用者が後から slide/方向を設定する。
- **BGM 総尺（未解決#6 の解決方針）**: BGM は xfade 結合**後**の最終 MP4 に amix する（ADR-0006 同様）。基準を **xfade 後の実効総尺（Σ尺−ΣD）**とし、`bgmSettings.fadeOutSec` もこの実効総尺を基点に計算する＝これで基本は解決する見込み（タイミングは T2 で実測確認）。

## 未解決の論点

1. **`transition.out` の役割**: 末尾 exit 演出／in と out の二重指定の解釈。MVP は in 主導・out ミラー。
2. **wipe / zoom**: enum にはあるが MVP 対象外（fade フォールバック）。将来サポートするか。
3. **音声クロスフェードの既定**: `acrossfade` か単純カットか。MVP は acrossfade。
4. **極短場面（D ≥ 場面尺）**: D の clamp と利用者への警告（§2-5「次の行動」）。
5. **通し再生プレビュー**: 書き出し前に遷移を確認できる簡易再生。別課題。
6. **BGM との整合（解決方針あり・T2 で実測確認）**: BGM は xfade 後の実効総尺（Σ尺−ΣD）に amix し、`fadeOutSec` も実効総尺基点で計算する（「結果・影響」に記載）。実フェード timing は T2 で実測確認。
