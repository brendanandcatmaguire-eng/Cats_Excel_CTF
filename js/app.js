'use strict';

// ── Leaderboard config ────────────────────────────────────────────────────────
// Paste your Google Apps Script web app URL here to enable the leaderboard.
// Leave as '' to run without a leaderboard (everything else still works).
const LEADERBOARD_URL = 'https://script.google.com/macros/s/AKfycbzmLEZz7H1m8b2F4jrbOQyK79i0jqb26iG7Y3SqMtBvn0aKcooEv1w0yQMD-su2f_B5JQ/exec';

// ── State ─────────────────────────────────────────────────────────────────────

const STATE_KEY = 'excelctf_v1';

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY)) || defaultState();
  } catch { return defaultState(); }
}

function defaultState() {
  return { score: 0, completed: [], hintsUsed: [], current: 'T1C1' };
}

function saveState(state) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

let state = loadState();
let playerName = localStorage.getItem('excelctf_name') || '';

// ── Unlock logic ──────────────────────────────────────────────────────────────

function isUnlocked(challenge) {
  const { id, tier } = challenge;
  if (id === 'T1C1') return true;

  const tierChallenges = CHALLENGES.filter(c => c.tier === tier);
  const idx = tierChallenges.findIndex(c => c.id === id);
  if (idx > 0 && state.completed.includes(tierChallenges[idx - 1].id)) return true;

  if (idx === 0 && tier > 1) {
    const prevTier = CHALLENGES.filter(c => c.tier === tier - 1);
    return prevTier.every(c => state.completed.includes(c.id));
  }
  return false;
}

function isCompleted(id) { return state.completed.includes(id); }

// ── Spreadsheet rendering ────────────────────────────────────────────────────

function colLetter(idx) { return String.fromCharCode(65 + idx); }

function cellRef(row, col) { return `${colLetter(col)}${row + 1}`; }

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function renderSpreadsheet(challenge) {
  const { tableData, targetRow, targetCol, currentFormula } = challenge;
  const numCols = Math.max(...tableData.map(r => r ? r.length : 0));
  const ref = cellRef(targetRow, targetCol);
  const formulaBarText = currentFormula || '';

  let html = `
    <div class="excel-wrap">
      <div class="formula-bar">
        <span class="cell-ref-box">${ref}</span>
        <span class="fx-label">fx</span>
        <span class="formula-bar-text${currentFormula ? ' has-formula' : ''}">${esc(formulaBarText)}</span>
      </div>
      <div class="sheet-scroll">
        <table class="sheet">
          <thead><tr><th class="corner"></th>`;

  for (let c = 0; c < numCols; c++) {
    html += `<th class="col-head${c === targetCol ? ' col-active' : ''}">${colLetter(c)}</th>`;
  }
  html += '</tr></thead><tbody>';

  tableData.forEach((row, rIdx) => {
    const isTargetRow = rIdx === targetRow;
    html += `<tr class="${isTargetRow ? 'target-row' : ''}">`;
    html += `<td class="row-num${isTargetRow ? ' row-active' : ''}">${rIdx + 1}</td>`;
    for (let c = 0; c < numCols; c++) {
      const isTarget = isTargetRow && c === targetCol;
      const val = row ? row[c] : null;
      let content = '';
      if (isTarget) {
        content = currentFormula
          ? `<span class="cell-formula">${esc(currentFormula)}</span>`
          : '<span class="cell-cursor">|</span>';
      } else {
        content = esc(val);
      }
      const cls = isTarget ? 'cell target-cell' : (rIdx === 0 ? 'cell header-cell' : 'cell');
      html += `<td class="${cls}">${content}</td>`;
    }
    html += '</tr>';
  });

  html += '</tbody></table></div></div>';
  return html;
}

// ── Formula validation ────────────────────────────────────────────────────────

function normalise(formula) {
  const f = formula.trim();
  return f.startsWith('=') ? f : '=' + f;
}

