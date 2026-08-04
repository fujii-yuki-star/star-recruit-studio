# 調査：動画エディタの操作感（タイムライン編集の作り直しのために）

- **日付**: 2026-08-04
- **きっかけ**: 実機確認での利用者指摘＝「**操作感が独特すぎて全然つかめない**」「**自由度が無く窮屈**」「私ですら分からない操作をユーザーに求めることになる」（#683）
- **位置づけ**: **調査資料**（決定ではない）。ここでの発見をもとに **ADR-0034「タイムライン編集の操作モデル」** を書く。
- **関連**: #683（EPIC・現状の監査）/ #684〜#687（段階）/ [`adr/0032`](../adr/0032-timeline-project-format.md)（タイムライン形式）/ [`adr/0033`](../adr/0033-editor-panel-layout.md)（欄の配置）

> ⚠️ ここに書いた他社の挙動は**公開資料と利用者の声からの要約**であり、全機能を実機で確認したものではない。
> 実装の根拠にするときは、当該箇所を改めて確かめること（`§7` の未確認事項を参照）。

---

## 1. 調べた対象と観点

| 対象 | 選んだ理由 |
|---|---|
| Adobe Premiere Pro | 業界標準。**帯とキャンバスの操作の"当たり前"**の出どころ |
| Final Cut Pro | 別系統（マグネティック）＝**帯の動かし方の思想が違う**比較対象 |
| DaVinci Resolve | 無料で普及。**簡単な画面と詳しい画面を分ける**設計（Cut / Edit ページ） |
| Clipchamp | Windows 標準・ブラウザ・初心者向け。**うちの利用者層に近い** |
| Canva | テンプレ駆動の代表。**「簡単だが自由度が無い」不満の教科書** |
| FlexClip | テンプレ＋AI のオンライン編集。Canva と同系 |
| CapCut | 短尺・初心者向けの最大手。**キャンバス直接操作**が中心 |
| **nizima ACTION!!** | **ブラウザ・初心者向け・キャラ（Live2D）中心・短尺**＝**うちに最も近い先行例**（利用者からの示唆） |
| ゆっくりMovieMaker4 | **キャラ＋合成音声＋字幕**の国産定番＝**題材がうちとほぼ同じ** |
| Vrew | **台本（テキスト）から編集**する別解。AI 前提の作り |

観点＝①画面の構成 ②素材の置き方 ③キャンバスの操作 ④帯（タイムライン）の操作 ⑤設定欄（インスペクタ）の作り ⑥キーボード ⑦利用者の不満。

---

## 2. ツール別の要点

### Adobe Premiere Pro

