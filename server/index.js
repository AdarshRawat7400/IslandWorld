import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { Server as SocketIOServer } from 'socket.io';
import { PRISON_LAYOUT } from '../src/setDressing.js';
import { CLIFF_FALL } from '../src/cliffFall.js';
import { playerStance, stanceEyeHeight, validPlayerStance }
  from '../src/playerStance.js';
import { isLake } from '../src/inlandLake.js';
import { islandCoastalRadiusAt, islandTerrainHeightAt, playerEyeHeightAt,
  shotBlockedByTerrain }
  from '../src/world.js';
import { SERVER_WILDLIFE_HOMES, WILDLIFE_KINDS, wildlifeTargetsAt }
  from '../src/fauna.js';
import { RESIDENT_SITES, selectResidentSites } from '../src/islandResidents.js';
import { PRISON_OCCUPANTS } from '../src/prisonPopulation.js';
import { isRoad } from '../src/roads.js';
import { createNpcCombatant, rayNpcHit, npcThreatenedByShot,
  alertNpc, applyNpcDamage, npcAttackDecision } from '../src/npcCombatRules.js';
import { createDynamicWeather } from '../src/dynamicWeather.js';
import { shotBlockedByStructures } from './lineOfSight.js';
import { createVoiceService } from './voiceService.js';
import {
  createWorldPickupSpawns, createInventory, canCollectItem, collectItem,
  consumeItem, selectGun, cycleGun, inventoryDrops, canApplySupply, applySupply,
} from '../src/combatLoot.js';
import {
  MAX_ROOM_PLAYERS, MAX_HEALTH, RESPAWN_DELAY_MS, SPAWN_PROTECTION_MS,
  RECONNECT_GRACE_MS, SAFE_SPAWNS, ARRIVAL_SPAWNS,
  VALID_TIME, VALID_WEATHER, WEAPONS, EXPLOSIVES, blastDamageAt,
  cleanPlayerName, validWorldPosition, normalizedDirection, rayPlayerHit, rayWildlifeHit,
} from '../src/multiplayerRules.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MODES = new Set(['explore', 'pvp']);
const MOVE_MODES = new Set(['walk', 'drive', 'drone']);
const ROOM_TICK_MS = 100;
const MAX_SHOT_ORIGIN_ERROR = 2.3;
const WALK_EYE_TOLERANCE = 0.85;
const RECOVERY_MIN_INTERVAL_MS = 900;
const PICKUP_REACH = 3.5;
const WORLD_PICKUP_RESPAWN_MS = 90000;
const PLAYER_PICKUP_TTL_MS = 180000;
const MAX_ROOM_PICKUPS = 90;
const MAX_ROOM_EXPLOSIVES = 64;
const MAX_PLAYER_EXPLOSIVES = 8;
const USE_INTERVAL_MS = 350;
const VOICE_CREDENTIAL_WINDOW_MS = 60000;
const VOICE_CREDENTIAL_LIMIT = 6;
const wildlifeWeatherClock = createDynamicWeather();

const success = (body = {}) => ({ ok: true, ...body });
const failure = (error, message = error) => ({ ok: false, error, message });
const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);
const distanceXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const publicAmmo = (ammo) => Object.fromEntries(Object.entries(ammo).map(([id, item]) =>
  [id, { magazine: item.magazine, reserve: item.reserve, reloadingUntil: item.reloadingUntil }]));
const publicInventory = (inventory) => ({ ...inventory, guns: [...inventory.guns] });
const publicPickup = ({ expiresAt, initialCount, ...pickup }) => ({ ...pickup });
const publicExplosive = ({ id, kind, ownerId, x, y, z, createdAt, detonatesAt,
  armedAt, expiresAt, radius }) => ({ id, kind, ownerId, x, y, z, createdAt,
  ...(detonatesAt ? { detonatesAt } : {}), ...(armedAt ? { armedAt } : {}),
  ...(expiresAt ? { expiresAt } : {}), radius });
const publicNpc = ({ id, name, kind, weapon, x, y, z, heading, health, maxHealth,
  dead, alerted, targetId }) => ({ id, name, kind, weapon, x, y, z, heading,
  health, maxHealth, dead, alerted, targetId });

function damagePlayer(player, damage) {
  const armorDamage = Math.min(player.armor, damage);
  const healthDamage = Math.min(player.health, damage - armorDamage);
  player.armor -= armorDamage;
  player.health -= healthDamage;
  return { damage, armorDamage, healthDamage, armor: player.armor,
    health: player.health, dead: player.health === 0 };
}

function allowedOrigin(origin, configured) {
  if (!origin) return true; // Node clients and same-origin server-side checks.
  if (configured.length) return configured.includes(origin);
  try {
    const parsed = new URL(origin);
    return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
      && ['http:', 'https:'].includes(parsed.protocol);
  } catch { return false; }
}

function freshAmmo() {
  return Object.fromEntries(Object.entries(WEAPONS).map(([id, weapon]) => [id, {
    magazine: weapon.magazine, reserve: weapon.reserve, reloadingUntil: 0, lastFiredAt: 0,
  }]));
}

function chooseSpawn(room, random) {
  const connected = [...room.players.values()].filter((p) => p.connected && !p.dead);
  const ranked = SAFE_SPAWNS.map((spawn) => ({ spawn,
    distance: connected.length ? Math.min(...connected.map((p) => distanceXZ(spawn, p))) : 1000 }));
  const best = Math.max(...ranked.map((item) => item.distance));
  const options = ranked.filter((item) => item.distance >= best - 0.01);
  return { ...options[Math.floor(random() * options.length)].spawn };
}

function chooseArrivalSpawn(room) {
  const occupied = [...room.players.values()];
  return { ...(ARRIVAL_SPAWNS.find((spawn) =>
    occupied.every((player) => distanceXZ(spawn, player) >= 2.5))
    || ARRIVAL_SPAWNS[0]) };
}

function createPlayer(room, name, now) {
  const spawn = chooseArrivalSpawn(room);
  return {
    id: randomUUID(), token: randomBytes(24).toString('base64url'), name: cleanPlayerName(name),
    x: spawn.x, y: playerEyeHeightAt(spawn.x, spawn.z), z: spawn.z,
    yaw: 0, pitch: 0, mode: 'walk', stance: 'stand', vehicleId: null,
    health: MAX_HEALTH, armor: 0, dead: false, deadAt: 0,
    spawnProtectedUntil: now + SPAWN_PROTECTION_MS,
    ammo: freshAmmo(), inventory: createInventory(), lastUseAt: -Infinity,
    connected: true, socketId: null, lastMoveAt: now, hasMoved: false,
    lastSafe: { ...spawn }, droneAnchor: null, recoverAt: 0, disconnectTimer: null,
    voiceRequested: false, voiceAttempts: [],
  };
}

