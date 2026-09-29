// Island World renders EZ-Tree geometry with its own bark and leaf materials.
// The prototype's temporary materials are disposed in vegetation.js. Returning
// null here avoids loading 20 unused demonstration textures on module import.
export function getBarkTexture() { return null; }
export function getLeafTexture() { return null; }
