# 帯の端を「引きすぎた」ときの挙動 — 他社調査とすたりおの現状（2026-10-05）

> 調べたのは読み取りとウェブ調査だけ。リポジトリは変えていない。
> ⚠️ Adobe のヘルプ（helpx.adobe.com）と Blackmagic のフォーラムは取得が 403 で断られたので、Premiere と Resolve は**公式以外の解説・公式コミュニティの回答**に頼っている箇所がある。出典の種類を表に書いた。
> 「未確認」と書いたところは、推測で埋めていない。

---

## 1. ソフト別の比較

凡例：**止まる**＝端が限界より先へ動かない（限界で確定）／**断る**＝操作を受けず元のまま／**上書き**＝相手を削る／**押し出す**＝後ろをずらす（リップル）

| ソフト | ①素材の限界を越えて引いた | ②隣の帯にぶつかった | ③最小の長さより短く | ④長さの限界が無い素材（静止画・文字） | 出典 |
|---|---|---|---|---|---|
| **Premiere Pro** | **止まる**。情報欄に「Trim media limit reached」。限界の端は小さな白い三角で示す | 通常の選択ツールでは**隣の帯を越えられない（止まる）**。止まると「Trim blocked on Video 1」。越えたいならリップル／ロールに持ち替える | **1フレーム未満にはできない**（「minimum trim duration reached」の報告あり） | 静止画は**いくらでも伸ばせる** | [Adobe コミュニティ（Trim media limit）](https://community.adobe.com/t5/premiere-pro-discussions/trim-media-limit-reached-on-video-1/m-p/12707292)・[Adobe コミュニティ（Rolling／handles・白い三角）](https://community.adobe.com/t5/premiere-pro-discussions/rolling-edit-tool-quot-trim-media-limit-reached-on-footage-1-quot/td-p/11295234)・[Creative COW（Trim blocked）](https://creativecow.net/forums/thread/trim-blocked-on-video-1/)・[Larry Jordan（通常トリムは隙間を残す）](https://larryjordan.com/articles/premiere-trim-edits/)・静止画＝[premiereprotricks](https://premiereprotricks.com/change-duration-still-images-timeline/)（※ helpx は 403 で直接読めず） |
| **DaVinci Resolve** | **止まる**。端が**赤**＝もう素材が無い（緑＝まだ余りがある） | 選択モード：**未確認**（「隙間を残す」という解説と「上書きになる」という解説が食い違っていて、公式マニュアルに当たれなかった）。トリムモード（T）：端を引くと**リップル**（後ろを押す／引く）、継ぎ目を引くと**ロール** | **未確認** | **未確認** | [Videomaker（赤／緑の端）](https://www.videomaker.com/how-to/editing/editing-technique/how-to-use-the-trim-tool-in-blackmagic-davinci-resolve/)・[cutsio（スリップは素材の端で止まり、カーソルで知らせる）](https://cutsio.com/blog/davinci-resolve-smart-trimming-roll-ripple-slip-slide)・[davinciresolveclub](https://davinciresolveclub.com/trim-vs-blade-davinci-resolve/) |
| **Final Cut Pro** | **止まる**。「最大の長さまで伸ばすと、**クリップの端が赤くなる**」（公式） | 既定は**リップル**（後ろが押される＝ぶつからない）。位置ツール（P）は**上書き**して空いた所は隙間クリップで埋める | **未確認** | **未確認** | [Apple 公式：クリップを伸ばす／縮める](https://support.apple.com/guide/final-cut-pro/extend-or-shorten-clips-ver9847ec25/mac)・[Apple 公式：スリップ編集（端が赤＝素材の終わり）](https://support.apple.com/guide/final-cut-pro/make-slip-edits-ver1632d8e4/mac)・[Apple 公式：タイムラインで並べる（位置ツール）](https://support.apple.com/guide/final-cut-pro/arrange-clips-in-the-timeline-verc147f195/mac) |
| **CapCut（PC）** | 素材の端まで**戻せる**（＝それ以上は伸びない）。限界での見せ方は**未確認** | メイン列は「メイン列マグネット」で**隙間を作らない（押し出し・詰め）**。重ね列での衝突は**未確認** | **未確認** | **未確認** | [capcutguide（素材の端まで戻せる）](https://capcutguide.com/how-to-cut-trim-split-video-capcut/)・[eMotion Video の PC 版ガイド PDF（マグネット）](https://www.emotionvideo.com.au/wp-content/uploads/2025/05/The-2025-CapCut-Desktop-Guide-by-eMotion-Video-and-Media-Training.pdf) |
| **Filmora** | 素材の長さより先へは**伸ばせない**（公式サイトの解説記事） | **未確認** | **未確認** | **未確認** | [Filmora 公式ブログ（動画を長くする）](https://filmora.wondershare.com/video-editing/make-video-longer.html) |
| **VEGAS Pro** | ⚠️ **他と違う**：素材の終わりを越えて**伸ばせる**。「ループ」が入なら**繰り返し**、切なら音は無音。素材が終わる所に**小さな刻み（notch）**を出す | **未確認**（重なり＝自動クロスフェードになる型と言われるが、当たれなかった） | **未確認** | **未確認** | [VEGAS Pro 16 英語マニュアル PDF](https://files.bbystatic.com/AO37XI7GR2ciSfTb053kTQ==/c5b4a4a0-c7fe-4f33-94fd-fa7f379ae7c1.pdf)・[HelpMax（イベントの長さの調整）](http://vegaspro.helpmax.net/en/using-vegas-software/editing-events-on-the-timeline/adjusting-an-events-length/)（※ 直接取得は失敗＝検索の抜粋で確認） |
| **PowerDirector** | **未確認** | 帯を**置く**ときは「上書き／挿入／挿入して全体を動かす／クロスフェード」を**聞く**。トリム時は 2025-08 以降「自動リップル」ボタン | **未確認** | **未確認** | [CyberLink ヘルプ（動画・画像の追加）](https://help.cyberlink.com/stat/help/powerdirector/19/enu/07_01_01_adding_video_clips_an.html)・[CyberLink FAQ（自動リップル）](https://support.cyberlink.com/faq/auto-ripple-editing-powerdirector) |
| **YMM4** | **未確認**（端のドラッグ・「長さ」欄・右クリック「アイテムの長さを変更」で変えられることまでは確認） | **未確認** | **未確認** | **未確認** | [manjubox（v4.8.0.0 リリースノート）](https://manjubox.net/ymm4/release/4.8.0.0/)・[note（L.A.D. チュートリアル07）](https://note.com/laminadolor/n/n38d074982999) |
| **AviUtl（拡張編集）** | 動画ファイルは「元々もっている長さ以上に長くすることはできません」 | 環境設定⑩「端をつまむ時に隣接するオブジェクトを選択」を入れると**隣も一緒に変わる（ロール相当）**。切のときの衝突は**未確認** | **未確認** | 「写真やテキストなどのオブジェクトには元々の時間がありません」＝**長さは自由** | [fu-non（基本操作）](https://www.fu-non.net/aviutl/aviutl-edit-basic/aviutl-object-basic-edit.html)・[aviutl.info（拡張編集の環境設定）](https://aviutl.info/kakutyouhennsyuu-kannkyousettei/) |
| **Clipchamp** | 音は**縮めることしかできない**（＝素材の長さが上限）。動画の上限での挙動は**未確認** | **未確認**（隙間の一括削除はある） | **未確認** | **画像は既定の長さより伸ばせる**（公式） | [Microsoft 公式：トリムのしかた](https://support.microsoft.com/en-us/clipchamp/how-to-trim-videos-images-or-audio-assets)・[Microsoft 公式：画像の長さ](https://support.microsoft.com/en-us/topic/how-to-change-the-duration-of-an-image-on-the-timeline-215b0fb9-f3ae-49b3-b60f-d612d9403dab) |

### 編集モードごとの違い（確認できた範囲）

| モード | ぶつかったとき | 出典 |
|---|---|---|
| 通常トリム（Premiere 選択ツール） | 隣を越えられず**止まる**／縮めると**隙間が残る** | Larry Jordan・Creative COW（上表） |
| リップル（Premiere リップル、Resolve トリムモードの端、FCP 既定） | 後ろを**押す／引く**＝ぶつからない | Apple 公式・cutsio |
| ロール（継ぎ目を引く） | 片方を伸ばした分だけ相手を縮める。**どちらかの素材の端で止まる**（Premiere は「Trim media limit reached」） | Adobe コミュニティ・Videomaker |
| スリップ | 長さは変えず中身をずらす。**素材の端で止まり、端が赤**（FCP）／**カーソルで知らせる**（Resolve） | Apple 公式・cutsio |
| 位置／上書き（FCP 位置ツール） | 相手を**上書き**して削る | Apple 公式 |

---

## 2. 業界の型（調べた範囲で言えること）

1. **素材の限界では「止まる」が型**（Premiere・Resolve・FCP・AviUtl・Filmora・CapCut の解説すべて）。限界は**その場で知らせる**（FCP／Resolve の**赤い端**、Premiere の**情報欄の文言＋白い三角**）。
   **「離したら元に戻る」型は、調べた中に1つも無かった。**
2. ⚠️ **例外は VEGAS だけ**＝素材の終わりを越えて伸ばせて、**ループ（繰り返し）**するか音が無音になる。止まった場所には刻みを出す。
3. **隣の帯**は**モードで決まる**：通常トリムは**止まる**（Premiere）／リップルは**押す**／位置ツールは**上書き**。通常トリムで**上書きも押し出しもしない**ソフトでは、**止まる**が型。
4. **最小の長さ**は「**1フレーム未満にはできない**（止まる）」（Premiere の報告）。他は未確認。
5. **長さの限界が無い素材**（静止画・文字）は**いくらでも伸ばせる**（Premiere・AviUtl・Clipchamp の画像）。

---

## 3. すたりおの現状コード（どこで「元に戻る」が起きるか）

### 3-1. 流れ

| 段 | 場所 | 中身 |
|---|---|---|
| 指の位置→秒 | `src/app/screens/TimelineProjectScreen.tsx:2904-2908`（`at`） | `Math.max(0, origin + 移動量/pxPerSec)`＝**0 秒より前にはならない（止まる）** |
| ゴーストの形 | `TimelineProjectScreen.tsx:2802-2810`（`dragSpanOf`） | 端は指に付いていく。**最小の長さ（`TIMELINE_MIN_CLIP_SEC`＝0.1 秒・`src/domain/constants.ts:295`）でだけ止まる**。**隣の帯・素材の限界では止まらず、そのまま重なって見える** |
| 置けるかの判定 | `TimelineProjectScreen.tsx:2935-2937`（`issueOf`）→ `src/domain/timeline/edit.ts:428-436`（`trimClipIssue`）＝`trimClip` を走らせた結果 | 置けなければ理由を立てる |
| ゴーストの色 | `TimelineProjectScreen.tsx:2979`（`issue` を持つ）・`:4695`（`drop-target--blocked`） | 置けない間は**赤**（決定10「ゴーストの色で示す」） |
| 離したとき | `TimelineProjectScreen.tsx:2998-3010` → `src/app/store/timelineStore.ts:1325-1326`（`trimClipById`）→ `:2941-2957`（`applyEditTo`） | `trimClip` が `ok` でなければ**文書を変えず `editBlocked` に理由だけ立てる**（`:2956`）＝**これが「元の長さに戻る」の正体**（コメントも `TimelineProjectScreen.tsx:2262-2265`・`:2999-3000` で「離したら元の位置へ戻す＝決定10」と明言） |

### 3-2. `trimClip`（`src/domain/timeline/edit.ts:615-658`）が断る／止める条件

| 引きすぎの種類 | いまの結果 | 場所 |
|---|---|---|
| **0 秒より左へ** | **止まる**（0 で確定） | 画面 `at` の `Math.max(0, …)`（`TimelineProjectScreen.tsx:2907`）＋`applyClipEdge` の開始下限（`src/domain/timeline/clipEdge.ts:78-79`） |
| **最小の長さ（0.1 秒）より短く** | **止まる**（0.1 秒で確定） | `clipEdge.ts:70-71`（右端）・`:78-81`（左端）／ゴーストも `TimelineProjectScreen.tsx:2807-2808` で止まる |
| **隣の帯に重なる**（伸ばしすぎ） | **断る＝元に戻る**＋「その場所には先に置いてある部品があります。ずらすか、列を足して重ねてください」 | `edit.ts:654-655` → `placementIssue` の `isFreeSpan`（`edit.ts:396`・`EDIT_BLOCKED.overlap`）／文言 `src/app/uiLabels.ts:1012` |
| **左端を詰めすぎて素材を使い切る**（頭出しが素材の実尺・切り出しの終わりを越える） | **断る＝元に戻る**＋「そこまで詰めると、動画を使い切った後から流れます…」 | `edit.ts:646-648`（`usesUpSource`＝`src/domain/timeline/sourceTime.ts:84-112`）／文言 `uiLabels.ts:1053-1054` |
| 固定した列・連動字幕 | 断る（掴む前に `grabbableClip` で弾く道もある） | `edit.ts:626-628` |

### 3-3. ⚠️ 調べていて見つけた、「元に戻る」とは別の2点（参考）

1. **右端を素材の終わりより先へ伸ばすと、断らずに通る**＝`trimClip` は右端について素材の実尺を見ていない（`usesUpSource` を通すのは `headSec > 0`＝左端を詰めたときだけ・`edit.ts:646`）。書き出しは**最後のコマで止める**（`src/renderer/export/buildTimelineFrames.ts:114`）。
   → 他社の型（素材の端で止まる）とも違うし、VEGAS のループとも違う「**止め絵で伸びる**」挙動。意図した仕様かは正典を当たっていない（**未確認**）。
2. **左端を素材の頭より前へ伸ばしても断らない**＝頭出しは `clampSourceStart` で **0 に止まる**（`sourceTime.ts:29-43`）のに、帯の開始は伸ばした分だけ左へ動く（`edit.ts:649-653`）。
   → **素材の頭は 0 のまま帯だけが左へ伸びる**ので、**中身が右へずれる**（それまで時刻 T に映っていた絵が後ろへ動く）。決定10 の「勝手に寄せない」より重い「**黙って別の結果にする**」（ADR-0026④）にあたる可能性がある。**画面で確かめてはいない**（読んだだけ）。

> ゆえに「引きすぎると元に戻る」は**隣の帯とのぶつかり**と**左端を詰めすぎて素材を使い切る**の2つで起きる。0 秒と最小の長さは**すでに「止める」**で、**同じ画面の中で2つの流儀が混ざっている**（ADR-0026② の観点）。

---

## 4. ADR-0034 決定10 との関係

- 決定10（`docs/yuko_recruit_docs/adr/0034-timeline-interaction-model.md:87`）：「置けない位置＝**勝手に寄せない**。ドラッグ中は**ゴーストの色で『置けない』を示し**、離したら**元の位置へ戻す**。理由の文言は**離したときだけ**出す」。
- 決定10 は**帯を動かす（move）を主に想定した書き方**（「置けない位置」「元の位置へ」）だが、コードは**トリムにも同じ規則を当てている**（`TimelineProjectScreen.tsx:2262-2265`）。
- 決定10 は、ADR-0034 で「利用者に確認して決めたこと」3件（決定2・8・21・同 `:65-69`）には**入っていない**＝ADR が自分で決めたもの。ADR-0048 で UX を優先して改めてよい類。ただし今回は**利用者が方向を決めたいと言っている**ので、決める前に利用者に確認する。
- 決定11（`:88`）「押しのけ（ripple）・マグネティックは**採らない**」と V24（同じ列で時間が重なるのは禁止）があるので、**「押し出す」「上書きする」は選択肢から外れる**（変えるなら決定11 から見直しになる）。

---

## 5. 採れる選択肢

### 案A：**トリムだけ「限界で止めて確定」**（業界の型）＋**帯の移動は決定10 のまま**

- 端は**隣の帯の端・素材の限界（左端を詰める側）・0 秒・最小の長さ**で**止まる**。ゴーストも**そこで止まって**見える（指は先へ行ってよい）。離すと**止まった位置で確定**。
- 止まっている間は**端の色で知らせる**（FCP／Resolve の赤い端の型）。文言は**出さない**か、離したときに「ここまでです」程度の短いものに（決定10 の「明滅させない」を守る）。
- **ADR-0034 決定10 の改訂が要る**（「トリムでは**限界で止めるのは寄せではない**」と明記する追補）。理由：①調べた範囲の通常トリムは全部「止まる」で「元に戻る」は無い ②0 秒と最小の長さは**既に止めている**ので、**同じ操作の中で流儀が割れている**（ADR-0026②）のが揃う ③判断軸1「独自の操作を発明しない」に合う。
- 決定11（押しのけ不採用）・V24 には触れない。
- 実装の要点（参考）：止める位置の計算は `trimClip` を何度も走らせて探すより、**隣の帯の端と素材の限界から上限・下限を出す純粋関数**を domain に1つ置き、ゴースト（`dragSpanOf`）と確定（`trimClipById` に渡す秒）が**同じ値を見る**形にする（いまの「見せたものを確定する」＝`lastShownSec` の流儀に乗る）。数値欄（`TimelineProjectScreen.tsx:4892`）からの入力は**打った値を勝手に変えない**ほうが自然＝**断るまま**にするか別に決める。

### 案B：**いまの「元に戻す」を保ち、知らせ方だけ直す**（決定10 は改めない）

- ゴーストを**限界のところで区切って**見せる（限界より先は薄く・斜線など）＋赤。離したときの文言で「どこまでなら置けるか」を言う。
- 決定10 は**そのまま**。
- 代わりに、①他社に無い型のまま ②0 秒・最小の長さは止まるのに隣と素材の限界では戻る、という**割れが残る**。監査の指摘（戻ってしまう）にも**答えていない**。

### 案C：**移動にも「止める」を広げる**（全部「限界で止める」へ）

- 帯を動かして隣にぶつかったら、**ぶつかった所で止まる**。
- 決定10 を**丸ごと改める**ことになる。帯の移動は**別の列へ運べる**（`trackAt`）ので、止めると**列またぎの途中で横だけ止まる**などの**新しい挙動を設計し直す**ことになる。また**移動で止める型は他社で調べていない**（**未確認**）。今回の範囲を越えるので**勧めない**。

> （押し出す・上書きする案は決定11 と V24 に反するので挙げない。）

### 推奨

**案A**。根拠は §2-1（素材の限界は「止まる」が型、「元に戻る」型は見つからなかった）と §3-2（0 秒と最小の長さは既に「止める」）。決定10 は**トリムに限って追補で改める**。あわせて §3-3 の2点（右端を素材の終わりより先へ伸ばせる／左端を伸ばすと中身がずれる）も、**同じ「素材の限界」の話**なので、案A の上限・下限にまとめて入れるかを利用者に聞くとよい。

---

## 6. 未確認として残したもの

- Resolve の選択モードで隣の帯にぶつかったとき（止まる／上書き）。最小の長さ。静止画。
- FCP・CapCut・Filmora・PowerDirector・YMM4・Clipchamp の「最小の長さ」と「隣にぶつかったとき（通常モード）」。
- YMM4 で動画を素材の長さより先へ伸ばしたとき。
- VEGAS で隣にぶつかったとき。
- Premiere の公式ヘルプの原文（helpx が 403）。