function validateWithHF(formula, tableData, targetRow, targetCol, expectedValue) {
  try {
    const data = tableData.map(row => row ? [...row] : []);
    while (data.length <= targetRow) data.push([]);
    while ((data[targetRow] || []).length <= targetCol) data[targetRow].push(null);
    data[targetRow][targetCol] = formula;

    const hf = HyperFormula.buildFromArray(data, { licenseKey: 'gpl-v3' });
    const raw = hf.getCellValue({ sheet: 0, row: targetRow, col: targetCol });
    hf.destroy();

    if (raw !== null && typeof raw === 'object' && raw.type) return false;

    if (typeof expectedValue === 'number' && typeof raw === 'number') {
      return Math.abs(raw - expectedValue) < 0.001;
    }
    if (typeof expectedValue === 'string' && typeof raw === 'string') {
      return raw.trim().toLowerCase() === expectedValue.trim().toLowerCase();
    }
    return raw === expectedValue;
  } catch (e) {
    console.warn('HF error:', e);
    return false;
  }
}

function validateAnswer(rawInput, challenge) {
  const formula = normalise(rawInput);
  const { validation, tableData, targetRow, targetCol } = challenge;

  if (validation.type === 'formula') {
    return validateWithHF(formula, tableData, targetRow, targetCol, validation.expectedValue);
  }

  if (validation.type === 'contains') {
    const upper = formula.toUpperCase().replace(/\s+/g, '');
    const structuralOk = (validation.mustContain || []).every(t => upper.includes(t.toUpperCase()));
    if (!structuralOk) return false;
    if (validation.expectedValue !== undefined && validation.fallbackType === 'formula') {
      try {
        return validateWithHF(formula, tableData, targetRow, targetCol, validation.expectedValue);
      } catch { return structuralOk; }
    }
    return structuralOk;
  }

  return false;
}

// ── Leaderboard ───────────────────────────────────────────────────────────────

function submitScore() {
  if (!LEADERBOARD_URL || !playerName) return;
  const url = `${LEADERBOARD_URL}?action=submit&name=${encodeURIComponent(playerName)}&score=${state.score}&completed=${state.completed.length}`;
  fetch(url).catch(() => {});
}

async function fetchLeaderboard() {
  if (!LEADERBOARD_URL) return null;
  try {
    const r = await fetch(`${LEADERBOARD_URL}?action=leaderboard`);
    return await r.json();
  } catch { return null; }
}

function showLeaderboard() {
  const modal = document.getElementById('lb-modal');
  if (modal) {
    modal.style.display = 'flex';
    loadLeaderboardContent();
  }
}

function hideLeaderboard() {
  const modal = document.getElementById('lb-modal');
  if (modal) modal.style.display = 'none';
}

