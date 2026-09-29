# 別窓は後回しにし、ドロップ先を広げる

**結論：すたりおが先に作るべきなのは「欄を別窓に切り離す仕組み」ではありません。「エクスプローラーからタイムラインへ直接落とせること」です。**

欄をアプリの窓の外へ切り離して別窓にできるのは、プロ向けのドッキング式製品に限られます。Premiere Pro・VEGAS Pro・Kdenlive・OpenShot・Shotcut と、2025年9月以降の YMM4 です。一般向けの Clipchamp・PowerDirector・Filmora・Camtasia は、「プレビューだけを全画面または2画面目へ」に絞っています。どの製品も、別窓を入れた直後に次のような不具合を出しています。

- 窓が画面の外へ消える
- 別窓でキーが効かない
- 戻し方が分からない

一方、エクスプローラーからのドロップは、ほぼすべての製品が**素材の一覧とタイムラインの両方**で受けます。タイムラインで受けたときは「取り込み＋その場所へ配置」になるのが業界の標準です。すたりおは今、取り込みボタンの枠の上でしか受けていません。これが最も大きな差です。

事務職の利用者に効く順に並べると次のとおりです。

1. タイムラインと窓全体へのドロップを広げる
2. 「置く」欄をサムネイルの格子にする
3. タイムライン画面にセーフエリアと表示倍率を入れる
4. プレビューを窓の中で全画面にする（編集はできない確認専用）

本当の別窓（2画面目への確認用の出力）を作るのは、撮影の後に ADR を書いてからで十分です。**任意の欄を切り離す仕組みは作りません。**

## 切り離しは3つの型に収束し、一般向けは「プレビューだけ」に絞っている

**事実（出典あり）。** 任意の欄を別窓にする操作は、どの製品でも3つの型のどれかです。

- タブを窓の外へドラッグする
- 欄のメニューで「Undock」を選ぶ
- 見出しの切り離しアイコンを押す

戻すときは、別窓をドッキングの目印の上へドラッグします。これはほぼ共通です。

