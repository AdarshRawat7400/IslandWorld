// World-space landmarks retained from the original island. Coordinates are metres.
// Only physical site data belongs here.
export const MAIN_LIGHTHOUSE_SITE = Object.freeze({
  id: 'main_lighthouse', name: 'West Headland Lighthouse',
  x: -270, z: -140, kind: 'lighthouse', scale: [14, 14],
  radius: 7.2, period: 10.5, phase: 1.3,
});

export const SITES = Object.freeze([
  { id: 'landing', name: 'South Landing', x: 0, z: 270, kind: 'landing' },
  { id: 'lodge', name: 'Keeper’s Lodge', x: -90, z: 185, kind: 'building', model: 'lodge.glb', scale: [18, 16] },
  { id: 'prison', name: 'Detention Annex', x: -58, z: 105, kind: 'facility' },
  { id: 'archive', name: 'Survey Archive', x: -170, z: 60, kind: 'building', model: 'archive.glb', scale: [17, 14] },
  { id: 'headland', name: 'West Headland', x: -210, z: -120, kind: 'vantage' },
  { id: 'headland_stake', name: 'West Survey Stake', x: -186, z: -120, kind: 'vantage' },
  MAIN_LIGHTHOUSE_SITE,
  { id: 'tower', name: 'Signal Tower', x: 59, z: -228, kind: 'building', model: 'signal_tower.glb', scale: [14, 14] },
  { id: 'east_ridge', name: 'East Survey Ridge', x: 232, z: -120, kind: 'vantage' },
  { id: 'north_jetty', name: 'North Inlet Jetty', x: -65, z: -315, kind: 'landing' },
  { id: 'radio', name: 'Radio House', x: 150, z: -55, kind: 'building', model: 'radio_house.glb', scale: [17, 13] },
  { id: 'pump', name: 'Pump House', x: 125, z: 130, kind: 'building', model: 'pump_house.glb', scale: [17, 13] },
  { id: 'tunnel', name: 'Service Tunnel', x: 167, z: 150, kind: 'hatch' },
]);

export const NAV_LIGHTS = Object.freeze({
  front: { x: -100, z: -286, height: 47 },
  main: { x: -160, z: -171, height: 27 },
  standby: { x: 50, z: -211, height: 21 },
});
