# すたりおMV（γ）プラグイン調査：主要エフェクトプラグインの形式と自作 OFX ホストで動く見込み

- 調査日：2026-11-25（Web 検索・各社ページの取得による。記憶で埋めていない）
- 前提：使うのは開発者本人1人・自宅の上位 Windows PC。外部エフェクトの読み込み形式は OpenFX（OFX）が第一候補
- 凡例
  - **公式**＝ベンダー自身のページに書いてある
  - **販売店/報道**＝ToolFarm・B&H・CG Channel 等の第三者。日付が古いものがある
  - **未確認**＝今回の調査で根拠が見つからなかった（推測では埋めていない）
  - **推論**＝根拠をもとにした筆者の判断（事実ではない）
- ⚠️ 一部のベンダーサイト（Boris FX と Maxon のサポートセンター〔Zendesk〕、aescripts、Neat Video）は自動取得を拒否した（403/418）。その場合は検索結果の要約から拾っており、出典 URL は**検索で出た元ページ**を書いている。買う前に本人がブラウザで確かめること

---

## 0. 結論の先出し（要約）

1. **自作 OFX ホストで動く見込みが高いのは、ベンダーが Natron（非主流のオープンソース OFX ホスト）での動作を公式に書いているもの**＝**RE:Vision Effects（Twixtor・RSMB）**、**Neat Video（OFX 版）**、**Boris FX Sapphire（「as is」＝保証なし）**、それと**無料の openfx-misc / openfx-arena / openfx-io / G'MIC OFX / Gyroflow OFX**。
2. **見込みが中くらい（動くかもしれないが、ベンダーは主要ホストしか見ていない）**＝Boris FX Continuum・Mocha Pro・Particle Illusion（OFX）、FilmConvert Nitrate、Dehancer。
3. **見込みが低い**＝Maxon（Red Giant）Universe・Magic Bullet（OFX 版はあるが**公式ホストは Resolve 等に限られ**、Resolve でも読み込み時の不具合報告が多い）。
4. **OFX 版がそもそも無い（After Effects 専用）**＝Video Copilot（Element 3D・Optical Flares・Saber・Twitch）、aescripts 系（Deep Glow 2・Plexus 3）、Trapcode Particular / Form（Resolve 対応の根拠は見つからず＝未確認）。**MV・モーショングラフィックスで「定番」と言われるものの多くがここに入る**。
5. 自作ホストの実装の指針（推論）：**Natron が読めるものは読める**を目標に、OFX 1.4 の主要スイート＋**マルチスレッド**＋**オーバーレイ（画面上の操作）**まで実装すると、上の「高い」群はほぼ射程に入る。GPU で速く回すには **OFX 1.5 の GPU 描画スイート（CUDA / OpenCL / Metal）**を実装する必要がある。

---

## 1. Boris FX

