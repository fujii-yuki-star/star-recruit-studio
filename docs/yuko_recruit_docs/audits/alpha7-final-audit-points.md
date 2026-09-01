# α-7 最終監査 観点ファイル：配布品質（#958 の完了条件）

- **用途**: `/final-audit` の入力。司令塔が**観点別の節だけを切り出して**各レビュアに渡す
- **更新規則**: 実装の進行に合わせて増減させ、**監査の直前に最新化してから凍結**する
- **凡例（確かめ方）**: **[静]**＝コードの静的読解（レビュアが行う）／**[プ]**＝プレビュー駆動（司令塔）／**[実]**＝実機（利用者）
- **最終更新**: 2026-09-02（#968 が land した時点）
- **関連**: #958（ロードマップ）／#396・#354・#263・#353・#355

> ⚠️ **α-6 までの観点は対象外**。ここで見るのは **α-7 で入った差分**だけ。
> ⚠️ **この期は「安定化」なので、新機能より「壊していないか」を重く見る**。

## スコープ（α-7 で land したもの）

| 区分 | Issue | 主な入り口 |
|---|---|---|
| 記録 | #396 うまくいかないときの記録 | 設定のいちばん下・`console` の包み込み・Rust の `tlog!` |
| 文言 | #354／#962 表と実装のずれ・次の行動・退役 | `15 §6` の表・`errorStateTable`・`guidanceLabels` |
| 操作 | #354 削除の確認のキーボード | `DeleteConfirm`・`escapeOwners` |
| 保存 | #263 段階1 原子的な書き込み・控え・復旧 | `save_project`・`project.prev.json`・ホームの復旧導線 |
| 復元 | #263 段階2 復元ポイント | `restorePoints`（規則）・`restorePointKeeper`・`restoreVoices`・ホームの一覧 |
| 見た目 | #959 差し込み口の必須項目・保存の門 | `layerOps`・`parseTemplatePack`・`saveUserTemplate` |
| 配布 | #355 版と権利表記の門番・はじめかた | `releaseVersionGuard`・`aboutCredits`・`はじめかた.md` |

---

## canon-schema-reviewer（正典・schema）

- [ ] **schema を変えていないこと**の確認＝α-7 は**版を上げていない**（`project` 1.29／`timeline` 1.10 のまま）。
      復元ポイントも `project.json` の**外**（`restore/` の別ファイル）に置いたので版に触れない。
      ⚠️ **触れていないつもりで触っている**箇所が無いか（`Scene` への新フィールド＝ADR-0032 の凍結3に当たる）
- [ ] **文言の置き場が §4 を守っているか**＝`TRANSFORM_WARNING` は domain、`exportFailedMessage` は uiLabels。
      **domain が `app` を参照していない**こと
- [ ] **`15 §6` の表と実装の対応**＝新しい行（`USER_TEMPLATE_SAVE_INVALID`／`PROJECT_BACKUP_AVAILABLE`／
      `PROJECT_RESTORE_FAILED`／`RESTORE_POINTS_*`／`RESTORE_VOICES_CLEARED`）が、
      **等値か文言の実在のどちらか**で見られているか（除外は理由つきか）
- [ ] **退役の扱い**＝`NARRATION_EMPTY` を `~~コード~~` にした形が、既存の退役（`TIMELINE_OVERLAY_RETIRED` 等）と揃っているか

## correctness-reviewer（不変条件・データフロー）

- [ ] **控えを壊さない**＝`back_up_previous` は「読める版だけ控える」。
      ⚠️ ここが破れると**唯一の良い版が消える**。他に控えを上書き・削除する経路が無いか
- [ ] **戻したあとの整合**＝`clearStaleVoices` は「文・話者・速さ・高さ・抑揚＋継承元」で比べる。
      ⚠️ **音のファイルは戻らない**という前提から漏れる経路（BGM・素材・作成済みの声の使い回し）が無いか
- [ ] **保存の門**＝`saveUserTemplate` が `parseTemplatePack` を通す。
      複製・ゼロから作成・取り込みパックが**すべて**そこを通るか
- [ ] **取り込み時の自動補正**（`withRequiredLayerFields`）が、**いま読み込めている文書に触れない**こと
      （必須欠け＝schema 不適合＝これまで却下されていた、という構造が保たれているか）
- [ ] **復元ポイントの規則が1か所**＝`shouldTakeRestorePoint`／`restorePointsToDrop` を通らない経路が無いか
      （戻すときの「戻す前の状態」も含む）

## error-state-reviewer（エラー・状態）

- [ ] **新しい断りが到達可能か**＝`USER_TEMPLATE_SAVE_INVALID`・`RESTORE_*` は実際に出る経路があるか
      （構造的に一度も出ない断りを作っていないか＝α-6 で `USER_FONT_MISSING` がそうなっていた）
- [ ] **黙って別の結果にしない**＝復旧・復元は**利用者が選んだときだけ**動くか。
      自動で控えへ倒れる経路が無いか
- [ ] **行き止まりが無いか**＝戻せなかった・控えが取れなかったときに、次の行動が出るか
- [ ] **記録の失敗が呼び出し側を止めない**（`troubleLogBridge`／`tlog!`）

## tests-reviewer（テスト）

- [ ] **新しい門番が空振りしていないか**＝`errorStateTable`／`guidanceLabels`／`releaseVersionGuard`／
      `aboutCredits`／`jsdocAttachGuard`（Rust 拡張ぶん）。
      ⚠️ **この期に「作った門番が効いていなかった」が3回あった**（括弧だけのセル・`Math.min` の頭打ち・
      補助関数を直接見るテスト）＝同じ形が残っていないか
- [ ] **変異チェックの記録**が PR にあるか（新規テスト）
- [ ] **純粋関数の網羅**＝`restorePoints`／`restoreVoices`／`requiredFieldsForLayerType`

## ui-terms-reviewer（文言）

- [ ] **§2-3**＝新しい文言に実装用語が無いか（「復元ポイント」は画面に出していないか＝「前の状態」）
- [ ] **§2-5**＝次の行動があるか。とくに件数が入る文（`voicesClearedMessage`）
- [ ] **`はじめかた.md` が実在する名前を指しているか**（機械で確認済み・再確認）

## resilience-reviewer（履歴・保存・並行）

- [ ] **保存の経路に足した処理**（`keepRestorePoints`）が、保存を遅くしていないか・並行で壊れないか
- [ ] **`console` の包み込み**が、テストや HMR で二重にならないか
- [ ] **復元ポイントの容量**＝上限が効いているか。消し忘れる経路が無いか

## parity-reviewer（preview＝export）

- [ ] **この期の変更が描画に触れていないこと**の確認＝#959 の `slotType` 補正は
      「読み手はいずれも `image`/`video` だけを特別扱い」という前提に依存している。**その前提が保たれているか**

## ux-model-reviewer（操作モデル）

- [ ] **確認の Escape**＝業界の型（Escape＝やめる）に沿ったか。`escapeOwners` の流儀と揃っているか
- [ ] **復元の導線**＝ホームに置いた判断。編集中から戻したくなる動線が塞がっていないか

---

## 実機（利用者）

- [ ] **[実]** 復元ポイントが実際に増えていくか（5分に1つ・直近12個）
- [ ] **[実]** 戻したあと、声の作り直しの案内が出るか
- [ ] **[実]** 記録のファイルが、失敗したときに実際に役立つ中身か
- [ ] **[実]** MSI のクリーン環境インストール・Windows N（#355）
