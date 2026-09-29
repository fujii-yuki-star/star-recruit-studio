# すたりおの画面は「部品」ではなく「配分」で損をしている

**結論：すたりおの編集画面で情報が少なく見える主因は、ボタンや列の大きさではない。窓の面積の配り方と、表示量を利用者が変える道具が無いことにある。** 2026-09-29 に 1920×1009 の窓で測った（Issue #1256）。ボタンの中央値は 29px、列は 28px で、どちらも業界のデスクトップ向けの寸法（部品の高さ 24〜32px）に収まっている。ADR-0047 の手当てで、部品の大きさはすでに業界並みになった。一方、帯（クリップ）を実際に描いている面積は窓の **24〜32%**、プレビューの絵は **8.7%** しかない。残りは次のものに取られている。

- 常に開いたままのサイドバー（12.9%）
- 目印が0件でも 124px を使う「マーカー」欄
- 4つの欄の見出し（各 35px）

横方向にも天井がある。ズームの最小段が 16px/秒のため、**約94秒を超える動画は「全体を表示」を押しても1画面に入らない**。調べた他社ソフトは、プロ向け・一般向け・無料/OSS・日本の同人系のどれも、次の3つの道具のどれかを持っている。

- 1つの欄を一時的に最大化する
- 列（トラック）の高さを変える
- 尺全体を画面幅に収める

すたりおには3つとも無い。さらに、今の既定配置（下段 0.65）では**プレビューの絵が欄からはみ出し、「再生」ボタンが欄の外へ押し出されている**。これは不具合で、画面そのものを録るチュートリアルの前に必ず直すべきだ。

改善候補は3つに分けて最後に並べた。(a) 測定で見つかった不具合、(b) 密度・配置の改善、(c) 足りない機能。候補のうち「列の高さを変える」と「密度の切替」の2つは、ADR-0047 で「やらない」と決めた内容とぶつかる。黙って勧めず、衝突として明記した。

## 窓の4分の3は帯以外に使われている（すたりおの実測）

以下の数値はリリースビルド v0.4.3 を最大化して起動し、画面上の各部品の位置と大きさを直接読み取ったものだ（CDP 経由で `getBoundingClientRect()` を取得）。

- 窓：1920×1009
- 使った動画：タイムライン形式、列2本・部品200個・600秒

窓の中の大きな区画は次のとおり。

- **サイドバー：248×1009（窓の 12.9%）**。編集中も展開したまま（`src/styles/theme.css:192-199`）
- 見出しの行：38px
- 欄の器：1652×935（79.7%）

欄の器には「置く／仕上がり確認／選んだ部品／並び」の4欄がある。欄ごとに 35px の見出し帯があり、欄の間には 6px の仕切りがある。

既定の配置（`panelLayout.ts:92,110` の `MAX_BOTTOM_REGION_RATIO = 0.65`）では、並びの欄が 1648×600 で窓の 51% を占める。その 600px の内訳は次のとおりで、**帯の描画に使えるのは 382px（窓の約32%）だけ**だ。

- 欄の見出し：35px
- 道具立て行：29px
- 帯のスクロール領域：382px
- マーカー欄：124px

382px から目盛り 22px を引き、列の高さ 28px で割ると、列は **約12.9本** 入る計算になる。資料の「19本中14本が見える」（`06_UI_SPEC.md` §12.1）とほぼ一致する。

利用者の実環境に記憶されていた配置（下段 0.5465）では、帯の領域は **286px（窓の 24.1%）**、列は約9.4本ぶんだった。この動画は列が2本しかないので、残りの約 208px は空白だった。

上の3欄は下段に場所を譲っている。既定の配置では次の大きさしかない。

| 欄 | 大きさ | 窓に対する割合 | 状態 |
|---|---|---|---|
| 置く | 459×321 | 7.6% | ボタン14個のうち見えるのは5個 |
| 仕上がり確認 | 777×321 | 12.9% | ― |
| 選んだ部品 | 392×321 | 6.5% | 字幕の帯を1つ選ぶと中身は 976px、見えるのは約39% |