| 製品 | 1. 提供形式・Windows | 2. OFX の公式対応ホスト | 3. ライセンスとホストの縛り／非主流ホスト | 4. GPU | 5. 価格帯・定番度 |
|---|---|---|---|---|---|
| **Sapphire** | AE / Premiere / Photoshop / Avid / **OFX**。Windows 可 [S1] | Flame・Nuke・Resolve・VEGAS Pro・Fusion Studio（すべて OFX）＋「その他の OFX 対応アプリ」[S1][S2] | ライセンスは**ホストの系統で分かれる**：Cross-host（Adobe＋OFX）／＋Avid／＋Flame の段階。**Flame は最上位だけ**[S3]。⚠️ ベンダー FAQ は「他の OFX ホストでも動くが **as is**（機能を保証できない）」とし、**Natron もその列挙に入る**（検索要約）[S4]。Natron の README も対応商用プラグインに Sapphire を挙げる [S5] | Windows：NVIDIA **CUDA**・AMD **HIP**、macOS：**Metal**、Linux：CUDA。GPU で描けない効果は CPU に落ちる。OpenCL の記載なし [S6] | 年額 $545（Adobe/OFX の単一系統）・複数系統 $985（2025-11 報道）[S7]。放送・MV の定番（GenArts の後継＝下記） |
| **Continuum（BCC）** | AE / Premiere / Avid / **OFX** [S8] | Resolve（Fusion ページ含む）・Nuke・VEGAS Pro。「他の OFX ホストでも動くかもしれないが、検査・認定しているのは上のみ」（検索要約）[S8] | 個別ホスト版と複数ホスト版あり（OFX 版が単体で売られている）[S9]。非主流ホストでの公式報告は**未確認** | **未確認** | 年額 $695・永続 $1995（2023 年の記事＝古い）[S10]。トランジション・タイトル類の定番 |
| **Mocha Pro** | 単体アプリ＋AE / Premiere / Avid / **OFX** プラグイン [S11] | Flame・Nuke・Fusion（OFX）。販売店にある対応表では Resolve 18.x・VEGAS Pro 21/22 も（Resolve は Fusion/Color ページ推奨）[S11][S12] | **個別ホスト**（OFX を選ぶと Nuke・Fusion・VEGAS Pro）／**複数ホスト**／**単体アプリ（複数ホストのプラグイン権利つき）**[S13]。旧版の注記に「他の OFX ホストでも動くかもしれないが**非公式**」[S12] | **未確認** | 価格は 2016 年の $695（OFX）/$995（複数）しか見つからず＝**未確認**[S13]。追跡・平面トラッキングの定番（MV では「必須」ではない） |
| **Optics** | Photoshop / Lightroom、2026.5 で Apple Photos・Capture One・Affinity Photo を追加＝**写真用** [S14] | **OFX 版の根拠なし（未確認）** | ― | 未確認 | 写真用途。動画編集ソフトの外部エフェクトとしては対象外 |
| **Particle Illusion** | **無料の単体アプリ**（非商用・個人用のみ）＋**有料プラグイン（Adobe・Resolve・Avid・その他 OFX）**[S15] | OFX 版の存在は公式文書あり（「particleIllusion for OFX」）[S16]。旧 Continuum の対応は Resolve・Nuke・VEGAS Pro [S16] | プラグインは Continuum に含まれる／単体の複数ホスト版あり [S15]。非主流ホストは**未確認** | 「GPU ベースのリアルタイム粒子」（無料化の発表）[S15]。方式は未確認 | 複数ホスト $95/年・$295 永続（日付不明の掲載）[S15]。⚠️ 無料版は**単体アプリ**であって OFX ではない |

**GenArts の後継**：Sapphire はもと GenArts の製品で、Wikipedia の OFX 一覧でも「Sapphire Visual Effects and Monsters GT VFX（GenArts）」と載っている [S17]。現在の後継は Boris FX の Sapphire（上の行）。

---

## 2. Maxon（Red Giant）

| 製品 | 1. 提供形式・Windows | 2. OFX の公式対応ホスト | 3. ライセンスとホストの縛り／非主流ホスト | 4. GPU | 5. 価格帯・定番度 |
|---|---|---|---|---|---|
| **Universe** | AE / Premiere / Final Cut Pro / Motion / VEGAS Pro / **Resolve（OFX）** / Avid の7ホスト [S18] | **Resolve**（Universe 2025.3 の注記で Resolve 18・19「全ツール」）[S19]。2026.0 で Resolve・Fusion 向けに画面上の位置操作を追加 [S20]。Autograph も対応 [S21] | **Red Giant 定額（または Maxon One）**。Nuke・Natron は公式ホスト一覧に**無い** [S22]。⚠️ Resolve／Fusion でも「大量の Universe プラグインの読み込みで起動時に落ちる」「一部プラグインは Resolve で動かない（サポート談）」の利用者報告 [S23]。⚠️ Red Giant 2025.4 で **VEGAS Pro の対応を終了**との報道 [S20]（Universe の一覧には VEGAS が残る＝食い違い・未確認） | Windows：NVIDIA は Maxwell 以降・VRAM 4GB、Intel/AMD は**OpenCL** 対応の独立 GPU・4GB。**VM と複数 GPU は Universe では非対応**。ライセンス確認にネット接続が要る [S22][S24] | Red Giant Complete 年額 約 $1,091（販売店・通貨表記なし）[S25]／Maxon One 更新 $1,199/年（Maxon FAQ・日付不明）[S25]。トランジション・グリッチ等で人気 |
| **Trapcode Suite（Particular・Form・Shine 等）** | AE（一部 Premiere）[S26] | **Particular・Form の Resolve 対応の根拠は見つからず（未確認）**。CG Channel は「Autograph で使える OFX 版から**粒子系（Particular・Form）は除外**」と書く [S27]。Shine・StarGlow は 2025.6 で Resolve 対応と報道 [S20] | 定額。OFX ホスト全般での動作は**未確認** | Particular は OpenGL による GPU 加速（2017 年の発表）[S28]。現行の要件は上の Universe と同じ表（CUDA 世代/OpenCL）[S24] | 定額に含まれる。**Particular は「最も人気の粒子エンジン」**と評される MV・モーショングラフィックスの定番 [S29] |
| **Magic Bullet Suite（Looks・Colorista・Mojo 等）** | AE / Premiere / Resolve / Final Cut Pro / Unreal / Autograph / Cinema 4D（Looks）[S30] | **Resolve**（Looks・Film・Cosmo・Mojo は 2015 年から Resolve 対応）[S30]。Red Giant 要件では Resolve で Looks・Cosmo・Mojo・Film・Renoiser [S19] | 定額。Colorista の Resolve 対応は**未確認** [S30]。非主流ホストは**未確認** | 未確認（Red Giant 共通要件は上） | 色調整の定番（Looks） |
| **VFX Suite（Real Lens Flares・Optical Glow 等）** | AE 中心 | Real Lens Flares・Optical Glow は 2025.4 で Resolve 対応 [S19] | 定額 | 「Universe と VFX は GPU 必須」との利用者報告 [S23] | 定額に含まれる |

