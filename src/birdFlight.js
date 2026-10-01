// Original seeded coastal flight. A bird visits different waypoints each leg;
// evaluating a pose never depends on frame rate, previous calls, or Math.random.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

function random(seed, waypoint, channel) {
  let value = Math.imul(seed + 1, 0x9e3779b1)
    ^ Math.imul(waypoint + 100019, 0x85ebca6b) ^ Math.imul(channel + 7, 0xc2b2ae35);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 4294967296;
}

function waypoint(seed, index, channel, extent) {
  return (random(seed, index, channel) * 2 - 1) * extent;
}

function spline(a, b, c, d, u) {
  return b + 0.5 * u * ((c - a) + u
    * (2 * a - 5 * b + 4 * c - d + u * (3 * (b - c) + d - a)));
}

function derivative(a, b, c, d, u) {
  return 0.5 * ((c - a) + 2 * u * (2 * a - 5 * b + 4 * c - d)
    + 3 * u * u * (3 * (b - c) + d - a));
}

function acceleration(a, b, c, d, u) {
  return (2 * a - 5 * b + 4 * c - d) + 3 * u * (3 * (b - c) + d - a);
}

/** `out` may be an existing target object, avoiding per-frame flight objects. */
export function birdFlightAt(index, elapsed, weather, flock, out = {}) {
  const seed = Math.max(0, Math.trunc(finite(index, 0)));
  const time = Math.max(0, finite(elapsed, 0));
  const legSeconds = 17 + random(seed, 0, 12) * 10;
  const progress = time / legSeconds + random(seed, 0, 13) * 47;
  const leg = Math.floor(progress);
  const u = progress - leg;
  const extent = finite(flock.radius, 25) * (1.25 + random(seed, 0, 14));
  const x0 = waypoint(seed, leg - 1, 0, extent);
  const x1 = waypoint(seed, leg, 0, extent);
  const x2 = waypoint(seed, leg + 1, 0, extent);
  const x3 = waypoint(seed, leg + 2, 0, extent);
  const z0 = waypoint(seed, leg - 1, 1, extent);
  const z1 = waypoint(seed, leg, 1, extent);
  const z2 = waypoint(seed, leg + 1, 1, extent);
  const z3 = waypoint(seed, leg + 2, 1, extent);
  const dx = derivative(x0, x1, x2, x3, u);
  const dz = derivative(z0, z1, z2, z3, u);
  const ddx = acceleration(x0, x1, x2, x3, u);
  const ddz = acceleration(z0, z1, z2, z3, u);
  const y0 = waypoint(seed, leg - 1, 2, 6);
  const y1 = waypoint(seed, leg, 2, 6);
  const y2 = waypoint(seed, leg + 1, 2, 6);
  const y3 = waypoint(seed, leg + 2, 2, 6);
  const storm = weather === 'storm';
  const rain = weather === 'rain';
  const gliding = random(seed, leg, 4) > (storm ? 0.89 : rain ? 0.74 : 0.53);
  // Weather changes posture and wing effort, not the route clock: changing
  // weather cannot teleport a bird or invalidate its authoritative hit pose.
  out.x = finite(flock.x, 0) + spline(x0, x1, x2, x3, u);
  out.y = finite(flock.y, 65) + spline(y0, y1, y2, y3, u);
  out.z = finite(flock.z, 0) + spline(z0, z1, z2, z3, u);
  out.heading = Math.atan2(dx, dz);
  out.pitch = clamp(-Math.atan2(derivative(y0, y1, y2, y3, u),
    Math.hypot(dx, dz) + 0.001), -0.28, 0.28);
  out.bank = clamp((dx * ddz - dz * ddx) / (dx * dx + dz * dz + 80)
    * 0.75, -0.45, 0.45);
  const flapBlend = Math.min(1, u * 7, (1 - u) * 7);
  out.wingBeat = 0.045 + flapBlend * (gliding ? 0.025 : storm ? 0.34 : 0.22)
    * Math.sin(time * (storm ? 7.8 : 4.5 + random(seed, 0, 15)) + seed * 2.17);
  out.gliding = gliding;
  out.flightSpeed = Math.hypot(dx, dz) / legSeconds;
  return out;
}
