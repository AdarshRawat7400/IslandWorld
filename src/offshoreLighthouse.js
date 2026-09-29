import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = Math.PI * 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const smooth = (low, high, value) => {
  const t = clamp((value - low) / (high - low), 0, 1);
  return t * t * (3 - 2 * t);
};

function signedAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** One slow revolving optic, with a brief sweep rather than a steady floodlight. */
export function lighthouseFlashAtViewer({ heading, lensPosition, cameraPosition,
  fogDensity = 0.0027, night = 0, weather = 'mist' }) {
  if (!cameraPosition || !lensPosition) return 0;
  const dx = cameraPosition.x - lensPosition.x;
  const dz = cameraPosition.z - lensPosition.z;
  const distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance) || distance < 3) return 0;
  const bearing = Math.atan2(dx, dz);
  const angle = signedAngle(bearing - heading);
  // A roughly 13-degree FWHM pulse lasts about a third of a second per turn.
  const alignment = Math.exp(-0.5 * (angle / 0.095) ** 2);
  const power = Math.max(clamp(night, 0, 1) * 0.96,
    weather === 'storm' ? 0.92 : weather === 'rain' ? 0.48 : 0);
  const range = 1 / (1 + (distance / 2200) ** 2);
  // Fog extinguishes the direct light, while the strong marine optic remains
  // discernible over the strait in bad weather.
  const transmission = Math.exp(-distance * Math.max(0, fogDensity) * 0.13);
  return clamp(alignment * power * range * transmission * 2.65, 0, 1);
}

function radialGlowTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const r = Math.hypot((x + 0.5 - size / 2) / (size / 2),
      (y + 0.5 - size / 2) / (size / 2));
    const offset = (y * size + x) * 4;
    data[offset] = 255;
    data[offset + 1] = 242;
    data[offset + 2] = 202;
    data[offset + 3] = Math.round(255 * Math.pow(clamp(1 - r, 0, 1), 2.7));
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function addColoredPart(parts, geometry, color, x = 0, y = 0, z = 0, yaw = 0,
  weathering = false) {
  geometry.rotateY(yaw);
  geometry.translate(x, y, z);
  const positions = geometry.getAttribute('position');
  const colors = new Float32Array(positions.count * 3);
  const base = new THREE.Color(color);
  for (let i = 0; i < positions.count; i++) {
    const py = positions.getY(i);
    const px = positions.getX(i);
    const pz = positions.getZ(i);
    const course = 0.055 * Math.sin(py * 2.15);
    const streak = 0.055 * Math.sin(px * 1.37 + pz * 1.08 + py * 0.11)
      * Math.cos(py * 0.37 + px * 0.48);
    const variation = weathering ? 0.90 + course + streak : 1;
    colors[i * 3] = clamp(base.r * variation, 0, 1);
    colors[i * 3 + 1] = clamp(base.g * variation, 0, 1);
    colors[i * 3 + 2] = clamp(base.b * variation, 0, 1);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  parts.push(geometry);
}

function towerGeometry(frontBearing) {
  const parts = [];
  const stone = 0xb4b8ae;
  const darkStone = 0x656e69;
  const iron = 0x2f3e43;
  const brass = 0x96876a;
  addColoredPart(parts, new THREE.CylinderGeometry(6.6, 7.2, 2.4, 24),
    darkStone, 0, 1.2, 0, 0, true);
  addColoredPart(parts, new THREE.CylinderGeometry(3.35, 5.4, 24, 28, 12),
    stone, 0, 14.4, 0, 0, true);
  for (const y of [2.8, 10.1, 17.4, 24.7]) {
    const radius = 5.4 - (y - 2.4) * (2.05 / 24) + 0.11;
    addColoredPart(parts, new THREE.CylinderGeometry(radius, radius, 0.35, 28),
      y === 2.8 ? darkStone : 0x919992, 0, y, 0);
  }
  addColoredPart(parts, new THREE.CylinderGeometry(5.1, 5.1, 0.95, 24),
    darkStone, 0, 26.8, 0);
  addColoredPart(parts, new THREE.CylinderGeometry(4.48, 4.48, 0.37, 24),
    stone, 0, 27.45, 0);

  // A glazed lantern needs a real gallery, narrow cast-iron mullions and rails.
  for (let i = 0; i < 14; i++) {
    const a = i / 14 * TAU;
    addColoredPart(parts, new THREE.CylinderGeometry(0.105, 0.105, 4.9, 5),
      iron, Math.sin(a) * 3.48, 29.75, Math.cos(a) * 3.48);
  }
  for (let i = 0; i < 18; i++) {
    const a = i / 18 * TAU;
    addColoredPart(parts, new THREE.CylinderGeometry(0.07, 0.07, 1.5, 5),
      iron, Math.sin(a) * 4.58, 28.25, Math.cos(a) * 4.58);
  }
  for (const y of [27.62, 28.95]) {
    const ring = new THREE.TorusGeometry(4.58, 0.07, 4, 36);
    ring.rotateX(Math.PI / 2);
    addColoredPart(parts, ring, iron, 0, y, 0);
  }
  for (const y of [27.3, 32.2]) {
    const ring = new THREE.TorusGeometry(3.55, 0.16, 4, 28);
    ring.rotateX(Math.PI / 2);
    addColoredPart(parts, ring, brass, 0, y, 0);
  }
  addColoredPart(parts, new THREE.CylinderGeometry(4.14, 3.8, 0.55, 24),
    iron, 0, 32.4, 0);
  addColoredPart(parts, new THREE.ConeGeometry(4.7, 3.2, 24),
    iron, 0, 34.2, 0);
  addColoredPart(parts, new THREE.SphereGeometry(0.37, 8, 6),
    brass, 0, 36.0, 0);
  addColoredPart(parts, new THREE.CylinderGeometry(0.08, 0.08, 1.15, 5),
    iron, 0, 36.65, 0);

  // Dark door and two slit windows face the inhabited island.
  for (const [y, w, h] of [[4.2, 1.7, 3.7], [12.8, 0.98, 1.6],
    [20.4, 0.86, 1.45]]) {
    const radius = 5.4 - (y - 2.4) * (2.05 / 24) + 0.16;
    const normalX = Math.sin(frontBearing);
    const normalZ = Math.cos(frontBearing);
    addColoredPart(parts, new THREE.BoxGeometry(w + 0.25, h + 0.25, 0.10),
      darkStone, normalX * radius, y, normalZ * radius, frontBearing);
    addColoredPart(parts, new THREE.BoxGeometry(w, h, 0.12),
      0x26343a, normalX * (radius + 0.08), y, normalZ * (radius + 0.08),
      frontBearing);
  }

  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error('Could not build lighthouse geometry');
  geometry.computeBoundingSphere();
  return geometry;
}

function masonryMaterial() {
  return new THREE.ShaderMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uFogColor: { value: new THREE.Color(0x87969a) },
      uFogDensity: { value: 0.0027 },
      uNight: { value: 0 },
      uLightning: { value: 0 },
    },
    vertexShader: `
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vColor = color;
        vNormal = normalize(normalMatrix * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uNight;
      uniform float uLightning;
      varying vec3 vColor;
      varying vec3 vNormal;
      varying vec3 vWorld;
      void main() {
        vec3 sun = normalize(vec3(-0.43, 0.84, 0.31));
        float lambert = max(dot(normalize(vNormal), sun), 0.0);
        float light = mix(0.72 + lambert * 0.32, 0.31 + lambert * 0.07, uNight);
        vec3 stone = vColor * (light + uLightning * 0.42);
        float range = distance(cameraPosition, vWorld);
        float visibility = max(exp(-pow(range * uFogDensity * 0.38, 1.55)), 0.12);
        gl_FragColor = vec4(mix(uFogColor, stone, visibility), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

function beamGeometry(vertical) {
  const positions = [], across = [], along = [], indices = [];
  const rows = [0, 0.08, 0.2, 0.4, 0.65, 1];
  for (const t of rows) {
    const distance = 7 + t * 1250;
    const width = 1.25 + distance * 0.042;
    for (const s of [-1, 0, 1]) {
      positions.push(vertical ? 0 : s * width,
        vertical ? s * width : 0, distance);
      across.push(s);
      along.push(t);
    }
  }
  for (let r = 0; r < rows.length - 1; r++) for (let c = 0; c < 2; c++) {
    const a = r * 3 + c;
    indices.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1));
  geometry.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function scatteringMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uStrength: { value: 0 },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    vertexShader: `
      attribute float aAcross;
      attribute float aAlong;
      varying float vAcross;
      varying float vAlong;
      void main() {
        vAcross = aAcross;
        vAlong = aAlong;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uStrength;
      uniform float uTime;
      varying float vAcross;
      varying float vAlong;
      void main() {
        float core = pow(max(0.0, 1.0 - abs(vAcross)), 1.5);
        float taper = pow(max(0.0, 1.0 - vAlong), 0.9);
        float moisture = 0.88 + 0.12 * sin(vAlong * 39.0 - uTime * 0.85);
        float opacity = uStrength * core * taper * moisture;
        if (opacity < 0.002) discard;
        gl_FragColor = vec4(vec3(1.0, 0.88, 0.67), opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

/**
 * Low-cost remote lighthouse. Parent the returned group to its island group.
 * The eye flash is a scalar so the caller can apply a screen-space glare only
 * when this fixed lens position projects into the camera view.
 */
export function createOffshoreLighthouse(spec, { groundY = 0,
  glowTexture = null } = {}) {
  if (!spec?.lighthouse) throw new TypeError('Island specification needs a lighthouse site');
  const site = spec.lighthouse;
  const group = new THREE.Group();
  group.name = `Offshore lighthouse: ${spec.name}`;
  group.position.set(site.x, groundY, site.z);
  const lensY = 29.75;
  const worldPosition = new THREE.Vector3(spec.x + site.x,
    groundY + lensY, spec.z + site.z);
  const frontBearing = Math.atan2(-worldPosition.x, -worldPosition.z);
  const masonry = masonryMaterial();
  const tower = new THREE.Mesh(towerGeometry(frontBearing), masonry);
  tower.name = 'Masonry tower, gallery and lantern frame';
  group.add(tower);

  const glassMaterial = new THREE.MeshBasicMaterial({
    color: 0x7b928f, transparent: true, opacity: 0.38, depthWrite: false,
    side: THREE.DoubleSide, fog: false,
  });
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(3.47, 3.47, 4.65,
    14, 1, true), glassMaterial);
  glass.position.y = lensY;
  glass.name = 'Glazed lantern room';
  group.add(glass);
  const lensMaterial = new THREE.MeshBasicMaterial({
    color: 0xffe3a6, fog: false, toneMapped: false,
  });
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.77, 0.77, 2.1,
    12), lensMaterial);
  lens.position.y = lensY;
  lens.name = 'Fresnel lens';
  group.add(lens);

  const beamRoot = new THREE.Group();
  beamRoot.name = 'Revolving optical beam';
  beamRoot.position.y = lensY;
  const beamMaterial = scatteringMaterial();
  const beams = [false, true].map((vertical) => {
    const mesh = new THREE.Mesh(beamGeometry(vertical), beamMaterial);
    mesh.name = vertical ? 'Vertical moisture scattering' : 'Horizontal moisture scattering';
    mesh.frustumCulled = false;
    beamRoot.add(mesh);
    return mesh;
  });
  group.add(beamRoot);

  const ownsGlowTexture = !glowTexture;
  const texture = glowTexture || radialGlowTexture();
  const coreMaterial = new THREE.SpriteMaterial({
    map: texture, color: 0xffedc7, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const haloMaterial = new THREE.SpriteMaterial({
    map: texture, color: 0xffd18a, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const core = new THREE.Sprite(coreMaterial);
  core.position.y = lensY;
  core.scale.set(22, 22, 1);
  core.name = 'Focused lamp core';
  const halo = new THREE.Sprite(haloMaterial);
  halo.position.y = lensY;
  halo.scale.set(126, 126, 1);
  halo.name = 'Atmospheric lamp halo';
  group.add(halo, core);

  const fog = new THREE.Color();
  const glassBase = new THREE.Color(0x7b928f);
  const lensBase = new THREE.Color(0xffe3a6);
  const period = clamp(Number(site.period) || 10, 8, 12);
  const beacon = {
    group, tower, beamRoot, beams, core, halo, worldPosition,
    viewerFlash: 0, heading: Number(site.phase) || 0, period,
    update(elapsed = 0, { night = 0, weather = 'mist', cameraPosition = null,
      fogDensity = 0.0027, fogColor = null, lightning = 0 } = {}) {
      const time = Number.isFinite(elapsed) ? elapsed : 0;
      const nightLevel = clamp(Number(night) || 0, 0, 1);
      const fogRate = Math.max(0, Number(fogDensity) || 0);
      const power = Math.max(nightLevel * 0.96,
        weather === 'storm' ? 0.92 : weather === 'rain' ? 0.48 : 0);
      this.heading = (time * TAU / period + (Number(site.phase) || 0)) % TAU;
      beamRoot.rotation.y = this.heading;
      this.viewerFlash = lighthouseFlashAtViewer({
        heading: this.heading, lensPosition: worldPosition, cameraPosition,
        fogDensity: fogRate, night: nightLevel, weather,
      });
      const fogColorValue = fogColor?.isColor ? fogColor : fog.set(0x87969a);
      masonry.uniforms.uFogColor.value.copy(fogColorValue);
      masonry.uniforms.uFogDensity.value = fogRate;
      masonry.uniforms.uNight.value = nightLevel;
      masonry.uniforms.uLightning.value = clamp(Number(lightning) || 0, 0, 1);
      glassMaterial.color.copy(glassBase).lerp(fogColorValue,
        weather === 'storm' ? 0.55 : 0.34);
      lensMaterial.color.copy(lensBase).lerp(new THREE.Color(0xffffff),
        this.viewerFlash * 0.25);
      const distance = cameraPosition ? cameraPosition.distanceTo(worldPosition) : 1500;
      const transmission = Math.exp(-distance * fogRate * 0.13);
      const bearing = cameraPosition ? Math.atan2(cameraPosition.x - worldPosition.x,
        cameraPosition.z - worldPosition.z) : this.heading + Math.PI;
      const alignment = Math.exp(-0.5 * (signedAngle(bearing - this.heading) / 0.105) ** 2);
      coreMaterial.opacity = clamp(power * (0.20 + alignment * 0.80)
        * Math.max(0.35, transmission) * 1.7, 0, 1);
      haloMaterial.opacity = clamp(power * (0.045 + alignment * 0.46)
        * Math.max(0.25, transmission) * (weather === 'storm' ? 1.4 : 1), 0, 0.8);
      const scattering = weather === 'storm' ? 0.38
        : weather === 'rain' ? 0.12 : weather === 'mist' ? 0.085 : 0.018;
      beamMaterial.uniforms.uStrength.value = power * scattering;
      beamMaterial.uniforms.uTime.value = time;
      beamRoot.visible = power > 0.01 && scattering > 0.02;
      return this.viewerFlash;
    },
    dispose() {
      tower.geometry.dispose();
      glass.geometry.dispose();
      lens.geometry.dispose();
      for (const beam of beams) beam.geometry.dispose();
      masonry.dispose();
      glassMaterial.dispose();
      lensMaterial.dispose();
      beamMaterial.dispose();
      coreMaterial.dispose();
      haloMaterial.dispose();
      if (ownsGlowTexture) texture.dispose();
      group.removeFromParent();
    },
  };
  beacon.update();
  return beacon;
}
