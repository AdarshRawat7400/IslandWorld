import * as THREE from 'three';
import { SITES } from './worldSites.js';
import { createFerryVisual, createRescueLaunchVisual } from './ferryVisual.js';
import { boatTiltFromNormal } from './oceanWaveField.js';

const DEFAULT_SEA_LEVEL = 0.05;
const HULL_WATERLINE_OFFSET = 0.19;

function makeGlowTexture() {
  const size = 32;
  const pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const distance = Math.hypot((x + 0.5 - size / 2) / 16,
      (y + 0.5 - size / 2) / 16);
    const index = (y * size + x) * 4;
    pixels[index] = pixels[index + 1] = pixels[index + 2] = 255;
    pixels[index + 3] = Math.round(Math.pow(Math.max(0, 1 - distance), 2.3) * 205);
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Two permanently berthed craft independent of other game systems. */
export function createScenicBoats(scene, waterHeight = () => DEFAULT_SEA_LEVEL) {
  if (!scene?.add || typeof waterHeight !== 'function') {
    throw new TypeError('createScenicBoats requires a scene and waterHeight(x, z, time)');
  }
  const southLanding = SITES.find((site) => site.id === 'landing');
  const northJetty = SITES.find((site) => site.id === 'north_jetty');
  if (!southLanding || !northJetty) throw new Error('The island needs both landing sites');

  const ferry = new THREE.Group();
  ferry.name = 'South Landing passenger ferry';
  ferry.position.set(southLanding.x + 6, DEFAULT_SEA_LEVEL, southLanding.z + 82);
  ferry.rotation.y = Math.PI;
  ferry.add(createFerryVisual());

  const utilityLaunch = new THREE.Group();
  utilityLaunch.name = 'North Inlet utility launch';
  utilityLaunch.position.set(northJetty.x, DEFAULT_SEA_LEVEL, northJetty.z - 27);
  utilityLaunch.add(createRescueLaunchVisual());

  const glowMap = makeGlowTexture();
  const lampGeometry = new THREE.SphereGeometry(0.12, 8, 6);
  const lampMaterials = [];
  const glowMaterials = [];
  function addNavLight(craft, color, x, z, y, intensity, glowSize) {
    const lampMaterial = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    lampMaterials.push(lampMaterial);
    const bulb = new THREE.Mesh(lampGeometry, lampMaterial);
    bulb.position.set(x, y, z);
    craft.add(bulb);
    const light = new THREE.PointLight(color, intensity, 23, 2);
    light.position.copy(bulb.position);
    craft.add(light);
    const glowMaterial = new THREE.SpriteMaterial({
      map: glowMap, color, transparent: true, opacity: 0.7,
      depthWrite: false, fog: true,
    });
    glowMaterials.push(glowMaterial);
    const glow = new THREE.Sprite(glowMaterial);
    glow.position.copy(bulb.position);
    glow.scale.set(glowSize, glowSize, 1);
    craft.add(glow);
    return light;
  }
  addNavLight(ferry, 0xe6d7a3, 0, -1.87, 4.28, 0.75, 2.5);
  const mastLight = addNavLight(utilityLaunch, 0xe8ecdd, 0, -0.85, 4.14, 2.2, 3.1);
  addNavLight(utilityLaunch, 0xd7a5a2, 1.12, 0.3, 1.45, 0.45, 1.7);
  addNavLight(utilityLaunch, 0xa7d6ad, -1.12, 0.3, 1.45, 0.45, 1.7);
  scene.add(ferry, utilityLaunch);

  function sampleHeight(craft, time) {
    const sampled = waterHeight(craft.position.x, craft.position.z, time);
    return Number.isFinite(sampled) ? sampled : DEFAULT_SEA_LEVEL;
  }

  function update(elapsed = 0, weather = 'mist') {
    const time = Number.isFinite(elapsed) ? elapsed : 0;
    const waveMotion = weather === 'storm' ? 1.55 : weather === 'rain' ? 1.2 : 1;
    const ferryTilt = boatTiltFromNormal(waterHeight.normalAt?.(
      ferry.position.x, ferry.position.z, time), ferry.rotation.y, 0.045, 0.06);
    ferry.position.y = sampleHeight(ferry, time) + HULL_WATERLINE_OFFSET
      + (ferryTilt ? 0 : Math.sin(time * 1.14 + 1.3) * 0.035 * waveMotion);
    ferry.rotation.x = ferryTilt?.pitch
      ?? Math.sin(time * 0.67 + 2.1) * 0.016 * waveMotion;
    ferry.rotation.z = ferryTilt?.roll
      ?? Math.sin(time * 0.83 + 0.5) * 0.022 * waveMotion;
    const launchTilt = boatTiltFromNormal(waterHeight.normalAt?.(
      utilityLaunch.position.x, utilityLaunch.position.z, time), utilityLaunch.rotation.y,
    0.075, 0.095);
    utilityLaunch.position.y = sampleHeight(utilityLaunch, time) + HULL_WATERLINE_OFFSET
      + (launchTilt ? 0 : Math.sin(time * 1.47 + 0.8) * 0.05 * waveMotion);
    utilityLaunch.rotation.x = launchTilt?.pitch
      ?? Math.sin(time * 0.91 + 0.3) * 0.022 * waveMotion;
    utilityLaunch.rotation.z = launchTilt?.roll
      ?? Math.sin(time * 1.08 + 1.8) * 0.025 * waveMotion;
    mastLight.intensity = weather === 'storm' ? 2.6 : 2.2;
  }

  update();
  return {
    ferry,
    utilityLaunch,
    update,
    dispose() {
      scene.remove(ferry, utilityLaunch);
      lampGeometry.dispose();
      glowMap.dispose();
      for (const material of [...lampMaterials, ...glowMaterials]) material.dispose();
    },
  };
}