---

## 3. Video Copilot／aescripts 系

| 製品 | 1. 提供形式・Windows | 2. OFX | 3. ライセンス | 4. GPU | 5. 価格帯・定番度 |
|---|---|---|---|---|---|
| **Element 3D** | **After Effects プラグイン** [S31]。Windows 可 | **無し**（AE 以外のホストの記載なし）[S31] | ― | **OpenGL**（レイトレースではない）。Adobe も「AE とは独立に GPU を使う」と注記 [S32] | 価格は未確認（公式ページの価格表示がどれに当たるか判別できず）[S31]。3D タイトルの定番 |
| **Optical Flares** | **After Effects CS5 以降のみ**。Mac/PC [S33] | **無し** [S33] | ― | GPU は任意 [S33] | $124.95 [S33]。レンズフレアの定番 |
| **Saber（無料）** | **After Effects**。Windows/Mac・64bit のみ [S34] | **無し**。Resolve で出てこないという利用者の書き込みあり [S34] | 無料（商用可否の公式回答はページ上に無い）[S34] | 未確認 | 無料。光線・ネオン表現の定番 [S35] |
| **Twitch** | **After Effects**（公式の対応表記は AE 7〜CC と古い）[S36] | **無し** | ― | 未確認 | $45 [S36]。グリッチ/ランダム揺れ |
| **Deep Glow 2（aescripts）** | **After Effects**。Premiere は「土台の仕組みが Premiere に無い」とスタッフ回答（古い）[S37] | **無し**（Resolve 版は第三者の別物「VG Deep Glow」＝無料）[S38] | aescripts のライセンス | 未確認 | $99.95（V1 は $49.95）[S37]。発光の定番 |
| **Plexus 3（Rowbyte／aescripts）** | **After Effects** [S39] | **無し**（AE 以外の記載なし） | 通常ライセンス＋描画専用ライセンス（コマンドライン描画機用）[S39] | 未確認 | 価格は情報が食い違い未確認（2016 年発売時 $249）[S39]。線と点の定番 [S40] |

---

## 4. RE:Vision Effects

| 製品 | 1. 提供形式・Windows | 2. OFX の公式対応ホスト | 3. ライセンスとホストの縛り／非主流ホスト | 4. GPU | 5. 価格帯・定番度 |
|---|---|---|---|---|---|
| **Twixtor** | AE / Premiere / FCP / Motion / Media Composer / **OFX** 多数。Windows・Linux・macOS [S41][S42] | 公式の対応アプリ一覧に Autograph・Baselight・Catalyst Edit・Diamant/Dustbuster+・Flame・Fusion Studio・Rio・HitFilm・Livegrade・Mistika・**Natron**・Nucoda・Nuke・Resolve・Scratch・Silhouette・Toon Boom Harmony・Vegas Pro [S41] | **Regular と Pro で対応ホストが分かれる**：Regular の OFX ホスト＝Catalyst Edit・Resolve・HitFilm・Movie Studio・**Natron**・Vegas Pro 等、Pro＝それに加え Baselight・Flame・Fusion Studio・Nucoda・Nuke・Scratch・Silhouette。**Pro は Regular 側のホストでも使える**（販売店まとめ）[S43]。⚠️ **Natron を公式に挙げている**＝非主流ホスト配慮が最も厚いベンダー | 公式ページに記載なし（未確認）[S41] | Regular $329.95・Pro $595（2024 報道）[S42]／単体アプリ版 $149.95（2025）[S43]。スローモーションの定番 |
| **ReelSmart Motion Blur（RSMB）** | Twixtor と同じホスト群 [S44] | Twixtor と同じ一覧（**Natron** 含む）[S44] | Regular / Pro 構成（Twixtor と同様）[S44][S45] | 未確認 | 価格未確認。モーションブラー後付けの定番 |

