すたりお（stario）に同梱している「このパソコンの中で動く AI」の部品と、そのライセンス
Third-party notices for the bundled local AI components of stario
=====================================================================

このフォルダ（local_llm/LICENSES）には、同梱している部品のライセンス本文を置いています。
This folder contains the license texts of the bundled components.

---------------------------------------------------------------------
1. AI モデル / AI model
---------------------------------------------------------------------
- Qwen3.5-2B（Qwen Team, Alibaba Cloud）
  入手元 / Source: https://huggingface.co/Qwen/Qwen3.5-2B
  ライセンス / License: Apache License 2.0 → Qwen3.5-Apache-2.0.txt

  ★ 改変の告知 / Notice of modification (Apache License 2.0, Section 4(b)):
  同梱している次の2つのファイルは、上記の公式の重みを、すたりおの開発元が
  llama.cpp（b11269）で GGUF 形式に変換し、量子化したものです（中身の追加学習はしていません）。
  The following files were converted to GGUF and quantized by the developers of stario
  from the official weights above, using llama.cpp (b11269). No fine-tuning was applied.

  - models/stario-qwen3.5-2b-q4_k_m.gguf （言葉の部分 / language model, Q4_K_M）
    SHA-256: 5405508fd56e0bace3ec4c2484eb4d0f606cbded87760cf3756896e234068b35
  - models/stario-qwen3.5-2b-mmproj-q8_0.gguf （写真を読む部分 / vision projector, Q8_0）
    SHA-256: 526dbf85f350baf3a5107b1f14e629e94571c7cbab4277476fbdaaa8c4a31a64

---------------------------------------------------------------------
2. AI を動かす部品 / AI runtime (runtime/)
---------------------------------------------------------------------
- llama.cpp / ggml（b11269・commit cee37ffea0a5749bce1704f0621b9ddd185b4858）
  入手元 / Source: https://github.com/ggml-org/llama.cpp （公式リリース llama-b11269-bin-win-cpu-x64.zip）
  ライセンス / License: MIT → llama.cpp-MIT.txt

  この実行ファイルには、次の部品が組み込まれています / The runtime includes:
  - cpp-httplib（MIT）→ cpp-httplib-MIT.txt
  - nlohmann/json（MIT）→ nlohmann-json-MIT.txt
  - BoringSSL 0.20260903.0（Apache License 2.0 ほか）→ BoringSSL.txt
  - LLVM OpenMP（libomp.dll・Apache License 2.0 with LLVM Exceptions）→ LLVM-OpenMP-Apache-2.0-with-LLVM-exception.txt
  - stb_image（MIT または Public Domain）→ stb_image-MIT-or-PublicDomain.txt
  - miniaudio（Public Domain または MIT No Attribution）→ miniaudio-PublicDomain-or-MIT-0.txt
  - subprocess.h（The Unlicense）→ subprocess.h-Unlicense.txt

---------------------------------------------------------------------
外部への送信について / Network
---------------------------------------------------------------------
これらの部品は、このパソコンの中だけで動きます（127.0.0.1・ネットへの接続を切った状態で起動）。
These components run only on this computer (127.0.0.1, started in offline mode).
