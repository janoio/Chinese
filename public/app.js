/* Big Two — GitHub Pages ready build
   Fixes: mobile top bar, card drop animation, last-card display delay,
   optional selfie/profile picture, comments, stickers/emotes. */

const SUPABASE_URL = 'https://nrzhizemptyqdukulepk.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yemhpemVtcHR5cWR1a3VsZXBrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3MzcwMTAsImV4cCI6MjA5ODMxMzAxMH0.yhZshfDfblDz5ycil8VxJENBX3jqWHg99FrxQ8LVnIY';

const TARGET_SCORE = 101;
const SUITS = ['D', 'C', 'H', 'S'];
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const SUIT_SYMBOL = { D: '♦', C: '♣', H: '♥', S: '♠' };
const RANK_VALUE = Object.fromEntries(RANKS.map((rank, index) => [rank, index]));
const QUICK_COMMENTS_DEFAULT = ['omak wen', 'nice', 'bzez', 'gel', 'epique', 'thin', 'kezzzeb', 'btentek', 'pegasus'];
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

let spClient = null;
let onlineAvailable = false;
let realtimeChannel = null;
let lobbyInterval = null;
let roomWatchId = null;
let botTimer = null;
let roundTimer = null;
let lastRenderedPlayId = null;
let renderedEventIds = new Set();
let usingLocalMode = false;

let ME = { uid: '', name: '', avatar: '🃏', avatarImg: '' };
let ROOM = null;
let GAME_STATE = null;
let ME_SEAT = -1;
let IS_SPECTATOR = false;
let SELECTED = new Set();
let selectedProfileImage = '';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const uid = () => 'U' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const randomCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const cardValue = (card) => RANK_VALUE[card.r] * 4 + SUITS.indexOf(card.s);
const isRed = (card) => card.s === 'D' || card.s === 'H';
const has3D = (cards) => cards.some((card) => card.r === '3' && card.s === 'D');
const safeText = (value) => String(value ?? '').replace(/[&<>'"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[m]));
const activeSeatCount = () => (ROOM?.seats || []).filter(Boolean).length;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.add('hidden'));
  $('game-screen').classList.add('hidden');
  const screen = $(id);
  if (screen) screen.classList.remove('hidden');
}

function showGameScreen() {
  document.querySelectorAll('.screen').forEach((screen) => screen.classList.add('hidden'));
  $('game-screen').classList.remove('hidden');
}

let toastTimer;
function toast(message, ms = 2100) {
  const el = $('toast');
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
}

function setConnStatus(status) {
  const dot = $('conn-dot');
  const label = $('conn-label');
  if (!dot || !label) return;
  dot.className = `conn-dot ${status}`;
  label.textContent = status === 'connected' ? 'Online' : status === 'connecting' ? 'Connecting…' : 'Offline';
}

function initSupabase() {
  try {
    if (!window.supabase || !SUPABASE_URL || SUPABASE_URL.includes('YOUR_')) throw new Error('not configured');
    spClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    onlineAvailable = true;
  } catch (err) {
    console.warn('Supabase unavailable, local bot mode only:', err);
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
  const remembered = JSON.parse(localStorage.getItem('bt_room_resume') || '{}');
  if (saved.name) {
    ME = { ...ME, name: saved.name, avatar: saved.avatar || '🃏', avatarImg: saved.avatarImg || '' };
    selectedProfileImage = ME.avatarImg || '';
    $('inp-name').value = ME.name;
    $('inp-avatar').value = ME.avatar;
    updateProfilePreview();
    initLobby();
    if (remembered.roomId && onlineAvailable) {
      // Do not auto-rejoin silently; just keep lobby clean.
    }
  } else {
    updateProfilePreview();
    showScreen('screen-profile');
  }
}

function bindUI() {
  $('btn-save-profile').addEventListener('click', saveProfile);
  $('btn-pick-photo').addEventListener('click', () => $('file-avatar').click());
  $('btn-take-selfie').addEventListener('click', () => $('file-selfie').click());
  $('file-avatar').addEventListener('change', handleProfileFile);
  $('file-selfie').addEventListener('change', handleProfileFile);
  $('inp-avatar').addEventListener('input', () => updateProfilePreview());

  $('btn-create-room').addEventListener('click', createRoom);
  $('btn-join-code').addEventListener('click', joinByCode);
  $('btn-local').addEventListener('click', joinLocalGame);
  $('btn-change-profile').addEventListener('click', () => showScreen('screen-profile'));
  $('inp-room-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinByCode(); });

  $('btn-start').addEventListener('click', startGameAsHost);
  $('btn-add-bot-waiting').addEventListener('click', addBotToRoom);
  $('btn-leave-waiting').addEventListener('click', leaveRoom);
  $('btn-new-table').addEventListener('click', createRoom);
  $('btn-leave-game').addEventListener('click', leaveRoom);
  $('btn-end-game').addEventListener('click', endGameNow);
  $('btn-add-bot').addEventListener('click', addBotToRoom);

  $('playBtn').addEventListener('click', () => handlePlay('normal'));
  $('smashBtn').addEventListener('click', () => handlePlay('smash'));
  $('passBtn').addEventListener('click', handlePass);
  $('commentBtn').addEventListener('click', openCommentSheet);
  $('emoteBtn').addEventListener('click', openStickerSheet);
  $('sheet-backdrop').addEventListener('click', closeSheets);
  $('btn-send-custom').addEventListener('click', () => sendCustomComment(false));
  $('btn-save-comment').addEventListener('click', () => sendCustomComment(true));
  $('custom-comment').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendCustomComment(false); });

  renderCommentSheet();
  renderStickerSheet();
}

async function handleProfileFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    selectedProfileImage = await compressImage(file, 128, 0.78);
    updateProfilePreview();
  } catch (err) {
    console.error(err);
    toast('Could not read picture');
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
        canvas.width = size;
        canvas.height = size;
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
  const image = selectedProfileImage || ME.avatarImg;
  preview.innerHTML = image ? `<img alt="profile" src="${image}">` : safeText(emoji);
}

