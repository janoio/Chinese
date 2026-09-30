/* ============================================================================
   BIG TWO — application layer (UI, state sync, networking)
   ----------------------------------------------------------------------------
   Game rules live in engine.js (loaded first, exposed as `BigTwo`). This file
   handles the DOM, local + online rooms (Supabase), bots, and rendering.

   Online play requires the original Supabase project; connection errors are
   visible. Local bot play is a separate explicit choice. Connection settings
   live in config.js; supabase-schema.sql upgrades the existing rooms table.
   ========================================================================== */
'use strict';

const E = window.BigTwo;

const CONFIG = window.BIG_TWO_CONFIG || {};

const QUICK_COMMENTS_DEFAULT = ['omak wen', 'nice', 'bzez', 'gel', 'epique', 'thin', 'kezzzeb', 'btentek', 'pegasus'];
const BOT_NAMES = ['Alex', 'Jordan', 'Sam', 'Rami', 'Nour', 'Kevin'];
const STICKERS = [
  { type: 'image', src: 'assets/stickers/whatsapp_uploaded.webp', label: 'uploaded' },
  { type: 'image', src: 'assets/stickers/whatsapp_crop_01.png', label: 'sticker 1' },
  { type: 'image', src: 'assets/stickers/whatsapp_crop_02.png', label: 'sticker 2' },
  { type: 'image', src: 'assets/stickers/whatsapp_crop_03.png', label: 'sticker 3' },
  { type: 'image', src: 'assets/stickers/whatsapp_crop_04.png', label: 'sticker 4' },
  { type: 'image', src: 'assets/stickers/whatsapp_crop_05.png', label: 'sticker 5' },
  { type: 'image', src: 'assets/stickers/whatsapp_crop_06.png', label: 'sticker 6' },
  { type: 'image', src: 'assets/stickers/whatsapp_crop_07.png', label: 'sticker 7' },
  { type: 'image', src: 'assets/stickers/whatsapp_crop_08.png', label: 'sticker 8' },
  { type: 'emoji', emoji: '😂', label: 'laugh' },
  { type: 'emoji', emoji: '🔥', label: 'fire' },
  { type: 'emoji', emoji: '🤡', label: 'clown' },
  { type: 'emoji', emoji: '💀', label: 'dead' },
  { type: 'emoji', emoji: '🐎', label: 'pegasus' },
];
// Every sticker path we ship — used to whitelist image sources coming off the wire.
const STICKER_SRCS = new Set(STICKERS.filter((s) => s.src).map((s) => s.src));

// ----------------------------- Runtime state -----------------------------
let spClient = null;
let onlineAvailable = false;
let realtimeChannel = null;
let lobbyInterval = null;
let botTimer = null;
let roundTimer = null;
let lastRenderedPlayId = null;
let renderedEventIds = new Set();
let usingLocalMode = false;
let handSortMode = 'rank';
let roomPoll = null, syncGeneration = 0, roomChange = null;
let mutationBusy = false, connectionReady = false, presenceReady = false;
let disconnectedSince = new Map();
let scoreModalKey = '';
const storage = {
  getItem(key) { try { return localStorage.getItem(key); } catch { return null; } },
  setItem(key, value) { try { localStorage.setItem(key, value); } catch { /* Private browsing or quota. */ } },
  removeItem(key) { try { localStorage.removeItem(key); } catch {} },
};
function readJSON(key, fallback) {
  try { const v = JSON.parse(storage.getItem(key)); return v && typeof v === typeof fallback && Array.isArray(v) === Array.isArray(fallback) ? v : fallback; }
  catch { return fallback; }
}
function connectionError(error) {
  if (error?.code === '42P01' || error?.code === 'PGRST205') return 'The rooms table is missing. Run supabase-schema.sql in Supabase.';
  if (error?.code === '42501') return 'Database permissions blocked the room. Run the supplied SQL setup.';
  if (/jwt|api key/i.test(error?.message || '')) return 'The public Supabase key is invalid. Check config.js.';
  return 'Cannot reach online tables. Check your internet and the Supabase project settings in config.js.';
}

let ME = { uid: '', name: '', avatar: '🃏', avatarImg: '' };
let ROOM = null;
let GAME_STATE = null;
let ME_SEAT = -1;
let IS_SPECTATOR = false;
let SELECTED = new Set();
let selectedProfileImage = '';

// ------------------------------- Helpers -------------------------------
const $ = (id) => document.getElementById(id);
const uid = () => 'U' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const randomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

// Escape text before inserting into HTML.
const safeText = (v) => String(v ?? '').replace(/[&<>'"]/g, (m) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[m]));

// Only allow image sources we trust (inline data URLs or our own bundled
// assets). Anything else — e.g. a crafted avatar coming from another client —
// is dropped, which closes an attribute-injection / XSS vector.
function safeImg(url) {
  if (typeof url !== 'string' || !url) return '';
  if (url.length <= 100000 && /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)) return url;
  if (STICKER_SRCS.has(url)) return url;
  return '';
}

const publicPlayer = (p) => ({ uid: p.uid, name: p.name, avatar: p.avatar || '🃏', avatarImg: safeImg(p.avatarImg || '') });
const botPlayer = (name) => ({ uid: `BOT_${name}_${Math.random().toString(36).slice(2, 6)}`, name, avatar: '🤖', avatarImg: '', isBot: true });

let toastTimer;
function toast(message, ms = 2100) {
  const el = $('toast');
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
}

function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* ignore */ }
}

// ------------------------------ Screens ------------------------------
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $('game-screen').classList.add('hidden');
  $(id)?.classList.remove('hidden');
}
function showGameScreen() {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  $('game-screen').classList.remove('hidden');
}

function setConnStatus(status) {
  const dot = $('conn-dot');
  const label = $('conn-label');
  if (!dot || !label) return;
  dot.className = `conn-dot ${status}`;
  label.textContent = status === 'connected' ? 'Online' : status === 'connecting' ? 'Connecting…' : 'Offline';
}

// ------------------------------- Boot -------------------------------
function initSupabase() {
  try {
    if (!window.supabase || !CONFIG.SUPABASE_URL || CONFIG.SUPABASE_URL.includes('YOUR_')) throw new Error('not configured');
    spClient = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
    onlineAvailable = true;
  } catch (err) {
    console.warn('Supabase unavailable — running in local bot mode only:', err.message);
    onlineAvailable = false;
  }
}

window.addEventListener('load', boot);

