# プラグイン調査（ホストを作る側の技術と規約）

- 調査日：2026-11-25
- 前提：個人用（開発者本人1人・自宅の上位 Windows PC）の自作モーショングラフィックス/MV 編集ソフト。描画は Rust（wgpu）で GPU、書き出しは画面なしでも動く。外部のエフェクトプラグインを読み込めるホストにしたい。
- 範囲：**ホストを作る側**の技術と規約だけ。製品ごとの対応状況は別調査（`2026-11-stario-mv-plugin-products.md`）。
- 書き方：各事実に出典 URL を付ける。確証が無いものは「**未確認**」と書く。筆者の判断・推測は「**判断**」と明示する。

---

## A. OpenFX（OFX）

### A-1. 仕様の現状

| 項目 | 内容 | 出典 |
|---|---|---|
| 最新リリース | **1.5.1**（タグ `OFX_Release_1.5.1`・2025-11-20 公開）。それより新しいリリース（1.6）は 2026-11-25 時点の GitHub リリース一覧に**無い** | GitHub API `repos/AcademySoftwareFoundation/openfx/releases`（https://github.com/AcademySoftwareFoundation/openfx/releases） |
| 1.5.1 の中身 | 不具合修正＋新プロパティ `kOfxImageEffectPropCPURenderSupported` / `kOfxImageEffectPropThumbnailRender` / `kOfxImageEffectPropNoSpatialAwareness` | 同上 |
| 1.5 | 2024-08-29 タグ（ASWF の資料では 2024-07-24 リリース）。1.5s（色空間の修正）2024-11-26。**9年ぶりの大型更新**（1.4 は 2015-09） | https://openfx.readthedocs.io/en/main/ReleaseNotes/relnotes-1.5.html ／ https://www.cgchannel.com/2024/09/openfx-1-5-has-been-released/ |
| 1.5 の主な追加 | `OfxDrawSuiteV1`（OpenGL に依存しないオーバーレイ描画）、GPU 描画スイートに **Metal / CUDA / OpenCL（画像とバッファ）**、文字列の選択肢パラメータ `kOfxParamTypeStrChoice`、`OfxSetHost()`、Windows ARM64 対応、色管理 | https://openfx.readthedocs.io/en/main/ReleaseNotes/relnotes-1.5.html |
| 1.6 の見込み | ASWF 理事会向け資料（2025-07）：「大きな新作業は 1.6（2025年後半か2026年）まで出ない」「夏までに 1.6 を狙っていたが遅れている」。最優先は**新しい C++ バインディング**、次いでメタデータ（カメラ・タイムコード等）。コミッタは3人と少ない | https://tac.aswf.io/meetings/2025-07-23/OpenFX_ASWF_TAC_Update_July_2025.pdf |
| 開発の活発さ | main への直近のコミットは 2026-11-11（ドキュメント修正）。リポジトリに `openfx-cpp` フォルダあり | GitHub API `commits`（https://github.com/AcademySoftwareFoundation/openfx） |
| 管理団体 | 2022-08 に ASWF の **Incubation** プロジェクトとして移管（Open Effects Association は解散）。**Graduated へ昇格したかは未確認** | https://www.cgchannel.com/2022/08/academy-software-foundation-adopts-openassetio-and-openfx ／ https://tac.aswf.io/process/lifecycle |
| ライセンス | **BSD-3-Clause**（ヘッダ・Support・HostSupport とも） | https://github.com/AcademySoftwareFoundation/openfx ／ HostSupport/README（https://github.com/AcademySoftwareFoundation/openfx/tree/main/HostSupport） |

**ホスト実装用の公式部品**

- **HostSupport ライブラリ**（C++・BSD）：C API を C++ クラスで包み、ホストは「いくつかのクラスを派生し、仮想関数を実装し、プロパティを設定する」だけでよい。**関心領域（RoI）・クリップの好み（clip preferences）の計算を肩代わり**し、プラグインの記述を XML キャッシュに残す。依存は expat。README 自身が「外部 XML リソース・パラメータのインタラクト・文書化」が不足と書いている（TTD に「カスタムパラメータ未対応」）。HostSupport への直近の変更は 2026-09-22。
  出典：https://github.com/AcademySoftwareFoundation/openfx/tree/main/HostSupport （README・TTD）
- **ホストのサンプル**：`HostSupport/examples/hostDemo.cpp` ほか（クリップ・エフェクト・パラメータの各インスタンスの実装例）。
- **プラグインのサンプル**：`Examples/` に Basic・Invert・Overlay・DrawSuite・OpenGL・ChoiceParams・ColourSpace・Custom・Rectangle・Test 等。**ホストの動作確認用**に使える。
  出典：同リポジトリの `HostSupport/examples`・`Examples` 一覧（GitHub API）

