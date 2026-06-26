# FFmpeg 同梱ソース情報（LGPL 対応・#119）

本アプリ「すたりお（stario）」は動画の書き出しに **FFmpeg** を外部実行ファイル（shared build）として同梱して利用する。FFmpeg は **LGPL** で配布されるため、本書で使用バージョン・取得元・SHA-256・ビルド設定・**対応ソースの入手方法**を明示する（社内配布物と同じ場所から本書経由で対応ソースへ辿れる）。

## 同梱配布物（pin）

| 項目 | 値 |
|---|---|
| 提供元 | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)（GitHub Releases の自動ビルド） |
| release tag | `autobuild-2026-06-22-17-28` |
| zip ファイル名 | `ffmpeg-n8.1.2-win64-lgpl-shared-8.1.zip` |
| SHA-256 | `1f304d1d9410f082aa4a2f1ac4c6d48346737061f6d1e226318d885de8f3e0bb` |
| ダウンロード URL | https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-06-22-17-28/ffmpeg-n8.1.2-win64-lgpl-shared-8.1.zip |
| checksums | 同 release の `checksums.sha256`（上記 SHA-256 と一致を確認済み） |
| FFmpeg バージョン | `n8.1.2-20260622`（FFmpeg 8.1.2 / gcc 15.2.0） |
| ライセンス | **LGPL v3**（`--enable-version3`・`--enable-gpl`/`--enable-nonfree` なし） |

`ffmpeg -version`（抜粋）:
```
ffmpeg version n8.1.2-20260622 Copyright (c) 2000-2026 the FFmpeg developers
built with gcc 15.2.0 (crosstool-NG 1.28.0.23_185f348)
```

## ビルド設定（`ffmpeg -buildconf`）

ライセンス・H.264 に関わる要点：
- `--enable-shared` / `--disable-static`（shared build＝DLL 一式を同梱）
- `--enable-version3`（LGPL v3）／ **`--enable-gpl` なし・`--enable-nonfree` なし**
- **`--disable-libx264` / `--disable-libx265`**（GPL の x264/x265 を含まない）
- `--enable-libopenh264`（OpenH264＝**BSD-2-Clause ソース**から static build・「第三者ライセンス」参照）
- H.264 主経路 **`h264_mf`（Media Foundation・OS 提供）** は Windows ターゲットで自動有効（`-buildconf` には現れないが `-encoders` に存在＝判定は `-encoders` が正）

configuration 全文:
```
--prefix=/ffbuild/prefix --pkg-config-flags=--static --pkg-config=pkg-config --cross-prefix=x86_64-w64-mingw32- --arch=x86_64 --target-os=mingw32 --enable-version3 --disable-debug --enable-shared --disable-static --disable-w32threads --enable-pthreads --enable-iconv --enable-zlib --enable-libxml2 --enable-libvmaf --enable-fontconfig --enable-libharfbuzz --enable-libfreetype --enable-libfribidi --enable-vulkan --enable-libshaderc --enable-libvorbis --disable-libxcb --disable-xlib --disable-libpulse --enable-gmp --enable-lzma --enable-liblcevc-dec --enable-opencl --enable-amf --enable-libaom --enable-libaribb24 --disable-avisynth --enable-chromaprint --enable-libdav1d --disable-libdavs2 --disable-libdvdread --disable-libdvdnav --disable-libfdk-aac --enable-ffnvcodec --enable-cuda-llvm --disable-frei0r --enable-libgme --enable-libkvazaar --enable-libaribcaption --enable-libass --enable-libbluray --enable-libjxl --enable-libmp3lame --enable-libopus --enable-libplacebo --enable-librist --enable-libssh --enable-libtheora --enable-libvpx --enable-libwebp --enable-libzmq --enable-lv2 --enable-libvpl --enable-openal --enable-liboapv --enable-libopencore-amrnb --enable-libopencore-amrwb --enable-libopenh264 --enable-libopenjpeg --enable-libopenmpt --enable-librav1e --disable-librubberband --enable-schannel --enable-sdl2 --enable-libsnappy --enable-libsoxr --enable-libsrt --enable-libsvtav1 --enable-libtwolame --enable-libuavs3d --disable-libdrm --enable-vaapi --disable-libvidstab --enable-libvvenc --disable-whisper --disable-libx264 --disable-libx265 --disable-libxavs2 --disable-libxvid --enable-libzimg --enable-libzvbi --extra-cflags=-DLIBTWOLAME_STATIC --extra-libs=-lgomp --extra-ldflags=-pthread --cc=x86_64-w64-mingw32-gcc --cxx=x86_64-w64-mingw32-g++ --extra-version=20260622
```