帯そのものの密度も低い。帯は高さ 24px で、載っているのは11px の名前1行だけだ。開始時刻・長さ・効果の有無は、マウスを乗せたときの補足表示（`title`）にしか出ない（`timeline.css:245-256`）。コマ列と波形は、帯の幅が 60px 以上のときだけ描かれる（`TimelineProjectScreen.tsx:240`）。

横方向は、ズームが6段 `[16, 24, 36, 54, 80, 120]` px/秒に固定されている（`src/domain/constants.ts:51`）。「全体を表示」は、収まる段のうち最大のものを選ぶだけだ（`zoom.ts:17-23`）。600秒の動画は最小の段でも総幅 9752px になり、見えている帯は **200個中32個（約94秒ぶん）** だった。

今の状態に至った経緯は次のとおり。「情報が少ない」という指摘は、すでに2回あった（#1104 と ADR-0047）。手当ては2段で行われた。

1. 下段の比率を 0.28→0.5→0.65 と広げた
2. `dense` 表示でボタンを 41→29px、余白を 24→12px に縮めた

ただし資料自身が「**欄の面積の比は変わらない**（並び 38%→39%）…詰めても本体の面積は増えない」と書いている（`06_UI_SPEC.md` §12.1）。つまり、周りを削る手はほぼ使い切った。下段を広げるほど上段のプレビューがはみ出す。**比率の調整だけでは上下の取り合いから抜けられない**構造になっている。

## 部品の寸法はもう業界並み。差は「広げる・縮める道具」にある

公開されているデザインシステムを並べると、マウス操作のデスクトップでは部品の高さに一定の帯がある。

