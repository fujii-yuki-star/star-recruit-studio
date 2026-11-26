# 試作：プレビューの方式（MV-0002 の材料・捨てる前提）

γ 本体のワークスペースとは別。γ の CI では組み立てない。**上位 PC で測り直すため**に残している。

## 測り直し方

```bash
cd apps/stario-mv/spikes/preview
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.130 --locked   # Cargo.lock の wasm-bindgen と同じ版
cargo build -p spike-web --target wasm32-unknown-unknown --release
wasm-bindgen target/wasm32-unknown-unknown/release/spike_web.wasm --out-dir native/ui/pkg --target web
cargo build -p spike-native --release
./target/release/spike-native.exe     # 全部を自動で測り、results.json を書いて閉じる
```

- 方式 (a)＝`web`（Rust の描画を WebAssembly にして画面の中の WebGPU で描く）
- 方式 (b)＝`native`（Rust の描画を窓に直接出し、透明な画面を上に重ねる）
- 同じ描画（`scene`）を両方で使う。結果は `docs/stario_mv_docs/research/2026-11-preview-spike.md`。
