import { orbitCameraPose } from './cinematicCapture.js';
import { DISTANT_ISLANDS } from './distantIslands.js';

// Capture-only storyboard for the current Greywake world. Coordinates are metres.
// It describes what to film; it does not move the player or change saved settings.
export const SHOWCASE_DURATION_SECONDS = 660;
export const TEASER_DURATION_SECONDS = 30;
export const FULL_ORBIT = Object.freeze({ start: 50, end: 110, radius: 900, altitude: 270 });

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const point = (x, y, z) => ({ x, y, z });
const view = (position, target, fov = 60, fogDensityCap = null, nightFill = 0) => ({
  position, target, fov, fogDensityCap, nightFill, aerialTrees: position.y > 65,
});
const nightView = (position, target, fov = 60, fogDensityCap = null) =>
  view(position, target, fov, fogDensityCap, 1);
const mix = (a, b, t) => a + (b - a) * t;
const mixPoint = (a, b, t) => point(mix(a.x, b.x, t), mix(a.y, b.y, t), mix(a.z, b.z, t));
const smooth = (t) => t * t * (3 - 2 * t);

function movingView(from, to, t) {
  const amount = smooth(clamp(t, 0, 1));
  const position = mixPoint(from.position, to.position, amount);
  return view(position, mixPoint(from.target, to.target, amount),
    mix(from.fov, to.fov, amount), from.fogDensityCap ?? to.fogDensityCap,
    mix(from.nightFill ?? 0, to.nightFill ?? 0, amount));
}

function shot(sequence, seconds, section) {
  const entry = sequence.find((item) => seconds < item.end) ?? sequence.at(-1);
  const progress = clamp((seconds - entry.start) / (entry.end - entry.start), 0, 1);
  return {
    section, shot: entry.id, label: entry.label,
    shotStart: entry.start, shotEnd: entry.end,
    camera: movingView(entry.from, entry.to ?? entry.from, progress),
    weatherOverride: entry.weather ?? 'clear',
    timeOverride: entry.time ?? 'noon',
    interaction: entry.interaction ?? null,
    title: entry.title ?? null,
    weatherSeconds: seconds,
    simulationSeconds: seconds,
  };
}

const WIDE_SOUTH = view(point(0, 235, 1030), point(0, 27, 0), 57, 0.00062);
const FERRY = view(point(50, 19, 406), point(6, 4, 352), 53);
const LAKE = view(point(-92, 78, 24), point(-70, 49, -75), 56);
const HEADLAND = view(point(-286, 82, -161), point(-130, 40, -90), 58);
const LODGE = view(point(-141, 51, 222), point(-88, 31, 184), 54);
const northWatch = DISTANT_ISLANDS.find((island) => island.id === 'north-watch');
const southwestWarden = DISTANT_ISLANDS.find((island) => island.id === 'southwest-warden');
const NORTH_WATCH = point(northWatch.x, northWatch.cliffHeight + 13, northWatch.z);
const SOUTHWEST_WARDEN = point(southwestWarden.x,
  southwestWarden.cliffHeight + 11, southwestWarden.z);