function boot() {
  bindUI();
  initSupabase();
  ME.uid = storage.getItem('bt_uid') || uid();
  storage.setItem('bt_uid', ME.uid);

  const saved = readJSON('bt_profile', {});
  if (saved.name) {
    ME = { ...ME, name: saved.name, avatar: saved.avatar || '🃏', avatarImg: safeImg(saved.avatarImg || '') };
    selectedProfileImage = ME.avatarImg || '';
    $('inp-name').value = ME.name;
    $('inp-avatar').value = ME.avatar;
    updateProfilePreview();
    initLobby();
    const resume = readJSON('bt_room_resume', {});
    if (resume.roomId && onlineAvailable) joinRoom(resume.roomId);
  } else {
    updateProfilePreview();
    showScreen('screen-profile');
  }
}

function bindUI() {
  // Profile
  $('btn-save-profile').addEventListener('click', saveProfile);
  $('btn-pick-photo').addEventListener('click', () => $('file-avatar').click());
  $('btn-take-selfie').addEventListener('click', () => $('file-selfie').click());
  $('file-avatar').addEventListener('change', handleProfileFile);
  $('file-selfie').addEventListener('change', handleProfileFile);
  $('inp-avatar').addEventListener('input', updateProfilePreview);
  $('inp-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveProfile(); });

  // Lobby
  $('btn-create-room').addEventListener('click', createRoom);
  $('btn-join-code').addEventListener('click', joinByCode);
  $('btn-local').addEventListener('click', joinLocalGame);
  $('btn-change-profile').addEventListener('click', () => showScreen('screen-profile'));
  $('btn-rules-lobby').addEventListener('click', showRulesModal);
  $('inp-room-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(); });

  // Waiting
  $('btn-start').addEventListener('click', startGameAsHost);
  $('btn-add-bot-waiting').addEventListener('click', addBotToRoom);
  $('btn-leave-waiting').addEventListener('click', () => leaveRoom());
  $('room-code-display').addEventListener('click', copyRoomCode);

  // Game top bar
  $('btn-new-table').addEventListener('click', createRoom);
  $('btn-leave-game').addEventListener('click', () => leaveRoom());
  $('btn-end-game').addEventListener('click', endGameNow);
  $('btn-add-bot').addEventListener('click', addBotToRoom);
  $('btn-rules-game').addEventListener('click', showRulesModal);

  // Game actions
  $('playBtn').addEventListener('click', handlePlay);
  $('passBtn').addEventListener('click', handlePass);
  $('sortBtn').addEventListener('click', toggleSort);
  $('commentBtn').addEventListener('click', openCommentSheet);
  $('emoteBtn').addEventListener('click', openStickerSheet);

  // Sheets
  $('sheet-backdrop').addEventListener('click', closeSheets);
  $('btn-send-custom').addEventListener('click', () => sendCustomComment(false));
  $('btn-save-comment').addEventListener('click', () => sendCustomComment(true));
  $('custom-comment').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCustomComment(false); });

  renderCommentSheet();
  renderStickerSheet();
  $('btn-retry-online').addEventListener('click', () => { initSupabase(); initLobby(); });
  $('score-strip').addEventListener('click', () => { if (GAME_STATE && /^(roundOver|gameOver)$/.test(GAME_STATE.phase)) showScoreModal(GAME_STATE); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeSheets(); $('modal').classList.remove('show'); } });
  const code = new URLSearchParams(location.search).get('room');
  if (/^[A-Z0-9]{6}$/i.test(code || '')) $('inp-room-code').value = code.toUpperCase();
}

// ------------------------------ Profile ------------------------------
async function handleProfileFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    selectedProfileImage = await compressImage(file, 128, 0.78);
    updateProfilePreview();
  } catch (err) {
    console.error(err);
    toast('Could not read that picture');
  }
  event.target.value = '';
}

function compressImage(file, size = 128, quality = 0.78) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#0b2a1d';
        ctx.fillRect(0, 0, size, size);
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function updateProfilePreview() {
  const emoji = $('inp-avatar')?.value.trim() || ME.avatar || '🃏';
  const preview = $('profile-preview');
  if (!preview) return;
  const image = safeImg(selectedProfileImage || ME.avatarImg);
  preview.innerHTML = image ? `<img alt="profile" src="${image}">` : safeText(emoji);
}

function saveProfile() {
  const name = $('inp-name').value.trim() || ME.name;
  const avatar = $('inp-avatar').value.trim() || ME.avatar || '🃏';
  if (!name) return toast('Enter a name');
  ME = { ...ME, name, avatar, avatarImg: safeImg(selectedProfileImage || ME.avatarImg || '') };
  storage.setItem('bt_profile', JSON.stringify({ name: ME.name, avatar: ME.avatar, avatarImg: ME.avatarImg }));
  initLobby();
}

function avatarInner(player) {
  const img = safeImg(player?.avatarImg);
  return img ? `<img src="${img}" alt="avatar">` : safeText(player?.avatar || '🃏');
}

// ------------------------------- Lobby -------------------------------
function initLobby() {
  const img = safeImg(ME.avatarImg);
  $('lobby-greeting').innerHTML =
    `${img ? `<span class="inline-pic"><img src="${img}" alt=""></span>` : safeText(ME.avatar)} ${safeText(ME.name)}`;
  showScreen('screen-lobby');
  closeRealtime();
  connectionReady = false;
  usingLocalMode = false;
  setConnStatus(onlineAvailable ? 'connecting' : 'disconnected');
  if (lobbyInterval) clearInterval(lobbyInterval);
  if (onlineAvailable) {
    loadRooms();
    lobbyInterval = setInterval(loadRooms, 5000);
  } else {
    renderLocalLobby();
  }
}

async function loadRooms() {
  if (!onlineAvailable || !spClient) return renderLocalLobby();
  try {
    const { data, error } = await spClient.from('rooms').select('id,code,seats,playing,deal,updated_at').order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    connectionReady = true;
    renderRoomList(data || []);
    $('online-error').classList.add('hidden');
    setConnStatus('connected');
  } catch (err) {
    console.error(err);
    setConnStatus('disconnected');
    connectionReady = false;
    renderLocalLobby(connectionError(err));
  }
}

function renderLocalLobby(message = 'Online play is not configured or the connection library could not load. Check config.js, then retry.') {
  $('online-error').classList.remove('hidden');
  $('online-error-text').textContent = message;
  const list = $('room-list');
  list.innerHTML = `<div class="room-item" data-local="1">
    <div><div class="room-name">LOCAL TABLE</div><div class="room-meta">You vs 3 bots · works offline</div></div>
    <span class="room-badge badge-open">OPEN</span></div>`;
  list.querySelector('[data-local]').addEventListener('click', joinLocalGame);
}

