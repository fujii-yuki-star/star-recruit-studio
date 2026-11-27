//! ある時刻の値を求める（MV-0003 決定1・決定2）。⚠️ 純粋な計算だけ＝プレビュー・書き出し・外部 AI の「1コマ描く」で同じものを使う。

use crate::model::{AnimValue, Animatable, Composition, Interpolation, Keyframe, Layer, Transform};

/// 区間の進み方の既定のハンドル（直線と同じ）。
const DEFAULT_EASE_OUT: [f64; 2] = [1.0 / 3.0, 1.0 / 3.0];
const DEFAULT_EASE_IN: [f64; 2] = [2.0 / 3.0, 2.0 / 3.0];

/// 値を求められない理由（2段目の検査を通っていれば起きない＝起きたら知らせる）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EvalError {
    /// 固定値もキーフレームも無い（式・つなぎはこの版では描けない）。
    NoValue,
}

/// `frame`（小数も可＝モーションブラー・タイムリマップのため）の値。
pub fn value_at(a: &Animatable, frame: f64) -> Result<AnimValue, EvalError> {
    if let Some(v) = &a.value {
        return Ok(v.clone());
    }
    match &a.keyframes {
        Some(ks) if !ks.is_empty() => Ok(keyframes_at(ks, frame)),
        _ => Err(EvalError::NoValue),
    }
}

/// 数値として求める（次元が 1 でなければ最初の成分）。
pub fn number_at(a: &Animatable, frame: f64) -> Result<f64, EvalError> {
    Ok(match value_at(a, frame)? {
        AnimValue::Number(n) => n,
        AnimValue::Vector(v) => v.first().copied().unwrap_or(0.0),
    })
}

/// 並びとして求める（足りない成分は 0）。
pub fn vec_at<const N: usize>(a: &Animatable, frame: f64) -> Result<[f64; N], EvalError> {
    let v = value_at(a, frame)?;
    let mut out = [0.0; N];
    match v {
        AnimValue::Number(n) => out[0] = n,
        AnimValue::Vector(xs) => {
            for (o, x) in out.iter_mut().zip(xs) {
                *o = x;
            }
        }
    }
    Ok(out)
}

fn components(v: &AnimValue) -> Vec<f64> {
    match v {
        AnimValue::Number(n) => vec![*n],
        AnimValue::Vector(xs) => xs.clone(),
    }
}

fn from_components(like: &AnimValue, c: Vec<f64>) -> AnimValue {
    match like {
        AnimValue::Number(_) => AnimValue::Number(c[0]),
        AnimValue::Vector(_) => AnimValue::Vector(c),
    }
}

fn keyframes_at(ks: &[Keyframe], frame: f64) -> AnimValue {
    let first = &ks[0];
    if frame <= first.frame as f64 {
        return first.value.clone();
    }
    let last = &ks[ks.len() - 1];
    if frame >= last.frame as f64 {
        return last.value.clone();
    }
    // frame は ks[i].frame ≤ frame < ks[i+1].frame の区間にある
    let i = ks
        .windows(2)
        .position(|w| frame >= w[0].frame as f64 && frame < w[1].frame as f64)
        .unwrap_or(ks.len() - 2);
    let (k0, k1) = (&ks[i], &ks[i + 1]);
    let t = (frame - k0.frame as f64) / (k1.frame - k0.frame) as f64;
    let progress = match k0.interpolation {
        Interpolation::Hold => return k0.value.clone(),
        Interpolation::Linear => t,
        Interpolation::Bezier => {
            let p1 = k0.ease_out.unwrap_or(DEFAULT_EASE_OUT);
            let p2 = k1.ease_in.unwrap_or(DEFAULT_EASE_IN);
            cubic_bezier_ease(p1, p2, t)
        }
    };
    let a = components(&k0.value);
    let b = components(&k1.value);
    if k0.spatial_out.is_some() || k1.spatial_in.is_some() {
        let out = k0.spatial_out.clone().unwrap_or_else(|| vec![0.0; a.len()]);
        let inn = k1.spatial_in.clone().unwrap_or_else(|| vec![0.0; a.len()]);
        return from_components(&k0.value, spatial_at(&a, &out, &inn, &b, progress));
    }
    from_components(
        &k0.value,
        a.iter()
            .zip(&b)
            .map(|(x, y)| x + (y - x) * progress)
            .collect(),
    )
}

