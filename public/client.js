const socket = io();

const $ = id => document.getElementById(id);
const joinScreen = $('joinScreen');
const gameScreen = $('gameScreen');
const nameInput = $('nameInput');
const joinBtn = $('joinBtn');
const tableTitle = $('tableTitle');
const statusLine = $('statusLine');
const playersList = $('playersList');
const spectatorsList = $('spectatorsList');
const tablesList = $('tablesList');
const handEl = $('hand');
const handTitle = $('handTitle');
const playBtn = $('playBtn');
const smashBtn = $('smashBtn');
const passBtn = $('passBtn');
const addBotBtn = $('addBotBtn');
const installAppBtn = $('installAppBtn');
const turnInfo = $('turnInfo');
const lastPlay = $('lastPlay');
const roundResult = $('roundResult');
const selectionHint = $('selectionHint');
const toast = $('toast');
const takeSeatBtn = $('takeSeatBtn');
const continueWatchingBtn = $('continueWatchingBtn');
const seatTop = $('seatTop');
const seatRight = $('seatRight');
const seatBottom = $('seatBottom');
const seatLeft = $('seatLeft');
const tableCenterInfo = $('tableCenterInfo');
const impactBurst = $('impactBurst');

const suitSymbol = { D: '♦', C: '♣', H: '♥', S: '♠' };
const selected = new Set();
let latestState = null;
let previousLastPlayKey = '';
let previousRoundWinner = '';
let previousHighestKey = '';
let audioCtx = null;
let audioUnlocked = false;
let deferredInstallPrompt = null;

joinBtn.addEventListener('click', join);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') join(); });
playBtn.addEventListener('click', () => {
  unlockAudio();
  normalPress(playBtn);
  socket.emit('playHand', { cards: [...selected], smash: false });
  selected.clear();
});

smashBtn.addEventListener('click', () => {
  unlockAudio();
  powerPress(smashBtn);
  socket.emit('playHand', { cards: [...selected], smash: true });
  selected.clear();
});
passBtn.addEventListener('click', () => {
  unlockAudio();
  normalPress(passBtn);
  socket.emit('pass');
});
addBotBtn.addEventListener('click', () => {
  unlockAudio();
  normalPress(addBotBtn);
  socket.emit('addBot');
});
takeSeatBtn.addEventListener('click', () => {
  unlockAudio();
  normalPress(takeSeatBtn);
  socket.emit('takeSeat');
});
continueWatchingBtn.addEventListener('click', () => {
  unlockAudio();
  normalPress(continueWatchingBtn);
  socket.emit('continueWatching');
});

installAppBtn.addEventListener('click', async () => {
  unlockAudio();
  normalPress(installAppBtn);

  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installAppBtn.classList.add('hidden');
  } else {
    showToast('On phone: open browser menu, then choose Add to Home screen / Install app.');
  }
});

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installAppBtn.classList.remove('hidden');
});

window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  installAppBtn.classList.add('hidden');
  showToast('App installed on your device.');
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(console.warn);
  });
}


function join() {
  unlockAudio();
  const name = nameInput.value.trim() || `Player ${Math.floor(Math.random() * 1000)}`;
  localStorage.setItem('cp-name', name);
  socket.emit('join', { name });
  joinScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
}

nameInput.value = localStorage.getItem('cp-name') || '';
document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });

socket.on('joined', ({ tableId }) => {
  const url = new URL(location.href);
  url.searchParams.set('table', tableId);
  history.replaceState(null, '', url);
});

socket.on('state', state => {
  latestState = state;
  render(state);
  handleStateEffects(state);
});

socket.on('toast', ({ message }) => showToast(message));