### A-2. ホストが実装すべきもの

**入口（バイナリの読み込み）**
- プラグインは `.ofx`（Windows では DLL）を `NAME.ofx.bundle/Contents/Win64/` に置く。既定の探索先は Common Files 下の `OFX\Plugins`、環境変数 `OFX_PLUGIN_PATH` が先に探される（再帰・`@` 始まりは飛ばす）。
  出典：https://openfx.readthedocs.io/en/main/Reference/ofxPackaging.html
- 公開関数：`OfxGetNumberOfPlugins`・`OfxGetPlugin(n)`（必須）、`OfxSetHost`（任意＝**存在を確かめてから**呼ぶ。プラグインが `kOfxStatFailed` を返したら**黙って飛ばす**）。以後の通信はすべて `mainEntry(action, handle, inArgs, outArgs)`。
- `fetchSuite` は**未実装のスイート（または版）には NULL を返す**のが仕様。
  出典：https://openfx.readthedocs.io/en/main/Reference/ofxCoreAPI.html

**スイート**（ホストが中身を用意する関数表）：Property / ImageEffect / Progress / TimeLine / Parameter / ParametricParameter / Memory / MultiThread / Interact / Message(V1,V2) / ImageEffectOpenGLRender / Draw（1.5）。
出典：https://openfx.readthedocs.io/en/main/Reference/suites/ofxSuiteReference.html

**描画（Image Effect API）**
- 1回の描画は Begin/End Sequence Render で挟まれる。ホストの手順は「定義域（RoD）取得 → 描画窓を RoD で切る → 各入力の関心領域（RoI）取得 → 入力を描画・キャッシュ → エフェクトを描画」。`IsIdentity` で素通しを返されたら処理を飛ばしてよい。
- **スレッド安全性**はプラグインが宣言（unsafe / instance safe / fully safe）。`kOfxImageEffectPluginPropHostFrameThreading=1` ならホストが同じフレームを窓に分けて並列に呼べる（＝**タイル/スライス**）。0 ならプラグインが自分で MultiThread スイートを使う。
- **順番に描く必要**（`SequentialRender` 0/1/2）、**下書き品質**（`RenderQualityDraft`）、**中断**（ホストが `abort()` を立てる）、フィールド（インタレース）の規則もある。
  出典：https://openfx.readthedocs.io/en/main/Reference/ofxRendering.html
- 画素：RGBA / RGB / Alpha、8bit / 16bit / 32bit float（1.4 以降 half も）。プレマルチ状態・画素縦横比も扱う。
  出典：https://openfx.readthedocs.io/en/main/Reference/ofxImageClip.html

**時間をまたぐ取得（前後フレーム参照）**
- プラグインは `kOfxImageEffectPropTemporalClipAccess` を立てたうえで、`clipGetImage()` で**別の時刻の画像**を取れる。ホストはそれに応じて**任意時刻の入力フレームを（再帰的に）描いて渡せる**必要がある。ホストが対応しないこともあり、宣言なしで使うのはエラー。
  出典：https://openfx.readthedocs.io/en/main/Reference/ofxImageClip.html

**パラメータ**
- 整数/実数（1〜3次元）・色・真偽・選択肢・文字列・カスタム・ページ・グループ・押しボタン・パラメトリック（曲線）等。アニメーション（キーフレーム）はホストが持ち、値を時刻で問い合わせられる。
  出典：https://openfx.readthedocs.io/en/main/Reference/ofxParameter.html
- ⚠️ 実装済みの OSS ホストでも型の一部は後回しにされている（下の MLT の例）。

**オーバーレイ操作（Interact）**
- ビューア上に描く**オーバーレイ**と、パラメータ欄を置き換える**カスタムインタラクト**の2種。ホストは描画・ペン（押す/動かす/離す）・キー・焦点の各アクションを送り、ビューごとに投影・ビューポート・ピクセル倍率を設定する。
- 既定の描画 API は **OpenGL**。1.5 の **Draw Suite（`OverlayInteractV2`）** を選んだプラグインは「描画はすべて DrawSuite で行い、OpenGL を使ってはならない」。
  出典：https://openfx.readthedocs.io/en/main/Reference/ofxInteracts.html
- **判断**：wgpu のホストにとって Draw Suite は朗報（線・図形・文字の呼び出しを自前の 2D 描画へ写せばよい）。ただし**V1（OpenGL 直書き）しか持たない既存プラグインは多い**はず（数は未確認）。Natron は Draw Suite の呼び出しを OpenGL で描く `OfxDrawSuiteGL` を持ち、両方あるプラグインでは V1 を使う。
  出典：https://natron.readthedocs.io/en/rb-2.6/maintainers/openfx-host.html

**GPU 描画拡張**（`ofxGPURender.h`）

