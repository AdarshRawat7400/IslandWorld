// Shared inventory and pickup rules. This module has no renderer or server state.
// World locations are selected from clearings checked against the island's
// terrain, roads, buildings, parked vehicles, trees, and rocks.
import { MAX_HEALTH, WEAPONS } from './multiplayerRules.js';

export const MAX_GUNS = 3;
export const MAX_GRENADES = 3;
export const MAX_MINES = 3;
export const MAX_ARMOR = 100;
export const STARTER_GUNS = Object.freeze(['revolver', 'rifle']);
export const GUN_IDS = Object.freeze(['revolver', 'rifle', 'shotgun']);
export const ITEM_DEFINITIONS = Object.freeze({
  revolver: Object.freeze({ kind: 'gun', label: 'Service Revolver' }),
  rifle: Object.freeze({ kind: 'gun', label: 'Hunting Rifle' }),
  shotgun: Object.freeze({ kind: 'gun', label: 'Pump Shotgun' }),
  grenade: Object.freeze({ kind: 'grenade', label: 'Grenade' }),
  mine: Object.freeze({ kind: 'mine', label: 'Proximity Mine' }),
  medkit: Object.freeze({ kind: 'medkit', label: 'Field Medkit', heal: 40 }),
  ammo: Object.freeze({ kind: 'ammo', label: 'Ammunition Box' }),
  armor: Object.freeze({ kind: 'armor', label: 'Armor Plate', restore: 50 }),
});

const clampCount = (value, max) => Number.isFinite(value)
  ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
const isGun = (id) => GUN_IDS.includes(id);

/** An inventory value is plain JSON and can be used by solo play or a room. */
export function createInventory(input = {}) {
  const requested = Array.isArray(input.guns) ? input.guns : STARTER_GUNS;
  const guns = [...new Set(requested.filter(isGun))].slice(0, MAX_GUNS);
  const selectedGun = guns.includes(input.selectedGun) ? input.selectedGun : guns[0] ?? null;
  return {
    guns,
    grenades: clampCount(input.grenades, MAX_GRENADES),
    mines: clampCount(input.mines, MAX_MINES),
    selectedGun,
  };
}

export function canCollectItem(inventory, itemId) {
  const item = Object.hasOwn(ITEM_DEFINITIONS, itemId)
    ? ITEM_DEFINITIONS[itemId] : null;
  if (!item || !inventory) return false;
  if (item.kind === 'gun') return Array.isArray(inventory.guns)
    && !inventory.guns.includes(itemId) && inventory.guns.length < MAX_GUNS;
  if (item.kind === 'grenade') return inventory.grenades < MAX_GRENADES;
  if (item.kind === 'mine') return inventory.mines < MAX_MINES;
  return false;
}

/** Adds as much of a stack as fits. An unavailable or full item is a no-op. */
export function collectItem(inventory, itemId, count = 1) {
  if (!canCollectItem(inventory, itemId) || !Number.isInteger(count) || count < 1)
    return inventory;
  if (isGun(itemId)) return { ...inventory, guns: [...inventory.guns, itemId],
    selectedGun: inventory.selectedGun ?? itemId };
  const field = itemId === 'grenade' ? 'grenades' : 'mines';
  const maximum = field === 'grenades' ? MAX_GRENADES : MAX_MINES;
  return { ...inventory, [field]: Math.min(maximum, inventory[field] + count) };
}

/** Only thrown or placed items are consumed; guns remain until death or reset. */
export function consumeItem(inventory, itemId, count = 1) {
  if (!inventory || !Number.isInteger(count) || count < 1) return inventory;
  const field = itemId === 'grenade' ? 'grenades' : itemId === 'mine' ? 'mines' : null;
  if (!field || !Number.isInteger(inventory[field]) || inventory[field] < count) return inventory;
  return { ...inventory, [field]: inventory[field] - count };
}

export function selectGun(inventory, gunId) {
  if (!inventory || !inventory.guns?.includes(gunId) || inventory.selectedGun === gunId)
    return inventory;
  return { ...inventory, selectedGun: gunId };
}

export function cycleGun(inventory, direction = 1) {
  if (!inventory?.guns?.length || !Number.isFinite(direction) || direction === 0)
    return inventory;
  const current = Math.max(0, inventory.guns.indexOf(inventory.selectedGun));
  const next = (current + (direction > 0 ? 1 : -1) + inventory.guns.length)
    % inventory.guns.length;
  return selectGun(inventory, inventory.guns[next]);
}

/** Supplies apply on pickup; they do not occupy an inventory slot. */
export function canApplySupply(state, itemId) {
  if (itemId === 'medkit') return Number.isFinite(state?.health)
    && state.health >= 0 && state.health < MAX_HEALTH;
  if (itemId === 'armor') return Number.isFinite(state?.armor)
    && state.armor >= 0 && state.armor < MAX_ARMOR;
  if (itemId !== 'ammo' || !Array.isArray(state?.inventory?.guns)) return false;
  return state.inventory.guns.some((id) => {
    const reserve = state.ammo?.[id]?.reserve;
    return Object.hasOwn(WEAPONS, id) && Number.isFinite(reserve)
      && reserve >= 0 && reserve < WEAPONS[id].reserve;
  });
}