---

## 5. 色・ノイズ系

| 製品 | 1. 提供形式・Windows | 2. OFX の公式対応ホスト | 3. ライセンスとホストの縛り／非主流ホスト | 4. GPU | 5. 価格帯・定番度 |
|---|---|---|---|---|---|
| **Neat Video** | Premiere/AE・FCP/Motion・VEGAS・**Resolve 専用版**・**OFX 版**（Win/macOS/Linux）[S46][S47] | OFX 版の対応：Nuke 5.1〜16・Mistika・**Natron 2.0.5+**・Silhouette・DustBuster など [S47]。Resolve には**専用版**があり、OFX 版を Resolve で使う案内もある [S47] | **ホスト系統ごとに別製品**（Adobe 版と OFX 版は別、とレビュー記事）[S48]。Home（非商用）／Pro（商用）[S48]。⚠️ **Natron を公式対応に挙げる** | 「GPU 加速」（方式の記載は未確認）[S46] | Home $79.90・Pro $144.90〜149.90（ページで食い違い）[S48]。ノイズ除去の事実上の標準 |
| **FilmConvert Nitrate** | Resolve（OFX）・Adobe・FCP 等 [S49] | **Resolve のみ「完全対応」**（公式 OFX ページの要約）[S49]。VEGAS では読み込めない／画面上の操作が使えないとの利用者報告（2020）[S50] | ホストごとのライセンスか全ホスト共通かは**未確認**（2020 年に全ホスト束 $199 の記述あり）[S49] | 未確認 | フィルム調の定番 |
| **Dehancer** | Resolve（OFX）・VEGAS Pro（OFX）・Baselight・FCP・Adobe・写真アプリ [S51] | Resolve 17 以降・VEGAS Pro 2026 以降・Baselight [S51] | ⚠️ **ライセンスキーはホストごと**（Resolve 用キーで FCP・Adobe 版は有効化できない）[S52]。非主流ホストは**未確認**。VEGAS は「GPU メモリに直接触れないので遅い」と公式 [S51] | Windows：NVIDIA **CUDA**・AMD **OpenCL**、Mac：**Metal** [S52] | Resolve Pro 年額 $299（3台）等 [S52]。フィルム調の人気どころ |

---

## 6. 無料の OFX

| 製品 | 1. 形式 | 2. 対応ホスト | 3. ライセンス | 4. GPU | 5. 備考 |
|---|---|---|---|---|---|
| **openfx-misc**（Natron 同梱） | OFX | Natron 向けに開発・「他の OFX ホストでも使える」と自称 [S53]。⚠️ VEGAS では落ちたとの報告 [S54] | **GPL**（Natron 2.0 以降の同梱物は GPLv2 互換が前提）[S53] | 主に CPU（推論。GPU の記載は未確認） | フィルタ・幾何変換・色変換などの基本的な合成部品 [S17] |
| **openfx-arena**（Natron 同梱） | OFX | Natron [S55] | **GPLv2 以降**（一部 LGPL）[S55] | 未確認 | テキスト・SVG/PDF 読み込み等 [S55] |
| **openfx-io**（Natron 同梱） | OFX（読み書き） | Natron | ライセンスは今回の検索で**未確認** [S53] | ― | 画像・動画の読み書き部品。⚠️ 自作ホストでは自前の読み書きと役割が重なる |
| **G'MIC OFX（openfx-gmic）** | OFX＋Adobe | Nuke・Natron 等。Natron 2.5.0 で動いた報告／Resolve はフィルタ数が多すぎて絞る必要・起動時に落ちる報告／VEGAS は**マルチスレッド非対応のため**問題 [S56] | 未確認（G'MIC 本体の条件に従う） | 未確認 | 数百種のフィルタ。**自作ホストの耐久試験に向く**（推論） |
| **Gyroflow OFX** | OFX | Resolve 主眼・VEGAS と Scratch で検査済み・Nuke/Flame/Baselight は未検査 [S57] | ソースは GitHub 公開（ライセンス条文は未確認）[S57] | Windows：OpenGL / OpenCL / CUDA [S57] | 手ぶれ補正（ジャイロ） |
| **Natron 同梱の一式** | ― | Natron の README は同梱物として openfx-io・misc・gmic・arena を、動作する商用として RE:Vision・Boris FX（Sapphire 含む）・Neat Video を挙げる [S5] | ― | ― | **「Natron で動く」の公式寄りの根拠** |