const TEASER = [
  { id: 'cliff-silhouette', label: 'Greywake from the open sea', start: 0, end: 3,
    from: WIDE_SOUTH, to: view(point(0, 218, 950), point(0, 27, 0), 57, 0.00062),
    weather: 'mist', time: 'dawn' },
  { id: 'orbit-glimpse', label: 'The island in a moving aerial arc', start: 3, end: 5,
    from: view(point(480, 270, 762), point(0, 25, 0), 60, 0.00062),
    to: view(point(695, 270, 570), point(0, 25, 0), 60, 0.00062),
    weather: 'clear' },
  { id: 'ferry', label: 'South Landing passenger ferry', start: 5, end: 8,
    from: FERRY, to: view(point(29, 15, 391), point(6, 4, 352), 53), weather: 'mist' },
  { id: 'clouds', label: 'Moving storm clouds above the headland', start: 8, end: 11,
    from: view(point(-218, 68, -74), point(-185, 155, -185), 62), weather: 'storm' },
  { id: 'rain', label: 'Rain and wet lodge windows', start: 11, end: 14,
    from: view(point(-116, 39, 205), point(-90, 33, 184), 49), weather: 'rain' },
  { id: 'lightning', label: 'Lightning over the island', start: 14, end: 17,
    from: view(point(525, 125, -95), point(0, 35, -60), 57, 0.00105),
    weather: 'storm', time: 'dusk' },
  { id: 'wind-trees', label: 'Wind-shaped trees on the west ridge', start: 17, end: 20,
    from: view(point(-168, 64, -72), point(-230, 45, -140), 54), weather: 'storm' },
  { id: 'lake', label: 'Rain on the highland lake', start: 20, end: 23,
    from: LAKE, weather: 'rain' },
  { id: 'rough-ocean', label: 'Cliff surf and ocean swell', start: 23, end: 26,
    from: view(point(-464, 27, -142), point(-333, 10, -130), 55), weather: 'storm' },
  { id: 'night-lights', label: 'Navigation lights after dark', start: 26, end: 27.5,
    from: view(point(3, 71, 522), point(0, 13, 280), 53, 0.0008),
    weather: 'mist', time: 'night' },
  { id: 'teaser-title', label: 'IslandWorld title', start: 27.5, end: 30,
    from: WIDE_SOUTH, weather: 'mist', time: 'dusk',
    title: 'ISLAND WORLD — One island. Never the same sky.' },
];

// Matching aerial and ground views make each weather state legible. The world's
// existing five-second palette blend and climate response handle transitions.
const WEATHER_SEQUENCE = [
  { id: 'clear-aerial', label: 'Clear island from above', start: 120, end: 135,
    from: view(point(-304, 133, 475), point(-60, 33, 72), 59),
    to: view(point(-248, 113, 322), point(-70, 40, 10), 59), weather: 'clear' },
  { id: 'clear-ground', label: 'Clear West Headland', start: 135, end: 150,
    from: HEADLAND, weather: 'clear' },
  { id: 'mist-aerial', label: 'Mist enters the lake basin', start: 150, end: 165,
    from: view(point(-177, 128, 84), point(-70, 50, -75), 58),
    to: view(point(-100, 108, 26), point(-70, 49, -75), 58), weather: 'mist' },
  { id: 'mist-ground', label: 'Lodge through mist', start: 165, end: 180,
    from: LODGE, weather: 'mist' },
  { id: 'rain-aerial', label: 'Rain crosses South Landing', start: 180, end: 197,
    from: view(point(141, 120, 480), point(0, 13, 260), 58),
    to: view(point(39, 87, 373), point(0, 8, 270), 58), weather: 'rain' },
  { id: 'rain-ground', label: 'Rain at Keeper’s Lodge', start: 197, end: 215,
    from: view(point(-115, 40, 200), point(-89, 31, 184), 54), weather: 'rain' },
  { id: 'storm-aerial', label: 'Lightning and wind across Greywake', start: 215, end: 235,
    from: view(point(370, 164, -300), point(40, 38, -80), 60, 0.00125),
    to: view(point(230, 111, -255), point(40, 42, -145), 60, 0.00125),
    weather: 'storm' },
  { id: 'storm-ground', label: 'Squall on West Headland', start: 235, end: 250,
    from: view(point(-222, 50, -110), point(-327, 22, -169), 60), weather: 'storm' },
  { id: 'easing-rain', label: 'The storm eases over the lake', start: 250, end: 260,
    from: LAKE, weather: 'rain' },
  { id: 'easing-mist', label: 'Mist after the squall', start: 260, end: 265,
    from: view(point(-129, 88, 44), point(-70, 50, -75), 58), weather: 'mist' },
  { id: 'easing-clear', label: 'The sky opens above the lake', start: 265, end: 270,
    from: view(point(-129, 88, 44), point(-70, 50, -75), 58), weather: 'clear' },
];