function render(state) {
  tableTitle.textContent = `Table ${state.tableId.replace('table-', '')}`;
  const roleText = state.role === 'player' ? `Seat ${state.seatIndex + 1}` : `Watching${state.queueIndex >= 0 ? `: queue #${state.queueIndex + 1}` : ''}`;
  statusLine.textContent = `${roleText} · ${state.state} · target score ${state.targetScore}`;

  renderPlayers(state);
  renderSpectators(state);
  renderTables(state);
  renderTableSeats(state);
  renderCenter(state);
  renderHand(state);

  const myTurn = state.role === 'player' && state.currentTurn === state.seatIndex && state.state === 'playing';
  playBtn.disabled = !myTurn || selected.size === 0;
  smashBtn.disabled = !myTurn || selected.size === 0;
  passBtn.disabled = !myTurn || !state.lastPlay;
  addBotBtn.disabled = state.state === 'playing';

  takeSeatBtn.classList.toggle('hidden', !state.canTakeSeat);
  continueWatchingBtn.classList.toggle('hidden', !state.canContinueWatching);
}

function renderPlayers(state) {
  playersList.innerHTML = '';
  state.players.forEach((p, idx) => {
    const div = document.createElement('div');
    div.className = 'player-row' + (p?.isTurn ? ' turn' : '') + (p?.lost ? ' lost' : '');
    if (!p) {
      div.innerHTML = `<div><span class="player-name">Seat ${idx + 1}: empty</span><br><span class="small">Waiting</span></div><span class="score">-</span>`;
    } else {
      const bot = p.bot ? '<span class="badge">BOT</span>' : '';
      const turn = p.isTurn ? ' · turn' : '';
      const lost = p.lost ? ' · lost' : '';
      div.innerHTML = `<div><span class="player-name">${escapeHtml(p.name)}</span>${bot}<br><span class="small">Seat ${idx + 1} · ${p.cardCount} cards${turn}${lost}</span></div><span class="score">${p.score}</span>`;
    }
    playersList.appendChild(div);
  });
}

function renderSpectators(state) {
  if (!state.spectators.length) {
    spectatorsList.textContent = 'No watchers.';
    return;
  }
  spectatorsList.innerHTML = state.spectators.map(s => `${s.index}. ${escapeHtml(s.name)}`).join('<br>');
}

function renderTables(state) {
  tablesList.innerHTML = '';
  state.tables.forEach(t => {
    const div = document.createElement('div');
    div.className = 'table-link';
    div.innerHTML = `<strong>${escapeHtml(t.id)}</strong><br>${t.players}/4 players · ${t.spectators} watching · ${t.state}`;
    if (t.id !== state.tableId) {
      const btn = document.createElement('button');
      btn.textContent = 'Watch';
      btn.style.marginTop = '8px';
      btn.addEventListener('click', () => {
        unlockAudio();
        normalPress(btn);
        socket.emit('switchTable', { tableId: t.id });
      });
      div.appendChild(btn);
    }
    tablesList.appendChild(div);
  });
}

function renderTableSeats(state) {
  const slots = [
    { el: seatTop, position: 'top' },
    { el: seatRight, position: 'right' },
    { el: seatBottom, position: 'bottom' },
    { el: seatLeft, position: 'left' }
  ];

  let mapping;
  if (state.role === 'player' && state.seatIndex >= 0) {
    mapping = {
      bottom: state.seatIndex,
      right: (state.seatIndex + 1) % 4,
      top: (state.seatIndex + 2) % 4,
      left: (state.seatIndex + 3) % 4
    };
  } else {
    mapping = { top: 0, right: 1, bottom: 2, left: 3 };
  }

  for (const slot of slots) {
    const seatIndex = mapping[slot.position];
    slot.el.innerHTML = seatHtml(state.players[seatIndex], seatIndex, state);
  }
}