| API | 画像の渡し方 | ホストの責務 |
|---|---|---|
| OpenGL | プラグインが `clipLoadTexture` を呼び、テクスチャ番号（GLuint）を受け取る | `OpenGLContextAttached/Detached` を対で送る。`kOfxStatGLRenderFailed` なら**OpenGL を切って再試行**、`GLOutOfMemory` なら解放して再試行→CPU |
| CUDA | `kOfxImagePropData` が**デバイスポインタ**になる | CUDA ストリームを渡せる（プラグインは `cudaDeviceSynchronize()` を呼ぶべきでない） |
| OpenCL | バッファは `kOfxImagePropData` の `cl_mem`、画像は `kOfxImageEffectPropOpenCLImage` | コマンドキューを渡す |
| Metal | `MTLBuffer` または `MTLTexture`（mac のみ） | コマンドキューを渡す・テクスチャはホスト所有 |

- **Vulkan・DirectX は仕様に無い**。ヘッダは「Vulkan 等も同様の手法で使えるだろう」と書くだけ。各 API は**両者が対応を宣言したときだけ**有効にし、1回のアクションで有効にするのは1つ。
  出典：https://openfx.readthedocs.io/en/main/Reference/api/file/ofxGPURender_8h.html ／ https://openfx.readthedocs.io/en/main/Reference/ofxRendering.html
- 2020 年の議論でも「ベンダーごとに API が違う」「1台に複数 GPU」が未解決として挙がっていた。
  出典：https://groups.google.com/g/vfx-platform-discuss/c/KkBXq1m81jI

### A-3. 既存の自作/OSS ホストの例

| ホスト | 状況 | 出典 |
|---|---|---|
| **Natron** | 最も完全な OSS ホスト。HostSupport（フォーク）＋ `Engine/Ofx*` の接着層。Nuke・Resolve・Fusion と同じプラグインを読むことを目標とし、**OFX 1.5.1 との適合を表で追跡**。Draw Suite 対応。読み取り専用プロパティへの書き込みは**拒否せず警告で通す**（既存プラグインを壊さないため） | https://natron.readthedocs.io/en/rb-2.6/maintainers/openfx-host.html |
| **MLT（Kdenlive・Shotcut の土台）** | **v7.38.0（2026-04-22）で基本的な OFX フィルタ対応**。未対応：GPU 描画／Integer2D・Integer3D・Double3D・Custom・Bytes・Page・PushButton／プラグイン側のキーフレーム／タイル・スライス・フレーム単位の並列／マルチ解像度／**時間をまたぐ取得**／オーバーレイとダイアログ／`getTime()` 等のタイムライン問い合わせ／ジェネレータ・トランジション・リタイマー／パラメトリック曲線。v7.40.0 でも改善が続く | https://mltframework.org/blog/v7.38.0_released/ ／ https://mltframework.org/blog/v7.40.0_released/ |
| **Shotcut 26.6** | 「実験的」として既定オフ。独自 UI 不可・**時間をまたぐプラグイン不可**・トランジション/ジェネレータ/複数入力不可・**CPU のみ（GPU 専用プラグインは動かない）**。起動30秒以内に落ちると**安全モードで外部プラグインを無効化**する仕組みを持つ（2026-07-15） | https://forum.shotcut.org/t/external-plugin-support-openfx-vst2-and-lv2/51741 |
| **Kdenlive** | 2026-04 の「State of Kdenlive」で OFX 対応を今後の機能として挙げる。**リリース済みかは未確認** | https://planet.kde.org/kdenlive-2026-04-18-state-of-kdenlive-2026/ |
| **Olive** | OFX 対応を示す資料は**見つからず（未確認）** | — |
| **Quercus（Rust 製の動画エディタ）** | `quercus-ofx-plugin` 0.7.2（2026-10〜11）：Rust 製の OFX ホスト兼橋渡し。**インタラクトは本体プロセス、描画は作業用プロセス**に分ける設計。プラグイン FFI を panic が越えないよう捕捉。GL 連携は mac（CGL）のみ実装、**Windows（WGL）・Linux（EGL）は未実装の枠だけ**。「内部 crate・API 不安定・直接依存するな」と明記、docs.rs のビルドは失敗 | https://docs.rs/crate/quercus-ofx-plugin/latest |
| HitFilm Pro | OFX 1.3 準拠＋OpenGL 描画（製品は 2025 年に終了） | https://www.manula.com/manuals/fxhome/hitfilm/14/en/topic/openfx ／ https://cgchannel.com/2025/02/artlist-discontinues-the-fxhome-apps-hitfilm-and-imerge-dead |

**商用プラグインを動かすときに出た問題**

