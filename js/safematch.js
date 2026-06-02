// SafeMatch — RAG Pipeline Logic
// Implements: keyword extraction → candidate retrieval → LLM API ranking → results render

let API_KEY = '';

const OR_MODEL = 'google/gemini-2.5-flash';

// ── Action log — seeded from ovako.json, grows as actions are taken ───────────
let actionLog = [];
let _currentCtx = null;
let _lastRec    = null;
let _editMode   = false;

const SITE_COMPANY = {
  'Hofors':       { company_id: 'C-001', company_name: 'Nordstål AB' },
  'Smedjebacken': { company_id: 'C-002', company_name: 'Bergverk Industries' },
  'Timmersdala':  { company_id: 'C-003', company_name: 'Scandinavian Metals' },
  'Boxholm':      { company_id: 'C-004', company_name: 'Irongate Group' },
  'Hällefors':    { company_id: 'C-005', company_name: 'Nordic Forge AB' },
};

function normalizeOvakoRecord(r) {
  const co = SITE_COMPANY[r.site] || { company_id: 'C-000', company_name: 'Ovako AB' };
  return {
    id:           r.incident_id,
    cat:          r.category,
    desc:         r.description,
    loc:          r.location,
    site:         r.site,
    company_id:   r.company_id   || co.company_id,
    company_name: r.company_name || co.company_name,
    act:          r.corrective_action,
    hl:           r.hierarchy_level,
    hlab:         r.hierarchy_label,
    kw:           (r.keywords || '').replace(/,/g, ' '),
    rec:          r.recurred,
    _src:         'json'
  };
}

function loadActionLog() {
  if (typeof OVAKO_DATA !== 'undefined') {
    actionLog = OVAKO_DATA.map(normalizeOvakoRecord);
  }
}
loadActionLog();

// ── Populate dropdowns from DS ────────────────────────────────────────────────
function initDropdowns() {
  const locs = [...new Set(DS.map(r => r.loc))].sort();
  const cats = [...new Set(DS.map(r => r.cat))].sort();
  const locSel = document.getElementById('locSel');
  const typSel = document.getElementById('typSel');
  locs.forEach(l => { const o = document.createElement('option'); o.value = o.textContent = l; locSel.appendChild(o); });
  cats.forEach(c => { const o = document.createElement('option'); o.value = o.textContent = c; typSel.appendChild(o); });
}
initDropdowns();

// ── API Key Management ────────────────────────────────────────────────────────
function saveKey() {
  const val = document.getElementById('apiKeyInput').value.trim();
  if (!val.startsWith('sk-or-')) {
    document.getElementById('apiStatus').textContent = '✗ Invalid key format';
    document.getElementById('apiStatus').style.color = '#791F1F';
    return;
  }
  API_KEY = val;
  document.getElementById('apiStatus').textContent = '✓ Key saved';
  document.getElementById('apiStatus').style.color = '#9FE1CB';
  document.getElementById('apiKeyInput').value = '••••••••••••••••••••';
}

// ── Quick fill chips ──────────────────────────────────────────────────────────
const chipRow = document.getElementById('chipRow');
SAMPLES.forEach(s => {
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

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-zåäö0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 3);
}

