// 合成（MV-0003 決定4）。1レイヤー＝画面全体を1回描く：下までの絵（backdrop）とレイヤーの中身を、描画モードで混ぜる。
// 中身は「乗算済み・sRGB の RGBA8」。作業の色空間が linear なら、読んだら linear に直してから混ぜる。
// 下までの絵は「乗算済み・作業の色空間」の RGBA16F。

struct LayerU {
  // コンポジションの画素の座標 → 中身の画素の座標（x' = m0.x*x + m0.z*y + m1.x, y' = m0.y*x + m0.w*y + m1.y）
  m0: vec4<f32>,
  // m1.zw＝中身の幅・高さ（画素）
  m1: vec4<f32>,
  opacity: f32,
  mode: u32,
  linear: u32,
  // 1＝中身が既に作業の色空間・乗算済み（入れ子）＝読むときに直さない
  src_working: u32,
};

@group(0) @binding(0) var<uniform> u: LayerU;
@group(0) @binding(1) var content: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var backdrop: texture_2d<f32>;

struct VOut { @builtin(position) pos: vec4<f32> };

@vertex
fn vs_full(@builtin(vertex_index) vi: u32) -> VOut {
  var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  var o: VOut;
  o.pos = vec4(p[vi], 0.0, 1.0);
  return o;
}

fn srgb_to_linear(c: vec3<f32>) -> vec3<f32> {
  return select(pow((c + 0.055) / 1.055, vec3(2.4)), c / 12.92, c <= vec3(0.04045));
}

fn linear_to_srgb(c: vec3<f32>) -> vec3<f32> {
  let x = max(c, vec3(0.0));
  return select(1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3(0.0031308));
}

// --- 描画モード（W3C Compositing and Blending Level 1 の式。add は上限なしの足し算） ---
fn lum(c: vec3<f32>) -> f32 { return dot(c, vec3(0.3, 0.59, 0.11)); }
fn clip_color(c: vec3<f32>) -> vec3<f32> {
  let l = lum(c);
  let n = min(c.r, min(c.g, c.b));
  let x = max(c.r, max(c.g, c.b));
  var o = c;
  if (n < 0.0) { o = l + (o - l) * l / max(l - n, 1e-6); }
  if (x > 1.0) { o = l + (o - l) * (1.0 - l) / max(x - l, 1e-6); }
  return o;
}
fn set_lum(c: vec3<f32>, l: f32) -> vec3<f32> { return clip_color(c + (l - lum(c))); }
fn sat(c: vec3<f32>) -> f32 { return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)); }
fn set_sat(c: vec3<f32>, s: f32) -> vec3<f32> {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  if (mx - mn <= 1e-6) { return vec3(0.0); }
  return (c - mn) * s / (mx - mn);
}
fn soft_light1(b: f32, s: f32) -> f32 {
  if (s <= 0.5) { return b - (1.0 - 2.0 * s) * b * (1.0 - b); }
  var d: f32;
  if (b <= 0.25) { d = ((16.0 * b - 12.0) * b + 4.0) * b; } else { d = sqrt(b); }
  return b + (2.0 * s - 1.0) * (d - b);
}
fn hard_light1(b: f32, s: f32) -> f32 {
  if (s <= 0.5) { return b * 2.0 * s; }
  let s2 = 2.0 * s - 1.0;
  return b + s2 - b * s2;
}
fn dodge1(b: f32, s: f32) -> f32 {
  if (b <= 0.0) { return 0.0; }
  if (s >= 1.0) { return 1.0; }
  return min(1.0, b / (1.0 - s));
}
fn burn1(b: f32, s: f32) -> f32 {
  if (b >= 1.0) { return 1.0; }
  if (s <= 0.0) { return 0.0; }
  return 1.0 - min(1.0, (1.0 - b) / s);
}

fn blend(cb: vec3<f32>, cs: vec3<f32>, mode: u32) -> vec3<f32> {
  switch mode {
    case 1u: { return cb + cs; }                                   // add
    case 2u: { return cb * cs; }                                   // multiply
    case 3u: { return cb + cs - cb * cs; }                         // screen
    case 4u: { return vec3(hard_light1(cs.r, cb.r), hard_light1(cs.g, cb.g), hard_light1(cs.b, cb.b)); } // overlay
    case 5u: { return vec3(soft_light1(cb.r, cs.r), soft_light1(cb.g, cs.g), soft_light1(cb.b, cs.b)); } // softLight
    case 6u: { return vec3(hard_light1(cb.r, cs.r), hard_light1(cb.g, cs.g), hard_light1(cb.b, cs.b)); } // hardLight
    case 7u: { return vec3(dodge1(cb.r, cs.r), dodge1(cb.g, cs.g), dodge1(cb.b, cs.b)); }                // colorDodge
    case 8u: { return vec3(burn1(cb.r, cs.r), burn1(cb.g, cs.g), burn1(cb.b, cs.b)); }                   // colorBurn
    case 9u: { return min(cb, cs); }                               // darken
    case 10u: { return max(cb, cs); }                              // lighten
    case 11u: { return abs(cb - cs); }                             // difference
    case 12u: { return cb + cs - 2.0 * cb * cs; }                  // exclusion
    case 13u: { return set_lum(set_sat(cs, sat(cb)), lum(cb)); }   // hue
    case 14u: { return set_lum(set_sat(cb, sat(cs)), lum(cb)); }   // saturation
    case 15u: { return set_lum(cs, lum(cb)); }                     // color
    case 16u: { return set_lum(cb, lum(cs)); }                     // luminosity
    default: { return cs; }                                        // normal
  }
}

@fragment
fn fs_layer(i: VOut) -> @location(0) vec4<f32> {
  let p = i.pos.xy;
  let back = textureLoad(backdrop, vec2<i32>(p), 0);
  let tp = vec2(u.m0.x * p.x + u.m0.z * p.y + u.m1.x, u.m0.y * p.x + u.m0.w * p.y + u.m1.y);
  let size = u.m1.zw;
  var src = vec4(0.0);
  if (tp.x >= 0.0 && tp.y >= 0.0 && tp.x <= size.x && tp.y <= size.y) {
    src = textureSampleLevel(content, samp, tp / size, 0.0);
  }
  // 中身（乗算済み・sRGB）→ 作業の色空間の乗算済みへ
  var as_ = src.a * u.opacity;
  var cs = vec3(0.0);
  if (src.a > 0.0) { cs = src.rgb / src.a; }
  if (u.linear == 1u && u.src_working == 0u) { cs = srgb_to_linear(cs); }
  let ab = back.a;
  var cb = vec3(0.0);
  if (ab > 0.0) { cb = back.rgb / ab; }
  let mixed = (1.0 - ab) * cs + ab * blend(cb, cs, u.mode);
  let co = as_ * mixed + ab * cb * (1.0 - as_);
  let ao = as_ + ab * (1.0 - as_);
  return vec4(co, ao);
}

// 仕上げ：作業の色空間の乗算済み → 乗算していない sRGB の RGBA8（backdrop＝合成し終えた絵）

@fragment
fn fs_final(i: VOut) -> @location(0) vec4<f32> {
  let c = textureLoad(backdrop, vec2<i32>(i.pos.xy), 0);
  var rgb = vec3(0.0);
  if (c.a > 0.0) { rgb = c.rgb / c.a; }
  if (u.linear == 1u) { rgb = linear_to_srgb(rgb); }
  return vec4(clamp(rgb, vec3(0.0), vec3(1.0)), clamp(c.a, 0.0, 1.0));
}