/// CSS の cubic-bezier と同じ＝P0=(0,0)・P1・P2・P3=(1,1)。時間 t（0〜1）での進み具合を返す。
pub fn cubic_bezier_ease(p1: [f64; 2], p2: [f64; 2], t: f64) -> f64 {
    let bez = |a: f64, b: f64, s: f64| {
        let u = 1.0 - s;
        3.0 * u * u * s * a + 3.0 * u * s * s * b + s * s * s
    };
    let dbez = |a: f64, b: f64, s: f64| {
        let u = 1.0 - s;
        3.0 * u * u * a + 6.0 * u * s * (b - a) + 3.0 * s * s * (1.0 - b)
    };
    // x(s) = t を解く（ニュートン法→だめなら二分法）
    let mut s = t;
    for _ in 0..8 {
        let x = bez(p1[0], p2[0], s) - t;
        let d = dbez(p1[0], p2[0], s);
        if x.abs() < 1e-9 {
            return bez(p1[1], p2[1], s);
        }
        if d.abs() < 1e-9 {
            break;
        }
        s -= x / d;
    }
    let (mut lo, mut hi) = (0.0, 1.0);
    s = t;
    for _ in 0..60 {
        let x = bez(p1[0], p2[0], s);
        if (x - t).abs() < 1e-9 {
            break;
        }
        if x < t {
            lo = s;
        } else {
            hi = s;
        }
        s = (lo + hi) / 2.0;
    }
    bez(p1[1], p2[1], s)
}

/// 位置の動きの道筋（3次ベジェ）を、進み具合 p（0〜1）＝**道のりの割合**で進んだ点（AE と同じく道のりで等速）。
fn spatial_at(a: &[f64], out: &[f64], inn: &[f64], b: &[f64], p: f64) -> Vec<f64> {
    let n = a.len();
    let point = |s: f64| -> Vec<f64> {
        let u = 1.0 - s;
        (0..n)
            .map(|d| {
                let p0 = a[d];
                let p1 = a[d] + out.get(d).copied().unwrap_or(0.0);
                let p2 = b[d] + inn.get(d).copied().unwrap_or(0.0);
                let p3 = b[d];
                u * u * u * p0 + 3.0 * u * u * s * p1 + 3.0 * u * s * s * p2 + s * s * s * p3
            })
            .collect()
    };
    const STEPS: usize = 128;
    let mut lengths = Vec::with_capacity(STEPS + 1);
    lengths.push(0.0);
    let mut prev = point(0.0);
    for i in 1..=STEPS {
        let cur = point(i as f64 / STEPS as f64);
        let d: f64 = prev
            .iter()
            .zip(&cur)
            .map(|(x, y)| (y - x) * (y - x))
            .sum::<f64>()
            .sqrt();
        lengths.push(lengths[i - 1] + d);
        prev = cur;
    }
    let total = lengths[STEPS];
    if total <= 0.0 {
        return point(p);
    }
    let target = p.clamp(0.0, 1.0) * total;
    let j = lengths.partition_point(|l| *l < target).clamp(1, STEPS);
    let (l0, l1) = (lengths[j - 1], lengths[j]);
    let f = if l1 > l0 {
        (target - l0) / (l1 - l0)
    } else {
        0.0
    };
    point(((j - 1) as f64 + f) / STEPS as f64)
}

/// 2D のアフィン変換 [a, b, c, d, e, f]＝x' = a·x + c·y + e、y' = b·x + d·y + f（SVG・canvas と同じ並び）。
pub type Affine = [f64; 6];

pub const IDENTITY: Affine = [1.0, 0.0, 0.0, 1.0, 0.0, 0.0];

pub fn mul(m: Affine, n: Affine) -> Affine {
    [
        m[0] * n[0] + m[2] * n[1],
        m[1] * n[0] + m[3] * n[1],
        m[0] * n[2] + m[2] * n[3],
        m[1] * n[2] + m[3] * n[3],
        m[0] * n[4] + m[2] * n[5] + m[4],
        m[1] * n[4] + m[3] * n[5] + m[5],
    ]
}

pub fn apply(m: Affine, p: [f64; 2]) -> [f64; 2] {
    [
        m[0] * p[0] + m[2] * p[1] + m[4],
        m[1] * p[0] + m[3] * p[1] + m[5],
    ]
}

pub fn invert(m: Affine) -> Option<Affine> {
    let det = m[0] * m[3] - m[1] * m[2];
    if det.abs() < 1e-12 {
        return None;
    }
    let (a, b, c, d) = (m[3] / det, -m[1] / det, -m[2] / det, m[0] / det);
    Some([a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])])
}

/// ある時刻の変形の値。
#[derive(Debug, Clone, PartialEq)]
pub struct TransformAt {
    pub anchor: [f64; 2],
    pub position: [f64; 2],
    pub scale: [f64; 2],
    /// 度（時計回り）。
    pub rotation: f64,
    /// 0〜1（範囲の外は丸める）。
    pub opacity: f64,
}