function scoreRecord(record, tokens) {
  const blob = (record.desc + ' ' + record.act + ' ' + record.kw).toLowerCase();
  return tokens.reduce((n, t) => n + (blob.includes(t) ? 1 : 0), 0);
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

// ── Hierarchy helpers ─────────────────────────────────────────────────────────
const HL_CLASS = { 1: 'hl1', 2: 'hl2', 3: 'hl3', 4: 'hl4', 5: 'hl5' };
const HL_ICON  = { 1: 'ti-ban', 2: 'ti-switch-2', 3: 'ti-shield', 4: 'ti-clipboard-list', 5: 'ti-hard-hat' };

function hlBadge(level, label) {
  const cls  = HL_CLASS[level] || 'hl4';
  const icon = HL_ICON[level]  || 'ti-clipboard-list';
  return `<span class="hl-badge ${cls}"><i class="ti ${icon}" style="font-size:12px"></i> Level ${level}: ${label}</span>`;
}

// ── API callers ───────────────────────────────────────────────────────────────
async function callOpenRouterAPI(prompt) {
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: OR_MODEL,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error?.message || `OpenRouter API error ${resp.status}`);
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

// ── Generate AI implementation steps for historical cases ─────────────────────
async function generateImplementationSteps(caseData, currentIncident) {
  if (!API_KEY) {
    return ['Review incident details', 'Implement corrective action', 'Monitor effectiveness', 'Document results'];
  }

  const prompt = `You are a workplace safety expert. Generate specific implementation steps for this corrective action:

CURRENT INCIDENT: "${currentIncident}"
HISTORICAL CORRECTIVE ACTION: "${caseData.act}"
HIERARCHY LEVEL: ${caseData.hierarchy_level || caseData.hl} (${caseData.hierarchy_label || caseData.hlab})
SITE: ${caseData.site}
EFFECTIVENESS: ${(caseData.recurred === false || caseData.recurred === 'false') ? 'Effective - incident did not recur' : 'Incident recurred after this action'}

Generate 4-6 specific, actionable implementation steps for this corrective action. Focus on practical steps that a manager could follow to implement this action for the current incident.

Return ONLY a JSON array of strings (no markdown, no preamble):
["step 1", "step 2", "step 3", "step 4"]`;

  try {
    const raw = await callOpenRouterAPI(prompt);
    const steps = JSON.parse(raw.replace(/```json|```/g, '').trim());
    return Array.isArray(steps) ? steps : ['Review incident details', 'Implement corrective action', 'Monitor effectiveness', 'Document results'];
  } catch (e) {
    return ['Review incident details', 'Implement corrective action', 'Monitor effectiveness', 'Document results'];
  }
}

// ── Main analysis pipeline ────────────────────────────────────────────────────
async function analyze() {
  const desc = document.getElementById('incDesc').value.trim();
  if (!desc) { document.getElementById('incDesc').focus(); return; }
  if (!API_KEY) { alert('Please enter your OpenRouter API key at the top of the page.'); return; }

  const btn = document.getElementById('analyzeBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spin" style="border-top-color:#fff;width:16px;height:16px"></div> Analyzing...';

  document.getElementById('pipelineBox').classList.remove('hidden');
  document.getElementById('resultsBox').innerHTML = '';
  document.getElementById('errorBox').classList.add('hidden');
  [1, 2, 3, 4].forEach(i => setStep(i, 'wait'));

  try {
    // ── STEP 1: Extract key concepts ────────────────────────────────────────
    await sleep(300);
    setStep(1, 'run');
    const tokens = tokenize(desc);
    await sleep(500);
    const kwHtml = tokens.slice(0, 8).map(k => `<span class="kw">${k}</span>`).join(' ');
    setStep(1, 'done', kwHtml || `${tokens.length} concepts extracted`);

    // ── STEP 2: Keyword-based candidate retrieval (simulates vector search) ──
    setStep(2, 'run');
    await sleep(400);
    const allRecords = [...DS, ...actionLog];
    const scored = allRecords
      .map(r => ({ ...r, score: scoreRecord(r, tokens) }))
      .sort((a, b) => b.score - a.score || a.hl - b.hl);
    const candidates = scored.slice(0, 15);
    setStep(2, 'done', `${candidates.length} candidate cases retrieved from ${allRecords.length} records`);

    // ── STEP 3: Send candidates to Claude for ranking ────────────────────────
    setStep(3, 'run');

    const prompt = `You are a workplace safety expert with deep knowledge of the Hierarchy of Controls:
Level 1 = Elimination (remove the hazard), Level 2 = Substitution, Level 3 = Engineering controls,
Level 4 = Administrative controls, Level 5 = PPE (last resort).

A manager at Ovako steel plant needs help deciding the best corrective action for this incident:
"${desc}"

Here are ${candidates.length} similar historical incidents from the Ovako safety database:
${candidates.map((r, i) => `[${i + 1}] ID:${r.id} | Category:${r.cat} | Site:${r.site}
  Incident: "${r.desc}"
  Corrective action taken: "${r.act}"
  Hierarchy level: ${r.hl} (${r.hlab})
  Incident recurred after this action: ${r.rec}
  Keywords: ${r.kw}`).join('\n\n')}

Return ONLY valid JSON (no markdown, no preamble) in exactly this structure:
{
  "topCases": [
    {
      "id": "OVK-XXXX",
      "rank": 1,
      "similarity_reason": "one short sentence explaining why this case is relevant",
      "hierarchy_level": 3,
      "hierarchy_label": "Engineering",
      "recurred": false,
      "site": "Hofors"
    }
  ],
  "recommendation": {
    "action": "Specific recommended corrective action in one clear actionable sentence",
    "hierarchy_level": 3,
    "hierarchy_label": "Engineering",
    "reasoning": "Two sentences: why this hierarchy level is best and what evidence from history supports it",
    "implementation_steps": ["step 1", "step 2", "step 3"]
  },
  "warning": "Optional one-sentence warning only if a higher hierarchy level is not feasible"
}

Rules:
- topCases: pick the 5 most relevant cases, sorted best hierarchy level first (Level 1 best, Level 5 worst)
- Prioritise cases where recurred=false — these are proven effective actions
- recommendation: choose the highest feasible hierarchy level based on available evidence`;

    const raw = await callOpenRouterAPI(prompt);
    let result;
    try {
      result = JSON.parse(raw.replace(/```json|```/g, '').trim());
    } catch (e) {
      throw new Error('Could not parse AI response. Please try again.');
    }

    setStep(3, 'done', `5 cases ranked by Hierarchy of Controls`);

    // ── STEP 4: Render results ───────────────────────────────────────────────
    setStep(4, 'run');
    await sleep(300);
    setStep(4, 'done', 'Recommendation ready');
    _currentCtx = {
      desc: desc,
      loc:  document.getElementById('locSel').value,
      cat:  document.getElementById('typSel').value
    };
    _lastRec = result.recommendation;
    renderResults(result, candidates);

  } catch (err) {
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
          <span class="site-tag" style="font-style:italic">${c.similarity_reason || ''}</span>
        </div>
        <div class="case-expand" id="caseExpand${i}" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid rgba(59,109,17,0.1)">
          <div style="font-size:12px;font-weight:500;color:#3B6D11;margin-bottom:6px">Implementation steps</div>
          <ul class="steps-list" style="font-size:12px;color:#3B6D11">
            ${(c.implementation_steps || ['Click "Show steps" to generate AI implementation steps']).map(s => `<li>${s}</li>`).join('')}
          </ul>
        </div>
        <div class="case-actions" style="margin-top:12px">
          <button class="btn-suggestion btn-suggestion--tertiary" onclick="toggleCaseExpand(${i})">
            <i class="ti ti-chevron-down" id="expandIcon${i}"></i> <span id="expandText${i}">Show steps</span>
          </button>
          <button class="btn-suggestion" onclick="editHistoricalCase(${JSON.stringify(c).replace(/"/g, '&quot;')}, ${i})">
            <i class="ti ti-edit"></i> Edit case
          </button>
          <button class="btn-suggestion btn-suggestion--secondary" onclick="chooseHistoricalCase(${JSON.stringify(c).replace(/"/g, '&quot;')})">
            <i class="ti ti-check"></i> Choose as action
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
  
  if (_editMode) return; // Already in edit mode
  
  _editMode = true;
  
  // Replace action with editable textarea
  const actionText = actionEl.textContent;
  actionEl.innerHTML = `<textarea id="editAction" style="width:100%;min-height:60px;font-size:14px;font-weight:500;color:#173404;background:rgba(255,255,255,0.8);border:1px solid var(--green-br);border-radius:var(--radius);padding:8px;resize:vertical">${actionText}</textarea>`;
  
  // Replace reasoning with editable textarea
  const reasonText = reasonEl.textContent;
  reasonEl.innerHTML = `<textarea id="editReason" style="width:100%;min-height:80px;font-size:13px;color:#3B6D11;background:rgba(255,255,255,0.8);border:1px solid var(--green-br);border-radius:var(--radius);padding:8px;resize:vertical">${reasonText}</textarea>`;
  
  // Replace steps with editable textarea
  const stepsText = Array.from(stepsEl.querySelectorAll('li')).map(li => li.textContent).join('\n');
  stepsEl.innerHTML = `<textarea id="editSteps" placeholder="Enter each step on a new line" style="width:100%;min-height:100px;font-size:13px;color:#3B6D11;background:rgba(255,255,255,0.8);border:1px solid var(--green-br);border-radius:var(--radius);padding:8px;resize:vertical">${stepsText}</textarea>`;
  
  // Update buttons
  const editBtn = document.getElementById('editSuggestionBtn');
  const chooseBtn = document.getElementById('chooseSuggestionBtn');
  
  editBtn.innerHTML = '<i class="ti ti-device-floppy"></i> Save changes';
  editBtn.onclick = saveSuggestionEdit;
  chooseBtn.style.display = 'none';
}