function renderRoomList(rooms) {
  const list = $('room-list');
  if (!rooms.length) {
    list.innerHTML = '<div class="loading-text">No live tables yet. Create one!</div>';
    return;
  }
  list.innerHTML = rooms.map((room) => {
    const seats = room.seats || [null, null, null, null];
    const count = seats.filter(Boolean).length;
    const badge = room.playing ? '<span class="room-badge badge-playing">PLAYING</span>'
      : count >= 4 ? '<span class="room-badge badge-full">FULL</span>'
      : '<span class="room-badge badge-open">OPEN</span>';
    const avatars = seats.filter(Boolean).map((p) => (safeImg(p.avatarImg) ? '📷' : safeText(p.avatar || '🃏'))).join(' ');
    return `<div class="room-item" data-room="${safeText(room.id)}">
      <div><div class="room-name">${safeText(room.code || 'TABLE')} ${avatars}</div>
      <div class="room-meta">${count}/4 players · deal ${safeText(room.deal || 1)}</div></div>${badge}</div>`;
  }).join('');
  list.querySelectorAll('[data-room]').forEach((el) => el.addEventListener('click', () => joinRoom(el.dataset.room)));
}

// ------------------------------- Rooms -------------------------------
async function createRoom() {
  if (!ME.name) return showScreen('screen-profile');
  if (!onlineAvailable || !spClient) return toast('Online play is unavailable. Use Retry connection or choose Play vs bots.', 5000);
  if (ROOM && !await leaveRoom()) return;
  try {
    const seats = [publicPlayer(ME), null, null, null];
    const { data, error } = await spClient.from('rooms').insert({
      code: randomCode(), host_uid: ME.uid, seats, spectators: [],
      playing: false, scores: [0, 0, 0, 0], deal: 1, state: null,
    }).select().single();
    if (error) throw error;
    ROOM = data; ME_SEAT = 0; IS_SPECTATOR = false; usingLocalMode = false;
    storage.setItem('bt_room_resume', JSON.stringify({ roomId: data.id }));
    enterWaitingRoom(data.id);
  } catch (err) {
    console.error(err);
    toast(connectionError(err), 6000);
    renderLocalLobby(connectionError(err));
  }
}

function joinByCode() {
  const code = $('inp-room-code').value.trim().toUpperCase();
  if (!code || code.length !== 6) return toast('Enter the 6-character room code');
  if (!onlineAvailable || !spClient) return toast('Online play is not connected');
  spClient.from('rooms').select('*').eq('code', code).single().then(({ data, error }) => {
    if (error || !data) return toast('Room not found');
    joinRoom(data.id);
  });
}

async function joinRoom(id) {
  if (!onlineAvailable || !spClient) return toast('Online play is unavailable');
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: room, error } = await spClient.from('rooms').select('*').eq('id', id).single();
      if (error || !room) throw error || new Error('Room not found');
      const seats = [...room.seats];
      let mySeat = seats.findIndex((s) => s?.uid === ME.uid);
      let updated = room;
      if (mySeat < 0) {
        const empty = seats.findIndex((s) => !s);
        let patch;
        if (empty < 0 || room.playing) {
          patch = { spectators: [...(room.spectators || []).filter((p) => p.uid !== ME.uid), publicPlayer(ME)] };
        } else { seats[empty] = publicPlayer(ME); patch = { seats }; }
        const result = await spClient.from('rooms').update(patch).eq('id', id).eq('updated_at', room.updated_at).select().maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) continue; // Another friend claimed a seat; read and retry.
        updated = result.data;
      }
      ROOM = updated; ME_SEAT = updated.seats.findIndex((s) => s?.uid === ME.uid);
      IS_SPECTATOR = ME_SEAT < 0; usingLocalMode = false;
      storage.setItem('bt_room_resume', JSON.stringify({ roomId: id }));
      scoreModalKey = ''; lastRenderedPlayId = null;
      if (ROOM.playing && ROOM.state) enterGame(id); else enterWaitingRoom(id);
      return;
    }
    toast('The table changed while joining. Please try again.');
  } catch (err) { toast(connectionError(err), 6000); }
}

function joinLocalGame() {
  if (!ME.name) return showScreen('screen-profile');
  closeRealtime();
  scoreModalKey = ''; lastRenderedPlayId = null; SELECTED.clear();
  usingLocalMode = true; IS_SPECTATOR = false; ME_SEAT = 0;
  ROOM = {
    id: 'local', code: 'LOCAL', host_uid: ME.uid,
    seats: [publicPlayer(ME), botPlayer('Alex'), botPlayer('Jordan'), botPlayer('Sam')],
    spectators: [], playing: false, scores: [0, 0, 0, 0], deal: 1, state: null,
  };
  enterWaitingRoom('local');
}

async function addBotToRoom() {
  if (!ROOM || !isRoomHost()) return toast('Only the host can add a bot');
  const seats = [...(ROOM.seats || [null, null, null, null])];
  const empty = seats.findIndex((s) => !s);
  if (empty === -1) return toast('The table is full');
  seats[empty] = botPlayer(BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]);
  await updateRoom({ seats });
}

const isRoomHost = () => usingLocalMode || ROOM?.host_uid === ME.uid;

// The "authority" client drives bots and finalizes rounds. Normally the host,
// but if the host has left an in-progress table the lowest-seated human takes
// over so the game never stalls.
function isAuthority() {
  if (usingLocalMode) return true;
  const seats = ROOM?.seats || [];
  const hostSeated = seats.some((s) => s && s.uid === ROOM.host_uid);
  if (hostSeated) return ROOM.host_uid === ME.uid;
  const firstHuman = seats.find((s) => s && !s.isBot);
  return !!firstHuman && firstHuman.uid === ME.uid;
}

async function copyRoomCode() {
  const code = ROOM?.code;
  if (!code || code === 'LOCAL') return toast('This is a local bot table. Create an online table to invite friends.');
  const link = new URL(location.href); link.searchParams.set('room', code);
  try { await navigator.clipboard.writeText(link.href); $('copy-hint').textContent = 'Invite link copied!'; }
  catch { toast('Room code: ' + code, 8000); }
}