- **ホスト判定**：Neat Video の OFX 版が Natron で読み込まれなかった。開発者の説明は「プラグインが対応ホスト（Nuke・Sony Vegas・Resolve 等）の一覧を確認しており、Natron が無いので拒否している。こちらでできるのは**アプリ名を偽って Nuke 等のふりをする**ハックだけ」（2014-06-25）。Natron はホスト名を変える設定を足したが「ハック」と位置づけ、本来はプラグイン側が一覧に加えるべきとした。同スレッドでは別の時期に「32bit float 非対応」で無視される事象も出ている。
  出典：https://groups.google.com/g/natron-vfx/c/O2ZAxnQrFPM
- **ホストごとの分岐**：Natron の手引きは「パラメトリックパラメータは Nuke 8・9 で非対応（ホストが落ちる）」と書く＝**プラグインはホスト名で挙動を変える**ことがある。
  出典：https://github.com/NatronGitHub/Natron/wiki/OpenFX-plugin-programming-guide-(Advanced-issues)
- **1.5 の `OfxSetHost`** は、プラグインが「このホストには出さない」と返せる正式な口になった（上記）。**判断**：ホスト名で弾く商用プラグインは、ホスト名を偽らない限り自作ホストでは動かない前提で考えるべき。偽装は利用規約上の問題になりうる（各社規約は**未確認**）。
- **ライセンス確認**：商用プラグインのライセンス認証がホストを限定するかは製品ごと（別調査の範囲）。
- **未実装スイートで落ちる**：仕様上 `fetchSuite` は NULL を返すが、それを確かめずに落ちる商用プラグインの**具体例は見つからなかった（未確認）**。関連して、Nuke でも「中断された描画のあとプラグインが `kOfxStatOK` を返すと落ちる」不具合が記録されており、**同じプロセスで動く以上、プラグインの不具合はホストごと落とす**。
  出典：https://supportsandbox.foundry.com/hc/en-us/articles/32696711777810-ID-249093-Nuke-crashes-when-an-OFX-plugin-returns-kOfxStatOK-following-an-aborted-render ／ https://community.topazlabs.com/t/blackmagic-fusion-studio-standalone-will-not-launch-if-the-ofx-plugin-has-been-installed/78672

### A-4. Rust から OFX ホストを作る例・バインディング

| crate | 内容 | 状態 | 出典 |
|---|---|---|---|
| `openfx`（kreantio/openfx-rs） | 公式ヘッダから生成した**抽象度の異なる複数層**のバインディング。BSD-3。Rust 1.100.0 が必要、例のビルドは nightly | 初版 2026-08-14、0.10.0（2026-11-22）。上流の**未マージ PR** のデータに固定 | crates.io API ／ https://github.com/kreantio/openfx-rs |
| `ohk`（OpenFX Host Kit・同上） | ホスト作成用の枠組み | **「まだ使えない」**＝できるのはライブラリ内のプラグイン一覧だけ。x86_64 Linux のみ表示 | https://docs.rs/crate/ohk/latest |
| `opk`（同上） | プラグイン作成用 | 0.10.0（2026-11-23） | crates.io API |
| `openfx-sys` 0.1.0 | bindgen による生バインディング。**C++ の HostSupport を同梱** | 2023-02 以降更新なし | https://docs.rs/crate/openfx-sys/latest |
| `ofx` / `ofx_sys`（itadinanta/ofx-rs） | OFX 1.4。**プラグイン作成側**向け | 2019 年に「本番未対応」。2026-11-21 に 0.4.0 が出ている（中身の変化は未確認） | https://www.github.com/itadinanta/ofx-rs ／ https://lib.rs/crates/ofx |
| `quercus-ofx-plugin` | 上表のとおり（実ホスト・内部用） | 不安定 | https://docs.rs/crate/quercus-ofx-plugin/latest |

**判断**：**そのまま使える成熟した Rust 製 OFX ホストは無い**。現実的な道は (a) `openfx-sys` 相当（bindgen）で C ABI を叩き、ホスト側ロジック（プロパティ集合・RoI・clip preferences）を Rust で書く、(b) 公式 HostSupport（C++）を小さな C ラッパ越しに使う、のどちらか。OFX の C ABI は「関数表＋文字列キーのプロパティ」なので Rust から直接書くこと自体は難しくないが、**プロパティとアクションの数が多い**のが手間の本体。

### A-5. 別プロセスで動かす（クラッシュ隔離）と GPU メモリ共有

- **OFX 規格に別プロセス実行の定めは無い**。プラグインは共有ライブラリで、同じプロセスに読み込むのが前提（見つかった資料の範囲）。
  出典：https://openfx.readthedocs.io/en/main/Reference/ofxCoreAPI.html
