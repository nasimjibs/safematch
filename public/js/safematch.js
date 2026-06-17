// SafeMatch — Frontend UI Logic
// All business logic (API calls, scoring, data) lives in server.js
// This file handles only rendering and user interaction

let _currentCtx = null;
let _lastRec    = null;
let _editMode   = false;

// ── Hierarchy helpers ─────────────────────────────────────────────────────────
const HL_CLASS = { 1: 'hl1', 2: 'hl2', 3: 'hl3', 4: 'hl4', 5: 'hl5' };
const HL_ICON  = { 1: 'ti-ban', 2: 'ti-switch-2', 3: 'ti-shield', 4: 'ti-clipboard-list', 5: 'ti-hard-hat' };

function hlBadge(level, label) {
  const cls  = HL_CLASS[level] || 'hl4';
  const icon = HL_ICON[level]  || 'ti-clipboard-list';
  return `<span class="hl-badge ${cls}"><i class="ti ${icon}" style="font-size:12px"></i> Level ${level}: ${label}</span>`;
}

// ── Pipeline step UI helpers ──────────────────────────────────────────────────
function setStep(n, state, detail) {
  const num = document.getElementById('n' + n);
  const det = document.getElementById('d' + n);
  num.className = 'step-num ' + (state === 'run' ? 's-run' : state === 'done' ? 's-done' : 's-wait');
  if (state === 'run') {
    num.innerHTML = '<div class="spin"></div>';
  } else {
    num.textContent = n;
  }
  if (det && detail !== undefined) det.innerHTML = detail;
}

// ── Initialize app — fetch dropdowns and samples from backend ─────────────────
async function initApp() {
  try {
    const [dropdownsRes, samplesRes] = await Promise.all([
      fetch('/api/dropdowns'),
      fetch('/api/samples')
    ]);
    const dropdowns = await dropdownsRes.json();
    const samples = await samplesRes.json();

    // Populate dropdowns
    const locSel = document.getElementById('locSel');
    const typSel = document.getElementById('typSel');
    dropdowns.locations.forEach(l => {
      const o = document.createElement('option');
      o.value = o.textContent = l;
      locSel.appendChild(o);
    });
    dropdowns.categories.forEach(c => {
      const o = document.createElement('option');
      o.value = o.textContent = c;
      typSel.appendChild(o);
    });

    // Populate quick-fill chips
    const chipRow = document.getElementById('chipRow');
    samples.forEach(s => {
      const c = document.createElement('button');
      c.className = 'chip';
      c.textContent = s.t;
      c.onclick = () => {
        document.getElementById('incDesc').value = s.d;
        document.getElementById('locSel').value = s.l;
        document.getElementById('typSel').value = s.ty;
      };
      chipRow.appendChild(c);
    });
  } catch (err) {
    console.error('Failed to initialize app:', err);
  }
}
initApp();

// ── Main analysis — calls backend pipeline ────────────────────────────────────
async function analyze() {
  const desc = document.getElementById('incDesc').value.trim();
  if (!desc) { document.getElementById('incDesc').focus(); return; }

  const btn = document.getElementById('analyzeBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spin" style="border-top-color:#fff;width:16px;height:16px"></div> Analyzing...';

  document.getElementById('pipelineBox').classList.remove('hidden');
  document.getElementById('resultsBox').innerHTML = '';
  document.getElementById('errorBox').classList.add('hidden');
  [1, 2, 3, 4].forEach(i => setStep(i, 'wait'));

  try {
    // Show pipeline animation while backend works
    setStep(1, 'run');

    const resp = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        desc,
        location: document.getElementById('locSel').value,
        type: document.getElementById('typSel').value
      })
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || `Server error ${resp.status}`);
    }

    const data = await resp.json();

    // Update pipeline steps with results
    const kwHtml = data.tokens.map(k => `<span class="kw">${k}</span>`).join(' ');
    setStep(1, 'done', kwHtml || `${data.tokens.length} concepts extracted`);
    setStep(2, 'done', `${data.candidateCount} candidate cases retrieved from ${data.totalRecords} records`);
    setStep(3, 'done', '5 cases ranked by Hierarchy of Controls');
    setStep(4, 'done', 'Recommendation ready');

    _currentCtx = {
      desc: desc,
      loc:  document.getElementById('locSel').value,
      cat:  document.getElementById('typSel').value
    };
    _lastRec = data.result.recommendation;
    renderResults(data.result, data.candidates);

  } catch (err) {
    [1, 2, 3, 4].forEach(i => {
      const num = document.getElementById('n' + i);
      if (num.className.includes('s-run')) setStep(i, 'wait');
    });
    document.getElementById('errorBox').classList.remove('hidden');
    document.getElementById('errorBox').innerHTML =
      `<div class="error"><i class="ti ti-alert-circle"></i> ${err.message}</div>`;
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="ti ti-search"></i> Find similar cases &amp; recommend action';
}