**GPL について（推論・法的助言ではない）**：GPL は主に**配布**の条件。本人1人が自宅で使うだけなら、GPL の OFX を自作ホストに読み込むこと自体が問題になる場面は考えにくい。ただし将来ホストやプラグインを同梱して**配る**なら、改めて確かめること。

---

## 7. 自作 OFX ホストで使える見込みの分類

### 見込み 高

| 製品 | 根拠 |
|---|---|
| **Twixtor／RSMB（RE:Vision）** | 公式の対応アプリ一覧に **Natron** を明記 [S41][S44]。Regular ライセンスの OFX ホストにも Natron が入る [S43]＝**ホスト名で縛らず、標準どおりの OFX ホストで動かす前提**に見える（推論） |
| **Neat Video（OFX 版）** | OFX 版の公式対応に **Natron 2.0.5+** [S47]。Natron README にも記載 [S5] |
| **Sapphire（Boris FX）** | ベンダー FAQ が「他の OFX ホストでも **as is** で動く」とし Natron を列挙（検索要約）[S4]。Natron README にも記載 [S5]。⚠️ 保証は無い |
| **openfx-misc / arena / G'MIC OFX** | Natron 用に作られた・同梱物 [S5][S53]。ソースがあるので、動かなければ**原因を自分で追える** |

### 見込み 中

| 製品 | 根拠 |
|---|---|
| **Continuum・Mocha Pro・Particle Illusion（OFX）** | 同じ Boris FX の OFX 製品。ただし公式は「検査しているのは Resolve・Nuke・VEGAS」「他は非公式」[S8][S12]。Natron で動いた公式報告は**未確認** |
| **Gyroflow OFX** | 「他の OFX ホストでも動くかもしれない（未検査）」と自ら書く [S57]。無料・ソース公開 |
| **FilmConvert Nitrate** | 公式に完全対応なのは Resolve だけ [S49]。VEGAS（古い OFX 実装）で動かなかった報告 [S50]＝**ホスト側の OFX 実装の深さに敏感**（推論） |
| **Dehancer** | Resolve・VEGAS・Baselight と複数の OFX ホストに出しているが、キーはホストごと [S52]。それ以外のホストは**未確認** |

### 見込み 低

| 製品 | 根拠 |
|---|---|
| **Universe・Magic Bullet・VFX Suite（Maxon）** | OFX の公式ホストは Resolve（と Autograph・一時期 VEGAS）だけ。Nuke・Natron は一覧に無い [S22]。Resolve／Fusion ですら読み込み時の不具合報告 [S23]。Natron での報告は**見つからなかった** |
| **Trapcode Particular・Form** | Resolve を含め OFX で動く根拠が無い（未確認）。Autograph の OFX 版からも粒子系は除外と報道 [S27] |

### 対象外（OFX 版が無い＝After Effects 専用）

| 製品 | 根拠 |
|---|---|
| Element 3D | AE プラグインとしてのみ記載 [S31] |
| Optical Flares | AE CS5 以降のみ [S33] |
| Saber（無料） | AE 用。Resolve に出ない報告 [S34] |
| Twitch | AE 用 [S36] |
| Deep Glow 2 | AE 用（Premiere も不可）[S37] |
| Plexus 3 | AE 用 [S39] |
| Trapcode Particular・Form | 上記のとおり OFX 版の根拠なし（未確認だが現状は AE 専用扱い）[S26][S27] |

⚠️ **AE 専用を読みたい場合**：AE プラグイン SDK のホストを自作するのは別の大仕事（OFX とは別の API）。今回は調べていない（未確認）。

---

## 8. 自作ホストの設計への示唆（推論）