- Adobe Spectrum：デスクトップ scale 32px、タッチ scale 40px ([Spectrum Web Components](https://opensource.adobe.com/spectrum-web-components/tools/theme/))
- Material：密度を1段上げるごとに 4px 減らす ([Material Density](https://m2.material.io/develop/web/supporting/density))
- macOS HIG：既定 28pt、最小 20pt ([Apple Developer Forums](https://developer.apple.com/forums/thread/739201))
- WCAG 2.2 の AA 要件：**24×24 CSS px** ([W3C SC 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html))

すたりおのボタン 29px と列 28px は、この帯の中にある。以前のボタン 41px は、デスクトップで言えば「タッチ向け」の大きさだった。**部品をこれ以上小さくしても得るものは少ない**。

違いが出るのは、表示量を変える道具のほうだ。

**欄の一時最大化。** 主要ソフトはどれも、ワンキーでタイムラインだけを大きくできる。

- Premiere Pro：カーソルの下の欄を `（グレイヴ・アクセント）キーで全画面にし、もう一度押すと戻る ([Adobe](https://helpx.adobe.com/premiere/desktop/get-started/tour-the-workspace/display-any-panel-full-screen.html))
- VEGAS Pro：Ctrl+F11 でタイムラインを縦横に最大化する ([VEGAS Pro 21 ヘルプ](https://help.magix-hub.com/video/vegas/21/en/content/topics/2-window/customizing_vegas.htm))
- Clipchamp（一般向け）：タイムラインを畳んでプレビューを大きくでき、逆方向の切替も持つ ([Clipchamp Blog](https://clipchamp.com/en/blog/full-screen-video-preview-clipchamp/))
- Camtasia：タイムラインを別ウィンドウに切り離して、見えるトラックを増やせる ([TechSmith](https://www.techsmith.com/learn/tutorials/camtasia/video-editing/))

**列の高さ。** 変え方の型は、全トラック一括・種類ごと・1本ずつ、の3段に揃っている。

- Premiere：Shift+=／Shift+- で全トラックを広げる／縮める ([Frame.io](https://blog.frame.io/2021/10/18/edit-faster-premiere-pro-keyboard-shortcuts/))
- VEGAS：` キーで全トラックを最小化し、もう一度押すと元に戻る ([VEGAS Pro 22 ヘルプ](https://help.magix-hub.com/video/vegas/22/en/content/topics/7-edit/videotrack.htm))
- Kdenlive：「全トラックの高さをタイムラインの表示高に合わせる」機能がある ([Kdenlive docs](https://docs.kdenlive.org/en/user_interface/timeline.html))
- Shotcut：Ctrl+-／Ctrl+= で変える ([Shotcut](https://www.shotcut.org/howtos/keyboard-shortcuts/))
- Camtasia：全トラックを比例して変えるスライダーを持つ ([TechSmith](https://www.techsmith.com/learn/tutorials/camtasia/video-editing/))

日本の同人系も同じだ。AviUtl は「レイヤーの幅」を大・中・小から選べる ([aviutl.info](https://aviutl.info/kakutyouhennsyuu-kannkyousettei/))。YMM4 は 2025 年に、レイヤーの高さを設定で数値指定する機能と、Ctrl+ホイールで変える機能を足した ([relief.jp](https://www.relief.jp/docs/ymm4-change-layers-height.html)、[relief.jp](https://www.relief.jp/docs/ymm4-change-layers-height-by-mouse-wheel.html))。すたりおの列は 28px 固定で、変える操作も状態も無い（`constants.ts:85`）。

**尺全体を収める。** Clipchamp の「fit timeline」は、素材を画面幅に収めて右側の空白を消す ([Microsoft Support](https://support.microsoft.com/en-us/topic/how-to-work-with-the-timeline-in-clipchamp-80ad81aa-d81e-45e9-bf9b-538c0f7202a4))。Shotcut はキー `0`、Camtasia は虫眼鏡のボタンで同じことをする。DaVinci Resolve の Cut ページは、**上段に番組全体、下段に作業位置の拡大**を並べる二段タイムラインで、ズームの往復そのものを無くしている ([Blackmagic Design](https://www.blackmagicdesign.com/products/davinciresolve/cut))。

**帯に何を載せるか。** 利用者が選べるソフトが多い。

- Final Cut Pro：6種類の外観プリセットをキー1つずつで切り替える。「波形だけ」から「クリップ名だけ」まであり、後者は密度優先の状態にあたる ([Apple](https://support.apple.com/guide/final-cut-pro/adjust-timeline-clip-appearance-verb8e5d346/mac))
- Premiere：サムネイル・波形・キーフレーム・**エフェクトバッジ**を1つずつオン/オフできる ([Noble Desktop](https://blog.nobledesktop.com/learn/premiere-pro/timeline-display-settings-in-premiere-pro))
- VEGAS：頻度の低い操作をトラック見出しの「More」ボタンに隠し、見出しの幅を保ったまま機能を増やしている ([VEGAS Pro 22 ヘルプ](https://help.magix-hub.com/video/vegas/22/en/content/topics/7-edit/videotrack.htm))

| 観点 | すたりお（実測） | 他社の例 |
|---|---|---|
| 欄の一時最大化 | 無い（欄のメニューは「移す／閉じる」だけ） | Premiere `、VEGAS Ctrl+F11、Clipchamp のタイムラインを畳む、Camtasia の切り離し |
| 列の高さ | 28px 固定 | Premiere・VEGAS・Resolve・Kdenlive・Shotcut・Camtasia・AviUtl・YMM4 はすべて可変 |
| 尺全体を画面に収める | 約94秒まで | Clipchamp の fit、Shotcut の `0`、Camtasia の虫眼鏡、Resolve Cut の二段タイムライン |
| 帯に載る情報 | 名前1行（11px）。時刻は補足表示だけ | FCP の6プリセット、Premiere の項目別オン/オフとバッジ |
| 配置の型の切替 | 画面ごとに1つだけ記憶（ADR-0033） | Filmora 9種、Shotcut 6種、Kdenlive 5種、YMM4 の名前付きプリセット ([Filmora](https://filmora.wondershare.com/guide/panel-layout.html)、[Shotcut](https://www.shotcut.org/howtos/keyboard-shortcuts/)、[Kdenlive](https://docs.kdenlive.org/en/user_interface/workspace_layouts.html)、[Bluemist note](https://note.com/bluemist/n/n0ecf3f1ce2e7)) |
| 左の帯（サイドバー） | 248px が編集中も開いたまま | Clipchamp は左ツールバーを畳める。Resolve Cut は小さい画面でも自動で組み直し、スクロールバーを無くしている ([Clipchamp Blog](https://clipchamp.com/en/blog/how-to-navigate-video-editing-tools/)、[Blackmagic](https://www.blackmagicdesign.com/products/davinciresolve/cut)) |

欄の配置そのもの（左上＝素材、中央上＝プレビュー、右＝設定、下＝タイムライン）は、プロ向け・一般向け・OSS・YMM4・AviUtl2 のすべてで共通だった ([OpenShot](https://cdn.openshot.org/static/files/user-guide/main_window.html)、[ゆっくり法律事務所](https://www.momohuku.tokyo/post-138734/)、[vip-jikkyo.net](https://vip-jikkyo.net/aviutl2-tutorial))。すたりおもこの型に合っているので、**並べ方を変える必要はない**。

同種ソフトが「情報が少ない」「窮屈」という声に応えるやり方は、既定を一律に詰め込むことではなかった。次の3つで応えている。

1. 列の高さを利用者が変えられるようにする
2. 用途別の配置をプリセットにする
3. 要らない欄を隠す、またはタブにまとめる

## 1920×1080 で足りても、125% 拡大のノート PC では面積が約64%になる

窓の実効サイズについては、根拠のある懸念がある。

- Steam の調査（2026年8月）では、物理解像度 1920×1080 が **50.52%** で最多 ([Steam](https://store.steampowered.com/hwsurvey/Steam-Hardware-Software-Survey-Welcome-to-Steam))
- ブラウザが報告する CSS 解像度を集める StatCounter では、**1536×864 が 6.7%、1366×768 が 5.2%** ([StatCounter](https://gs.statcounter.com/screen-resolution-stats/desktop/worldwide))
- 1536×864 は、1920×1080 のノート PC で Windows 推奨の 125% 拡大を使ったときの実効サイズと一般に解釈されている ([Windows 11 Forum](https://www.elevenforum.com/t/1080p-scaling-on-laptop-15-6.32648/))

同じ px 設計のままなら、125% 拡大で使える面積は 1/1.25² ≈ **64%**、150% では約44% に縮む（計算）。すたりおの測定は devicePixelRatio 1 だけで、拡大率 125%/150% での実測はまだ無い。

これを今の数値に当てはめる（推定）。帯の領域は382px から約 300px に減り、列は約10本ぶんになる。プレビュー欄の本文 284px も約 230px 前後になり、再生ボタンのはみ出しはさらにひどくなる。Premiere の利用者からも「ノート PC ではボタンと余白が場所を取り、タイムラインとプレビューが小さくなりすぎる」という声が出ている ([Adobe Community](https://community.adobe.com/t5/premiere-pro-discussions/editing-is-very-uncomfortable-in-a-laptop/m-p/9985129))。

NN/g は、デスクトップで内容が引き伸ばされると次の問題が起きると定性研究で示している ([NN/g](https://www.nngroup.com/articles/content-dispersion/))。

- スクロールが増える
- 関連する情報が別々の画面に分かれ、短期記憶の負担が増える
- 全体像がつかみにくくなる

利用者の「画面サイズのわりに情報が少ない」という感想は、この症状と一致する。

## テンプレ型・台本型のソフトは、時間の関係を見せないと「編集できない」と言われる

stario と対象層が近いテンプレ型・AI 型のソフトにも示唆がある。

**時間関係の一覧性。** Adobe Express は、場面ごとのレイヤーを1画面で見せる「全レイヤー表示」を更新で外した。すると「各要素の開始と終了の関係が見えず、編集が事実上できない」という投稿が相次いだ ([Adobe Express コミュニティ](https://community.adobe.com/t5/adobe-express-discussions/how-to-show-all-layers-view-in-the-adobe-express-video-timeline/m-p/15437616))。非専門家であっても、**全要素の時間関係を1画面で見わたせること**が「情報が足りている」と感じる条件の一つだとわかる。すたりおで全体表示が94秒で止まる問題は、この条件に直接当たる。

**台本型の見せ方。** Descript は、開いた時点でタイムラインを完全に畳んでいる。台本を主役にし、細部を詰めるときだけタイムラインを引き出す作りだ ([Descript Help](https://help.descript.com/hc/en-us/articles/36492789575565-The-new-timeline-experience))。Vrew も波形のタイムラインを主役にしない ([aipicks](https://aipicks.jp/mag/vrew-how-to-use-2026))。すたりおの「場面形式が主役、タイムライン形式は任意」はこれに近い。そのぶん、**タイムライン形式に来た利用者は精密な一覧を求めている**と考えるのが筋だ。

**トラックを増やさずに情報を載せる。** Camtasia は、カーソル効果とクリック位置を録画クリップの下の「効果トレイ」に畳む。クリックはその帯の上の丸印で表される ([TechSmith](https://www.techsmith.com/learn/tutorials/camtasia/cursor-effects/))。ADR-0046 で仮想カーソルを後から足す予定のすたりおにとって、トラックを増やさずに密度を保つ参考例になる。

YMM4 は、1つのボイスアイテムに声・字幕・表情をまとめている ([L.A.D. note](https://note.com/laminadolor/n/nc1e688ba3194))。キャラごとに帯の色も変えられるので、掛け合いの話者をタイムラインの色で読み分けられる。

## 優先して直す候補（撮影の前か後か）

「撮影前」とは、チュートリアルの画面に写る見た目や操作が変わるため、録り直しを避けるには先に済ませるべきもの。「待てる」とは、後から入れても録った映像との食い違いが小さいもの。

### (a) 測定で見つかった不具合

| 順 | 何を直すか | 根拠と他社の例 | 密度への効果 | 撮影 |
|---|---|---|---|---|
| a1 | **既定の配置で、プレビューの絵（744×418）が欄の本文（284px）からはみ出し、「再生」ボタン（y=522）が欄の下端（y=380）の外に出る**。絵を欄の本文に収まる大きさにし、再生の行を欄の下に固定する | 実測。他社の再生操作は常に見える位置にある、というのは推定（今回の出典には無い）。Clipchamp はタイムラインを畳んでプレビューを広げる、という逆向きの逃げ道を持つ ([Clipchamp Blog](https://clipchamp.com/en/blog/full-screen-video-preview-clipchamp/)) | プレビューの一覧性が戻る。スクロールせずに再生できる | **撮影前（必須）**。既定の配置で録れば、この状態がそのまま写る |
| a2 | **「全体を表示」が約94秒を超える動画を収められない**。最小の段より下のズーム（連続値、または尺から逆算した値）を足す | ADR-0034 は「開いた直後は全体表示」と決めているが、実装が 16px/秒の下限でこれを満たせない。**ADR と実装の食い違い**。Clipchamp の fit ([Microsoft Support](https://support.microsoft.com/en-us/topic/how-to-work-with-the-timeline-in-clipchamp-80ad81aa-d81e-45e9-bf9b-538c0f7202a4))、Shotcut の `0` ([Shotcut](https://www.shotcut.org/howtos/keyboard-shortcuts/)) | 600秒の動画で、見える帯が 32/200 個から全部になる（1506px÷600秒≈2.5px/秒。計算） | **撮影前**（ズーム操作を映すなら）。撮影用の動画が94秒以下なら問題は表に出ないが、挙動は直しておくべき |
| a3 | **撮影環境の配置を既定に揃える**。利用者の記憶配置（下段 0.5465）は既定（0.65）と違う | 実測で、2つの配置は別の画面になった | ― | **撮影前（運用）**。「配置を既定に戻す」を撮影手順に入れる |

### (b) 密度・配置の改善

| 順 | 何を変えるか | 他社の例 | 密度への効果 | 撮影 |
|---|---|---|---|---|
| b1 | **編集画面ではサイドバーを畳んだ状態を既定にする**（開閉は今もできる） | Clipchamp の左ツールバーの開閉 ([Clipchamp Blog](https://clipchamp.com/en/blog/how-to-navigate-video-editing-tools/))、FCP のサイドバー切替 ([Apple](https://support.apple.com/guide/final-cut-pro/arrange-the-main-window-ver2a27194eb/mac)) | 横 248px（窓の 12.9%）を取り戻す。並びの見える秒数は約94→約109秒（最小ズームで計算）。畳んだ状態は未実測 | **撮影前**。すべてのコマに写る |
| b2 | **目印が0件のときはマーカー欄を畳む**か、目盛りの行に吸収する | Camtasia はマーカーを足したときに専用の表示が開く ([TechSmith](https://www.techsmith.com/learn/tutorials/camtasia/video-editing/))。Descript は目印を時間の目盛りに載せる ([Descript Help](https://help.descript.com/hc/en-us/articles/36492789575565-The-new-timeline-experience)) | 並びの欄の 124px（本文の約27%）が帯に回り、既定の配置で列が 12.9→約17本ぶんになる（計算） | **撮影前**。⚠️ ADR-0047 の「触る所の場所は変えない」に触れるので、判断して記録が必要 |
| b3 | **欄の一時最大化**（見出しのボタンとキー1つ、もう一度で戻る） | Premiere の ` ([Adobe](https://helpx.adobe.com/premiere/desktop/get-started/tour-the-workspace/display-any-panel-full-screen.html))、VEGAS の Ctrl+F11 ([VEGAS](https://help.magix-hub.com/video/vegas/21/en/content/topics/2-window/customizing_vegas.htm))、YMM4 の自動非表示ピン ([Bluemist note](https://note.com/bluemist/n/n0ecf3f1ce2e7)) | 並びだけを器（935px）いっぱいにすると、列は約26本ぶん（マーカー欄込みの計算。b2 と合わせれば約30本）。上下の取り合い（a1）の逃げ道にもなる | 待てる。ただし各欄の見出しにボタンが増えるので、撮影前に入れば映像と一致する。ADR-0033 とは衝突しない（配置を記憶しない一時状態として作る） |
| b4 | **「置く」欄の中身を上に詰める**。素材のサムネ一覧を上に出し、取り込みの導線と説明文を畳む | Filmora・CapCut は欄の上部の横タブの直下に素材が並ぶ ([Filmora](https://filmora.wondershare.com/guide/panel-layout.html))。Clipchamp は縦のアイコン列 ([Clipchamp Blog](https://clipchamp.com/en/blog/how-to-navigate-video-editing-tools/)) | 既定の配置でボタン14個中5個しか見えない状態を改善する | **撮影前**。チュートリアルの最初の操作（素材を置く）が写る |
| b5 | **「選んだ部品」の上段にあるボタン13個**（前へ〜削除）を、並びの道具立て行か、選んだ帯の近くに出る浮いた道具列へ移す | Clipchamp の選択物の近くに出る浮いた道具列 ([Clipchamp Blog](https://clipchamp.com/en/blog/how-to-navigate-video-editing-tools/))、Filmora の折りたためる区画 ([Filmora](https://filmora.wondershare.com/guide/panel-layout.html)) | 中身 976px のうち見えるのが約39% という状態を改善する | するなら**撮影前**、しないなら全部待つ。⚠️ ADR-0047 の「触る所（押す物・場所）は変えない」と**正面から衝突する**ので、ADR の改訂が前提 |
| b6 | **帯の中身を増やす**。幅に余裕があるときは長さ（例「6.0秒」）や効果の印を出し、コマ列・波形の 60px という閾値を見直す | Premiere のエフェクトバッジ ([Noble Desktop](https://blog.nobledesktop.com/learn/premiere-pro/timeline-display-settings-in-premiere-pro))、FCP の外観プリセット ([Apple](https://support.apple.com/guide/final-cut-pro/adjust-timeline-clip-appearance-verb8e5d346/mac)) | 補足表示に頼らず、帯1本から読み取れる量が増える | 待てる（見た目は変わるが、操作は変わらない） |
| b7 | **拡大率 125%（実効 1536×864）で実測し、合否の基準にする** | StatCounter の 1536×864 は 6.7% ([StatCounter](https://gs.statcounter.com/screen-resolution-stats/desktop/worldwide)) | 判定の土台 | 撮影とは独立。ただし a1 の直し方を決める前に測るのが望ましい |
| b8 | **場面形式の「仕上がり確認」と書き出し画面にも `dense` を当てる**。今はボタン 41px で、ページ全体のスクロールが要る | ADR-0047 が「まずタイムライン編集から」とした残り。デザインシステムの帯は上の節のとおり | ページのスクロール（1452/949px、1274/949px）を減らす | チュートリアルがこれらの画面を映すなら撮影前、映さないなら待てる |

### (c) 足りない機能

| 順 | 機能 | 他社の例 | 密度への効果 | 撮影 |
|---|---|---|---|---|
| c1 | **列の高さを変える**。全列一括と「表示高に合わせる」の2つだけでもよい | Kdenlive ([docs](https://docs.kdenlive.org/en/user_interface/timeline.html))、Premiere ([Frame.io](https://blog.frame.io/2021/10/18/edit-faster-premiere-pro-keyboard-shortcuts/))、YMM4 ([relief.jp](https://www.relief.jp/docs/ymm4-change-layers-height.html))、AviUtl ([aviutl.info](https://aviutl.info/kakutyouhennsyuu-kannkyousettei/)) | 列が少ない動画では帯を太くしてコマ列を見せ、多い動画では細くして本数を稼ぐ | 待てる。⚠️ **ADR-0047 決定6「列（28px）は触らない」と衝突する**。やるなら ADR の改訂が先 |
| c2 | **尺の全体と作業位置を同時に見る**（全体図の帯、または二段タイムライン） | Resolve Cut ([Blackmagic](https://www.blackmagicdesign.com/products/davinciresolve/cut)) | ズームの往復が無くなる。a2 より大きい手 | 待てる |
| c3 | **配置のプリセット**（例：編集用／プレビュー重視） | Filmora 9種、Shotcut 6種、Kdenlive 5種、YMM4、OpenShot の My Views（出典は上の表） | 作業に合わせて配分を一発で切り替えられる | 待てる。⚠️ ADR-0033 決定4（画面ごとに配置は1つ）と ADR-0047 の選択肢(D)の却下に触れる |
| c4 | 列見出しの**ミュート／ソロ**をトグルボタンで出す（今はメニュー経由のみ） | VEGAS ([ヘルプ](https://help.magix-hub.com/video/vegas/22/en/content/topics/7-edit/videotrack.htm))、Kdenlive ([docs](https://docs.kdenlive.org/en/user_interface/timeline.html))、Camtasia の目・Alt+クリックでソロ ([TechSmith](https://www.techsmith.com/learn/tutorials/camtasia/video-editing/)) | 状態が一目で読める。ただし見出しの幅（124px）が増えるので、VEGAS の「More」型で抑える | 待てる |
| c5 | **タイムコード表示**（分:秒:フレーム）の選択 | Premiere の時間表示の切替 ([Noble Desktop](https://blog.nobledesktop.com/learn/premiere-pro/timeline-display-settings-in-premiere-pro)) | 精密さ。密度への効果は小さい | 待てる |
| c6 | **ショートカット一覧** | Shotcut は一覧を公開している ([Shotcut](https://www.shotcut.org/howtos/keyboard-shortcuts/)) | 画面の外に知識を逃がせるので、ボタンを減らしやすくなる | 待てる。チュートリアルで紹介するなら撮影前 |

音量メーター、J/K/L 再生、帯のコピー＆ペースト、並びの上での範囲ドラッグ選択も、すたりおには無い（コードの grep で確認）。ただし今回の調査では他社側の出典を取っていないので、優先順位に入れていない。押しのけ（ripple）とマグネティック編集は、PowerDirector や Camtasia の磁石が持つ ([propixelagency](https://propixelagency.com/blog/powerdirector-review-2025/)、[TechSmith](https://www.techsmith.com/learn/tutorials/camtasia/video-editing/))。しかし ADR-0034 決定11 が、同じ列で重ねない規則（V24）とぶつかるため意図的に採らないと決めているので、候補から外した。

### 測ったもの・推定したもの・見つからなかったもの

**測ったもの。** すたりおの寸法・面積比・見える本数・再生ボタンの位置は、1920×1009、拡大率 100%、明るい表示で実測した。見える列の本数は、実測した器の高さを 28px で割った計算値だ（手元の動画は最大3列しかなく、多列では実測できなかった）。

**実測していないもの。** サイドバーを畳んだ状態、拡大率 125%/150%、暗い表示、見た目パターン編集画面。

**見つからなかったもの。** 他社ソフトの画面占有率（%）、既定のトラックの高さ（px）、1080p で見えるトラック本数は、公式資料にも第三者資料にも見つからなかった。スクリーンショットの実測もしていない。したがって「すたりおの帯の面積 24〜32% は他社より小さい」とは**数値では断定できない**。言えるのは「他社は、それを変える道具を必ず持っている」ことまでだ。

**未検証のため採らなかった値。** YMM4 のレイヤーの高さの初期値 32px は、検索の要約にしか出てこず確認できなかった。Resolve の「Lock Track Height To」の段階名は非公式サイトの記述で、公式資料では確認できていない。

## 結論

部品の小型化（ADR-0047）で、すたりおの寸法は業界の帯に入った。次の打ち手は「さらに小さくする」ことではない。**面積の固定費を削ること**と、**利用者が広げ縮めできる道具を足すこと**だ。

- 固定費：サイドバー、空のマーカー欄、プレビューのはみ出し
- 道具：最大化、全体を収める、列の高さ

他社が一様に持っているのは密な既定値ではなく、この「切り替える手段」のほうだ。すたりおは、その手段が無いまま比率の調整で上下を取り合っている。

チュートリアルの撮影との関係では、次の6つを先に済ませる。

- a1（再生ボタンのはみ出し）
- a2（全体表示が94秒で止まる）
- a3（撮影環境の配置を既定に揃える）
- b1（サイドバーを畳む）
- b2（空のマーカー欄を畳む）
- b4（「置く」欄を詰める）

このうち **b2 と b5 と c1 は、記録済みの決定（ADR-0047 の「場所を変えない」「列は触らない」）の見直しを伴う**。実装より先に ADR の改訂として判断する必要がある。

逆に、ADR-0034 の「開いた直後は全体表示」は、決定は正しいのに実装が追いついていない例だ。a2 は新しい機能の要望ではなく、この食い違いを直す不具合修正として扱うべきである。