// ── Results renderer ──────────────────────────────────────────────────────────
function renderResults(result, candidates) {
  const box = document.getElementById('resultsBox');
  const rec = result.recommendation;

  const cases = (result.topCases || []).map(tc => {
    const full = candidates.find(c => c.id === tc.id) || {};
    return { ...full, ...tc };
  });

  box.innerHTML = `
    <!-- Similar cases -->
    <div class="section-title">
      <i class="ti ti-history" style="font-size:16px;color:var(--txt2)"></i>
      Similar historical cases — ranked by Hierarchy of Controls
    </div>
    ${cases.map((c, i) => `
      <div class="case-card ${i === 0 ? 'best' : ''}">
        <div class="case-hdr">
          <span class="case-rank">${i === 0 ? '★ Best match' : '#' + (i + 1) + ' similar case'}</span>
          ${hlBadge(c.hierarchy_level || c.hl, c.hierarchy_label || c.hlab)}
        </div>
        <p class="case-inc"><i class="ti ti-alert-circle" style="font-size:13px;margin-right:4px"></i>${c.desc || ''}</p>
        <p class="case-act"><i class="ti ti-check" style="font-size:13px;margin-right:4px;color:#3B6D11"></i>${c.act || ''}</p>
        <div class="case-meta">
          <span class="site-tag"><i class="ti ti-map-pin" style="font-size:12px"></i> ${c.site || ''}</span>
          ${c.company_name ? `<span class="site-tag"><i class="ti ti-building-factory-2" style="font-size:12px"></i> ${c.company_name}</span>` : ''}
          <span class="${(c.recurred === false || c.recurred === 'false') ? 'rec-no' : 'rec-yes'}">
            ${(c.recurred === false || c.recurred === 'false') ? 'Did not recur' : 'Recurred after action'}
          </span>
          ${c.est_min && c.est_max ? `<span class="site-tag"><i class="ti ti-clock" style="font-size:12px"></i> Est. time: ${c.est_min}-${c.est_max} days</span>` : ''}
          <span class="site-tag" style="font-style:italic">${c.similarity_reason || ''}</span>
        </div>
        <div class="case-expand" id="caseExpand${i}" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid rgba(59,109,17,0.1)">
          <div style="font-size:12px;font-weight:500;color:#3B6D11;margin-bottom:6px">Implementation steps</div>
          <ul class="steps-list" style="font-size:12px;color:#3B6D11">
            ${(c.implementation_steps || ['Click "Show steps" to generate AI implementation steps']).map(s => `<li>${s}</li>`).join('')}
          </ul>
          <div style="margin-top:12px">
            <button class="btn-suggestion btn-suggestion--secondary" onclick="chooseHistoricalCase(${JSON.stringify(c).replace(/"/g, '&quot;')}, this)">
              <i class="ti ti-check"></i> Choose as action
            </button>
          </div>
        </div>
        <div class="case-actions" style="margin-top:12px">
          <button class="btn-suggestion btn-suggestion--tertiary" onclick="toggleCaseExpand(${i})">
            <i class="ti ti-chevron-down" id="expandIcon${i}"></i> <span id="expandText${i}">Show steps</span>
          </button>
          <button class="btn-suggestion" onclick="editHistoricalCase(${JSON.stringify(c).replace(/"/g, '&quot;')}, ${i})">
            <i class="ti ti-edit"></i> Edit case
          </button>
        </div>
      </div>`).join('')}
  `;

  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Edit suggestion — allows user to modify the recommendation ─────────────────
