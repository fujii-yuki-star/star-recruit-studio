# 調査資料: Windows x64 LGPL FFmpeg + OpenH264（配布版コーデック対応）

> 目的: ADR-0002（FFmpeg=LGPL＋OpenH264）の配布実装に向けた事実調査。**値・URL は公式情報で確認し、未確認値は「pin 時に公式から取得」と明記（推測値は使わない）。**
> 調査日: 2026-06-18。出典は各項目に付す。**本書は法的助言ではない**（最終判断は社内/法務）。
>
> **位置づけ更新（2026-06-18・[`ADR-0013`](../adr/0013-h264-via-media-foundation.md) / PR#116）**: H.264 の**主経路は Media Foundation（`h264_mf`・OS提供）**に決定（実機スパイクで確証）。本資料は **OpenH264 をフォールバック**（`h264_mf` が無い環境向け）として実装する場合の参照に位置づけが変わった。以下の「主採用」前提の記述はフォールバック実装の文脈として読むこと。

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

> ⚠️ **2026-06-18 確定（重要）**: BtbN は OpenH264 を **Cisco ソース（`github.com/cisco/openh264.git` commit `e3f5b10438e2bacc155cf54578222bd4236c9f06`）から `make … install-static` でビルドし、FFmpeg に `--enable-libopenh264` で静的リンク**している（`scripts.d/50-openh264.sh` で確認）。これは **Cisco が配布するバイナリではない**ため、**Cisco の特許カバレッジが及ばず**（`BINARY_LICENSE` の「ダウンロード前に第三者ソフトへ統合・結合しない」条件を満たさない）、**「Cisco 公式 DLL を初回取得して動的参照」する方針と両立しない**。→ **BtbN は推奨から除外**。

| 候補 | 入手元 | ライセンス | OpenH264 の組込み方 | 採否 |
|---|---|---|---|---|
| **自前ビルド（FFmpeg LGPL・libopenh264 を動的参照）** | 自社で再現可能ビルド | LGPL 2.1+（gpl/nonfree 不使用を自分で固定） | FFmpeg を `--enable-libopenh264` で**動的リンク**し、**実行時に Cisco 公式 OpenH264 DLL をロード**（初回取得で配置） | ◎ **第一候補** |
| BtbN `lgpl` / `lgpl-shared` | github.com/BtbN/FFmpeg-Builds | LGPL 2.1+ | **OpenH264 を Cisco ソースから静的リンク**（install-static）＝Cisco 配布バイナリでない | ✗ **除外**（特許カバレッジ外・初回取得方式と非両立） |
| gyan.dev | gyan.dev | **GPL-3.0** | — | ✗ 不可（LGPL 不適合） |
| Crigges Prebuilt-LGPL | github | LGPL 2.1 | `--enable-libopenh264`＋**Cisco 公式 DLL を `libopenh264.dll` に置いて動的参照**（FFmpeg 3.4・2019） | ✗ 採用不可（古い）／**目指す方式（動的参照）の実例として参考** |

> 注: 「shared」は FFmpeg 自身の libav 系 DLL を指すだけで、**OpenH264 を Cisco 公式 DLL として動的参照する保証ではない**（ユーザー指摘・2026-06-18）。OpenH264 の組込み方（静的 / 動的）はビルドスクリプトと実バイナリの依存関係で判定する必要がある（§3 の受け入れ基準）。

---

## 3. 推奨案（1つ）＝再現可能な自前ビルド（OpenH264 を動的参照）

**配布用に FFmpeg（LGPL）を `--enable-libopenh264` で「OpenH264 を動的参照」する形で再現可能に自前ビルドし、実行時に Cisco 公式 OpenH264 DLL（初回取得）をロードする。**（BtbN は §2 のとおり静的リンクのため不可。）