const FIXED_TIMELAPSES = [
  { id: 'west-headland', label: 'West Headland weather timelapse', start: 270, end: 310,
    camera: HEADLAND },
  { id: 'highland-lake', label: 'Highland lake weather timelapse', start: 310, end: 350,
    camera: LAKE },
  { id: 'keepers-lodge', label: 'Keeper’s Lodge weather timelapse', start: 350, end: 390,
    camera: LODGE },
];

const WATER_SEQUENCE = [
  { id: 'calm-swell', label: 'Calm ocean swell below the west cliffs', start: 390, end: 399,
    from: view(point(-535, 27, -136), point(-330, 10, -120), 52),
    to: view(point(-448, 23, -159), point(-327, 9, -136), 52), weather: 'clear' },
  { id: 'storm-surf', label: 'Surf breaking against the high cliff', start: 399, end: 408,
    from: view(point(-501, 21, -233), point(-330, 10, -196), 50),
    to: view(point(-427, 20, -196), point(-320, 12, -180), 50), weather: 'storm' },
  { id: 'ferry-buoys', label: 'Ferry and channel buoys on the waves', start: 408, end: 417,
    from: view(point(94, 24, 457), point(0, 3, 349), 55),
    to: FERRY, weather: 'storm' },
  { id: 'north-launch', label: 'North Inlet utility launch', start: 417, end: 426,
    from: view(point(-108, 26, -388), point(-65, 4, -341), 53),
    to: view(point(-87, 18, -363), point(-65, 4, -341), 53), weather: 'rain' },
  { id: 'lake-rain', label: 'Lake ripples and rain impacts', start: 426, end: 435,
    from: view(point(-115, 59, -11), point(-70, 49, -75), 49), weather: 'rain' },
];

const SCENIC_SEQUENCE = [
  { id: 'west-headland', label: 'West Headland and lighthouse', start: 510, end: 517.5,
    from: view(point(-375, 89, -231), point(-244, 42, -133), 58),
    to: view(point(-294, 81, -177), point(-221, 42, -121), 58), weather: 'clear' },
  { id: 'lake', label: 'Highland lake', start: 517.5, end: 525,
    from: view(point(-139, 112, 13), point(-70, 50, -75), 57),
    to: view(point(-40, 87, 16), point(-70, 50, -75), 57), weather: 'clear' },
  { id: 'lodge', label: 'Keeper’s Lodge', start: 525, end: 532.5,
    from: view(point(-175, 87, 258), point(-90, 32, 185), 55),
    to: view(point(-110, 63, 222), point(-90, 32, 185), 55), weather: 'mist' },
  { id: 'annex', label: 'Detention Annex', start: 532.5, end: 540,
    from: view(point(-111, 93, 147), point(-58, 43, 105), 56),
    to: view(point(-33, 79, 155), point(-58, 43, 105), 56), weather: 'mist' },
  { id: 'archive', label: 'Survey Archive', start: 540, end: 547.5,
    from: view(point(-231, 91, 94), point(-170, 38, 60), 54),
    to: view(point(-176, 72, 122), point(-170, 38, 60), 54), weather: 'clear' },
  { id: 'signal-tower', label: 'Signal Tower', start: 547.5, end: 555,
    from: view(point(122, 118, -282), point(59, 51, -228), 54),
    to: view(point(44, 92, -277), point(59, 51, -228), 54), weather: 'rain' },
  { id: 'north-inlet', label: 'North Inlet', start: 555, end: 562.5,
    from: view(point(-125, 77, -417), point(-65, 7, -315), 57),
    to: view(point(-50, 56, -371), point(-65, 7, -315), 57), weather: 'mist' },
  { id: 'open-sea', label: 'Open sea beyond Greywake', start: 562.5, end: 570,
    from: view(point(435, 92, -238), point(735, 15, -363), 59, 0.001),
    to: view(point(556, 80, -292), point(820, 15, -410), 59, 0.001),
    weather: 'storm' },
];

