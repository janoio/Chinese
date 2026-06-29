const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true }));

const SUITS = ['D', 'C', 'H', 'S']; // diamonds, clubs/leaf, hearts, spades
const SUIT_SYMBOLS = { D: '♦', C: '♣', H: '♥', S: '♠' };
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const HAND_POWER = { straight: 1, flush: 2, fullhouse: 3, quads: 4, straightflush: 5 };
const SEATS = 4;
const TARGET_SCORE = 101;

let tableCounter = 1;
let botCounter = 1;
const tables = new Map();
const users = new Map(); // socket.id -> { id, name, tableId, role, seatIndex }

function newTable() {
  const id = `table-${tableCounter++}`;
  const table = {
    id,
    players: Array(SEATS).fill(null),
    spectators: [],
    state: 'waiting',
    currentTurn: 0,
    firstMove: false,
    startRequires3D: false,
    nextStarterSeat: null,
    lastPlay: null,
    passes: [],
    round: 0,
    message: 'Waiting for 4 players.',
    openSeats: [],
    endGameVotes: [],
    createdAt: Date.now(),
    lastActionAt: Date.now()
  };
  tables.set(id, table);
  return table;
}

function createPlayer(id, name, bot = false) {
  return {
    id,
    name: cleanName(name || (bot ? `Bot ${botCounter}` : 'Player')),
    bot,
    score: 0,
    cards: [],
    connected: true,
    lost: false
  };
}

function cleanName(name) {
  return String(name || 'Player').trim().slice(0, 20).replace(/[<>]/g, '') || 'Player';
}

