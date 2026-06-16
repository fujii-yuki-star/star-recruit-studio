# 15. エラー・状態モデル

> 散在していたエラー表示・状態（音声生成／レンダリング等）を一元化する正典。`schemas/project.schema.json` の `Warning`（`code`/`message`/`field`/`severity`/`autoFixed`）の **`code` 語彙はここで定義**する。
> ユーザー向け文言の原則（原因でなく次の行動）は `01 §15.5`・`05 §17`・`06 §15` を統合。

---

## 1. 状態の一覧（永続 / 実行時）

| 状態 | 値（enum） | 永続/実行時 | 出典 |
|---|---|---|---|
| `narration.status` | none / pending / generated / failed | **永続**（Scene内） | `11 §3.5` |
| `renderStatus` | idle / running / completed / failed | 実行時（書き出しジョブ） | `11 §3.5` |
| `aiGenerationStatus` | idle / sending / generating / validating / done / failed | 実行時（AIジョブ） | 本書 |

> `aiGenerationStatus` と `renderStatus` は**ジョブの実行時状態**で、`project.json` には持たない（MVP）。`narration.status` のみシーンに永続する。

---

## 2. 状態遷移図

### 2.1 音声生成（シーン単位）

```text
none ──(セリフ確定/生成指示)──▶ pending ──(生成成功)──▶ generated
  ▲                               │
  │                               └──(失敗)──▶ failed ──(再試行)──▶ pending
  └──────────(セリフ変更で要再生成)────────── generated
```

- `generated` のシーンのセリフを変更したら `none`（または `pending`）へ戻す＝**再生成が必要**な状態にする（`01 §8.5`）。
- 失敗は該当シーンのみ。他シーンの音声は維持。

### 2.2 AI構成案生成

```text
idle ─(送信確認OK)─▶ sending ─▶ generating ─▶ validating ─▶ done
        │                                          │
        └─(キャンセル)─▶ idle                       └─(重大不適合/パース不能)─▶ failed
sending/generating ─(通信失敗)─▶ failed ─(再試行 / 手動作成 / 前回復元)─▶ …
```

- `validating` で軽微な問題は**自動補正**（`11 §9`）して `done`、重大なら `failed`（`12 §9.3`）。

### 2.3 書き出し（シーン単位 → 結合）

```text
idle ─(開始)─▶ running[ scene 1..N を順次レンダ → 結合 → 音声ミックス ] ─▶ completed
                     │
                     └─(あるsceneで失敗)─▶ failed（失敗sceneを特定）
                            └─(そのsceneだけ再実行 / 中断)
```

- シーン単位レンダ（`05 §6`）。完了済みシーンの一時成果物は保持し、**失敗シーンのみ再実行**できる。

---

## 3. 部分失敗時の挙動

| 場面 | 挙動 |
|---|---|
| 書き出し中に1シーン失敗 | 失敗シーンを特定（`05 §16`）。①そのシーンだけ再実行 ②中断 を選べる。完了分は破棄しない |
| 音声生成失敗 | 該当シーンのみ `failed` → 再試行。他は維持 |
| AI生成失敗 | 前回 `ai/latest_result.json` から復元可（`12 §9.3`） |
| 一部素材が欠損 | 該当シーンに警告。書き出しは「該当箇所を空/代替」で続行可否を提示 |

---

## 4. 排他制御（MVP）

- **書き出し（export）実行中**：プロジェクト編集をロックする（または読み取り専用スナップショットに対して実行）。
- **プレビュー再生中**：編集は可。変更は次回プレビューから反映。
- **音声生成中のシーン**：そのシーンのセリフ編集はキュー化 or 警告。
- 同一プロジェクトの**同時多重編集は想定外**（MVP）。

---

## 5. エラー分類（taxonomy）

| 軸 | 値 |
|---|---|
| `severity`（`Warning.severity`） | `info` / `warning` / `error` / `fatal`（fatalは処理停止） |
| 回復性 | `auto-fixed`（自動補正済み） / `user-action`（要操作） / `retryable`（再試行可） / `fatal` |

**表示原則**：原因でなく**次の行動**を示す。技術詳細は詳細モード／ログのみ（`01 §15.5`）。自動補正は「3件を自動調整、1件は確認が必要」のように件数＋対応内容で見せる（`01 §6.7`）。

