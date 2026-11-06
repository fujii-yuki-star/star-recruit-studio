// 話者（VOICEVOX の声）を選ぶ欄＝掛け合いの行と、単独の語り（ADR-0073）で同じ部品を使う。
// 空＝ナレーターの声（設定画面の「ナレーターの声」＝全動画共通）に合わせる。
import type { VoiceCharacter } from "../../domain/voice/voiceCatalog";
import { VOICE_FOLLOW_NARRATOR_LABEL } from "../uiLabels";

export function SpeakerSelect({
  value,
  voices,
  onChange,
  ariaLabel,
}: {
  value: number | null | undefined;
  voices: readonly VoiceCharacter[];
  onChange: (speaker: number | null) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="row gap-sm" style={{ alignItems: "center", flexWrap: "wrap" }}>
      <span className="text-sm text-muted">声</span>
      <select
        className="select text-sm"
        aria-label={ariaLabel}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">{VOICE_FOLLOW_NARRATOR_LABEL}</option>
        {voices.map((c) => (
          <optgroup key={c.character} label={c.character}>
            {c.styles.map((st) => (
              <option key={st.speaker} value={st.speaker}>{c.character}（{st.label}）</option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