async function loadLeaderboardContent() {
  const body = document.getElementById('lb-body');
  if (!body) return;

  if (!LEADERBOARD_URL) {
    body.innerHTML = `
      <div class="lb-no-url">
        <p>Leaderboard not configured yet.</p>
        <p class="lb-hint">The admin needs to connect a Google Sheet backend to enable this. Everything else works fine without it.</p>
      </div>`;
    return;
  }

  body.innerHTML = '<p class="lb-loading">Fetching scores…</p>';
  const data = await fetchLeaderboard();

  if (!data || !Array.isArray(data) || !data.length) {
    body.innerHTML = '<p class="lb-loading">No scores yet — be the first!</p>';
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const rows = data.map((entry, i) => {
    const isMe = playerName && entry.name === playerName;
    return `<tr class="${isMe ? 'lb-me' : ''}">
      <td class="lb-rank">${medals[i] || i + 1}</td>
      <td class="lb-name">${esc(entry.name)}${isMe ? ' <span class="lb-you">you</span>' : ''}</td>
      <td class="lb-score">${Number(entry.score).toLocaleString()}</td>
      <td class="lb-completed">${entry.completed}/20</td>
    </tr>`;
  }).join('');

  body.innerHTML = `
    <table class="lb-table">
      <thead><tr><th>#</th><th>Name</th><th>Score</th><th>Done</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Render ────────────────────────────────────────────────────────────────────

function tierBadge(tier) {
  const t = TIERS[tier];
  return `<span class="tier-badge" style="background:${t.bg};color:${t.color};border-color:${t.color}">${t.name}</span>`;
}

function renderChallengeList() {
  const list = document.getElementById('challenge-list');
  let html = '';
  let lastTier = 0;

  CHALLENGES.forEach(ch => {
    if (ch.tier !== lastTier) {
      if (lastTier) html += '</div>';
      const t = TIERS[ch.tier];
      html += `<div class="tier-group">
        <div class="tier-header" style="color:${t.color}">${t.label} — ${t.name}</div>`;
      lastTier = ch.tier;
    }
    const unlocked = isUnlocked(ch);
    const completed = isCompleted(ch.id);
    const active = state.current === ch.id;
    let cls = 'ch-item';
    if (active) cls += ' ch-active';
    if (completed) cls += ' ch-done';
    if (!unlocked) cls += ' ch-locked';

    const icon = completed ? '✓' : unlocked ? '▶' : '🔒';
    html += `<div class="${cls}" data-id="${ch.id}" ${unlocked ? '' : 'aria-disabled="true"'}>
      <span class="ch-icon">${icon}</span>
      <span class="ch-title">${ch.title}</span>
      <span class="ch-pts">${ch.points}pt</span>
    </div>`;
  });
  html += '</div>';
  list.innerHTML = html;

  list.querySelectorAll('.ch-item:not(.ch-locked)').forEach(el => {
    el.addEventListener('click', () => loadChallenge(el.dataset.id));
  });
}

function loadChallenge(id) {
  const ch = CHALLENGES.find(c => c.id === id);
  if (!ch || !isUnlocked(ch)) return;
  state.current = id;
  saveState(state);
  renderChallengeList();
  renderChallengePanel(ch);
}

function renderChallengePanel(ch) {
  const panel = document.getElementById('challenge-panel');
  const completed = isCompleted(ch.id);
  const hintUsed = state.hintsUsed.includes(ch.id);
  const effectivePts = hintUsed ? ch.points - ch.hintCost : ch.points;

  panel.innerHTML = `
    <div class="ch-panel-inner">
      <div class="ch-header">
        ${tierBadge(ch.tier)}
        <span class="ch-id">${ch.id}</span>
        <span class="ch-points-badge">${effectivePts} pts</span>
        ${completed ? '<span class="completed-badge">✓ COMPLETED</span>' : ''}
      </div>

      <h2 class="ch-title-large">${ch.title}</h2>
      <p class="ch-story">${ch.story}</p>

      ${renderSpreadsheet(ch)}

      <div class="ch-question">
        <span class="question-icon">?</span>
        <p>${ch.question}</p>
      </div>

      <div class="input-area">
        <div class="formula-input-wrap">
          <span class="input-eq">=</span>
          <input id="formula-input" type="text" class="formula-input"
            placeholder="type your formula here…"
            spellcheck="false" autocomplete="off"
            ${completed ? 'disabled' : ''}>
        </div>
        <div class="btn-row">
          <button id="submit-btn" class="btn btn-primary" ${completed ? 'disabled' : ''}>
            ${completed ? '✓ Solved' : 'Submit'}
          </button>
          ${!completed && !hintUsed
            ? `<button id="hint-btn" class="btn btn-hint">Hint (−${ch.hintCost}pts)</button>`
            : hintUsed
              ? `<div class="hint-box"><span class="hint-label">HINT</span> ${ch.hint}</div>`
              : ''}
        </div>
      </div>

      <div id="feedback-area"></div>

      ${completed ? `<div class="explanation-box">
        <span class="exp-label">SOLUTION</span>
        <p>${ch.explanation}</p>
      </div>` : ''}
    </div>`;

  const input = document.getElementById('formula-input');
  const submitBtn = document.getElementById('submit-btn');
  const hintBtn = document.getElementById('hint-btn');

  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn?.click(); });

  if (submitBtn && !completed) {
    submitBtn.addEventListener('click', () => handleSubmit(ch));
  }

  if (hintBtn) {
    hintBtn.addEventListener('click', () => {
      state.hintsUsed.push(ch.id);
      saveState(state);
      renderChallengePanel(ch);
    });
  }
}

function handleSubmit(ch) {
  const input = document.getElementById('formula-input');
  const feedback = document.getElementById('feedback-area');
  const raw = (input?.value || '').trim();

  if (!raw) {
    showFeedback(feedback, false, 'Enter a formula first.');
    return;
  }

  const correct = validateAnswer(raw, ch);

  if (correct) {
    const hintUsed = state.hintsUsed.includes(ch.id);
    const pts = hintUsed ? ch.points - ch.hintCost : ch.points;
    if (!isCompleted(ch.id)) {
      state.score += pts;
      state.completed.push(ch.id);
      saveState(state);
      submitScore(); // send to leaderboard
    }
    updateScore();
    renderChallengeList();
    renderChallengePanel(ch);
    setTimeout(() => document.querySelector('.explanation-box')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
  } else {
    showFeedback(feedback, false, getWrongMessage(raw, ch));
    input?.classList.add('shake');
    setTimeout(() => input?.classList.remove('shake'), 400);
  }
}

function getWrongMessage(formula, ch) {
  const f = formula.toUpperCase();
  if (ch.validation.type === 'contains' && ch.validation.mustContain) {
    const missing = ch.validation.mustContain.filter(t => !f.includes(t.toUpperCase()));
    if (missing.length) return `Formula must use: ${missing.join(', ')}`;
  }
  return "Not quite — check the function name, range, and criteria. Use the hint if you're stuck.";
}

function showFeedback(el, success, msg) {
  el.innerHTML = `<div class="feedback ${success ? 'feedback-ok' : 'feedback-err'}">${msg}</div>`;
  setTimeout(() => { el.innerHTML = ''; }, 3500);
}

function updateScore() {
  const el = document.getElementById('score-display');
  if (el) el.textContent = state.score.toLocaleString();
  const done = state.completed.length;
  const total = CHALLENGES.length;
  const pct = Math.round((done / total) * 100);
  const bar = document.getElementById('progress-bar');
  const label = document.getElementById('progress-label');
  if (bar) bar.style.width = pct + '%';
  if (label) label.textContent = `${done}/${total} challenges`;
}

// ── Home / Game screens ───────────────────────────────────────────────────────

function showHome() {
  document.getElementById('home-screen').style.display = 'flex';
  document.getElementById('game-screen').style.display = 'none';
}

function showGame() {
  // Save name
  const nameInput = document.getElementById('player-name');
  if (nameInput?.value.trim()) {
    playerName = nameInput.value.trim();
    localStorage.setItem('excelctf_name', playerName);
  }
  // Show name in topbar
  const nameDisplay = document.getElementById('player-name-display');
  if (nameDisplay && playerName) nameDisplay.textContent = playerName;

  document.getElementById('home-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'flex';
  updateScore();
  renderChallengeList();
  loadChallenge(state.current || 'T1C1');
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {

  // Name input — enable/disable start buttons
  const nameInput = document.getElementById('player-name');
  const startBtn  = document.getElementById('start-btn');
  const contBtn   = document.getElementById('continue-btn');

  if (nameInput) {
    nameInput.value = playerName;
    const syncBtns = () => {
      const ok = nameInput.value.trim().length > 0;
      if (startBtn) startBtn.disabled = !ok;
      if (contBtn && !contBtn.hidden) contBtn.disabled = !ok;
    };
    nameInput.addEventListener('input', syncBtns);
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter' && nameInput.value.trim()) startBtn?.click(); });
    syncBtns();
  }

  startBtn?.addEventListener('click', showGame);

  document.getElementById('reset-btn').addEventListener('click', () => {
    if (confirm('Reset all progress? This cannot be undone.')) {
      localStorage.removeItem(STATE_KEY);
      state = defaultState();
      showHome();
    }
  });

  // Continue button
  if (state.completed.length > 0) {
    if (contBtn) {
      contBtn.hidden = false;
      contBtn.disabled = playerName.length === 0;
      contBtn.textContent = `Continue (${state.completed.length}/${CHALLENGES.length} done · ${state.score.toLocaleString()} pts)`;
      contBtn.addEventListener('click', showGame);
    }
  }

  // Leaderboard
  document.querySelectorAll('.lb-trigger').forEach(btn => {
    btn.addEventListener('click', showLeaderboard);
  });
  document.getElementById('lb-backdrop')?.addEventListener('click', hideLeaderboard);
  document.getElementById('lb-close')?.addEventListener('click', hideLeaderboard);
  document.getElementById('lb-refresh')?.addEventListener('click', loadLeaderboardContent);

  // Keyboard: Escape closes modal
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') hideLeaderboard();
  });
});
