#!/usr/bin/env bash
# 同梱するローカル LLM を**公式の重みから自前で作る**手順（ADR-0051 決定10）。開発の側で動かす（利用者の手元では動かさない）。
#
# 使い方（Git Bash）:
#   scripts/local-llm/build-model.sh <作業フォルダ（リポジトリの外）> [Qwen/Qwen3.5-2B ...]
#   例: scripts/local-llm/build-model.sh /c/WS/stario-llm-work Qwen/Qwen3.5-2B Qwen/Qwen3.5-0.8B
#
# やること:
#   1. 公式の重みを Hugging Face から落とし、**配布元の SHA-256（LFS の oid）と照合**する（合わなければ止める）
#   2. 変換・量子化の道具を**版を固定して**用意する（llama.cpp の公式リリースの ZIP は SHA-256 を照合・ソースは同じタグ）
#   3. 重み → GGUF（BF16）→ Q4_K_M へ量子化し、できたファイルの SHA-256 を出す
#   4. 同じ重みから**視覚の部品**（写真を読む `mmproj`・Q8_0）を変換し、SHA-256 を出す（ADR-0052 決定4）
#
# ⚠️ 版を変えるときは、ここの固定値と `docs/yuko_recruit_docs/local-llm-build.md` の記録を**一緒に**直す（再現できなくなる）。
# ⚠️ 大きい＝2B の公式の重みは約 4.6GB・変換途中の BF16 は約 3.9GB（作業フォルダはリポジトリの外に置く）。
set -euo pipefail

WORK="${1:?作業フォルダを指定してください（リポジトリの外）}"; shift
REPOS=("${@:-Qwen/Qwen3.5-2B}")

LLAMA_TAG="b11269"
LLAMA_COMMIT="cee37ffea0a5749bce1704f0621b9ddd185b4858"
LLAMA_ZIP="llama-${LLAMA_TAG}-bin-win-cpu-x64.zip"
LLAMA_ZIP_SHA256="a15b798c282d70b169df4034e002fd2fad43437b2267503c1cffbbd8e4202a1c"
QUANT="Q4_K_M"
MMPROJ_TYPE="Q8_0"

mkdir -p "$WORK"/{hf,tools,out,logs}
cd "$WORK"

# ── 1. 公式の重み（配布元の SHA-256 と照合）───────────────────────────────
fetch_hf() {
  local repo="$1" dest="hf/${1#*/}"
  mkdir -p "$dest"
  curl -sfL -m 60 "https://huggingface.co/api/models/$repo/tree/main" > "$dest/.tree.json"
  node -e "const a=JSON.parse(require('fs').readFileSync('$dest/.tree.json','utf8'));for(const f of a)if(f.type==='file')console.log([f.path,(f.lfs?f.lfs.oid:'-'),f.size].join('|'))" > "$dest/.files.txt"
  while IFS='|' read -r path oid size; do
    local out="$dest/$path"
    if [ ! -f "$out" ] || [ "$(stat -c %s "$out")" != "$size" ]; then
      echo "get $repo/$path ($size)"
      curl -sfL --retry 5 -C - -o "$out" "https://huggingface.co/$repo/resolve/main/$path"
    fi
    [ "$(stat -c %s "$out")" = "$size" ] || { echo "大きさが合いません: $path"; exit 1; }
    if [ "$oid" != "-" ]; then
      local got; got=$(sha256sum "$out" | cut -d' ' -f1)
      [ "$got" = "$oid" ] || { echo "SHA-256 が合いません: $path ($got != $oid)"; exit 1; }
      echo "ok  $path $got"
    fi
  done < "$dest/.files.txt"
}

# ── 2. 道具（版を固定）──────────────────────────────────────────────────────
if [ ! -f "tools/llama-cpu/llama-quantize.exe" ]; then
  curl -sfL -o "tools/$LLAMA_ZIP" "https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_TAG/$LLAMA_ZIP"
  got=$(sha256sum "tools/$LLAMA_ZIP" | cut -d' ' -f1)
  [ "$got" = "$LLAMA_ZIP_SHA256" ] || { echo "llama.cpp の配布物の SHA-256 が合いません ($got)"; exit 1; }
  mkdir -p tools/llama-cpu && unzip -q -o "tools/$LLAMA_ZIP" -d tools/llama-cpu
fi
if [ ! -d "tools/llama.cpp-src" ]; then
  git clone -q --depth 1 --branch "$LLAMA_TAG" https://github.com/ggml-org/llama.cpp.git tools/llama.cpp-src
fi
[ "$(git -C tools/llama.cpp-src rev-parse HEAD)" = "$LLAMA_COMMIT" ] || { echo "llama.cpp のソースの版が違います"; exit 1; }
if [ ! -x "venv/Scripts/python" ]; then
  python -m venv venv
  ./venv/Scripts/python -m pip install -q --upgrade pip
  ./venv/Scripts/python -m pip install -q -r tools/llama.cpp-src/requirements/requirements-convert_hf_to_gguf.txt
  ./venv/Scripts/python -m pip install -q ./tools/llama.cpp-src/gguf-py
fi

# ── 3. 変換・量子化 ───────────────────────────────────────────────────────
for repo in "${REPOS[@]}"; do
  fetch_hf "$repo"
  name=$(echo "${repo#*/}" | tr 'A-Z' 'a-z')
  bf16="out/stario-${name}-bf16.gguf"
  q="out/stario-${name}-$(echo "$QUANT" | tr 'A-Z' 'a-z').gguf"
  ./venv/Scripts/python tools/llama.cpp-src/convert_hf_to_gguf.py "hf/${repo#*/}" --outtype bf16 --outfile "$bf16" > "logs/convert-${name}.log" 2>&1
  ./tools/llama-cpu/llama-quantize.exe "$bf16" "$q" "$QUANT" > "logs/quant-${name}.log" 2>&1
  echo "built $q $(stat -c %s "$q") $(sha256sum "$q" | cut -d' ' -f1)"
  mm="out/stario-${name}-mmproj-$(echo "$MMPROJ_TYPE" | tr 'A-Z' 'a-z').gguf"
  ./venv/Scripts/python tools/llama.cpp-src/convert_hf_to_gguf.py "hf/${repo#*/}" --mmproj --outtype "$(echo "$MMPROJ_TYPE" | tr 'A-Z' 'a-z')" --outfile "$mm" > "logs/convert-mmproj-${name}.log" 2>&1
  echo "built $mm $(stat -c %s "$mm") $(sha256sum "$mm" | cut -d' ' -f1)"
done
