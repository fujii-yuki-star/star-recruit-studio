#!/usr/bin/env bash
# 同梱する「声を文字にする」部品を `src-tauri/resources/transcribe/` に置く（ADR-0058 決定1）。配布ビルドの前に動かす。
#
# 使い方（Git Bash・リポジトリの一番上で）:
#   scripts/transcribe/place-bundle.sh <作業フォルダ>
#   作業フォルダには次の2つを置いておく（どちらも公式の配布物そのまま）:
#     whisper-bin-x64.zip       https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-bin-x64.zip
#     ggml-small-q5_1.bin       https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small-q5_1.bin
#
# ⚠️ 置くのは**照合が合ったものだけ**＝モデルの SHA-256 は `src-tauri/src/transcribe.rs` の `MODEL_SHA256`
#   （1か所＝ここに写さない）と、部品の書庫は下の `ZIP_SHA256`（v1.9.4・b5130）と一致しないと止める。
# ⚠️ 書庫のうち `whisper-cli.exe`・`whisper.dll`・`ggml*.dll` の13ファイルだけを置く（ほかの道具・SDL2 は同梱しない）。
set -euo pipefail

WORK="${1:?作業フォルダを指定してください}"
DEST="src-tauri/resources/transcribe"
ZIP_SHA256="f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c"
[ -d "$DEST" ] || { echo "リポジトリの一番上で動かしてください（$DEST がありません）"; exit 1; }

model_file=$(grep -o 'MODEL_FILE: &str = "[^"]*"' src-tauri/src/transcribe.rs | sed 's/.*"\(.*\)"/\1/')
model_sha=$(grep -o 'MODEL_SHA256: &str = "[^"]*"' src-tauri/src/transcribe.rs | sed 's/.*"\(.*\)"/\1/')
src_model="$WORK/$model_file"
[ -f "$src_model" ] || { echo "モデルがありません: $src_model"; exit 1; }
got=$(sha256sum "$src_model" | cut -d' ' -f1)
[ "$got" = "$model_sha" ] || { echo "モデルの SHA-256 が合いません ($got != $model_sha)"; exit 1; }

zip="$WORK/whisper-bin-x64.zip"
[ -f "$zip" ] || { echo "部品の書庫がありません: $zip"; exit 1; }
got=$(sha256sum "$zip" | cut -d' ' -f1)
[ "$got" = "$ZIP_SHA256" ] || { echo "部品の書庫の SHA-256 が合いません ($got != $ZIP_SHA256)"; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
unzip -q "$zip" -d "$tmp"
rt="$tmp/Release"
[ -f "$rt/whisper-cli.exe" ] || { echo "書庫の中に whisper-cli.exe がありません"; exit 1; }

find "$DEST/runtime" -mindepth 1 ! -name .gitignore -delete
find "$DEST/models" -mindepth 1 ! -name .gitignore -delete
cp "$rt/whisper-cli.exe" "$rt/whisper.dll" "$rt"/ggml*.dll "$DEST/runtime/"
cp "$src_model" "$DEST/models/"
n=$(ls "$DEST/runtime" | grep -cv '^\.gitignore$' || true)
[ "$n" = "13" ] || { echo "実行の部品の数が 13 ではありません（$n）＝書庫の中身が変わった？"; exit 1; }
echo "placed: $n runtime files, $model_file ($(stat -c %s "$DEST/models/$model_file") B)"