const GROUND_SEQUENCE = [
  { id: 'shore-walk', label: 'First-person walk through rain', start: 570, end: 577.5,
    from: view(point(13, 9, 248), point(1, 6, 268), 72),
    to: view(point(6, 6, 260), point(1, 5, 270), 72), weather: 'rain' },
  { id: 'dockhand', label: 'Speak with the South Landing dockhand', start: 577.5, end: 585,
    from: view(point(3, 5.5, 261), point(2, 5, 267), 68),
    weather: 'mist', interaction: 'dockhand' },
  { id: 'road-traffic', label: 'Traffic on the lodge road', start: 585, end: 592.5,
    from: view(point(-92, 40, 153), point(-107, 34, 140), 66),
    to: view(point(-93, 40, 153), point(-123, 34, 124), 66), weather: 'clear' },
  { id: 'western-sheep', label: 'Sheep on the western slope', start: 592.5, end: 600,
    from: view(point(-188, 40, 126), point(-219, 37, 105), 54),
    to: view(point(-195, 40, 120), point(-225, 37, 105), 54), weather: 'mist' },
];

// The two offshore silhouettes and their rotating beacons are authored in
// distantIslands.js. Keep these cameras within the renderer's 3.2 km far plane.
const DISTANT_SEQUENCE = [
  { id: 'greywake-to-north', label: 'Greywake coast turns toward North Watch',
    start: 600, end: 608,
    from: view(point(-90, 105, -450), point(-65, 18, -310), 67, 0.0009),
    to: view(point(-20, 132, -560), NORTH_WATCH, 67, 0.0009),
    weather: 'clear', time: 'noon' },
  { id: 'north-watch-daylight', label: 'North Watch silhouette in daylight',
    start: 608, end: 615,
    from: view(point(25, 165, -590), NORTH_WATCH, 58, 0.00085),
    to: view(point(180, 170, -730), NORTH_WATCH, 58, 0.00085),
    weather: 'clear', time: 'noon' },
  { id: 'southwest-warden-mist', label: 'Southwest Warden beyond the mist',
    start: 615, end: 620,
    from: view(point(-374, 119, 260), SOUTHWEST_WARDEN, 62, 0.001),
    to: view(point(-470, 123, 325), SOUTHWEST_WARDEN, 62, 0.001),
    weather: 'mist', time: 'dusk' },
  { id: 'storm-night-beam', label: 'Lighthouse beam and lightning over Southwest Warden',
    start: 620, end: 630,
    from: nightView(point(-850, 130, 600), SOUTHWEST_WARDEN, 62, 0.0008),
    weather: 'storm', time: 'night' },
];

const FINALE_SEQUENCE = [
  { id: 'north-watch-rise', label: 'Greywake foreground with North Watch beyond',
    start: 630, end: 645,
    from: nightView(point(0, 46, 469), point(0, 22, 209), 68, 0.00085),
    to: nightView(point(0, 255, 910), point(140, 36, -620), 68, 0.00062),
    weather: 'storm', time: 'night' },
  { id: 'warden-beam-rise', label: 'Greywake and Southwest Warden lighthouse beams',
    start: 645, end: 655,
    from: nightView(point(540, 190, -60), point(-220, 35, 160), 74, 0.0007),
    to: nightView(point(870, 270, -250), point(-560, 40, 400), 74, 0.00062),
    weather: 'storm', time: 'night' },
  { id: 'end-title', label: 'IslandWorld title over Greywake and distant light',
    start: 655, end: 660,
    from: nightView(point(870, 270, -250), point(-560, 40, 400), 74, 0.00062),
    weather: 'storm', time: 'night', title: 'ISLAND WORLD' },
];

