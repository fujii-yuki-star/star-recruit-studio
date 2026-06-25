# ADR-0014: コンポーネント/対話テスト基盤（Vitest + Testing Library + jsdom）

- **状態**: Accepted
- **日付**: 2026-06-25
- **関連**: `CLAUDE.md §3`（技術スタック・過剰にしない）/ `CLAUDE.md §7`（Definition of Done）/ [`14_TEST_STRATEGY.md`](../14_TEST_STRATEGY.md) / ADR-0008（FREE 自由配置エディタ）

## コンテキスト

これまで自動テストは**純粋ロジックのみ**（Vitest・既定の node 環境、`*.test.ts`）で、`@testing-library/react` や DOM 環境（jsdom/happy-dom）は未導入。`vite.config.ts` にも `test` 設定が無い。

一方 α-2 は **UI/対話が主役**のタスクが増えている。例：
- #174 — [`FreeLayoutOverlay.tsx`](../../../src/app/components/FreeLayoutOverlay.tsx) に右クリックの操作メニューとテキストのダブルクリック・インライン編集を追加。
- #175（見た目パーツ）・#179（詳細編集モード）も同様に対話が中心。

これらの「右クリック→メニュー」「ダブルクリック→編集」「ドラッグ→選択/移動」といった**対話を CI で自動検証できていない**。回帰を機械的に止めるため、最小のコンポーネント/対話テスト基盤を入れる。

## 判断軸

- **最小構成**（§3：過剰にしない）。導入物・依存は必要最小限。
- **既存の純粋ロジックテスト（node 前提）を壊さない**。`npm run check:frontend` が緑のまま。
- **対話再現の信頼性**。focus/blur・キーボード・contextmenu・pointer など実ブラウザに近い挙動で検証できること。
- **標準的・保守的な構成**。後続の担当者（人/AI）が迷わない、広く使われた組み合わせ。

## 検討した選択肢

### DOM 環境

| 選択肢 | 評価 |
|---|---|
| **(A) jsdom** | 互換性が高く RTL の事実上の既定。focus/blur・キーボード・contextmenu の再現が手堅い。やや重いがスイートは小さく問題にならない。→ **採用** |
| (B) happy-dom | 軽量・高速だが、イベント/フォーカス/選択の再現に歴史的な穴がありうる。速度利点は小スイートでは薄い。将来 `environment` 1 行で差し替え可能。→ 不採用 |

### テストライブラリ

| 選択肢 | 評価 |
|---|---|
| **@testing-library/react + @testing-library/jest-dom** | コンポーネント描画・ロール/テキスト探索・可読なマッチャ。RTL 標準キット。→ **採用** |
| + @testing-library/user-event | 人間に近い入力シーケンスを再現。ただし当面の対象ハンドラ（contextMenu/doubleClick/keyDown/blur/pointer）は `fireEvent` が直接対応し脆くない。→ **当面見送り**（必要時に追加） |

### 環境の適用方法

| 選択肢 | 評価 |
|---|---|
| (A) グローバルで `environment: 'jsdom'` | 既存の node テストすべてが jsdom 化。波及・低速化のリスク。→ 不採用 |
| **(B) 既定は node 維持＋`*.test.tsx` のみファイル先頭 `// @vitest-environment jsdom` で個別切替** | 既存テストへの波及ゼロ。DOM が要るファイルだけ局所的に jsdom。→ **採用** |

## 決定

既存の Vitest に **jsdom 環境を追加**し、`@testing-library/react` + `@testing-library/jest-dom` + `jsdom` を devDependencies に追加する。

- **既定 `environment` は `node`**（純粋ロジックの既存テストは従来どおり）。
- **コンポーネント/対話テストは `*.test.tsx`** とし、ファイル先頭の `// @vitest-environment jsdom` で**個別に** jsdom へ切替（既存 node テストへ影響なし）。
- 共通セットアップ `src/test/setup.ts`（`vite.config.ts` の `test.setupFiles`）で次を行う：
  - jest-dom のカスタムマッチャを登録（環境非依存・node でも無害）。
  - 各テスト後に描画ツリーを破棄（DOM リーク防止）。**node 環境では RTL/jsdom を読み込ませない**（環境ガード）。
  - jsdom が実装しない **PointerEvent の最小ポリフィル**（ドラッグ/選択などポインタ操作を検証可能にするため。実ブラウザ・既存実装には影響しない）。
- サンプルとして `FreeLayoutOverlay` の対話テストを 1 本追加（後述）。

## 結果・影響

- `package.json`：devDependencies に 3 つ追加。`vite.config.ts`：`defineConfig` を `vitest/config` 由来にし `test` ブロックを追加。`src/test/setup.ts` を新設。
- **正典（`schemas/`・`11`・`12`）への影響なし。schemaVersion 変更なし**（データ仕様に触れない純粋なテスト基盤）。
- **サンプル（`FreeLayoutOverlay.test.tsx`）は実際の対話を検証**：①ポインタによる選択/選択解除とリサイズハンドルの描画、②右クリックの操作メニュー（**全 kind で「編集/複製/前面/背面/削除」**・「編集」は `onRequestEdit`＝kind 別エディタを開く〔#185 以降〕・「複製」/「削除」で各コールバック発火・Escape で閉じる）、③テキストのインライン編集（**ダブルクリック**で textarea 出現・入力で `onChangeText`・Enter/Esc/blur で終了・Shift+Enter は継続・テキスト以外では出ない）。いずれも #172/#174/#184/#185 で develop に入っている挙動。
- `check:frontend`（lint・typecheck・test・schema 検証）は緑を維持（node テストは不変）。
- [`14_TEST_STRATEGY.md`](../14_TEST_STRATEGY.md) に「コンポーネント/対話テスト」の位置づけを追補する余地（別コミットで反映可）。

## 未解決の論点

- `@testing-library/user-event` の導入要否（複雑な入力シーケンスが増えたら検討）。
- happy-dom への切替（スイート大型化で速度が問題化した場合のみ）。
- 後続の UI（#175 見た目パーツ・#179 詳細編集モード等）への同方式の横展開。
- Tauri/WebView 実機での E2E は本 ADR の対象外（ここではコンポーネント単体の対話に限定）。