// --------------------------- Waiting room ---------------------------
function enterWaitingRoom(id) {
  if (lobbyInterval) clearInterval(lobbyInterval);
  showScreen('screen-waiting');
  renderWaitingRoom();
  if (usingLocalMode) return;
  subscribeToRoom(id, () => {
    if (!ROOM) return;
    if (ROOM.playing && ROOM.state) enterGame(id);
    else renderWaitingRoom();
  });
}

function renderWaitingRoom() {
  if (!ROOM) return;
  $('room-code-display').textContent = ROOM.code || 'LOCAL';
  const seats = ROOM.seats || [null, null, null, null];
  $('seat-grid').innerHTML = seats.map((seat) => {
    const isMe = seat && seat.uid === ME.uid;
    return `<div class="seat ${seat ? 'filled' : ''} ${isMe ? 'me' : ''}">
      ${seat ? `<div class="seat-avatar">${avatarInner(seat)}</div>
        <div class="seat-name">${safeText(seat.name)}${seat.isBot ? ' 🤖' : ''}${isMe ? ' (YOU)' : ''}</div>`
        : '<div class="seat-empty">Empty seat</div>'}</div>`;
  }).join('');
  const specs = ROOM.spectators || [];
  $('waiting-spectators').textContent = specs.length ? `👁 Spectating: ${specs.map((p) => p.name).join(', ')}` : '';

  const isHost = isRoomHost();
  const filled = seats.filter(Boolean).length;
  $('btn-start').style.display = isHost ? 'block' : 'none';
  $('btn-add-bot-waiting').style.display = isHost && filled < 4 ? 'block' : 'none';
  $('btn-start').disabled = !isHost;
  $('waiting-hint').textContent = isHost
    ? (filled < 4 ? 'Invite friends before starting. Empty seats will be filled with bots.' : 'All four seats are ready.')
    : 'Waiting for the host to start.';
}

async function startGameAsHost() {
  if (!ROOM || !isRoomHost()) return;
  const seats = [...(ROOM.seats || [])];
  while (seats.filter(Boolean).length < 4) {
    const empty = seats.findIndex((s) => !s);
    if (empty === -1) break;
    seats[empty] = botPlayer(BOT_NAMES[empty] || 'Bot');
  }
  const state = E.dealNewRound(seats, ROOM.scores || [0, 0, 0, 0], ROOM.deal || 1, null);
  if (await updateRoom({ seats, playing: true, state })) enterGame(ROOM.id);
}

// --------------------------- Realtime sync ---------------------------
function acceptRoom(room) {
  if (!ROOM || room.id !== ROOM.id) return;
  if (ROOM.updated_at && room.updated_at < ROOM.updated_at) return;
  ROOM = room; GAME_STATE = room.state;
  ME_SEAT = room.seats.findIndex((s) => s?.uid === ME.uid);
  IS_SPECTATOR = ME_SEAT < 0;
  roomChange?.();
}

function subscribeToRoom(id, onChange) {
  if (!onlineAvailable || !spClient || usingLocalMode) return;
  // Keep the same channel when moving from waiting room to game.
  if (realtimeChannel && ROOM?.id === id) { roomChange = onChange; return; }
  closeRealtime(); roomChange = onChange;
  const generation = syncGeneration;
  const channel = spClient.channel('room-' + id, { config: { presence: { key: ME.uid } } });
  realtimeChannel = channel;
  channel.on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: 'id=eq.' + id }, (payload) => {
    if (generation !== syncGeneration) return;
    if (payload.eventType === 'DELETE') { toast('Table closed'); leaveRoom(true, false); return; }
    acceptRoom(payload.new);
  }).on('presence', { event: 'sync' }, () => { presenceReady = true; })
    .on('broadcast', { event: 'table-event' }, ({ payload }) => {
      if (!GAME_STATE || !ROOM.seats.some((p) => p?.uid === payload.uid)) return;
      GAME_STATE.events = [...(GAME_STATE.events || []).slice(-20), payload]; renderEvents();
    }).subscribe(async (status) => {
      if (generation !== syncGeneration) return;
      if (status === 'SUBSCRIBED') await channel.track({ uid: ME.uid });
      else { presenceReady = false; disconnectedSince.clear(); }
    });
  let fetching = false;
  async function refresh() {
    if (generation !== syncGeneration || fetching) return;
    fetching = true;
    try {
      const { data, error } = await spClient.from('rooms').select('*').eq('id', id).maybeSingle();
      if (generation !== syncGeneration) return;
      if (error) throw error;
      connectionReady = true;
      if (!data) { toast('Table closed'); await leaveRoom(true, false); return; }
      if (data.updated_at !== ROOM?.updated_at) acceptRoom(data);
      await recoverDisconnectedPlayers(channel);
    } catch { connectionReady = false; presenceReady = false; disconnectedSince.clear(); toast('Connection lost. Retrying…', 2000); }
    finally { fetching = false; }
  }
  roomPoll = setInterval(refresh, 2500); refresh();
}

async function recoverDisconnectedPlayers(channel) {
  if (!presenceReady || !ROOM || mutationBusy) return;
  const present = new Set(Object.keys(channel.presenceState()));
  if (!present.has(ME.uid)) return;
  const humans = ROOM.seats.filter((p) => p && !p.isBot && present.has(p.uid));
  if (humans[0]?.uid !== ME.uid) return;
  const seats = [...ROOM.seats]; let changed = false;
  seats.forEach((p, i) => {
    if (!p || p.isBot) return;
    if (present.has(p.uid)) { disconnectedSince.delete(p.uid); return; }
    if (!disconnectedSince.has(p.uid)) disconnectedSince.set(p.uid, Date.now());
    if (Date.now() - disconnectedSince.get(p.uid) < 30000) return;
    seats[i] = ROOM.playing ? botPlayer(p.name + ' (bot)') : null;
    changed = true;
  });
  if (!changed) return;
  const host = seats.find((p) => p && !p.isBot && p.uid === ROOM.host_uid) || seats.find((p) => p && !p.isBot);
  await updateRoom({ seats, host_uid: host?.uid || null });
}

function closeRealtime() {
  syncGeneration++; clearInterval(roomPoll); roomPoll = null;
  if (realtimeChannel && spClient) spClient.removeChannel(realtimeChannel);
  realtimeChannel = null; roomChange = null; presenceReady = false; disconnectedSince.clear();
}

