#!/usr/bin/env bash
# 同梱するローカル LLM を `src-tauri/resources/local_llm/` に置く（ADR-0051 決定9・13）。配布ビルドの前に動かす。
#
# 使い方（Git Bash・リポジトリの一番上で）:
#   scripts/local-llm/place-bundle.sh <作業フォルダ（build-model.sh と同じ）>
#
# ⚠️ 置くのは**照合が合ったものだけ**＝モデルの SHA-256 は `src-tauri/src/local_llm.rs` の `MODEL_SHA256`
#   （＝`docs/yuko_recruit_docs/local-llm-build.md` の出力表）と一致しないと止める。
# ⚠️ 実行の部品は llama.cpp の配布物のうち、`llama-server.exe` と DLL だけを置く（ほかの道具は同梱しない）。
set -euo pipefail

WORK="${1:?作業フォルダを指定してください}"
DEST="src-tauri/resources/local_llm"
[ -d "$DEST" ] || { echo "リポジトリの一番上で動かしてください（$DEST がありません）"; exit 1; }

model_file=$(grep -o 'MODEL_FILE: &str = "[^"]*"' src-tauri/src/local_llm.rs | sed 's/.*"\(.*\)"/\1/')
model_sha=$(grep -o 'MODEL_SHA256: &str = "[^"]*"' src-tauri/src/local_llm.rs | sed 's/.*"\(.*\)"/\1/')
src_model="$WORK/out/$model_file"
[ -f "$src_model" ] || { echo "モデルがありません: $src_model（先に build-model.sh を動かす）"; exit 1; }
got=$(sha256sum "$src_model" | cut -d' ' -f1)
[ "$got" = "$model_sha" ] || { echo "モデルの SHA-256 が合いません ($got != $model_sha)"; exit 1; }

runtime_src="$WORK/tools/llama-cpu"
[ -f "$runtime_src/llama-server.exe" ] || { echo "実行の部品がありません: $runtime_src/llama-server.exe"; exit 1; }

find "$DEST/runtime" -mindepth 1 ! -name .gitignore -delete
find "$DEST/models" -mindepth 1 ! -name .gitignore -delete
cp "$runtime_src/llama-server.exe" "$DEST/runtime/"
cp "$runtime_src"/*.dll "$DEST/runtime/"
cp "$src_model" "$DEST/models/"
echo "placed: $(ls "$DEST/runtime" | wc -l) runtime files, $model_file ($(stat -c %s "$DEST/models/$model_file") B)"
