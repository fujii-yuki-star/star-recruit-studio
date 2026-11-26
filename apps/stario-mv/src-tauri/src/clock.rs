//! 再生の時計（純粋＝検査しやすい・MV-0007 決定3）。
//!
//! 再生は「始めた時刻からの経過 × fps」のコマを描く。間に合わなかったコマは飛ばして数える（黙って間引かない）。

/// 次に描くコマ。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Step {
    pub frame: i64,
    /// 間に合わずに飛ばしたコマの数。
    pub dropped: u64,
    /// 最後のコマまで来た（止める）。
    pub finished: bool,
}

/// 経過 `elapsed_sec` のときに見せるべきコマ。
pub fn frame_at(start_frame: i64, fps: f64, elapsed_sec: f64) -> i64 {
    start_frame + (elapsed_sec * fps + 1e-9).floor() as i64
}

/// 次に描くコマ（まだ次のコマの時刻でなければ None）。`last`＝最後に描いたコマ・`duration`＝コマ数。
pub fn next(
    start_frame: i64,
    fps: f64,
    elapsed_sec: f64,
    last: i64,
    duration: i64,
) -> Option<Step> {
    let end = duration - 1;
    let target = frame_at(start_frame, fps, elapsed_sec).min(end);
    if target <= last {
        return None;
    }
    Some(Step {
        frame: target,
        dropped: (target - last - 1).max(0) as u64,
        finished: target >= end,
    })
}

/// 次のコマの時刻まで、あと何秒か（再生を始めてからの経過 `elapsed_sec` に対して）。
pub fn wait_sec(start_frame: i64, fps: f64, elapsed_sec: f64, last: i64) -> f64 {
    let due = (last + 1 - start_frame) as f64 / fps;
    (due - elapsed_sec).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn 時計に合わせて進み間に合わなければ飛ばして数える() {
        assert_eq!(frame_at(10, 30.0, 0.0), 10);
        assert_eq!(frame_at(10, 30.0, 1.0), 40);
        assert_eq!(
            frame_at(0, 30000.0 / 1001.0, 1001.0 / 30000.0),
            1,
            "29.97 でも境目で進む"
        );
        // 境目ちょうどの時刻で、小数の誤差で1つ前のコマに落ちない（29.97 で1万コマぶん）
        let fps = 30000.0 / 1001.0;
        for k in 0..10_000i64 {
            assert_eq!(frame_at(0, fps, k as f64 * 1001.0 / 30000.0), k, "コマ {k}");
        }
        assert_eq!(next(0, 30.0, 0.01, 0, 90), None, "まだ次の時刻でない");
        assert_eq!(
            next(0, 30.0, 1.0 / 30.0, 0, 90),
            Some(Step {
                frame: 1,
                dropped: 0,
                finished: false
            })
        );
        assert_eq!(
            next(0, 30.0, 4.5 / 30.0, 1, 90),
            Some(Step {
                frame: 4,
                dropped: 2,
                finished: false
            }),
            "2・3 を飛ばした"
        );
        assert_eq!(
            next(0, 30.0, 100.0, 50, 90),
            Some(Step {
                frame: 89,
                dropped: 38,
                finished: true
            }),
            "最後のコマで止める"
        );
        assert_eq!(next(0, 30.0, 100.0, 89, 90), None);
        assert!((wait_sec(0, 30.0, 0.01, 0) - (1.0 / 30.0 - 0.01)).abs() < 1e-9);
        assert_eq!(wait_sec(0, 30.0, 1.0, 0), 0.0, "遅れていれば待たない");
    }
}