// ── Save suggestion edit — updates the recommendation with user changes ────────
function saveSuggestionEdit() {
  const actionText = document.getElementById('editAction').value.trim();
  const reasonText = document.getElementById('editReason').value.trim();
  const stepsText = document.getElementById('editSteps').value.trim();
  
  if (!actionText) {
    alert('Action cannot be empty');
    return;
  }
  
  // Update the recommendation object
  _lastRec.action = actionText;
  _lastRec.reasoning = reasonText;
  _lastRec.implementation_steps = stepsText.split('\n').filter(s => s.trim()).map(s => s.trim());
  
  // Update the display
  const actionEl = document.querySelector('.rec-action');
  const reasonEl = document.querySelector('.rec-reason');
  const stepsEl = document.querySelector('.steps-list');
  
  actionEl.innerHTML = actionText;
  reasonEl.innerHTML = reasonText;
  stepsEl.innerHTML = _lastRec.implementation_steps.map(s => `<li>${s}</li>`).join('');
  
  // Reset edit mode
  _editMode = false;
  
  // Update buttons
  const editBtn = document.getElementById('editSuggestionBtn');
  const chooseBtn = document.getElementById('chooseSuggestionBtn');
  
  editBtn.innerHTML = '<i class="ti ti-edit"></i> Edit suggestion';
  editBtn.onclick = editSuggestion;
  chooseBtn.style.display = 'inline-flex';
}