// Compare-and-swap avoids overwriting another player's move or seat.
async function updateRoom(patch) {
  if (!ROOM || mutationBusy) return false;
  if (usingLocalMode) {
    ROOM = { ...ROOM, ...patch }; GAME_STATE = ROOM.state;
    if (ROOM.playing) renderGame(); else renderWaitingRoom();
    return true;
  }
  if (!onlineAvailable || !spClient) return false;
  mutationBusy = true;
  const before = ROOM;
  try {
    const { data, error } = await spClient.from('rooms').update(patch).eq('id', before.id)
      .eq('updated_at', before.updated_at).select().maybeSingle();
    if (error) throw error;
    if (!data) {
      const fresh = await spClient.from('rooms').select('*').eq('id', before.id).single();
      if (fresh.data) acceptRoom(fresh.data);
      toast('The table changed. Please try your move again.'); return false;
    }
    acceptRoom(data); return true;
  } catch (err) { toast(connectionError(err), 5000); return false; }
  finally { mutationBusy = false; scheduleBotIfNeeded(); scheduleRoundFinalizeIfNeeded(); }
}

// ------------------------------- Game -------------------------------
function enterGame(id) {
  if (!ROOM) return;
  GAME_STATE = ROOM.state;
  SELECTED.clear();
  showGameScreen();
  if (!usingLocalMode) {
    subscribeToRoom(id, () => {
      if (ROOM?.playing && ROOM.state) { GAME_STATE = ROOM.state; renderGame(); }
      else enterWaitingRoom(id);
    });
  }
  renderGame();
}

function renderGame() {
  if (!ROOM || !GAME_STATE) return;
  const state = GAME_STATE;
  const seats = ROOM.seats || [];
  $('table-name').textContent = ROOM.code ? `Table ${ROOM.code}` : 'Table';
  $('table-subtitle').textContent =
    `${IS_SPECTATOR ? 'Spectating' : `Seat ${ME_SEAT + 1}`} · deal ${state.deal} · target ${state.targetScore || E.TARGET_SCORE}`;
  $('btn-add-bot').disabled = !isRoomHost() || seats.filter(Boolean).length >= 4 || state.phase === 'playing';
  $('btn-end-game').style.display = isRoomHost() ? '' : 'none';
  $('spectator-banner').style.display = IS_SPECTATOR ? 'block' : 'none';

  renderSeats();
  renderCenter();
  renderHand();
  renderActions();
  renderScores();
  renderEvents();
  if (/^(roundOver|gameOver)$/.test(state.phase)) {
    const key = ROOM.id + ':' + state.deal + ':' + state.phase + ':' + ROOM.host_uid;
    if (key !== scoreModalKey) { scoreModalKey = key; showScoreModal(state); }
  } else if (scoreModalKey) { scoreModalKey = ''; $('modal').classList.remove('show'); }
  scheduleBotIfNeeded();
  scheduleRoundFinalizeIfNeeded();
}

// Map a seat index to a screen slot so *you* are always at the bottom.
function seatToSlot(seatIndex) {
  const order = ['bottom', 'left', 'top', 'right'];
  if (ME_SEAT < 0 || IS_SPECTATOR) return order[seatIndex] || 'bottom';
  return order[(seatIndex - ME_SEAT + 4) % 4];
}

function slotPosition(slot) {
  const rect = $('game-table').getBoundingClientRect();
  return {
    bottom: { x: rect.width / 2, y: rect.height - 40 },
    top: { x: rect.width / 2, y: 88 },
    left: { x: 54, y: rect.height / 2 },
    right: { x: rect.width - 54, y: rect.height / 2 },
    center: { x: rect.width / 2, y: rect.height / 2 },
  }[slot] || { x: rect.width / 2, y: rect.height / 2 };
}

function renderSeats() {
  const state = GAME_STATE;
  const seats = ROOM.seats || [];
  ['top', 'left', 'right', 'bottom'].forEach((slot) => { $(`slot-${slot}`).innerHTML = ''; });
  seats.forEach((player, i) => {
    const slot = seatToSlot(i);
    const el = $(`slot-${slot}`);
    // Don't draw myself on the felt — my hand at the bottom already represents me.
    if (i === ME_SEAT && !IS_SPECTATOR) return;
    if (!player) { el.innerHTML = `<div class="avatar-frame">?</div><div class="empty-seat-label">Empty</div>`; return; }
    const active = state.current === i && state.phase === 'playing';
    const me = false;
    const count = (state.hands?.[i] || []).length;
    const mini = slot === 'bottom' ? ''
      : `<div class="mini-hand">${Array.from({ length: Math.min(count, 7) }).map(() => '<span class="mini-card"></span>').join('')}</div>`;
    el.innerHTML = `<div class="avatar-frame ${active ? 'active' : ''}">
        ${avatarInner(player)}<span class="card-count">${count}</span></div>
      <div class="player-name-tag ${me ? 'me' : ''} ${active ? 'active' : ''}">${safeText(player.name)}${player.isBot ? ' 🤖' : ''}</div>${mini}`;
  });
}

function renderCenter() {
  const state = GAME_STATE;
  const last = state.lastPlay;
  const played = $('played-cards');
  const message = $('center-message');

  if (last && last.cards?.length) {
    const player = ROOM.seats?.[last.seat];
    $('last-played-by').textContent = `${player?.name || 'Player'} played ${E.comboLabel(last.combo)}`;
    const isNew = last.id !== lastRenderedPlayId;
    if (isNew) lastRenderedPlayId = last.id;
    const shift = dropShift(seatToSlot(last.seat));
    const bomb = E.isBomb(last.combo);
    played.innerHTML = last.cards.map((card, i) => {
      const n = last.cards.length;
      const rot = n === 1 ? 0 : (i - (n - 1) / 2) * 8;
      const cls = `table-card ${isNew ? (bomb ? 'bomb' : 'drop') : ''}`;
      return cardHTML(card, cls, `--i:${i};--rot:${rot}deg;--sx:${shift.x}px;--sy:${shift.y}px;`);
    }).join('');
    if (isNew && bomb) vibrate(30);
    message.textContent = '';
  } else {
    $('last-played-by').textContent = '';
    played.innerHTML = '';
    message.textContent = state.message || 'No cards in play — lead any combo.';
  }

  if (state.phase === 'roundOverPending') message.textContent = 'Last card down — tallying the round…';
  else if (state.phase === 'roundOver') message.textContent = 'Round over.';
  else if (state.phase === 'gameOver') message.textContent = 'Game over.';

  const label = $('turn-label');
  label.textContent = state.phase === 'playing' ? turnText() : state.phase.replace(/([A-Z])/g, ' $1');
  label.classList.toggle('mine', state.phase === 'playing' && state.current === ME_SEAT && !IS_SPECTATOR);
}