function saveProfile() {
  const name = $('inp-name').value.trim() || ME.name;
  const avatar = $('inp-avatar').value.trim() || ME.avatar || '🃏';
  if (!name) return toast('Enter a name');
  ME = { ...ME, name, avatar, avatarImg: selectedProfileImage || ME.avatarImg || '' };
  localStorage.setItem('bt_profile', JSON.stringify({ name: ME.name, avatar: ME.avatar, avatarImg: ME.avatarImg }));
  initLobby();
}

function playerHTML(player, cls = '') {
  if (!player) return `<div class="seat-avatar">?</div>`;
  const img = player.avatarImg ? `<img src="${player.avatarImg}" alt="avatar">` : safeText(player.avatar || '🃏');
  return `<div class="seat-avatar ${cls}">${img}</div>`;
}

function initLobby() {
  $('lobby-greeting').innerHTML = `${ME.avatarImg ? `<span class="inline-pic"><img src="${ME.avatarImg}" alt=""></span>` : safeText(ME.avatar)} ${safeText(ME.name)}`;
  showScreen('screen-lobby');
  closeRealtime();
  usingLocalMode = false;
  setConnStatus(onlineAvailable ? 'connecting' : 'disconnected');
  if (lobbyInterval) clearInterval(lobbyInterval);
  if (onlineAvailable) {
    loadRooms();
    lobbyInterval = setInterval(loadRooms, 5000);
    setConnStatus('connected');
  } else {
    renderLocalLobby();
  }
}

async function loadRooms() {
  if (!onlineAvailable || !spClient) return renderLocalLobby();
  try {
    const { data, error } = await spClient
      .from('rooms')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20);
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
  $('room-list').innerHTML = `<div class="room-item" data-local="1">
    <div><div class="room-name">LOCAL TABLE</div><div class="room-meta">You vs 3 bots · works without internet database</div></div>
    <span class="room-badge badge-open">OPEN</span>
  </div>`;
  $('room-list').querySelector('[data-local]').addEventListener('click', joinLocalGame);
}

function renderRoomList(rooms) {
  const list = $('room-list');
  if (!rooms.length) {
    list.innerHTML = '<div class="loading-text">No live table yet. Create one.</div>';
    return;
  }
  list.innerHTML = rooms.map((room) => {
    const seats = room.seats || [null, null, null, null];
    const count = seats.filter(Boolean).length;
    const badge = room.playing ? '<span class="room-badge badge-playing">PLAYING</span>' :
      count >= 4 ? '<span class="room-badge badge-full">FULL</span>' : '<span class="room-badge badge-open">OPEN</span>';
    const avatars = seats.filter(Boolean).map((p) => p.avatarImg ? '📷' : safeText(p.avatar || '🃏')).join(' ');
    return `<div class="room-item" data-room="${room.id}">
      <div><div class="room-name">${safeText(room.code || 'TABLE')} ${avatars}</div><div class="room-meta">${count}/4 players · deal ${room.deal || 1}</div></div>${badge}
    </div>`;
  }).join('');
  list.querySelectorAll('[data-room]').forEach((el) => el.addEventListener('click', () => joinRoom(el.dataset.room)));
}

async function createRoom() {
  if (!ME.name) return showScreen('screen-profile');
  if (!onlineAvailable || !spClient) return joinLocalGame();
  try {
    const seats = [null, null, null, null];
    seats[0] = publicPlayer(ME);
    const { data, error } = await spClient.from('rooms').insert({
      code: randomCode(),
      host_uid: ME.uid,
      seats,
      spectators: [],
      playing: false,
      scores: [0, 0, 0, 0],
      deal: 1,
      state: null,
    }).select().single();
    if (error) throw error;
    usingLocalMode = false;
    ROOM = data;
    ME_SEAT = 0;
    IS_SPECTATOR = false;
    localStorage.setItem('bt_room_resume', JSON.stringify({ roomId: data.id }));
    enterWaitingRoom(data.id);
  } catch (err) {
    console.error(err);
    toast('Could not create online room. Starting local table.');
    joinLocalGame();
  }
}

function publicPlayer(player) {
  return { uid: player.uid, name: player.name, avatar: player.avatar || '🃏', avatarImg: player.avatarImg || '' };
}

function joinByCode() {
  const code = $('inp-room-code').value.trim().toUpperCase();
  if (!code || code.length !== 6) return toast('Enter the 6 character room code');
  if (!onlineAvailable || !spClient) return toast('Online database is not connected');
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
    let mySeat = seats.findIndex((seat) => seat && seat.uid === ME.uid);
    let spectator = false;
    let updatedRoom = room;

    if (mySeat === -1) {
      const emptyIndex = seats.findIndex((seat) => !seat);
      if (emptyIndex === -1 || room.playing) {
        spectator = true;
        const spectators = [...(room.spectators || []).filter((p) => p.uid !== ME.uid), publicPlayer(ME)];
        await spClient.from('rooms').update({ spectators }).eq('id', id);
        updatedRoom = { ...room, spectators };
      } else {
        seats[emptyIndex] = publicPlayer(ME);
        await spClient.from('rooms').update({ seats }).eq('id', id);
        updatedRoom = { ...room, seats };
        mySeat = emptyIndex;
      }
    }
    ROOM = updatedRoom;
    ME_SEAT = mySeat;
    IS_SPECTATOR = spectator;
    usingLocalMode = false;
    localStorage.setItem('bt_room_resume', JSON.stringify({ roomId: id }));
    if (ROOM.playing && ROOM.state) enterGame(id);
    else enterWaitingRoom(id);
  } catch (err) {
    console.error(err);
    toast('Could not join room');
  }
}

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
  $('seat-grid').innerHTML = seats.map((seat, index) => {
    const isMe = seat && seat.uid === ME.uid;
    return `<div class="seat ${seat ? 'filled' : ''} ${isMe ? 'me' : ''}">
      ${seat ? `${playerHTML(seat)}<div class="seat-name">${safeText(seat.name)}${seat.isBot ? ' 🤖' : ''}${isMe ? ' (YOU)' : ''}</div>` : '<div class="seat-empty">Empty seat</div>'}
    </div>`;
  }).join('');
  const specs = ROOM.spectators || [];
  $('waiting-spectators').textContent = specs.length ? `👁 Spectating: ${specs.map((p) => p.name).join(', ')}` : '';
  const isHost = isRoomHost();
  const filled = seats.filter(Boolean).length;
  $('btn-start').style.display = isHost ? 'block' : 'none';
  $('btn-add-bot-waiting').style.display = isHost && filled < 4 ? 'block' : 'none';
  $('btn-start').disabled = !isHost || filled < 2;
  $('waiting-hint').textContent = isHost ? (filled < 2 ? 'Need at least 2 players. You can add bots.' : 'Ready to start.') : 'Waiting for host to start.';
}