- 実例：
  - **Quercus**：インタラクトは本体、描画は作業用プロセス（上記）。
  - **Shotcut**：隔離はせず、起動直後に落ちたら**安全モード**で外部プラグインを切る（上記）。
  - 参考（OFX ではない）：Apple **FxPlug 4** はプラグインを**別プロセス（XPC）**で動かす。
    出典：https://developer.apple.com/documentation/professional-video-applications/using-out-of-process-fxplug-plug-ins.md
  - 参考（音声）：DAW では「インスタンスごと／全部で1つ」の隔離方式の比較や、Ardour の「遅延の代償が大きい」という反対意見がある。
    出典：https://ardour.org/plugins-in-process.html
- **OFX を別プロセスにする場合の難所（判断を含む）**：
  - プラグインは描画中に**ホストへ呼び返す**（パラメータ値・別時刻の画像・進捗・中断確認）。別プロセスでは**呼び返しごとにプロセス間通信**が要る（同期 RPC）。
  - 画像は**共有メモリ**で渡すのが前提になる（CPU 経路なら Windows の名前付き共有メモリで可能）。
  - GPU 経路はさらに難しい：プロセスをまたぐには OS ハンドル（Windows の NT ハンドル）で GPU メモリを書き出す必要がある。
- **wgpu と OFX の GPU 経路のずれ**：
  - wgpu の Windows 既定は DX12/Vulkan、OFX の GPU は OpenGL/CUDA/OpenCL。**同じメモリを見せるには相互運用が要る**。
  - wgpu には `Device::as_hal`・`create_texture_from_hal`・`create_buffer_from_hal`（すべて unsafe）があり、生の Vulkan/DX12 資源との出入りは可能（wgpu 30.0.2）。
    出典：https://docs.rs/wgpu/latest/wgpu/struct.Device.html
  - **CUDA**：CUDA の「外部資源の相互運用」は Vulkan のメモリと同期オブジェクトを OS ハンドル越しに取り込める。wgpu 向けの第三者 crate `wgpu-cuda-interop`（0.9.0・2026-02・wgpu 25 依存・Windows MSVC 対応）がある。
    出典：https://docs.nvidia.com/cuda/archive/13.4.1/cuda-programming-guide/04-special-topics/graphics-interop.html ／ https://docs.rs/crate/wgpu-cuda-interop/0.9.0
  - **OpenGL**：`GL_EXT_memory_object_win32` で Vulkan/D3D のメモリを取り込める。ただし **Intel のドライバは D3D11/12 との相互運用を実装していない**という報告があり（Vulkan の opaque ハンドル経由は動いたとの報告）、**ベンダー差が大きい**。
    出典：https://skia.googlesource.com/external/github.com/KhronosGroup/OpenGL-Registry/+/master/extensions/EXT/EXT_external_objects_win32.txt ／ https://community.intel.com/t5/Developing-Games-on-Intel/ImportMemoryWin32HandleEXT-unsupported/m-p/1697679
  - **判断**：本人の PC 1台に限るなら「NVIDIA なら CUDA 経路」と GPU を固定できるのが個人用の強み。とはいえ **OFX の GPU 経路は最後に回し、まず CPU 経路（GPU→CPU へ読み戻し→プラグイン→GPU へ上げ直し）で動かす**のが安全。4K・float の読み戻しは重いので、GPU 経路は「使いたいプラグインが GPU 専用だった」ときに初めて着手する。

---

## B. After Effects プラグイン（AE SDK）

### B-1. 規約上・技術上

- **Adobe の方針（SDK ガイド）**：「Adobe は Adobe 互換の第三者ホストを作ることを**支持も推奨もしない**。プラグイン API 仕様から逆算して部分的に動くホストは作れるかもしれないが、推奨せず支援もしない」。
  出典：https://github.com/docsforadobe/after-effects-plugin-guide/blob/master/docs/ppro/other-hosts.md
  （同ガイドは「SmartFX が AE API と他ホストの距離を広げた」とも書く。）
- **第三者ホストの実態（同ガイド）**：プラグインは `PF_InData->appl_id` でホストを見分ける（AE は `'FXTC'`、Premiere は `'PrMr'`）。「この文書の時点で、**SmartFX と AEGP 関数に対応する第三者ホストは無い**」。
  出典：https://github.com/docsforadobe/after-effects-plugin-guide/blob/master/docs/intro/third-party-plug-in-hosts.md
  ⚠️ このガイドは有志が整備するもの（docsforadobe）。上の方針文は Adobe の SDK 文書由来の引用として載っている。
