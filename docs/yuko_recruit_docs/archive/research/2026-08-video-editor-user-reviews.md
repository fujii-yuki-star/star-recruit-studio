# 調査：ユーザーレビュー横断 — 褒められる操作・機能／不満と改善要望

- **日付**: 2026-08-04
- **位置づけ**: **調査資料**（決定ではない）。[`2026-08-timeline-editing-ux.md`](2026-08-timeline-editing-ux.md)（ツール別の操作感）・[`2026-08-timeline-editing-ux-audit.md`](2026-08-timeline-editing-ux-audit.md)（監査と不足観点）に続く3本目。**特定のソフトに限らず**、世の中のユーザーレビュー・コミュニティの声を横断し、「よく褒められる・求められる操作/機能」と「よく不満・改善要望が出る操作/機能」を型として抽出した。**ADR-0034 と α-6 以降の計画の材料**。
- **調べた場所**: レビューサイト（[ITreview](https://www.itreview.jp/categories/video-editing)・[G2](https://www.g2.com/categories/video-editing)・Capterra）／App Store のユーザーレビュー／Adobe Community（不満・要望スレッド）／Yahoo!知恵袋／個人ブログ・note の使用記。
- **限界**: ①レビューは**不満側に偏る**（困った人ほど書く）②まとめ記事はアフィリエイト色があるため、**利用者の声そのもの**（レビュー原文・フォーラム・知恵袋）を優先した ③網羅調査ではない。個別の裏取りは出典から。

---

## 1. 先に結論（型の一覧）

**褒められる・求められるものの型**（§2）：

| # | 型 | 一言でいうと |
|---|---|---|
| P1 | 迷わない・すぐ始められる | 「開いて数分で1本できた」 |
| P2 | ドラッグ&ドロップで完結 | 「置いて、動かすだけ」 |
| P3 | テンプレ・おまかせで形になる | 「センスが無くても見られるものになる」 |
| P4 | AI の時短が「神機能」扱い | 自動字幕・文字起こし・無音カット |
| P5 | 難しいことが簡単にできる | キーフレームやトラッキングが怖くない |
| P6 | 軽い・速い・すぐ返事が返る | プレビューが待たせない |
| P7 | 無料・透かし無し | 期待水準そのものを作っている |

**不満・改善要望の型**（§3）：

| # | 型 | 一言でいうと |
|---|---|---|
| C1 | 落ちる・作業が消える | **信頼の根幹。不満の王様** |
| C2 | 重い・プレビューがカクつく | 同題材の YMM4 で最大の不満 |
| C3 | 書き出しが遅い・失敗する・画質が落ちる | 最後の最後で裏切られる |
| C4 | 取り消しが信用できない | 効かなくなる・戻せない操作がある |
| C5 | 学習コストが高い・機能が奥に埋まる | Premiere/Resolve 型の不満 |
| C6 | 自由度が無い・トラック分け不可・細かく触れない | Canva 型の不満（既知） |
| C7 | 精密な調整がしづらい | 「ドラッグで狙った時刻に止まらない」 |
| C8 | 既定の操作を勝手に変えられた | 挙動変更への強い反発 |
| C9 | 課金・透かし・サブスク | うちには薄いが期待水準に影響 |
| C10 | 重なると壊れる・列を並び替えられない | 「上書きで消える」への憎悪 |
| C11 | エラーが自力で解決できない | 初心者が離脱する引き金 |

---

## 2. 褒められている・求められている操作/機能

### P1. 迷わない・すぐ始められる

- iMovie・Camtasia・Movavi などのレビューで一貫して褒められるのは**機能の多さではなく「直感的で、初心者でもすぐ編集できた」**（[G2 のまとめ](https://learn.g2.com/best-video-editing-software)・[TechRadar 初心者向け](https://www.techradar.com/best/best-video-editing-software-beginners)）。
- 日本語圏でも「操作画面が極めてシンプルで、直感的にサクサク編集できる」（Canva 評・[コエテコ](https://coeteco.jp/articles/12362)）、「とにかく一回やってみたい人にぴったり」が推薦の決まり文句（[マイベスト](https://my-best.com/14676)）。
- **含意**: 元資料の結論（3手順「並べる→詰める→文字と音」が最短で通ること）の裏付け。**最初の1本までの時間**が褒め言葉の源泉。

### P2. ドラッグ&ドロップで完結

- Clipchamp・Movavi・VN などのレビューで「ドラッグ&ドロップで置ける・並べ替えられる」ことが繰り返し長所に挙がる（[Capterra: Movavi](https://www.capterra.com/p/228422/Movavi-Video-Editor-Plus/reviews/)）。
- **含意**: #684〜#686（置く・掴む）の優先度の裏書き。**「置く→動かす」が言葉の説明なしで通じる**ことが褒められる条件。

### P3. テンプレ・おまかせで形になる

- 初心者向けの推薦記事・口コミは「自動編集機能付き」を推す（色・明るさの自動調整、無音検出カット等・[コエテコ](https://coeteco.jp/articles/12362)）。
- **含意**: **うちの中核（AI が構成とセリフを作る・テンプレ駆動）はこの型のど真ん中**。タイムライン形式でも「見た目パターンを置く→差し込むだけ」が生きていること（ADR-0032「差し込み口は生きている」）はこの強みの延長線にある。**タイムライン形式で自由を出すために、この「おまかせで形になる」導線を壊さない**こと。

### P4. AI の時短が「神機能」扱い（求められている機能の現在地）

- **自動字幕・文字起こし**：「字幕入れの作業時間を90%以上削減」（Vrew 評・[omniweb](https://omniweb.jp/m138/)）。Vrew は[ITreview でも高評価](https://www.itreview.jp/products/vrew/reviews)で、翻訳付き SRT 出力まで含めて「便利」の声（[note の使用記](https://note.com/m_garage/n/n87ad2af6003f)）。
- **無音自動カット**：「カット作業が8割以上短縮」「90分→15〜20分」（Filmora 評・[パソログ](https://pc-bto.net/filmora-silence-detection/)・[使用記](https://hirogare-ongaku.co.jp/blog-205)）。トーク動画編集の定番時短として各所が推す（[CyberLink のまとめ](https://jp.cyberlink.com/blog/videoeditor/3278/best-video-software-to-shorten-editing-time)）。
- 背景除去・自動色調整・オートリフレームも同系（[G2](https://learn.g2.com/best-video-editing-software)）。
- **含意**: **うちは合成音声中心なので「無音カット」「文字起こし」の需要は構造的に薄い**（撮影素材のトークが無い）。一方、**「台本→声→字幕が自動で揃う」はまさにこの型の褒められ方をする位置**にある。タイムライン形式の声と字幕の連動（#633）は**この強みの移植**として重要度が高い。将来「撮影した動画素材」を本格対応する時（立ち絵に入れた動画＝#809。直接置き・差し込み口は land 済み）は、無音カット・文字起こしが**その時点の期待水準**になっていることに注意。

### P5. 難しいことが簡単にできる

- 初心者向けエディタのレビューで「モーショントラッキングやキーフレームが**驚くほど簡単**」が長所に挙がる（[G2](https://learn.g2.com/best-video-editing-software)）。
- **含意**: 機能を削るのではなく**入口を簡単にする**（場面形式の「ふわっと表示」プリセット⇄タイムライン形式の自由キーフレーム、という二層は既にこの型）。ADR-0034 のキャンバス直接操作も「キーフレームの1点目を怖くなくする」入口として効く。

### P6. 軽い・速い・すぐ返事が返る

- 「数分でクリップを並べて音楽を付けて出せた」というスピード感が褒め言葉として頻出（[TechRadar](https://www.techradar.com/best/best-video-editing-software-beginners)）。逆側（C2）の裏返しで、**操作への即時の返事**そのものが価値。
- **含意**: §3-C2 とセットで、タイムライン画面のプレビュー応答性能は「褒められる/貶される」の分水嶺。

### P7. 無料・透かし無し

- 無料で透かしが無いことがそれだけで推薦理由になる（[Primal Video](https://primalvideo.com/guides/best-free-video-editing-app-iphone-android/)・[Splice のまとめ](https://spliceapp.com/blog/best-free-video-editing-apps-without-watermark/)）。CapCut の無料版制限強化には不満が集中（同上・[eesel のレビューまとめ](https://www.eesel.ai/ja/blog/capcut-reviews)）。
- **含意**: うちは買い切り配布で該当が薄いが、**利用者の期待水準（「無料でもここまでできる」）はこれらのツールが作っている**ことは覚えておく。

---

## 3. 不満・改善要望

### C1. 落ちる・作業が消える（不満の王様）

- どのプラットフォームでも最上位の不満は**クラッシュとプロジェクト消失**。「アップデート後に不安定」「長尺で落ちる」（[Capterra 各所](https://www.capterra.com/p/122390/VideoPad/reviews/)）、「閉じて開いたら作業が消えていた」（[App Store: VN](https://apps.apple.com/us/app/vn-photo-video-editor/id1343581380?see-all=reviews)）、「完成品が勝手に前の版に戻った」（[Capterra: VEED](https://www.capterra.com/p/193780/VEED/reviews/)）。
- **含意**: **機能より先に信頼**。うちの自動保存（場面・タイムライン両形式）・「書けなかったときは成功に見せない」正典はこの型への正解。ただし**タイムライン編集画面には「保存された」ことを示す表示が無い**（自動保存は動くが無言。共通トップバーの保存表示は場面形式のものなので意図的に非表示＝正しいが、代わりが無い）。**控えめな保存状態表示（「保存しました」）をこの画面に置く**ことを提案する（→ §4-B4）。クラッシュ後に開き直したとき「ここまで残っています」が伝わることも同型の安心。

### C2. 重い・プレビューがカクつく（同題材の YMM4 で最大の不満）

- **題材がうちに最も近い YMM4 の不満はほぼこれ**：「プレビューがやたらカクつく」（[知恵袋](https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q10236674795)）、「再生ボタンを押してから約5秒待たされる」（[知恵袋](https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q10323498910)）、「再生ヘッドが動画アイテムに触れるたびに読み込み待ち」（[うしブロ](https://www.ushiblo.com/want-to-play-ymm4-video-item-smoothly/)）。
- 業界の定番対策は**プレビュー品質を下げる設定**（Premiere/Filmora とも「プレビュー品質を低にする」が定番アドバイス・[iSkysoft](https://www.iskysoft.jp/video-editing/video-jerky.html)・[しふぁチャンネル](https://shifa-channel.com/filmora-preview-kakukaku/)）。
- **含意**: うちのタイムライン形式は per-frame SVG 描画なので、**部品数が増えたときの再生・スクラブの応答**が同じ轍を踏むリスクがある。①ドラッグ・スクラブ中の描画は rAF スロットル（監査資料 §7）②**「プレビューの画質を下げる」逃げ道**を持つなら**表示解像度だけ**を落とす（レイアウトは正準関数のまま＝パリティ原則と両立。`layoutTimelineAt` はそのまま、ラスタライズ解像度だけ落とす）③再生開始の待ちを作らない（音源の先読みは既にある）。性能は α-7 #353 の守備範囲だが、**「操作モデルを直しても重ければ台無し」**という優先度の根拠がここにある。

### C3. 書き出しが遅い・失敗する・画質が落ちる

- 「書き出しに時間がかかりすぎる」「圧縮で画質が落ちる」「書き出し設定を制御できない」（[Capterra 各所](https://www.capterra.com/p/228422/Movavi-Video-Editor-Plus/reviews/)・[eesel: Descript](https://www.eesel.ai/blog/descript-reviews)）。
- **含意**: タイムライン形式は**常に全フレーム描画**（ADR-0032 決定22）なので書き出しは構造的に遅い側。**押す前に断る（既定）＋進み具合％＋中止**は正典化済みだが、**残り時間の目安**は無い。長尺で「進んでいるのか分からない」を作らないため、目安表示（「あと約N分」でなくとも「N/M フレーム」）の追加を α-6 候補に（→ §4-C1）。

### C4. 取り消しが信用できない

- 「1時間編集していると Undo/Redo が効かなくなる」（[Adobe Community バグ報告](https://community.adobe.com/bug-reports-728/undo-and-redo-stop-working-1330513)・[別スレッド](https://community.adobe.com/questions-729/premiere-pro-undo-and-redo-functions-have-stopped-working-in-both-22-6-4-and-23-4-1413029)）、「Undo したら真っ黒になって戻せない」（Adobe Express）、「Undo の無い機能で1時間の作業を失った」（Firefly）。
- **含意**: **「全部 Ctrl+Z で戻る」という信頼**は褒められる側には出てこないが、裏切ると最も憎まれる。うちのタイムライン形式は文書まるごとスナップショットで筋が良い。ただし監査資料 §2.2-7 の「**1文字＝1履歴で上限50から押し出される**」は、まさに「効くはずの Undo が戻らない」体験に直結する＝**#687 での確定時 commit 化の重要度をこの型が裏書き**する。場面形式でクリップ調整（`asset.clip`）が Undo 外である点（ADR-0028 で場面側は解決済み・素材画面側は対象外のまま）も、この型に照らすと**「戻せない操作がある」ことを画面が言わない**のは避けたい。

### C5. 学習コストが高い・機能が奥に埋まる（既知の再確認）

- Premiere「初心者に直感的でない・テンプレや自動編集を充実してほしい」（[ITreview](https://www.itreview.jp/products/premiere-pro/reviews)）。「基本操作がメニューの奥」「パネルが多くて圧倒される」は元資料どおり。
- **含意**: 元資料の結論（モードを分ける・独自操作を発明しない）を再確認。追加の示唆は**「よく使う操作ほど手前に」**＝帯の右クリック・キャンバスの直接操作・ツールチップにキー併記（監査資料 §5-A/K）。

### C6. 自由度が無い・トラック分け不可・細かく触れない（既知の再確認）

- Canva「トラック分けができない・細かいタイミング調整ができない」、FlexClip「単一トラック」、CapCut 無料版「実質シングルトラック化で複雑な編集は面倒」（[eesel](https://www.eesel.ai/ja/blog/capcut-reviews)）。
- **含意**: 元資料 §5-1 のとおり。**うちのタイムライン形式は「列は自由に足せる」が既に正しい**。この型は再掲のみ。

### C7. 精密な調整がしづらい（ハイブリッドの裏付け）

- 「ドラッグでは狙った時刻ちょうどに止まらない。開始・終了を数値で細かく指定したい」（[App Store: VLLO レビュー](https://apps.apple.com/us/app/vllo-video-editor-vlog-edits/id952050883?see-all=reviews)ほか）。プロ側でも「フレーム単位の正確さ」への要求は普遍。
- **含意**: **ドラッグ（速い）＋数値（正確）＋フレーム送り（微調整）の3点セット**が要る＝監査資料 §5-B/C/D/J（開始秒・長さの数値欄、←→のフレーム送り、吸着）と完全に一致。**吸着はこの型への答えでもある**（狙った位置＝他の帯の端・再生位置に「止まってくれる」）。

### C8. 既定の操作を勝手に変えられた（挙動変更への反発）

- Premiere がプレビュー上のホイールを「スクラブ→ズーム」に変えた変更には「[Make it stop please…super annoying](https://community.adobe.com/t5/premiere-pro-ideas/make-it-stop-please-scroll-wheel-in-program-panel-zooms-in-super-annoying-amp-dumb-new-feature/idi-p/14701157)」という強い反発スレッドが立った。
- **含意**: **一度出した既定の操作は変えにくい**。ADR-0034 で「ホイール＝何」「矢印＝何」「ドラッグ＝何」を**最初に正しく決める**ことの重み付け。あとから変えるなら設定で逃がす前提になる＝設計コストが跳ねる。

### C9. 課金・透かし・サブスク

- KineMaster・CapCut・Splice など、無料版の透かし・機能制限・サブスク誘導への不満は App Store レビューの定番（[Primal Video のまとめ](https://primalvideo.com/guides/best-free-video-editing-app-iphone-android/)）。Premiere はサブスクそのものへの不満（買い切りが欲しい・[ITreview](https://www.itreview.jp/products/premiere-pro/reviews)）。
- **含意**: うちに直接は該当しない（該当するのは VOICEVOX クレジット表示＝ADR-0025 で解決済み）。参考情報として記録。

### C10. 重なると壊れる・列を並び替えられない

- 「クリップを重ねると下のクリップが**破壊される**（上書き）のは最悪の仕様」「トラックをドラッグで並び替えさせてほしい（20年編集していて一番欲しい）」（Adobe Community の要望・[タイムライン表示の要望スレッド](https://community.adobe.com/feature-requests-730/timeline-views-1548039)ほか）。
- **含意**: **V24（重なる位置には置けない・上書きしない）はこの憎悪への構造的な正解**。「押しのけ（ripple）を入れない」判断もこの型と整合。列のドラッグ並び替えは要望としては実在する＝うちはメニュー（手前へ/奥へ）のみだが、**列数が少ないうちは後回しで良い**（監査資料 §9 のまま）。

### C11. エラーが自力で解決できない

- YMM4 は「エラー解決の難易度が高く、動画初心者には勧めない」とまで書かれる（[VideoProc の解説](https://jp.videoproc.com/edit-convert/ymm-mp4-strategy.htm)）。初心者の離脱要因は「細かい作業の積み重ね」と「詰まったとき自力で抜けられない」（[挫折の考察記事](https://movie-works.jp/video-edit-setback/)）。
- **含意**: **§2-5（エラーは次の行動）はこの型への正解**で、うちの差別化点。タイムライン形式の `TIMELINE_EDIT_*`/`TIMELINE_EXPORT_*` は既にこの流儀＝**新機能（ドラッグ・分割・取り込み）でもこの水準を守る**ことが「初心者が離脱しない」条件。

---

## 4. うちへの含意（まとめ）

### A. 既に正しい方向＝守る強み

1. **AI 構成＋テンプレ駆動**（P3 のど真ん中）と**台本→声→字幕の自動連動**（P4 と同型）。タイムライン形式へも #633 で移植済み。
2. **V24＝重ねて壊さない**（C10 への構造的正解）。
3. **エラーは次の行動**（C11 への正解・差別化点）。
4. **プレビュー＝書き出しのパリティ**（「書き出したら違った」という C3 の亜種を構造的に排除）。
5. **自動保存＋失敗を成功に見せない**（C1 への正解の半分。残り半分は下記 B4）。

### B. 不満の型を踏みかけている所（操作モデル作り直しと同時に手当て）

1. **プレビュー応答性能**（C2・YMM4 の轍）＝ドラッグ/スクラブの rAF スロットル・部品数が増えたときの再生応答。操作モデル（#683）を直しても重ければ「独特」が「重い」に置き換わるだけ。
2. **Undo の信頼**（C4）＝「1文字＝1履歴で上限50から押し出し」は実害になる前に #687 で確定時 commit へ（監査資料 §7-3 の裏書き）。
3. **精密調整の受け皿**（C7）＝数値欄・フレーム送り・吸着（監査資料 §5 と一致・追加なし）。
4. **保存されている安心感**（C1）＝タイムライン編集画面に**控えめな保存状態表示が無い**（自動保存は無言で動く）。「保存しました」を欄外の隅に出す。**要ADR判断ではない軽微改善**として #687 か独立の小 Issue へ。
5. **既定操作は最初に正しく**（C8）＝ADR-0034 でホイール/矢印/ドラッグの割り当てを決め切る重み付けの根拠。

### C. 新たに拾えた候補（α-6 以降・Issue 化の判断材料）

1. **書き出しの進み具合の粒度**（C3）＝現在は％と中止のみ。フレーム数（N/M）か残り目安の追加。タイムライン形式は常に全フレーム描画で構造的に遅い側なので効きが大きい。
2. **プレビュー画質を下げる逃げ道**（C2）＝表示解像度のみ落とす形ならパリティ原則と両立（レイアウトは正準のまま）。非力PC実測（#353）とセットで判断。
3. **クラッシュ復旧の見せ方**（C1）＝異常終了後に開き直したとき「前回の編集はここまで残っています」を一言出す（自動保存の存在を利用者が知らないと、不安だけが残る）。
4. **動画素材の本格対応時**（立ち絵に入れた動画＝#809。直接置き・差し込み口は land 済み）は、無音カット・文字起こし（P4）が**その時点の期待水準**になっている前提で企画する。

### D. 優先順位への示唆

レビューの声を重み順に並べると **C1 安定 > C2 性能 > C5/C6 操作性・自由度 > C7 精密さ**。うちの現在地は C6（自由度）と C5（独特さ）を #683 系で解消中＝正しい着手順。ただし**その次に来るのは C1/C2 であり、α-7 の #352（組み合わせ検証）・#353（性能）・#396（不具合調査ログ）の重要度は「レビューで最も憎まれる型」への備え**として読み直せる。

---

## 5. 出典

本文のリンクのとおり。主要なものを再掲：
[G2 まとめ](https://learn.g2.com/best-video-editing-software)／
[TechRadar 初心者向け](https://www.techradar.com/best/best-video-editing-software-beginners)／
[ITreview: Premiere Pro](https://www.itreview.jp/products/premiere-pro/reviews)／
[ITreview: Vrew](https://www.itreview.jp/products/vrew/reviews)／
[Capterra: VEED](https://www.capterra.com/p/193780/VEED/reviews/)／
[Capterra: Movavi](https://www.capterra.com/p/228422/Movavi-Video-Editor-Plus/reviews/)／
[App Store: VN](https://apps.apple.com/us/app/vn-photo-video-editor/id1343581380?see-all=reviews)／
[App Store: VLLO](https://apps.apple.com/us/app/vllo-video-editor-vlog-edits/id952050883?see-all=reviews)／
[Adobe Community: Undo 不具合](https://community.adobe.com/bug-reports-728/undo-and-redo-stop-working-1330513)／
[Adobe Community: ホイール挙動変更への反発](https://community.adobe.com/t5/premiere-pro-ideas/make-it-stop-please-scroll-wheel-in-program-panel-zooms-in-super-annoying-amp-dumb-new-feature/idi-p/14701157)／
[知恵袋: YMM4 プレビューのカクつき](https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q10236674795)／
[知恵袋: YMM4 再生5秒待ち](https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q10323498910)／
[パソログ: Filmora 無音検出](https://pc-bto.net/filmora-silence-detection/)／
[omniweb: Vrew 時短](https://omniweb.jp/m138/)／
[eesel: CapCut レビューまとめ](https://www.eesel.ai/ja/blog/capcut-reviews)／
[Primal Video: 無料アプリまとめ](https://primalvideo.com/guides/best-free-video-editing-app-iphone-android/)