function seatHtml(player, seatIndex, state) {
  if (!player) {
    return `
      <div class="seat-card empty">
        <div class="seat-name">Empty seat</div>
        <div class="seat-meta">Seat ${seatIndex + 1}</div>
        <div class="seat-stats"><span class="seat-pill">Waiting</span></div>
      </div>`;
  }

  const classes = [
    'seat-card',
    player.isTurn ? 'turn' : '',
    player.lost ? 'lost' : '',
    state.role === 'player' && seatIndex === state.seatIndex ? 'me' : ''
  ].filter(Boolean).join(' ');

  const pills = [
    `<span class="seat-pill">Seat ${seatIndex + 1}</span>`,
    `<span class="seat-pill">${player.cardCount} cards</span>`,
    `<span class="seat-pill score-pill">${player.score} pts</span>`
  ];
  if (player.bot) pills.push(`<span class="seat-pill">BOT</span>`);
  if (player.isTurn) pills.push(`<span class="seat-pill turn-pill">TURN</span>`);
  if (player.lost) pills.push(`<span class="seat-pill lost-pill">LOST</span>`);
  if (state.role === 'player' && seatIndex === state.seatIndex) pills.push(`<span class="seat-pill">YOU</span>`);

  return `
    <div class="${classes}">
      <div class="seat-name">${escapeHtml(player.name)}</div>
      <div class="seat-meta">${player.bot ? 'Bot player' : 'Player'}</div>
      <div class="seat-stats">${pills.join('')}</div>
    </div>`;
}

function renderCenter(state) {
  const highestText = state.highestAlert?.active ? ` · HIGHEST! ${state.highestAlert.targetName} has 1 card` : '';
  turnInfo.textContent = state.state === 'playing'
    ? `${state.currentTurnName}'s turn${state.firstMove ? ' · first hand must include 3♦' : ''}${highestText}`
    : state.message;

  if (!state.lastPlay) {
    lastPlay.innerHTML = `<div class="small">No active hand. The current player can choose single, pair, triplet, or a 5-card poker hand.</div>`;
  } else {
    const impactText = state.lastPlay.effect === 'smash' ? ' 💥' : '';
    lastPlay.innerHTML = `<strong>${escapeHtml(state.lastPlay.playerName)}</strong> played <strong>${escapeHtml(state.lastPlay.label)}</strong>${impactText}<div class="last-play-cards">${state.lastPlay.cards.map(cardHtml).join('')}</div>`;
  }

  if (state.lastRound) {
    const rows = state.lastRound.roundScores.map(r => `<tr><td>${escapeHtml(r.name)}</td><td>${r.left}</td><td>+${r.penalty}</td><td>${r.score}</td></tr>`).join('');
    roundResult.innerHTML = `<div class="small">Last winner: ${escapeHtml(state.lastRound.winner)}</div><table><thead><tr><th>Player</th><th>Left</th><th>Penalty</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table>`;
  } else {
    roundResult.innerHTML = '';
  }
}

function renderHand(state) {
  handEl.innerHTML = '';
  selected.forEach(id => { if (!state.myCards.includes(id)) selected.delete(id); });

  if (state.role !== 'player') {
    handTitle.textContent = 'Spectator view';
    selectionHint.textContent = 'You can watch the table, but players’ cards are hidden to avoid cheating.';
    playBtn.disabled = true;
    smashBtn.disabled = true;
    passBtn.disabled = true;
    for (let i = 0; i < 13; i++) handEl.insertAdjacentHTML('beforeend', `<div class="card back">card</div>`);
    return;
  }

  handTitle.textContent = 'Your hand';
  const myTurn = state.currentTurn === state.seatIndex && state.state === 'playing';
  const highestForced = myTurn && state.highestAlert?.active && state.highestAlert.defenderSeat === state.seatIndex;
  selectionHint.textContent = highestForced
    ? `HIGHEST rule: ${state.highestAlert.targetName} has one card. You must play your strongest legal hand.`
    : myTurn
      ? 'Select cards, then press “Play hand”. Wrong hands are rejected only for you.'
      : 'Wait for your turn. Cards are sorted from 3 up to 2.';

  state.myCards.forEach(id => {
    const card = document.createElement('div');
    card.className = `card ${isRed(id) ? 'red' : 'black'} ${selected.has(id) ? 'selected' : ''}`;
    card.innerHTML = cardInner(id);
    card.addEventListener('click', () => {
      unlockAudio();
      playCardPickSound(selected.has(id));
      if (selected.has(id)) selected.delete(id);
      else selected.add(id);
      render(latestState);
    });
    handEl.appendChild(card);
  });
}

