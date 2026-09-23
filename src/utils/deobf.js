/**
 * Emorce deobf engine wrapper — local + upstream proxy
 */
// Node 18+ global fetch; FormData from form-data for multipart
const FormData = require('form-data');


const { detectEngine, isProbablyLua } = require('../../lib/detectors');
const { deobfuscatePrometheus } = require('../../lib/prometheus');
const { deobfuscateMoonSecStatic } = require('../../lib/moonsec');
const { deobfuscateGeneric } = require('../../lib/generic');

const LEAKD_BASE = (process.env.LEAKD_BASE || 'https://leakd.up.railway.app').replace(/\/$/, '');
const PROXY_ENABLED = process.env.PROXY_ENABLED !== '0';

function runLocal(engine, code) {
  if (engine === 'prometheus' || engine === 'wearedevs') {
    return deobfuscatePrometheus(code);
  }
  if (engine === 'moonsec') {
    return deobfuscateMoonSecStatic(code);
  }
  return deobfuscateGeneric(code);
}

async function proxyUpstream(endpoint, code, filename = 'script.lua') {
  if (!PROXY_ENABLED) throw new Error('Upstream proxy disabled');
  const form = new FormData();
  form.append('file', Buffer.from(code, 'utf8'), {
    filename,
    contentType: 'text/plain',
  });
  const url = `${LEAKD_BASE}/${endpoint.replace(/^\//, '')}`;
  const res = await fetch(url, {
    method: 'POST',
    body: form,
    headers: form.getHeaders(),
    timeout: 90000,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Upstream ${endpoint} ${res.status}: ${text.slice(0, 250)}`);
    err.status = res.status;
    throw err;
  }
  try {
    const j = JSON.parse(text);
    if (j.code) return j.code;
    if (j.result) return j.result;
    if (j.deobfuscated) return j.deobfuscated;
    if (j.output) return j.output;
  } catch (_) {}
  return text;
}

/**
 * @param {string} code
 * @param {{ engine?: string, useProxy?: 'auto'|'true'|'false', filename?: string }} opts
 */
async function deobfuscate(code, opts = {}) {
  if (!code || !String(code).trim()) {
    return { success: false, error: 'empty script' };
  }
  if (!isProbablyLua(code) && code.length < 40) {
    return { success: false, error: 'does not look like Lua' };
  }

  let engine = (opts.engine || 'auto').toLowerCase();
  const useProxy = String(opts.useProxy || 'auto').toLowerCase();
  const filename = opts.filename || 'script.lua';

  const detected = detectEngine(code);
  if (engine === 'auto') {
    engine = detected.engine === 'unknown' ? 'generic' : detected.engine;
  }
  if (engine === 'wearedevs') engine = 'prometheus';

  const preferProxy =
    useProxy === '1' ||
    useProxy === 'true' ||
    (useProxy === 'auto' &&
      PROXY_ENABLED &&
      (engine === 'moonsec' || engine === 'luaobfuscator' || detected.confidence < 0.55));

  const map = {
    moonsec: 'moonsec',
    prometheus: 'prometheus',
    wearedevs: 'prometheus',
    luaobfuscator: 'luaobfuscator',
    generic: 'prometheus',
  };

  if (preferProxy && PROXY_ENABLED) {
    const ep = map[engine] || 'prometheus';
    try {
      const out = await proxyUpstream(ep, code, filename);
      return {
        success: true,
        code: out,
        engine,
        source: 'upstream:' + ep,
        detected,
        notes: ['proxied ' + LEAKD_BASE + '/' + ep],
      };
    } catch (e) {
      const local = runLocal(engine, code);
      local.source = 'local-fallback';
      local.upstream_error = String(e.message || e);
      local.detected = detected;
      local.success = true;
      return local;
    }
  }

  const local = runLocal(engine, code);
  local.source = 'local';
  local.detected = detected;
  local.success = true;
  return local;
}

module.exports = {
  deobfuscate,
  detectEngine,
  LEAKD_BASE,
  PROXY_ENABLED,
};
