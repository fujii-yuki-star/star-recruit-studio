# 動き（キーフレーム）が付いた部品をキャンバスでつかんだとき、他社ソフトはどう振る舞うか

調査日: 2026-10-05／読み取りとウェブ調査のみ（リポジトリは変更していない）。
⚠️ Adobe の公式ヘルプ（helpx.adobe.com）は取得ツールが 403 で本文を読めなかった。Adobe 分は**検索結果の要約＋公式コミュニティ・解説記事**からの裏取りで、確度を「中」とした。Apple は公式ページ本文を一部取得できた。

---

## 0. すたりおの現状（コードを読んで分かったこと）

- **動きの値は「本来の箱からのずれ」**（相対値）＝x/y は箱に足す px、scale は倍率、rotation は足す度、opacity は掛ける濃さ（`src/domain/timeline/keyframeEdit.ts` 冒頭・`adr/0019` 決定「本来の状態を基準とする相対値」）。
  ⇒ **素の箱を動かせば、動き全体が形を保ったまま平行移動する**。これは After Effects で言う「親（ヌル）を動かす」「変形エフェクトを重ねる」と同じ構造を、**最初から持っている**ということ。
- キャンバスで掴めない理由はこれ：枠は**描かれている場所**（`finalBox`＝動きを足した後）に出るが、掴んだ結果は**素の箱**へ書き戻る＝動きのぶんだけ絵が飛ぶ（`src/app/screens/TimelineProjectScreen.tsx` の `canvasHoldReason`・#746-4）。
- 判定は `groupedBox` と `finalBox` が**その時刻で違うか**＝動きのずれが 0 の時刻（例: 最初のキーで x=0）では**掴めてしまい、掴んだら動き全体がずれる**。時刻によって掴める／掴めないが変わる、という割れが既にある。
- **矢印キーは動きの付いた部品でも効く**（`nudgeBoxRef`・素の箱に dx/dy を足す）＝**矢印ではすでに「動き全体を平行移動」している**。数値欄（位置・大きさ）も素の箱なので同じ。キャンバスのドラッグだけがこの道を持っていない。

---

## 1. ソフト別の比較

凡例：**A＝再生位置にキーを打つ/更新**（その時刻の値だけ変わる・他のキーはそのまま）、**B＝全キーを同量ずらす**（形を保った平行移動）。