function editSuggestion() {
  if (!_lastRec) return;

  const actionEl = document.querySelector('.rec-action');
  const reasonEl = document.querySelector('.rec-reason');
  const stepsEl = document.querySelector('.steps-list');

  if (_editMode) return;

  _editMode = true;

  const actionText = actionEl.textContent;
  actionEl.innerHTML = `<textarea id="editAction" style="width:100%;min-height:60px;font-size:14px;font-weight:500;color:#173404;background:rgba(255,255,255,0.8);border:1px solid #9FE1CB;border-radius:4px;padding:8px;resize:vertical">${actionText}</textarea>`;

  const reasonText = reasonEl.textContent;
  reasonEl.innerHTML = `<textarea id="editReason" style="width:100%;min-height:80px;font-size:13px;color:#3B6D11;background:rgba(255,255,255,0.8);border:1px solid #9FE1CB;border-radius:4px;padding:8px;resize:vertical">${reasonText}</textarea>`;

  const stepsText = Array.from(stepsEl.querySelectorAll('li')).map(li => li.textContent).join('\n');
  stepsEl.innerHTML = `<textarea id="editSteps" placeholder="Enter each step on a new line" style="width:100%;min-height:100px;font-size:13px;color:#3B6D11;background:rgba(255,255,255,0.8);border:1px solid #9FE1CB;border-radius:4px;padding:8px;resize:vertical">${stepsText}</textarea>`;

  const editBtn = document.getElementById('editSuggestionBtn');
  const chooseBtn = document.getElementById('chooseSuggestionBtn');

  editBtn.innerHTML = '<i class="ti ti-device-floppy"></i> Save changes';
  editBtn.onclick = saveSuggestionEdit;
  chooseBtn.style.display = 'none';
}

// ── Save suggestion edit ──────────────────────────────────────────────────────
function saveSuggestionEdit() {
  const actionText = document.getElementById('editAction').value.trim();
  const reasonText = document.getElementById('editReason').value.trim();
  const stepsText = document.getElementById('editSteps').value.trim();

  if (!actionText) {
    alert('Action cannot be empty');
    return;
  }

  _lastRec.action = actionText;
  _lastRec.reasoning = reasonText;
  _lastRec.implementation_steps = stepsText.split('\n').filter(s => s.trim()).map(s => s.trim());

  const actionEl = document.querySelector('.rec-action');
  const reasonEl = document.querySelector('.rec-reason');
  const stepsEl = document.querySelector('.steps-list');

  actionEl.innerHTML = actionText;
  reasonEl.innerHTML = reasonText;
  stepsEl.innerHTML = _lastRec.implementation_steps.map(s => `<li>${s}</li>`).join('');

  _editMode = false;

  const editBtn = document.getElementById('editSuggestionBtn');
  const chooseBtn = document.getElementById('chooseSuggestionBtn');

  editBtn.innerHTML = '<i class="ti ti-edit"></i> Edit suggestion';
  editBtn.onclick = editSuggestion;
  chooseBtn.style.display = 'inline-flex';
}

// ── Choose suggestion ─────────────────────────────────────────────────────────
function chooseSuggestion() {
  if (!_lastRec) return;

  const editBtn = document.getElementById('editSuggestionBtn');
  const chooseBtn = document.getElementById('chooseSuggestionBtn');
  const actionBtn = document.getElementById('actionTakenBtn');

  editBtn.style.display = 'none';
  chooseBtn.style.display = 'none';
  actionBtn.style.display = 'inline-flex';

  const recCard = document.querySelector('.rec-card');
  recCard.style.borderColor = 'var(--green-br)';
  recCard.style.borderWidth = '2px';
}

// ── Edit historical case ──────────────────────────────────────────────────────
function editHistoricalCase(caseData, caseIndex) {
  if (!caseData) return;

  const caseCards = document.querySelectorAll('.case-card');
  const caseCard = caseCards[caseIndex];
  if (!caseCard) return;

  const actEl = caseCard.querySelector('.case-act');
  const actionsEl = caseCard.querySelector('.case-actions');

  if (!actEl || caseCard.dataset.editing === 'true') return;

  caseCard.dataset.editing = 'true';

  const actText = actEl.textContent.replace(/^✓\s*/, '');

  actEl.innerHTML = `<i class="ti ti-check" style="font-size:13px;margin-right:4px;color:#3B6D11"></i><textarea id="editHistoricalAction${caseIndex}" style="width:calc(100% - 20px);min-height:60px;font-size:13px;color:#3B6D11;background:rgba(255,255,255,0.8);border:1px solid #9FE1CB;border-radius:4px;padding:6px;resize:vertical;display:inline-block;vertical-align:top">${actText}</textarea>`;

  actionsEl.innerHTML = `
    <button class="btn-suggestion" onclick="saveHistoricalCaseEdit(${JSON.stringify(caseData).replace(/"/g, '&quot;')}, ${caseIndex})">
      <i class="ti ti-device-floppy"></i> Save changes
    </button>
    <button class="btn-suggestion btn-suggestion--secondary" onclick="cancelHistoricalCaseEdit(${JSON.stringify(caseData).replace(/"/g, '&quot;')}, ${caseIndex})">
      <i class="ti ti-x"></i> Cancel
    </button>
  `;
}