function dropShift(slot) {
  return { bottom: { x: 0, y: 155 }, top: { x: 0, y: -130 }, left: { x: -170, y: 0 }, right: { x: 170, y: 0 } }[slot] || { x: 0, y: 0 };
}

function turnText() {
  const player = ROOM.seats?.[GAME_STATE.current];
  if (!player) return 'Waiting';
  return GAME_STATE.current === ME_SEAT && !IS_SPECTATOR ? 'Your turn' : `${player.name}'s turn`;
}

// ------------------------------- Hand -------------------------------
function myHandSorted() {
  return E.sortHand(GAME_STATE.hands?.[ME_SEAT] || [], handSortMode);
}

function renderHand() {
  const hand = $('hand');
  if (IS_SPECTATOR || ME_SEAT < 0) { hand.innerHTML = '<div class="hint-text">Spectating this table.</div>'; return; }
  const myTurn = GAME_STATE.current === ME_SEAT && GAME_STATE.phase === 'playing';
  hand.innerHTML = myHandSorted().map((card) => {
    const selected = SELECTED.has(card.id);
    return cardHTML(card, `hand-card ${selected ? 'selected' : ''} ${myTurn ? '' : 'disabled'}`, '', card.id);
  }).join('');
  hand.querySelectorAll('[data-card]').forEach((el) => {
    el.addEventListener('click', () => toggleCard(el.dataset.card));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCard(el.dataset.card); document.querySelector('[data-card="' + el.dataset.card + '"]')?.focus(); } });
  });
}

function cardHTML(card, cls = '', style = '', id = '') {
  const red = E.isRed(card) ? 'red-suit' : '';
  const data = id ? `data-card="${safeText(id)}" role="button" tabindex="0" aria-label="${safeText(card.r)} ${E.SUIT_SYMBOL[card.s]}" aria-pressed="${SELECTED.has(id)}"` : '';
  return `<div class="card ${red} ${cls}" ${data} style="${style}">
    <div class="rank">${safeText(card.r)}<span class="corner-suit">${E.SUIT_SYMBOL[card.s]}</span></div>
    <div class="suit">${E.SUIT_SYMBOL[card.s]}</div>
    <div class="tiny">${safeText(card.r)}</div></div>`;
}

function toggleCard(cardId) {
  if (GAME_STATE.current !== ME_SEAT || GAME_STATE.phase !== 'playing') return;
  if (SELECTED.has(cardId)) SELECTED.delete(cardId); else SELECTED.add(cardId);
  renderHand();
  renderActions();
}

function getSelectedCards() {
  return (GAME_STATE.hands?.[ME_SEAT] || []).filter((c) => SELECTED.has(c.id));
}

function toggleSort() {
  handSortMode = handSortMode === 'rank' ? 'suit' : 'rank';
  toast(handSortMode === 'rank' ? 'Sorted by rank' : 'Sorted by suit', 1100);
  renderHand();
}

function renderActions() {
  const state = GAME_STATE;
  const myTurn = state.current === ME_SEAT && state.phase === 'playing' && !IS_SPECTATOR;
  const selected = getSelectedCards();
  const verdict = myTurn && selected.length ? E.validatePlay(state, ROOM.seats || [], ME_SEAT, selected) : null;

  $('playBtn').disabled = !(verdict && verdict.ok);
  $('passBtn').disabled = !(myTurn && E.canPass(state, ME_SEAT));
  $('sortBtn').disabled = IS_SPECTATOR || ME_SEAT < 0;
  $('commentBtn').disabled = IS_SPECTATOR && ME_SEAT < 0;
  $('emoteBtn').disabled = IS_SPECTATOR && ME_SEAT < 0;

  const hint = $('hint-text');
  if (!myTurn) hint.textContent = state.phase === 'playing' ? 'Waiting for your turn.' : 'Round paused.';
  else if (!selected.length) hint.textContent = state.lastPlay ? `Beat the ${E.comboLabel(state.lastPlay.combo)} or pass.` : 'Choose cards to lead.';
  else if (!verdict.combo) hint.textContent = 'Not a legal combination.';
  else hint.textContent = verdict.ok ? `${E.comboLabel(verdict.combo)} ready.` : verdict.reason;
}

function renderScores() {
  const scores = GAME_STATE.scores || ROOM.scores || [0, 0, 0, 0];
  const min = Math.min(...(ROOM.seats || []).map((p, i) => (p ? scores[i] || 0 : Infinity)));
  $('score-strip').innerHTML = (ROOM.seats || []).map((player, i) => {
    if (!player) return '';
    const me = i === ME_SEAT ? 'me' : '';
    const leader = (scores[i] || 0) === min ? 'leader' : '';
    return `<span class="score-chip ${me} ${leader}">${safeText(player.name)} <span class="sc-val">${safeText(scores[i] || 0)}</span></span>`;
  }).join('');
}

// ---------------------------- Play / pass ----------------------------
async function handlePlay() {
  const state = GAME_STATE;
  if (!state || state.current !== ME_SEAT || state.phase !== 'playing') return;
  const cards = getSelectedCards();
  const verdict = E.validatePlay(state, ROOM.seats || [], ME_SEAT, cards);
  if (!verdict.ok) return toast(verdict.reason);
  await commitPlay(ME_SEAT, cards);
}

async function commitPlay(seat, cards) {
  SELECTED.clear();
  const next = E.applyPlay(GAME_STATE, ROOM.seats || [], seat, cards);
  await updateRoom({ state: next });
}

async function handlePass() {
  const state = GAME_STATE;
  if (!state || state.current !== ME_SEAT || state.phase !== 'playing') return;
  if (!E.canPass(state, ME_SEAT)) return toast('You cannot pass right now');
  const next = E.applyPass(state, ROOM.seats || [], ME_SEAT);
  await updateRoom({ state: next });
}

// --------------------------- Round finalize ---------------------------
function scheduleRoundFinalizeIfNeeded() {
  clearTimeout(roundTimer);
  if (!GAME_STATE || GAME_STATE.phase !== 'roundOverPending') return;
  const wait = Math.max(120, (GAME_STATE.roundOverAt || Date.now() + 1000) - Date.now());
  roundTimer = setTimeout(() => {
    if (isAuthority() && GAME_STATE?.phase === 'roundOverPending') finalizeRound();
  }, wait);
}