function joinLocalGame() {
  if (!ME.name) return showScreen('screen-profile');
  closeRealtime();
  usingLocalMode = true;
  IS_SPECTATOR = false;
  ME_SEAT = 0;
  ROOM = {
    id: 'local',
    code: 'LOCAL',
    host_uid: ME.uid,
    seats: [publicPlayer(ME), botPlayer('Alex'), botPlayer('Jordan'), botPlayer('Sam')],
    spectators: [],
    playing: false,
    scores: [0, 0, 0, 0],
    deal: 1,
    state: null,
  };
  enterWaitingRoom('local');
}

function botPlayer(name) {
  return { uid: `BOT_${name}_${Math.random().toString(36).slice(2, 6)}`, name, avatar: '🤖', avatarImg: '', isBot: true };
}

async function addBotToRoom() {
  if (!ROOM || !isRoomHost()) return toast('Only host can add bot');
  const seats = [...(ROOM.seats || [null, null, null, null])];
  const empty = seats.findIndex((seat) => !seat);
  if (empty === -1) return toast('Table is full');
  const names = ['Alex', 'Jordan', 'Sam', 'Rami', 'Nour', 'Kevin'];
  seats[empty] = botPlayer(names[Math.floor(Math.random() * names.length)]);
  await updateRoom({ seats });
}

function isRoomHost() {
  return usingLocalMode || ROOM?.host_uid === ME.uid;
}

async function startGameAsHost() {
  if (!ROOM || !isRoomHost()) return;
  let seats = [...(ROOM.seats || [])];
  while (seats.filter(Boolean).length < 4) {
    const empty = seats.findIndex((seat) => !seat);
    if (empty === -1) break;
    seats[empty] = botPlayer(['Alex', 'Jordan', 'Sam', 'Rami'][empty] || 'Bot');
  }
  const state = dealNewRound(seats, ROOM.scores || [0, 0, 0, 0], ROOM.deal || 1, null);
  await updateRoom({ seats, playing: true, state });
  ROOM = { ...ROOM, seats, playing: true, state };
  enterGame(ROOM.id);
}

function dealNewRound(seats, scores, dealNo, starterOverride) {
  const deck = makeDeck();
  shuffle(deck);
  const hands = [[], [], [], []];
  for (let i = 0; i < deck.length; i++) hands[i % 4].push(deck[i]);
  hands.forEach(sortCards);

  let current = Number.isInteger(starterOverride) ? starterOverride : 0;
  if (!Number.isInteger(starterOverride)) {
    current = hands.findIndex((hand) => hand.some((card) => card.r === '3' && card.s === 'D'));
    if (current < 0) current = firstOccupiedSeat(seats);
  }

  return {
    version: 2,
    phase: 'playing',
    targetScore: TARGET_SCORE,
    deal: dealNo,
    scores,
    hands,
    current,
    starter: current,
    lastPlay: null,
    passes: [false, false, false, false],
    winner: null,
    champion: null,
    loser: null,
    events: [],
    message: 'No active hand. Choose a single, pair, triplet, or a 5-card poker hand.',
    createdAt: Date.now(),
  };
}

function makeDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push({ r, s, id: `${r}${s}` });
  return deck;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function sortCards(cards) {
  cards.sort((a, b) => cardValue(a) - cardValue(b));
  return cards;
}

function firstOccupiedSeat(seats) {
  const index = seats.findIndex(Boolean);
  return index === -1 ? 0 : index;
}

function subscribeToRoom(id, onChange) {
  if (!onlineAvailable || !spClient || usingLocalMode) return;
  closeRealtime();
  realtimeChannel = spClient
    .channel(`room-${id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${id}` }, (payload) => {
      if (payload.eventType === 'DELETE') {
        toast('Table ended');
        leaveRoom(false);
        return;
      }
      ROOM = payload.new;
      GAME_STATE = ROOM?.state || null;
      const seats = ROOM?.seats || [];
      const idx = seats.findIndex((seat) => seat && seat.uid === ME.uid);
      if (idx !== -1) { ME_SEAT = idx; IS_SPECTATOR = false; }
      onChange?.();
    })
    .subscribe();
}

function closeRealtime() {
  if (realtimeChannel && spClient) spClient.removeChannel(realtimeChannel);
  realtimeChannel = null;
  if (roomWatchId) clearInterval(roomWatchId);
  roomWatchId = null;
}

async function updateRoom(patch) {
  if (!ROOM) return;
  ROOM = { ...ROOM, ...patch };
  if (patch.state) GAME_STATE = patch.state;
  if (usingLocalMode) {
    if (ROOM.playing) renderGame();
    else renderWaitingRoom();
    scheduleBotIfNeeded();
    scheduleRoundFinalizeIfNeeded();
    return;
  }
  if (!onlineAvailable || !spClient) return;
  const cleanPatch = { ...patch };
  try {
    const { error } = await spClient.from('rooms').update(cleanPatch).eq('id', ROOM.id);
    if (error) throw error;
  } catch (err) {
    console.error(err);
    toast('Connection update failed');
  }
}

function enterGame(id) {
  if (!ROOM) return;
  GAME_STATE = ROOM.state;
  SELECTED.clear();
  showGameScreen();
  if (!usingLocalMode) {
    subscribeToRoom(id, () => {
      if (ROOM?.playing && ROOM.state) {
        GAME_STATE = ROOM.state;
        renderGame();
      } else {
        enterWaitingRoom(id);
      }
    });
  }
  renderGame();
}