## H.264 エンコーダ（`ffmpeg -encoders` 抜粋）
```
 V....D libopenh264          OpenH264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 V....D h264_mf              H264 via MediaFoundation (codec h264)
```
→ 本アプリの `pick_codec`（[`src-tauri/src/ffmpeg.rs`](src-tauri/src/ffmpeg.rs)）は **`h264_mf` を最優先**。`libx264`/`libx265` はビルドに無く、通常の書き出し経路で `libopenh264` は選択しない（テスト `pick_codec_prefers_mediafoundation_over_libopenh264_in_btbn_lgpl` で担保）。

## 第三者ライセンス（同梱物に含まれるもの）
- **FFmpeg**：LGPL v3。ライセンス本文は同梱物 **`resources/ffmpeg/LICENSE.txt`**（配布物に同梱）。
- **OpenH264（libopenh264）**：**BSD-2-Clause**（ソースから static build）。BtbN の lgpl build に含まれるため記載。本アプリは通常経路で `h264_mf` を優先するため使用しないが、同梱物に含まれる。Cisco の AVC/H.264 Patent Portfolio License（Cisco 配布の openh264 バイナリ版）とは**無関係**（本ビルドはソースからのビルド）。

## 対応ソースの入手方法（LGPL 義務）
- **FFmpeg ソース**：本 pin のバージョン `n8.1.2` に対応するソース＝FFmpeg 公式 git の tag `n8.1.2`（<https://git.ffmpeg.org/ffmpeg.git>）または <https://ffmpeg.org/releases/>。
- **ビルド定義（BtbN）**：<https://github.com/BtbN/FFmpeg-Builds>（上記 release tag のビルドスクリプト。configuration は本書「ビルド設定」のとおり）。
- 配布パッケージ／本リポジトリのいずれからも、本書 `FFmpeg_SOURCE.md` 経由で上記対応ソースへ辿れる。

## 配置（ビルド時）
配布ビルドでは、上記 pin の zip を SHA-256 照合のうえ展開し、`bin`（exe＋DLL）と `LICENSE.txt` を **`src-tauri/resources/ffmpeg/`** に置く（大容量のため git 追跡外＝`.gitignore`／ディレクトリのみ追跡）。`tauri.conf.json` の `bundle.resources` で同梱され、実行時は `resolve_ffmpeg` が **配布版では同梱を最優先**に解決する（外部 `FFMPEG_PATH` は `tauri dev` または `FFMPEG_DIAGNOSTIC=1` 時のみ尊重）。

## 検査
`npm run check:ffmpeg-dist`（[`scripts/check-ffmpeg-dist.mjs`](scripts/check-ffmpeg-dist.mjs)）が、配置した FFmpeg の `-buildconf`/`-encoders` を実行し、**h264_mf 存在・`--enable-gpl`/`--enable-nonfree` 不在・libx264/libx265 不在・dev 用 ffmpeg-static 非混入・h264_mf 優先**を自動判定する（配布ビルド前に実行）。

## 更新時
pin を更新する場合は、新しい tag/zip/SHA-256/version/buildconf を本書に反映し、`src-tauri/resources/README.md` の版・`13_DEPENDENCIES_AND_LICENSING.md` §9 も更新する。
