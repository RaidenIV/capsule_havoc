// ─── ui/scores.js ───────────────────────────────────────────────────────────
import { getHighScores } from './highScores.js';
import { formatTime } from '../gameFlow.js';

function fmtDate(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { year:'2-digit', month:'2-digit', day:'2-digit' }) + ' ' +
           d.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
  } catch { return ''; }
}

export function renderHighScores(listEl) {
  const scores = getHighScores();
  listEl.innerHTML = '';

  if (!scores.length) {
    const empty = document.createElement('div');
    empty.className = 'menu-muted';
    empty.textContent = 'No runs recorded yet.';
    listEl.appendChild(empty);
    return;
  }

  scores.forEach((s, i) => {
    const row = document.createElement('div');
    row.className = 'score-row';
    row.innerHTML = `
      <div class="score-rank">#${i+1}</div>
      <div class="score-main">
        <div class="score-line">
          <span class="score-kills">${s.kills}</span>
          <span class="score-label">kills</span>
          <span class="score-sep">•</span>
          <span class="score-time">${formatTime(s.elapsed)}</span>
          <span class="score-sep">•</span>
          <span class="score-coins">${s.coins}</span>
          <span class="score-label">coins</span>
        </div>
        <div class="score-sub">
          <span class="score-tag ${s.victory ? 'victory' : 'destroyed'}">${s.victory ? 'VICTORY' : 'DESTROYED'}</span>
          <span class="score-date">${fmtDate(s.ts)}</span>
        </div>
      </div>
    `;
    listEl.appendChild(row);
  });
}