function publicPlayer(player) {
  return {
    id: player.id, name: player.name, x: player.x, y: player.y, z: player.z,
    yaw: player.yaw, pitch: player.pitch, mode: player.mode,
    stance: player.stance, vehicleId: player.vehicleId,
    health: player.health, armor: player.armor, dead: player.dead,
    spawnProtectedUntil: player.spawnProtectedUntil,
    respawnAvailableAt: player.dead ? player.deadAt + RESPAWN_DELAY_MS : 0,
    connected: player.connected, ammo: publicAmmo(player.ammo),
    inventory: publicInventory(player.inventory),
  };
}

function publicWildlife(animal) {
  return { id: animal.id, health: animal.health, dead: animal.dead,
    respawnAt: animal.respawnAt };
}

function wildlifeWeather(room, now) {
  return wildlifeWeatherClock.sample(Math.max(0, (now - room.world.startedAt) / 1000),
    { weatherOverride: room.world.weather, timeOverride: room.world.time }).mode;
}

function wildlifeTargets(room, now) {
  return wildlifeTargetsAt(SERVER_WILDLIFE_HOMES,
    Math.max(0, (now - room.world.startedAt) / 1000), wildlifeWeather(room, now),
    { multiplayer: true, terrainHeight: islandTerrainHeightAt });
}

function roomSnapshot(room, now) {
  return {
    code: room.code, mode: room.mode, serverNow: now,
    voice: { available: room.voiceAvailable },
    world: { ...room.world },
    players: [...room.players.values()].map(publicPlayer),
    vehicles: [...room.vehicles.values()].map((vehicle) => ({ ...vehicle })),
    // Dense fauna stays client-side; send only damaged/dead state in snapshots.
    wildlife: [...room.wildlife.values()].filter((animal) =>
      animal.dead || animal.health < animal.maxHealth).map(publicWildlife),
    npcs: [...room.npcs.values()].map(publicNpc),
    pickups: [...room.pickups.values()].map(publicPickup),
    explosives: [...room.explosives.values()].map(publicExplosive),
  };
}

function newCode(rooms) {
  for (let tries = 0; tries < 30; tries++) {
    const bytes = randomBytes(6);
    const code = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
    if (!rooms.has(code)) return code;
  }
  throw new Error('Unable to reserve a unique room code');
}

function makeRoom(code, mode, now) {
  const seed = randomBytes(4).readUInt32BE(0);
  const pickups = createWorldPickupSpawns(seed).map((pickup) => ({
    ...pickup, y: islandTerrainHeightAt(pickup.x, pickup.z) + 0.25,
    initialCount: pickup.count,
  }));
  const residentSites = selectResidentSites(RESIDENT_SITES, {
    isSafe: (x, z, site) => islandCoastalRadiusAt(x, z) < 0.999
      && !isLake(x, z, site.bodyRadius || 0.8),
    isRoad,
  });
  const npcs = [
    ...residentSites.map((site) => createNpcCombatant(site, 'resident',
      islandTerrainHeightAt(site.x, site.z))),
    ...PRISON_OCCUPANTS.map((person) => createNpcCombatant(person, person.kind,
      islandTerrainHeightAt(person.x, person.z))),
  ];
  return {
    code, mode, voiceRoomId: `iw-${randomUUID()}`, voiceAvailable: false,
    players: new Map(), pickups: new Map(pickups.map((item) => [item.id, item])),
    pickupRespawns: new Map(), explosives: new Map(),
    vehicles: new Map(PRISON_LAYOUT.vehicles.map((vehicle) => [vehicle.id,
      { id: vehicle.id, x: vehicle.x, z: vehicle.z, heading: vehicle.heading,
        speed: 0, ownerId: null, updatedAt: now }])),
    wildlife: new Map(wildlifeTargetsAt(SERVER_WILDLIFE_HOMES, 0, 'mist',
      { multiplayer: true }).map((animal) => [animal.id, {
      id: animal.id, health: animal.maxHealth, maxHealth: animal.maxHealth,
      dead: false, respawnAt: 0,
    }])),
    npcs: new Map(npcs.map((npc) => [npc.id, npc])),
    world: { seed, startedAt: now, weather: 'auto',
      time: 'auto', version: 1 },
  };
}

function finishReload(player, now) {
  for (const [id, state] of Object.entries(player.ammo)) {
    if (!state.reloadingUntil || state.reloadingUntil > now) continue;
    const count = Math.min(WEAPONS[id].magazine - state.magazine, state.reserve);
    state.magazine += count;
    state.reserve -= count;
    state.reloadingUntil = 0;
  }
}