// ── Save historical case edit ─────────────────────────────────────────────────
function saveHistoricalCaseEdit(caseData, caseIndex) {
  const caseCards = document.querySelectorAll('.case-card');
  const caseCard = caseCards[caseIndex];
  if (!caseCard) return;

  const textarea = document.getElementById(`editHistoricalAction${caseIndex}`);
  const actEl = caseCard.querySelector('.case-act');
  const actionsEl = caseCard.querySelector('.case-actions');

  if (!textarea) return;

  const newActionText = textarea.value.trim();
  if (!newActionText) {
    alert('Action cannot be empty');
    return;
  }

  caseData.act = newActionText;

  actEl.innerHTML = `<i class="ti ti-check" style="font-size:13px;margin-right:4px;color:#3B6D11"></i>${newActionText}`;

  actionsEl.innerHTML = `
    <button class="btn-suggestion btn-suggestion--tertiary" onclick="toggleCaseExpand(${caseIndex})">
      <i class="ti ti-chevron-down" id="expandIcon${caseIndex}"></i> <span id="expandText${caseIndex}">Show steps</span>
    </button>
    <button class="btn-suggestion" onclick="editHistoricalCase(${JSON.stringify(caseData).replace(/"/g, '&quot;')}, ${caseIndex})">
      <i class="ti ti-edit"></i> Edit case
    </button>
  `;

  delete caseCard.dataset.editing;

  const confirmMsg = document.createElement('div');
  confirmMsg.style.cssText = 'position:fixed;top:20px;right:20px;background:#9FE1CB;color:#173404;padding:8px 12px;border-radius:4px;font-size:12px;z-index:1000;box-shadow:0 2px 8px rgba(0,0,0,0.1)';
  confirmMsg.innerHTML = '<i class="ti ti-check"></i> Changes saved';
  document.body.appendChild(confirmMsg);
  setTimeout(() => confirmMsg.remove(), 3000);
}

// ── Cancel historical case edit ───────────────────────────────────────────────
function cancelHistoricalCaseEdit(caseData, caseIndex) {
  const caseCards = document.querySelectorAll('.case-card');
  const caseCard = caseCards[caseIndex];
  if (!caseCard) return;

  const actEl = caseCard.querySelector('.case-act');
  const actionsEl = caseCard.querySelector('.case-actions');

  actEl.innerHTML = `<i class="ti ti-check" style="font-size:13px;margin-right:4px;color:#3B6D11"></i>${caseData.act || ''}`;

  actionsEl.innerHTML = `
    <button class="btn-suggestion btn-suggestion--tertiary" onclick="toggleCaseExpand(${caseIndex})">
      <i class="ti ti-chevron-down" id="expandIcon${caseIndex}"></i> <span id="expandText${caseIndex}">Show steps</span>
    </button>
    <button class="btn-suggestion" onclick="editHistoricalCase(${JSON.stringify(caseData).replace(/"/g, '&quot;')}, ${caseIndex})">
      <i class="ti ti-edit"></i> Edit case
    </button>
  `;

  delete caseCard.dataset.editing;
}

// ── Toggle case expand — fetches AI implementation steps from backend ─────────
async function toggleCaseExpand(caseIndex) {
  const expandDiv = document.getElementById(`caseExpand${caseIndex}`);
  const expandIcon = document.getElementById(`expandIcon${caseIndex}`);
  const expandText = document.getElementById(`expandText${caseIndex}`);

  if (!expandDiv || !expandIcon || !expandText) return;

  const isExpanded = expandDiv.style.display !== 'none';

  if (isExpanded) {
    expandDiv.style.display = 'none';
    expandIcon.className = 'ti ti-chevron-down';
    expandText.textContent = 'Show steps';
  } else {
    expandDiv.style.display = 'block';
    expandIcon.className = 'ti ti-chevron-up';
    expandText.textContent = 'Hide steps';

    const stepsList = expandDiv.querySelector('.steps-list');
    if (stepsList && !stepsList.dataset.aiGenerated) {
      stepsList.innerHTML = '<li style="color:#666;font-style:italic;"><div class="spin" style="display:inline-block;width:12px;height:12px;margin-right:8px;border-top-color:#666"></div>Generating AI implementation steps...</li>';

      try {
        const caseCards = document.querySelectorAll('.case-card');
        const caseCard = caseCards[caseIndex];
        const caseDesc = caseCard.querySelector('.case-inc').textContent;
        const caseAct = caseCard.querySelector('.case-act').textContent;
        const hlBadgeEl = caseCard.querySelector('.hl-badge');
        const hlLevel = hlBadgeEl ? parseInt(hlBadgeEl.textContent.match(/Level (\d+)/)?.[1]) || 4 : 4;
        const hlLabel = hlBadgeEl ? hlBadgeEl.textContent.split(': ')[1] || 'Administrative' : 'Administrative';
        const site = caseCard.querySelector('.site-tag').textContent;
        const recurred = caseCard.querySelector('.rec-no, .rec-yes').textContent.includes('Did not recur') ? false : true;

        const resp = await fetch('/api/implementation-steps', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            caseData: {
              desc: caseDesc,
              act: caseAct,
              hierarchy_level: hlLevel,
              hierarchy_label: hlLabel,
              site: site,
              recurred: recurred
            },
            currentIncident: _currentCtx?.desc || ''
          })
        });

        const data = await resp.json();
        stepsList.innerHTML = data.steps.map(s => `<li>${s}</li>`).join('');
        stepsList.dataset.aiGenerated = 'true';

        const stepsHeader = expandDiv.querySelector('div[style*="font-weight:500"]');
        if (stepsHeader) {
          stepsHeader.innerHTML = 'Implementation steps <span style="color:#666;font-weight:normal">(AI-generated)</span>';
        }
      } catch (error) {
        stepsList.innerHTML = [
          'Review incident details',
          'Implement corrective action',
          'Monitor effectiveness',
          'Document results'
        ].map(s => `<li>${s}</li>`).join('');
        stepsList.dataset.aiGenerated = 'true';
      }
    }
  }
}