function renderGame() {
  if (!ROOM || !GAME_STATE) return;
  const state = GAME_STATE;
  const seats = ROOM.seats || [];
  $('table-name').textContent = ROOM.code ? `Table ${ROOM.code}` : 'Table';
  $('table-subtitle').textContent = `Seat ${ME_SEAT + 1 || 'spectator'} · ${state.phase || 'playing'} · target score ${state.targetScore || TARGET_SCORE}`;
  $('btn-add-bot').disabled = !isRoomHost() || seats.filter(Boolean).length >= 4 || state.phase === 'playing';
  $('btn-end-game').textContent = state.phase === 'gameOver' ? 'End game 1/1' : 'End game 0/1';

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

function seatToSlot(seatIndex) {
  if (ME_SEAT < 0 || IS_SPECTATOR) return ['bottom', 'left', 'top', 'right'][seatIndex] || 'bottom';
  const diff = (seatIndex - ME_SEAT + 4) % 4;
  return ['bottom', 'left', 'top', 'right'][diff];
}

function slotPosition(slot) {
  const rect = $('game-table').getBoundingClientRect();
  const points = {
    bottom: { x: rect.width / 2, y: rect.height - 36 },
    top: { x: rect.width / 2, y: 88 },
    left: { x: 54, y: rect.height / 2 },
    right: { x: rect.width - 54, y: rect.height / 2 },
    center: { x: rect.width / 2, y: rect.height / 2 },
  };
  return points[slot] || points.center;
}

function renderSeats() {
  const state = GAME_STATE;
  const seats = ROOM.seats || [];
  ['top', 'left', 'right', 'bottom'].forEach((slot) => { $(`slot-${slot}`).innerHTML = ''; });
  seats.forEach((player, seatIndex) => {
    const slot = seatToSlot(seatIndex);
    const el = $(`slot-${slot}`);
    const active = state.current === seatIndex && state.phase === 'playing';
    const me = seatIndex === ME_SEAT && !IS_SPECTATOR;
    if (!player) {
      el.innerHTML = `<div class="avatar-frame">?</div><div class="empty-seat-label">Empty seat</div>`;
      return;
    }
    const count = (state.hands?.[seatIndex] || []).length;
    const miniCards = slot === 'bottom' ? '' : `<div class="mini-hand">${Array.from({ length: Math.min(count, 7) }).map(() => '<span class="mini-card"></span>').join('')}</div>`;
    el.innerHTML = `<div class="avatar-frame ${active ? 'active' : ''}">
      ${player.avatarImg ? `<img src="${player.avatarImg}" alt="avatar">` : safeText(player.avatar || '🃏')}
      <span class="card-count">${count}</span>
    </div>
    <div class="player-name-tag ${me ? 'me' : ''} ${active ? 'active' : ''}">${safeText(player.name)}${player.isBot ? ' 🤖' : ''}</div>${miniCards}`;
  });
}

function renderCenter() {
  const state = GAME_STATE;
  const last = state.lastPlay;
  const played = $('played-cards');
  const message = $('center-message');
  const lastBy = $('last-played-by');

  if (last && last.cards?.length) {
    const player = ROOM.seats?.[last.seat];
    lastBy.textContent = `${player?.name || 'Player'} played ${comboLabel(last.combo)}`;
    const isNewPlay = last.id !== lastRenderedPlayId;
    if (isNewPlay) lastRenderedPlayId = last.id;
    const slot = seatToSlot(last.seat);
    const shift = dropShift(slot);
    played.innerHTML = last.cards.map((card, i) => {
      const n = last.cards.length;
      const rot = n === 1 ? 0 : (i - (n - 1) / 2) * 8;
      return cardHTML(card, `table-card ${isNewPlay ? 'drop' : ''}`, `--i:${i};--rot:${rot}deg;--sx:${shift.x}px;--sy:${shift.y}px;`);
    }).join('');
    message.textContent = state.phase === 'roundOverPending' ? 'Last card played. Calculating score…' : '';
  } else {
    lastBy.textContent = '';
    played.innerHTML = '';
    message.textContent = state.message || 'No active hand. Choose a single, pair, triplet, or a 5-card poker hand.';
  }

  if (state.phase === 'roundOverPending') {
    message.textContent = 'Last card played. Round result coming…';
  } else if (state.phase === 'roundOver') {
    message.textContent = 'Round over.';
  } else if (state.phase === 'gameOver') {
    message.textContent = 'Game over.';
  }
  $('turn-label').textContent = state.phase === 'playing' ? turnText() : state.phase.replace(/([A-Z])/g, ' $1');
}

function dropShift(slot) {
  const shifts = {
    bottom: { x: 0, y: 155 },
    top: { x: 0, y: -130 },
    left: { x: -170, y: 0 },
    right: { x: 170, y: 0 },
  };
  return shifts[slot] || { x: 0, y: 0 };
}

function turnText() {
  const player = ROOM.seats?.[GAME_STATE.current];
  if (!player) return 'Waiting';
  if (GAME_STATE.current === ME_SEAT) return 'Your turn';
  return `${player.name}'s turn`;
}

function renderHand() {
  const hand = $('hand');
  const myHand = GAME_STATE.hands?.[ME_SEAT] || [];
  if (IS_SPECTATOR || ME_SEAT < 0) {
    hand.innerHTML = '<div class="hint-text">Spectating this table.</div>';
    return;
  }
  hand.innerHTML = myHand.map((card) => {
    const selected = SELECTED.has(card.id);
    const disabled = GAME_STATE.current !== ME_SEAT || GAME_STATE.phase !== 'playing';
    return cardHTML(card, `hand-card ${selected ? 'selected' : ''} ${disabled ? 'disabled' : ''}`, '', card.id);
  }).join('');
  hand.querySelectorAll('[data-card]').forEach((el) => {
    el.addEventListener('click', () => toggleCard(el.dataset.card));
  });
}

function cardHTML(card, cls = '', style = '', id = '') {
  const red = isRed(card) ? 'red-suit' : '';
  const data = id ? `data-card="${id}"` : '';
  return `<div class="card ${red} ${cls}" ${data} style="${style}">
    <div class="rank">${safeText(card.r)}</div>
    <div class="suit">${SUIT_SYMBOL[card.s]}</div>
    <div class="tiny">${SUIT_SYMBOL[card.s]}</div>
  </div>`;
}

function toggleCard(cardId) {
  if (GAME_STATE.current !== ME_SEAT || GAME_STATE.phase !== 'playing') return;
  if (SELECTED.has(cardId)) SELECTED.delete(cardId);
  else SELECTED.add(cardId);
  renderHand();
  renderActions();
}

function getSelectedCards() {
  const hand = GAME_STATE.hands?.[ME_SEAT] || [];
  return hand.filter((card) => SELECTED.has(card.id));
}

function renderActions() {
  const myTurn = GAME_STATE.current === ME_SEAT && GAME_STATE.phase === 'playing' && !IS_SPECTATOR;
  const selected = getSelectedCards();
  const combo = analyzeCombo(selected);
  const normalOk = myTurn && selected.length > 0 && canPlaySelected(selected, combo, false).ok;
  const smashOk = myTurn && selected.length === 5 && combo && canPlaySelected(selected, combo, true).ok;
  const canPass = myTurn && !!GAME_STATE.lastPlay && GAME_STATE.lastPlay.seat !== ME_SEAT;

  $('playBtn').disabled = !normalOk;
  $('smashBtn').disabled = !smashOk;
  $('passBtn').disabled = !canPass;
  $('commentBtn').disabled = IS_SPECTATOR && ME_SEAT < 0;
  $('emoteBtn').disabled = IS_SPECTATOR && ME_SEAT < 0;

  const hint = $('hint-text');
  if (!myTurn) hint.textContent = GAME_STATE.phase === 'playing' ? 'Wait for your turn. Cards are sorted from 3 up to 2.' : 'Round paused.';
  else if (!selected.length) hint.textContent = GAME_STATE.lastPlay ? `Beat ${comboLabel(GAME_STATE.lastPlay.combo)} or pass.` : 'Choose cards to lead.';
  else if (!combo) hint.textContent = 'Invalid hand. Use single, pair, triplet, or valid 5-card poker hand.';
  else {
    const verdict = canPlaySelected(selected, combo, false);
    hint.textContent = verdict.ok ? `${comboLabel(combo)} selected.` : verdict.reason;
  }
}

function renderScores() {
  const scores = GAME_STATE.scores || ROOM.scores || [0, 0, 0, 0];
  $('score-strip').innerHTML = (ROOM.seats || []).filter(Boolean).map((player, index) => {
    const me = index === ME_SEAT ? 'me' : '';
    return `<span class="score-chip ${me}">${safeText(player.name)}: ${scores[index] || 0}</span>`;
  }).join('');
}

function analyzeCombo(cards) {
  if (!cards || !cards.length) return null;
  const sorted = sortCards([...cards]);
  const n = sorted.length;
  if (n === 1) return { type: 'single', size: 1, main: cardValue(sorted[0]), rank: RANK_VALUE[sorted[0].r], power: cardValue(sorted[0]) };
  const rankCounts = countsByRank(sorted);
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  const ranks = Object.keys(rankCounts).map((rank) => RANK_VALUE[rank]).sort((a, b) => a - b);

  if (n === 2 && counts[0] === 2) {
    return { type: 'pair', size: 2, main: Math.max(...sorted.map(cardValue)), rank: ranks[0], power: 100 + ranks[0] * 4 + highSuitIndex(sorted) };
  }
  if (n === 3 && counts[0] === 3) {
    return { type: 'triplet', size: 3, main: Math.max(...sorted.map(cardValue)), rank: ranks[0], power: 200 + ranks[0] * 4 + highSuitIndex(sorted) };
  }
  if (n !== 5) return null;

  const flush = sorted.every((card) => card.s === sorted[0].s);
  const straight = isStraight(ranks);
  const groups = Object.entries(rankCounts).map(([rank, count]) => ({ rank, rv: RANK_VALUE[rank], count })).sort((a, b) => b.count - a.count || b.rv - a.rv);

  if (straight && flush) return { type: 'straightFlush', size: 5, main: straightHigh(ranks, sorted), rank: straightHighRank(ranks), power: 800 + straightHigh(ranks, sorted) };
  if (counts[0] === 4) return { type: 'fourKind', size: 5, main: groups[0].rv, rank: groups[0].rv, power: 700 + groups[0].rv * 4 + highSuitOfRank(sorted, groups[0].rank) };
  if (counts[0] === 3 && counts[1] === 2) return { type: 'fullHouse', size: 5, main: groups[0].rv, rank: groups[0].rv, power: 600 + groups[0].rv * 4 + highSuitOfRank(sorted, groups[0].rank) };
  if (flush) return { type: 'flush', size: 5, main: Math.max(...sorted.map(cardValue)), rank: Math.max(...ranks), power: 500 + Math.max(...sorted.map(cardValue)) };
  if (straight) return { type: 'straight', size: 5, main: straightHigh(ranks, sorted), rank: straightHighRank(ranks), power: 400 + straightHigh(ranks, sorted) };
  return null;
}

function countsByRank(cards) {
  return cards.reduce((acc, card) => { acc[card.r] = (acc[card.r] || 0) + 1; return acc; }, {});
}

function highSuitIndex(cards) {
  return Math.max(...cards.map((card) => SUITS.indexOf(card.s)));
}

function highSuitOfRank(cards, rank) {
  return Math.max(...cards.filter((card) => card.r === rank).map((card) => SUITS.indexOf(card.s)));
}

function isStraight(ranks) {
  const unique = [...new Set(ranks)].sort((a, b) => a - b);
  if (unique.length !== 5) return false;
  if (unique.includes(RANK_VALUE['2'])) return false; // Keep 2 out of straights for simpler Big Two rules.
  for (let i = 1; i < unique.length; i++) if (unique[i] !== unique[i - 1] + 1) return false;
  return true;
}

function straightHighRank(ranks) {
  return Math.max(...ranks.filter((v) => v !== RANK_VALUE['2']));
}

function straightHigh(ranks, cards) {
  const highRank = straightHighRank(ranks);
  const highCards = cards.filter((card) => RANK_VALUE[card.r] === highRank);
  return highRank * 4 + highSuitIndex(highCards);
}

function comboLabel(combo) {
  if (!combo) return 'hand';
  const labels = {
    single: 'single', pair: 'pair', triplet: 'triplet', straight: 'straight', flush: 'flush',
    fullHouse: 'full house', fourKind: 'four of a kind', straightFlush: 'straight flush',
  };
  return labels[combo.type] || combo.type;
}

function canPlaySelected(cards, combo, smash) {
  if (!combo) return { ok: false, reason: 'Invalid hand.' };
  if (smash && combo.size !== 5) return { ok: false, reason: 'Smash hand needs a valid 5-card hand.' };
  const state = GAME_STATE;
  const firstTurn = !state.lastPlay && state.deal === 1 && state.current === state.starter;
  if (firstTurn && !has3D(cards)) return { ok: false, reason: 'First play must include 3♦.' };
  if (!state.lastPlay) return { ok: true };
  if (state.lastPlay.seat === ME_SEAT) return { ok: true };
  if (combo.size !== state.lastPlay.combo.size) return { ok: false, reason: `You must play ${state.lastPlay.combo.size} card(s) or pass.` };
  if (beats(combo, state.lastPlay.combo)) return { ok: true };
  return { ok: false, reason: 'This hand is not strong enough.' };
}

function beats(combo, lastCombo) {
  if (!combo || !lastCombo) return false;
  if (combo.size !== lastCombo.size) return false;
  if (combo.size === 5) return combo.power > lastCombo.power;
  return combo.power > lastCombo.power;
}

async function handlePlay(mode = 'normal') {
  if (!GAME_STATE || GAME_STATE.current !== ME_SEAT || GAME_STATE.phase !== 'playing') return;
  const cards = getSelectedCards();
  const combo = analyzeCombo(cards);
  const verdict = canPlaySelected(cards, combo, mode === 'smash');
  if (!verdict.ok) return toast(verdict.reason);
  await applyPlay(ME_SEAT, cards, combo, mode);
}

async function applyPlay(seat, cards, combo, mode = 'normal') {
  const state = structuredCloneGameState(GAME_STATE);
  const ids = new Set(cards.map((card) => card.id));
  state.hands[seat] = state.hands[seat].filter((card) => !ids.has(card.id));
  state.lastPlay = { id: 'P' + Date.now() + Math.random().toString(36).slice(2, 6), seat, cards: sortCards([...cards]), combo, mode };
  state.passes = [false, false, false, false];
  state.message = '';
  SELECTED.clear();

  if (state.hands[seat].length === 0) {
    state.phase = 'roundOverPending';
    state.winner = seat;
    state.roundOverAt = Date.now() + 1050;
  } else {
    state.current = nextActiveSeat(seat, state);
  }
  await updateRoom({ state });
}

function structuredCloneGameState(state) {
  return typeof structuredClone === 'function' ? structuredClone(state) : JSON.parse(JSON.stringify(state));
}

async function handlePass() {
  if (!GAME_STATE || GAME_STATE.current !== ME_SEAT || GAME_STATE.phase !== 'playing') return;
  if (!GAME_STATE.lastPlay || GAME_STATE.lastPlay.seat === ME_SEAT) return toast('You cannot pass now');
  await applyPass(ME_SEAT);
}

async function applyPass(seat) {
  const state = structuredCloneGameState(GAME_STATE);
  state.passes[seat] = true;
  const lastSeat = state.lastPlay?.seat;
  const activeSeats = (ROOM.seats || []).map((p, i) => p && state.hands[i]?.length > 0 ? i : -1).filter((i) => i >= 0);
  const passedOthers = activeSeats.filter((i) => i !== lastSeat).every((i) => state.passes[i]);
  if (passedOthers && Number.isInteger(lastSeat)) {
    state.current = lastSeat;
    state.lastPlay = null;
    state.passes = [false, false, false, false];
    state.message = `${ROOM.seats[lastSeat]?.name || 'Player'} controls the table. Free play.`;
  } else {
    state.current = nextActiveSeat(seat, state);
    state.message = `${ROOM.seats[seat]?.name || 'Player'} passed.`;
  }
  await updateRoom({ state });
}

function nextActiveSeat(fromSeat, state = GAME_STATE) {
  for (let step = 1; step <= 4; step++) {
    const idx = (fromSeat + step) % 4;
    if (ROOM.seats?.[idx] && state.hands?.[idx]?.length > 0) return idx;
  }
  return fromSeat;
}

function scheduleRoundFinalizeIfNeeded() {
  clearTimeout(roundTimer);
  if (!GAME_STATE || GAME_STATE.phase !== 'roundOverPending') return;
  const wait = Math.max(120, (GAME_STATE.roundOverAt || Date.now() + 1000) - Date.now());
  roundTimer = setTimeout(() => {
    if (isRoomHost() && GAME_STATE?.phase === 'roundOverPending') finalizeRound();
  }, wait);
}

async function finalizeRound() {
  if (!GAME_STATE || GAME_STATE.phase !== 'roundOverPending') return;
  const state = structuredCloneGameState(GAME_STATE);
  const winner = state.winner;
  const penalties = [0, 0, 0, 0];
  const scores = [...(state.scores || ROOM.scores || [0, 0, 0, 0])];

  state.hands.forEach((hand, index) => {
    if (index === winner || !ROOM.seats?.[index]) return;
    const n = hand.length;
    const penalty = n === 13 ? 39 : n >= 10 ? n * 3 : n >= 5 ? n * 2 : n;
    penalties[index] = penalty;
    scores[index] = (scores[index] || 0) + penalty;
  });

  state.scores = scores;
  state.penalties = penalties;
  state.phase = scores.some((score) => score >= (state.targetScore || TARGET_SCORE)) ? 'gameOver' : 'roundOver';
  state.loser = scores.indexOf(Math.max(...scores));
  state.champion = scores.indexOf(Math.min(...scores));
  state.nextStarter = winner;
  await updateRoom({ state, scores });
  showScoreModal(state);
}

function showScoreModal(state) {
  const scores = state.scores || [0, 0, 0, 0];
  const penalties = state.penalties || [0, 0, 0, 0];
  const rows = (ROOM.seats || []).map((player, index) => {
    if (!player) return '';
    const cls = index === state.winner ? 'winner-row' : index === state.loser && state.phase === 'gameOver' ? 'loser-row' : '';
    const left = state.hands?.[index]?.length || 0;
    return `<tr class="${cls}">
      <td>${player.avatarImg ? '📷' : safeText(player.avatar || '')} ${safeText(player.name)}${index === state.winner ? ' 👑' : ''}</td>
      <td>${left}</td><td>+${penalties[index] || 0}</td><td>${scores[index] || 0}</td>
    </tr>`;
  }).join('');
  const gameOver = state.phase === 'gameOver';
  $('modal-inner').innerHTML = `<div class="modal-title">${gameOver ? '🏆 GAME OVER' : 'ROUND OVER'}</div>
    <table class="score-table"><tr><th>PLAYER</th><th>CARDS</th><th>PENALTY</th><th>TOTAL</th></tr>${rows}</table>
    <div class="penalty-note"><strong>Scoring:</strong> 1–4 cards ×1 · 5–9 cards ×2 · 10–12 cards ×3 · 13 cards = 39. Target score ${state.targetScore || TARGET_SCORE}.</div>
    ${gameOver ? `<div class="penalty-note">Champion: <strong>${safeText(ROOM.seats?.[state.champion]?.name || 'Player')}</strong>. Highest score loses.</div><button class="btn btn-gold" id="modal-new-session">NEW SESSION</button>` : `<button class="btn btn-gold" id="modal-next-round">NEXT DEAL</button>`}
    <button class="btn btn-ghost" id="modal-close">Close</button>`;
  $('modal').classList.add('show');
  $('modal-close').addEventListener('click', () => $('modal').classList.remove('show'));
  const next = $('modal-next-round');
  const session = $('modal-new-session');
  if (next) next.addEventListener('click', hostNextRound);
  if (session) session.addEventListener('click', newSession);
}

async function hostNextRound() {
  if (!isRoomHost()) return toast('Only host can start next deal');
  $('modal').classList.remove('show');
  const starter = GAME_STATE?.nextStarter ?? GAME_STATE?.winner ?? null;
  const nextDeal = (ROOM.deal || 1) + 1;
  const state = dealNewRound(ROOM.seats, GAME_STATE?.scores || ROOM.scores || [0, 0, 0, 0], nextDeal, starter);
  lastRenderedPlayId = null;
  SELECTED.clear();
  await updateRoom({ deal: nextDeal, playing: true, state });
}

async function newSession() {
  if (!isRoomHost()) return toast('Only host can start new session');
  $('modal').classList.remove('show');
  const state = dealNewRound(ROOM.seats, [0, 0, 0, 0], 1, null);
  lastRenderedPlayId = null;
  SELECTED.clear();
  await updateRoom({ scores: [0, 0, 0, 0], deal: 1, playing: true, state });
}

async function endGameNow() {
  if (!ROOM || !isRoomHost() || !GAME_STATE) return toast('Only host can end game');
  if (!confirm('End the game now?')) return;
  const state = structuredCloneGameState(GAME_STATE);
  state.phase = 'gameOver';
  state.champion = state.scores.indexOf(Math.min(...state.scores));
  state.loser = state.scores.indexOf(Math.max(...state.scores));
  await updateRoom({ state });
  showScoreModal(state);
}

async function leaveRoom(goLobby = true) {
  clearTimeout(botTimer);
  clearTimeout(roundTimer);
  closeRealtime();
  localStorage.removeItem('bt_room_resume');
  if (!ROOM) {
    if (goLobby) initLobby();
    return;
  }
  if (!usingLocalMode && onlineAvailable && spClient) {
    try {
      const room = ROOM;
      const seats = [...(room.seats || [])];
      const idx = seats.findIndex((seat) => seat && seat.uid === ME.uid);
      if (idx !== -1 && !room.playing) {
        seats[idx] = null;
        await spClient.from('rooms').update({ seats }).eq('id', room.id);
      } else {
        const spectators = (room.spectators || []).filter((p) => p.uid !== ME.uid);
        await spClient.from('rooms').update({ spectators }).eq('id', room.id);
      }
    } catch (err) { console.warn(err); }
  }
  ROOM = null;
  GAME_STATE = null;
  ME_SEAT = -1;
  IS_SPECTATOR = false;
  usingLocalMode = false;
  SELECTED.clear();
  $('modal').classList.remove('show');
  if (goLobby) initLobby();
}

function scheduleBotIfNeeded() {
  clearTimeout(botTimer);
  if (!GAME_STATE || GAME_STATE.phase !== 'playing' || !isRoomHost()) return;
  const player = ROOM.seats?.[GAME_STATE.current];
  if (!player?.isBot) return;
  botTimer = setTimeout(() => botMove(GAME_STATE.current), 650 + Math.random() * 450);
}

async function botMove(seat) {
  if (!GAME_STATE || GAME_STATE.phase !== 'playing' || GAME_STATE.current !== seat) return;
  const hand = GAME_STATE.hands[seat] || [];
  const firstTurn = !GAME_STATE.lastPlay && GAME_STATE.deal === 1 && GAME_STATE.current === GAME_STATE.starter;
  let choice = null;
  if (!GAME_STATE.lastPlay) {
    choice = chooseBotLead(hand, firstTurn);
  } else {
    choice = chooseBotResponse(hand, GAME_STATE.lastPlay.combo);
  }
  if (!choice && GAME_STATE.lastPlay) return applyPass(seat);
  if (!choice) choice = [hand[0]];
  const combo = analyzeCombo(choice);
  await applyPlay(seat, choice, combo, combo?.size === 5 ? 'smash' : 'normal');
}

function chooseBotLead(hand, mustInclude3D = false) {
  const sorted = sortCards([...hand]);
  if (mustInclude3D) {
    const card = sorted.find((c) => c.r === '3' && c.s === 'D');
    return card ? [card] : [sorted[0]];
  }
  // Lead weak singles most often, but sometimes play a pair/triplet.
  const pairs = allCombos(sorted, 2).filter(analyzeCombo);
  const trips = allCombos(sorted, 3).filter(analyzeCombo);
  const fives = allCombos(sorted, 5).filter(analyzeCombo).sort((a, b) => analyzeCombo(a).power - analyzeCombo(b).power);
  if (Math.random() < 0.18 && pairs.length) return pairs[0];
  if (Math.random() < 0.08 && trips.length) return trips[0];
  if (Math.random() < 0.08 && fives.length) return fives[0];
  return [sorted[0]];
}

function chooseBotResponse(hand, lastCombo) {
  const combos = allCombos(hand, lastCombo.size)
    .map((cards) => ({ cards, combo: analyzeCombo(cards) }))
    .filter((item) => item.combo && beats(item.combo, lastCombo))
    .sort((a, b) => a.combo.power - b.combo.power);
  if (!combos.length) return null;
  // If the bot has many cards, play the smallest winning combo. If nearly empty, be more aggressive.
  const index = hand.length <= 4 && combos.length > 1 ? Math.min(1, combos.length - 1) : 0;
  return combos[index].cards;
}

function allCombos(cards, size) {
  const sorted = sortCards([...cards]);
  const result = [];
  const path = [];
  function rec(start) {
    if (path.length === size) { result.push(path.map((i) => sorted[i])); return; }
    for (let i = start; i <= sorted.length - (size - path.length); i++) {
      path.push(i);
      rec(i + 1);
      path.pop();
    }
  }
  rec(0);
  return result;
}

function openCommentSheet() {
  renderCommentSheet();
  $('sheet-backdrop').classList.remove('hidden');
  $('comment-sheet').classList.remove('hidden');
}

function openStickerSheet() {
  renderStickerSheet();
  $('sheet-backdrop').classList.remove('hidden');
  $('sticker-sheet').classList.remove('hidden');
}

function closeSheets() {
  $('sheet-backdrop').classList.add('hidden');
  $('comment-sheet').classList.add('hidden');
  $('sticker-sheet').classList.add('hidden');
}

function getQuickComments() {
  const custom = JSON.parse(localStorage.getItem('bt_custom_comments') || '[]');
  return [...QUICK_COMMENTS_DEFAULT, ...custom].slice(0, 32);
}

function renderCommentSheet() {
  const grid = $('comment-grid');
  grid.innerHTML = getQuickComments().map((txt) => `<button class="quick-chip" data-comment="${safeText(txt)}">${safeText(txt)}</button>`).join('');
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
    toast('Comment added');
  } else {
    sendTableEvent({ type: 'comment', text });
    closeSheets();
  }
  input.value = '';
}

