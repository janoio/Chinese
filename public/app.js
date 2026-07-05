/* ============================================================================
   BIG TWO — application layer (UI, state sync, networking)
   ----------------------------------------------------------------------------
   Game rules live in engine.js (loaded first, exposed as `BigTwo`). This file
   handles the DOM, local + online rooms (Supabase), bots, and rendering.

   Online play is optional: with no/failed Supabase connection the app runs a
   fully local game against bots. To use your own backend, set the two values
   in CONFIG below and run supabase-schema.sql in the Supabase SQL editor.
   ========================================================================== */
'use strict';

const E = window.BigTwo;

const CONFIG = {
  SUPABASE_URL: 'https://nrzhizemptyqdukulepk.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yemhpemVtcHR5cWR1a3VsZXBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzcwMTAsImV4cCI6MjA5ODMxMzAxMH0.yhZshfDfblDz5ycil8VxJENBX3jqWHg99FrxQ8LVnIY',
};

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
  if (url.startsWith('data:image/')) return url;
  if (STICKER_SRCS.has(url)) return url;
  if (/^assets\/[\w./-]+$/.test(url)) return url;
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
  ME.uid = localStorage.getItem('bt_uid') || uid();
  localStorage.setItem('bt_uid', ME.uid);

  const saved = JSON.parse(localStorage.getItem('bt_profile') || '{}');
  if (saved.name) {
    ME = { ...ME, name: saved.name, avatar: saved.avatar || '🃏', avatarImg: safeImg(saved.avatarImg || '') };
    selectedProfileImage = ME.avatarImg || '';
    $('inp-name').value = ME.name;
    $('inp-avatar').value = ME.avatar;
    updateProfilePreview();
    initLobby();
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
  localStorage.setItem('bt_profile', JSON.stringify({ name: ME.name, avatar: ME.avatar, avatarImg: ME.avatarImg }));
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
    const { data, error } = await spClient.from('rooms').select('*').order('created_at', { ascending: false }).limit(20);
    if (error) throw error;
    renderRoomList(data || []);
    setConnStatus('connected');
  } catch (err) {
    console.error(err);
    setConnStatus('disconnected');
    renderLocalLobby();
  }
}