impl TransformAt {
    /// レイヤーの中の座標 → コンポジションの座標（MV-0003 決定3＝T(位置)·R(回転)·S(大きさ)·T(−アンカー)）。
    pub fn matrix(&self) -> Affine {
        let (s, c) = self.rotation.to_radians().sin_cos();
        let t_anchor = [1.0, 0.0, 0.0, 1.0, -self.anchor[0], -self.anchor[1]];
        let scale = [self.scale[0], 0.0, 0.0, self.scale[1], 0.0, 0.0];
        let rot = [c, s, -s, c, 0.0, 0.0];
        let t_pos = [1.0, 0.0, 0.0, 1.0, self.position[0], self.position[1]];
        mul(t_pos, mul(rot, mul(scale, t_anchor)))
    }
}

pub fn transform_at(t: &Transform, frame: f64) -> Result<TransformAt, EvalError> {
    Ok(TransformAt {
        anchor: vec_at::<2>(&t.anchor, frame)?,
        position: vec_at::<2>(&t.position, frame)?,
        scale: vec_at::<2>(&t.scale, frame)?,
        rotation: number_at(&t.rotation, frame)?,
        opacity: number_at(&t.opacity, frame)?.clamp(0.0, 1.0),
    })
}

/// 親の変形まで掛けた「レイヤーの座標 → コンポジションの座標」（MV-0010 決定5＝AE の親子付け）。
/// 子の変形 → 親の変形 → …（親の親まで）。⚠️ 不透明度は掛けない（親の不透明度は引き継がない）。
/// 親が見える範囲の外でも、表示を切っていても、変形は効く。
pub fn world_matrix(comp: &Composition, layer: &Layer, frame: f64) -> Result<Affine, EvalError> {
    let mut m = transform_at(&layer.transform, frame)?.matrix();
    let mut cur = layer.parent_id.as_deref();
    // ⚠️ 循環は2段目の検査で断る＝ここは止まるだけ（数を数えて抜ける）
    for _ in 0..comp.layers.len() {
        let Some(p) = cur.and_then(|id| comp.layers.iter().find(|l| l.id == id)) else {
            break;
        };
        m = mul(transform_at(&p.transform, frame)?.matrix(), m);
        cur = p.parent_id.as_deref();
    }
    Ok(m)
}