- **SDK の利用規約（Adobe Developer Terms・2024-06-18 版）**：
  - 「Developer Tools」＝**他の Adobe ソフトにアクセス・相互運用・機能追加する目的で**提供されるもの（SDK ファイル・ヘッダ等を含む）。§2.23
  - 「Developer Software」＝**Adobe ソフト/サービスにアクセス・相互運用・機能追加することを意図した**ソフト。§2.22
  - 許諾は「**あなたの Developer Software の開発と試験のために** Developer Tools を使う」こと。§4.1(A)
  - **改変・移植・逆アセンブル等の禁止**（相互運用目的の逆コンパイルは、法が認める場合でも**先に Adobe に情報を求める**こと）。§6.1
  出典：https://wwwimages2.adobe.com/content/dam/cc/en/legal/servicetou/Developer-Terms-en_US-20240618.pdf
  ⚠️ **これが AE SDK に今適用される最新版かは未確認**（AE SDK の配布ページを取得できなかった）。AE 27.0 SDK は 2026-11-12 に公開。
  出典：https://community.adobe.com/announcements-527/after-effects-27-0-sdk-now-available-1655781
- **判断（法的助言ではない）**：AE SDK のヘッダを使って「AE プラグインを読み込む別製品のホスト」を作るのは、許諾の目的（Adobe ソフトとの相互運用）から外れる読み方が自然。ヘッダを使わず逆算で作るのは §6.1 と衝突しうる。**個人用でも規約上のリスクは残る**ので、採るなら法務的な確認が先。
- **技術上**：AE の効果プラグインは `PF_Cmd_*` セレクタを受ける1つの入口関数＋PiPL リソース（Windows では `.aex`＝DLL）。基本の効果 API は読み込み自体は可能でも、**SmartFX（32bit float・RoI）・AEGP（AE 本体の機能の呼び出し）・GPU（AE 独自）**に依存するプラグインが多く、互換の手間が大きい（依存の割合は**未確認**）。
  出典：https://github.com/docsforadobe/after-effects-plugin-guide/blob/master/docs/effect-basics/entry-point.rst ／ https://ae-plugin-sdk-guide.readthedocs.io/intro/pipl-resources.html
- **OSS の AE プラグイン用ホスト**：見つからず（**未確認**）。Rust の `after-effects` crate はプラグインを**作る側**。
  出典：https://github.com/virtualritz/after-effects

### B-2. AE プラグインを読めたサードパーティ製ホストの例

| ホスト | 実態 | 出典 |
|---|---|---|
| **HitFilm Pro 14**（2019-11） | **6本だけ**対応：Video Copilot の Element 3D・Saber・Orb・Optical Flares・Heat Distortion、Red Giant の Trapcode Particular。マニュアルは「**他の AE プラグインは非対応**」「AE を先に入れるのが簡単（体験版でよい）」。Particular は AE を先に入れる必要 | 6本の一覧：https://www.provideocoalition.com/hitfilm-pro-14-launched-with-support-for-select-after-effects-plugins/ ／ 「他は非対応」「AE を先に入れる」：HitFilm 14 マニュアル（検索結果の要約経由。該当ページの URL は特定できず＝**一次確認は未完**） |
| HitFilm（その後） | 2021.3（2021-12-09）の告知で **AE プラグイン対応を次版で削除**と記載（検索結果の要約経由。版履歴ページは人間確認で直接は読めず＝**一次確認は未完**）。HitFilm 自体が 2025-02 に終了 | https://videohelp.com/software/HitFilm/version-history ／ https://cgchannel.com/2025/02/artlist-discontinues-the-fxhome-apps-hitfilm-and-imerge-dead |
| **Fusion（旧 eyeon）** | Fusion 5.3 頃は AE プラグインを特定フォルダに入れて使う方法があった。Fusion 7 で 64bit 化した際、「AE プラグインの多くは 32bit なので今後 AE プラグイン群はサポートしない」と開発側が発言（2015-02 のフォーラム。**スレッドを直接開けず、検索結果の要約経由＝未確認扱い**） | https://forum.blackmagicdesign.com/（該当スレッドは特定できず） |
| **VEGAS** | OFX ホストとして知られる。**AE プラグインを読めるという資料は見つからず（未確認）** | https://support.borisfx.com/hc/en-us/articles/31487776372621-What-host-applications-support-Continuum |
| Premiere Pro | Adobe 製なので別枠（AE プラグインの一部を実行。レイヤ選択を含む効果は不可、等の差がある） | https://www.manula.com/manuals/fxhome/hitfilm/9/en/topic/hitfilm-plugins |

**判断**：過去の例はどれも「**人気プラグインを数本だけ個別に通す**」形で、しかも続かなかった。汎用の AE プラグインホストを個人で作るのは、規約と互換の両面で割に合わない。

### B-3. AE 専用の人気プラグインを使いたい場合の現実的な道

