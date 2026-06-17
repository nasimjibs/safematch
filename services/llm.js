const API_KEY = process.env.OPENROUTER_API_KEY || '';
const OR_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';

async function callLLM(system, user) {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
  const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: OR_MODEL,
      max_tokens: 800,
      temperature: 0.3,
      messages
    })
  });
  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error?.message || `OpenRouter API error ${resp.status}`);
  }
  const data = await resp.json();
  const content = data.choices?.[0]?.message?.content || '';
  if (!content) {
    console.error('Empty LLM response. Full payload:', JSON.stringify(data).substring(0, 500));
    throw new Error('Empty response from AI model.');
  }
  return content;
}

function isConfigured() {
  return Boolean(API_KEY && API_KEY.startsWith('sk-or-'));
}

function parseJSON(raw) {
  let cleaned = raw.replace(/```json\s*|```/g, '').trim();
  // Try direct parse first
  try { return JSON.parse(cleaned); } catch (e) { /* fall through */ }
  // Extract JSON object or array from surrounding text
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch (e) { /* fall through */ }
  }
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch (e) { /* fall through */ }
  }
  console.error('parseJSON failed. Raw response:\n', raw.substring(0, 1000));
  throw new Error('Could not parse AI response');
}

// ── Analysis prompt ──────────────────────────────────────────────────────────

const SYSTEM_ANALYZE = `You are an Ovako steel plant safety expert. You rank historical incidents by relevance and recommend the STRONGEST feasible corrective action using the Hierarchy of Controls.

Hierarchy (strongest first):
1=Elimination 2=Substitution 3=Engineering 4=Administrative 5=PPE

Key rules:
- ALWAYS prefer the highest (lowest number) feasible hierarchy level
- Cases where recurred=false are PROVEN effective — weight them heavily
- Level 4-5 actions are weak. Only recommend them if no Level 1-3 option exists in the evidence
- The recommendation must be specific and actionable, not generic

Respond with ONLY valid JSON.`;

async function analyzeIncident(desc, candidates) {
  // Send top 8 candidates instead of 15 — LLM only picks 5
  const top = candidates.slice(0, 8);

  const user = `INCIDENT: "${desc}"

HISTORICAL CASES:
${top.map((r, i) => `[${i + 1}] ${r.id} | ${r.cat} | ${r.site} | HL:${r.hl}(${r.hlab}) | Recurred:${r.rec}
"${r.desc}" → "${r.act}"
KW: ${r.kw}`).join('\n')}

Return JSON:
{"topCases":[{"id":"...","rank":1,"similarity_reason":"...","hierarchy_level":1,"hierarchy_label":"...","recurred":false,"site":"..."}],"recommendation":{"action":"...","hierarchy_level":1,"hierarchy_label":"...","reasoning":"...","implementation_steps":["...","...","..."]},"warning":"...or null"}

Pick 5 most relevant cases sorted by hierarchy level (strongest first). Recommendation must use the highest feasible level supported by evidence.`;

  const raw = await callLLM(SYSTEM_ANALYZE, user);
  try {
    return parseJSON(raw);
  } catch (e) {
    console.error('Failed to parse LLM response:', raw);
    throw new Error('Could not parse AI response. Please try again.');
  }
}

// ── Implementation steps prompt ──────────────────────────────────────────────

const SYSTEM_STEPS = `You are an Ovako steel plant safety expert. Generate practical implementation steps a site manager can follow immediately. Be specific to the steel manufacturing context. Respond with ONLY a JSON object.`;

const DEFAULT_STEPS = ['Review incident details', 'Implement corrective action', 'Monitor effectiveness', 'Document results'];

async function generateSteps(caseData, currentIncident) {
  if (!isConfigured()) return DEFAULT_STEPS;

  try {
    const user = `INCIDENT: "${currentIncident}"
ACTION: "${caseData.act}"
LEVEL: ${caseData.hierarchy_level || caseData.hl} (${caseData.hierarchy_label || caseData.hlab})
SITE: ${caseData.site}

Return JSON: {"steps":["step1","step2","step3","step4"]}
Generate 4-6 specific steps. Include who is responsible, what to procure/install, and a verification check.`;

    const raw = await callLLM(SYSTEM_STEPS, user);
    const parsed = parseJSON(raw);
    const steps = parsed.steps || parsed;
    return Array.isArray(steps) ? steps : DEFAULT_STEPS;
  } catch (e) {
    return DEFAULT_STEPS;
  }
}

module.exports = {
  isConfigured,
  analyzeIncident,
  generateSteps,
};
