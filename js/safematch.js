// SafeMatch — RAG Pipeline Logic
// Implements: keyword extraction → candidate retrieval → LLM API ranking → results render

let API_KEY = '';
let PROVIDER = 'anthropic';

const PROVIDER_CONFIG = {
  anthropic: {
    keyPrefix: 'sk-ant-',
    placeholder: 'sk-ant-api03-...',
    model: 'claude-sonnet-4-20250514',
    label: 'Anthropic'
  },
  gemini: {
    keyPrefix: 'AIza',
    placeholder: 'AIzaSy...',
    model: 'gemini-2.0-flash',
    label: 'Gemini'
  }
};

// ── Provider / API Key Management ─────────────────────────────────────────────
function onProviderChange() {
  PROVIDER = document.getElementById('providerSel').value;
  document.getElementById('apiKeyInput').placeholder = PROVIDER_CONFIG[PROVIDER].placeholder;
  document.getElementById('apiStatus').textContent = '';
  API_KEY = '';
}

function saveKey() {
  const val = document.getElementById('apiKeyInput').value.trim();
  const cfg = PROVIDER_CONFIG[PROVIDER];
  if (!val.startsWith(cfg.keyPrefix)) {
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
async function callAnthropicAPI(prompt) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: PROVIDER_CONFIG.anthropic.model,
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error?.message || `Anthropic API error ${resp.status}`);
  }
  const data = await resp.json();
  return data.content?.[0]?.text || '';
}

async function callGeminiAPI(prompt) {
  const model = PROVIDER_CONFIG.gemini.model;
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 1000 }
      })
    }
  );
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error?.message || `Gemini API error ${resp.status}`);
  }
  const data = await resp.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ── Main analysis pipeline ────────────────────────────────────────────────────
async function analyze() {
  const desc = document.getElementById('incDesc').value.trim();
  if (!desc) { document.getElementById('incDesc').focus(); return; }
  if (!API_KEY) { alert(`Please enter your ${PROVIDER_CONFIG[PROVIDER].label} API key at the top of the page.`); return; }

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
    const scored = DS
      .map(r => ({ ...r, score: scoreRecord(r, tokens) }))
      .sort((a, b) => b.score - a.score || a.hl - b.hl);
    const candidates = scored.slice(0, 15);
    setStep(2, 'done', `${candidates.length} candidate cases retrieved from ${DS.length} records`);

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

    const raw = PROVIDER === 'gemini'
      ? await callGeminiAPI(prompt)
      : await callAnthropicAPI(prompt);
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

  box.innerHTML = `
    <!-- Recommendation -->
    <div class="rec-card">
      <div class="rec-hdr">
        <i class="ti ${HL_ICON[rec.hierarchy_level] || 'ti-shield'}" style="font-size:20px;color:#3B6D11"></i>
        <span class="rec-title">Recommended corrective action — ${hlBadge(rec.hierarchy_level, rec.hierarchy_label)}</span>
      </div>
      <p class="rec-action">${rec.action}</p>
      <p class="rec-reason">${rec.reasoning}</p>
      ${result.warning ? `<p style="font-size:12px;color:#854F0B;margin-top:8px"><i class="ti ti-alert-triangle"></i> ${result.warning}</p>` : ''}
      <div class="divider"></div>
      <div style="font-size:12px;font-weight:500;color:#3B6D11;margin-bottom:6px">Implementation steps</div>
      <ul class="steps-list">
        ${(rec.implementation_steps || []).map(s => `<li>${s}</li>`).join('')}
      </ul>
    </div>

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
          <span class="${(c.recurred === false || c.recurred === 'false') ? 'rec-no' : 'rec-yes'}">
            ${(c.recurred === false || c.recurred === 'false') ? 'Did not recur' : 'Recurred after action'}
          </span>
          <span class="site-tag" style="font-style:italic">${c.similarity_reason || ''}</span>
        </div>
      </div>`).join('')}
  `;

  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