// ── Choose suggestion — user accepts the recommendation as their action ────────
function chooseSuggestion() {
  if (!_lastRec) return;
  
  const editBtn = document.getElementById('editSuggestionBtn');
  const chooseBtn = document.getElementById('chooseSuggestionBtn');
  const actionBtn = document.getElementById('actionTakenBtn');
  
  // Hide suggestion buttons and show action taken button
  editBtn.style.display = 'none';
  chooseBtn.style.display = 'none';
  actionBtn.style.display = 'inline-flex';
  
  // Add visual feedback
  const recCard = document.querySelector('.rec-card');
  recCard.style.borderColor = 'var(--green-br)';
  recCard.style.borderWidth = '2px';
}

// ── Edit historical case — allows user to modify a historical case ────────────
function editHistoricalCase(caseData, caseIndex) {
  if (!caseData) return;
  
  const caseCards = document.querySelectorAll('.case-card');
  const caseCard = caseCards[caseIndex];
  if (!caseCard) return;
  
  const actEl = caseCard.querySelector('.case-act');
  const actionsEl = caseCard.querySelector('.case-actions');
  
  if (!actEl || caseCard.dataset.editing === 'true') return;
  
  // Mark as editing
  caseCard.dataset.editing = 'true';
  
  // Get current action text (remove the icon)
  const actText = actEl.textContent.replace(/^✓\s*/, '');
  
  // Replace action with editable textarea
  actEl.innerHTML = `<i class="ti ti-check" style="font-size:13px;margin-right:4px;color:#3B6D11"></i><textarea id="editHistoricalAction${caseIndex}" style="width:calc(100% - 20px);min-height:60px;font-size:13px;color:#3B6D11;background:rgba(255,255,255,0.8);border:1px solid var(--green-br);border-radius:var(--radius);padding:6px;resize:vertical;display:inline-block;vertical-align:top">${actText}</textarea>`;
  
  // Update buttons
  actionsEl.innerHTML = `
    <button class="btn-suggestion" onclick="saveHistoricalCaseEdit(${JSON.stringify(caseData).replace(/"/g, '&quot;')}, ${caseIndex})">
      <i class="ti ti-device-floppy"></i> Save changes
    </button>
    <button class="btn-suggestion btn-suggestion--secondary" onclick="cancelHistoricalCaseEdit(${JSON.stringify(caseData).replace(/"/g, '&quot;')}, ${caseIndex})">
      <i class="ti ti-x"></i> Cancel
    </button>
  `;
}