function renderStickerSheet() {
  const grid = $('sticker-grid');
  grid.innerHTML = STICKERS.map((sticker, index) => {
    if (sticker.type === 'image') return `<button class="sticker-btn" data-sticker="${index}" title="${safeText(sticker.label)}"><img src="${sticker.src}" alt="sticker"></button>`;
    return `<button class="sticker-btn" data-sticker="${index}" title="${safeText(sticker.label)}"><span class="emoji">${sticker.emoji}</span></button>`;
  }).join('');
  grid.querySelectorAll('[data-sticker]').forEach((btn) => btn.addEventListener('click', () => {
    const sticker = STICKERS[Number(btn.dataset.sticker)];
    sendTableEvent({ type: 'sticker', src: sticker.src, emoji: sticker.emoji, stickerType: sticker.type });
    closeSheets();
  }));
}

async function sendTableEvent(payload) {
  if (!ROOM || !GAME_STATE) return;
  const seat = ME_SEAT >= 0 ? ME_SEAT : 0;
  const event = {
    id: 'E' + Date.now() + Math.random().toString(36).slice(2, 6),
    at: Date.now(),
    seat,
    player: ROOM.seats?.[seat]?.name || ME.name,
    ...payload,
  };
  const state = structuredCloneGameState(GAME_STATE);
  state.events = [...(state.events || []).filter((e) => Date.now() - e.at < 12000), event].slice(-30);
  await updateRoom({ state });
}