function handleStateEffects(state) {
  const currentKey = state.lastPlay ? `${state.lastPlay.playerName}|${state.lastPlay.label}|${state.lastPlay.cards.join(',')}|${state.lastPlay.effect || 'normal'}` : '';
  if (currentKey && currentKey !== previousLastPlayKey) {
    triggerThrowImpact(state.lastPlay.effect || 'normal');
    if ((state.lastPlay.effect || 'normal') === 'smash') playThrowImpactSound();
    else playNormalThrowSound();
  }
  previousLastPlayKey = currentKey;

  const highestKey = state.highestAlert?.active
    ? `${state.tableId}|${state.round}|${state.highestAlert.targetSeat}|${state.highestAlert.defenderSeat}|${state.currentTurn}`
    : '';
  if (highestKey && highestKey !== previousHighestKey) {
    showToast(`HIGHEST! ${state.highestAlert.targetName} has one card. ${state.highestAlert.defenderName} must play strongest.`);
    playHighestAlertSound();
  }
  previousHighestKey = highestKey;

  const roundWinner = state.lastRound?.winner || '';
  if (roundWinner && roundWinner !== previousRoundWinner) {
    playRoundWinSound();
  }
  previousRoundWinner = roundWinner;
}

function triggerThrowImpact(effect = 'normal') {
  const cardsBox = lastPlay.querySelector('.last-play-cards');
  tableCenterInfo.classList.remove('impact', 'smash-impact');
  impactBurst.classList.remove('burst', 'smash-burst');
  if (cardsBox) {
    cardsBox.classList.remove('throw-anim');
    void cardsBox.offsetWidth;
    cardsBox.classList.add('throw-anim');
  }
  void tableCenterInfo.offsetWidth;
  tableCenterInfo.classList.add(effect === 'smash' ? 'smash-impact' : 'impact');
  void impactBurst.offsetWidth;
  impactBurst.classList.add(effect === 'smash' ? 'smash-burst' : 'burst');
}

function normalPress(btn) {
  btn.classList.remove('tap-press');
  void btn.offsetWidth;
  btn.classList.add('tap-press');
}

function powerPress(btn) {
  btn.classList.remove('power-press');
  void btn.offsetWidth;
  btn.classList.add('power-press');
}

function unlockAudio() {
  if (audioUnlocked) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const buffer = audioCtx.createBuffer(1, 1, 22050);
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(audioCtx.destination);
    source.start(0);
    if (audioCtx.state === 'suspended') audioCtx.resume();
    audioUnlocked = true;
  } catch (e) {
    console.warn('Audio could not start', e);
  }
}

function nowCtx() {
  if (!audioCtx) unlockAudio();
  return audioCtx;
}

function envelopeGain(ctx, start, attack, decay, peak, endGain = 0.0001) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.gain.exponentialRampToValueAtTime(endGain, start + attack + decay);
  return gain;
}

function playButtonTap() {
  const ctx = nowCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(450, t);
  osc.frequency.exponentialRampToValueAtTime(280, t + 0.06);
  const gain = envelopeGain(ctx, t, 0.005, 0.08, 0.08);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

function playPassSound() {
  const ctx = nowCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(320, t);
  osc.frequency.exponentialRampToValueAtTime(220, t + 0.1);
  const gain = envelopeGain(ctx, t, 0.003, 0.12, 0.06);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.12);
}

function playCardPickSound(isUnselect = false) {
  const ctx = nowCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = 'square';
  const base = isUnselect ? 420 : 520;
  osc.frequency.setValueAtTime(base, t);
  osc.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.04);
  const gain = envelopeGain(ctx, t, 0.002, 0.05, 0.03);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.06);
}

