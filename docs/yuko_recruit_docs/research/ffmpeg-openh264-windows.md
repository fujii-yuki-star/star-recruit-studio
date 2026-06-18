# 調査資料: Windows x64 LGPL FFmpeg + OpenH264（配布版コーデック対応）

> 目的: ADR-0002（FFmpeg=LGPL＋OpenH264）の配布実装に向けた事実調査。**値・URL は公式情報で確認し、未確認値は「pin 時に公式から取得」と明記（推測値は使わない）。**
> 調査日: 2026-06-18。出典は各項目に付す。**本書は法的助言ではない**（最終判断は社内/法務）。

## 0. 確定済みの方針（ユーザー決定・2026-06-18）
- OpenH264 は**アプリへ同梱しない**。
- **初回利用時に Cisco 公式配布元から取得**する。
- 開発中は現状の `ffmpeg-static`（GPL/libx264）を**スパイク専用**として継続。
- 配布版は **LGPL 構成の FFmpeg へ必ず差し替え**。
- ライセンス文・NOTICE の最終文面は**社内後続確認**。
- 具体的な FFmpeg/OpenH264 バージョンは**未確定**（本調査で候補と確定方法を提示）。

---

## 1. 確認済みの公式事実（出典付き）

- **FFmpeg 最新安定版**: **8.1.2 "Hoare"**（2026-06-17 リリース）。公式 Windows ビルド提供元として **gyan.dev** と **BtbN** をリンク。出典: ffmpeg.org/download.html。
- **gyan.dev のライセンス**: **GPL-3.0**（COPYING.GPLv3 を同梱）。→ **LGPL 要件に不適合＝配布版には使えない**。出典: gyan.dev/ffmpeg/builds。
- **BtbN/FFmpeg-Builds**: `lgpl` と `lgpl-shared`（および gpl/nonfree）変種を提供。`lgpl` は「GPL専用ライブラリ（libx264/libx265 等）を含まない」。リリースは `latest` タグ＋タイムスタンプ＋バージョン枝。出典: github.com/BtbN/FFmpeg-Builds（README）。
- **OpenH264 最新版**: **2.6.0**（2025-02-12）。**ソースは BSD-2-Clause**。出典: github.com/cisco/openh264。
- **OpenH264 バイナリ配布**: **ciscobinary.openh264.org** でプラットフォーム別に配布。Windows 64bit のファイル名は `libopenh264-<version>-win64.dll.bz2` 形式（例 `libopenh264-2.6.0-win64.dll.bz2`）。出典: cisco/openh264 Releases・OpenH264 Wikipedia。
- **特許の扱い**: Cisco は**自社が配布するプリコンパイル済バイナリ**について AVC/H.264 特許ライセンス（MPEG LA / 現 Via LA）を負担し、**利用者は無償**。ただし下記**条件付き**（§5）。出典: openh264.org/BINARY_LICENSE.txt。
- **FFmpeg からの利用方式**: FFmpeg を `--enable-libopenh264` でビルドし、Cisco の OpenH264 共有ライブラリを**実行時に動的ロード**する。OpenH264 DLL は Cisco から取得し `libopenh264.dll` として FFmpeg が読める場所に置く。出典: Crigges/Prebuilt-LGPL-2.1-FFmpeg-with-OpenH264（README・方式の実例。ただし FFmpeg 3.4 と古く採用は不可）。

---

## 2. 候補比較表（Windows x64・LGPL FFmpeg）

