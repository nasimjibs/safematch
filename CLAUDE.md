# Ovako Safety Recommendation System — SÄKU Hackathon 2026

## Project Overview

AI-powered safety recommendation tool for Ovako, a Swedish steel manufacturer. The system takes a new workplace incident as input, semantically matches it against historical incidents, and recommends proven corrective actions ranked by the hierarchy of controls.

## The Problem

Ovako uses MIA (IA-systemet by AFA Försäkring) to log workplace incidents and corrective actions. Despite years of historical data in the system, managers consistently pick weak fixes (warning signs, reminders) over stronger engineering solutions — because finding relevant past cases is too hard. The existing "Find actions" button is just a basic keyword search that doesn't work well with messy, inconsistent incident report language.

## Our Solution

Replace the dumb search with AI semantic matching that:
- Understands messy free-text incident descriptions
- Finds genuinely similar past incidents across the organization
- Ranks recommendations by hierarchy of controls (engineering > administrative > PPE)
- Shows evidence and effectiveness rates behind each suggestion
- Splits fixes into immediate interim action and permanent solution
- Assigns ownership and deadlines to prevent good intentions being forgotten
- Shows cost of inaction to counter the "it costs money" objection

## Hierarchy of Controls (ranked best to worst)

1. Elimination — remove the hazard entirely
2. Substitution — replace with something safer
3. Engineering controls — physical barriers, guards, redesign
4. Administrative controls — signage, warnings, procedures
5. PPE — personal protective equipment (last resort)

## Tech Stack

- **LLM:** Google Gemini 2.5 Pro via OpenRouter
- **API:** OpenRouter (`https://openrouter.ai/api`)
- **Embeddings:** For semantic similarity matching of incident reports

## Environment Variables (Windows)

Set in system environment or `.env` file:

```
ANTHROPIC_API_KEY=your-openrouter-key
ANTHROPIC_BASE_URL=https://openrouter.ai/api
ANTHROPIC_MODEL=google/gemini-2.5-pro-preview
ANTHROPIC_SMALL_FAST_MODEL=google/gemini-2.5-flash
```

## Data

We are using synthetic/generated incident data for the PoC since real Ovako data may not be available on hack day. Incident reports should reflect real-world messiness — inconsistent language, varying detail levels, mix of Swedish and English.

## Incident Data Structure

Each incident should capture:
- Incident type (slip, fall, machinery, chemical, near-miss etc.)
- Location / department
- Contributing factors (fatigue, time pressure, broken equipment, missing PPE etc.)
- Severity
- Free text description (messy, as a real worker would write it)
- Corrective action taken
- Action type (mapped to hierarchy of controls)
- Outcome / recurrence data if available

## Key Design Principles

- Show ONE strong recommendation first, not a long list (Klein RPD model)
- Always show evidence behind recommendation ("used in 12 similar cases, zero recurrence")
- Split into immediate fix (today) and permanent fix (with deadline)
- Show cost of inaction alongside cost of action
- Use social proof ("89% of similar incidents used this fix")
- Pre-assign owner and deadline at moment of recommendation
- Color code by hierarchy level — green for engineering, red for PPE

## Jury Evaluation Criteria

1. User goal clarity — clearly articulate who the user is and what they're trying to do
2. Mission criticality — how important is this problem
3. Solution quality — how much better does the user succeed with our solution
4. Viability — can this realistically be built with reasonable investment

## Demo Video Requirements

- Max 5 minutes
- Submit as a link (YouTube etc.), not a file
- Start by showing who the user is and what they're trying to accomplish
- Show the solution working live
- Make clear users succeed meaningfully better with the solution than without it