- **キャンバス（Program Monitor）で直接動かせる**。**ダブルクリック**（または直接操作トグル）でハンドルが出て、ドラッグで移動・角で拡縮。数値は Effect Controls にもあり**両方で同じ値を触れる**（[Adobe: Nudge clips in Program Monitor](https://helpx.adobe.com/premiere/desktop/get-started/source-and-program-monitor-adjustments/nudge-clips-in-program-monitor.html)・[Motion effect](https://helpx.adobe.com/premiere/desktop/add-video-effects/commonly-used-effects/apply-motion-effect.html)）
- **帯はドラッグで移動**、端にカーソルを合わせると**トリム**、**矢印キーで微調整**（[Adobe: Move clips](https://helpx.adobe.com/premiere/desktop/edit-projects/change-clip-sequence/different-ways-to-move-clips.html)・[Tuts+](https://photography.tutsplus.com/tutorials/how-to-edit-timeline-premiere--cms-40354)）
- **吸着（スナップ）**は明示的な ON/OFF ボタン。他の帯の端・再生位置・目印に吸い付く（[Adobe: Snap clips](https://helpx.adobe.com/premiere/desktop/edit-projects/change-clip-sequence/snap-clips.html)）
- **不満**：機能が多すぎて**最初の画面で迷う**。「基本的な操作がメニューの奥に埋まっている」「パネルが多くて圧倒される」（[Capterra](https://www.capterra.com/p/233456/Adobe-Premiere-Pro/reviews/)・[Noble Desktop](https://blog.nobledesktop.com/learn/premiere-pro/how-difficult-is-it-to-learn-premiere-pro)・[Adobe コミュニティ](https://community.adobe.com/questions-729/tutorial-withing-premiere-pro-is-overwhelming-for-new-user-1419948)）
- 対策として**ワークスペース（画面の型）の切り替え**とツールバーの自作を用意している

### Final Cut Pro（別系統）

- **マグネティックタイムライン**＝帯を動かすと**周りが自動で寄る**。隙間や衝突が起きない（[Apple](https://support.apple.com/guide/final-cut-pro/intro-to-the-magnetic-timeline-verb8fcfc133/mac)）
- **賛否が割れる**。速いという評価と、「**細かい配置の自由が利かない**」「トラック方式から来ると戸惑う」という評価が並存（[Filmora](https://filmora.wondershare.com/advanced-video-editing/final-cut-pro-magnetic-timeline.html)・[fcp.co](https://fcp.co/final-cut-pro/articles/2583-the-case-against-final-cut-pro)・[Creative COW](https://creativecow.net/forums/thread/solution-to-the-inconvenient-magnetic-timeline/)）
- **示唆**：自動で寄せる仕組みは**強い意見を生む**。採るなら「寄せない」逃げ道が要る

### DaVinci Resolve

- **ページ（画面）で仕事を分ける**＝Cut（素早く組む）／Edit（作り込む）／Color／Fairlight／Deliver。**Cut ページは意図的に機能を削った初心者・速度向け**（[Blackmagic](https://www.blackmagicdesign.com/products/davinciresolve/cut)・[Wipster](https://www.wipster.io/blog/inside-davinci-resolves-new-cut-page)）
- インスペクタは**セクション分け**（Transform／Cropping／Composite／Speed／Stabilization…）＝[解説](https://cromostudio.it/cromo-tips/a-comprehensive-guide-to-the-inspector-tab-in-davinci-resolve)
- **不満**：高機能ゆえに**開いた瞬間に何が何だか分からない**。「必要な機能に絞って使うべき」と各所が助言（[VideoProc](https://jp.videoproc.com/edit-convert/how-to-use-davinci-for-beginners.htm)・[miraiyotch](https://miraiyotch.com/davinci-resolve-beginner/)）

### Clipchamp（Windows 標準・ブラウザ）

- **素材はドラッグ＆ドロップ**でタイムラインへ。**＋ボタンでも置ける**（[Microsoft: 編集の基本](https://support.microsoft.com/en-us/clipchamp/how-to-edit-a-video-in-clipchamp)・[タイムラインの使い方](https://support.microsoft.com/en-us/topic/how-to-work-with-the-timeline-in-clipchamp-80ad81aa-d81e-45e9-bf9b-538c0f7202a4)）
- **評価**：メニューがアイコン化されていて**初心者がすぐ覚えられる**（[design-college](https://design-college.jp/clipchamp/)）
- **不満**：**自由に編集したい人にはかなり不満**（[VideoProc](https://jp.videoproc.com/edit-convert/how-to-use-clipchamp.htm)）。無料版の制約・読み込み/書き出しの不安定さ

### Canva（テンプレ駆動の代表）

- ドラッグ＆ドロップ中心。素材を既存の帯の**上に重ねる**とオーバーレイになる（[Canva ヘルプ](https://www.canva.com/help/creating-and-editing-videos/)）
- **不満が具体的で、うちへの警告になる**：**トラック分けができない**・**フレーム単位の調整ができない**・**細かいタイミング合わせがしづらい**・長尺で重い（[NewCurrent](https://asset-inc.jp/newcurrent/canva-video-edit-guide/)・[ぶいろぐ](https://oiuy.net/archives/11048)）
- **示唆**：「簡単だが窮屈」は**利用者が最も嫌う型**。うちの利用者指摘とまったく同じ言葉が並ぶ

### FlexClip

- テンプレ＋AI・ドラッグ＆ドロップ・プレビューが常に見える構成（[レビュー](https://thebusinessdive.com/flexclip-review)・[Photofocus](https://photofocus.com/photography/flexclip-a-fun-online-video-editor-for-beginners/)）
- **不満**：**単一トラック**の制約、書き出しが遅い、タスクごとに新しいタブが開いて煩わしい（[ToolJunction](https://www.tooljunction.io/ai-tools/flexclip)）

### CapCut

- **プレイヤー上で角を掴んで拡縮・ドラッグで移動・回転**が基本操作（[解説](https://itsreleased.co.uk/how-to-add-text-and-stickers-using-capcut-desktop-video-editor/)）
- 帯は**ドラッグで移動**、端にカーソルで**トリム**、**再生位置に吸着**、**ピンチ/ホイールでズーム**（[Filmora の解説](https://filmora.wondershare.com/advanced-video-editing/capcut-timeline.html)・[TechBabble](https://techbabble.co.uk/2026/03/05/how-to-trim-split-and-cut-clips-in-capcut/)）
- 画面構成＝**上にプレイヤー／中央にタイムライン／下に文脈依存のツールバー**（選んでいるものによって出る道具が変わる）

### nizima ACTION!!（うちに最も近い先行例）

- **ブラウザで動く**。インストール不要。**1〜5分の短尺**が主戦場（[公式](https://site.nizima-action.com/en/)・[紹介記事](https://castcraft.live/blog/441/)）
- 画面は **ワークスペース／キャンバス／タイムライン**の3領域。**キャンバスは「素材の配置や調整を行うエリア」**と明記され、選ぶとレイヤーの設定が開く（[マニュアル](https://docs.nizima-action.com/manual/top/)）
- レイヤーの種類＝文字・図形・調整・パノラマ・Live2D。**レイヤーパレットで管理**
- **キャラ（Live2D）を置いて表情・モーションを選ぶだけ**。音声から**自動で口パク**（[チュートリアル](https://docs.nizima-action.com/tutorials/top/)）
- 評価＝「**動画編集初心者が迷わない GUI**」（[castcraft](https://castcraft.live/blog/441/)）
- **示唆**：**うちと同じ土俵**（ブラウザ相当・短尺・キャラ中心・初心者）で、**キャンバスに置いて調整する**のが当然の作りになっている

### ゆっくりMovieMaker4（題材がほぼ同じ国産定番）

- 画面は**プレビュー／タイムライン／アイテム欄**の3領域（[解説](https://www.aiseesoft.jp/tutorials/how-to-use-ymm4.html)・[Live2Dの研究室](https://surume1ka.com/archives/2188)）
- **タイムラインへドラッグ＆ドロップで読み込み、マウスで動かす**
- **帯の表示サイズ（＝ズーム）を変えられる**。小さくすると多くの列が見えて使いやすい（[momohuku](https://www.momohuku.tokyo/post-138734/)）
- **示唆**：キャラ＋合成音声＋字幕という**同じ題材**でも、操作は**普通の動画エディタの型**（帯を掴む・ドラッグで置く）に従っている

### Vrew（別解＝台本から編集）

- **テキストを編集する感覚で動画を切る**。自動字幕・自動文字起こしが前提（[公式](https://vrew.ai/ja/)・[使い方](https://mowfile.com/vrew-how-to-use/)）
- 評価＝「**Adobe と違って初見でも分かる**」「裾野が広い」（[ITreview](https://www.itreview.jp/products/vrew/reviews)・[fummy](https://fummynokurashi.com/vrew_update_2025/)）
- **示唆**：うちは**台本（セリフ）を持っている**ので、この線も取れる。ただしタイムライン形式は「時間と空間の自由」を担う形式なので、**代替ではなく補助**

---

## 3. 横断して見えた「当たり前」

**どのツールにもあり、うちに無いもの**（#683 の監査と突き合わせ済み）。

| # | 当たり前 | うち |
|---|---|---|
| 1 | 画面は**素材／プレビュー／設定／タイムライン**の4領域 | **素材の欄が無い** |
| 2 | 素材は**ドラッグ＆ドロップ**で置ける（＋ボタンも） | **置く手段が無い**（テンプレ・音・読み上げのみ） |
| 3 | **キャンバスで掴んで動かす・角で拡縮** | **無い**（絵を貼っているだけ） |
| 4 | **数値でも同じ値を触れる**（ハイブリッド） | **無い** |
| 5 | 帯を**ドラッグで移動**・**端でトリム** | **無い**（ボタンのみ） |
| 6 | **吸着**（他の帯の端・再生位置）と、その**切り方** | 無い |
| 7 | タイムラインの**ズーム** | 無い |
| 8 | **分割**（再生位置で切る） | 無い |
| 9 | 設定欄は**セクション分け**（畳める） | 全部開いたまま縦に長い |
| 10 | **Space で再生**・`Ctrl+K` で分割・`Delete` で消す・**矢印で微調整**（Shift で大きく） | 再生は押せる。ほかは無い |

**キーボードの型**（[PremiumBeat](https://www.premiumbeat.com/blog/video-editing-j-k-l-shortcuts/)・[VideoEditingTips](https://videoeditingtips.net/5-essential-keyboard-shortcuts-every-new-editor-should-know/)）＝Space（再生/停止）・J/K/L（逆再生/停止/早送り）・`Ctrl+K`（分割）・Backspace/Delete（消す）・`Ctrl+Z`。
**キャンバスの型**（[Canva](https://graphicdesignresource.com/how-to-nudge-in-canva/)・[Figma](https://help.figma.com/hc/en-us/articles/360039956914-Adjust-alignment-rotation-position-and-dimensions)）＝矢印で1、Shift+矢印で10、**吸着は Shift/Ctrl を押している間だけ切れる**、Shift ドラッグで縦横比を保つ、Shift クリックで複数選択。

---

## 4. 初心者がつまずく所（調査）

1. **機能が多すぎて最初の画面で迷う**（Premiere・Resolve）。→ 対策は**モードを分ける**（Resolve の Cut ページ）か**画面の型を用意する**（Premiere のワークスペース）。
2. **簡単すぎて窮屈**（Canva・FlexClip）。トラックが分けられない／フレーム単位が触れない／単一トラック。→ **うちの利用者指摘と同じ言葉**。
3. **概念そのものが分からない**（時間軸・トラック・重ね順）。日本語の入門記事はどれも「**まず並べて、長さを詰めて、文字と音を足す**」という順で教えている（[メディア博士](https://media-hakase.com/column/article/page_737.html)・[bellwether](https://bellwether.click/contents/design/video-editing-steps/)）。
   → **その3手順が最短で通ることが、初心者にとっての「使える」**。いまのうちはこの3手順のうち**「並べる」と「長さを詰める」が帯の上でできない**。

---

## 5. うちへの示唆

1. **いまの状態は「Canva の不満」をそのまま踏んでいる**（自由度が無い・細かく触れない）。しかも Canva と違って**簡単でもない**（置く手段が無いので何も始まらない）。**最優先は「置ける・動かせる」**。
2. **一番近い先行例（nizima ACTION!!・ゆっくりMovieMaker4）は、どちらも"普通の動画エディタの型"に従っている**。キャラ中心・初心者向けでも、**帯を掴む／キャンバスで動かす**は省いていない。**独自の操作を発明しない**のが正解に見える。
3. **簡単さは「機能を削る」のではなく「モードを分ける」で出す**（Resolve）。うちは既に**場面形式（簡単）／タイムライン形式（自由）**という2形式を持っているので、**この分け方は既に正しい**。だからこそ**タイムライン形式では自由度を削ってはいけない**。
4. **ハイブリッド（キャンバス＋数値）**を最初から前提にする。初心者はドラッグ、細かい調整は数値（[UX Tigers](https://www.uxtigers.com/post/direct-manipulation)・[Lucid](https://lucid.co/techblog/2023/08/25/design-for-canvas-based-applications)）。
5. **マグネティック（自動で寄せる）は採らないほうがよい**。賛否が割れる仕組みで、うちは既に「同じ列で時間が重ならない」規則（`11 §8` V24）を持っているため、**重なる位置には置けない**という素直な形で足りる。

---

## 6. ADR-0034 で決めること（この調査から導いた論点）

1. **キャンバスのハンドルはいつ出すか**＝選んだら常に（CapCut・Canva）／ダブルクリックで（Premiere）。**初心者向けなら前者**か。
2. **テンプレ（見た目パターン）の中の要素をどこまで触れるか**（利用者判断＝触れるようにする）。**その動画だけの変更**と**見た目パターン自体の変更**の境目をどう見せるか。
3. **帯を動かしたときの振る舞い**＝重なる位置には置けない（V24 準拠）／吸着の対象と切り方。
4. **ズームの持ち方**（アプリの設定／動画ごと）と**既定の見え方**（長い動画で潰れない）。
5. **分割**の作法（再生位置・選択中の帯・両方が必要か）。
6. **キーボード**をどこまで揃えるか（Space・`Ctrl+K`・Delete・矢印は"当たり前"の範囲）。
7. **素材の欄**をどこに置くか（`ADR-0033` の欄として＝既定は左）。

---

## 7. 未確認（実機で確かめていないこと）

- nizima ACTION!! の帯の操作（ドラッグ移動・トリム・分割）の具体的な作法。マニュアルの目次からは存在が読めるが、細部は未確認。
- Clipchamp / FlexClip の吸着の有無と強さ。
- 各ツールのキーボード割り当ての網羅（代表的なものだけ確認）。

---

## 8. 出典

本文中のリンクを参照。主要なものを再掲：
[Adobe（直接操作）](https://helpx.adobe.com/premiere/desktop/get-started/source-and-program-monitor-adjustments/nudge-clips-in-program-monitor.html)/
[Adobe（帯の移動）](https://helpx.adobe.com/premiere/desktop/edit-projects/change-clip-sequence/different-ways-to-move-clips.html)/
[Adobe（吸着）](https://helpx.adobe.com/premiere/desktop/edit-projects/change-clip-sequence/snap-clips.html)/
[Apple（マグネティック）](https://support.apple.com/guide/final-cut-pro/intro-to-the-magnetic-timeline-verb8fcfc133/mac)/
[Blackmagic（Cut ページ）](https://www.blackmagicdesign.com/products/davinciresolve/cut)/
[Microsoft（Clipchamp）](https://support.microsoft.com/en-us/clipchamp/how-to-edit-a-video-in-clipchamp)/
[Canva ヘルプ](https://www.canva.com/help/creating-and-editing-videos/)/
[nizima ACTION!! マニュアル](https://docs.nizima-action.com/manual/top/)/
[ゆっくりMovieMaker4 の基本操作](https://www.momohuku.tokyo/post-138734/)/
[Vrew 公式](https://vrew.ai/ja/)/
[UX Tigers（直接操作）](https://www.uxtigers.com/post/direct-manipulation)/
[Lucid（キャンバスの設計）](https://lucid.co/techblog/2023/08/25/design-for-canvas-based-applications)/
[img.ly（タイムラインの設計）](https://img.ly/blog/designing-a-timeline-for-mobile-video-editing/)
