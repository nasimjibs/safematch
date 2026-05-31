# SafeMatch — Ovako AI Safety Advisor (PoC)

AI-powered corrective action advisor that surfaces what worked in similar
historical incidents, ranked by the Hierarchy of Controls.

---

## How to run (takes 30 seconds)

### Option A — Open directly in browser (simplest)

1. Unzip the folder
2. Double-click `index.html`
3. It opens in your browser — done

> No server, no install, no terminal needed.

---

### Option B — Run with a local server (recommended for Chrome)

Chrome blocks some local file requests. If chips or the API don't work,
use a simple server instead:

**With Node.js (if installed):**
```bash
cd safematch
npx serve .
# Opens at http://localhost:3000
```

**With Python (usually pre-installed):**
```bash
cd safematch
python3 -m http.server 8080
# Opens at http://localhost:8080
```

---

## First-time setup

1. Get your Anthropic API key from https://console.anthropic.com
2. Open the app in your browser
3. Paste your API key in the bar at the top — it starts with `sk-ant-`
4. Click **Save key**
5. You're ready — try one of the sample incidents

---

## Project structure

```
safematch/
├── index.html          Main UI — open this in your browser
├── data/
│   └── incidents.js    47 synthetic historical incidents (your knowledge base)
├── js/
│   └── safematch.js    RAG pipeline logic + UI rendering
└── README.md           This file
```

---

## How the RAG pipeline works

```
User inputs incident description
        ↓
Step 1 — JS tokenizes input into keywords
        ↓
Step 2 — Keywords scored against all 47 records
         Top 15 candidates retrieved
        ↓
Step 3 — 15 candidates sent to Claude API
         Claude picks top 5 and ranks by Hierarchy of Controls
        ↓
Step 4 — Recommendation + similar cases displayed
```

---

## Swapping in real Ovako data

When you receive the real MIA export from Ovako:

1. Open `data/incidents.js`
2. Replace (or extend) the `DS` array with real records
3. Each record needs these fields:

```js
{
  id:    'OVK-0001',          // unique ID
  cat:   'Fall',              // hazard category
  desc:  'Incident description text',
  loc:   'Ugnshalten',        // unit/location
  site:  'Hofors',            // plant site
  act:   'Corrective action taken',
  hl:    3,                   // hierarchy level 1-5
  hlab:  'Engineering',       // hierarchy label
  kw:    'fall height guardrail platform',  // search keywords
  rec:   false,               // did incident recur? true/false
}
```

---

## Replacing synthetic data with LLM-classified real data

For production, run each MIA record through Claude first to:
- Auto-classify the hierarchy level of the corrective action
- Extract keywords automatically
- Flag whether the incident recurred

Example classification prompt (run once during data prep):
```
Given this corrective action: "[ACTION TEXT]"
Classify it by Hierarchy of Controls level (1=Elimination, 2=Substitution,
3=Engineering, 4=Administrative, 5=PPE) and extract 5-8 search keywords.
Return JSON: {"hl": 3, "hlab": "Engineering", "keywords": "..."}
```

---

## Tech stack

- Vanilla HTML/CSS/JavaScript — no framework, no build step
- Anthropic Claude API (claude-sonnet-4-20250514)
- Tabler Icons (CDN)
- Everything runs in the browser

---

## Hackathon pitch notes

**Q1 one-liner:**
"We help managers and safety representatives at Ovako choose a more effective
corrective action — by showing them what worked in similar past incidents across
all sites, ranked by the Hierarchy of Controls, at the moment they make the
decision."

**Q2 one-liner:**
"Every corrective action decision at Ovako is made from scratch with no
reference to history and no guidance on the Hierarchy of Controls — so the same
weak fixes get chosen repeatedly, and the same incidents keep happening."

---

Built for the Ovako AI Hackathon — SafeMatch PoC
