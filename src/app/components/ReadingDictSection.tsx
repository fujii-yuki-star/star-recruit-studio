// 言葉の読み方（ADR-0037・#350）。会社名・人名の誤読をなくすための一覧と編集。
//
// ⚠️ **「アクセント型」「モーラ」は画面に出さない**（決定6・§2-3）＝「どこで下がるか」は
// **聞き比べて選ぶ**。候補は読みに印を付けて見せる（`ウ↓ツノミヤ`）。
// ⚠️ **正典はアプリが持つ**（決定1）＝ここで編集したものが正で、音声ソフト側へは「映す」だけ。
import { useEffect, useState } from "react";
import { PlayIcon, StopIcon } from "./icons";
import { useAudioPreview } from "../hooks/useAudioPreview";
import { useProjectStore } from "../store/projectStore";
import { alpha6Message } from "../uiLabels";
import { DeleteConfirm } from "./DeleteConfirm";
import {
  accentCandidates,
  accentMark,
  defaultAccentType,
  isValidYomi,
  mergeDict,
  normalizeSurface,
  type EngineConflict,
  type ReadingEntry,
} from "../../domain/voice/readingDict";
import {
  emptyReadingDict,
  exportReadingDictTo,
  importReadingDictFrom,
  loadReadingDict,
  READING_DICT_UNREADABLE,
  saveReadingDict,
  type ReadingDictFile,
} from "../../infrastructure/readingDictFs";
import {
  markReadingDictChanged,
  overwriteConflict,
  syncAndCollectConflicts,
} from "../../infrastructure/voiceProviders/readingDictSync";
import { showOpenReadingDictDialog, showSaveReadingDictDialog } from "../../infrastructure/dialog";

/** 編集中の1語（新規と編集で同じ形）。 */
interface Draft {
  surface: string;
  yomi: string;
  accentType: number;
  /** 直している元の言葉（新規は null）。 */
  editing: string | null;
}

const EMPTY_DRAFT: Draft = { surface: "", yomi: "", accentType: 0, editing: null };