// ── Save historical case edit — creates new record while keeping original ─────
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
  
  // Check if an edited version already exists for this original case
  const originalId = caseData.id.replace(/-EDIT-\d+$/, ''); // Remove any existing edit suffix
  const existingEditIndex = actionLog.findIndex(r => 
    r.id.startsWith(originalId + '-EDIT-') && r._src === 'user_edit'
  );
  
  if (existingEditIndex !== -1) {
    // Update existing edited record
    actionLog[existingEditIndex].act = newActionText;
    caseData.act = newActionText;
  } else {
    // Create a new record with the edited action (keep original unchanged)
    const newRecord = {
      ...caseData,
      id: originalId + '-EDIT-' + Date.now(),
      act: newActionText,
      _src: 'user_edit'
    };
    
    // Add the new record to actionLog
    actionLog.push(newRecord);
    
    // Update the case data (local copy for display)
    caseData.act = newActionText;
  }
  
  // Update the display
  actEl.innerHTML = `<i class="ti ti-check" style="font-size:13px;margin-right:4px;color:#3B6D11"></i>${newActionText}`;
  
  // Reset buttons
  actionsEl.innerHTML = `
    <button class="btn-suggestion" onclick="editHistoricalCase(${JSON.stringify(caseData).replace(/"/g, '&quot;')}, ${caseIndex})">
      <i class="ti ti-edit"></i> Edit case
    </button>
    <button class="btn-suggestion btn-suggestion--secondary" onclick="chooseHistoricalCase(${JSON.stringify(caseData).replace(/"/g, '&quot;')})">
      <i class="ti ti-check"></i> Choose as action
    </button>
  `;
  
  // Remove editing flag
  delete caseCard.dataset.editing;
  
  // Show confirmation that new version was created
  const confirmMsg = document.createElement('div');
  confirmMsg.style.cssText = 'position:fixed;top:20px;right:20px;background:#9FE1CB;color:#173404;padding:8px 12px;border-radius:4px;font-size:12px;z-index:1000;box-shadow:0 2px 8px rgba(0,0,0,0.1)';
  confirmMsg.innerHTML = '<i class="ti ti-check"></i> New version created (original preserved)';
  document.body.appendChild(confirmMsg);
  setTimeout(() => confirmMsg.remove(), 3000);
}

// ── Cancel historical case edit — reverts changes and restores original ───────
function cancelHistoricalCaseEdit(caseData, caseIndex) {
  const caseCards = document.querySelectorAll('.case-card');
  const caseCard = caseCards[caseIndex];
  if (!caseCard) return;
  
  const actEl = caseCard.querySelector('.case-act');
  const actionsEl = caseCard.querySelector('.case-actions');
  
  // Restore original action text
  actEl.innerHTML = `<i class="ti ti-check" style="font-size:13px;margin-right:4px;color:#3B6D11"></i>${caseData.act || ''}`;
  
  // Reset buttons
  actionsEl.innerHTML = `
    <button class="btn-suggestion" onclick="editHistoricalCase(${JSON.stringify(caseData).replace(/"/g, '&quot;')}, ${caseIndex})">
      <i class="ti ti-edit"></i> Edit case
    </button>
    <button class="btn-suggestion btn-suggestion--secondary" onclick="chooseHistoricalCase(${JSON.stringify(caseData).replace(/"/g, '&quot;')})">
      <i class="ti ti-check"></i> Choose as action
    </button>
  `;
  
  // Remove editing flag
  delete caseCard.dataset.editing;
}

