const path = require('path');
const fs = require('fs');

// ── Load data ────────────────────────────────────────────────────────────────
const DS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'incidents.json'), 'utf8'));
const SAMPLES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'samples.json'), 'utf8'));
const OVAKO_RAW = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'ovako.json'), 'utf8'));

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
const actionLog = OVAKO_RAW.map(normalizeOvakoRecord);

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

function getAllRecords() {
  return [...DS, ...actionLog];
}

function getDropdowns() {
  const locations = [...new Set(DS.map(r => r.loc))].sort();
  const categories = [...new Set(DS.map(r => r.cat))].sort();
  return { locations, categories };
}

function getSamples() {
  return SAMPLES;
}

function addToActionLog(record) {
  record.id = record.id || 'USER-' + Date.now();
  record._src = 'user';
  actionLog.push(record);
  return { ok: true, id: record.id, totalActions: actionLog.length };
}

module.exports = {
  tokenize,
  scoreRecord,
  getAllRecords,
  getDropdowns,
  getSamples,
  addToActionLog,
};