function rankValue(card) { return RANKS.indexOf(card.rank); }
function suitValue(card) { return SUITS.indexOf(card.suit); }
function cardKey(card) { return rankValue(card) * 4 + suitValue(card); }
function cardId(card) { return `${card.rank}${card.suit}`; }
function parseCard(id) {
  const suit = id.slice(-1);
  const rank = id.slice(0, -1);
  if (!RANKS.includes(rank) || !SUITS.includes(suit)) return null;
  return { rank, suit };
}
function sortCards(cards) {
  return [...cards].sort((a, b) => cardKey(a) - cardKey(b));
}
function sortCardIds(ids) {
  return sortCards(ids.map(parseCard).filter(Boolean)).map(cardId);
}
function makeDeck() {
  const deck = [];
  for (const rank of RANKS) {
    for (const suit of SUITS) deck.push({ rank, suit });
  }
  return deck;
}
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function evaluateHand(ids) {
  const unique = [...new Set(ids)];
  if (unique.length !== ids.length) return null;
  const cards = sortCards(unique.map(parseCard).filter(Boolean));
  if (cards.length !== ids.length || cards.length < 1) return null;

  const ranks = cards.map(rankValue);
  const suits = cards.map(suitValue);
  const rankCounts = new Map();
  for (const r of ranks) rankCounts.set(r, (rankCounts.get(r) || 0) + 1);
  const counts = [...rankCounts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const highCard = Math.max(...cards.map(cardKey));

  if (cards.length === 1) {
    return { group: 'single', type: 'single', cards: cards.map(cardId), rank: ranks[0], suit: suits[0], power: [ranks[0], suits[0]], label: 'Single' };
  }
  if (cards.length === 2 && rankCounts.size === 1) {
    return { group: 'pair', type: 'pair', cards: cards.map(cardId), rank: ranks[0], suit: Math.max(...suits), power: [ranks[0], Math.max(...suits)], label: 'Pair' };
  }
  if (cards.length === 3 && rankCounts.size === 1) {
    return { group: 'triplet', type: 'triplet', cards: cards.map(cardId), rank: ranks[0], suit: Math.max(...suits), power: [ranks[0], Math.max(...suits)], label: 'Triplet' };
  }
  if (cards.length !== 5) return null;

  const flush = new Set(suits).size === 1;
  const uniqueRanks = [...new Set(ranks)].sort((a, b) => a - b);
  const straight = uniqueRanks.length === 5 && uniqueRanks[4] - uniqueRanks[0] === 4;
  const straightHigh = straight ? uniqueRanks[4] : -1;
  const straightHighSuit = straight ? Math.max(...cards.filter(c => rankValue(c) === straightHigh).map(suitValue)) : -1;

  let type = null;
  let power = null;
  let label = '';

  const hasFour = counts[0][1] === 4;
  const hasFullHouse = counts.length === 2 && counts[0][1] === 3 && counts[1][1] === 2;

  if (straight && flush) {
    type = 'straightflush'; label = 'Straight flush'; power = [HAND_POWER[type], straightHigh, straightHighSuit];
  } else if (hasFour) {
    type = 'quads'; label = 'Quads + 1'; power = [HAND_POWER[type], counts[0][0]];
  } else if (hasFullHouse) {
    type = 'fullhouse'; label = 'Full house'; power = [HAND_POWER[type], counts[0][0], counts[1][0]];
  } else if (flush) {
    const sortedKeys = cards.map(cardKey).sort((a, b) => b - a);
    type = 'flush'; label = 'Flush'; power = [HAND_POWER[type], ...sortedKeys];
  } else if (straight) {
    type = 'straight'; label = 'Straight'; power = [HAND_POWER[type], straightHigh, straightHighSuit];
  } else {
    return null;
  }

  return { group: 'five', type, cards: cards.map(cardId), power, label };
}

function comparePower(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

function beats(candidate, lastPlay) {
  if (!lastPlay) return true;
  if (!candidate || candidate.group !== lastPlay.hand.group) return false;
  return comparePower(candidate.power, lastPlay.hand.power) > 0;
}

function previousSeat(table, from) {
  for (let step = 1; step <= SEATS; step++) {
    const idx = (from - step + SEATS) % SEATS;
    if (table.players[idx]) return idx;
  }
  return from;
}

function openLeadPower(hand) {
  // Used only when a player can choose any group.
  // A 5-card poker hand is treated as the strongest category, then triplet, pair, single.
  const groupRank = { single: 1, pair: 2, triplet: 3, five: 4 };
  return [groupRank[hand.group] || 0, ...hand.power];
}

function compareOpenLead(a, b) {
  return comparePower(openLeadPower(a), openLeadPower(b));
}

function strongestLegalHandForTurn(table, seat) {
  const p = table.players[seat];
  if (!p) return null;

  const group = table.lastPlay ? table.lastPlay.hand.group : null;
  let hands = allValidHands(p.cards, group);

  if (table.firstMove && table.startRequires3D) hands = hands.filter(h => h.cards.includes('3D'));
  if (table.lastPlay) hands = hands.filter(h => beats(h, table.lastPlay));
  if (!hands.length) return null;

  if (table.lastPlay) {
    return hands.sort((a, b) => comparePower(b.power, a.power))[0];
  }

  return hands.sort((a, b) => compareOpenLead(b, a))[0];
}

function highestAlertInfo(table) {
  if (table.state !== 'playing') return null;

  for (let targetSeat = 0; targetSeat < SEATS; targetSeat++) {
    const target = table.players[targetSeat];
    if (!target || target.cards.length !== 1) continue;

    const defenderSeat = previousSeat(table, targetSeat); // player on the right: the one before him in clockwise order
    if (defenderSeat === targetSeat) continue;

    return {
      targetSeat,
      targetName: target.name,
      defenderSeat,
      defenderName: table.players[defenderSeat]?.name || '',
      active: table.currentTurn === defenderSeat
    };
  }

  return null;
}

function isHighestForcedTurn(table, seat) {
  const alert = highestAlertInfo(table);
  return !!(alert && alert.active && alert.defenderSeat === seat);
}

function isSameStrengthHand(a, b) {
  return !!a && !!b && a.group === b.group && comparePower(a.power, b.power) === 0;
}

function scorePenalty(cardsLeft) {
  if (cardsLeft <= 0) return 0;
  if (cardsLeft <= 4) return cardsLeft;
  if (cardsLeft <= 9) return cardsLeft * 2;
  return cardsLeft * 3;
}

function findOrCreateJoinTable() {
  const list = [...tables.values()].sort((a, b) => a.createdAt - b.createdAt);

  // Prefer tables waiting for players.
  for (const table of list) {
    if ((table.state === 'waiting' || table.state === 'betweenRounds') && table.players.some(p => p === null)) return table;
  }

  // If a running table already has spectators, keep filling that queue until it reaches 4.
  for (const table of list) {
    if (table.state === 'playing' && table.spectators.length < 4) return table;
  }

  // Once there are enough extra people, create a new table.
  return newTable();
}


function humanNameForSocket(socket) {
  const existing = users.get(socket.id);
  return existing?.name || cleanName(socket.handshake?.auth?.name || `Player ${Math.floor(Math.random() * 1000)}`);
}

function detachSocketFromCurrentTable(socket, keepUser = false) {
  const current = users.get(socket.id);
  if (!current) return;
  const oldTable = tables.get(current.tableId);
  if (oldTable) {
    removeSocketFromTable(socket.id, oldTable, false);
    socket.leave(current.tableId);
  }
  if (!keepUser) users.delete(socket.id);
}

function seatHumanInTable(socket, table, name, preferredSeat = -1) {
  socket.join(table.id);
  const clean = cleanName(name);
  const emptySeat = preferredSeat >= 0 && table.players[preferredSeat] === null
    ? preferredSeat
    : table.players.findIndex(p => p === null);

  if (emptySeat === -1) return false;

  const player = createPlayer(socket.id, clean, false);
  table.players[emptySeat] = player;
  users.set(socket.id, { id: socket.id, name: player.name, tableId: table.id, role: 'player', seatIndex: emptySeat });
  table.message = `${player.name} joined seat ${emptySeat + 1}.`;
  maybeStartRound(table);
  return true;
}

function takeBotSeat(socket, table, name, botSeat = -1) {
  const seat = botSeat >= 0 && table.players[botSeat]?.bot
    ? botSeat
    : table.players.findIndex(p => p && p.bot);

  if (seat === -1) return false;

  socket.join(table.id);
  const bot = table.players[seat];
  const clean = cleanName(name);
  bot.id = socket.id;
  bot.name = clean;
  bot.bot = false;
  bot.connected = true;
  bot.lost = false;

  users.set(socket.id, { id: socket.id, name: clean, tableId: table.id, role: 'player', seatIndex: seat });
  table.endGameVotes = [];
  table.message = `${clean} took over seat ${seat + 1} from a bot.`;
  broadcastAll();
  return true;
}

function joinSpecificTableAsPlayer(socket, tableId, name) {
  const target = tables.get(tableId);
  if (!target) return privateError(socket.id, 'Table not found.');

  detachSocketFromCurrentTable(socket);
  const clean = cleanName(name || humanNameForSocket(socket));

  if (takeBotSeat(socket, target, clean)) {
    broadcastAll();
    return target.id;
  }

  if (target.state !== 'playing' && target.players.some(p => p === null)) {
    seatHumanInTable(socket, target, clean);
    broadcastAll();
    return target.id;
  }

  socket.join(target.id);
  target.spectators.push({ id: socket.id, name: clean, bot: false });
  users.set(socket.id, { id: socket.id, name: clean, tableId: target.id, role: 'spectator', seatIndex: null });
  target.message = `${clean} is watching.`;
  broadcastAll();
  return target.id;
}

function createNewTableForSocket(socket, name) {
  detachSocketFromCurrentTable(socket);
  const table = newTable();
  const clean = cleanName(name || humanNameForSocket(socket));
  seatHumanInTable(socket, table, clean, 0);
  table.message = `${clean} opened a new table. Add bots or invite friends.`;
  broadcastAll();
  return table.id;
}

function addHumanToTable(socket, name) {
  const table = findOrCreateJoinTable();
  socket.join(table.id);
  const player = createPlayer(socket.id, name, false);
  const emptySeat = table.players.findIndex(p => p === null);
  if ((table.state === 'waiting' || table.state === 'betweenRounds') && emptySeat !== -1) {
    table.players[emptySeat] = player;
    users.set(socket.id, { id: socket.id, name: player.name, tableId: table.id, role: 'player', seatIndex: emptySeat });
    table.message = `${player.name} joined seat ${emptySeat + 1}.`;
    maybeStartRound(table);
  } else {
    table.spectators.push({ id: socket.id, name: player.name, bot: false });
    users.set(socket.id, { id: socket.id, name: player.name, tableId: table.id, role: 'spectator', seatIndex: null });
    table.message = `${player.name} is watching. Spectator position #${table.spectators.length}.`;
    maybeMoveSpectatorsToNewTable();
  }
  broadcastAll();
  return table.id;
}

function maybeMoveSpectatorsToNewTable() {
  // If a table has 4 spectators, they become a new 4-player table in queue order.
  for (const table of [...tables.values()]) {
    while (table.spectators.length >= 4) {
      const newT = newTable();
      const four = table.spectators.splice(0, 4);
      four.forEach((s, idx) => {
        newT.players[idx] = createPlayer(s.id, s.name, false);
        const sock = io.sockets.sockets.get(s.id);
        if (sock) {
          sock.leave(table.id);
          sock.join(newT.id);
          users.set(s.id, { id: s.id, name: s.name, tableId: newT.id, role: 'player', seatIndex: idx });
        }
      });
      newT.message = 'New table opened for 4 extra players.';
      maybeStartRound(newT);
      table.message = 'A new table opened for spectators.';
    }
  }
}

function addBot(table) {
  const seat = table.players.findIndex(p => p === null);
  if (seat === -1 || table.state === 'playing') return false;
  const id = `bot-${botCounter++}`;
  table.players[seat] = createPlayer(id, `Bot ${botCounter - 1}`, true);
  table.message = `Bot added in seat ${seat + 1}.`;
  maybeStartRound(table);
  return true;
}

function maybeStartRound(table) {
  if (table.players.every(Boolean) && table.state !== 'playing' && table.openSeats.length === 0) {
    startRound(table);
  }
}

function startRound(table) {
  table.round += 1;
  table.state = 'playing';
  table.lastPlay = null;
  table.passes = [];
  table.firstMove = true;
  table.openSeats = [];
  table.endGameVotes = [];

  const deck = shuffle(makeDeck());
  for (let i = 0; i < SEATS; i++) table.players[i].cards = [];
  for (let i = 0; i < deck.length; i++) {
    table.players[i % SEATS].cards.push(deck[i]);
  }
  for (const p of table.players) {
    p.cards = sortCards(p.cards);
    p.lost = false;
  }

  let starter = -1;

  // First round only: the player with 3♦ starts and must play it.
  // After that: the previous round winner starts the next round.
  if (table.round === 1 || table.nextStarterSeat === null || !table.players[table.nextStarterSeat]) {
    starter = table.players.findIndex(p => p.cards.some(c => c.rank === '3' && c.suit === 'D'));
    table.startRequires3D = true;
  } else {
    starter = table.nextStarterSeat;
    table.startRequires3D = false;
  }

  table.currentTurn = starter >= 0 ? starter : 0;
  const starterName = table.players[table.currentTurn].name;
  table.message = table.startRequires3D
    ? `Round ${table.round}: ${starterName} starts with 3♦.`
    : `Round ${table.round}: ${starterName} starts because they won the previous round.`;

  broadcastAll();
  scheduleBotIfNeeded(table);
}

function getActiveSeatCount(table) {
  return table.players.filter(Boolean).length;
}

function nextSeat(table, from) {
  for (let step = 1; step <= SEATS; step++) {
    const idx = (from + step) % SEATS;
    if (table.players[idx]) return idx;
  }
  return from;
}

function playHand(table, socketId, selectedIds, opts = {}) {
  const user = users.get(socketId);
  if (!user || user.tableId !== table.id || user.role !== 'player') return privateError(socketId, 'You are not playing at this table.');
  const seat = user.seatIndex;
  const player = table.players[seat];
  if (!player || table.state !== 'playing') return privateError(socketId, 'The game is not playing now.');
  if (seat !== table.currentTurn) return privateError(socketId, 'It is not your turn.');

  const ids = sortCardIds(selectedIds || []);
  const hand = evaluateHand(ids);
  if (!hand) return privateError(socketId, 'Wrong hand.');

  const owned = new Set(player.cards.map(cardId));
  if (!ids.every(id => owned.has(id))) return privateError(socketId, 'Wrong card.');

  if (table.firstMove && table.startRequires3D && !ids.includes('3D')) return privateError(socketId, 'First hand of the game must include 3♦.');
  if (table.lastPlay && hand.group !== table.lastPlay.hand.group) return privateError(socketId, `Wrong hand. You must play ${table.lastPlay.hand.group}.`);
  if (!beats(hand, table.lastPlay)) return privateError(socketId, 'Wrong hand. Your hand is not strong enough.');

  if (isHighestForcedTurn(table, seat)) {
    const strongest = strongestLegalHandForTurn(table, seat);
    if (strongest && !isSameStrengthHand(hand, strongest)) {
      const alert = highestAlertInfo(table);
      return privateError(socketId, `HIGHEST rule: ${alert.targetName} has one card. You must play your strongest legal hand.`);
    }
  }

  player.cards = player.cards.filter(c => !ids.includes(cardId(c)));
  table.lastPlay = { playerIndex: seat, playerName: player.name, hand, cards: hand.cards, effect: opts.smash ? 'smash' : 'normal', at: Date.now() };
  table.passes = [];
  table.firstMove = false;
  table.lastActionAt = Date.now();
  table.message = `${player.name} played ${hand.label}.`;

  if (player.cards.length === 0) {
    finishRound(table, seat);
  } else {
    table.currentTurn = nextSeat(table, seat);
  }
  broadcastAll();
  scheduleBotIfNeeded(table);
}

function passTurn(table, socketId) {
  const user = users.get(socketId);
  if (!user || user.tableId !== table.id || user.role !== 'player') return privateError(socketId, 'You are not playing at this table.');
  const seat = user.seatIndex;
  const player = table.players[seat];
  if (!player || table.state !== 'playing') return privateError(socketId, 'The game is not playing now.');
  if (seat !== table.currentTurn) return privateError(socketId, 'It is not your turn.');
  if (!table.lastPlay) return privateError(socketId, 'You are starting. Select cards and play a hand.');
  if (table.lastPlay.playerIndex === seat) return privateError(socketId, 'You won the trick. Select a new hand.');

  if (isHighestForcedTurn(table, seat)) {
    const strongest = strongestLegalHandForTurn(table, seat);
    if (strongest) {
      const alert = highestAlertInfo(table);
      return privateError(socketId, `HIGHEST rule: ${alert.targetName} has one card. You cannot pass; play your strongest legal hand.`);
    }
  }

  if (!table.passes.includes(seat)) table.passes.push(seat);
  table.message = `${player.name} passed.`;
  const active = getActiveSeatCount(table);
  if (table.passes.length >= active - 1) {
    const leader = table.lastPlay.playerIndex;
    table.lastPlay = null;
    table.passes = [];
    table.currentTurn = leader;
    table.message = `${table.players[leader].name} controls the table and can choose a new hand.`;
  } else {
    table.currentTurn = nextSeat(table, seat);
  }
  broadcastAll();
  scheduleBotIfNeeded(table);
}

function finishRound(table, winnerSeat) {
  table.nextStarterSeat = winnerSeat;
  const winner = table.players[winnerSeat];
  const roundScores = [];
  for (let i = 0; i < SEATS; i++) {
    const p = table.players[i];
    const left = p.cards.length;
    const penalty = scorePenalty(left);
    if (penalty > 0) p.score += penalty;
    roundScores.push({ seat: i, name: p.name, left, penalty, score: p.score });
  }
  const losers = [];
  for (let i = 0; i < SEATS; i++) {
    if (table.players[i].score >= TARGET_SCORE) losers.push(i);
  }
  table.lastRound = { winner: winner.name, roundScores, losers: losers.map(i => table.players[i].name) };
  table.lastPlay = null;
  table.passes = [];
  table.firstMove = false;

  if (losers.length) {
    table.state = 'betweenRounds';
    table.openSeats = [...losers];
    for (const i of losers) table.players[i].lost = true;
    table.message = `${losers.map(i => table.players[i].name).join(', ')} reached ${TARGET_SCORE}+ and lost. Spectators can take the place in order.`;
    handleBotLosers(table);
  } else {
    table.state = 'betweenRounds';
    table.message = `${winner.name} finished first. Next round will start soon.`;
    setTimeout(() => {
      if (table.state === 'betweenRounds' && table.players.every(Boolean) && table.openSeats.length === 0) startRound(table);
    }, 4500);
  }
}

function handleBotLosers(table) {
  for (const seat of [...table.openSeats]) {
    const p = table.players[seat];
    if (p && p.bot) {
      table.players[seat] = null;
      table.openSeats = table.openSeats.filter(s => s !== seat);
      fillOpenSeatFromQueue(table, seat);
      if (!table.players[seat]) addBotToSeat(table, seat);
    }
  }
  if (table.players.every(Boolean) && table.openSeats.length === 0) {
    setTimeout(() => startRound(table), 3000);
  }
}

function addBotToSeat(table, seat) {
  const id = `bot-${botCounter++}`;
  table.players[seat] = createPlayer(id, `Bot ${botCounter - 1}`, true);
}

function fillOpenSeatFromQueue(table, seat) {
  const next = table.spectators.shift();
  if (!next) return false;
  table.players[seat] = createPlayer(next.id, next.name, false);
  table.players[seat].score = 0;
  const sock = io.sockets.sockets.get(next.id);
  if (sock) users.set(next.id, { id: next.id, name: next.name, tableId: table.id, role: 'player', seatIndex: seat });
  table.message = `${next.name} took seat ${seat + 1}.`;
  return true;
}

function loserContinueWatching(table, socketId) {
  const user = users.get(socketId);
  if (!user || user.tableId !== table.id || user.role !== 'player') return;
  const seat = user.seatIndex;
  const p = table.players[seat];
  if (!p || !p.lost || !table.openSeats.includes(seat)) return privateError(socketId, 'You are not eliminated.');
  table.players[seat] = null;
  table.openSeats = table.openSeats.filter(s => s !== seat);
  table.spectators.push({ id: socketId, name: p.name, bot: false });
  users.set(socketId, { id: socketId, name: p.name, tableId: table.id, role: 'spectator', seatIndex: null });
  table.message = `${p.name} is now watching. First watcher in queue can take the seat.`;
  if (table.players.every(Boolean) && table.openSeats.length === 0) setTimeout(() => startRound(table), 2500);
  broadcastAll();
}

function spectatorTakeSeat(table, socketId) {
  const user = users.get(socketId);
  if (!user || user.tableId !== table.id || user.role !== 'spectator') return;
  if (!table.openSeats.length) return privateError(socketId, 'No seat is open now.');
  if (!table.spectators[0] || table.spectators[0].id !== socketId) return privateError(socketId, 'Wait for your turn in the spectator queue.');
  const seat = table.openSeats.shift();
  const s = table.spectators.shift();
  table.players[seat] = createPlayer(s.id, s.name, false);
  table.players[seat].score = 0;
  users.set(socketId, { id: socketId, name: s.name, tableId: table.id, role: 'player', seatIndex: seat });
  table.message = `${s.name} joined seat ${seat + 1}.`;
  if (table.players.every(Boolean) && table.openSeats.length === 0) setTimeout(() => startRound(table), 2500);
  broadcastAll();
}


function tableHumanPlayers(table) {
  return table.players.filter(p => p && !p.bot);
}

function tableHasBots(table) {
  return table.players.some(p => p && p.bot);
}

function tableHumanCount(table) {
  return tableHumanPlayers(table).length + table.spectators.filter(s => !s.bot).length;
}

function resetTableToWaiting(table, message = 'Game ended. Waiting for players.') {
  table.players = Array(SEATS).fill(null);
  table.spectators = [];
  table.state = 'waiting';
  table.currentTurn = 0;
  table.firstMove = false;
  table.startRequires3D = false;
  table.nextStarterSeat = null;
  table.lastPlay = null;
  table.lastRound = null;
  table.passes = [];
  table.openSeats = [];
  table.endGameVotes = [];
  table.round = 0;
  table.message = message;
  table.lastActionAt = Date.now();
}

function removeBotsIfNoHumans(table) {
  const humanPlayers = table.players.filter(p => p && !p.bot).length;
  const humanSpectators = table.spectators.filter(s => !s.bot).length;

  if (humanPlayers !== 0) return false;

  // If only bots are seated, end the game. Spectators can stay by reopening/joining the table.
  if (table.players.some(p => p && p.bot) || table.state === 'playing') {
    resetTableToWaiting(table, 'No human players remain. Bots left and the game ended.');
    return true;
  }

  if (humanSpectators === 0) {
    resetTableToWaiting(table, 'Everyone left. Bots left and the game ended.');
    return true;
  }

  return false;
}

function resetEndGameVotes(table) {
  table.endGameVotes = table.endGameVotes.filter(id => table.players.some(p => p && !p.bot && p.id === id));
}


function leaveGameNow(socket) {
  const user = users.get(socket.id);
  if (!user) return;

  const table = tables.get(user.tableId);
  if (!table) {
    users.delete(socket.id);
    return;
  }

  socket.leave(table.id);

  if (user.role === 'spectator') {
    table.spectators = table.spectators.filter(s => s.id !== socket.id);
    users.delete(socket.id);
    table.message = `${user.name} left the table.`;
    removeBotsIfNoHumans(table);
    cleanupEmptyTables();
    broadcastAll();
    return;
  }

  const seat = user.seatIndex;
  const p = table.players[seat];

  table.endGameVotes = (table.endGameVotes || []).filter(id => id !== socket.id);

  if (p && p.id === socket.id) {
    const remainingHumanPlayers = table.players.filter((player, idx) => player && !player.bot && idx !== seat).length;

    if (remainingHumanPlayers === 0) {
      resetTableToWaiting(table, `${user.name} left. No human players remain, so bots left and the game ended.`);
      users.delete(socket.id);
      cleanupEmptyTables();
      broadcastAll();
      return;
    }

    if (table.state === 'playing') {
      const botId = `bot-${botCounter++}`;
      p.id = botId;
      p.name = `${user.name} Bot`;
      p.bot = true;
      p.connected = false;
      p.lost = false;
      table.message = `${user.name} left. A bot continues the seat, and another player can take it.`;
      scheduleBotIfNeeded(table);
    } else {
      table.players[seat] = null;
      table.openSeats = table.openSeats.filter(s => s !== seat);
      fillOpenSeatFromQueue(table, seat);
      table.message = `${user.name} left the table.`;
      maybeStartRound(table);
    }
  }

  users.delete(socket.id);
  cleanupEmptyTables();
  broadcastAll();
}


function playerVoteEndGame(table, socketId) {
  const user = users.get(socketId);
  if (!user || user.tableId !== table.id || user.role !== 'player') return privateError(socketId, 'You are not playing at this table.');

  const player = table.players[user.seatIndex];
  if (!player || player.bot) return privateError(socketId, 'Only human players can vote to end the game.');

  resetEndGameVotes(table);
  if (!table.endGameVotes.includes(socketId)) table.endGameVotes.push(socketId);

  const humans = tableHumanPlayers(table);
  const needed = humans.length;
  const votes = table.endGameVotes.length;

  if (needed > 0 && votes >= needed) {
    const sockets = io.sockets.adapter.rooms.get(table.id);
    if (sockets) {
      for (const sid of sockets) {
        const u = users.get(sid);
        if (u && u.tableId === table.id) {
          users.set(sid, { id: sid, name: u.name, tableId: table.id, role: 'spectator', seatIndex: null });
        }
      }
    }
    resetTableToWaiting(table, 'All players confirmed. Game ended.');
  } else {
    table.message = `${player.name} voted to end the game (${votes}/${needed}).`;
  }

  broadcastAll();
}

function privateError(socketId, message) {
  const sock = io.sockets.sockets.get(socketId);
  if (sock) sock.emit('toast', { type: 'error', message });
}

function publicMessage(table, message) {
  table.message = message;
  broadcastAll();
}


function tableSeatInfo(table) {
  return table.players.map((p, idx) => p ? {
    seat: idx,
    name: p.name,
    bot: p.bot,
    score: p.score,
    cardCount: p.cards.length,
    lost: p.lost,
    isTurn: table.state === 'playing' && idx === table.currentTurn
  } : {
    seat: idx,
    name: null,
    bot: false,
    score: 0,
    cardCount: 0,
    empty: true,
    lost: false,
    isTurn: false
  });
}

function lobbyTables() {
  return [...tables.values()].map(t => ({
    id: t.id,
    state: t.state,
    round: t.round,
    seats: tableSeatInfo(t),
    players: t.players.filter(Boolean).length,
    humans: t.players.filter(p => p && !p.bot).length,
    bots: t.players.filter(p => p && p.bot).length,
    empty: t.players.filter(p => p === null).length,
    spectators: t.spectators.length,
    message: t.message
  }));
}

function sendLobby(socket) {
  socket.emit('lobbyState', { tables: lobbyTables() });
}

function broadcastLobby() {
  io.emit('lobbyState', { tables: lobbyTables() });
}

function viewFor(table, socketId) {
  const user = users.get(socketId);
  const role = user && user.tableId === table.id ? user.role : 'spectator';
  const seatIndex = user && user.tableId === table.id ? user.seatIndex : null;
  const queueIndex = table.spectators.findIndex(s => s.id === socketId);
  return {
    tableId: table.id,
    state: table.state,
    round: table.round,
    message: table.message,
    targetScore: TARGET_SCORE,
    role,
    seatIndex,
    queueIndex,
    canTakeSeat: role === 'spectator' && queueIndex === 0 && table.openSeats.length > 0,
    canContinueWatching: role === 'player' && table.players[seatIndex] && table.players[seatIndex].lost && table.openSeats.includes(seatIndex),
    canVoteEndGame: role === 'player' && tableHumanPlayers(table).length >= 1,
    endGameVotes: table.endGameVotes || [],
    endGameVoteCount: (table.endGameVotes || []).length,
    endGameVoteNeeded: tableHumanPlayers(table).length,
    hasVotedEndGame: !!(user && (table.endGameVotes || []).includes(user.id)),
    currentTurn: table.currentTurn,
    currentTurnName: table.players[table.currentTurn]?.name || '',
    firstMove: table.firstMove,
    startRequires3D: table.startRequires3D,
    highestAlert: highestAlertInfo(table),
    lastPlay: table.lastPlay ? {
      playerName: table.lastPlay.playerName,
      label: table.lastPlay.hand.label,
      group: table.lastPlay.hand.group,
      cards: table.lastPlay.cards,
      effect: table.lastPlay.effect || 'normal'
    } : null,
    lastRound: table.lastRound || null,
    openSeats: table.openSeats,
    spectators: table.spectators.map((s, idx) => ({ name: s.name, index: idx + 1 })),
    tables: [...tables.values()].map(t => ({
      id: t.id,
      state: t.state,
      players: t.players.filter(Boolean).length,
      humans: t.players.filter(p => p && !p.bot).length,
      bots: t.players.filter(p => p && p.bot).length,
      empty: t.players.filter(p => p === null).length,
      spectators: t.spectators.length,
      round: t.round,
      seats: tableSeatInfo(t)
    })),
    players: table.players.map((p, idx) => p ? {
      seat: idx,
      name: p.name,
      bot: p.bot,
      score: p.score,
      cardCount: p.cards.length,
      connected: p.connected,
      lost: p.lost,
      isTurn: table.state === 'playing' && idx === table.currentTurn
    } : null),
    myCards: role === 'player' && table.players[seatIndex] ? table.players[seatIndex].cards.map(cardId) : []
  };
}

function broadcastTable(table) {
  const sockets = io.sockets.adapter.rooms.get(table.id);
  if (!sockets) return;
  for (const socketId of sockets) {
    io.to(socketId).emit('state', viewFor(table, socketId));
  }
}
function broadcastAll() {
  for (const table of tables.values()) broadcastTable(table);
  broadcastLobby();
}

function combo(arr, k) {
  const out = [];
  function rec(start, chosen) {
    if (chosen.length === k) { out.push([...chosen]); return; }
    for (let i = start; i <= arr.length - (k - chosen.length); i++) {
      chosen.push(arr[i]); rec(i + 1, chosen); chosen.pop();
    }
  }
  rec(0, []);
  return out;
}

function allValidHands(cards, group) {
  const ids = cards.map(cardId);
  const sizes = group ? ({ single: [1], pair: [2], triplet: [3], five: [5] }[group] || []) : [1, 2, 3, 5];
  const hands = [];
  for (const size of sizes) {
    for (const c of combo(ids, size)) {
      const h = evaluateHand(c);
      if (h && (!group || h.group === group)) hands.push(h);
    }
  }
  return hands.sort((a, b) => comparePower(a.power, b.power));
}

function botDangerLevel(table, seat) {
  const opponents = table.players
    .map((p, idx) => ({ p, idx }))
    .filter(x => x.p && x.idx !== seat);

  if (opponents.some(x => x.p.cards.length === 1)) return 3;
  if (opponents.some(x => x.p.cards.length === 2)) return 2;
  if (opponents.some(x => x.p.cards.length <= 4 && !x.p.bot)) return 1;
  return 0;
}

function createsGoodEnding(player, hand) {
  const remaining = player.cards.length - hand.cards.length;
  return remaining === 0 || remaining === 1 || remaining === 2 || remaining === 5;
}

function chooseBotHand(table, seat) {
  const p = table.players[seat];
  if (!p) return null;

  const group = table.lastPlay ? table.lastPlay.hand.group : null;
  let hands = allValidHands(p.cards, group);

  if (table.firstMove && table.startRequires3D) hands = hands.filter(h => h.cards.includes('3D'));
  if (table.lastPlay) hands = hands.filter(h => beats(h, table.lastPlay));
  if (!hands.length) return null;

  if (isHighestForcedTurn(table, seat)) {
    return strongestLegalHandForTurn(table, seat);
  }

  // Finish whenever possible.
  const finish = hands.find(h => h.cards.length === p.cards.length);
  if (finish) return finish;

  const danger = botDangerLevel(table, seat);

  // Following another hand.
  if (table.lastPlay) {
    const weakest = [...hands].sort((a, b) => comparePower(a.power, b.power))[0];
    const strongest = [...hands].sort((a, b) => comparePower(b.power, a.power))[0];

    // If someone is close to finishing, block hard.
    if (danger >= 2) return strongest;

    // If bot has many cards, it should participate more and not pass too often.
    const goodEndings = hands.filter(h => createsGoodEnding(p, h)).sort((a, b) => comparePower(a.power, b.power));
    if (goodEndings.length && Math.random() < 0.65) return goodEndings[0];

    // Save only very strong five-card hands sometimes, otherwise play.
    if (weakest.group === 'five' && p.cards.length > 7 && Math.random() < 0.10) return null;

    // Sometimes pressure with a stronger legal hand.
    if (Math.random() < 0.22) return strongest;

    return weakest;
  }

  // Leading the trick: choose varied combinations and reduce cards faster.
  if (table.firstMove) return hands[0];

  const groups = {
    five: hands.filter(h => h.group === 'five').sort((a, b) => comparePower(a.power, b.power)),
    triplet: hands.filter(h => h.group === 'triplet').sort((a, b) => comparePower(a.power, b.power)),
    pair: hands.filter(h => h.group === 'pair').sort((a, b) => comparePower(a.power, b.power)),
    single: hands.filter(h => h.group === 'single').sort((a, b) => comparePower(a.power, b.power))
  };

  // If opponents are close to winning, lead stronger/larger.
  if (danger >= 2) {
    if (groups.five.length) return groups.five[Math.floor(groups.five.length * 0.65)] || groups.five[groups.five.length - 1];
    if (groups.triplet.length) return groups.triplet[groups.triplet.length - 1];
    if (groups.pair.length) return groups.pair[groups.pair.length - 1];
    return groups.single[groups.single.length - 1];
  }

  // Prefer hands that leave a useful number of cards.
  const goodEndings = hands
    .filter(h => createsGoodEnding(p, h))
    .sort((a, b) => b.cards.length - a.cards.length || comparePower(a.power, b.power));
  if (goodEndings.length && Math.random() < 0.45) return goodEndings[0];

  const options = [];
  if (groups.five.length) options.push({ chance: p.cards.length >= 8 ? 0.48 : 0.30, list: groups.five });
  if (groups.triplet.length) options.push({ chance: 0.22, list: groups.triplet });
  if (groups.pair.length) options.push({ chance: 0.24, list: groups.pair });
  if (groups.single.length) options.push({ chance: p.cards.length <= 4 ? 0.22 : 0.06, list: groups.single });

  const total = options.reduce((sum, o) => sum + o.chance, 0);
  let r = Math.random() * total;
  for (const opt of options) {
    r -= opt.chance;
    if (r <= 0) {
      // Weakest inside chosen group, but not always the absolute weakest.
      const index = Math.random() < 0.25 ? Math.min(opt.list.length - 1, 1) : 0;
      return opt.list[index];
    }
  }

  return hands.sort((a, b) => b.cards.length - a.cards.length || comparePower(a.power, b.power))[0];
}

function scheduleBotIfNeeded(table) {
  if (table.state !== 'playing') return;
  const p = table.players[table.currentTurn];
  if (!p || !p.bot) return;
  setTimeout(() => {
    if (table.state !== 'playing') return;
    const current = table.players[table.currentTurn];
    if (!current || !current.bot || current.id !== p.id) return;
    const chosen = chooseBotHand(table, table.currentTurn);
    if (chosen) botPlayHand(table, table.currentTurn, chosen.cards);
    else botPass(table, table.currentTurn);
  }, 900 + Math.random() * 700);
}

function botPlayHand(table, seat, selectedIds) {
  const player = table.players[seat];
  const hand = evaluateHand(selectedIds);
  player.cards = player.cards.filter(c => !selectedIds.includes(cardId(c)));
  table.lastPlay = { playerIndex: seat, playerName: player.name, hand, cards: hand.cards, effect: 'normal', at: Date.now() };
  table.passes = [];
  table.firstMove = false;
  table.message = `${player.name} played ${hand.label}.`;
  if (player.cards.length === 0) finishRound(table, seat);
  else table.currentTurn = nextSeat(table, seat);
  broadcastAll();
  scheduleBotIfNeeded(table);
}

function botPass(table, seat) {
  if (!table.lastPlay) {
    const chosen = chooseBotHand(table, seat);
    if (chosen) return botPlayHand(table, seat, chosen.cards);
  }
  if (!table.passes.includes(seat)) table.passes.push(seat);
  table.message = `${table.players[seat].name} passed.`;
  const active = getActiveSeatCount(table);
  if (table.passes.length >= active - 1) {
    const leader = table.lastPlay.playerIndex;
    table.lastPlay = null;
    table.passes = [];
    table.currentTurn = leader;
    table.message = `${table.players[leader].name} controls the table and can choose a new hand.`;
  } else {
    table.currentTurn = nextSeat(table, seat);
  }
  broadcastAll();
  scheduleBotIfNeeded(table);
}

function tableBySocket(socket) {
  const user = users.get(socket.id);
  if (!user) return null;
  return tables.get(user.tableId) || null;
}

io.on('connection', socket => {
  sendLobby(socket);
  socket.on('getLobby', () => sendLobby(socket));

  socket.on('join', ({ name }) => {
    const old = users.get(socket.id);
    if (old) socket.leave(old.tableId);
    const tableId = addHumanToTable(socket, name);
    socket.emit('joined', { tableId });
  });

  socket.on('playHand', ({ cards, smash }) => {
    const table = tableBySocket(socket);
    if (table) playHand(table, socket.id, cards, { smash: !!smash });
  });

  socket.on('pass', () => {
    const table = tableBySocket(socket);
    if (table) passTurn(table, socket.id);
  });

  socket.on('addBot', () => {
    const table = tableBySocket(socket);
    if (!table) return;
    if (addBot(table)) broadcastAll();
    else privateError(socket.id, 'Bot can be added only when there is an empty seat and the game is not currently playing.');
  });

  socket.on('continueWatching', () => {
    const table = tableBySocket(socket);
    if (table) loserContinueWatching(table, socket.id);
  });

  socket.on('takeSeat', () => {
    const table = tableBySocket(socket);
    if (table) spectatorTakeSeat(table, socket.id);
  });

  socket.on('createNewTable', ({ name }) => {
    const tableId = createNewTableForSocket(socket, name);
    socket.emit('joined', { tableId });
  });

  socket.on('joinTableAsPlayer', ({ tableId, name }) => {
    const joinedTableId = joinSpecificTableAsPlayer(socket, tableId, name);
    if (joinedTableId) socket.emit('joined', { tableId: joinedTableId });
  });

  socket.on('watchTable', ({ tableId, name }) => {
    const target = tables.get(tableId);
    if (!target) return privateError(socket.id, 'Table not found.');

    const current = users.get(socket.id);
    const clean = cleanName(name || current?.name || `Player ${Math.floor(Math.random() * 1000)}`);

    detachSocketFromCurrentTable(socket);
    socket.join(target.id);
    target.spectators.push({ id: socket.id, name: clean, bot: false });
    users.set(socket.id, { id: socket.id, name: clean, tableId: target.id, role: 'spectator', seatIndex: null });
    publicMessage(target, `${clean} is watching.`);
    socket.emit('joined', { tableId: target.id });
  });

  socket.on('leaveGame', () => {
    leaveGameNow(socket);
  });

  socket.on('voteEndGame', () => {
    const table = tableBySocket(socket);
    if (table) playerVoteEndGame(table, socket.id);
  });

  socket.on('switchTable', ({ tableId }) => {
    const current = users.get(socket.id);
    const target = tables.get(tableId);
    if (!current || !target) return;
    const name = current.name;
    detachSocketFromCurrentTable(socket);
    socket.join(target.id);
    target.spectators.push({ id: socket.id, name, bot: false });
    users.set(socket.id, { id: socket.id, name, tableId: target.id, role: 'spectator', seatIndex: null });
    publicMessage(target, `${name} is watching.`);
    socket.emit('joined', { tableId: target.id });
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (!user) return;
    const table = tables.get(user.tableId);
    if (table) removeSocketFromTable(socket.id, table, true);
    users.delete(socket.id);
    cleanupEmptyTables();
    broadcastAll();
  });
});

function removeSocketFromTable(socketId, table, disconnected) {
  const user = users.get(socketId);
  if (!user) return;

  table.endGameVotes = (table.endGameVotes || []).filter(id => id !== socketId);

  if (user.role === 'spectator') {
    table.spectators = table.spectators.filter(s => s.id !== socketId);
    removeBotsIfNoHumans(table);
    return;
  }

  const seat = user.seatIndex;
  const p = table.players[seat];
  if (!p || p.id !== socketId) {
    removeBotsIfNoHumans(table);
    return;
  }

  if (table.state === 'playing') {
    // Keep the game moving only if at least one human remains.
    const humanCountAfterLeave = table.players.filter((player, idx) => player && !player.bot && idx !== seat).length;

    if (humanCountAfterLeave === 0) {
      resetTableToWaiting(table, 'Everyone left. Bots left and the game ended.');
      return;
    }

    const botId = `bot-${botCounter++}`;
    p.id = botId;
    p.name = `${p.name} Bot`;
    p.bot = true;
    p.connected = false;
    table.message = disconnected ? `${user.name} disconnected; a bot continues the seat.` : `${user.name} left; a bot continues the seat.`;
    scheduleBotIfNeeded(table);
  } else {
    table.players[seat] = null;
    table.openSeats = table.openSeats.filter(s => s !== seat);
    fillOpenSeatFromQueue(table, seat);
    maybeStartRound(table);
    removeBotsIfNoHumans(table);
  }
}

function cleanupEmptyTables() {
  for (const [id, table] of tables.entries()) {
    removeBotsIfNoHumans(table);
    const humans = tableHumanCount(table);
    if (tables.size > 1 && humans === 0) tables.delete(id);
  }
  if (tables.size === 0) newTable();
}

newTable();
server.listen(PORT, () => console.log(`Chinese Poker Live running on :${PORT}`));
