/* ============================================================================
   BIG TWO — rules engine (pure, no DOM)
   ----------------------------------------------------------------------------
   All game rules live here so they can be unit-tested in isolation. Every
   function is pure: it takes the game state (+ seat metadata) and returns a
   result or a new state, never touching the DOM, network, or globals.

   Card:  { r: '3'..'2', s: 'D'|'C'|'H'|'S', id: 'RS' }
   Seat:  { uid, name, avatar, avatarImg, isBot } | null   (index 0..3)

   Exposed as `window.BigTwo` in the browser and as a CommonJS module in Node.
   ========================================================================== */
(function (root) {
  'use strict';

  const TARGET_SCORE = 101;
  const SUITS = ['D', 'C', 'H', 'S'];                 // ascending suit strength
  const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const SUIT_SYMBOL = { D: '♦', C: '♣', H: '♥', S: '♠' };
  const RANK_VALUE = Object.fromEntries(RANKS.map((r, i) => [r, i]));

  // Absolute strength of a single card: rank first, suit as tie-breaker.
  const cardValue = (card) => RANK_VALUE[card.r] * 4 + SUITS.indexOf(card.s);
  const isRed = (card) => card.s === 'D' || card.s === 'H';
  const has3D = (cards) => cards.some((c) => c.r === '3' && c.s === 'D');

  // -------------------------------- Deck --------------------------------
  function makeDeck() {
    const deck = [];
    for (const r of RANKS) for (const s of SUITS) deck.push({ r, s, id: `${r}${s}` });
    return deck;
  }

  // Fisher–Yates. Accepts an injectable rng for deterministic tests.
  function shuffle(array, rng = Math.random) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function sortCards(cards) {
    return cards.sort((a, b) => cardValue(a) - cardValue(b));
  }

  // Sort a hand for display. 'rank' groups by rank (default), 'suit' groups by suit.
  function sortHand(cards, mode = 'rank') {
    const copy = [...cards];
    if (mode === 'suit') {
      return copy.sort((a, b) =>
        SUITS.indexOf(a.s) - SUITS.indexOf(b.s) || RANK_VALUE[a.r] - RANK_VALUE[b.r]);
    }
    return sortCards(copy);
  }

  // ---------------------------- Combinations ----------------------------
  function countsByRank(cards) {
    return cards.reduce((acc, c) => { acc[c.r] = (acc[c.r] || 0) + 1; return acc; }, {});
  }
  const highSuitIndex = (cards) => Math.max(...cards.map((c) => SUITS.indexOf(c.s)));
  const highSuitOfRank = (cards, rank) =>
    Math.max(...cards.filter((c) => c.r === rank).map((c) => SUITS.indexOf(c.s)));

  function isStraight(ranks) {
    const unique = [...new Set(ranks)].sort((a, b) => a - b);
    if (unique.length !== 5) return false;
    if (unique.includes(RANK_VALUE['2'])) return false; // 2 is kept out of straights (house rule)
    for (let i = 1; i < unique.length; i++) if (unique[i] !== unique[i - 1] + 1) return false;
    return true;
  }
  const straightHighRank = (ranks) => Math.max(...ranks.filter((v) => v !== RANK_VALUE['2']));
  function straightHigh(ranks, cards) {
    const high = straightHighRank(ranks);
    return high * 4 + highSuitIndex(cards.filter((c) => RANK_VALUE[c.r] === high));
  }

  /**
   * Classify a selection of cards into a Big Two combo, or null if illegal.
   * `power` is a single comparable number; higher always beats lower *within
   * the same size*. Five-card categories are ranked by a +100 base offset so
   * that e.g. any full house (600+) beats any flush (500+).
   */
  function analyzeCombo(cards) {
    if (!cards || !cards.length) return null;
    const sorted = sortCards([...cards]);
    const n = sorted.length;

    if (n === 1) {
      return { type: 'single', size: 1, rank: RANK_VALUE[sorted[0].r], power: cardValue(sorted[0]) };
    }

    const rankCounts = countsByRank(sorted);
    const counts = Object.values(rankCounts).sort((a, b) => b - a);
    const ranks = Object.keys(rankCounts).map((r) => RANK_VALUE[r]).sort((a, b) => a - b);

    if (n === 2 && counts[0] === 2) {
      return { type: 'pair', size: 2, rank: ranks[0], power: 100 + ranks[0] * 4 + highSuitIndex(sorted) };
    }
    if (n === 3 && counts[0] === 3) {
      return { type: 'triplet', size: 3, rank: ranks[0], power: 200 + ranks[0] * 4 + highSuitIndex(sorted) };
    }
    if (n !== 5) return null;

    const flush = sorted.every((c) => c.s === sorted[0].s);
    const straight = isStraight(ranks);
    const groups = Object.entries(rankCounts)
      .map(([r, count]) => ({ r, rv: RANK_VALUE[r], count }))
      .sort((a, b) => b.count - a.count || b.rv - a.rv);

    if (straight && flush) return { type: 'straightFlush', size: 5, rank: straightHighRank(ranks), power: 800 + straightHigh(ranks, sorted) };
    if (counts[0] === 4) return { type: 'fourKind', size: 5, rank: groups[0].rv, power: 700 + groups[0].rv * 4 + highSuitOfRank(sorted, groups[0].r) };
    if (counts[0] === 3 && counts[1] === 2) return { type: 'fullHouse', size: 5, rank: groups[0].rv, power: 600 + groups[0].rv * 4 + highSuitOfRank(sorted, groups[0].r) };
    if (flush) return { type: 'flush', size: 5, rank: Math.max(...ranks), power: 500 + Math.max(...sorted.map(cardValue)) };
    if (straight) return { type: 'straight', size: 5, rank: straightHighRank(ranks), power: 400 + straightHigh(ranks, sorted) };
    return null;
  }

  function comboLabel(combo) {
    if (!combo) return 'hand';
    return {
      single: 'single', pair: 'pair', triplet: 'triplet', straight: 'straight', flush: 'flush',
      fullHouse: 'full house', fourKind: 'four of a kind', straightFlush: 'straight flush',
    }[combo.type] || combo.type;
  }

  // A "bomb" — the two categories that carry special visual flair.
  const isBomb = (combo) => combo && (combo.type === 'fourKind' || combo.type === 'straightFlush');

  function beats(combo, lastCombo) {
    if (!combo || !lastCombo) return false;
    if (combo.size !== lastCombo.size) return false;
    return combo.power > lastCombo.power;
  }

  // ------------------------------ Turn order ------------------------------
  function nextActiveSeat(fromSeat, state, seats) {
    for (let step = 1; step <= 4; step++) {
      const idx = (fromSeat + step) % 4;
      if (seats[idx] && (state.hands[idx] || []).length > 0) return idx;
    }
    return fromSeat;
  }

  const firstOccupiedSeat = (seats) => {
    const i = seats.findIndex(Boolean);
    return i === -1 ? 0 : i;
  };

  // ------------------------------ Dealing ------------------------------
  function dealNewRound(seats, scores, dealNo, starterOverride, rng = Math.random) {
    const deck = shuffle(makeDeck(), rng);
    const hands = [[], [], [], []];
    for (let i = 0; i < deck.length; i++) hands[i % 4].push(deck[i]);
    hands.forEach(sortCards);

    let current;
    if (Number.isInteger(starterOverride)) {
      current = starterOverride;
    } else {
      current = hands.findIndex((h) => h.some((c) => c.r === '3' && c.s === 'D'));
      if (current < 0) current = firstOccupiedSeat(seats);
    }

    return {
      version: 3,
      phase: 'playing',
      targetScore: TARGET_SCORE,
      deal: dealNo,
      scores: [...scores],
      hands,
      current,
      starter: current,
      lastPlay: null,
      passes: [false, false, false, false],
      opened: false,        // has any card been played this deal?
      winner: null,
      champion: null,
      loser: null,
      events: [],
      message: 'No cards in play — lead any combo.',
    };
  }

  // Must the very first lead of the game contain the 3♦?
  function requiresDiamondThree(state) {
    return state.deal === 1 && !state.opened;
  }

  /**
   * Can `seat` legally play `cards` right now? Returns { ok, reason, combo }.
   * Pure: depends only on the passed state + seat metadata.
   */
  function validatePlay(state, seats, seat, cards) {
    const combo = analyzeCombo(cards);
    if (!combo) return { ok: false, reason: 'Not a legal combination.', combo: null };

    if (requiresDiamondThree(state) && seat === state.starter && !has3D(cards)) {
      return { ok: false, reason: 'The first play of the game must include 3♦.', combo };
    }
    if (!state.lastPlay) return { ok: true, combo };            // free lead
    if (state.lastPlay.seat === seat) return { ok: true, combo }; // regained control → free lead
    if (combo.size !== state.lastPlay.combo.size) {
      return { ok: false, reason: `Play ${state.lastPlay.combo.size} card(s) or pass.`, combo };
    }
    if (beats(combo, state.lastPlay.combo)) return { ok: true, combo };
    return { ok: false, reason: 'That hand is not strong enough.', combo };
  }

  const canPass = (state, seat) => !!state.lastPlay && state.lastPlay.seat !== seat;

  // -------------------------- State transitions --------------------------
  function clone(state) {
    return typeof structuredClone === 'function' ? structuredClone(state) : JSON.parse(JSON.stringify(state));
  }

  function applyPlay(state, seats, seat, cards, opts = {}) {
    const now = opts.now ?? Date.now();
    const next = clone(state);
    const ids = new Set(cards.map((c) => c.id));
    const combo = analyzeCombo(cards);

    next.hands[seat] = next.hands[seat].filter((c) => !ids.has(c.id));
    next.lastPlay = { id: 'P' + now + '_' + seat, seat, cards: sortCards([...cards]), combo };
    next.passes = [false, false, false, false];
    next.opened = true;
    next.message = '';

    if (next.hands[seat].length === 0) {
      next.phase = 'roundOverPending';
      next.winner = seat;
      next.roundOverAt = now + 1050;
    } else {
      next.current = nextActiveSeat(seat, next, seats);
    }
    return next;
  }

  function applyPass(state, seats, seat) {
    const next = clone(state);
    next.passes[seat] = true;
    const lastSeat = next.lastPlay?.seat;
    const active = seats.map((p, i) => (p && next.hands[i]?.length > 0 ? i : -1)).filter((i) => i >= 0);
    const allOthersPassed = active.filter((i) => i !== lastSeat).every((i) => next.passes[i]);

    if (allOthersPassed && Number.isInteger(lastSeat)) {
      next.current = lastSeat;
      next.lastPlay = null;
      next.passes = [false, false, false, false];
      next.message = `${seats[lastSeat]?.name || 'Player'} takes control. Free lead.`;
    } else {
      next.current = nextActiveSeat(seat, next, seats);
      next.message = `${seats[seat]?.name || 'Player'} passed.`;
    }
    return next;
  }

  // Penalty for the cards left in a losing hand (house rule doubling).
  function penaltyFor(n) {
    if (n === 13) return 39;
    if (n >= 10) return n * 3;
    if (n >= 5) return n * 2;
    return n;
  }

  function finalizeRound(state, seats) {
    const next = clone(state);
    const winner = next.winner;
    const penalties = [0, 0, 0, 0];
    const scores = [...next.scores];

    next.hands.forEach((hand, i) => {
      if (i === winner || !seats[i]) return;
      penalties[i] = penaltyFor(hand.length);
      scores[i] = (scores[i] || 0) + penalties[i];
    });

    next.scores = scores;
    next.penalties = penalties;
    next.phase = scores.some((s) => s >= (next.targetScore || TARGET_SCORE)) ? 'gameOver' : 'roundOver';
    next.loser = scores.indexOf(Math.max(...scores));
    next.champion = scores.indexOf(Math.min(...scores));
    next.nextStarter = winner;
    return next;
  }

  // ------------------------------- Bot AI -------------------------------
  // Enumerate every combination of exactly `size` cards from a hand.
  function combinationsOfSize(cards, size) {
    const sorted = sortCards([...cards]);
    const out = [];
    const path = [];
    (function rec(start) {
      if (path.length === size) { out.push(path.map((i) => sorted[i])); return; }
      for (let i = start; i <= sorted.length - (size - path.length); i++) {
        path.push(i); rec(i + 1); path.pop();
      }
    })(0);
    return out;
  }

  function legalPlaysOfSize(hand, size) {
    return combinationsOfSize(hand, size)
      .map((cards) => ({ cards, combo: analyzeCombo(cards) }))
      .filter((x) => x.combo);
  }

  function chooseBotLead(hand, mustInclude3D, rng = Math.random) {
    const sorted = sortCards([...hand]);
    if (mustInclude3D) {
      const c = sorted.find((x) => x.r === '3' && x.s === 'D');
      return c ? [c] : [sorted[0]];
    }
    const counts = countsByRank(sorted);
    // Occasionally shed a small multi-card combo to reduce the hand faster.
    const roll = rng();
    if (roll < 0.14) { const p = legalPlaysOfSize(sorted, 2); if (p.length) return p[0].cards; }
    else if (roll < 0.20) { const t = legalPlaysOfSize(sorted, 3); if (t.length) return t[0].cards; }
    else if (roll < 0.25) { const f = legalPlaysOfSize(sorted, 5).sort((a, b) => a.combo.power - b.combo.power); if (f.length) return f[0].cards; }
    // Otherwise dump the lowest card that is not tied up in a pair/triplet.
    const lone = sorted.find((c) => counts[c.r] === 1);
    return [lone || sorted[0]];
  }

  function chooseBotResponse(hand, lastCombo, rng = Math.random) {
    const options = legalPlaysOfSize(hand, lastCombo.size)
      .filter((x) => beats(x.combo, lastCombo))
      .sort((a, b) => a.combo.power - b.combo.power);
    if (!options.length) return null;
    // Play the weakest winning hand; get more aggressive when almost out of cards.
    const idx = hand.length <= 4 && options.length > 1 ? Math.min(1, options.length - 1) : 0;
    return options[idx].cards;
  }

  // Decide a bot's move: returns { cards } to play, or { pass: true }.
  function botDecide(state, seats, seat, rng = Math.random) {
    const hand = state.hands[seat] || [];
    if (!hand.length) return { pass: true };
    if (!state.lastPlay) {
      const must = requiresDiamondThree(state) && seat === state.starter;
      return { cards: chooseBotLead(hand, must, rng) };
    }
    const cards = chooseBotResponse(hand, state.lastPlay.combo, rng);
    return cards ? { cards } : { pass: true };
  }

  const api = {
    TARGET_SCORE, SUITS, RANKS, SUIT_SYMBOL, RANK_VALUE,
    cardValue, isRed, has3D,
    makeDeck, shuffle, sortCards, sortHand,
    analyzeCombo, comboLabel, isBomb, beats,
    nextActiveSeat, dealNewRound, requiresDiamondThree,
    validatePlay, canPass, applyPlay, applyPass, penaltyFor, finalizeRound,
    botDecide, chooseBotLead, chooseBotResponse, legalPlaysOfSize,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BigTwo = api;
})(typeof window !== 'undefined' ? window : globalThis);