| 候補 | 入手元 | ライセンス | `--enable-libopenh264` | `--enable-gpl`/`nonfree` | 更新方針 | 採否 |
|---|---|---|---|---|---|---|
| **BtbN `lgpl-shared`** | github.com/BtbN/FFmpeg-Builds | LGPL 2.1+（x264/x265 不含） | **要 `-buildconf` 検証**（README に明記なし） | lgpl 変種は不含の想定（**要検証**） | `latest`／タイムスタンプ／版枝 | ◎ **第一候補**（shared＝動的リンクで LGPL 遵守が容易） |
| BtbN `lgpl`(static) | 同上 | LGPL 2.1+ | 同上 | 同上 | 同上 | △（static は LGPL の「差し替え可能性」要件と相性△） |
| **自前ビルド**（media-autobuild_suite 等で `--enable-libopenh264` 構成） | 自社ビルド | LGPL（構成を自分で固定） | 自分で有効化＝確実 | 自分で除外＝確実 | 自社で管理・再現可能 | ○ **代替/保険**（最も確実だが運用コスト） |
| gyan.dev | gyan.dev | **GPL-3.0** | （該当外） | GPL | — | ✗ **不可**（LGPL 要件に不適合） |
| Crigges Prebuilt-LGPL | github | LGPL 2.1 | あり | — | v0.1(2019)・FFmpeg 3.4 | ✗ 採用不可（古い）／**方式の参考**にはなる |

> 注: 「libopenh264 が含まれるか」は README では断定できないため、**実バイナリで `ffmpeg -buildconf`（または `-version`）を確認**するのが唯一の確実な方法（=ユーザー設問#2/#3/#4 はこの検証で満たす）。

---

## 3. 推奨案（1つ）

**FFmpeg = BtbN `lgpl-shared`（Windows x64・バージョンは配布時に 8.1.x で pin）＋ OpenH264 = Cisco 公式バイナリを初回取得。**

- 採用理由: 公式が案内する提供元で LGPL 変種があり、shared（動的リンク）は LGPL 遵守が容易。`ffmpeg-static`（GPL）からの差し替え先として最有力。
- **保険**: BtbN `lgpl` に `libopenh264` が含まれないと判明した場合は、**自前ビルド**（`--enable-libopenh264` 明示・GPL/nonfree 不使用）に切り替える。
- バージョンは **FFmpeg 8.1.x** ／ **OpenH264 2.6.0**（pin 時に最新確認）。FFmpeg ビルドが期待する OpenH264 ABI と取得する Cisco バイナリのバージョンを**一致**させる。

---

## 4. ユーザー設問（1–10）への回答

1. **入手元・バージョン**: 入手元＝BtbN（`lgpl-shared`）／代替＝自前ビルド。バージョン＝FFmpeg 8.1.x・OpenH264 2.6.0（pin 時確認）。
2. **構成検証（LGPL/libopenh264）**: 実バイナリで `ffmpeg -buildconf` を実行し `--enable-libopenh264` の存在を確認（実装: 起動時/CIで自動チェック可）。
3. **`--enable-libopenh264` の有無**: BtbN lgpl は **要検証**（README 未記載）。自前ビルドなら明示して確実。
4. **`--enable-gpl`/`nonfree` 不含**: 同じく `-buildconf` で両フラグの**不在**を確認（lgpl 変種は不含の想定だが検証必須）。
5. **対応 Cisco OpenH264 バージョン**: 2.6.0（最新）。FFmpeg ビルドの libopenh264 ABI に合わせて選定（不一致はロード失敗）。
6. **DLL 名・配置・読込**: Cisco 配布物 `libopenh264-<ver>-win64.dll.bz2` を取得→bz2 展開→`libopenh264.dll` として FFmpeg が探索する場所（実行ファイル同階層 or `PATH`/作業ディレクトリ）に配置。FFmpeg は実行時に動的ロード。
7. **自前ビルドの要否**: まず**既存配布物（BtbN lgpl-shared）**で可否を検証し、libopenh264 不含なら**自前ビルド**へ。再現可能なビルド手順（構成フラグ固定）を残す。
8. **SHA-256・署名・配布元の固定**: **Cisco/FFmpeg の公式リリースに付随する公開ハッシュを pin 時に取得して記録**（本書では推測値を載せない）。取得後はアプリに**期待ハッシュを定数化**し、ダウンロード物を検証。配布元 URL もバージョンと一緒に固定。
9. **プロキシ/オフライン時**: 初回取得失敗時は **§2-5 準拠の「次の行動」文言**（例「OpenH264 の取得に失敗しました。ネットワーク/プロキシ設定をご確認のうえ再試行してください」）。取得できるまで H.264 書き出しは無効化し、再試行導線を出す（無言失敗にしない）。社内プロキシ環境向けに**手動配置のフォールバック**（DLL を所定フォルダに置けば使う）も検討。
10. **セット更新**: FFmpeg ビルドと OpenH264 は**ABI 互換のセット**で更新する。アプリに「FFmpeg バージョン＋対応 OpenH264 バージョン＋各ハッシュ」を**1か所の定数表**で持ち、更新時は両方を同時に差し替え＋ハッシュ更新。

