import './multiplayerRoomUi.css';

const NAME_KEY = 'island-world-player-name-v1';
const readName = () => {
  try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; }
};
const saveName = (name) => {
  try { localStorage.setItem(NAME_KEY, name); } catch { /* optional preference */ }
};

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const field = document.createElement('textarea');
  field.value = text;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.select();
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Copy failed. Select the code shown here.');
}

export function createMultiplayerRoomUI({ client,
  menuRoot = document.querySelector('.screen-card'),
  hudRoot = document.getElementById('hud'),
  onJoin = () => {}, onLeave = () => {} } = {}) {
  if (!client || !menuRoot || !hudRoot) {
    throw new Error('Room UI requires a client, menu, and HUD.');
  }
  const panel = document.createElement('details');
  panel.id = 'private-room-panel';
  panel.innerHTML = `
    <summary>PRIVATE MULTIPLAYER <span id="room-summary-detail">CREATE OR JOIN</span></summary>
    <div class="room-content">
      <div id="room-offline-form">
        <label for="room-player-name">PLAYER NAME</label>
        <input id="room-player-name" type="text" maxlength="24" autocomplete="nickname" placeholder="Your name">
        <div class="room-actions">
          <label for="room-mode">ROOM MODE</label>
          <select id="room-mode" aria-label="Room mode">
            <option value="explore">Explore · no player damage</option>
            <option value="pvp">PvP · combat enabled</option>
          </select>
          <button id="room-create" type="button">CREATE PRIVATE ROOM</button>
        </div>
        <div class="room-join-row">
          <input id="room-code-input" type="text" maxlength="8" autocomplete="off"
            autocapitalize="characters" spellcheck="false" placeholder="JOIN CODE" aria-label="Join code">
          <button id="room-join" type="button">JOIN ROOM</button>
        </div>
        <button id="room-resume" type="button" hidden>REJOIN SAVED ROOM</button>
        <p id="room-help" class="room-help">Up to 10 players. Share the code only with people you invite.</p>
      </div>
      <div id="room-online-view" hidden>
        <div class="room-code-row"><strong id="room-code-label"></strong>
          <button id="room-copy" type="button">COPY CODE</button></div>
        <div id="room-mode-label" class="room-mode-label"></div>
        <ol id="room-player-list" aria-label="Players in room"></ol>
        <button id="room-leave" type="button">LEAVE ROOM</button>
      </div>
      <p id="room-status" class="room-status" role="status" aria-live="polite"></p>
    </div>`;
  const start = menuRoot.querySelector('#start-button');
  if (start) start.insertAdjacentElement('afterend', panel);
  else menuRoot.append(panel);

  const badge = document.createElement('div');
  badge.id = 'private-room-badge';
  badge.hidden = true;
  badge.setAttribute('aria-live', 'polite');
  hudRoot.append(badge);
  const get = (id) => panel.querySelector(`#${id}`);
  const nameInput = get('room-player-name');
  nameInput.value = readName();
  let busy = false;
  let message = '';

  function render() {
    const state = client.getState();
    const joined = Boolean(state.room);
    const unavailable = !joined && !state.serverUrl;
    get('room-offline-form').hidden = joined;
    get('room-online-view').hidden = !joined;
    get('room-resume').hidden = !state.savedSession || joined;
    get('room-summary-detail').textContent = joined
      ? `${state.code} · ${state.mode === 'pvp' ? 'PVP' : 'EXPLORE'}`
      : unavailable ? 'SERVER NOT CONNECTED' : 'CREATE OR JOIN';
    get('room-help').textContent = unavailable
      ? 'Online rooms are unavailable on this site until a room server is connected. Solo exploration is playable.'
      : 'Up to 10 players. Share the code only with people you invite.';
    get('room-status').textContent = message || {
      offline: unavailable ? 'Online rooms are unavailable on this site.' : '',
      connecting: 'Connecting to room server…',
      reconnecting: 'Reconnecting to your room…',
      online: 'Connected', error: state.error || 'Room connection failed.',
    }[state.status] || '';
    for (const id of ['room-create', 'room-join', 'room-resume', 'room-leave']) {
      get(id).disabled = busy || (unavailable && id !== 'room-leave');
    }
    badge.hidden = !joined;
    if (!joined) return;
    panel.open = true;
    const players = state.players || [];
    const occupiedCount = players.length;
    const modeText = state.mode === 'pvp' ? 'PvP · combat enabled'
      : 'Explore · no player damage';
    get('room-code-label').textContent = `ROOM ${state.code}`;
    get('room-mode-label').textContent = modeText;
    badge.textContent = `${state.status === 'reconnecting' ? 'RECONNECTING' : `ROOM ${state.code}`}
      · ${state.mode === 'pvp' ? 'PVP' : 'EXPLORE'} · ${occupiedCount}/10`;
    const list = get('room-player-list');
    list.replaceChildren(...players.map((player) => {
      const item = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = `${player.name || 'Player'}${player.id === state.selfId ? ' (you)' : ''}`;
      item.append(name);
      if (player.connected === false) {
        const status = document.createElement('small');
        status.textContent = 'reconnecting';
        item.append(status);
      }
      return item;
    }));
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    message = '';
    render();
    try { await action(); }
    catch (cause) { message = cause.message || 'Room action failed.'; }
    finally { busy = false; render(); }
  }

  const normalizedName = () => {
    const name = nameInput.value.trim().slice(0, 24);
    if (!name) throw new Error('Enter a player name first.');
    saveName(name);
    return name;
  };
  get('room-create').addEventListener('click', () => run(async () => {
    const name = normalizedName();
    await client.createRoom({ name, mode: get('room-mode').value });
  }));
  get('room-join').addEventListener('click', () => run(async () => {
    const name = normalizedName();
    const code = get('room-code-input').value.trim().toUpperCase();
    if (!code) throw new Error('Enter the private join code.');
    await client.joinRoom({ code, name });
  }));
  get('room-code-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') get('room-join').click();
  });
  get('room-resume').addEventListener('click', () => run(() => client.resumeRoom()));
  get('room-leave').addEventListener('click', () => run(() => client.leaveRoom()));
  get('room-copy').addEventListener('click', () => run(async () => {
    await copyText(client.getState().code);
    message = 'Join code copied.';
  }));
  const unsubscribers = [
    client.on('state', render),
    client.on('joined', (state) => { panel.open = true; onJoin(state.room); render(); }),
    client.on('left', () => { onLeave(); render(); }),
  ];
  render();
  return {
    panel, badge, render,
    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe();
      panel.remove();
      badge.remove();
    },
  };
}
