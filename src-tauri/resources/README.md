# 同梱リソース

## VOICEVOX ENGINE（#149 / ADR-0005）

アプリ起動時に**同梱の VOICEVOX ENGINE を自動起動**するため、配布ビルド前に **CPU 版 ENGINE** をここへ配置する。

### 配置手順
1. [VOICEVOX ENGINE releases](https://github.com/VOICEVOX/voicevox_engine/releases) から **CPU 版（Windows）の v0.25.2** をダウンロードして展開する（**同梱バージョンは 0.25.2 に固定**＝ビルド間で揃える。更新時はこの README と `13_DEPENDENCIES_AND_LICENSING.md` §9 も更新）。
   - GPU 版はサイズが大きく NVIDIA 依存のため、配布物では **CPU 版を推奨**（ナレーション合成は短く CPU で十分）。
2. 展開した一式（`run.exe` ＋ DLL・モデル・辞書）を **`src-tauri/resources/voicevox_engine/`** に置く。
   - 結果として **`src-tauri/resources/voicevox_engine/run.exe`** が存在する形にする。
3. `src-tauri/tauri.conf.json` の `bundle` に `resources` を追加して同梱を有効化する（**バイナリ配置後に**）:
   ```json
   "bundle": {
     "resources": { "resources/voicevox_engine": "voicevox_engine" }
   }
   ```
   ※ `resource_dir()/voicevox_engine/run.exe` に解決される想定。最初の packaged ビルドでパス解決を確認し、必要なら調整する。
4. `npm run tauri build` で packaged ビルドし、**VOICEVOX を別途起動せずに「声を作成」が動く**こと・**アプリ終了で ENGINE プロセスが残らない**ことを確認する。

### 動作（実装）
- 起動時、Rust 側 [`voicevox_engine.rs`](../src/voicevox_engine.rs) が `resource_dir()/voicevox_engine/run.exe` を **空きポートで起動**し、`synthesize_voice` の接続先をそのポートへ向ける。アプリ終了時に **プロセスを終了**する。
- **`run.exe` が無ければ何もしない**＝従来どおり、手動起動した ENGINE／設定画面の接続先（既定 `localhost:50021`）へ**フォールバック**する（開発時はこちら）。
- 接続先の優先順位：設定の接続先（上級者）＞ 同梱エンジン（自動起動）＞ 環境変数 `VOICEVOX_URL` ＞ 既定 `localhost:50021`。

### 注意
- ENGINE 一式は大容量のため **コミットしない**（`.gitignore` 済み）。開発者・CI の各ビルド環境で配置する。
- 規約・ライセンス根拠は ADR-0005「規約・ライセンスの根拠」（#122）。**エンドユーザー向け利用規約にキャラ規約・クレジット遵守の義務付け**が必要。
