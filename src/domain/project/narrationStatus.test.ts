import { describe, expect, it } from 'vitest';
import { NARRATION_STATUS } from '../enums';
import { keptPreviousVoice, statusAfterVoiceFailure } from './narrationStatus';

// #755-3：一時的な失敗を文書へ書くと、開き直しても「作れませんでした」のまま。
// ところが鳴らす側は `voicePath` しか見ないので、**声は鳴るのに作れていないと出る**状態が残っていた。

describe('statusAfterVoiceFailure（声を作れなかったときの印・#755-3）', () => {
  it('使える声が残っていれば印は変えない（鳴っているのに「作れませんでした」を残さない）', () => {
    expect(statusAfterVoiceFailure('voices/clip_001.wav')).toBe(NARRATION_STATUS.generated);
  });

  it('声が無ければ「作れなかった」を残す（次に開いたときも分かる）', () => {
    expect(statusAfterVoiceFailure(null)).toBe(NARRATION_STATUS.failed);
    expect(statusAfterVoiceFailure(undefined)).toBe(NARRATION_STATUS.failed);
    expect(statusAfterVoiceFailure('')).toBe(NARRATION_STATUS.failed); // 空は「無い」と同じ
  });

  it('前の声が残っているときだけ、その旨を添えられる', () => {
    expect(keptPreviousVoice('voices/clip_001.wav')).toBe(true);
    expect(keptPreviousVoice(null)).toBe(false);
  });
});