async function finalizeRound() {
  if (!GAME_STATE || GAME_STATE.phase !== 'roundOverPending') return;
  const next = E.finalizeRound(GAME_STATE, ROOM.seats || []);
  await updateRoom({ state: next, scores: next.scores });
}

function showScoreModal(state) {
  const scores = state.scores || [0, 0, 0, 0];
  const penalties = state.penalties || [0, 0, 0, 0];
  const gameOver = state.phase === 'gameOver';
  const rows = (ROOM.seats || []).map((player, i) => {
    if (!player) return '';
    const cls = i === state.winner ? 'winner-row' : (i === state.loser && gameOver ? 'loser-row' : '');
    const left = state.hands?.[i]?.length || 0;
    return `<tr class="${cls}">
      <td>${safeImg(player.avatarImg) ? '📷' : safeText(player.avatar || '')} ${safeText(player.name)}${i === state.winner ? ' 👑' : ''}</td>
      <td>${left}</td><td>+${safeText(penalties[i] || 0)}</td><td>${safeText(scores[i] || 0)}</td></tr>`;
  }).join('');

  $('modal-inner').innerHTML = `<div class="modal-title">${gameOver ? '🏆 GAME OVER' : 'ROUND OVER'}</div>
    <table class="score-table"><tr><th>Player</th><th>Cards</th><th>Penalty</th><th>Total</th></tr>${rows}</table>
    <div class="penalty-note"><strong>Scoring:</strong> 1–4 cards ×1 · 5–9 ×2 · 10–12 ×3 · 13 = 39. First to ${safeText(state.targetScore || E.TARGET_SCORE)} loses.</div>
    ${gameOver
      ? `<div class="penalty-note">🥇 Champion: <strong>${safeText(ROOM.seats?.[state.champion]?.name || 'Player')}</strong> (lowest score wins).</div>
         ${isRoomHost() ? '<button class="btn btn-gold" id="modal-new-session">NEW GAME</button>' : ''}`
      : `${isRoomHost() ? '<button class="btn btn-gold" id="modal-next-round">NEXT DEAL</button>' : '<div class="penalty-note">Waiting for the host to deal…</div>'}`}
    <button class="btn btn-ghost" id="modal-close">Close</button>`;

  $('modal').classList.add('show');
  $('modal-close').addEventListener('click', () => $('modal').classList.remove('show'));
  $('modal-next-round')?.addEventListener('click', hostNextRound);
  $('modal-new-session')?.addEventListener('click', newSession);
}

async function hostNextRound() {
  if (!isRoomHost()) return toast('Only the host can deal the next round');
  $('modal').classList.remove('show');
  const starter = GAME_STATE?.nextStarter ?? GAME_STATE?.winner ?? null;
  const nextDeal = (ROOM.deal || 1) + 1;
  const state = E.dealNewRound(ROOM.seats, GAME_STATE?.scores || ROOM.scores || [0, 0, 0, 0], nextDeal, starter);
  lastRenderedPlayId = null; SELECTED.clear();
  await updateRoom({ deal: nextDeal, playing: true, state });
}

async function newSession() {
  if (!isRoomHost()) return toast('Only the host can start a new game');
  $('modal').classList.remove('show');
  const state = E.dealNewRound(ROOM.seats, [0, 0, 0, 0], 1, null);
  lastRenderedPlayId = null; SELECTED.clear();
  await updateRoom({ scores: [0, 0, 0, 0], deal: 1, playing: true, state });
}

async function endGameNow() {
  if (!ROOM || !isRoomHost() || !GAME_STATE) return toast('Only the host can end the game');
  if (!confirm('End the game now and show final scores?')) return;
  // An abort just freezes the current standings — no round penalties are applied.
  const scores = GAME_STATE.scores || ROOM.scores || [0, 0, 0, 0];
  const state = typeof structuredClone === 'function' ? structuredClone(GAME_STATE) : JSON.parse(JSON.stringify(GAME_STATE));
  state.phase = 'gameOver';
  state.scores = scores;
  state.penalties = [0, 0, 0, 0];
  state.winner = null;
  state.champion = scores.indexOf(Math.min(...(ROOM.seats || []).map((p, i) => (p ? scores[i] : Infinity))));
  state.loser = scores.indexOf(Math.max(...(ROOM.seats || []).map((p, i) => (p ? scores[i] : -Infinity))));
  await updateRoom({ state });
}

async function leaveRoom(goLobby = true, persist = true) {
  clearTimeout(botTimer); clearTimeout(roundTimer); closeSheets();
  if (persist && ROOM && !usingLocalMode && spClient) {
    try {
      let left = false;
      for (let attempt = 0; attempt < 4; attempt++) {
        const result = await spClient.from('rooms').select('*').eq('id', ROOM.id).maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) { left = true; break; }
        const room = result.data, seats = [...room.seats];
        const idx = seats.findIndex((p) => p?.uid === ME.uid);
        if (idx >= 0) seats[idx] = room.playing ? botPlayer(ME.name + ' (bot)') : null;
        const host = seats.find((p) => p && !p.isBot && p.uid === room.host_uid) || seats.find((p) => p && !p.isBot);
        const patch = { seats, host_uid: host?.uid || null, spectators: room.spectators.filter((p) => p.uid !== ME.uid) };
        const write = host
          ? await spClient.from('rooms').update(patch).eq('id', room.id).eq('updated_at', room.updated_at).select().maybeSingle()
          : await spClient.from('rooms').delete().eq('id', room.id).eq('updated_at', room.updated_at).select().maybeSingle();
        if (write.error) throw write.error;
        if (write.data) { left = true; break; }
      }
      if (!left) { toast('Table is busy. Try Leave again.'); return false; }
    } catch (err) { toast('Could not leave cleanly. Reconnecting clients will recover the seat.', 4000); }
  }
  closeRealtime(); storage.removeItem('bt_room_resume');
  ROOM = null; GAME_STATE = null; ME_SEAT = -1; IS_SPECTATOR = false; usingLocalMode = false;
  SELECTED.clear(); scoreModalKey = ''; $('modal').classList.remove('show');
  if (goLobby) initLobby();
  return true;
}

// ------------------------------- Bots -------------------------------
function scheduleBotIfNeeded() {
  clearTimeout(botTimer);
  if (!GAME_STATE || GAME_STATE.phase !== 'playing' || !isAuthority()) return;
  const player = ROOM.seats?.[GAME_STATE.current];
  if (!player?.isBot) return;
  botTimer = setTimeout(() => botMove(GAME_STATE.current), 650 + Math.random() * 450);
}