export function ReadingDictSection() {
  const [dict, setDict] = useState<ReadingDictFile>(emptyReadingDict());
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // ⚠️ **外すのは確認を通す**（α-6 出口監査 🟡27）＝同じ画面の素材削除・接続キー削除は必ず確認を通す。
  const [confirming, setConfirming] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<{ current: ReadingEntry; incoming: ReadingEntry }[]>([]);
  // 音声ソフト側に同じ言葉で違う読みがあり、**黙って上書きしなかった**もの（決定3b）。
  const [conflicts, setConflicts] = useState<EngineConflict[]>([]);
  const audio = useAudioPreview();
  const synthesizeReading = useProjectStore((s) => s.synthesizeReading);

  useEffect(() => {
    // 開いたときに読み、**その場で音声ソフトへ映す**（決定2「編集したら即反映」）。
    // これが無いと、黙って上書きしなかった語（決定3b）を知らせる機会がどこにも無い。
    void loadReadingDict()
      .then(async ({ file, dropped }) => {
        setDict(file);
        // ⚠️ **入れられなかった語は黙って消さない**（α-6 出口監査 ℹ️・§2-5）＝形が違う語は落ちるが、
        // 数を出さないと「登録したはずのものが無い」に本人が気づけない（読み込みの案内と同じ流儀）。
        if (dropped > 0) setNotice(`${dropped}件は読み方の形が違うため読み込めませんでした。`);
        const r = await syncAndCollectConflicts();
        setConflicts(r.conflicts);
        if (r.error) setError(r.error);
      })
      // ⚠️ **読めなかったら理由を出す**（§2-5）＝空の一覧を見せると「1つも登録していない」に見え、
      // そのまま足すと**丸ごと上書き**して登録した読みが全部消える（`loadReadingDict` の ⚠️）。
      .catch((e: unknown) => setError(typeof e === "string" ? e : READING_DICT_UNREADABLE));
  }, []);

  /**
   * 書き込む。⚠️ **書けなかったら次の行動を出す**（§2-5）＝画面だけ変わって保存されていない、を
   * 黙って成功に見せない（PR #883 レビュー）。書けたら**その場で音声ソフトへ映す**（決定2）。
   *
   * ⚠️ **語（`entries`）だけを渡す**（α-6 出口監査 🟡22）＝控え（`links`）は画面のものではない。
   * 画面が持っているのは**開いた時点**の控えで、その後「そろえる」「こちらの読みにする」が
   * ディスクへ**書き足している**。画面の側を丸ごと書き戻すと控えが巻き戻り、
   * 直した読みが音声ソフトへ映らないまま声が作られ、外した語も共有辞書から消えなくなる。
   */
  async function persist(entries: readonly ReadingEntry[]): Promise<boolean> {
    const before = dict;
    setDict((d) => ({ ...d, entries: [...entries] }));
    try {
      // ⚠️ **控えはディスクの新しい方を採る**（上の ⚠️）。読めなければ書かない（巻き戻さない）。
      const onDisk = (await loadReadingDict()).file;
      const next: ReadingDictFile = { ...before, entries: [...entries], links: onDisk.links };
      await saveReadingDict(next);
      setDict(next);
    } catch (e) {
      setDict(before); // 画面を戻す＝保存されていないのに保存済みに見せない
      // ⚠️ **理由を捨てない**（差分再監査・§2-5）＝一覧が壊れて読めないときは
      // `READING_DICT_UNREADABLE` が投げられる。それを「しばらくしてから、もう一度」に丸めると、
      // **何度やっても直らない行動**を勧めることになる（開いた直後は正しい文言が出るのに、
      // 1語足した瞬間に効かない文言へ差し替わっていた）。
      setError(typeof e === "string" ? e : "読み方を保存できませんでした。しばらくしてから、もう一度お試しください。");
      return false;
    }
    markReadingDictChanged();
    await reflect();
    return true;
  }

  /**
   * 音声ソフトへ映し、**黙って上書きしなかった語**を受け取る（決定2「編集したら即」・決定3b）。
   * ⚠️ **ここでは断らない**＝映せなくても画面は使える。声を作る側（`ensureReadingDictSynced`）が
   * 止めるので、止める場所は1つ（§2-5）。
   */
  async function reflect(): Promise<void> {
    const r = await syncAndCollectConflicts();
    setConflicts(r.conflicts);
    if (r.error) setError(r.error);
  }

  const surface = normalizeSurface(draft.surface);
  const yomiOk = isValidYomi(draft.yomi);
  const canSave = surface !== "" && yomiOk;
  // 同じ言葉が既にあるか（直している語自身は数えない＝自分と衝突したことにしない）。
  const collides = surface !== "" && draft.editing !== surface
    && dict.entries.some((e) => normalizeSurface(e.surface) === surface);

  function startEdit(entry: ReadingEntry): void {
    setDraft({
      surface: entry.surface,
      yomi: entry.yomi,
      accentType: entry.accentType,
      editing: normalizeSurface(entry.surface),
    });
    setNotice("");
    setError("");
  }

  async function onSave(): Promise<void> {
    if (!canSave) return;
    const entry: ReadingEntry = { surface, yomi: draft.yomi, accentType: draft.accentType };
    // 直している元の語と、同じ言葉の語を除いてから足す＝同じ言葉が二重に並ばない。
    const rest = dict.entries.filter(
      (e) => normalizeSurface(e.surface) !== draft.editing && normalizeSurface(e.surface) !== surface,
    );
    if (!(await persist([...rest, entry]))) return;
    setDraft(EMPTY_DRAFT);
    setNotice(`「${surface}」の読み方を保存しました。次に声を作るときから反映されます。`);
  }

  async function onDelete(entry: ReadingEntry): Promise<void> {
    setConfirming(null);
    const key = normalizeSurface(entry.surface);
    if (!(await persist(dict.entries.filter((e) => normalizeSurface(e.surface) !== key)))) return;
    if (draft.editing === key) setDraft(EMPTY_DRAFT);
    setNotice(`「${entry.surface}」を一覧から外しました。`);
  }

  /** 候補を1つ聞く（決定6＝聞き比べて選ぶ）。 */
  async function onListen(accentType: number): Promise<void> {
    const key = `reading:${accentType}`;
    if (audio.playingKey === key) {
      audio.stop();
      return;
    }
    setError("");
    try {
      const url = await synthesizeReading(draft.yomi, accentType);
      audio.play(key, url, () => setError("聞き比べに失敗しました。もう一度お試しください。"));
    } catch (e) {
      // ⚠️ **`Error` の中身は見せない**（§2-5）＝この境界は「失敗を文字列で投げる」慣習で、
      // 文字列でないものは生の技術的な文でありうる。次の行動を出す定型文へ倒す。
      setError(typeof e === "string" ? e : "聞き比べに失敗しました。もう一度お試しください。");
    }
  }

  async function onExport(): Promise<void> {
    setError("");
    try {
      const path = await showSaveReadingDictDialog("読み方の一覧");
      if (!path) return;
      await exportReadingDictTo(path, dict.entries);
      setNotice("読み方の一覧を書き出しました。別のパソコンで読み込めます。");
    } catch {
      setError("書き出せませんでした。保存先を確かめてもう一度お試しください。");
    }
  }

  async function onImport(): Promise<void> {
    setError("");
    setDuplicates([]);
    try {
      const path = await showOpenReadingDictDialog();
      if (!path) return;
      const { entries: incoming, dropped } = await importReadingDictFrom(path);
      const { merged, duplicates: dup } = mergeDict(dict.entries, incoming);
      const added = merged.length - dict.entries.length;
      if (!(await persist(merged))) return;
      setDuplicates(dup);
      // ⚠️ **入れられなかったものは黙って消さない**（§2-5）＝読みがカタカナでない等。
      const dropNote = dropped > 0 ? `${dropped}件は読み方の形が違うため入れませんでした。` : "";
      setNotice(
        dup.length > 0
          ? `${added}件を足しました。${dropNote}同じ言葉で読みが違うものが${dup.length}件あります（下で選べます）。`
          : `${added}件を足しました。${dropNote}`,
      );
    } catch {
      setError("読み込めませんでした。ファイルを確かめてもう一度お試しください。");
    }
  }

  /** 重なった語を、読み込んだ側の読みに置き換える（1件ずつ選ぶ＝まとめて上書きにしない）。 */
  async function onTakeIncoming(pair: { current: ReadingEntry; incoming: ReadingEntry }): Promise<void> {
    const key = normalizeSurface(pair.incoming.surface);
    const ok = await persist(dict.entries.map((e) => (normalizeSurface(e.surface) === key ? pair.incoming : e)));
    if (ok) setDuplicates((d) => d.filter((x) => x !== pair));
  }

  /** 「こちらの読みにする」＝音声ソフト側の語を、この読みで上書きする（決定3b・明示操作でだけ通る）。 */
  async function onOverwrite(c: EngineConflict): Promise<void> {
    setError("");
    try {
      await overwriteConflict(c.entry, c.engine.uuid);
      setConflicts((list) => list.filter((x) => x.entry.surface !== c.entry.surface));
      setNotice(`「${c.entry.surface}」の読み方を音声ソフトへ反映しました。`);
    } catch (e) {
      // ⚠️ **理由を捨てない**（α-6 出口監査 ℹ️）＝この経路は辞書ファイルの読み書きも通るので、
      // 常に接続先を疑わせると**従っても直らない案内**になる（同ファイルの `persist`／`onListen` は直済み）。
      setError(typeof e === "string" ? e
        : "音声ソフトへ反映できませんでした。設定の「音声ソフトの接続先」を確かめてから、もう一度お試しください。");
    }
  }

  const candidates = yomiOk ? accentCandidates(draft.yomi) : [];

  return (
    <div className="card">
      <h2 className="section-title">言葉の読み方</h2>
      <p className="page-desc text-pretty">
        会社名や人名など、そのままだと違う読み方をされる言葉を登録できます。ここで決めた読み方は、
        これから作る声すべてに使われます（作成済みの声はそのままです）。
      </p>

      {/* ⚠️ **何を直しているか欄の側にも出す**（α-6 出口監査 🟡・棚と同じ作法）＝欄が一覧の上にあるので、
          長い一覧から「直す」を押すと**どれを直しているのか**が欄からは分からない。 */}
      {draft.editing && (
        <p className="field-hint">「{draft.editing}」の読み方を直しています。</p>
      )}
      <div className="field">
        <label className="field-label" htmlFor="readingSurface">言葉</label>
        <input
          id="readingSurface"
          className="input"
          value={draft.surface}
          placeholder="例：宇都宮"
          onChange={(e) => setDraft((d) => ({ ...d, surface: e.target.value }))}
        />
      </div>

      <div className="field">
        <label className="field-label" htmlFor="readingYomi">読み（カタカナ）</label>
        <input
          id="readingYomi"
          className="input"
          value={draft.yomi}
          placeholder="例：ウツノミヤ"
          onChange={(e) => {
            const yomi = e.target.value;
            setDraft((d) => ({
              ...d,
              yomi,
              // 読みを変えたら下がる場所は既定（先頭で下がる形）へ＝前の読みの位置が残らない。
              accentType: isValidYomi(yomi) ? defaultAccentType(yomi) : 0,
            }));
          }}
        />
        {draft.yomi !== "" && !yomiOk && (
          <p className="field-hint">カタカナで入力してください（例：ウツノミヤ）。</p>
        )}
      </div>

      {candidates.length > 1 && (
        <div className="field">
          <span className="field-label">言い方（聞き比べて選べます）</span>
          <p className="field-hint">↓ のところで音が下がります。聞いてしっくりくるものを選んでください。</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--gap-sm)" }}>
            {candidates.map((a) => (
              <div key={a} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <button
                  type="button"
                  className={draft.accentType === a ? "btn btn-primary" : "btn"}
                  aria-pressed={draft.accentType === a}
                  onClick={() => setDraft((d) => ({ ...d, accentType: a }))}
                >
                  {accentMark(draft.yomi, a)}
                </button>
                <button
                  type="button"
                  className="btn"
                  aria-label={`${accentMark(draft.yomi, a)} を聞く`}
                  onClick={() => void onListen(a)}
                >
                  {audio.playingKey === `reading:${a}` ? <StopIcon size={16} /> : <PlayIcon size={16} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: "var(--gap-sm)", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary" disabled={!canSave} onClick={() => void onSave()}>
          {draft.editing ? "この読み方に直す" : "読み方を追加する"}
        </button>
        {draft.editing && (
          <button type="button" className="btn" onClick={() => setDraft(EMPTY_DRAFT)}>やめる</button>
        )}
        <button type="button" className="btn" onClick={() => void onExport()} disabled={dict.entries.length === 0}>
          一覧を書き出す
        </button>
        <button type="button" className="btn" onClick={() => void onImport()}>一覧を読み込む</button>
      </div>
      {collides && (
        <p className="field-hint mt">同じ言葉が既にあります。追加すると、いまの読み方を置き換えます。</p>
      )}
      {notice && <p className="field-hint mt">{notice}</p>}
      {error && <p className="form-error mt" role="alert">{error}</p>}

      {duplicates.length > 0 && (
        <div className="mt">
          <p className="field-hint">
            {alpha6Message.READING_DICT_IMPORT_DUPLICATE}。
          </p>
          <ul className="list-reset">
            {duplicates.map((pair) => (
              <li
                key={normalizeSurface(pair.incoming.surface)}
                style={{ display: "flex", alignItems: "center", gap: "var(--gap-sm)" }}
              >
                <span>
                  {pair.incoming.surface}：いま「{accentMark(pair.current.yomi, pair.current.accentType)}」／
                  読み込んだもの「{accentMark(pair.incoming.yomi, pair.incoming.accentType)}」
                </span>
                <button type="button" className="btn" onClick={() => void onTakeIncoming(pair)}>
                  読み込んだ方にする
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {conflicts.length > 0 && (
        <div className="mt">
          {/* ⚠️ 決定3b＝利用者が VOICEVOX 本体で入れた読みを、アプリが黙って書き換えない。
              知らせて選ばせる（`15 §6` READING_DICT_WORD_CONFLICT）。 */}
          <p className="field-hint">
            {alpha6Message.READING_DICT_WORD_CONFLICT}。
          </p>
          <ul className="list-reset">
            {conflicts.map((c) => (
              <li key={c.entry.surface} style={{ display: "flex", alignItems: "center", gap: "var(--gap-sm)" }}>
                <span style={{ flex: 1 }}>
                  {c.entry.surface}：音声ソフト側「{accentMark(c.engine.yomi, c.engine.accentType)}」／
                  ここでの登録「{accentMark(c.entry.yomi, c.entry.accentType)}」
                </span>
                <button type="button" className="btn" onClick={() => void onOverwrite(c)}>
                  こちらの読みにする
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt">
        {dict.entries.length === 0 ? (
          <p className="field-hint">まだ登録がありません。読み間違えられる言葉を足してください。</p>
        ) : (
          <ul className="list-reset">
            {dict.entries.map((e) => (confirming === normalizeSurface(e.surface) ? (
              <li key={normalizeSurface(e.surface)}>
                <DeleteConfirm
                  confirmLabel="一覧から外す"
                  message={`「${e.surface}」を一覧から外しますか？音声ソフトからも消え、元に戻せません。次に声を作るときから、もとの読みに戻ります。`}
                  onCancel={() => setConfirming(null)}
                  onConfirm={() => void onDelete(e)}
                />
              </li>
            ) : (
              // ⚠️ **どの行を直しているか分かるようにする**（α-6 出口監査 🟡・棚と同じ作法）＝
              // 印が無いと、登録語が増えるほど「直す」を押しても**手元では何も起きないように見える**。
              <li
                key={normalizeSurface(e.surface)}
                aria-current={draft.editing === normalizeSurface(e.surface) ? "true" : undefined}
                style={{
                  display: "flex", alignItems: "center", gap: "var(--gap-sm)",
                  ...(draft.editing === normalizeSurface(e.surface)
                    ? { borderLeft: "3px solid var(--color-accent)", paddingLeft: 6, background: "var(--color-surface-alt)" }
                    : {}),
                }}
              >
                <span style={{ flex: 1 }}>
                  {e.surface}：{accentMark(e.yomi, e.accentType)}
                </span>
                <button type="button" className="btn" onClick={() => startEdit(e)}>直す</button>
                <button type="button" className="btn" onClick={() => setConfirming(normalizeSurface(e.surface))}>一覧から外す</button>
              </li>
            )))}
          </ul>
        )}
      </div>
    </div>
  );
}
