// ─── ui/highScores.js ────────────────────────────────────────────────────────
import { loadJSON, saveJSON } from './storage.js';

const KEY = 'capsuleHavoc.highScores.v1';
const MAX = 10;

// Define ordering: more kills is better; tie-breaker is shorter time; then more coins.
function compare(a, b) {
  if (b.kills !== a.kills) return b.kills - a.kills;
  if (a.elapsed !== b.elapsed) return a.elapsed - b.elapsed;
  return b.coins - a.coins;
}

export function getHighScores() {
  const list = loadJSON(KEY, []);
  return Array.isArray(list) ? list : [];
}

export function clearHighScores() {
  saveJSON(KEY, []);
}

export function recordRun({ kills, elapsed, coins, victory }) {
  const list = getHighScores();
  const entry = {
    kills: Number(kills) || 0,
    elapsed: Number(elapsed) || 0,
    coins: Number(coins) || 0,
    victory: !!victory,
    ts: Date.now()
  };
  list.push(entry);
  list.sort(compare);
  saveJSON(KEY, list.slice(0, MAX));
}
