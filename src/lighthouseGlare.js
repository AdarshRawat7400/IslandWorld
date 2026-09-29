import * as THREE from 'three';

const projected = new THREE.Vector3();

function isLandOccluded(cameraPosition, target, terrainHeight) {
  if (typeof terrainHeight !== 'function') return false;
  const dx = target.x - cameraPosition.x;
  const dz = target.z - cameraPosition.z;
  const distance = Math.hypot(dx, dz);
  const stop = Math.min(600, distance - 50);
  for (let along = 35; along < stop; along += 35) {
    const t = along / distance;
    const x = cameraPosition.x + dx * t;
    const z = cameraPosition.z + dz * t;
    const rayY = cameraPosition.y + (target.y - cameraPosition.y) * t;
    if (terrainHeight(x, z) > rayY + 1.5) return true;
  }
  return false;
}

/** A brief, screen-space lens glint only when the rotating beam reaches the viewer. */
export function createLighthouseGlare(element, terrainHeight) {
  if (!element) throw new TypeError('Lighthouse glare element is required');
  function update(camera, beacons, enabled = true) {
    if (!enabled || !Array.isArray(beacons)) {
      element.style.opacity = '0';
      return;
    }
    camera.updateMatrixWorld();
    let strongest = 0;
    let screenX = 0;
    let screenY = 0;
    for (const beacon of beacons) {
      const flash = beacon.viewerFlash || 0;
      if (flash <= strongest || !beacon.worldPosition) continue;
      projected.copy(beacon.worldPosition).project(camera);
      if (projected.z < -1 || projected.z > 1
        || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) continue;
      if (isLandOccluded(camera.position, beacon.worldPosition, terrainHeight)) continue;
      strongest = flash;
      screenX = (projected.x * 0.5 + 0.5) * 100;
      screenY = (0.5 - projected.y * 0.5) * 100;
    }
    if (strongest < 0.003) {
      element.style.opacity = '0';
      return;
    }
    element.style.setProperty('--flare-x', `${screenX.toFixed(2)}%`);
    element.style.setProperty('--flare-y', `${screenY.toFixed(2)}%`);
    element.style.opacity = Math.min(0.78, strongest * 0.76).toFixed(3);
  }
  return { update };
}