1. **試験の物差しは Natron**。「Natron で動く」と公式に言っている製品（RE:Vision・Neat Video・Sapphire）は、Natron と同程度の OFX 1.4 実装で動く見込みが高い。Natron は OFX 1.4 のホスト側を（多くの拡張つきで）実装している [S58]。
2. **マルチスレッド描画**を正しく扱う。G'MIC は「マルチスレッド非対応のホスト（VEGAS）で問題」[S56]、FilmConvert は「古い OFX しか無い VEGAS で動かない」[S50]＝ホストの実装の浅さで落ちる例が実在する。
3. **画面上の操作（オーバーレイ）**の実装が要る製品がある（FilmConvert の例 [S50]、Universe 2026.0 の位置操作 [S20]）。
4. **GPU**：OFX 1.5 の GPU 描画スイートが **CUDA・OpenCL（バッファ/画像）・Metal** に対応し、ASWF は「出荷済み」としている [S59][S60]。ホストがこれを実装しないと、プラグインは CPU 経路に落ちる（Sapphire は GPU 不可なら CPU に落ちると明記 [S6]）。Dehancer は「GPU メモリに直接触れないホスト（VEGAS）では遅い」と公式 [S51]。
5. **読み込み数の多さ**で落ちる例（Universe 128 個・G'MIC のフィルタ多数）[S23][S56]＝プラグイン走査は**遅延・分割・例外の隔離**が要る。
6. **ライセンスの縛り**：Boris FX・Twixtor・Mocha は「OFX 系統」のライセンスを買えばホスト名で分けない構成（Twixtor は Regular/Pro でホスト群が分かれる）[S3][S13][S43]。Dehancer はホストごとのキー [S52]。Maxon は定額。**未対応ホストで起動を拒否するかどうかを明言した公式資料は見つからなかった（未確認）**。体験版で本人の自作ホストに読ませて確かめるのが最も確実（推論）。

---

## 出典