function renderEvents() {
  const events = (GAME_STATE.events || []).filter((event) => Date.now() - event.at < 4500);
  const layer = $('event-layer');
  for (const event of events) {
    if (renderedEventIds.has(event.id)) continue;
    renderedEventIds.add(event.id);
    const slot = seatToSlot(event.seat);
    const pos = slotPosition(slot);
    const bubble = document.createElement(event.type === 'comment' ? 'div' : (event.stickerType === 'emoji' ? 'div' : 'img'));
    if (event.type === 'comment') {
      bubble.className = 'speech-bubble';
      bubble.textContent = event.text || '';
    } else if (event.stickerType === 'emoji') {
      bubble.className = 'sticker-emoji';
      bubble.textContent = event.emoji || '😂';
    } else {
      bubble.className = 'sticker-pop';
      bubble.src = event.src || STICKERS[0].src;
      bubble.alt = 'sticker';
    }
    bubble.style.left = `${pos.x}px`;
    bubble.style.top = `${pos.y - 20}px`;
    layer.appendChild(bubble);
    setTimeout(() => bubble.remove(), 3700);
  }
  if (renderedEventIds.size > 200) renderedEventIds = new Set([...renderedEventIds].slice(-100));
}

// Keep modal visible when state becomes roundOver/gameOver from another client.
setInterval(() => {
  if (!GAME_STATE || !ROOM || $('modal').classList.contains('show')) return;
  if (GAME_STATE.phase === 'roundOver' || GAME_STATE.phase === 'gameOver') showScoreModal(GAME_STATE);
}, 900);