function renderLocalLobby() {
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
      <div class="room-meta">${count}/4 players · deal ${room.deal || 1}</div></div>${badge}</div>`;
  }).join('');
  list.querySelectorAll('[data-room]').forEach((el) => el.addEventListener('click', () => joinRoom(el.dataset.room)));
}

// ------------------------------- Rooms -------------------------------
async function createRoom() {
  if (!ME.name) return showScreen('screen-profile');
  if (!onlineAvailable || !spClient) return joinLocalGame();
  try {
    const seats = [publicPlayer(ME), null, null, null];
    const { data, error } = await spClient.from('rooms').insert({
      code: randomCode(), host_uid: ME.uid, seats, spectators: [],
      playing: false, scores: [0, 0, 0, 0], deal: 1, state: null,
    }).select().single();
    if (error) throw error;
    ROOM = data; ME_SEAT = 0; IS_SPECTATOR = false; usingLocalMode = false;
    localStorage.setItem('bt_room_resume', JSON.stringify({ roomId: data.id }));
    enterWaitingRoom(data.id);
  } catch (err) {
    console.error(err);
    toast('Could not create an online table. Starting a local game.');
    joinLocalGame();
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
  if (!onlineAvailable || !spClient) return joinLocalGame();
  try {
    const { data: room, error } = await spClient.from('rooms').select('*').eq('id', id).single();
    if (error || !room) throw error || new Error('not found');
    const seats = room.seats || [null, null, null, null];
    let mySeat = seats.findIndex((s) => s && s.uid === ME.uid);
    let spectator = false;
    let updated = room;

    if (mySeat === -1) {
      const empty = seats.findIndex((s) => !s);
      if (empty === -1 || room.playing) {
        spectator = true;
        const spectators = [...(room.spectators || []).filter((p) => p.uid !== ME.uid), publicPlayer(ME)];
        await spClient.from('rooms').update({ spectators }).eq('id', id);
        updated = { ...room, spectators };
      } else {
        seats[empty] = publicPlayer(ME);
        await spClient.from('rooms').update({ seats }).eq('id', id);
        updated = { ...room, seats };
        mySeat = empty;
      }
    }
    ROOM = updated; ME_SEAT = mySeat; IS_SPECTATOR = spectator; usingLocalMode = false;
    localStorage.setItem('bt_room_resume', JSON.stringify({ roomId: id }));
    if (ROOM.playing && ROOM.state) enterGame(id);
    else enterWaitingRoom(id);
  } catch (err) {
    console.error(err);
    toast('Could not join that room');
  }
}

function joinLocalGame() {
  if (!ME.name) return showScreen('screen-profile');
  closeRealtime();
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

function copyRoomCode() {
  const code = ROOM?.code;
  if (!code || code === 'LOCAL') return;
  navigator.clipboard?.writeText(code).then(() => {
    $('copy-hint').textContent = 'Copied!';
    setTimeout(() => { $('copy-hint').textContent = 'Tap the code to copy'; }, 1500);
  }).catch(() => toast(`Room code: ${code}`));
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
  $('btn-start').disabled = !isHost || filled < 2;
  $('waiting-hint').textContent = isHost
    ? (filled < 2 ? 'Need at least 2 players — add bots to fill the table.' : 'Ready when you are.')
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
  await updateRoom({ seats, playing: true, state });
  ROOM = { ...ROOM, seats, playing: true, state };
  enterGame(ROOM.id);
}

// --------------------------- Realtime sync ---------------------------
function subscribeToRoom(id, onChange) {
  if (!onlineAvailable || !spClient || usingLocalMode) return;
  closeRealtime();
  realtimeChannel = spClient.channel(`room-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${id}` }, (payload) => {
      if (payload.eventType === 'DELETE') { toast('Table closed'); leaveRoom(false); return; }
      ROOM = payload.new;
      GAME_STATE = ROOM?.state || null;
      const idx = (ROOM?.seats || []).findIndex((s) => s && s.uid === ME.uid);
      if (idx !== -1) { ME_SEAT = idx; IS_SPECTATOR = false; }
      onChange?.();
    })
    .subscribe();
}

function closeRealtime() {
  if (realtimeChannel && spClient) spClient.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

// Central mutation: update local state, persist online (or drive locally).
async function updateRoom(patch) {
  if (!ROOM) return;
  ROOM = { ...ROOM, ...patch };
  if (patch.state) GAME_STATE = patch.state;
  if (usingLocalMode) {
    if (ROOM.playing) renderGame(); else renderWaitingRoom();
    scheduleBotIfNeeded();
    scheduleRoundFinalizeIfNeeded();
    return;
  }
  if (!onlineAvailable || !spClient) return;
  try {
    const { error } = await spClient.from('rooms').update({ ...patch }).eq('id', ROOM.id);
    if (error) throw error;
  } catch (err) {
    console.error(err);
    toast('Sync failed — check your connection');
  }
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
  hand.querySelectorAll('[data-card]').forEach((el) => el.addEventListener('click', () => toggleCard(el.dataset.card)));
}

function cardHTML(card, cls = '', style = '', id = '') {
  const red = E.isRed(card) ? 'red-suit' : '';
  const data = id ? `data-card="${safeText(id)}"` : '';
  return `<div class="card ${red} ${cls}" ${data} style="${style}">
    <div class="rank">${safeText(card.r)}</div>
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
    return `<span class="score-chip ${me} ${leader}">${safeText(player.name)} <span class="sc-val">${scores[i] || 0}</span></span>`;
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
  showScoreModal(next);
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
      <td>${left}</td><td>+${penalties[i] || 0}</td><td>${scores[i] || 0}</td></tr>`;
  }).join('');

  $('modal-inner').innerHTML = `<div class="modal-title">${gameOver ? '🏆 GAME OVER' : 'ROUND OVER'}</div>
    <table class="score-table"><tr><th>Player</th><th>Cards</th><th>Penalty</th><th>Total</th></tr>${rows}</table>
    <div class="penalty-note"><strong>Scoring:</strong> 1–4 cards ×1 · 5–9 ×2 · 10–12 ×3 · 13 = 39. First to ${state.targetScore || E.TARGET_SCORE} loses.</div>
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
  const state = structuredClone ? structuredClone(GAME_STATE) : JSON.parse(JSON.stringify(GAME_STATE));
  state.phase = 'gameOver';
  state.scores = scores;
  state.penalties = [0, 0, 0, 0];
  state.winner = null;
  state.champion = scores.indexOf(Math.min(...(ROOM.seats || []).map((p, i) => (p ? scores[i] : Infinity))));
  state.loser = scores.indexOf(Math.max(...(ROOM.seats || []).map((p, i) => (p ? scores[i] : -Infinity))));
  await updateRoom({ state });
  showScoreModal(state);
}