Premiere Pro はメニュー・Ctrl＋ドラッグ・タブのドラッグの3通りを持っています（[Adobe Premiere Elements help](https://helpx.adobe.com/premiere-elements/desktop/using/dock--undock--group-and-float-panels.html)）。Kdenlive は見出しのアイコンで切り離し、戻すときは上下左右・中央の目印が色で落ち先を示します（[docs.kdenlive.org](https://docs.kdenlive.org/en/user_interface/customizing_interface.html)）。

DaVinci Resolve と Final Cut Pro は、任意の欄を切り離させません。**決まった区画を2画面目へ送る**方式です。Final Cut Pro が2画面目へ送れるのは Viewer・Browser・Timeline の3つだけで、**ボタン1つで全部が1画面目へ戻ります**（[Apple Support](https://support.apple.com/guide/final-cut-pro/use-a-second-display-verfa85dcd9e/mac)）。

**一般向けの製品は、どれも出し方を1つに絞っています。**

| 製品 | 出し方 | 出典 |
|---|---|---|
| Clipchamp | プレビューを全画面にするだけ。全画面の中では**編集できない**。Esc で戻る | [Microsoft Support](https://support.microsoft.com/en-us/clipchamp/how-to-preview-a-video-in-full-screen-mode) |
| PowerDirector | プレビューを2画面目へ出す「Dual Preview」 | [CyberLink help PD18](https://help.cyberlink.com/stat/help/powerdirector/18/enu/03_05_05_display_preview_options.html) |
| Filmora（Windows） | Timeline Monitor と Source Monitor の2つだけを窓として移せる | [Filmora Guide](https://filmora.wondershare.com/guide/dual-monitor-setup-editing.html) |
| CapCut（デスクトップ版）・Canva | 動画編集で2画面目へ出す機能の資料が見つからない | — |

実際に2画面目へ出される欄は、プレビューとスコープが大半です。YMM4 でも、切り離す目的として最もよく挙げられるのは「プレビュー画面を独立させる」です（[ymm4note](https://scrapbox.io/ymm4note/%E3%83%97%E3%83%AC%E3%83%93%E3%83%A5%E3%83%BC%E7%94%BB%E9%9D%A2%E3%82%92%E7%8B%AC%E7%AB%8B%E3%81%95%E3%81%9B%E3%81%9F%E3%82%8A%E7%B7%A8%E9%9B%86%E3%83%AC%E3%82%A4%E3%82%A2%E3%82%A6%E3%83%88%E3%82%92%E5%A4%89%E3%81%88%E3%81%9F%E3%81%84)）。

**すたりおの利用者層に最も近い前例は YMM4 です。これは警告として読むべき前例です。** YMM4 は v4.45.0.0（2025-09-01）でドッキングに対応しましたが、次のことが起きています。

- 切り離した後に文字入力が表示されない、落ちる、という報告が出て、旧版へ戻すよう勧められた（[Ｇスカのブログ](https://gska.hatenablog.jp/entry/2025/09/03/111946)）
- v4.52 でも「ドッキングした窓がフローティングに戻せない」という問い合わせがある（[relief.jp](https://www.relief.jp/docs/ymm4-docked-window-cannot-undock-to-floating.html)）
- 「ドッキングUIに馴染みがない方へ」という解説記事が書かれている（[note: Bluemist](https://note.com/bluemist/n/n0ecf3f1ce2e7)）

**落とし穴は製品をまたいで同じです。**

- **画面外へ消える**：Premiere Pro は2画面目を外すと、欄が消えた画面に残る（[Adobe Community](https://community.adobe.com/t5/premiere-pro/project-window-stuck-off-screen-any-ideas/m-p/9659097)）。AviUtl も再生窓が画面外へ出る（[SoundNote](https://soundnote.net/aviutl-preview-window-away/)）
- **別窓でショートカットとドラッグが効かない**：Premiere Pro 14.5 で起きた（[Adobe Community](https://community.adobe.com/questions-729/bug-with-floating-panels-in-14-5-1370650)）
- **動かしている途中で誤ってドッキングされる**：Kdenlive のマニュアル自身が注意している
- **切り離した Canvas が出てこない**：Camtasia 2019 の報告（[TechSmith community](https://support.techsmith.com/hc/en-us/community/posts/360071755632-Detach-Canvas-Camtasia-2019-0-3-Where-did-it-Go)）

2画面目が消えたときに**自動で救う仕組みを公式に書いている製品は見つかりませんでした**。どの製品も「配置をリセット」という手動の救済メニューで対処しています。Premiere Pro の Reset to Saved Layout、Resolve の Reset UI Layout、OpenShot の Simple View、AviUtl の「ウィンドウの位置を初期化」です。

**推論。** すたりおの利用者は動画編集に詳しくない事務職です。任意の欄を切り離す仕組みは、「元に戻せない」という問い合わせを生むだけで、得るものがほとんどありません。すでに入っている「欄の一時最大化」と「配置の型」で、画面を広く使いたい需要の大半は満たせています。残る需要は「プレビューを大きく／別の画面で見たい」だけです。これには Clipchamp 型の全画面プレビュー（確認専用）で先に応え、2画面目への出力は後から足すのが順当です。

## Tauri では「読むだけの窓」は現実的、「編集できる別窓」は割に合わない

**事実（出典あり）。** Tauri v2 は、JS からも Rust からも2つ目の窓を作れます。

- JS は `new WebviewWindow(label, {url, fullscreen, alwaysOnTop, parent, x, y, ...})`、窓の状態は `setFullscreen`／`setAlwaysOnTop`
- 画面の一覧は `availableMonitors()`・`monitorFromPoint()`・`workArea`

以上の出典は [Tauri JS API: webviewWindow](https://v2.tauri.app/reference/javascript/api/namespacewebviewwindow/) と [Tauri JS API: window](https://v2.tauri.app/reference/javascript/api/namespacewindow/) です。

ただし、次の制約があります。

- **JS から窓を作るには `core:webview:allow-create-webview-window` の許可が要ります。これは既定の許可には含まれません**（出典は上の webviewWindow のページ）。
- 権限（capability）は窓の名前（label）単位で与えるので、新しい窓の名前を権限に書き足す必要があります（[Tauri: Capabilities](https://v2.tauri.app/security/capabilities/)）。
- **窓どうしで JS の状態は共有されません。** 窓の間で状態を渡す手段は次のとおりです。
  - Tauri のイベント：中身は常に JSON の文字列で、大きなデータには向かない（[Tauri: Calling the Frontend](https://v2.tauri.app/develop/calling-frontend/)）
  - 非公式の `@tauri-store/zustand`
  - 各窓が互いに状態を送り合う方式：採用例の Hopp は「同期中にイベントを取りこぼしうる」と自ら認めている（[Hopp blog](https://www.gethopp.app/blog/tauri-window-state-sync)）

Windows では、次の既知の問題が効いてきます。

| 問題 | 出典 |
|---|---|
| 隠した状態で動的に作り、後で `show()` した窓は、ファイルのドロップを一切受けない（未解決） | [Issue #14643](https://github.com/tauri-apps/tauri/issues/14643) |
| 拡大率の違う画面の間で窓を動かすと、大きさや位置が乱れる | [Issue #12043](https://github.com/tauri-apps/tauri/issues/12043) |
| 画面の抜き差しを知らせるイベントは見つからなかった | — |

画面の抜き差しへの備えとしては、公式の window-state プラグインが使えます。このプラグインは、保存した位置が今あるどの画面とも重ならなければ、位置を戻しません（[plugins-workspace window-state](https://raw.githubusercontent.com/tauri-apps/plugins-workspace/v2/plugins/window-state/src/lib.rs)）。

**推論。** すたりおの取り消し（ADR-0020）と自動保存は、状態の持ち主が1つであることを前提にしています。別窓が互いに状態を送り合う方式は、この前提と両立しません。別窓を作るなら、次の段階のうち **2段目の「読むだけの窓」で止めるべき**です。

| 段 | 中身 | 状態の流れ | 評価 |
|---|---|---|---|
| 1 | 窓の中でプレビューを全画面にする（Fullscreen API か `setFullscreen`） | 窓の間の通信なし | 最も安い |
| 2 | 2画面目に確認用の窓を出す | 本体→窓の一方向。文書と再生位置を送り、同じ描画核で描く（ADR-0001 の一致が保てる） | ここで止める |
| 3 | 2に「常に手前」を足した小窓 | 2と同じ | 2の延長 |
| 4 | 編集できる別窓 | 双方向。次のすべてが要る。M〜L では収まらない（**作らない**） | 作らない |

4段目で必要になるもの：

- 操作は本体へ命令として送り、本体の store で適用する
- ショートカットも本体へ回す
- ファイルのドロップは別窓で受け、本体の取り込みの道へ渡す（ADR-0024）
- 窓ごとに `devicePixelRatio` を取り直す

2段目を作るときに守ることは次の5つです。

1. **隠して先に作らない**（#14643）
2. 開くときに `availableMonitors()` で画面の範囲内かを確かめ、外なら主画面へ寄せる
3. 本体を閉じたら一緒に閉じる
4. 「全部を1つの窓に戻す」ボタン1つで閉じられるようにする（Final Cut Pro 型）
5. **開発版ではなく MSI で確かめる**。同じ束を読むので、CSP の落とし穴（packaged で eval が無いと白画面になる件）も同じように踏む

新しい窓を開く・画面を選ぶ・位置を覚える、というのは ADR-0033（配置は `localStorage`）の範囲を広げます。そのため **ADR が先に要ります**。

## エクスプローラーからのドロップは「タイムラインで取り込み＋配置」が業界の標準

**すたりおの現状（コードで確認）。** OS からのドロップは `src/infrastructure/fileDropEvents.ts` で窓全体として受けています。そのうえで、どの枠の上に落ちたかを座標で判定しています。ただし、判定して取り込むのは `useAssetPicker`（`src/app/hooks/useAssetPicker.ts:114-119`）を使う**取り込みボタンの枠だけ**です。タイムラインやプレビューに落としても何も起きません。

**事実（出典あり）。** 主要製品の多くは、タイムラインを正式な落とし先にしています。

| 製品 | タイムラインに落としたときの挙動 | 出典 |
|---|---|---|
| Premiere Pro | Project 欄へ取り込み、開いているシーケンスに追加する | [Adobe](https://www.adobe.com/id_en/learn/premiere-pro/web/import-file-directly) |
| VEGAS Pro | Project Media に足し、落とした場所に部品を作る。トラックの無い場所に落とすと新しいトラックを作る | [VEGAS Pro 2026 help](https://cdn.borisfx.com/borisfx/Documentation/vegas/2026/en/content/topics/4-media/adding_mediafilesproject.htm) |
| Final Cut Pro | 今のプロジェクトのイベントへ取り込み、配置する。静止画の既定の長さは4秒 | [Apple Support](https://support.apple.com/guide/final-cut-pro/drag-clips-to-the-timeline-ver4e30143/mac) |
| Shotcut | タイムラインで受ける | [Shotcut User Guide](https://www.shotcut.org/stockmedia/Shotcut%20User%20Guide.pdf) |
| PowerDirector | Media Room とタイムラインの両方で受ける | [Tom's Tech Notes](https://www.tomstechnotes.com/pdquickstart) |
| YMM4 | 画面下のタイムラインに直接落とす方法が「簡単な方」として紹介されている | [L.A.D. note](https://note.com/laminadolor/n/n38d074982999) |
| AviUtl | タイムラインに落として読み込む | [fu-non](https://www.fu-non.net/aviutl/aviutl-edit-basic/aviutl-timeline-footage-load.html) |

素材の一覧を先に通す製品もあります。DaVinci Resolve の案内は Media Pool 経由で、タイムラインへ直接落とせないという相談には Media Pool を通すよう答えています（[Lowepost](https://lowepost.com/forums/topic/1082-cant-drag-media-into-timeline-in-davinci-resolve/)）。OpenShot（[OpenShot Files](https://www.openshot.org/static/files/user-guide/files.html)）と Camtasia（[TechSmith](https://www.techsmith.com/learn/tutorials/camtasia/import-manage-media/)）も、公式資料は一覧を先に通す形です。Clipchamp は窓の上に「ドロップゾーン」を出して Media タブへ取り込みます（[HelpDeskGeek](https://helpdeskgeek.com/how-to-use-the-windows-11-video-editor-clipchamp/)）。

窓全体で受けて取り込むだけ、という受け皿も普通です（Clipchamp、VEGAS Pro の「VEGAS Pro の窓へ」）。

複数のファイルを落としたときの扱いは、製品ごとに次のとおりです。

- 既定では、落とした列に端から順に並べる
- VEGAS Pro は右ドラッグで「時間方向に並べる／列方向に並べる」を選べる
- YMM4 は v4.8.0.0 で「複数アイテム追加時の並び順」を設定に足した（[YMM4 4.8.0.0](https://manjubox.net/ymm4/release/4.8.0.0/)）。落としたときの順番が利用者の期待と合わなかったことを示している

**プレビューへのドロップは要注意です。** OS から直接プレビューへ落として「画面上に置く」と説明している製品は見つかりませんでした。AviUtl では、プレビュー（メイン窓）に落とすと「タイムラインでの編集とは別物」として開かれ、混乱のもとになっています（[fu-non](https://www.fu-non.net/aviutl/aviutl-edit-basic/aviutl-timeline-footage-load.html)）。

外への書き出しをエクスプローラーへドラッグして行う例は、調べた製品の中に1つもありませんでした。Final Cut Pro の標準は File > Share です（[Ripple Training](https://www.rippletraining.com/blog/final-cut-pro-x/batch-export-clips-edited-final-cut-pro-timecode-window-burn/)）。

**推論と提案。** すたりおは、次の3段で広げるのがよいと考えます。

1. **窓全体を「取り込むだけ」の受け皿にする**（S）
   - ファイルが窓に入った時点で、ドロップゾーンの表示を重ねる（Clipchamp 型）
2. **タイムラインの列の上では「取り込み＋落とした時刻と列に配置」にする**（M）
   - アプリの中の一覧から列へ落とすのとまったく同じ規則を使う。吸着、塞がっているときの断りと理由の表示、どちらも同じ
   - 取り込みは今の1本の道（プロジェクトへコピー＝ADR-0024）を通す
   - 最後の列より下の空いた所に落としたら、新しい列を作る（VEGAS Pro 型）
   - 複数のファイルは**名前順に端から並べる**。落とした順番は当てにならない（YMM4 の設定が根拠）
   - 静止画の長さは、正典の既定の定数を使う
3. **OS からプレビューへのドロップは、当面受けない**
   - 受けるとしても、アプリの中の一覧からプレビューへ落とすのと同じ意味にする

実装上の注意は次のとおりです。

- **`dragDropEnabled` は true のままにします。** false にすると HTML の drop が来ます。しかし WebView2 の `File` には絶対パスが無いので、動画のバイトを JS に読み込むことになり、後退します（[lasterm Issue #67](https://github.com/khiops/lasterm/issues/67)）。
- 今の包み（`fileDropEvents.ts`）は `over` のときパスを捨てています。ドラッグ中にタイムラインへ予告の帯を出すには、`enter` で受け取るパスを覚えておく必要があります。取り込みが終わるまで長さは分からないので、予告の帯は仮の長さで出します。
- 座標は「物理 px ÷ devicePixelRatio」を要素の矩形と比べる今の方式が、コミュニティで勧められている唯一の方法です（[Issue #13835](https://github.com/tauri-apps/tauri/issues/13835)）。**開発者ツールを窓に付けたままだと y 座標がずれる**ので、手で確かめるときは開発者ツールを外します（[Discussion #11141](https://github.com/tauri-apps/tauri/discussions/11141)）。
- **管理者として起動していると、エクスプローラーからのドロップは Windows に止められます**（UIPI）。Premiere Pro の利用者でも同じ報告があります（[Adobe Community](https://community.adobe.com/t5/premiere-pro-discussions/can-t-drag-files-from-file-explorer-to-premiere-pro-timeline/m-p/14369302)）。落とせないという問い合わせへの答えとして、困ったときの説明に書いておきます。
- 対応していない形式のファイルが混ざったときの表示には、業界の手本が見つかりませんでした。すたりお独自に、ファイルごとに「次の行動」を示す文言（§2-5）を作ります。

## アプリの中のドラッグは、すたりおの「断って理由を言う」が初心者向けとして正しい

**事実（出典あり）。** タイムラインへのドロップの規則は、製品によって3つの系統に分かれます。

| 系統 | 製品 | 既定の挙動 |
|---|---|---|
| (a) プロのトラック型 | Premiere Pro・Resolve・Shotcut・Kdenlive・VEGAS Pro | **既定は上書き**。挿入は修飾キーかモードで切り替える |
| (b) 主トラック・磁石型 | Final Cut Pro・CapCut・Filmora・Camtasia・Canva | **既定は挿入して押しのける** |
| (c) 迷ったら聞く型 | PowerDirector ほか | 塞がっている所に落とすと選択肢を出す |

(a) の例として、Premiere Pro は Ctrl で挿入になり、影響するトラックに三角の印が出ます（[Adobe helpx](https://helpx.adobe.com/ie/premiere-pro/using/adding-clips-sequences.html)）。Shotcut は上書きが既定で、挿入（ripple）が代わりの選択肢です（[Shotcut blog](https://www.shotcut.org/blog/improved-drag-n-drop-into-timeline/)）。

(c) の例は次のとおりです。

- PowerDirector：部品の上に落とすと、上書き・挿入・クロスフェード・置き換えのポップアップが出る。隙間に落とすと「隙間に合わせて切る／速さを変える」が出る（[CyberLink help PD19](https://help.cyberlink.com/stat/help/powerdirector/19/enu/07_01_01_adding_video_clips_an.html)）
- Final Cut Pro：部品の上に落とすと、対象が白い枠で強調され、置き換えのメニューが出る（[Apple Support](https://support.apple.com/guide/final-cut-pro/replace-clips-ver4e2fcf0/mac)）
- Clipchamp：緑の「置き換え」の案内が出る（[Clipchamp blog](https://clipchamp.com/en/blog/replace-timeline-items/)）

どちらの既定にも不満が出ています。

- Premiere Pro では「上書きせずにドラッグしたい」という相談が繰り返される（[Adobe Community](https://community.adobe.com/t5/premiere-pro-discussions/drag-and-drop-clips-on-the-timeline-without-overwriting/td-p/14388397)）
- Camtasia では「トラックの中身を勝手に動かさないで」という声がある（[TechSmith community](https://support.techsmith.com/hc/en-us/community/posts/360071604611-Don-t-move-the-contents-of-my-tracks-automatically-ever)）

すたりおの「塞がっていれば断る」には、Kdenlive の Normal モード（部品を重ねられない）という前例があります（[Kdenlive docs](https://docs.kdenlive.org/en/cutting_and_assembling/editing.html)）。

トラックの上下の空いた所に落として新しいトラックを作るのは、Premiere Pro と Camtasia の標準です（[TechSmith](https://www.techsmith.com/learn/tutorials/camtasia/video-editing/)）。

プレビューへのドロップには、2つの意味があります。

- Premiere Pro と Resolve：**どう編集するか（挿入か上書きか）を選ぶ格子**を出す（[JayAreTV](https://jayaretv.com/tips/timeline-viewer-edit-overlays/)）
- Canva：**画面のどこに置くか**を決める（[Canva Help](https://www.canva.com/help/creating-and-editing-videos/)）

すたりおが採っているのは Canva 型です。

NN/g は、ドラッグの設計について次のことを勧めています（[NN/g](https://www.nngroup.com/articles/drag-drop/)）。

- すべての段階で、見て分かる印と結果の表示を出す
- 持っている物の影（ゴースト）を出す
- 落とし先を強調し、縁より手前から吸い付くようにする
- ドラッグ以外の手段（キーやメニュー）も用意する

**推論と提案。** 押しのけ（ripple）と磁石は、ADR-0034 決定11 のとおり**採りません**。そのうえで、次の3つを足します。

1. **断りを落とす前に見せる**
   - 塞がっている所の上にいる間は、予告の帯を「置けない」表示に変え、理由を短く出す
   - 業界の手本は見つかりませんでした。すたりおの差別化になります
2. **断った後に、ワンクリックで代わりの置き方を選べるようにする**
   - 選択肢は「次の空き時刻に置く／手前に新しい列を作って置く」
   - PowerDirector のポップアップが、初心者向けにこの型が通じる前例です
   - ADR-0034 の追補として記録します
3. **プレビューに落とすときは、行き先の時刻と列を添える**
   - 例：「0:12・いちばん手前」
   - アプリが時刻と列を自動で決めていることが、利用者に見えるようにする

見た目パターンを既存の部品の上に落としたときに「置き換え」になる仕組み（Final Cut Pro・Clipchamp 型）は、効果は中くらいです。ただし文書の意味に関わるので、後回しにして設計判断を先に取ります。

ドラッグ中に端でタイムラインが自動で送られる仕組みは、Kdenlive にしか記載がありません（[Kdenlive docs](https://docs.kdenlive.org/en/cutting_and_assembling/editing.html)）。すたりおに既にあるかは今回確かめていないので、実機で確かめる項目に入れます。

## 優先順位の表

「撮影前」とは、チュートリアルの画面に写る見た目や操作が変わるため、録り直しを避けるには先に済ませるべきものを指します。効果は、事務職の利用者にとっての効果です。コストは、コードの構造から見た概算です（見積もりではありません）。

| 順 | 作るもの | 根拠となる製品の挙動 | 効果 | コスト | 設計判断／ADR | 撮影 |
|---|---|---|---|---|---|---|
| 1 | OS からタイムラインの列へのドロップ＝取り込み＋配置（アプリの中のドロップと同じ規則、空いた所なら新しい列、複数は名前順に端から） | Premiere Pro・VEGAS Pro・Final Cut Pro・Shotcut・PowerDirector・YMM4・AviUtl | 高 | M | 要（ADR-0034 追補：複数の順番・新しい列の条件） | **撮影前**（素材を置く場面が写る） |
| 2 | 窓全体をドロップの受け皿にする（重ねて表示、取り込みのみ） | Clipchamp のドロップゾーン、VEGAS Pro | 高 | S | 不要（文言だけ §2-5） | **撮影前** |
| 3 | 「置く」欄の素材をサムネイルの格子にし、使用中の印を付ける（今は名前だけの `PickerList`） | Final Cut Pro の使用範囲の線・スキミング、Filmora・CapCut の格子 | 高 | M | 不要 | **撮影前**（最初の操作が写る） |
| 4 | タイムライン画面にセーフエリアと表示倍率を入れる（部品は場面編集に既にある） | Premiere Pro のセーフマージン | 高（縦型の字幕が隠れる問題） | S | 不要（ADR-0026② の不揃いを直す） | 撮影前が望ましい |
| 5 | プレビューを窓の中で全画面にする（確認専用、Esc で戻る） | Clipchamp、VEGAS Pro、Shotcut | 中〜高 | S | 不要 | 後でよい |
| 6 | 置けないことをドラッグ中に示す＋断った後の代わりの置き方（次の空き時刻／新しい列） | PowerDirector のポップアップ、Kdenlive の Normal モード、NN/g | 中〜高 | M | 要（ADR-0034 追補） | 後でよい（ドラッグを映すなら撮影前） |
| 7 | プレビューへのドロップで、行き先の時刻と列を添える | Canva（位置で置く型） | 中 | S | 不要 | 後でよい |
| 8 | コピー／ペースト（Ctrl+C/V、再生位置へ貼る）＋Ctrl+クリックでの選択の追加 | Clipchamp | 高 | M（Ctrl は S） | 要（貼る先が塞がっているとき＝V24） | 後でよい |
| 9 | 並びの上で囲んで選ぶ（マーキー） | Clipchamp | 中〜高 | M | 不要 | 後でよい |
| 10 | 帯の上に音量線・フェードの傾斜・キーフレームの印を描く（まず読むだけ） | CapCut・Filmora・Premiere Pro | 中〜高 | S〜M（つまんで操作するなら M〜L） | 不要（ADR-0034 決定6 と整合） | 後でよい |
| 11 | I→O の範囲だけを繰り返し再生する | Premiere Pro | 中 | S〜M | 不要 | 後でよい |
| 12 | 右クリックメニューと補足表示に近道を併記する（`timelineShortcuts.ts` を単一の参照元にする） | NN/g、デスクトップの作法 | 中 | S | 不要 | 後でよい |
| 13 | 取り消しに操作名を出す（「〈操作〉を取り消す」）→ 後で履歴の一覧 | Premiere Pro の History 欄 | 中 | S〜M／M | 不要（ADR-0020 の範囲内） | 後でよい |
| 14 | 属性のペースト、複数の帯の一括編集 | Premiere Pro、Clipchamp、Camtasia | 中 | M | 8 と一緒に設計する | 後でよい |
| 15 | Alt+←→ で帯を1コマ動かす、項目ごとの「既定に戻す」、時刻の打ち込み | Premiere Pro（ナッジ） | 中 | 各 S | 不要 | 後でよい |
| 16 | ダッキングの区間を並びの上に示す、音量メーター | Filmora の自動ダッキング、Camtasia のメーター | 低〜中 | M | 不要 | 後でよい |
| 17 | 2画面目への確認用の窓（読むだけ、一方向、「全部戻す」付き） | PowerDirector の Dual Preview、Final Cut Pro、Resolve の Clean Feed | 中（2画面の利用者だけ） | M〜L | **要（新規 ADR）**：窓・権限・画面の救済・ADR-0033 の範囲 | 後でよい |
| 18 | グループ化（Ctrl+G） | Clipchamp | 低〜中 | M〜L | **要**（schema に触れる可能性がある） | 後でよい |

**作らないものと理由**

| 作らないもの | 理由 |
|---|---|
| 任意の欄の切り離し（ドッキング） | 一般向けに前例が無い。YMM4 で問い合わせと不具合が出た。取り消し・自動保存の「持ち主は1つ」と両立しない |
| 編集できる別窓 | 同上。加えて、ショートカット・ドロップ・画面の拡大率の対応を窓ごとに作り直す費用がかかる |
| 押しのけ（ripple）と磁石 | ADR-0034 決定11。Camtasia で不満が出ている |
| プレビューに編集の種類を選ぶ格子を出す | プロ向けの型で、すたりおの「位置で置く」と意味がぶつかる |
| OS からプレビューへの直接ドロップ | AviUtl の混乱が前例 |
| エクスプローラーへドラッグして書き出す | 前例が無い |
| スリップ・ロール・スライドの道具 | V24 の世界では費用に見合わない。使い始めの位置は数値の欄で既に変えられる |

## 確かめられなかったこと

**事実と推論の分け方。** 各製品の挙動は、上に出典を付けた範囲が事実です。すたりおの現状は、コード（`fileDropEvents.ts`・`useAssetPicker.ts:114-119`、再調査のメモに書かれた `TimelineProjectScreen.tsx` の行）で確かめました。「一般向けには任意の欄の切り離しは要らない」「読むだけの窓で止める」「断りを落とす前に見せる」は、出典から導いた**推論**です。コストはすべて概算です。

**確かめられなかったことは次のとおりです。**

- 公式資料の本文が取れなかったもの
  - Premiere Pro の公式ヘルプ（403 のため検索の要約で代用）
  - Resolve 20 の公式マニュアルの本文
  - Blackmagic のフォーラムの本文
- 2画面目を外したときの挙動を仕様として書いた公式資料（どの製品でも見つからなかった）
- 別窓の性能を示す数値
- 製品ごとに情報が足りなかったもの
  - CapCut：デスクトップ版の2画面出力とドロップ規則について、公式資料が無い（第三者の解説だけ）
  - Canva：動画編集でのドロップ規則は第三者の解説だけ
  - PowerDirector：最新版の Dual Preview が今どうなっているか
  - YMM4：落としたときにどの列・どの時刻に置くかの規則
- ドロップのときの細部で、資料が見つからなかったもの
  - フォルダを落としたとき（Premiere Pro と Resolve 以外）
  - 対応していない形式のファイルを落としたときのエラー表示（全製品）
  - ドラッグ中に時刻を示す補足表示
- Tauri について確かめられなかったもの
  - `DragDropEvent.position` の原点を書いた公式資料
  - 窓をまたいで BroadcastChannel が動くことの公式な確認
  - 2つ目の WebView2 窓のメモリや GPU の費用
  - 画面の抜き差しを知らせるイベントの有無
  - [Issue #11712](https://github.com/tauri-apps/tauri/issues/11712)（Windows 11 でドロップが効かない）の詳細
- すたりお自身について、今回確かめていないこと
  - ドラッグ中に端で自動で送られる仕組みが既にあるか
  - 断りをドラッグ中に既に出しているか（落とした後だけか）

**どちらも実機で確かめてから、表の6番の中身を確定してください。**

## 結論

前回の調査で、すたりおは「画面を広げ縮めする道具」を揃えました。今回の調査で分かったのは、**残っている差が画面の配分ではなく「物を入れる経路」にある**ことです。

他社は、ファイルをタイムラインへ落とせば取り込みと配置が一度に済みます。すたりおは、取り込みボタンの枠へ落とし、そこから「置く」欄の名前の一覧を読んで運ぶ、という二段になっています。チュートリアルで最初に写る操作がここなので、1〜3番は撮影の前に済ませる価値があります。

別窓は、見栄えのする機能に見えます。しかし利用者層の近い YMM4 が示しているとおり、慣れていない人には「窓が消えた・戻せない」という新しい困りごとを生みます。すたりおで作るとしても、**書き換えない窓（確認用の出力）に限り、ボタン1つで元に戻せること**を必須にします。そうすれば、取り消しと自動保存の持ち主を1つに保ったまま、2画面の利用者の需要にも応えられます。その判断は、実装より先に ADR として記録してください。
