require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// ── Config ───────────────────────────────────────────────────────────────────
const API_KEY = process.env.OPENROUTER_API_KEY || '';
const OR_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const PORT = process.env.PORT || 3000;

// ── Load data ────────────────────────────────────────────────────────────────
const DS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'incidents.json'), 'utf8'));
const SAMPLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'samples.json'), 'utf8'));
const OVAKO_RAW = JSON.parse(fs.readFileSync(path.join(__dirname, 'ovako.json'), 'utf8'));

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

// In-memory action log — seeded from ovako.json
let actionLog = OVAKO_RAW.map(normalizeOvakoRecord);

// ── Utilities ────────────────────────────────────────────────────────────────
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

// ── OpenRouter API caller ────────────────────────────────────────────────────
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

// ── API Routes ───────────────────────────────────────────────────────────────

// GET /api/dropdowns — unique locations and categories from DS
app.get('/api/dropdowns', (req, res) => {
  const locations = [...new Set(DS.map(r => r.loc))].sort();
  const categories = [...new Set(DS.map(r => r.cat))].sort();
  res.json({ locations, categories });
});

// GET /api/samples — sample incidents for quick-fill chips
app.get('/api/samples', (req, res) => {
  res.json(SAMPLES);
});

// GET /api/incidents — all records (DS + actionLog)
app.get('/api/incidents', (req, res) => {
  res.json([...DS, ...actionLog]);
});

// POST /api/analyze — full analysis pipeline
app.post('/api/analyze', async (req, res) => {
  try {
    const { desc } = req.body;
    if (!desc || !desc.trim()) {
      return res.status(400).json({ error: 'Incident description is required' });
    }
    if (!API_KEY || API_KEY === 'sk-or-REPLACE_WITH_YOUR_KEY') {
      return res.status(500).json({ error: 'OpenRouter API key not configured on server. Set OPENROUTER_API_KEY in .env' });
    }

    // Step 1: Tokenize
    const tokens = tokenize(desc);

    // Step 2: Score and retrieve candidates
    const allRecords = [...DS, ...actionLog];
    const scored = allRecords
      .map(r => ({ ...r, score: scoreRecord(r, tokens) }))
      .sort((a, b) => b.score - a.score || a.hl - b.hl);
    const candidates = scored.slice(0, 15);

    // Step 3: LLM ranking
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
      let cleaned = raw.replace(/```json|```/g, '').trim();
      // Extract JSON object if LLM wraps it in extra text
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) cleaned = jsonMatch[0];
      result = JSON.parse(cleaned);
    } catch (e) {
      console.error('Failed to parse LLM response:', raw);
      throw new Error('Could not parse AI response. Please try again.');
    }

    res.json({
      tokens: tokens.slice(0, 8),
      candidateCount: candidates.length,
      totalRecords: allRecords.length,
      result,
      candidates
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/implementation-steps — generate AI implementation steps for a case
app.post('/api/implementation-steps', async (req, res) => {
  try {
    const { caseData, currentIncident } = req.body;

    if (!API_KEY || API_KEY === 'sk-or-REPLACE_WITH_YOUR_KEY') {
      return res.json({
        steps: ['Review incident details', 'Implement corrective action', 'Monitor effectiveness', 'Document results']
      });
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

    const raw = await callOpenRouterAPI(prompt);
    let cleaned = raw.replace(/```json|```/g, '').trim();
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) cleaned = arrMatch[0];
    const steps = JSON.parse(cleaned);
    res.json({
      steps: Array.isArray(steps) ? steps : ['Review incident details', 'Implement corrective action', 'Monitor effectiveness', 'Document results']
    });
  } catch (e) {
    res.json({
      steps: ['Review incident details', 'Implement corrective action', 'Monitor effectiveness', 'Document results']
    });
  }
});

// POST /api/action-log — save a user action to the log
app.post('/api/action-log', (req, res) => {
  const record = req.body;
  if (!record || !record.desc) {
    return res.status(400).json({ error: 'Action record with description is required' });
  }
  record.id = record.id || 'USER-' + Date.now();
  record._src = 'user';
  actionLog.push(record);
  res.json({ ok: true, id: record.id, totalActions: actionLog.length });
});

// ── Serve static files ───────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname)));

// ── Start server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`SafeMatch server running on http://localhost:${PORT}`);
  console.log(`API key configured: ${API_KEY && API_KEY.startsWith('sk-or-') ? 'Yes' : 'NO — set OPENROUTER_API_KEY in .env'}`);
});