| ソフト | 既定でキャンバスをドラッグすると | キーの間でドラッグ | 「形を保ってずらす」方法 | 確度 | 出典 |
|---|---|---|---|---|---|
| **Adobe After Effects** | **A**（ストップウォッチが入っていれば現在時刻にキーを追加/更新） | 自動でキーが増える | ①タイムラインで「位置」名をクリックして**全キーを選択**→コンポ上でキー点（またはレイヤー）をドラッグ＝**全キーが同量動く**（再生位置をキーの上に置くのがコツとされる）②**ヌルを親にして親を動かす**③プリコンポーズ④グラフエディタで全選択して縦にドラッグ | 中（公式ヘルプは 403・検索要約と公式コミュニティ） | [Editing, moving, and copying keyframes](https://helpx.adobe.com/after-effects/using/editing-moving-copying-keyframes.html)／[How do you move the entire path at once?（Adobe Community）](https://community.adobe.com/t5/after-effects-discussions/how-do-you-move-the-entire-path-at-once/m-p/14412126)／[Creative COW: moving all keyframes](https://creativecow.net/forums/thread/moving-all-keyframes/)／[Creative COW: move layer position without disrupting keyframes](https://creativecow.net/forums/thread/how-to-move-layers-position-without-disrupting-the/) |
| **Adobe Premiere Pro** | **A**（プログラムモニターでドラッグ＝再生位置にキー追加） | 自動でキーが増える | **複数キーの値を一度に変える機能は無い**（コミュニティの回答）。作法は**「トランスフォーム」エフェクトを上に重ねてそちらを動かす**、またはネスト | 中 | [Add keyframes in Premiere Pro（公式・本文未取得）](https://helpx.adobe.com/premiere/desktop/add-video-effects/control-effects-and-transitions-using-keyframes/add-keyframes.html)／[Larry Jordan: Add and Modify Keyframes in Premiere Pro](https://larryjordan.com/articles/add-and-modify-keyframes-in-adobe-premiere-pro/)／[Edit multiple Position keyframes at once（Adobe Community）](https://community.adobe.com/t5/premiere-pro-discussions/edit-multiple-position-keyframes-at-once/m-p/9447769) |
| **DaVinci Resolve（エディットページ）** | **A**（一度キーを置いたパラメータは、変更するたびに新しいキーが作られる） | 自動でキーが増える | 公式の「全体オフセット」は**未確認**。キーエディタで時間方向にまとめて動かすのは可 | 中（Larry Jordan の解説） | [Larry Jordan: Add and Modify Keyframes in DaVinci Resolve 20](https://larryjordan.com/articles/add-and-modify-keyframes-in-davinci-resolve-20/) |
| **DaVinci Resolve（Fusion）** | **A**（画面上のコントロールをドラッグ＝モーションパスにキーが自動で追加され、線が引かれる） | 自動でキーが増える | 既定のパスは「Displacement（パス上の進み具合）」と「パスの形」が分かれており、**形はそのまま**で進み具合だけ動かせる。全体の平行移動の公式手順は**未確認** | 中 | [Polyline Path（Resolve 18.6 マニュアル写し）](https://www.steakunderwater.com/VFXPedia/__man/Resolve18-6/DaVinciResolve18_Manual_files/part1829.htm)／[Mixing Light: Understanding Fusion's Path Modifier](https://mixinglight.com/color-grading-tutorials/understanding-the-fusion-path-modifier/) |
| **Final Cut Pro** | **A**（一度キーを置けば、再生位置を動かして値を変えると自動でキー追加。ビューアでは赤いモーションパス上に白い点としてキーが出る） | 自動でキーが増える | **値をまとめて動かす**＝複数キーを選び縦にドラッグすると「互いの関係を保ったまま」動く／**Command＋Option を押してドラッグ＝カーブ上の全キーを同量調整**（ビデオアニメーション表示） | 高（Apple 公式） | [Add video effect keyframes（Apple）](https://support.apple.com/en-az/guide/final-cut-pro/ver8e3f20ea/mac)／[Work with built-in effects（Apple・赤いパスと白い点）](https://support.apple.com/guide/final-cut-pro/work-with-built-in-effects-verfc8a4bdc/mac)／[Modify groups of keyframes（Apple）](https://support.apple.com/guide/final-cut-pro/modify-groups-of-keyframes-veraca9b445e/mac) |
| **Apple Motion** | 版により違う。5.0.1 は**B**（記録オフで動かすと全キーが比例して動いた）、5.0.2 以降は**A**（記録オフでも現在フレームにキーを作る）という利用者報告 | 自動でキーが増える（5.0.2 以降） | **パス上を Command＋Option クリックしてドラッグ＝パス全体（全キー）を移動**／キーの間の線分をドラッグ＝その区間だけ移動／キーフレームエディタで Command＋Option ドラッグ＝全キーをオフセット／グループに入れてグループを動かす | 中（Apple コミュニティ。公式「Modify animation paths」は本文を取得できず） | [Apple Community: How to turn off automatic keyframing in Motion](https://discussions.apple.com/thread/3701808)／[Modify animation paths in Motion（Apple・本文未取得）](https://support.apple.com/guide/motion/modify-animation-paths-motn14748beb/mac) |
| **CapCut（デスクトップ）** | **A**（再生位置を動かしてプレビューで動かすと自動でキー追加） | 自動でキーが増える | **未確認** | 低（第三者の解説のみ・公式未確認） | [How To Use Keyframes In CapCut PC（TechBloat）](https://www.techbloat.com/how-to-use-keyframes-in-capcut-pc-full-guide.html) |
| **Filmora** | **A**（公式：再生位置を動かしてプレイヤー上で位置を動かすと「キーが自動で作られる」）。「パスカーブ」を開くと**動きの道筋**を表示 | 自動でキーが増える | **未確認** | 高（公式ガイド） | [Keyframe Path Curve – Filmora for Windows Guide](https://filmora.wondershare.com/guide/keyframe-path-curve.html) |
| **PowerDirector** | **A**（公式：プロパティを変えると現在のスライダー位置にキーが自動追加） | 自動でキーが増える | **未確認**（プレビュー上のドラッグの詳細は公式から読み取れず） | 中 | [Utilizing PiP Keyframes（CyberLink 公式）](https://help.cyberlink.com/stat/help/powerdirector/19/enu/11_02_06_utilizing_keyframes.html) |
| **VEGAS Pro（イベントのパン/クロップ）** | 「カーソルに同期」が入っていれば**A**（現在位置にキー）。切ると常に先頭のキーを編集 | 同期が入っていれば自動でキー | **複数キーの値を一度に変えられない**（Movie Studio Zen のモデレーター回答。古い版で相対的に変わったという報告もあり版依存） | 中 | [Keyframe animation（MAGIX 公式 VEGAS 21）](https://help.magix-hub.com/video/vegas/21/en/content/topics/keyframes.htm)／[Movie Studio Zen: change many keyframes at once](https://www.moviestudiozen.com/forum/vegas-pro/3275-how-to-change-many-keyframes-at-once-in-event-pan-crop-window) |
| **ゆっくりMovieMaker4** | 直線移動などでは**再生位置で編集対象が変わる**＝アイテムの最初にいれば**開始値**、最後のフレームにいれば**終了値**が変わる（解説記事）。プレビューに終了位置の白い四角が出る | **未確認**（途中の時刻・中間点の間でドラッグしたときの扱いは確認できず） | **未確認** | 低〜中（解説記事のみ） | [モノイスト: YMMでキーフレームを使って画像・モザイクを動かす](https://studio.monoist.work/entry/key-frame-in-ymm)／[YMM4 v4.26.0.0 リリースノート（プレビュー上でアニメを変更できるように）](https://manjubox.net/ymm4/release/4.26.0.0/) |
| **AviUtl（拡張編集）** | 開始値／終了値を持つ方式。**現在フレームを確かめずにドラッグすると、終点を動かすつもりで始点を動かしてしまう**との注意がある＝**再生位置で対象が決まる**型と読めるが、細部は**未確認** | **未確認** | 時間方向は中間点を Shift ドラッグで間隔を保ってまとめて移動（タイムライン側）。空間の全体平行移動は**未確認**（グループ制御を使う作法が一般的だが出典未確認） | 低 | [AviUtl 中間点の使い方（vip-jikkyo）](https://vip-jikkyo.net/aviutl2-intermediate-point)／[aviutl.info 移動方法](https://aviutl.info/idouhouhou/) |
| **Canva（動画）** | キーフレーム方式ではない。「アニメーションを作成」で**要素をドラッグした軌跡がそのまま動きになる**（紫の破線で道筋を表示。Shift で直線） | 該当なし | **未確認**（作ったパスを後からまとめて平行移動できるか） | 中（公式ヘルプ・機能ページ） | [Canva Help: Apply, change, or remove animations](https://www.canva.com/help/animate-designs/)／[Canva: Motion Path Animator](https://www.canva.com/features/motion-path-animator/) |

---

## 2. 共通する「業界の型」

1. **既定は A（再生位置にキーを打つ）がほぼ全社共通**。一度でも動きを付けたプロパティは「自動記録」状態になり、**キーの間でドラッグすれば黙ってキーが1つ増える**（警告は出さない）。AE・Premiere・Resolve・FCP・Filmora・PowerDirector・CapCut が同じ。
   - 帰結：横移動して止まる動きの**途中**でドラッグすると、途中に寄り道の点が増え、**止まる位置は変わらない**。利用者の言う「止まる位置がずれる」は**既定の挙動ではない**。
   - 止まる位置を変えたいなら、**再生位置を止まるキーの上に置いてからドラッグ**＝そのキーだけ更新、が既定の作法。
2. **B（全体を形のまま平行移動）は「別の操作」として用意される**。既定のドラッグに混ぜない。出し方は3系統：
   - **修飾キー**：Motion のパス上 Command＋Option ドラッグ／FCP の Command＋Option で全キーを同量。
   - **全キーを選んでから動かす**：AE の「位置」名クリックで全選択→ドラッグ。
   - **一段上の入れ物を動かす**：AE のヌル親・プリコンポーズ、Premiere の「トランスフォーム」エフェクトを重ねる、Motion のグループ。**「動きは中に閉じ、置き場所は外で決める」**＝プロの定番。
3. **動きの道筋を見せる**：AE・FCP・Filmora（パスカーブ）・Canva（破線）・Fusion は**キャンバス上に軌跡と点**を描き、点（キー）を直接つかんで直せる。軌跡が見えていると「どこで止まるか」が画面で分かり、A と B の区別もつく。
4. **低価格・初心者向け（YMM4・AviUtl）は「開始値／終了値」型**で、再生位置が最初なら開始、最後なら終了を編集する。中間の扱いは公式に読み取れなかった。
5. 呼び名：「モーションパス／アニメーションパス（Motion）」「パスカーブ（Filmora）」「Path（Fusion）」。まとめて動かす操作は名前を持たず「全キーを選んでドラッグ」「パス全体を移動」と説明されることが多い。

---

## 3. すたりおで採れる選択肢

前提：すたりおの動きは**最初から相対値**なので、「素の箱を動かす＝動き全体の平行移動（B）」は**データを変えずに既にできる**（矢印キー・数値欄がそれ）。足りないのはキャンバスのドラッグを素の箱へ**差分（dx/dy）で**書くことだけ。

### 案1：ドラッグ＝動き全体を平行移動（B を既定にする）

- やること：掴んだ量（差分）を**素の箱**に足す。枠は描かれている場所（`finalBox`）に出したまま、確定は `box + Δ`。矢印キーと同じ規則なので、**作法の割れが消える**（ADR-0026②）。
- 利点：**利用者の希望そのもの**（横移動して止まる動きなら、止まる位置も始まる位置も同じだけずれる）。データ・描画・書き出しは無改造（ADR-0001 に触れない）。「時刻によって掴める／掴めない」が変わる今の割れも消える。動きが**崩壊しない**（キーが増えない）。
- 欠点：**業界の既定（A）とは逆**＝他社に慣れた人は「この時刻の位置だけ直したい」つもりで全体を動かす。ADR-0034（業界の型に合わせる）との整合を ADR で説明する必要。拡大・回転の付いた部品では、中心や支点の扱いで「つかんだ点が指から少しずれる」体感がありうる（平行移動だけなら問題なし）。大きさを変える取っ手・回転の取っ手は別途決める必要（素の箱の w/h・角度を変える＝倍率の動きはそのまま掛かる）。
- 「止まる位置がずれる」に合うか：**合う（そのもの）**。

### 案2：ドラッグ＝再生位置のキーを打つ/更新（A＝業界の既定）

- やること：再生位置にキーがあればその値を更新、無ければ**その時刻にキーを足す**。値は相対値なので「掴んだ量」をその時刻のずれに足す。
- 利点：**業界の型と一致**（ADR-0034 の趣旨に素直）。細かく道筋を作れる。
- 欠点：キーの間で触ると**黙って点が増え、動きの形が変わる**＝利用者の言う「崩壊」に近い。「止まる位置だけ直す」には再生位置を止まるキーへ合わせる手間が要る（キーへ跳ぶ道は既にある）。拡大・回転のキーは別の値なので、位置だけ触るつもりでも分割の扱いが要る。
- 「止まる位置がずれる」に合うか：**合わない**（途中で掴めば止まる位置は動かない）。止まるキーの上で掴んだときだけ合う。

### 案3：既定は B、修飾キーで A（または逆）

- やること：普通のドラッグ＝全体を平行移動（案1）。**Alt（など）を押しながら**＝再生位置のキーを打つ/更新（案2）。または業界寄りに「既定 A・修飾キーで B（Motion/FCP の Command＋Option の型）」。
- 利点：両方の要望を満たす。修飾キーで B を出すのは Motion・FCP に先例がある。
- 欠点：修飾キーは**見えない操作**＝ADR-0034 決定19（ドラッグ専用の操作を作らない／キーかメニューでも到達できること）を満たすため、**メニュー/ボタンにも同じ機能**を置く必要。説明文と検査が2倍。初心者向けの製品では隠し操作が発見されにくい。
- 「止まる位置がずれる」に合うか：**合う**（既定を B にした場合）。

### 案4：キャンバスに動きの道筋（軌跡と点）を描き、「本体＝全体」「点＝そのキー」で掴み分ける

- やること：選んだ部品の**位置の軌跡**を線で描き、キーごとに点を出す。**部品の本体を掴む＝全体平行移動（B）**、**点を掴む＝そのキーの位置だけ**（A に相当・時刻は変えない）。
- 利点：**見えている物を掴む**ので修飾キー不要。AE・FCP・Filmora・Canva が見せている「道筋」と同じ見せ方（業界の型）。「止まる位置だけ直したい」は終点の点を掴めばよく、「全部ずらしたい」は本体を掴めばよい＝両方が**画面上で区別できる**。
- 欠点：実装が一番重い（軌跡の描画・点の当たり判定・グループの動き・拡大回転の付いた動きの表示）。描画は仕上がり確認の上の**編集用の重ね描き**（書き出しには出ない）で、描画核には入れない設計が要る。
- 「止まる位置がずれる」に合うか：**合う**（本体を掴めば全体がずれる。加えて「止まる位置だけ」も直せる）。

### 推しの組み合わせ（参考）

段階1で**案1**（差分で素の箱へ＝矢印キーと同じ規則・最小差分で利用者の希望を満たす）→ 段階2で**案4**（道筋と点を出して、点＝そのキーを足す）。こうすると「本体を掴む＝全体（すたりおの相対値モデルと素直に一致）」「点を掴む＝そのキー」という役割分担になり、案3の隠し操作を作らずに A も B も手に入る。業界の既定（A）と違う点は ADR-0034 の追補として理由（相対値モデル・矢印キーとの一致・崩壊させない）を残す。

---

## 4. 未確認のまま残したもの

- Premiere・AE の公式ヘルプ本文（403 で取得不可。検索要約とコミュニティで裏取り）。
- Resolve エディットページの「全キーを同量ずらす」公式手順。
- CapCut・Filmora・PowerDirector の「全体を平行移動」機能の有無。
- YMM4・AviUtl で**キーの間の時刻**にドラッグしたときの扱い、空間の全体平行移動の手順。
- Canva で作ったパスを後から平行移動できるか。