---

## 5. 🔴 法務で確認が必要な重大事項（OpenH264 バイナリライセンス）

`openh264.org/BINARY_LICENSE.txt` に**条件**がある。**我々の「同梱しない・初回取得」方針はこの条件を満たすために必須**：

1. **「Cisco 提供バイナリが、エンドユーザー端末へ別途ダウンロードされ、ダウンロード前に第三者ソフトへ統合・結合されていないこと」** → **同梱（統合）すると特許カバレッジを失う**。初回取得方式が必要（＝方針と一致）。
2. ユーザーが当該バイナリの利用を **有効/無効/再有効化できる**こと。
3. **「OpenH264 Video Codec provided by Cisco Systems, Inc.」の表示**（VOICEVOX とは**別の固定文言**。クレジット/ライセンス画面に追加が必要）。
4. **商用利用の範囲制限**: ライセンスは個人/消費者利用等が中心で、**「それ以外の用途には許諾されない」**旨。**AVC/H.264 を商用でコンテンツ配信する事業者は、別途 MPEG LA の利用許諾が必要になりうる**。

> ⚠️ **#4 は本製品に直結する論点**: 本ソフトの出力（採用/一般動画）は顧客企業が**商用利用**する。Cisco の負担は「コーデックバイナリの特許料」をカバーするが、**商用 AVC コンテンツ配信そのものの特許許諾（MPEG LA）は別軸**になりうる。**社内/法務で要確認**（必要なら MPEG LA のコンテンツライセンス要否、または非 AVC コーデックの検討）。

---

## 6. 確定が必要な値（pin 時に公式から取得・本書では推測しない）
- FFmpeg ビルドの**正確なバージョンとダウンロードURL**（BtbN の該当リリース）。
- そのビルドの **`-buildconf` 実出力**（`--enable-libopenh264` 有・`--enable-gpl`/`nonfree` 無の確認）。
- **OpenH264 の正確なバージョン・win64 バイナリ URL・公開ハッシュ（SHA）**（ciscobinary / cisco リリース）。
- FFmpeg ビルドが要求する **OpenH264 ABI バージョン**との整合。

---

## 7. 実装ステップ（ユーザーの確定後に着手）
1. 取得・検証層（`infrastructure`）: Cisco バイナリの**ダウンロード→ハッシュ検証→bz2展開→配置**。失敗時 §2-5 文言＋手動配置フォールバック。
2. 構成検証: `ffmpeg -buildconf` を起動時/CIで検査（libopenh264 有・gpl/nonfree 無）。
3. クレジット: 「OpenH264 Video Codec provided by Cisco Systems, Inc.」をクレジット/ライセンス画面に追加（§5-3）。
4. バージョン定数表: FFmpeg/OpenH264 のバージョン・URL・ハッシュを1か所に固定（設問#8/#10）。

---

## 出典（2026-06-18 確認）
- FFmpeg ダウンロード/バージョン: https://ffmpeg.org/download.html
- BtbN ビルド（lgpl 変種）: https://github.com/BtbN/FFmpeg-Builds
- gyan.dev（GPL-3.0）: https://www.gyan.dev/ffmpeg/builds/
- OpenH264（2.6.0・BSD ソース）: https://github.com/cisco/openh264
- OpenH264 バイナリライセンス（特許条件）: https://www.openh264.org/BINARY_LICENSE.txt
- 方式の実例（古い）: https://github.com/Crigges/Prebuilt-LGPL-2.1-FFmpeg-with-OpenH264