function playThrowPrepSound() {
  const ctx = nowCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1200, t);
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(180, t);
  osc.frequency.exponentialRampToValueAtTime(110, t + 0.08);
  const gain = envelopeGain(ctx, t, 0.002, 0.09, 0.02);
  osc.connect(filter).connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.09);
}

function playNormalThrowSound() {
  const ctx = nowCtx();
  if (!ctx) return;
  const t = ctx.currentTime;

  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1150, t);
  filter.Q.value = 0.9;
  const gain = envelopeGain(ctx, t, 0.001, 0.07, 0.09);
  noise.connect(filter).connect(gain).connect(ctx.destination);
  noise.start(t);
  noise.stop(t + 0.08);

  const soft = ctx.createOscillator();
  soft.type = 'triangle';
  soft.frequency.setValueAtTime(160, t);
  soft.frequency.exponentialRampToValueAtTime(95, t + 0.08);
  const softGain = envelopeGain(ctx, t, 0.002, 0.08, 0.045);
  soft.connect(softGain).connect(ctx.destination);
  soft.start(t);
  soft.stop(t + 0.09);
}

function playThrowImpactSound() {
  const ctx = nowCtx();
  if (!ctx) return;
  const t = ctx.currentTime;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.8, t);
  master.connect(ctx.destination);

  const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.2, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.setValueAtTime(700, t);
  noiseFilter.Q.value = 0.7;
  const noiseGain = envelopeGain(ctx, t, 0.001, 0.16, 0.25);
  noise.connect(noiseFilter).connect(noiseGain).connect(master);
  noise.start(t);
  noise.stop(t + 0.16);

  const thump = ctx.createOscillator();
  thump.type = 'triangle';
  thump.frequency.setValueAtTime(95, t);
  thump.frequency.exponentialRampToValueAtTime(48, t + 0.18);
  const thumpGain = envelopeGain(ctx, t, 0.002, 0.18, 0.3);
  thump.connect(thumpGain).connect(master);
  thump.start(t);
  thump.stop(t + 0.2);

  const slap = ctx.createOscillator();
  slap.type = 'square';
  slap.frequency.setValueAtTime(390, t);
  slap.frequency.exponentialRampToValueAtTime(190, t + 0.08);
  const slapGain = envelopeGain(ctx, t, 0.001, 0.08, 0.08);
  slap.connect(slapGain).connect(master);
  slap.start(t);
  slap.stop(t + 0.09);
}

function playHighestAlertSound() {
  const ctx = nowCtx();
  if (ctx) {
    const t = ctx.currentTime;
    [660, 880, 660].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, t + i * 0.12);
      const gain = envelopeGain(ctx, t + i * 0.12, 0.005, 0.11, 0.08);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t + i * 0.12);
      osc.stop(t + i * 0.12 + 0.13);
    });
  }

  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance('highest');
      utterance.lang = 'en-US';
      utterance.rate = 0.95;
      utterance.pitch = 1.05;
      utterance.volume = 1;
      window.speechSynthesis.speak(utterance);
    }
  } catch (e) {
    console.warn('Speech alert unavailable', e);
  }
}

function playRoundWinSound() {
  const ctx = nowCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t + i * 0.07);
    const gain = envelopeGain(ctx, t + i * 0.07, 0.005, 0.18, 0.07);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t + i * 0.07);
    osc.stop(t + i * 0.07 + 0.2);
  });
}

function cardHtml(id) {
  return `<div class="card ${isRed(id) ? 'red' : 'black'}">${cardInner(id)}</div>`;
}
function cardInner(id) {
  const suit = id.slice(-1);
  const rank = id.slice(0, -1);
  return `<span class="corner">${rank}<br>${suitSymbol[suit]}</span><span>${rank}${suitSymbol[suit]}</span>`;
}
function isRed(id) { return id.endsWith('D') || id.endsWith('H'); }
function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.t);
  showToast.t = setTimeout(() => toast.classList.add('hidden'), 2300);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
}