- **AE を外部で動かす連携**（AE のライセンスが必要）：
  - **aerender**：AE と同じフォルダにあるコマンドライン描画器。`-project`（.aep）・`-comp`・`-output`・`-s`/`-e`（フレーム範囲）・`-mem_usage`・`-reuse`（起動中の AE に描かせる）等。レンダーファーム用途も公式に案内。
    出典：https://helpx.adobe.com/en/after-effects/using/automated-rendering-network-rendering.html
  - **スクリプト（ExtendScript）**：`AfterFX -r script.jsx` でスクリプトを実行し、プロジェクトを開いて操作できる。Windows では `AfterFX.com` でコンソール出力が取れる。
    出典：https://github.com/docsforadobe/after-effects-plugin-guide/blob/master/docs/intro/other-integration-possibilities.md
  - **判断**：自作ソフト側から「素材を書き出す → 雛形の .aep を ExtendScript で差し替え → aerender で連番（透過付き）に描く → 自作ソフトへ取り込む」という**焼き込み連携**は技術的に可能。リアルタイムのプレビューには使えない。**aerender をどのライセンス条件で動かせるか（描画専用機の扱い等）は未確認**＝本人の PC で本人の AE ライセンスを使う範囲に留めるのが無難。
- **同じ作者の OFX 版を使う**：Boris FX・Red Giant 等は AE 版と OFX 版を並行して出している製品がある（製品ごとの状況は別調査）。

---

## C. その他の形式の比較

| 形式 | 中身 | 自作ホストで扱えるか | 表現力・制約 | 出典 |
|---|---|---|---|---|
| **Frei0r** | 最小限の C API（`.dll` を読む）。種類は filter / source / mixer2 / mixer3。パラメータは bool・double・color・position・string の5種。色形式は BGRA8888 / RGBA8888 / PACKED32（**8bit のみ**）。`f0r_update(instance, time, inframe, outframe)` | **容易**（関数十数個）。FFmpeg・MLT・GStreamer が対応 | **CPU のみ・8bit・前後フレーム参照なし・UI/オーバーレイなし**。1インスタンスは1スレッド（規約上） | ヘッダ（API 1.2）https://github.com/dyne/frei0r/blob/master/include/frei0r.h ／ リポジトリ（GPL-2.0、最新 v3.7.1 2026-11-12）https://github.com/dyne/frei0r |
| **FFmpeg フィルタ（libavfilter）** | FFmpeg 内蔵のフィルタ群 | **実行時に外部フィルタを読む仕組みが無い**（追加は FFmpeg を作り直す）。2025-03 に「ツリー外フィルタをビルド時に取り込む」試作パッチが出たが**マージは未確認**。ただし frei0r 等の**包むフィルタ**は実行時に読む | 書き出し時の加工（色変換・ノイズ除去等）には有用だが、**wgpu のプレビューと同じ絵にするには FFmpeg 側でも描く必要**＝描画核が2つになる | https://ffmpeg.org/pipermail/ffmpeg-devel/2025-March/341334.html ／ https://lists.ffmpeg.org/pipermail/ffmpeg-devel/2012-October/132040.html |
| **DCTL（Resolve）** | C 風の言語。`transform()`（画素ごと、または RGB 各面のテクスチャを `_tex2D` で任意位置参照）か `transition()`。UI は `DEFINE_UI_PARAMS`（スライダ・チェック・選択肢等）。CUDA/OpenCL/Metal で動く | **Resolve 専用**。他ホストで実行する公式の仕組みは**見つからず（未確認）** | 1枚の画像内の処理のみ（**別フレーム参照の記述なし**）。色補正・画素処理向き | https://github.com/CommandPost/ResolveCafe/blob/main/docs/developers/dctl.md（2025-05 アーカイブ済みの有志資料） |
| **Fusion Fuse** | Lua スクリプトのプラグイン（コンパイラ不要・その場で再読込）。Fusion の既存ノードと GPU を利用 | **Fusion/Resolve の API に依存**＝自作ホストでは不可 | OFX より遅いことがある（マニュアル記載） | https://documents.blackmagicdesign.com/UserManuals/Fusion_Fuse_SDK.pdf |
| （参考）**ISF**（Interactive Shader Format） | GLSL フラグメントシェーダ＋先頭の JSON（入力・複数パス・**持続バッファ**＝前フレームの結果を保持） | **形式は公開・単純**。Rust の `isf` crate（パーサ）あり。ただし GLSL（OpenGL 流）で、wgpu の naga の GLSL 入力は「440 以上・Vulkan 流」に限られる＝**変換が要る（そのまま通るかは未確認）** | 生成・フィルタ・トランジションを GPU で。持続バッファでフィードバック系も可。CPU 処理や外部ライブラリは不可 | https://www.github.com/mrRay/ISF_Spec ／ https://docs.isf.video/ref_multipass ／ https://docs.rs/crate/naga/latest |