/** Socket.IO room backend. The only authoritative damage, ammo and health state lives here. */
export function createMultiplayerServer({
  host = '127.0.0.1', port = 3001, allowedOrigins = [],
  clock = () => Date.now(), random = Math.random, snapshotMs = ROOM_TICK_MS,
  reconnectGraceMs = RECONNECT_GRACE_MS,
  voiceService = createVoiceService(),
} = {}) {
  const httpServer = createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ ok: true, rooms: rooms.size,
        voice: { available: Boolean(voiceService.available) } }));
      return;
    }
    response.writeHead(404); response.end();
  });
  const configuredOrigins = Array.isArray(allowedOrigins) ? allowedOrigins : [];
  const io = new SocketIOServer(httpServer, {
    cors: { origin: (origin, callback) => callback(null, allowedOrigin(origin, configuredOrigins)) },
    allowRequest: (req, callback) => callback(null,
      allowedOrigin(req.headers.origin, configuredOrigins)),
    transports: ['websocket', 'polling'], maxHttpBufferSize: 16 * 1024,
    pingInterval: 10000, pingTimeout: 20000,
  });
  const rooms = new Map();
  const roomChannel = (code) => `island:${code}`;

  function removeVoice(room, player) {
    if (!player.voiceRequested) return;
    player.voiceRequested = false;
    // Call immediately to establish the service's serialization fence, then
    // catch background failure. Voice outages must never break game cleanup.
    try {
      Promise.resolve(voiceService.removeParticipant({ roomId: room.voiceRoomId,
        identity: player.id })).catch(() => {});
    } catch { /* best-effort cleanup; later credential issuance retries */ }
  }

  function deleteRoom(room) {
    rooms.delete(room.code);
    try { Promise.resolve(voiceService.deleteRoom(room.voiceRoomId)).catch(() => {}); }
    catch { /* gameplay removal succeeds even when the voice service is down */ }
  }

  function getSession(socket) {
    const { code, playerId } = socket.data;
    const room = rooms.get(code);
    const player = room?.players.get(playerId);
    return room && player?.connected && player.socketId === socket.id
      ? { room, player } : null;
  }

  function broadcast(room) {
    io.to(roomChannel(room.code)).emit('room:snapshot', roomSnapshot(room, clock()));
  }

  function roster(room) {
    io.to(roomChannel(room.code)).emit('room:roster', {
      code: room.code, mode: room.mode,
      players: [...room.players.values()].map(({ id, name, connected, dead }) =>
        ({ id, name, connected, dead })),
    });
    broadcast(room);
  }

  function emitPickup(room, action, pickup) {
    io.to(roomChannel(room.code)).emit('loot:state', {
      action, pickup: publicPickup(pickup), at: clock(),
    });
  }

  function dropInventory(room, player, now) {
    const drops = inventoryDrops(player.inventory,
      { x: player.x, z: player.z }, room.world.seed ^ now);
    for (const raw of drops) {
      if (room.pickups.size >= MAX_ROOM_PICKUPS) {
        const oldest = [...room.pickups.values()].filter((item) => item.source === 'player')
          .sort((a, b) => a.expiresAt - b.expiresAt)[0];
        if (!oldest) break;
        room.pickups.delete(oldest.id);
        emitPickup(room, 'remove', oldest);
      }
      const pickup = { ...raw, id: randomUUID(), source: 'player',
        y: islandTerrainHeightAt(raw.x, raw.z) + 0.25,
        expiresAt: now + PLAYER_PICKUP_TTL_MS };
      room.pickups.set(pickup.id, pickup);
      emitPickup(room, 'spawn', pickup);
    }
    player.inventory = createInventory({ guns: ['revolver'] });
  }

  function markPlayerDead(room, player, killerId, weapon, now) {
    player.dead = true;
    player.deadAt = now;
    player.armor = 0;
    releaseVehicle(room, player);
    dropInventory(room, player, now);
    io.to(roomChannel(room.code)).emit('combat:event', {
      kind: 'death', playerId: player.id, killerId, weapon,
      health: 0, armor: 0, at: now,
      respawnAvailableAt: now + RESPAWN_DELAY_MS,
    });
  }

  function blastVisible(origin, target) {
    return !shotBlockedByStructures(origin, target)
      && !shotBlockedByTerrain(origin, target);
  }

  function publishNpc(room, npc) {
    room.npcs.set(npc.id, npc);
    io.to(roomChannel(room.code)).emit('npc:state', publicNpc(npc));
  }

  function damageNpc(room, npc, amount, attackerId, weapon, now, distance = 0) {
    if (npc.dead) return null;
    const changed = applyNpcDamage(npc, amount, attackerId);
    publishNpc(room, changed);
    const position = { x: changed.x, y: changed.y + 1.05, z: changed.z };
    const hit = { kind: 'npc', id: changed.id, npcId: changed.id,
      damage: npc.health - changed.health, health: changed.health,
      dead: changed.dead, distance, position };
    io.to(roomChannel(room.code)).emit('combat:event', {
      ...hit, kind: 'npc_hit', shooterId: attackerId, weapon, at: now,
    });
    if (changed.dead) io.to(roomChannel(room.code)).emit('combat:event', {
      kind: 'npc_death', npcId: changed.id, killerId: attackerId,
      weapon, position, at: now,
    });
    return hit;
  }

  function alertNearShot(room, shooter, origin, direction, range) {
    for (const npc of room.npcs.values()) {
      if (npc.dead || npc.alerted || !npcThreatenedByShot(origin, direction, npc, range)) {
        continue;
      }
      const target = { x: npc.x, y: npc.y + 1.1, z: npc.z };
      if (blastVisible(origin, target)) publishNpc(room, alertNpc(npc, shooter.id));
    }
  }

  function detonate(room, explosive, now) {
    if (!room.explosives.delete(explosive.id)) return;
    io.to(roomChannel(room.code)).emit('explosive:state', {
      action: 'remove', explosive: publicExplosive(explosive), at: now,
    });
    const config = EXPLOSIVES[explosive.kind];
    const origin = { x: explosive.x, y: explosive.y + 1, z: explosive.z };
    const hits = [];
    if (room.mode === 'pvp') {
      for (const target of room.players.values()) {
        if (target.dead || !target.connected || target.mode === 'drone'
          || target.spawnProtectedUntil > now) continue;
        const impact = { x: target.x, y: target.y - 0.8, z: target.z };
        const distance = Math.hypot(impact.x - origin.x, impact.y - origin.y,
          impact.z - origin.z);
        const damage = blastDamageAt(distance, config);
        if (!damage || !blastVisible(origin, impact)) continue;
        const hit = { kind: 'player', targetId: target.id,
          ...damagePlayer(target, damage), distance };
        hits.push(hit);
        io.to(roomChannel(room.code)).emit('combat:event', {
          ...hit, kind: 'hit', targetKind: 'player', shooterId: explosive.ownerId,
          weapon: explosive.kind, at: now,
        });
        if (hit.dead) markPlayerDead(room, target, explosive.ownerId, explosive.kind, now);
      }
    }
    for (const target of wildlifeTargets(room, now)) {
      const animal = room.wildlife.get(target.id);
      if (!target.active || !animal || animal.dead) continue;
      const impact = { x: target.x, y: target.y, z: target.z };
      const distance = Math.hypot(impact.x - origin.x, impact.y - origin.y,
        impact.z - origin.z);
      const damage = blastDamageAt(distance, config);
      if (!damage || !blastVisible(origin, impact)) continue;
      animal.health = Math.max(0, animal.health - damage);
      animal.dead = animal.health === 0;
      animal.respawnAt = animal.dead
        ? now + WILDLIFE_KINDS[target.kind].respawnMs : 0;
      const hit = { kind: 'wildlife', id: animal.id, damage,
        health: animal.health, dead: animal.dead, distance };
      hits.push(hit);
      io.to(roomChannel(room.code)).emit('wildlife:state', publicWildlife(animal));
    }
    for (const npc of room.npcs.values()) {
      if (npc.dead) continue;
      const impact = { x: npc.x, y: npc.y + 1.05, z: npc.z };
      const distance = Math.hypot(impact.x - origin.x, impact.y - origin.y,
        impact.z - origin.z);
      const damage = blastDamageAt(distance, config);
      if (!damage || !blastVisible(origin, impact)) continue;
      const hit = damageNpc(room, npc, damage, explosive.ownerId,
        explosive.kind, now, distance);
      if (hit) hits.push(hit);
    }
    io.to(roomChannel(room.code)).emit('combat:event', {
      kind: 'explosion', id: explosive.id, itemKind: explosive.kind,
      ownerId: explosive.ownerId, origin, position: { x: explosive.x,
        y: explosive.y, z: explosive.z }, radius: config.radius, hits, at: now,
    });
    broadcast(room);
  }

  function mineTriggered(room, explosive, now, animals) {
    const origin = { x: explosive.x, y: explosive.y + 0.7, z: explosive.z };
    const near = (target, y) => Math.hypot(target.x - explosive.x,
      target.z - explosive.z, y - origin.y) <= EXPLOSIVES.mine.triggerRadius
      && blastVisible(origin, { x: target.x, y, z: target.z });
    if (room.mode === 'pvp' && [...room.players.values()].some((target) =>
      target.id !== explosive.ownerId && target.connected && !target.dead
      && target.mode !== 'drone' && target.spawnProtectedUntil <= now
      && near(target, target.y - 0.8))) {
      return true;
    }
    if ([...room.npcs.values()].some((npc) => !npc.dead
      && near(npc, npc.y + 1.05))) return true;
    return animals.some((target) => target.active && !room.wildlife.get(target.id)?.dead
      && near(target, target.y));
  }

  function releaseVehicle(room, player) {
    if (!player.vehicleId) return;
    const vehicle = room.vehicles.get(player.vehicleId);
    if (vehicle?.ownerId === player.id) { vehicle.ownerId = null; vehicle.speed = 0; }
    player.vehicleId = null;
    if (player.mode === 'drive') player.mode = 'walk';
  }

  function detach(socket, { explicit = false } = {}) {
    const session = getSession(socket);
    if (!session) return;
    const { room, player } = session;
    socket.data.voiceRevision = (socket.data.voiceRevision || 0) + 1;
    removeVoice(room, player);
    socket.leave(roomChannel(room.code));
    socket.data.code = null;
    socket.data.playerId = null;
    releaseVehicle(room, player);
    player.socketId = null;
    player.connected = false;
    if (explicit) {
      if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
      room.players.delete(player.id);
      if (!room.players.size) deleteRoom(room);
    } else {
      player.disconnectTimer = setTimeout(() => {
        if (player.connected) return;
        room.players.delete(player.id);
        if (!room.players.size) deleteRoom(room);
        else roster(room);
      }, reconnectGraceMs);
      player.disconnectTimer.unref?.();
    }
    if (room.players.size) roster(room);
  }

  function bind(socket, room, player) {
    socket.data.voiceRevision = (socket.data.voiceRevision || 0) + 1;
    player.connected = true;
    player.socketId = socket.id;
    if (player.disconnectTimer) { clearTimeout(player.disconnectTimer); player.disconnectTimer = null; }
    socket.data.code = room.code;
    socket.data.playerId = player.id;
    socket.join(roomChannel(room.code));
    roster(room);
    return success({ code: room.code, token: player.token, selfId: player.id,
      room: roomSnapshot(room, clock()) });
  }

  function safeAck(callback, result) { if (typeof callback === 'function') callback(result); }

  io.on('connection', (socket) => {
    let joinAttempts = 0;
    let joinWindowAt = clock();
    const joinAllowed = () => {
      if (clock() - joinWindowAt > 60000) { joinWindowAt = clock(); joinAttempts = 0; }
      return ++joinAttempts <= 15;
    };

    socket.on('room:create', (data, ack) => {
      if (getSession(socket)) return safeAck(ack, failure('already_in_room'));
      if (!joinAllowed()) return safeAck(ack, failure('rate_limited'));
      const mode = data?.mode;
      if (!MODES.has(mode)) return safeAck(ack, failure('invalid_mode'));
      const code = newCode(rooms);
      const room = makeRoom(code, mode, clock());
      room.voiceAvailable = Boolean(voiceService.available);
      rooms.set(code, room);
      const player = createPlayer(room, data?.name, clock());
      room.players.set(player.id, player);
      safeAck(ack, bind(socket, room, player));
    });

    socket.on('room:join', (data, ack) => {
      if (getSession(socket)) return safeAck(ack, failure('already_in_room'));
      if (!joinAllowed()) return safeAck(ack, failure('rate_limited'));
      const code = typeof data?.code === 'string' ? data.code.trim().toUpperCase() : '';
      const room = rooms.get(code);
      if (!room) return safeAck(ack, failure('room_not_found', 'Room not found. Check the code.'));
      if (room.players.size >= MAX_ROOM_PLAYERS) {
        return safeAck(ack, failure('room_full', 'This room already has 10 players.'));
      }
      const player = createPlayer(room, data?.name, clock());
      room.players.set(player.id, player);
      safeAck(ack, bind(socket, room, player));
    });

    socket.on('room:resume', (data, ack) => {
      if (getSession(socket)) return safeAck(ack, failure('already_in_room'));
      if (!joinAllowed()) return safeAck(ack, failure('rate_limited'));
      const code = typeof data?.code === 'string' ? data.code.trim().toUpperCase() : '';
      const room = rooms.get(code);
      const player = [...(room?.players.values() || [])].find((p) =>
        typeof data?.token === 'string' && p.token === data.token);
      if (!player) return safeAck(ack, failure('resume_expired', 'Session expired. Join again.'));
      if (player.connected && player.socketId !== socket.id) {
        const previous = io.sockets.sockets.get(player.socketId);
        removeVoice(room, player);
        previous?.emit('room:replaced');
        previous?.leave(roomChannel(room.code));
        if (previous) {
          previous.data.voiceRevision = (previous.data.voiceRevision || 0) + 1;
          previous.data.code = null; previous.data.playerId = null;
        }
      }
      safeAck(ack, bind(socket, room, player));
    });

    socket.on('room:leave', (_data, ack) => {
      if (!getSession(socket)) return safeAck(ack, failure('not_in_room'));
      detach(socket, { explicit: true });
      safeAck(ack, success());
    });

    socket.on('voice:join', async (_data, ack) => {
      const session = getSession(socket);
      if (!session) return safeAck(ack, failure('not_in_room'));
      if (!voiceService.available) return safeAck(ack,
        failure('voice_unavailable', 'Voice chat is not configured on this room server.'));
      const { room, player } = session;
      const now = clock();
      player.voiceAttempts = player.voiceAttempts.filter((at) => now - at < VOICE_CREDENTIAL_WINDOW_MS);
      if (socket.data.voicePending || player.voiceAttempts.length >= VOICE_CREDENTIAL_LIMIT) {
        return safeAck(ack, failure('voice_rate_limited', 'Please wait before reconnecting voice.'));
      }
      player.voiceAttempts.push(now);
      player.voiceRequested = true;
      socket.data.voicePending = true;
      const revision = socket.data.voiceRevision;
      try {
        const credentials = await voiceService.issue({ roomId: room.voiceRoomId,
          identity: player.id, name: player.name });
        const current = getSession(socket);
        if (current?.room !== room || current.player !== player
          || socket.data.voiceRevision !== revision) {
          return safeAck(ack, failure('session_changed'));
        }
        // Never include API credentials or trust client-selected room/identity.
        safeAck(ack, success({ url: credentials.url, token: credentials.token,
          identity: player.id, roomId: room.voiceRoomId,
          expiresIn: credentials.expiresIn }));
      } catch {
        safeAck(ack, failure('voice_unavailable', 'Voice chat could not connect. Please try again.'));
      } finally { socket.data.voicePending = false; }
    });

    socket.on('voice:leave', (_data, ack) => {
      const session = getSession(socket);
      if (!session) return safeAck(ack, failure('not_in_room'));
      socket.data.voiceRevision = (socket.data.voiceRevision || 0) + 1;
      removeVoice(session.room, session.player);
      safeAck(ack, success());
    });

    socket.on('player:move', (data) => {
      const session = getSession(socket);
      if (!session || !data || !validWorldPosition(data) || session.player.dead) return;
      const { room, player } = session;
      if (!MOVE_MODES.has(data.mode) || !isFiniteNumber(data.yaw)
        || !isFiniteNumber(data.pitch) || Math.abs(data.pitch) > 1.55
        || Math.abs(data.yaw) > 1e5) return;
      const stance = data.mode === 'walk' ? data.stance ?? 'stand' : 'stand';
      if (!validPlayerStance(stance)) return;
      // Walking eye height comes from the same terrain, cliff-grid blend and
      // pier deck as the client. A client cannot move its hitbox above the
      // visible avatar by sending an arbitrary Y coordinate.
      if (data.mode === 'walk'
        && Math.abs(data.y - stanceEyeHeight(playerEyeHeightAt(data.x, data.z),
          stance)) > WALK_EYE_TOLERANCE) return;
      if (data.mode === 'drive') {
        if (!player.vehicleId || room.vehicles.get(player.vehicleId)?.ownerId !== player.id) return;
        // Car position is validated separately via vehicle:state.
        player.yaw = data.yaw;
        player.pitch = data.pitch;
        return;
      }
      if (player.vehicleId) return; // Leaving a car requires a validated vehicle:exit.
      if (data.mode === 'drone') {
        if (!player.droneAnchor) player.droneAnchor = { x: player.x, y: player.y, z: player.z };
      } else if (player.droneAnchor) {
        // Exiting drone mode must return to its original ground position.
        if (distanceXZ(data, player.droneAnchor) > 5) return;
        player.x = player.droneAnchor.x;
        player.y = player.droneAnchor.y;
        player.z = player.droneAnchor.z;
        player.droneAnchor = null;
        player.lastMoveAt = clock();
      }
      const now = clock();
      const elapsed = Math.min(Math.max((now - player.lastMoveAt) / 1000, 0.03), 2);
      const maxSpeed = data.mode === 'drone' ? 42
        : playerStance(stance).serverMaxSpeed;
      const slack = data.mode === 'drone' || stance === 'stand' ? 1.5
        : stance === 'crouch' ? 0.75 : 0.45;
      const maxDistance = player.hasMoved ? maxSpeed * elapsed + slack : 8;
      if (distanceXZ(data, player) > maxDistance) return;
      if (player.hasMoved && data.mode !== 'drone'
        && Math.abs(data.y - player.y) > Math.max(5, 10 * elapsed)) return;
      player.x = data.x; player.y = data.y; player.z = data.z;
      player.yaw = data.yaw; player.pitch = data.pitch; player.mode = data.mode;
      player.stance = stance;
      player.lastMoveAt = now; player.hasMoved = true;
      if (data.mode === 'walk'
        && islandCoastalRadiusAt(data.x, data.z) <= CLIFF_FALL.safeRadius) {
        player.lastSafe = { x: data.x, y: data.y, z: data.z };
      }
    });

    socket.on('player:recover', (data, ack) => {
      const session = getSession(socket);
      if (!session || session.player.dead) return safeAck(ack, failure('not_available'));
      const { player } = session;
      const now = clock();
      if (!validWorldPosition(data) || player.mode === 'drive' || player.mode === 'drone'
        || !player.lastSafe || distanceXZ(data, player.lastSafe) > 7
        || Math.abs(data.y - playerEyeHeightAt(data.x, data.z)) > WALK_EYE_TOLERANCE
        || islandCoastalRadiusAt(player.x, player.z) < CLIFF_FALL.safeRadius - 0.015
        || islandTerrainHeightAt(player.x, player.z) < CLIFF_FALL.minimumCliffHeight
        || (player.recoverAt && now - player.recoverAt < RECOVERY_MIN_INTERVAL_MS)) {
        return safeAck(ack, failure('invalid_recovery'));
      }
      player.x = data.x; player.y = data.y; player.z = data.z;
      player.stance = 'stand';
      player.lastMoveAt = now; player.recoverAt = now;
      safeAck(ack, success({ spawn: { x: player.x, y: player.y, z: player.z },
        spawnProtectedUntil: player.spawnProtectedUntil }));
    });

    socket.on('vehicle:enter', (data, ack) => {
      const session = getSession(socket);
      if (!session || session.player.dead) return safeAck(ack, failure('not_available'));
      const { room, player } = session;
      const vehicle = room.vehicles.get(data?.id);
      if (!vehicle || vehicle.ownerId || player.vehicleId || player.mode === 'drone'
        || distanceXZ(vehicle, player) > 6) return safeAck(ack, failure('vehicle_unavailable'));
      vehicle.ownerId = player.id; vehicle.updatedAt = clock();
      player.vehicleId = vehicle.id; player.mode = 'drive'; player.stance = 'stand';
      player.x = vehicle.x; player.z = vehicle.z;
      broadcast(room);
      safeAck(ack, success({ vehicle: { ...vehicle } }));
    });

    socket.on('vehicle:state', (data, ack) => {
      const session = getSession(socket);
      if (!session || session.player.dead) return safeAck(ack, failure('not_available'));
      const { room, player } = session;
      const vehicle = room.vehicles.get(data?.id);
      if (!vehicle || vehicle.ownerId !== player.id
        || !isFiniteNumber(data.x) || !isFiniteNumber(data.z)
        || !isFiniteNumber(data.heading) || !isFiniteNumber(data.speed)
        || Math.abs(data.x) > 350 || Math.abs(data.z) > 350
        || Math.abs(data.speed) > 17 || Math.abs(data.heading) > 1e5) {
        return safeAck(ack, failure('invalid_vehicle_state'));
      }
      const now = clock();
      const elapsed = Math.min(Math.max((now - vehicle.updatedAt) / 1000, 0.03), 2);
      if (distanceXZ(data, vehicle) > elapsed * 18 + 0.8) {
        return safeAck(ack, failure('vehicle_speed_limited'));
      }
      if (Math.abs(Math.atan2(Math.sin(data.heading - vehicle.heading),
        Math.cos(data.heading - vehicle.heading))) > elapsed * 2.4 + 0.25) {
        return safeAck(ack, failure('vehicle_turn_limited'));
      }
      vehicle.x = data.x; vehicle.z = data.z; vehicle.heading = data.heading;
      vehicle.speed = data.speed; vehicle.updatedAt = now;
      player.x = vehicle.x; player.z = vehicle.z; player.yaw = data.heading;
      player.lastMoveAt = now;
      safeAck(ack, success({ vehicle: { ...vehicle } }));
    });

    socket.on('vehicle:exit', (data, ack) => {
      const session = getSession(socket);
      if (!session) return safeAck(ack, failure('not_in_room'));
      const { room, player } = session;
      if (!player.vehicleId || player.vehicleId !== data?.id) {
        return safeAck(ack, failure('not_driving'));
      }
      const vehicle = room.vehicles.get(player.vehicleId);
      // The owner's final state packet can be lost. Releasing on an explicit
      // exit prevents the room from keeping a ghost driver indefinitely.
      releaseVehicle(room, player);
      player.stance = 'stand';
      player.lastMoveAt = clock(); player.hasMoved = false;
      broadcast(room);
      safeAck(ack, success());
    });

    socket.on('world:set', (data, ack) => {
      const session = getSession(socket);
      if (!session) return safeAck(ack, failure('not_in_room'));
      if (!VALID_WEATHER.includes(data?.weather) || !VALID_TIME.includes(data?.time)) {
        return safeAck(ack, failure('invalid_world_setting'));
      }
      const { room } = session;
      room.world.weather = data.weather;
      room.world.time = data.time;
      room.world.version++;
      io.to(roomChannel(room.code)).emit('world:state', { ...room.world, serverNow: clock() });
      safeAck(ack, success({ world: { ...room.world } }));
    });

    socket.on('inventory:select', (data, ack) => {
      const session = getSession(socket);
      if (!session || session.player.dead) return safeAck(ack, failure('not_available'));
      const { room, player } = session;
      if (typeof data?.weapon !== 'string' || !player.inventory.guns.includes(data.weapon)) {
        return safeAck(ack, failure('gun_not_owned'));
      }
      player.inventory = selectGun(player.inventory, data.weapon);
      broadcast(room);
      safeAck(ack, success({ inventory: publicInventory(player.inventory) }));
    });

    socket.on('inventory:cycle', (data, ack) => {
      const session = getSession(socket);
      if (!session || session.player.dead) return safeAck(ack, failure('not_available'));
      if (data?.direction !== 1 && data?.direction !== -1) {
        return safeAck(ack, failure('invalid_direction'));
      }
      const { room, player } = session;
      player.inventory = cycleGun(player.inventory, data.direction);
      broadcast(room);
      safeAck(ack, success({ inventory: publicInventory(player.inventory) }));
    });

    socket.on('loot:pickup', (data, ack) => {
      const session = getSession(socket);
      if (!session || session.player.dead) return safeAck(ack, failure('not_available'));
      const { room, player } = session;
      if (player.mode !== 'walk') return safeAck(ack, failure('not_on_foot'));
      const pickup = typeof data?.id === 'string' ? room.pickups.get(data.id) : null;
      if (!pickup) return safeAck(ack, failure('pickup_unavailable'));
      if (Math.hypot(pickup.x - player.x, pickup.y - (player.y - 1),
        pickup.z - player.z) > PICKUP_REACH
        || !blastVisible({ x: player.x, y: player.y - 0.5, z: player.z },
          { x: pickup.x, y: pickup.y + 0.5, z: pickup.z })) {
        return safeAck(ack, failure('pickup_out_of_reach'));
      }
      let count = 0;
      if (pickup.kind === 'medkit' || pickup.kind === 'ammo'
        || pickup.kind === 'armor') {
        let state = { inventory: player.inventory, health: player.health,
          armor: player.armor, ammo: player.ammo };
        while (count < pickup.count && canApplySupply(state, pickup.itemId)) {
          const applied = applySupply(state, pickup.itemId);
          if (!applied.applied) break;
          state = { ...state, health: applied.health, armor: applied.armor,
            ammo: applied.ammo };
          count++;
        }
        if (!count) return safeAck(ack, failure(pickup.kind === 'medkit'
          ? 'health_full' : pickup.kind === 'armor' ? 'armor_full' : 'ammo_full'));
        player.health = state.health;
        player.armor = state.armor;
        player.ammo = state.ammo;
      } else {
        if (!canCollectItem(player.inventory, pickup.itemId)) {
          return safeAck(ack, failure('inventory_full'));
        }
        const previous = player.inventory;
        const updated = collectItem(previous, pickup.itemId, pickup.count);
        count = pickup.kind === 'gun' ? 1
          : updated[pickup.itemId === 'grenade' ? 'grenades' : 'mines']
            - previous[pickup.itemId === 'grenade' ? 'grenades' : 'mines'];
        if (!count) return safeAck(ack, failure('inventory_full'));
        player.inventory = updated;
      }
      pickup.count -= count;
      if (pickup.count) {
        emitPickup(room, 'update', pickup);
      } else {
        room.pickups.delete(pickup.id);
        emitPickup(room, 'remove', pickup);
        if (pickup.source === 'world') room.pickupRespawns.set(pickup.id, {
          pickup: { ...pickup, count: pickup.initialCount ?? count },
          at: clock() + WORLD_PICKUP_RESPAWN_MS,
        });
      }
      broadcast(room);
      safeAck(ack, success({ pickupId: pickup.id, count,
        inventory: publicInventory(player.inventory), health: player.health,
        armor: player.armor,
        ammo: publicAmmo(player.ammo) }));
    });

    socket.on('combat:use', (data, ack) => {
      const session = getSession(socket);
      if (!session || session.player.dead) return safeAck(ack, failure('not_available'));
      const { room, player } = session;
      if (player.mode !== 'walk') return safeAck(ack, failure('not_on_foot'));
      const kind = data?.kind;
      if (kind !== 'grenade' && kind !== 'mine') {
        return safeAck(ack, failure('invalid_item'));
      }
      const config = EXPLOSIVES[kind];
      const target = data?.target;
      if (!isFiniteNumber(target?.x) || !isFiniteNumber(target?.z)
        || Math.abs(target.x) > 380 || Math.abs(target.z) > 380) {
        return safeAck(ack, failure('invalid_target'));
      }
      const maxRange = kind === 'grenade' ? config.maxRange : config.maxPlacement;
      const distance = distanceXZ(target, player);
      if (distance > maxRange || distance < 0.3) {
        return safeAck(ack, failure('invalid_target'));
      }
      const ground = islandTerrainHeightAt(target.x, target.z);
      const position = { x: target.x, y: ground + 0.25, z: target.z };
      if (!validWorldPosition(position)) return safeAck(ack, failure('invalid_target'));
      if (kind === 'mine' && (isLake(target.x, target.z)
        || islandCoastalRadiusAt(target.x, target.z) >= 0.955)) {
        return safeAck(ack, failure('unsafe_ground'));
      }
      // The requested landing point must agree with the server pose. A client
      // cannot throw behind itself, through solid cover, or from a drone/car.
      const vx = position.x - player.x;
      const vy = position.y + 0.6 - player.y;
      const vz = position.z - player.z;
      const length = Math.hypot(vx, vy, vz);
      const expected = { x: -Math.sin(player.yaw) * Math.cos(player.pitch),
        y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * Math.cos(player.pitch) };
      if ((vx * expected.x + vy * expected.y + vz * expected.z) / length < 0.25) {
        return safeAck(ack, failure('invalid_facing'));
      }
      const origin = { x: player.x, y: player.y, z: player.z };
      if (!blastVisible(origin, { x: position.x, y: position.y + 0.6,
        z: position.z })) return safeAck(ack, failure('blocked_throw'));
      const now = clock();
      if (now - player.lastUseAt < USE_INTERVAL_MS) {
        return safeAck(ack, failure('use_rate_limited'));
      }
      if (room.explosives.size >= MAX_ROOM_EXPLOSIVES
        || [...room.explosives.values()].filter((item) => item.ownerId === player.id).length
          >= MAX_PLAYER_EXPLOSIVES) return safeAck(ack, failure('explosive_limit'));
      const inventory = consumeItem(player.inventory, kind);
      if (inventory === player.inventory) return safeAck(ack, failure('item_unavailable'));
      player.inventory = inventory;
      player.lastUseAt = now;
      player.spawnProtectedUntil = Math.min(player.spawnProtectedUntil, now);
      const explosive = { id: randomUUID(), kind, ownerId: player.id,
        ...position, createdAt: now, radius: config.radius,
        ...(kind === 'grenade' ? { detonatesAt: now + config.fuseMs }
          : { armedAt: now + config.armMs, expiresAt: now + config.ttlMs }) };
      room.explosives.set(explosive.id, explosive);
      const visible = publicExplosive(explosive);
      io.to(roomChannel(room.code)).emit('explosive:state', {
        action: 'spawn', explosive: visible, at: now,
      });
      io.to(roomChannel(room.code)).emit('combat:event', {
        kind: kind === 'grenade' ? 'throw' : 'place', id: explosive.id,
        itemKind: kind, playerId: player.id, origin, position,
        radius: config.radius, at: now,
        ...(explosive.detonatesAt ? { detonatesAt: explosive.detonatesAt } : {}),
      });
      broadcast(room);
      safeAck(ack, success({ inventory: publicInventory(player.inventory),
        explosive: visible }));
    });

    socket.on('combat:reload', (data, ack) => {
      const session = getSession(socket);
      if (!session || session.player.dead) return safeAck(ack, failure('not_available'));
      const { room, player } = session;
      const weapon = WEAPONS[data?.weapon];
      if (!weapon) return safeAck(ack, failure('invalid_weapon'));
      if (!player.inventory.guns.includes(data.weapon)) {
        return safeAck(ack, failure('gun_not_owned'));
      }
      const now = clock(); finishReload(player, now);
      const ammo = player.ammo[data.weapon];
      if (ammo.reloadingUntil > now || ammo.magazine === weapon.magazine || !ammo.reserve) {
        return safeAck(ack, failure('reload_unavailable'));
      }
      ammo.reloadingUntil = now + weapon.reloadMs;
      io.to(roomChannel(room.code)).emit('combat:event', {
        kind: 'reload', playerId: player.id, weapon: data.weapon, at: now,
        finishesAt: ammo.reloadingUntil,
      });
      safeAck(ack, success({ ammo: publicAmmo(player.ammo)[data.weapon] }));
    });

    socket.on('combat:fire', (data, ack) => {
      const session = getSession(socket);
      if (!session || session.player.dead) return safeAck(ack, failure('not_available'));
      const { room, player } = session;
      if (player.mode !== 'walk') return safeAck(ack, failure('not_on_foot'));
      const weapon = WEAPONS[data?.weapon];
      if (weapon && !player.inventory.guns.includes(data.weapon)) {
        return safeAck(ack, failure('gun_not_owned'));
      }
      const direction = normalizedDirection(data?.direction);
      if (!weapon || !direction || !validWorldPosition(data?.origin)
        || Math.hypot(data.origin.x - player.x, data.origin.y - player.y,
          data.origin.z - player.z) > MAX_SHOT_ORIGIN_ERROR) {
        return safeAck(ack, failure('invalid_shot'));
      }
      const expected = { x: -Math.sin(player.yaw) * Math.cos(player.pitch),
        y: Math.sin(player.pitch), z: -Math.cos(player.yaw) * Math.cos(player.pitch) };
      const alignment = expected.x * direction.x + expected.y * direction.y
        + expected.z * direction.z;
      if (alignment < 0.5) return safeAck(ack, failure('invalid_facing'));
      const now = clock(); finishReload(player, now);
      const ammo = player.ammo[data.weapon];
      if (ammo.reloadingUntil > now) return safeAck(ack, failure('reloading'));
      if (!ammo.magazine) return safeAck(ack, failure('empty_magazine'));
      if (now - ammo.lastFiredAt < weapon.fireIntervalMs) {
        return safeAck(ack, failure('fire_rate_limited'));
      }
      ammo.lastFiredAt = now; ammo.magazine--;
      // Spawn protection ends when a protected player chooses to attack.
      player.spawnProtectedUntil = Math.min(player.spawnProtectedUntil, now);
      let nearest = null;
      if (room.mode === 'pvp') {
        for (const target of room.players.values()) {
          if (target.id === player.id || target.dead || !target.connected
            || target.spawnProtectedUntil > now || target.mode === 'drone') continue;
          const distance = rayPlayerHit(data.origin, direction, target, weapon.range);
          const impact = distance === null ? null : {
            x: data.origin.x + direction.x * distance,
            y: data.origin.y + direction.y * distance,
            z: data.origin.z + direction.z * distance,
          };
          const targetPose = playerStance(target.stance);
          const targetCenterY = target.y - targetPose.eyeHeight
            + targetPose.hitHeight * 0.5;
          if (distance !== null && !shotBlockedByStructures(data.origin,
            { x: target.x, y: targetCenterY, z: target.z })
            && !shotBlockedByTerrain(data.origin, impact)
            && (!nearest || distance < nearest.distance)) {
            nearest = { kind: 'player', target, distance };
          }
        }
      }
      for (const target of wildlifeTargets(room, now)) {
        const animal = room.wildlife.get(target.id);
        if (!target.active || !animal || animal.dead) continue;
        const distance = rayWildlifeHit(data.origin, direction, target, weapon.range);
        if (distance === null || nearest && distance >= nearest.distance) continue;
        const impact = { x: data.origin.x + direction.x * distance,
          y: data.origin.y + direction.y * distance,
          z: data.origin.z + direction.z * distance };
        if (!shotBlockedByStructures(data.origin, impact)
          && !shotBlockedByTerrain(data.origin, impact)) {
          nearest = { kind: 'wildlife', target, animal, distance };
        }
      }
      for (const npc of room.npcs.values()) {
        if (npc.dead) continue;
        const distance = rayNpcHit(data.origin, direction, npc, weapon.range);
        if (distance === null || nearest && distance >= nearest.distance) continue;
        const impact = { x: data.origin.x + direction.x * distance,
          y: data.origin.y + direction.y * distance,
          z: data.origin.z + direction.z * distance };
        if (blastVisible(data.origin, impact)) {
          nearest = { kind: 'npc', npc, distance };
        }
      }
      let hit = null;
      if (nearest?.kind === 'player') {
        const target = nearest.target;
        hit = { kind: 'player', targetId: target.id, distance: nearest.distance,
          ...damagePlayer(target, weapon.damage) };
        if (hit.dead) markPlayerDead(room, target, player.id, data.weapon, now);
      } else if (nearest?.kind === 'wildlife') {
        const animal = nearest.animal;
        animal.health = Math.max(0, animal.health - weapon.damage);
        animal.dead = animal.health === 0;
        animal.respawnAt = animal.dead
          ? now + WILDLIFE_KINDS[nearest.target.kind].respawnMs : 0;
        hit = { kind: 'wildlife', id: animal.id, distance: nearest.distance,
          health: animal.health, dead: animal.dead, damage: weapon.damage };
        io.to(roomChannel(room.code)).emit('wildlife:state', publicWildlife(animal));
      } else if (nearest?.kind === 'npc') {
        hit = damageNpc(room, nearest.npc, weapon.damage, player.id,
          data.weapon, now, nearest.distance);
      }
      alertNearShot(room, player, data.origin, direction,
        nearest?.distance ?? weapon.range);
      io.to(roomChannel(room.code)).emit('combat:event', {
        kind: 'shot', shooterId: player.id, weapon: data.weapon,
        origin: { ...data.origin }, direction, hit, at: now,
      });
      if (hit?.kind === 'player') io.to(roomChannel(room.code)).emit('combat:event', {
        ...hit, kind: 'hit', targetKind: 'player', shooterId: player.id, at: now,
      });
      safeAck(ack, success({ ammo: publicAmmo(player.ammo)[data.weapon], hit }));
      if (hit) broadcast(room);
    });

    socket.on('player:respawn', (_data, ack) => {
      const session = getSession(socket);
      if (!session) return safeAck(ack, failure('not_in_room'));
      const { room, player } = session;
      const now = clock();
      if (!player.dead || now - player.deadAt < RESPAWN_DELAY_MS) {
        return safeAck(ack, failure('respawn_unavailable'));
      }
      const spawn = chooseSpawn(room, random);
      Object.assign(player, { x: spawn.x, z: spawn.z,
        y: playerEyeHeightAt(spawn.x, spawn.z), mode: 'walk', stance: 'stand',
        vehicleId: null, health: MAX_HEALTH, armor: 0, dead: false, deadAt: 0,
        spawnProtectedUntil: now + SPAWN_PROTECTION_MS, ammo: freshAmmo(),
        inventory: createInventory({ guns: ['revolver'] }), lastUseAt: -Infinity,
        lastMoveAt: now, hasMoved: false, lastSafe: { ...spawn }, droneAnchor: null });
      io.to(roomChannel(room.code)).emit('combat:event', {
        kind: 'respawn', playerId: player.id, spawn, at: now,
        spawnProtectedUntil: player.spawnProtectedUntil,
      });
      broadcast(room);
      safeAck(ack, success({ spawn, health: player.health, armor: player.armor,
        spawnProtectedUntil: player.spawnProtectedUntil, ammo: publicAmmo(player.ammo),
        inventory: publicInventory(player.inventory) }));
    });

    socket.on('disconnect', () => detach(socket));
  });

  const tick = setInterval(() => {
    const now = clock();
    for (const room of rooms.values()) {
      for (const player of room.players.values()) finishReload(player, now);
      for (const animal of room.wildlife.values()) {
        if (!animal.dead || animal.respawnAt > now) continue;
        const kind = animal.id.split('-')[0];
        animal.health = WILDLIFE_KINDS[kind].maxHealth;
        animal.dead = false;
        animal.respawnAt = 0;
        io.to(roomChannel(room.code)).emit('wildlife:state', publicWildlife(animal));
      }
      for (const [id, pending] of room.pickupRespawns) {
        if (pending.at > now || room.pickups.size >= MAX_ROOM_PICKUPS) continue;
        room.pickupRespawns.delete(id);
        room.pickups.set(id, pending.pickup);
        emitPickup(room, 'spawn', pending.pickup);
      }
      for (const [id, pickup] of room.pickups) {
        if (pickup.source !== 'player' || pickup.expiresAt > now) continue;
        room.pickups.delete(id);
        emitPickup(room, 'remove', pickup);
      }
      for (const npc of room.npcs.values()) {
        const attack = npcAttackDecision(npc, room.players.values(), now, blastVisible);
        if (!attack) continue;
        const target = room.players.get(attack.targetId);
        if (!target || target.dead) continue;
        npc.lastAttackAt = now;
        npc.targetId = target.id;
        const impact = damagePlayer(target, attack.damage);
        io.to(roomChannel(room.code)).emit('combat:event', {
          kind: 'npc_attack', npcId: npc.id, targetId: target.id,
          attackKind: attack.attackKind, weapon: attack.weapon,
          origin: attack.origin,
          target: attack.target, ...impact, at: now,
        });
        if (impact.dead) markPlayerDead(room, target, npc.id,
          attack.attackKind, now);
      }
      const animals = [...room.explosives.values()].some((item) => item.kind === 'mine')
        ? wildlifeTargets(room, now) : [];
      for (const explosive of [...room.explosives.values()]) {
        if (explosive.kind === 'grenade' && explosive.detonatesAt <= now) {
          detonate(room, explosive, now);
        } else if (explosive.kind === 'mine') {
          if (explosive.expiresAt <= now) {
            room.explosives.delete(explosive.id);
            io.to(roomChannel(room.code)).emit('explosive:state', {
              action: 'remove', explosive: publicExplosive(explosive), at: now,
            });
          } else if (explosive.armedAt <= now && mineTriggered(room, explosive, now, animals)) {
            detonate(room, explosive, now);
          }
        }
      }
      if ([...room.players.values()].some((player) => player.connected)) broadcast(room);
    }
  }, snapshotMs);
  tick.unref?.();

  return {
    io, httpServer,
    rooms,
    async listen() {
      await new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject); resolve();
        });
      });
      return httpServer.address();
    },
    async close() {
      clearInterval(tick);
      for (const room of rooms.values()) for (const player of room.players.values()) {
        if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
      }
      await new Promise((resolve) => io.close(resolve));
      if (httpServer.listening) await new Promise((resolve) => httpServer.close(resolve));
      try { await voiceService.close?.(); } catch { /* voice cleanup is best effort */ }
    },
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname.replace(/^\//, '').toLowerCase()
  === process.argv[1].replace(/\\/g, '/').replace(/^\//, '').toLowerCase()) {
  // Render supplies PORT; keep the IslandWorld override for local installations.
  const port = Number(process.env.ISLAND_SERVER_PORT || process.env.PORT || 3001);
  const host = process.env.ISLAND_SERVER_HOST || '0.0.0.0';
  const allowedOrigins = (process.env.ISLAND_ALLOWED_ORIGINS || '').split(',').map((s) => s.trim())
    .filter(Boolean);
  const server = createMultiplayerServer({ host, port, allowedOrigins });
  server.listen().then(() => {
    process.stdout.write(`IslandWorld room server listening on ${host}:${port}\n`);
  }).catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
}