async function botMove(seat) {
  if (!GAME_STATE || GAME_STATE.phase !== 'playing' || GAME_STATE.current !== seat || !isAuthority()) return;
  const decision = E.botDecide(GAME_STATE, ROOM.seats || [], seat);
  if (decision.pass) {
    const next = E.applyPass(GAME_STATE, ROOM.seats || [], seat);
    await updateRoom({ state: next });
  } else {
    const next = E.applyPlay(GAME_STATE, ROOM.seats || [], seat, decision.cards);
    await updateRoom({ state: next });
  }
}

// ----------------------- Comments & stickers -----------------------
function openCommentSheet() { renderCommentSheet(); $('sheet-backdrop').classList.remove('hidden'); $('comment-sheet').classList.remove('hidden'); }
function openStickerSheet() { renderStickerSheet(); $('sheet-backdrop').classList.remove('hidden'); $('sticker-sheet').classList.remove('hidden'); }
function closeSheets() { $('sheet-backdrop').classList.add('hidden'); $('comment-sheet').classList.add('hidden'); $('sticker-sheet').classList.add('hidden'); }

function getQuickComments() {
  const custom = readJSON('bt_custom_comments', []);
  return [...QUICK_COMMENTS_DEFAULT, ...custom].slice(0, 32);
}

function renderCommentSheet() {
  const grid = $('comment-grid');
  grid.innerHTML = getQuickComments().map((t) => `<button class="quick-chip" data-comment="${safeText(t)}">${safeText(t)}</button>`).join('');
  grid.querySelectorAll('[data-comment]').forEach((btn) => btn.addEventListener('click', () => {
    sendTableEvent({ type: 'comment', text: btn.dataset.comment });
    closeSheets();
  }));
}

function sendCustomComment(save) {
  const input = $('custom-comment');
  const text = input.value.trim().slice(0, 32);
  if (!text) return;
  if (save) {
    const current = readJSON('bt_custom_comments', []);
    if (!current.includes(text)) current.push(text);
    storage.setItem('bt_custom_comments', JSON.stringify(current.slice(-24)));
    renderCommentSheet();
    toast('Comment saved');
  } else {
    sendTableEvent({ type: 'comment', text });
    closeSheets();
  }
  input.value = '';
}

function renderStickerSheet() {
  const grid = $('sticker-grid');
  grid.innerHTML = STICKERS.map((s, i) => s.type === 'image'
    ? `<button class="sticker-btn" data-sticker="${i}" title="${safeText(s.label)}"><img src="${safeImg(s.src)}" alt="sticker"></button>`
    : `<button class="sticker-btn" data-sticker="${i}" title="${safeText(s.label)}"><span class="emoji">${s.emoji}</span></button>`).join('');
  grid.querySelectorAll('[data-sticker]').forEach((btn) => btn.addEventListener('click', () => {
    const s = STICKERS[Number(btn.dataset.sticker)];
    sendTableEvent({ type: 'sticker', src: s.src, emoji: s.emoji, stickerType: s.type });
    closeSheets();
  }));
}

async function sendTableEvent(payload) {
  if (!ROOM || !GAME_STATE || IS_SPECTATOR || ME_SEAT < 0) return;
  const seat = ME_SEAT;
  const event = {
    id: 'E' + Date.now() + Math.random().toString(36).slice(2, 6),
    at: Date.now(), seat, player: ROOM.seats?.[seat]?.name || ME.name, ...payload,
  };
  const state = typeof structuredClone === 'function' ? structuredClone(GAME_STATE) : JSON.parse(JSON.stringify(GAME_STATE));
  state.events = [...(state.events || []).filter((e) => Date.now() - e.at < 12000), event].slice(-30);
  GAME_STATE.events = state.events;
  renderEvents();
  if (!usingLocalMode && realtimeChannel) await realtimeChannel.send({ type: 'broadcast', event: 'table-event', payload: { ...event, uid: ME.uid } });
}

function renderEvents() {
  const layer = $('event-layer');
  for (const event of (GAME_STATE.events || []).filter((e) => Date.now() - e.at < 4500)) {
    if (renderedEventIds.has(event.id)) continue;
    renderedEventIds.add(event.id);
    const pos = slotPosition(seatToSlot(event.seat));
    let bubble;
    if (event.type === 'comment') {
      bubble = document.createElement('div');
      bubble.className = 'speech-bubble';
      bubble.textContent = event.text || '';
    } else if (event.stickerType === 'emoji') {
      bubble = document.createElement('div');
      bubble.className = 'sticker-emoji';
      bubble.textContent = event.emoji || '😂';
    } else {
      bubble = document.createElement('img');
      bubble.className = 'sticker-pop';
      bubble.src = safeImg(event.src) || safeImg(STICKERS[0].src);
      bubble.alt = 'sticker';
    }
    bubble.style.left = `${pos.x}px`;
    bubble.style.top = `${pos.y - 20}px`;
    layer.appendChild(bubble);
    setTimeout(() => bubble.remove(), 3700);
  }
  if (renderedEventIds.size > 200) renderedEventIds = new Set([...renderedEventIds].slice(-100));
}

// ------------------------------- Rules -------------------------------
function showRulesModal() {
  $('modal-inner').innerHTML = `<div class="modal-title">How to play</div>
    <ul class="rules-list">
      <li><strong>Goal:</strong> be the first to empty your hand each deal. Cards left in others' hands add to their score.</li>
      <li><strong>Card order:</strong> 3 is lowest, 2 is highest. Suit ranks ♦ &lt; ♣ &lt; ♥ &lt; ♠.</li>
      <li><strong>Combos:</strong> single, pair, triplet, or a five-card poker hand (straight, flush, full house, four-of-a-kind, straight flush).</li>
      <li><strong>Beating a play:</strong> match the number of cards and play something stronger, or pass.</li>
      <li><strong>Control:</strong> if everyone passes, the last player to play leads any combo they like.</li>
      <li><strong>First move:</strong> the holder of 3♦ opens the very first deal.</li>
      <li><strong>House rules:</strong> 2 cannot be used in a straight; the previous winner opens later deals. Flushes compare all ranks from highest to lowest, then suit. A bomb still needs five cards in play.</li>
      <li><strong>Losing:</strong> when someone reaches ${E.TARGET_SCORE} points the game ends — lowest total wins.</li>
    </ul>
    <button class="btn btn-gold" id="modal-close">Got it</button>`;
  $('modal').classList.add('show');
  $('modal-close').addEventListener('click', () => $('modal').classList.remove('show'));
}
