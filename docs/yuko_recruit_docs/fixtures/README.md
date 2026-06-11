# fixtures — 参照サンプル一式

正規スキーマ（`../schemas/`）に準拠した**動く参照データ**。AIエージェントの**実装ターゲット**であり、将来の**golden-fileテストの期待値**でもある。

## 中身と対応関係

| ファイル | スキーマ | 役割 |
|---|---|---|
| `ai-video-plan.sample.json` | `ai-video-plan.schema.json` | **AI出力**のサンプル（MockProvider の戻り値、`12 §7` と同一） |
| `project.sample.json` | `project.schema.json` | 上記を `12 §8` の規則で**変換した内部データ**の期待値 |
| `template-pack/opening_yuko_right_v1/template.json` | `template.schema.json` | テンプレ（category=opening） |
| `template-pack/photo_left_text_right_yuko_v1/template.json` | `template.schema.json` | テンプレ（category=photo_intro） |

## 変換の確認ポイント（`ai-video-plan.sample` → `project.sample`）

- **採番**: AIのパート/シーンに `part_001/002`・`scene_001/002`、`order` を付与。
- **poseTag解決**（`11 §3.5`/`12 §8.3`）: `yukoPoseTag:"smile"` → `poseAssetId:"yuko_smile_001"`（tagsに smile）／`"guide"` → `"yuko_guide_001"`。
- **ナレーション初期化**: `narrationText` → `narration.text`、`voiceId/speed/pitch/intonation=null`（project継承）、`status:"none"`、`voicePath:null`。
- **バインディング**（`11 §5`）: `assetRefs.background/logo` はテンプレの `background`/`logo` レイヤー、`assetRefs.mainVisual` は `slot` レイヤー `mainVisual` に対応。
- **トランジション既定**: テンプレ `defaults` 由来で `in/out=fade`、`durationSec=0.5`。

## 注意

- 画像・音声の**実バイナリ（jpg/png/mp3/サムネイル）は同梱していない**（パスはプレースホルダ）。スキーマ検証・変換ロジックのテストには使えるが、**描画/出力テストには実アセットが必要**。
- テスト実装時は本ディレクトリを参照（または `test/fixtures` へコピー）して使う。
- 実APIキー等の秘密情報を絶対に置かない（`13 §7`）。

## 検証

本fixtureは `../schemas/*.schema.json` に対する **ajv（JSON Schema draft 2020-12）検証**と、相互参照の意味的チェック（assetRefs→assets、templateId→pack、poseAssetId→yuko素材、part↔scene、bgm→assets）に合格済み（2026-06-10）。

実装後はこの検証を**テストスイート／CIに組み込む**（自動テスト戦略＝Tier3-G）。参考の検証コード骨子：

```js
// ajv@8 + ajv-formats。各 *.sample/template.json を対応スキーマで validate し、
// project.sample は assetRefs/templateId/poseAssetId/part↔scene の相互参照も検査する。
```