**判断**：DCTL・Fuse・AE は**特定ホストの言語/API**で、自作ホストでの実行は現実的でない。DCTL は「画素ごとの関数＋スライダ」という形が WGSL のコンピュート/フラグメントにほぼ対応するので、**手で移植する**のは容易（自動変換の既存ツールは未確認）。

---

## D. 推奨（自作ホストでの対応順）

> 以下は上の事実にもとづく**判断**。

1. **自前のシェーダ形式（WGSL＋パラメータ定義）を最初に**
   - 根拠：描画は wgpu なので、**プレビューと書き出しが同じ描画核**のまま拡張できる。GPU 間の相互運用もプロセス境界も不要。
   - 形は ISF を手本にする（入力・パラメータ・複数パス・持続バッファ）。ISF の資産を使いたければ GLSL→WGSL の変換を挟む（naga の GLSL 入力は制約あり＝要検証）。
   - DCTL や Shadertoy 系の効果は**手で移植**する先にもなる。
2. **OFX の CPU 経路・最小構成**
   - 根拠：OFX は BSD-3 の公開規格で、**第三者ホストを正式に想定**している（Natron・MLT・Shotcut が実在）。一方 AE は Adobe が第三者ホストを「支持も推奨もしない」。
   - 範囲は MLT の初版と同程度に絞る：filter 文脈・1入力・基本パラメータ（実数・整数・色・真偽・選択肢）・**ホストのキーフレーム**・フレーム単位で直列（HostFrameThreading=0）・オーバーレイなし。
   - 実装は Rust から C ABI を直接（bindgen）か、HostSupport（C++）を薄く包む。成熟した Rust 製ホストは無い（`ohk` は「まだ使えない」）。
   - 確認用プラグイン：公式 `Examples`（Basic・Invert・Test 等）と、Natron の openfx-misc 等の OSS 群（ライセンスはプラグインごとに確認）。
   - **最初からクラッシュ対策の枠を作る**：少なくとも Shotcut 式の「落ちたら次回は外部プラグインを止める」。余力があれば Quercus 式の**描画だけ別プロセス**（CPU 経路なら共有メモリで画像を渡せる）。
3. **OFX の拡張を、使いたいプラグインに合わせて足す**
   - 順の目安：**時間をまたぐ取得**（ノイズ除去・モーションブラー系に必須。MLT・Shotcut とも未対応＝差がつく所）→ 複数入力・ジェネレータ・トランジション → **Draw Suite によるオーバーレイ**（OpenGL 不要＝wgpu と相性がよい）→ タイル/並列 → マルチ解像度。
   - V1（OpenGL）のオーバーレイしか無いプラグインは後回し（GL 文脈を wgpu の横に立てる必要がある）。
4. **OFX の GPU 経路（必要になったら）**
   - 根拠：仕様に Vulkan/DX12 が無く、wgpu の資源を OpenGL/CUDA へ見せる相互運用が要る。ドライバ差も大きい。
   - 本人の PC が NVIDIA なら **CUDA 経路（Vulkan 外部メモリ→CUDA）**を優先し、OpenGL 経路はその次。別プロセス化と組み合わせるとさらに難しい。
5. **Frei0r（任意・安い）**
   - API が小さく半日〜数日で載る見込み（判断）。ただし 8bit・CPU・前後参照なしで、MV の質感づくりには力不足。OSS 効果の数を増やしたいときだけ。
6. **AE プラグインのホスト化はしない**
   - 規約（第三者ホスト非推奨・SDK の目的外・逆算の禁止）と互換（SmartFX・AEGP を持つ第三者ホストは無い。HitFilm も6本だけで撤退）の両面で割に合わない。
   - どうしても使いたい AE 専用プラグインは、**AE＋aerender で素材として焼き込み、自作ソフトへ取り込む**外部連携で扱う（本人の AE ライセンスの範囲で）。
7. **FFmpeg フィルタは「プラグイン形式」として扱わない**
   - 実行時の外部読み込みが無く、プレビュー（wgpu）と書き出しで描画核が割れる。使うなら書き出しの最後の変換（色空間・エンコード前処理）に限る。

### 未確認として残したもの

- OFX の ASWF での現在の段階（Incubation のままか）
- OFX 1.6 の具体的な時期
- 「未実装スイートで NULL を受けて落ちる」商用プラグインの具体例
- Kdenlive の OFX 対応がリリース済みか／Olive の OFX 対応
- AE SDK に現在適用される規約が 2024-06-18 版の Developer Terms か
- HitFilm の AE 対応削除の一次資料、Fusion 7 での AE 対応終了発言の一次資料
- aerender の利用条件（描画専用機の扱い等）
- ISF の GLSL が naga でそのまま通るか
- DCTL を他ホストで実行・自動変換する既存ツールの有無