- [S1] Boris FX Sapphire 製品ページ https://borisfx.com/products/sapphire
- [S2] Boris FX サポート「What host applications support Sapphire?」 https://support.borisfx.com/hc/en-us/articles/11031545073677-What-host-applications-support-sapphire （取得拒否のため検索要約）
- [S3] Boris FX「Cross-host Sapphire license matrix」 https://borisfx.com/faq/cross-host-sapphire-license-matrix （検索要約）
- [S4] Boris FX FAQ「My favorite host application supports OFX plug-ins, will Sapphire work?」 https://borisfx.com/faq/sapphire-ofx-faq （リダイレクトのため検索要約）
- [S5] Natron README（RB-2.6） https://cdn.jsdelivr.net/gh/natrongithub/natron@RB-2.6/README.md
- [S6] Boris FX Sapphire OFX General Info https://borisfx.com/documentation/sapphire/ofx/general-info/
- [S7] CG Channel（Sapphire 2026・2025-11） https://www.cgchannel.com/?p=172224 （検索要約）
- [S8] Boris FX サポート「What host applications support Continuum?」 https://support.borisfx.com/hc/en-us/articles/31487776372621-What-host-applications-support-Continuum （検索要約）
- [S9] B&H「Boris FX Continuum 2019 for OFX」 https://www.bhphotovideo.com/c/product/1351543-REG/boris_fx_bccofxsub_continuum_10_ofx.html
- [S10] Boris FX ブログ「Sapphire vs Continuum differences」 https://borisfx.com/blog/boris-fx-sapphire-vs-continuum-differences/ （検索要約）
- [S11] Boris FX Mocha Pro Supported Hosts https://borisfx.com/products/mocha-pro/supported-hosts/ （検索要約）
- [S12] Mocha Pro 対応ホスト表（販売店上の写し） https://blog.imagineersystems.com/products/mocha-pro/supported-hosts （検索要約）
- [S13] Boris FX サポート「What Mocha Pro option should I buy」 https://support.borisfx.com/hc/en-us/articles/10031669770637-What-Mocha-Pro-option-should-I-buy-the-plugin-or-the-standalone-application ／ CG Channel（Mocha Pro 5 for OFX・2016） https://www.cgchannel.com/2016/08/imagineer-systems-ships-mocha-pro-5-for-ofx （検索要約）
- [S14] Digital Production「Optics 2026.5 gets more photo hosts」 https://digitalproduction.com/2026/06/25/optics-2026-5-gets-more-photo-hosts/ （検索要約）
- [S15] Boris FX「Free Particle Illusion standalone」 https://blog.borisfx.com/press/free-particle-illusion-standalone-for-mograph-vfx-and-editorial ／ ProVideo Coalition https://www.provideocoalition.com/boris-fx-releases-particle-illusion-standalone-app-for-free/ （検索要約）
- [S16] Boris FX「particleIllusion for OFX compatible products」 https://borisfx.com/support/documentation/particleillusion-for-ofx-compatible-products/ （検索要約）
- [S17] Wikipedia「OpenFX (API)」 https://en.wikipedia.org/wiki/OpenFX_(API)
- [S18] Maxon Red Giant ヘルプ（Universe プラグイン概要） https://help.maxon.net/rg/en-us/Content/html/plugin-overview.html.md
- [S19] Maxon「Universe 2025.3.0」 https://support.maxon.net/hc/en-us/articles/19718496847388-Universe-2025-3-0-April-2-2025 ／ 「Red Giant 2025.4.0」 https://support.maxon.net/hc/en-us/articles/19718587047196-Red-Giant-2025-4-0-April-2-2025 （検索要約）
- [S20] CG Channel「Maxon releases Red Giant 2026.0 and Universe 2026.0」 https://www.cgchannel.com/2025/09/maxon-releases-red-giant-2026-0-and-universe-2026-0/ ／ CG Channel（2025.4） https://www.cgchannel.com/2025/04/maxon-releases-red-giant-2025-4-and-universe-2025-3/ （検索要約）
- [S21] Maxon 記事「Professional Editing, Mograph and VFX Tools in one Subscription」 https://www.maxon.net/en/article/professional-editing-mograph-and-vfx-tools-in-one-subscription-1 （検索要約）
- [S22] Maxon「Red Giant Requirements」 https://www.maxon.net/requirements/red-giant-requirements （検索要約）
- [S23] Blackmagic フォーラム「FX from RedGiant crashes」 https://forum.blackmagicdesign.com/viewtopic.php?p=363005 ／ Fusion スレッド https://forum.blackmagicdesign.com/viewtopic.php?p=405792 ／ Adobe Community https://community.adobe.com/questions-529/red-giant-universe-freezes-ae-43218 （検索要約）
- [S24] Maxon「Red Giant Compatibility / Minimum Requirements」 https://support.maxon.net/hc/en-us/articles/23987275556764-Red-Giant-Compatibility （取得拒否のため検索要約）
- [S25] Videocraft（Red Giant Complete 年額） https://www.videocraft.com.au/red-giant-complete-annual-subscription-1-year ／ Maxon FAQ https://maxon.net/frequently-asked-questions （検索要約）
- [S26] Adobe Community「I don't have the Trapcode Particular」 https://community.adobe.com/t5/after-effects-discussions/i-don-t-have-the-quot-trapcode-particular-quot/m-p/13821741 ／ Maxon Trapcode ページ https://maxon.net/en/product-detail/red-giant/trapcode （検索要約）
- [S27] CG Channel（Red Giant 2026.x の Autograph 対応記事・検索要約内の記述） https://www.cgchannel.com/2026/07/maxon-releases-red-giant-2026-5/ （取得拒否のため検索要約）
- [S28] No Film School「Red Giant Adds GPU Acceleration…」 https://nofilmschool.com/2017/08/red-giant-adds-gpu-acceleration-trapcode-suite （検索要約）
- [S29] Maxon「Best After Effects plugins 2026」 https://www.maxon.net/en/article/best-after-effects-plugins-2026 ほか（検索要約）
- [S30] Maxon「Cinematic color grading」 https://www.maxon.net/en/solutions/color-grading ／ Maxon「Maintenance Release for Magic Bullet Suite」 https://www.maxon.net/en/article/maintenance-release-for-magic-bullet-suite （検索要約）
- [S31] Video Copilot Element 3D https://www.videocopilot.net/products/element2/
- [S32] Adobe「GPU and GPU driver requirements for After Effects」 https://helpx.adobe.com/after-effects/desktop/get-started/technical-requirements/basics-gpu-after-effects.html ／ Video Copilot ブログ「Built for Speed and GPU's」 https://www.videocopilot.net/blog/2012/07/built-for-speed-and-gpus （検索要約）
- [S33] Video Copilot Optical Flares https://www.videocopilot.net/products/opticalflares/
- [S34] Video Copilot ブログ「Saber now available 100% free」 https://videocopilot.net/blog/2016/03/new-plug-in-saber-now-available-100-free
- [S35] Motion Array「Video Copilot's Free Saber Plugin Review」 https://motionarray.com/learn/post-production/video-copilots-free-saber-plug-in-review/ （検索要約）
- [S36] Video Copilot Twitch https://www.videocopilot.net/products/twitch （検索要約）
- [S37] aescripts Deep Glow https://aescripts.com/deep-glow ／ aescripts フォーラム https://aescripts.com/forums/discussion/1849/deep-glow/p6 （取得拒否のため検索要約）
- [S38] VG Deep Glow（Resolve 用・第三者） https://victorgrubbe.gumroad.com/l/deepglow （検索要約）
- [S39] aescripts Plexus 3 Render Only https://aescripts.com/plexus-3-render-only/ ／ CGPress「Plexus 3 released」 https://cgpress.org/archives/plexus-3-released.html （検索要約）
- [S40] Yans Media「Best After Effects Plugins 2026」 https://www.yansmedia.com/blog/best-software-plugins-motion-graphics-designers-use （検索要約）
- [S41] RE:Vision Effects Twixtor https://revisionfx.com/products/twixtor/
- [S42] CG Channel「RE:Vision Effects releases Twixtor 8 in beta」 https://www.cgchannel.com/2024/03/revision-effects-releases-twixtor-8-in-beta/ （検索要約）
- [S43] ToolFarm「Difference between RE:Vision Effects Pro & Regular」 https://www.toolfarm.com/?p=31901 ／ CG Channel「Twixtor Standalone」 https://www.cgchannel.com/2025/01/revision-effects-launches-twixtor-standalone （検索要約）
- [S44] RE:Vision Effects ReelSmart Motion Blur https://revisionfx.com/products/rsmb/
- [S45] ToolFarm RSMB Regular https://www.toolfarm.com/?p=5575 （検索要約）
- [S46] Digital Production「Neat Video 6.1 updates OFX and host support」 https://digitalproduction.com/2026/02/18/neat-video-6-1-updates-ofx-and-host-support/
- [S47] Neat Video「v6 Demo plug-in for OFX hosts」 https://www.neatvideo.com/download/demo/nv6ofxd ／ Neat Video OFX 互換性 https://www.neatvideo.com/features/compatibility/nv6ofx ／ Resolve クイックスタート https://www.neatvideo.com/support/quick-start-guide-rs-15 （取得拒否のため検索要約）
- [S48] Neat Video 価格 https://www.neatvideo.com/purchase?56 ／ UniFab レビュー https://unifab.ai/resource/neat-video.htm （検索要約）
- [S49] FilmConvert OFX https://filmconvert.com/plugin/ofx ／ FilmConvert masters https://www.filmconvert.com/masters （検索要約・現在は 404）
- [S50] VEGAS フォーラム「Why is VEGAS Pro kicked out by FilmConvert Nitrate」 https://www.vegascreativesoftware.info/us/forum/why-is-vegas-pro-kicked-out-by-filmconvert-nitrate--125500 （検索要約）
- [S51] Dehancer VEGAS Pro マニュアル https://www.dehancer.com/learn/article/vegas_pro ／ Dehancer System requirements https://dehancer.com/learn/article/system-requirements ／ Downloads https://www.dehancer.com/downloads （検索要約）
- [S52] Dehancer OFX FAQ https://dehancer.com/learn/article/ofx-faq ／ Dehancer Resolve Pro 定額 https://www.dehancer.com/shop/davinci_resolve/pro/subscribe （検索要約）
- [S53] AUR openfx-misc https://aur.archlinux.org/packages/openfx-misc ／ AUR openfx-io https://aur.archlinux.org/packages/openfx-io?O=20 （検索要約）
- [S54] VEGAS フォーラム「VEGAS Pro 15 and other (open sourced) OFX plugins」 https://www.vegascreativesoftware.info/us/forum/vegas-pro-15-and-other-open-sourced-ofx-plugins--116270 （検索要約）
- [S55] GitHub NatronGitHub/openfx-arena https://github.com/NatronGitHub/openfx-arena （検索要約）
- [S56] pixls.us「G'MIC for OpenFX and Adobe plugins」 https://discuss.pixls.us/t/gmic-for-openfx-and-adobe-plugins/452 ／ GitHub tobybear/gmic_plugin https://github.com/tobybear/gmic_plugin （検索要約）
- [S57] Gyroflow「DaVinci Resolve OpenFX」 https://docs.gyroflow.xyz/app/video-editor-plugins/davinci-resolve-openfx
- [S58] Natron ドキュメント「Natron as an OpenFX Host」 https://natron.readthedocs.io/en/rb-2.6/maintainers/openfx-host.html （検索要約）
- [S59] OpenFX「Release Notes for V1.5」 https://openfx.readthedocs.io/en/main/ReleaseNotes/relnotes-1.5.html ／ CudaRender https://openfx.readthedocs.io/en/main/Reference/api/group/group__CudaRender.html （検索要約）
- [S60] ASWF TAC「OpenFX Update July 2025」 https://tac.aswf.io/meetings/2025-07-23/OpenFX_ASWF_TAC_Update_July_2025.pdf （検索要約）