/** Returns new ammo objects only for refilled guns; preserves timers and metadata. */
export function applySupply(state, itemId) {
  const health = state?.health;
  const armor = state?.armor;
  const ammo = state?.ammo;
  if (!canApplySupply(state, itemId)) return { applied: false, health, armor, ammo };
  if (itemId === 'medkit') return {
    applied: true, health: Math.min(MAX_HEALTH, health + ITEM_DEFINITIONS.medkit.heal),
    armor, ammo,
  };
  if (itemId === 'armor') return {
    applied: true, health, armor: Math.min(MAX_ARMOR,
      armor + ITEM_DEFINITIONS.armor.restore), ammo,
  };
  const nextAmmo = { ...ammo };
  for (const id of state.inventory.guns) {
    if (!Object.hasOwn(WEAPONS, id) || !Number.isFinite(ammo?.[id]?.reserve)) continue;
    const prior = ammo[id];
    const reserve = Math.min(WEAPONS[id].reserve,
      prior.reserve + WEAPONS[id].magazine);
    if (reserve > prior.reserve) nextAmmo[id] = { ...prior, reserve };
  }
  return { applied: true, health, armor, ammo: nextAmmo };
}

// These clearings were checked with createWorld(), the island's authored
// collision helpers, and the road geometry. Keep the pool separate from the
// room seed so all peers agree on reachable, ground-level pickup positions.
const CLEARING_POOL = Object.freeze([
  [198.8, 244.1], [-163.4, 109.8], [-223, -223.4], [-26.4, -13.1],
  [-225.6, -33.7], [32.1, -259.8], [234.4, 37.6], [-95.8, -238.2],
  [81.7, -89.1], [247.3, -2.9], [84.5, -134.9], [23.2, -181.6],
  [66.2, -210.1], [-153.9, 216.5], [212, 161], [-139.2, 5.3],
  [-223.2, 224.7], [-78.4, -183.3], [178.1, -234.2], [120, -259.9],
  [184.4, 186.6], [36.4, -222.8], [-103.2, 76.5], [114.5, -1.1],
  [187, -120.7], [-163.1, 249.3], [85.7, -8.4], [-164.2, -51.6],
  [87.9, 101.6], [-179.3, -202.2], [-105.6, -139.4], [-3.4, -40],
  [223.6, 111.3], [-252, 88.7], [106.2, 261.2], [-18.7, -125.1],
  [44.9, -27.7], [65.6, -168.4], [-189.8, 261.8], [232.5, 208.8],
  [-213.7, 116.8], [-30.3, 143.1], [126.1, 101.5], [213.6, -164],
  [-200.4, 54.2], [-69.4, 151], [259.2, 99.9], [127.2, -156.5],
  [-210.4, 3.5], [-55.2, 181.6], [246.8, 134.7], [-246.3, -65.6],
  [252.7, 172.8], [98.2, 74.2], [16.3, 131.2], [51.4, -66.5],
  [132.5, 172.8], [85.3, -60.3], [214.2, -65.3], [148.3, -226.2],
  [243.1, 66.3], [263.6, -88.2], [136.3, 217.5], [143.8, 36.8],
]);

function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  let hash = 2166136261;
  for (const character of String(seed ?? 'default')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let state = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function shuffled(values, random) {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

const WORLD_ITEM_IDS = Object.freeze([
  'revolver', 'rifle', 'rifle', 'shotgun', 'shotgun', 'shotgun', 'shotgun',
  ...Array(12).fill('grenade'), ...Array(10).fill('mine'),
  ...Array(7).fill('medkit'), ...Array(8).fill('ammo'),
  ...Array(7).fill('armor'),
]);

/** Seeded room layout; IDs remain stable until a world pickup respawns. */
export function createWorldPickupSpawns(seed = 0x5eed1) {
  const random = seededRandom(seed);
  const sites = shuffled(CLEARING_POOL, random);
  const items = shuffled(WORLD_ITEM_IDS, random);
  return items.map((itemId, index) => ({
    id: `world-${index}`, kind: ITEM_DEFINITIONS[itemId].kind,
    itemId, x: sites[index][0], z: sites[index][1], count: 1, source: 'world',
  }));
}

export const WORLD_PICKUP_SPAWNS = Object.freeze(
  createWorldPickupSpawns().map((pickup) => Object.freeze(pickup)));

/** A corpse leaves carried equipment for other players to recover. */
export function inventoryDrops(inventory, position, seed = 0) {
  if (!inventory || !Number.isFinite(position?.x) || !Number.isFinite(position?.z))
    return [];
  const items = [
    ...(inventory.guns ?? []).filter((id) => isGun(id) && id !== 'revolver')
      .map((itemId) => ({ itemId, count: 1 })),
    ...(inventory.grenades > 0 ? [{ itemId: 'grenade', count: clampCount(
      inventory.grenades, MAX_GRENADES) }] : []),
    ...(inventory.mines > 0 ? [{ itemId: 'mine', count: clampCount(
      inventory.mines, MAX_MINES) }] : []),
  ];
  const suffix = String(seed).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || '0';
  return items.map(({ itemId, count }, index) => ({
    id: `drop-${suffix}-${index}`, kind: ITEM_DEFINITIONS[itemId].kind,
    itemId, x: position.x, z: position.z, count, source: 'player',
  }));
}
