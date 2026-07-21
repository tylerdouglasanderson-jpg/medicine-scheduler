// The only module touching persistence.
import { parseScenario } from '../model.js';

const mem = new Map();
let available = true;
try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); }
catch { available = false; }               // Safari file:// throws SecurityError

export const storage = {
  available,
  get: k => { try { return available ? JSON.parse(localStorage.getItem(k)) : mem.get(k) ?? null; } catch { return null; } },
  set: (k, v) => { try { if (available) localStorage.setItem(k, JSON.stringify(v)); else mem.set(k, v); } catch { mem.set(k, v); } },
};

const KEY = 'med-scheduler-scenario';

const BLANK_SCENARIO = { team: 'A', month: '', anchorType: 'precall', residents: [] };

export function loadScenario() {
  return parseScenario(storage.get(KEY) ?? BLANK_SCENARIO);
}

// Fresh empty scenario — same shape loadScenario() gives on a first-ever visit.
export function blankScenario() {
  return parseScenario(BLANK_SCENARIO);
}

export function saveScenario(scenario) {
  storage.set(KEY, scenario);
}

export function exportScenarioJSON(scenario) {
  return JSON.stringify(scenario, null, 2);
}

export function importScenarioJSON(text) {
  let json;
  try { json = JSON.parse(text); }
  catch (e) { throw new Error(`Could not parse scenario JSON: ${e.message}`); }
  return parseScenario(json);
}