/// そのフレームでレイヤーが見えるか（見せる設定・見える範囲）。⚠️ ソロは呼ぶ側（コンポジション全体を見て決める）。
pub fn is_visible_at(l: &Layer, frame: i64) -> bool {
    l.enabled && frame >= l.in_frame && frame < l.out_frame
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kf(frame: i64, v: f64, i: Interpolation) -> Keyframe {
        Keyframe {
            frame,
            value: AnimValue::Number(v),
            interpolation: i,
            ease_out: None,
            ease_in: None,
            spatial_out: None,
            spatial_in: None,
        }
    }

    fn anim(ks: Vec<Keyframe>) -> Animatable {
        Animatable {
            keyframes: Some(ks),
            ..Default::default()
        }
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn 固定値はどの時刻でも同じ() {
        let a = Animatable::number(3.0);
        assert_eq!(number_at(&a, -5.0).unwrap(), 3.0);
        assert_eq!(number_at(&a, 99.0).unwrap(), 3.0);
    }

    #[test]
    fn 最初のキーより前と最後のキーより後は端の値() {
        let a = anim(vec![
            kf(10, 1.0, Interpolation::Linear),
            kf(20, 5.0, Interpolation::Linear),
        ]);
        assert_eq!(number_at(&a, 0.0).unwrap(), 1.0);
        assert_eq!(number_at(&a, 30.0).unwrap(), 5.0);
    }

    #[test]
    fn 直線はまっすぐ() {
        let a = anim(vec![
            kf(0, 0.0, Interpolation::Linear),
            kf(10, 10.0, Interpolation::Linear),
        ]);
        assert!(close(number_at(&a, 2.5).unwrap(), 2.5));
        assert!(close(number_at(&a, 7.0).unwrap(), 7.0));
    }

    #[test]
    fn 止めるは次のキーまで動かない() {
        let a = anim(vec![
            kf(0, 0.0, Interpolation::Hold),
            kf(10, 10.0, Interpolation::Linear),
        ]);
        assert_eq!(number_at(&a, 9.99).unwrap(), 0.0);
        assert_eq!(number_at(&a, 10.0).unwrap(), 10.0);
    }

    #[test]
    fn ベジェの既定のハンドルは直線と同じ() {
        let a = anim(vec![
            kf(0, 0.0, Interpolation::Bezier),
            kf(10, 10.0, Interpolation::Linear),
        ]);
        for f in [1.0, 3.3, 5.0, 8.8] {
            assert!(close(number_at(&a, f).unwrap(), f), "{f}");
        }
    }

    #[test]
    fn ベジェのゆっくり始まりゆっくり終わる() {
        let mut k0 = kf(0, 0.0, Interpolation::Bezier);
        k0.ease_out = Some([0.42, 0.0]);
        let mut k1 = kf(100, 100.0, Interpolation::Linear);
        k1.ease_in = Some([0.58, 1.0]);
        let a = anim(vec![k0, k1]);
        assert!(
            close(number_at(&a, 50.0).unwrap(), 50.0),
            "左右対称なら真ん中は半分"
        );
        assert!(number_at(&a, 10.0).unwrap() < 10.0, "始まりはゆっくり");
        assert!(number_at(&a, 90.0).unwrap() > 90.0, "終わりもゆっくり");
        // CSS の ease-in-out の既知の値（t=0.25 → 約 0.1291）
        assert!((cubic_bezier_ease([0.42, 0.0], [0.58, 1.0], 0.25) - 0.1291).abs() < 1e-3);
    }

    #[test]
    fn 並びは成分ごと() {
        let a = anim(vec![
            Keyframe {
                frame: 0,
                value: AnimValue::Vector(vec![0.0, 100.0]),
                interpolation: Interpolation::Linear,
                ease_out: None,
                ease_in: None,
                spatial_out: None,
                spatial_in: None,
            },
            Keyframe {
                frame: 10,
                value: AnimValue::Vector(vec![10.0, 0.0]),
                interpolation: Interpolation::Linear,
                ease_out: None,
                ease_in: None,
                spatial_out: None,
                spatial_in: None,
            },
        ]);
        let v = vec_at::<2>(&a, 5.0).unwrap();
        assert!(close(v[0], 5.0) && close(v[1], 50.0));
    }

    #[test]
    fn 動きの道筋は曲がり_道のりで等速() {
        // (0,0) → (100,0) を、上に膨らむ道筋で
        let a = anim(vec![
            Keyframe {
                frame: 0,
                value: AnimValue::Vector(vec![0.0, 0.0]),
                interpolation: Interpolation::Linear,
                ease_out: None,
                ease_in: None,
                spatial_out: Some(vec![0.0, -100.0]),
                spatial_in: None,
            },
            Keyframe {
                frame: 10,
                value: AnimValue::Vector(vec![100.0, 0.0]),
                interpolation: Interpolation::Linear,
                ease_out: None,
                ease_in: None,
                spatial_out: None,
                spatial_in: Some(vec![0.0, -100.0]),
            },
        ]);
        let mid = vec_at::<2>(&a, 5.0).unwrap();
        assert!(close(mid[0], 50.0), "左右対称の道筋の真ん中: {mid:?}");
        assert!(mid[1] < -50.0, "上に膨らむ: {mid:?}");
        // 等速＝前半と後半で進む道のりが同じ
        let p = |f: f64| vec_at::<2>(&a, f).unwrap();
        let d = |x: [f64; 2], y: [f64; 2]| ((x[0] - y[0]).powi(2) + (x[1] - y[1]).powi(2)).sqrt();
        let (q1, q2) = (d(p(0.0), p(1.0)), d(p(4.0), p(5.0)));
        assert!((q1 - q2).abs() / q2 < 0.05, "{q1} {q2}");
    }

    #[test]
    fn 変形の順番は位置_回転_大きさ_アンカー() {
        let t = TransformAt {
            anchor: [10.0, 0.0],
            position: [100.0, 100.0],
            scale: [2.0, 1.0],
            rotation: 90.0,
            opacity: 1.0,
        };
        let m = t.matrix();
        // アンカーの点は位置へ
        let p = apply(m, [10.0, 0.0]);
        assert!(close(p[0], 100.0) && close(p[1], 100.0), "{p:?}");
        // アンカーから右へ 1 → 大きさで 2 → 時計回り 90° で下へ 2
        let q = apply(m, [11.0, 0.0]);
        assert!(close(q[0], 100.0) && close(q[1], 102.0), "{q:?}");
        let inv = invert(m).unwrap();
        let back = apply(inv, q);
        assert!(close(back[0], 11.0) && close(back[1], 0.0));
    }

    #[test]
    fn 不透明度は0から1に丸める() {
        let t = Transform {
            anchor: Animatable::vector(&[0.0, 0.0]),
            position: Animatable::vector(&[0.0, 0.0]),
            scale: Animatable::vector(&[1.0, 1.0]),
            rotation: Animatable::number(0.0),
            opacity: Animatable::number(1.7),
            rotation_x: None,
            rotation_y: None,
        };
        assert_eq!(transform_at(&t, 0.0).unwrap().opacity, 1.0);
    }

    #[test]
    fn 値が無ければ知らせる() {
        assert_eq!(
            value_at(&Animatable::default(), 0.0),
            Err(EvalError::NoValue)
        );
    }
}
