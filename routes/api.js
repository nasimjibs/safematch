const express = require('express');
const router = express.Router();
const incidents = require('../services/incidents');
const llm = require('../services/llm');

// GET /api/dropdowns
router.get('/dropdowns', (req, res) => {
  res.json(incidents.getDropdowns());
});

// GET /api/samples
router.get('/samples', (req, res) => {
  res.json(incidents.getSamples());
});

// GET /api/incidents
router.get('/incidents', (req, res) => {
  res.json(incidents.getAllRecords());
});

// POST /api/analyze
router.post('/analyze', async (req, res) => {
  try {
    const { desc } = req.body;
    if (!desc || !desc.trim()) {
      return res.status(400).json({ error: 'Incident description is required' });
    }
    if (!llm.isConfigured()) {
      return res.status(500).json({ error: 'OpenRouter API key not configured on server. Set OPENROUTER_API_KEY in .env' });
    }

    const tokens = incidents.tokenize(desc);
    const allRecords = incidents.getAllRecords();
    const scored = allRecords
      .map(r => ({ ...r, score: incidents.scoreRecord(r, tokens) }))
      .sort((a, b) => b.score - a.score || a.hl - b.hl);
    const candidates = scored.slice(0, 15);

    const result = await llm.analyzeIncident(desc, candidates);

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

// POST /api/implementation-steps
router.post('/implementation-steps', async (req, res) => {
  const { caseData, currentIncident } = req.body;
  const steps = await llm.generateSteps(caseData, currentIncident);
  res.json({ steps });
});

// POST /api/action-log
router.post('/action-log', (req, res) => {
  const record = req.body;
  if (!record || !record.desc) {
    return res.status(400).json({ error: 'Action record with description is required' });
  }
  res.json(incidents.addToActionLog(record));
});

module.exports = router;