/**
 * Evaluate the exact 11:00 storyboard. `camera` is a world-space pose for the
 * capture-only camera. `weatherSeconds` drives the existing deterministic
 * weather clock; `simulationSeconds` drives animated world effects. Timelapses
 * sweep the real weather clock 32.5x while keeping each camera fully locked.
 */
export function evaluateShowcase(seconds) {
  if (!Number.isFinite(seconds)) throw new RangeError('Showcase seconds must be finite');
  const time = clamp(seconds, 0, SHOWCASE_DURATION_SECONDS);
  if (time < 30) return shot(TEASER, time, 'teaser');

  if (time < 50) {
    return {
      section: 'arrival', shot: 'ocean-approach', label: 'Ocean approach to Greywake Island',
      shotStart: 30, shotEnd: 50,
      camera: movingView(view(point(0, 220, 1300), point(0, 25, 0), 60, 0.00062),
        view(point(0, 270, 900), point(0, 25, 0), 60, 0.00062), (time - 30) / 20),
      weatherOverride: 'clear', timeOverride: 'noon', weatherSeconds: time,
      simulationSeconds: time, interaction: null, title: null,
    };
  }
  if (time <= FULL_ORBIT.end) {
    const camera = orbitCameraPose((time - FULL_ORBIT.start) / 60);
    return {
      section: 'arrival', shot: 'full-island-orbit', label: 'Unbroken 360° flight around Greywake',
      shotStart: 50, shotEnd: 110,
      camera: { ...camera, fogDensityCap: 0.00062, aerialTrees: true },
      weatherOverride: 'clear', timeOverride: 'noon', weatherSeconds: time,
      simulationSeconds: time, interaction: null, title: null,
    };
  }
  if (time < 120) {
    return {
      section: 'arrival', shot: 'south-landing-descent', label: 'Descend toward South Landing',
      shotStart: 110, shotEnd: 120,
      camera: movingView(view(point(0, 270, 900), point(0, 25, 0), 60, 0.00062),
        view(point(0, 62, 446), point(0, 8, 282), 60, 0.00062), (time - 110) / 10),
      weatherOverride: 'clear', timeOverride: 'noon', weatherSeconds: time,
      simulationSeconds: time, interaction: null, title: null,
    };
  }
  if (time < 270) return shot(WEATHER_SEQUENCE, time, 'weather-system');
  if (time < 390) {
    const entry = FIXED_TIMELAPSES.find((item) => time < item.end);
    const local = time - entry.start;
    return {
      section: 'weather-timelapse', shot: entry.id, label: entry.label,
      shotStart: entry.start, shotEnd: entry.end, camera: entry.camera,
      weatherOverride: 'auto', timeOverride: 'noon',
      // The real cycle moves clear → mist → rain → storm → rain → mist → clear.
      weatherSeconds: 1100 + local * 32.5,
      simulationSeconds: time, interaction: null, title: null,
    };
  }
  if (time < 435) return shot(WATER_SEQUENCE, time, 'water');
  if (time < 510) {
    return {
      section: 'day-night-timelapse', shot: 'fixed-aerial',
      label: 'Dawn to night over Greywake Island', shotStart: 435, shotEnd: 510,
      camera: view(point(0, 294, 933), point(0, 27, 0), 60, 0.00062),
      weatherOverride: 'clear', timeOverride: 5.2 + (time - 435) / 75 * 19,
      weatherSeconds: time, simulationSeconds: time,
      interaction: null, title: null,
    };
  }
  if (time < 570) return shot(SCENIC_SEQUENCE, time, 'scenic-journey');
  if (time < 600) return shot(GROUND_SEQUENCE, time, 'ground-life');
  if (time < 630) return shot(DISTANT_SEQUENCE, time, 'distant-islands');
  return shot(FINALE_SEQUENCE, time, 'final-aerial');
}