- 理由: 特許カバレッジは **Cisco が配布したバイナリ**にのみ及ぶ（§1・§5）。FFmpeg に OpenH264 を**静的**に取り込むとカバレッジ外。よって **OpenH264 は静的に組み込まず、FFmpeg は動的参照だけ**にして、実体は Cisco の DLL を実行時に置く（Crigges 方式の現行版）。
- ビルド構成（MSYS2/MinGW・`media-autobuild_suite` 等で再現可能にスクリプト化）:
  - FFmpeg: `--enable-shared --disable-static` ／ `--enable-libopenh264` ／ **`--enable-gpl`・`--enable-nonfree` を付けない** ／ x264・x265 を入れない。
  - OpenH264: **静的に取り込まない**。⚠️ **標準の `--enable-libopenh264` は openh264 をビルド時リンク**するため、DLL が無いと FFmpeg 自体が起動しない（=初回取得方式と非両立）。**libavcodec が openh264 を実行時 `LoadLibraryA`/`dlopen` で読むパッチ**（openSUSE/Raven の `ffmpeg-dlopen-openh264` 系の前例あり）を当て、openh264 を**ハード依存にしない**。実体は **Cisco 配布の `libopenh264-<ver>-win64.dll`** を取得・配置（FFmpeg が探す名前に合わせる）。
  - **OpenH264 のバージョンは FFmpeg／パッチが期待する ABI と一致**させる（不一致はロード失敗）。
- バージョン目安: FFmpeg 8.1.x ／ OpenH264 2.6.0（pin 時に公式確認・ABI 一致）。

### 受け入れ基準（候補バイナリで必ず実機検証＝ユーザー設問1–7・Windows 実機で実施）
1. 成果物のファイル名・取得元・コミット/ビルド日・ハッシュを記録。
2. `ffmpeg -buildconf` 全文に `--enable-libopenh264` 有・`--enable-gpl`/`--enable-nonfree` 無。
3. `ffmpeg -encoders` に `libopenh264` が存在。
4. `avcodec-*.dll` のインポートに **openh264 が現れないこと**（dlopen 方式＝実行時 `LoadLibraryA` ロードのため現れないのが正常。逆に現れる＝ビルド時ハード依存で、DLL 無しに FFmpeg が起動しない＝不可）。動的ロードの成立は #5・#6 で確認する。
5. **OpenH264 DLL を置かない状態では `libopenh264` エンコードが失敗**する（＝静的に埋め込まれていない証拠）。
6. **Cisco 公式 DLL を置くとロードされ**、エンコードが成功する。
7. 成果物内の OpenH264 が**静的リンクでなく Cisco 公式 DLL の動的参照**であること。

> これらを満たして初めて「LGPL＋Cisco 公式 OpenH264 初回取得」が成立する。**満たすまでバージョン pin と取得処理の本実装はしない**（ユーザー指示・2026-06-18）。

---

## 4. ユーザー設問（1–10）への回答

1. **入手元・バージョン**: 入手元＝**再現可能な自前ビルド**（BtbN は OpenH264 静的リンクのため不可・§2）。バージョン＝FFmpeg 8.1.x・OpenH264 2.6.0（ABI 一致・pin 時に公式確認）。
2. **構成検証（LGPL/libopenh264）**: 実バイナリで `ffmpeg -buildconf` を実行し `--enable-libopenh264` の存在を確認（実装: 起動時/CIで自動チェック可）。
3. **`--enable-libopenh264` の有無**: 自前ビルドで明示＝確実（BtbN は §2 のとおり静的リンクで除外済み）。
4. **`--enable-gpl`/`nonfree` 不含**: 自前ビルドで両フラグを**付けず**、`-buildconf` で不在を確認。
5. **対応 Cisco OpenH264 バージョン**: 2.6.0（最新）。FFmpeg ビルドの libopenh264 ABI に合わせて選定（不一致はロード失敗）。
6. **DLL 名・配置・読込**: Cisco 配布物 `libopenh264-<ver>-win64.dll.bz2` を取得→bz2 展開→`libopenh264.dll` として FFmpeg が探索する場所（実行ファイル同階層 or `PATH`/作業ディレクトリ）に配置。FFmpeg は実行時に動的ロード。
7. **自前ビルドの要否**: **必要**。既存配布物（BtbN）は OpenH264 を**静的リンク**するため不可（§2）。OpenH264 を**動的参照**する LGPL FFmpeg を再現可能に自前ビルドする（構成フラグ固定・受け入れ基準4–7で検証）。
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
- 自前ビルドの**正確な FFmpeg ソースバージョン・ビルドスクリプト/dlopen パッチのコミット・再現手順**（§3 のビルド構成に基づく）。
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