async function leaveRoom(goLobby = true) {
  clearTimeout(botTimer);
  clearTimeout(roundTimer);
  closeRealtime();
  localStorage.removeItem('bt_room_resume');
  if (ROOM && !usingLocalMode && onlineAvailable && spClient) {
    try {
      const room = ROOM;
      const seats = [...(room.seats || [])];
      const idx = seats.findIndex((s) => s && s.uid === ME.uid);
      if (idx !== -1 && !room.playing) {
        seats[idx] = null;
        await spClient.from('rooms').update({ seats }).eq('id', room.id);
      } else {
        const spectators = (room.spectators || []).filter((p) => p.uid !== ME.uid);
        await spClient.from('rooms').update({ spectators }).eq('id', room.id);
      }
    } catch (err) { console.warn(err); }
  }
  ROOM = null; GAME_STATE = null; ME_SEAT = -1; IS_SPECTATOR = false; usingLocalMode = false;
  SELECTED.clear();
  $('modal').classList.remove('show');
  if (goLobby) initLobby();
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
  if (!GAME_STATE || GAME_STATE.phase !== 'playing' || GAME_STATE.current !== seat) return;
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
  const custom = JSON.parse(localStorage.getItem('bt_custom_comments') || '[]');
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
    const current = JSON.parse(localStorage.getItem('bt_custom_comments') || '[]');
    if (!current.includes(text)) current.push(text);
    localStorage.setItem('bt_custom_comments', JSON.stringify(current.slice(-24)));
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
  if (!ROOM || !GAME_STATE) return;
  const seat = ME_SEAT >= 0 ? ME_SEAT : 0;
  const event = {
    id: 'E' + Date.now() + Math.random().toString(36).slice(2, 6),
    at: Date.now(), seat, player: ROOM.seats?.[seat]?.name || ME.name, ...payload,
  };
  const state = structuredClone ? structuredClone(GAME_STATE) : JSON.parse(JSON.stringify(GAME_STATE));
  state.events = [...(state.events || []).filter((e) => Date.now() - e.at < 12000), event].slice(-30);
  await updateRoom({ state });
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
      <li><strong>Losing:</strong> when someone reaches ${E.TARGET_SCORE} points the game ends — lowest total wins.</li>
    </ul>
    <button class="btn btn-gold" id="modal-close">Got it</button>`;
  $('modal').classList.add('show');
  $('modal-close').addEventListener('click', () => $('modal').classList.remove('show'));
}

// Re-open the score modal if a remote client advanced the round while we were idle.
setInterval(() => {
  if (!GAME_STATE || !ROOM || $('modal').classList.contains('show')) return;
  if (GAME_STATE.phase === 'roundOver' || GAME_STATE.phase === 'gameOver') showScoreModal(GAME_STATE);
}, 900);
