// The south cove falls sharply just above the pier. Short sections follow
// that curved descent so the coarse rendered terrain cannot cover the timber.
export const LANDING_BOARDWALK = Object.freeze({
  startZ: 268, endZ: 343, sectionLength: 4,
  centerHeight: 0.23, plankThickness: 0.18,
});

export function landingBoardwalkSections(terrainHeight) {
  const sections = [];
  for (let startZ = LANDING_BOARDWALK.startZ;
    startZ < LANDING_BOARDWALK.endZ;
    startZ += LANDING_BOARDWALK.sectionLength) {
    const endZ = Math.min(LANDING_BOARDWALK.endZ,
      startZ + LANDING_BOARDWALK.sectionLength);
    const yStart = terrainHeight(0, startZ) + LANDING_BOARDWALK.centerHeight;
    const yEnd = terrainHeight(0, endZ) + LANDING_BOARDWALK.centerHeight;
    const span = Math.hypot(endZ - startZ, yStart - yEnd);
    sections.push({ startZ, endZ, yStart, yEnd, span,
      pitch: Math.atan2(yStart - yEnd, endZ - startZ) });
  }
  return sections;
}

/** Actual upper face of a pitched rectangular plank at its world z. */
export function landingBoardwalkTopAt(sections, z) {
  const section = sections.find(({ startZ, endZ }) => z >= startZ && z <= endZ);
  if (!section) return null;
  const fraction = (z - section.startZ) / (section.endZ - section.startZ);
  return section.yStart + (section.yEnd - section.yStart) * fraction
    + LANDING_BOARDWALK.plankThickness / (2 * Math.cos(section.pitch));
}
