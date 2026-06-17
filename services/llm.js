const API_KEY = process.env.OPENROUTER_API_KEY || '';
const OR_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';

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

function isConfigured() {
  return Boolean(API_KEY && API_KEY.startsWith('sk-or-'));
}

async function analyzeIncident(desc, candidates) {
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
  let cleaned = raw.replace(/```json|```/g, '').trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    console.error('Failed to parse LLM response:', raw);
    throw new Error('Could not parse AI response. Please try again.');
  }
}

const DEFAULT_STEPS = ['Review incident details', 'Implement corrective action', 'Monitor effectiveness', 'Document results'];

async function generateSteps(caseData, currentIncident) {
  if (!isConfigured()) return DEFAULT_STEPS;

  try {
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
