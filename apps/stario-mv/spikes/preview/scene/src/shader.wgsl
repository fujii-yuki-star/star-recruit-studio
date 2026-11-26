struct U { time: f32, count: u32, aspect: f32, pad: f32 };
@group(0) @binding(0) var<uniform> u: U;

struct VOut { @builtin(position) pos: vec4<f32>, @location(0) color: vec4<f32>, @location(1) local: vec2<f32> };

fn hash(n: u32) -> f32 {
  var x = n * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var corners = array<vec2<f32>, 6>(vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));
  let c = corners[vi];
  let cx = hash(ii * 3u) * 2.0 - 1.0;
  let cy = hash(ii * 3u + 1u) * 2.0 - 1.0;
  let r = hash(ii * 3u + 2u);
  let size = 0.05 + 0.15 * r;
  let ang = u.time * (0.5 + r * 2.0) + r * 6.2831;
  let rot = vec2(c.x * cos(ang) - c.y * sin(ang), c.x * sin(ang) + c.y * cos(ang));
  let wobble = vec2(sin(u.time + r * 10.0), cos(u.time * 0.7 + r * 7.0)) * 0.1;
  var p = vec2(cx, cy) + wobble + rot * size;
  p.x = p.x / u.aspect;
  var o: VOut;
  o.pos = vec4(p, 0.0, 1.0);
  o.color = vec4(0.5 + 0.5 * cos(6.2831 * (r + vec3(0.0, 0.33, 0.67))), 0.35);
  o.local = c;
  return o;
}

@fragment
fn fs(i: VOut) -> @location(0) vec4<f32> {
  let d = length(i.local);
  let a = i.color.a * smoothstep(1.0, 0.6, d);
  return vec4(i.color.rgb * a, a);
}