---

## 6. エラーコード体系（`Warning.code` 語彙）

- 命名：`DOMAIN_REASON`（大文字スネーク。例 `TEMPLATE_NOT_FOUND`）。`schemas` 上は自由文字列だが、**実装は本表の語彙を使う**。
- 代表コード（増えうる。追加時は本表へ）：

| code | severity | 既定の自動対応 | ユーザー向け文言（例） | 由来 |
|---|---|---|---|---|
| `TEMPLATE_NOT_FOUND` | warning | 同category既定へ置換 | この場面の見た目パターンが見つからないため、標準を使います | `11 §9` |
| `ASSET_NOT_FOUND` | warning | null＋候補提示 | 使う写真・動画が見つかりません。選び直してください | `05 §17` |
| `ASSET_FILE_MISSING` | warning | 選び直し導線 | 素材ファイルが見つかりません | `05 §17` |
| `REQUIRED_SLOT_EMPTY` | warning | — | この場面に必要な写真・動画が未設定です | `11 §8 V6` |
| `DURATION_CLAMPED` | info | clamp | 表示時間を見やすい長さに調整しました | `11 §9` |
| `TEXT_OVERFLOW` | warning | 短縮提案 | 文字が表示範囲に収まりません。短くできます | `05 §17` |
| `POSE_FALLBACK` | info | 既定yukoへ | ゆうこの表情を標準に調整しました | `12 §8.3` |
| `NARRATION_EMPTY` | warning | 生成前に警告 | セリフが空です。入力してください | `08 §10` |
| `VOICE_ENGINE_UNAVAILABLE` | error | 設定確認導線 | ゆうこの声の準備ができていません。設定を確認してください | `05 §17` |
| `VOICE_GENERATION_FAILED` | error | 該当シーン再試行 | ゆうこの声の作成に失敗しました。もう一度お試しください | — |
| `AI_RESPONSE_INVALID` | error | 再生成/手動 | 動画案の作成に失敗しました。もう一度お試しください。手動でも始められます | `12 §9.3` |
| `EXPORT_FAILED` | error | 失敗シーン特定/リトライ | 動画の保存に失敗しました。ログを確認してください | `05 §17` |
| `FFMPEG_NOT_FOUND` | fatal | — | 動画の保存機能の準備が不足しています | `08 §10` |
| `BGM_FILE_BROKEN` | warning | BGMなしで続行を提示 | BGMを読み込めませんでした。BGMなしで続けられます | `08 §10` |
| `TOTAL_DURATION_EXCEEDED` | warning | — | 動画が長すぎます。場面を減らすか短くしてください | `11 §8 V9` |
| `TOO_MANY_SCENES` | warning | — | 場面が多すぎます。整理をおすすめします | `11 §8 V10` |
| `FREE_ELEMENT_OUT_OF_BOUNDS` | warning | — | 画面の外にはみ出した配置があります。画面内に移動できます | `ADR-0008 §8` |
| `FREE_ELEMENT_INVALID_SIZE` | warning | — | 配置した要素の大きさが正しくありません。幅と高さを設定し直してください | `ADR-0008 §8` |
| `FREE_TEXT_EMPTY` | info | — | 文字が入っていない配置があります。文字を入力してください | `ADR-0008 §8` |
| `SCHEMA_VERSION_UNSUPPORTED` | fatal | — | このファイルは対応していないバージョンで作成されています | `11 §1` |

---

## 7. ログ

- **ユーザー表示（次の行動）と技術ログを分離**。技術詳細は詳細モード／ログファイルへ。
- 書き出し失敗時はFFmpegのコマンドと標準エラーをログ保存（`05 §6,§17`）。
- AI送受信は `ai/history`（`12`）。**APIキー・秘密情報・元動画ファイルはログに残さない**（`13 §7`）。

---

## 8. リカバリUX

- **生成中でも完了したシーンから確認できる**（`06 §16`）。長尺はパート単位で確認。
- 失敗時の導線：**再試行 / 手動作成 / 前回AI結果の復元**（`12 §9.3`）。
- 自動補正の結果は `Scene.warnings[]` に蓄積し、件数＋対応内容を非技術語で提示（`01 §6.7`）。