// ── Choose historical case ────────────────────────────────────────────────────
function chooseHistoricalCase(caseData, buttonElement) {
  if (!_currentCtx || !caseData) return;

  const caseCards = document.querySelectorAll('.case-card');
  caseCards.forEach(card => {
    card.style.borderColor = '';
    card.style.borderWidth = '';
    card.style.backgroundColor = '';
  });

  if (buttonElement) {
    const selectedCard = buttonElement.closest('.case-card');
    if (selectedCard) {
      selectedCard.style.borderColor = '#9FE1CB';
      selectedCard.style.borderWidth = '2px';
      selectedCard.style.backgroundColor = 'rgba(159, 225, 203, 0.1)';
    }
  }

  _lastRec = {
    action: caseData.act || '',
    hierarchy_level: caseData.hierarchy_level || caseData.hl,
    hierarchy_label: caseData.hierarchy_label || caseData.hlab,
    reasoning: `Selected based on historical case ${caseData.id} from ${caseData.site}. This action was ${(caseData.recurred === false || caseData.recurred === 'false') ? 'effective (did not recur)' : 'taken but incident recurred'}.`,
    implementation_steps: [`Implement the same corrective action as case ${caseData.id}`, 'Monitor effectiveness', 'Document results']
  };

  const recCard = document.querySelector('.rec-card');
  if (recCard) {
    const actionEl = recCard.querySelector('.rec-action');
    const reasonEl = recCard.querySelector('.rec-reason');
    const stepsEl = recCard.querySelector('.steps-list');
    const hlBadgeEl = recCard.querySelector('.hl-badge');

    if (actionEl) actionEl.textContent = _lastRec.action;
    if (reasonEl) reasonEl.textContent = _lastRec.reasoning;
    if (stepsEl) stepsEl.innerHTML = _lastRec.implementation_steps.map(s => `<li>${s}</li>`).join('');
    if (hlBadgeEl) hlBadgeEl.outerHTML = hlBadge(_lastRec.hierarchy_level, _lastRec.hierarchy_label);

    const editBtn = document.getElementById('editSuggestionBtn');
    const chooseBtn = document.getElementById('chooseSuggestionBtn');
    const actionBtn = document.getElementById('actionTakenBtn');

    if (editBtn) editBtn.style.display = 'none';
    if (chooseBtn) chooseBtn.style.display = 'none';
    if (actionBtn) actionBtn.style.display = 'inline-flex';

    recCard.style.borderColor = 'var(--green-br)';
    recCard.style.borderWidth = '2px';
  }

  recCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Mark action taken — saves to backend ──────────────────────────────────────
async function markActionTaken() {
  if (!_currentCtx || !_lastRec) return;

  const record = {
    cat:  _currentCtx.cat || 'Unknown',
    desc: _currentCtx.desc,
    loc:  _currentCtx.loc || '',
    site: 'Ovako',
    act:  _lastRec.action,
    hl:   _lastRec.hierarchy_level,
    hlab: _lastRec.hierarchy_label,
    kw:   '',
    rec:  false
  };

  try {
    await fetch('/api/action-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record)
    });
  } catch (err) {
    console.error('Failed to log action:', err);
  }

  const btn = document.getElementById('actionTakenBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-circle-check"></i> Action logged';
    btn.classList.add('btn-action-taken--done');
  }
}
