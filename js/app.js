'use strict';

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

// ── Unlock logic ──────────────────────────────────────────────────────────────

function isUnlocked(challenge) {
  const { id, tier } = challenge;
  if (id === 'T1C1') return true;

  // Within tier: sequential unlock
  const tierChallenges = CHALLENGES.filter(c => c.tier === tier);
  const idx = tierChallenges.findIndex(c => c.id === id);
  if (idx > 0 && state.completed.includes(tierChallenges[idx - 1].id)) return true;

  // First challenge of tier 2+ unlocks when prev tier is fully done
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

    // HF error objects have a 'type' property
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
    // If we also have an expected value, try HF evaluation as a bonus check
    if (validation.expectedValue !== undefined && validation.fallbackType === 'formula') {
      try {
        return validateWithHF(formula, tableData, targetRow, targetCol, validation.expectedValue);
      } catch { return structuralOk; }
    }
    return structuralOk;
  }

  return false;
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

  // Wire up buttons
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
    }
    updateScore();
    renderChallengeList();
    renderChallengePanel(ch);
    // scroll to explanation
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
  if (!formula.startsWith('=') && !formula.startsWith('='.toUpperCase())) {
    return 'Formulas start with =  — but your answer is checked with or without it.';
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

// ── Home screen ───────────────────────────────────────────────────────────────

function showHome() {
  document.getElementById('home-screen').style.display = 'flex';
  document.getElementById('game-screen').style.display = 'none';
}

function showGame() {
  document.getElementById('home-screen').style.display = 'none';
  document.getElementById('game-screen').style.display = 'flex';
  updateScore();
  renderChallengeList();
  loadChallenge(state.current || 'T1C1');
}

// ── Init ──────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('start-btn').addEventListener('click', showGame);
  document.getElementById('reset-btn').addEventListener('click', () => {
    if (confirm('Reset all progress? This cannot be undone.')) {
      localStorage.removeItem(STATE_KEY);
      state = defaultState();
      showHome();
    }
  });
  document.getElementById('continue-btn')?.addEventListener('click', showGame);

  // If they have progress, show continue option
  if (state.completed.length > 0) {
    const cont = document.getElementById('continue-btn');
    if (cont) {
      cont.hidden = false;
      cont.textContent = `Continue (${state.completed.length}/${CHALLENGES.length} done · ${state.score.toLocaleString()} pts)`;
    }
  }
});
