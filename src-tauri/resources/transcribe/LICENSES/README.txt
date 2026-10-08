すたりお（stario）に同梱している「このパソコンの中で声を文字にする」部品と、そのライセンス
Third-party notices for the bundled speech-to-text components of stario
=====================================================================

このフォルダ（transcribe/LICENSES）には、同梱している部品のライセンス本文を置いています。
This folder contains the license texts of the bundled components.

---------------------------------------------------------------------
1. 声を文字にするモデル / Speech recognition model
---------------------------------------------------------------------
- Whisper small（OpenAI）
  入手元 / Source: https://github.com/openai/whisper
  ライセンス / License: MIT → openai-whisper-MIT.txt

  同梱しているファイルは、whisper.cpp の保守者が上記の公式の重みを ggml 形式に変換し、
  q5_1 で量子化して公開しているものを、そのまま使っています（中身の追加学習はしていません）。
  The bundled file is the ggml conversion (q5_1 quantization) of the official weights above,
  published by the whisper.cpp maintainers, used as is. No fine-tuning was applied.
  入手元 / Source: https://huggingface.co/ggerganov/whisper.cpp

  - models/ggml-small-q5_1.bin
    SHA-256: ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb

---------------------------------------------------------------------
2. 声を文字にする部品 / Speech recognition runtime (runtime/)
---------------------------------------------------------------------
- whisper.cpp / ggml（v1.9.4・b5130・commit 927cfce34f31707e17f2bff35c349632fb9e2c3a）
  入手元 / Source: https://github.com/ggml-org/whisper.cpp （公式リリース whisper-bin-x64.zip）
  ライセンス / License: MIT → whisper.cpp-MIT.txt
  同梱するのは whisper-cli.exe・whisper.dll・ggml*.dll の13ファイルだけです。
  Only whisper-cli.exe, whisper.dll and the ggml*.dll files (13 files) are bundled.

---------------------------------------------------------------------
外部への送信について / Network
---------------------------------------------------------------------
これらの部品は、このパソコンの中だけで動きます（ファイルを読んで書くだけで、ネットへは接続しません）。
These components run only on this computer (they read and write local files and never connect to a network).