// ── Toggle case expand — shows/hides implementation steps for historical cases ─
async function toggleCaseExpand(caseIndex) {
  const expandDiv = document.getElementById(`caseExpand${caseIndex}`);
  const expandIcon = document.getElementById(`expandIcon${caseIndex}`);
  const expandText = document.getElementById(`expandText${caseIndex}`);
  
  if (!expandDiv || !expandIcon || !expandText) return;
  
  const isExpanded = expandDiv.style.display !== 'none';
  
  if (isExpanded) {
    // Collapse
    expandDiv.style.display = 'none';
    expandIcon.className = 'ti ti-chevron-down';
    expandText.textContent = 'Show steps';
  } else {
    // Expand and generate AI steps
    expandDiv.style.display = 'block';
    expandIcon.className = 'ti ti-chevron-up';
    expandText.textContent = 'Hide steps';
    
    // Check if we already have AI-generated steps
    const stepsList = expandDiv.querySelector('.steps-list');
    if (stepsList && !stepsList.dataset.aiGenerated) {
      // Show loading state
      stepsList.innerHTML = '<li style="color:#666;font-style:italic;"><div class="spin" style="display:inline-block;width:12px;height:12px;margin-right:8px;border-top-color:#666"></div>Generating AI implementation steps...</li>';
      
      try {
        // Get case data from the case card
        const caseCards = document.querySelectorAll('.case-card');
        const caseCard = caseCards[caseIndex];
        const caseDesc = caseCard.querySelector('.case-inc').textContent.replace(/^⚠\s*/, '');
        const caseAct = caseCard.querySelector('.case-act').textContent.replace(/^✓\s*/, '');
        const hlBadge = caseCard.querySelector('.hl-badge');
        const hlLevel = hlBadge ? parseInt(hlBadge.textContent.match(/Level (\d+)/)?.[1]) || 4 : 4;
        const hlLabel = hlBadge ? hlBadge.textContent.split(': ')[1] || 'Administrative' : 'Administrative';
        const site = caseCard.querySelector('.site-tag').textContent.replace(/📍\s*/, '');
        const recurred = caseCard.querySelector('.rec-no, .rec-yes').textContent.includes('Did not recur') ? false : true;
        
        const caseData = {
          desc: caseDesc,
          act: caseAct,
          hierarchy_level: hlLevel,
          hierarchy_label: hlLabel,
          site: site,
          recurred: recurred
        };
        
        // Generate AI implementation steps
        const steps = await generateImplementationSteps(caseData, _currentCtx?.desc || '');
        
        // Update the steps list with AI-generated steps
        stepsList.innerHTML = steps.map(s => `<li>${s}</li>`).join('');
        stepsList.dataset.aiGenerated = 'true';
        
        // Update the header to show AI-generated
        const stepsHeader = expandDiv.querySelector('div[style*="font-weight:500"]');
        if (stepsHeader) {
          stepsHeader.innerHTML = 'Implementation steps <span style="color:#666;font-weight:normal">(AI-generated)</span>';
        }
        
      } catch (error) {
        // Show error and fallback to default steps
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

// ── Choose historical case — user selects a historical case as their action ───
function chooseHistoricalCase(caseData) {
  if (!_currentCtx || !caseData) return;
  
  // Update _lastRec with the historical case data
  _lastRec = {
    action: caseData.act || '',
    hierarchy_level: caseData.hierarchy_level || caseData.hl,
    hierarchy_label: caseData.hierarchy_label || caseData.hlab,
    reasoning: `Selected based on historical case ${caseData.id} from ${caseData.site}. This action was ${(caseData.recurred === false || caseData.recurred === 'false') ? 'effective (did not recur)' : 'taken but incident recurred'}.`,
    implementation_steps: [`Implement the same corrective action as case ${caseData.id}`, 'Monitor effectiveness', 'Document results']
  };
  
  // Update the recommendation card
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
    
    // Update buttons to show "Action taken" state
    const editBtn = document.getElementById('editSuggestionBtn');
    const chooseBtn = document.getElementById('chooseSuggestionBtn');
    const actionBtn = document.getElementById('actionTakenBtn');
    
    if (editBtn) editBtn.style.display = 'none';
    if (chooseBtn) chooseBtn.style.display = 'none';
    if (actionBtn) actionBtn.style.display = 'inline-flex';
    
    recCard.style.borderColor = 'var(--green-br)';
    recCard.style.borderWidth = '2px';
  }
  
  // Scroll to recommendation
  recCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Mark action taken — saves current recommendation into actionLog ────────────
function markActionTaken() {
  if (!_currentCtx || !_lastRec) return;
  const record = {
    id:   'USER-' + Date.now(),
    cat:  _currentCtx.cat || 'Unknown',
    desc: _currentCtx.desc,
    loc:  _currentCtx.loc || '',
    site: 'Ovako',
    act:  _lastRec.action,
    hl:   _lastRec.hierarchy_level,
    hlab: _lastRec.hierarchy_label,
    kw:   tokenize(_currentCtx.desc + ' ' + _lastRec.action).join(' '),
    rec:  false,
    _src: 'user'
  };
  actionLog.push(record);

  const btn = document.getElementById('actionTakenBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="ti ti-circle-check"></i> Action logged';
    btn.classList.add('btn-action-taken--done');
  }
}
