/**
 * Emorce Deobf — engine detectors
 * Detects Prometheus, MoonSec V3, WeAreDevs/Prometheus fork, LuaObfuscator, Luraph-ish
 */

function detectEngine(src) {
  if (!src || typeof src !== 'string') return { engine: 'unknown', confidence: 0, reasons: [] };

  const s = src;
  const reasons = [];
  let engine = 'unknown';
  let confidence = 0;

  // MoonSec V3 signatures
  const moonsecHits = [
    /This file was protected with MoonSec V3/i,
    /MoonSec_StringsHiddenAttr/,
    /_ENV;%w+='/,
    /\[\[This file was protected with MoonSec/,
    /federal#?\d+/i,
    /MoonSec V3 by/i,
  ];
  let moon = 0;
  for (const re of moonsecHits) if (re.test(s)) { moon++; reasons.push('moonsec:' + re.source.slice(0, 40)); }
  if (moon >= 1) {
    engine = 'moonsec';
    confidence = Math.min(0.95, 0.55 + moon * 0.15);
  }

  // Prometheus / WeAreDevs style
  const promHits = [
    /Prometheus/i,
    /wearedevs\.net\/obfuscator/i,
    /return\s*\(function\s*\(\.\.\.\)\s*local\s+\w+\s*=\s*\{/,
    /PHASE_BOUNDARY/i,
    /ConstantArray/i,
    /VM_\w+_BOUNDARY/i,
    /--\s*\[\[\s*v\d+\.\d+\.\d+/i,
    /wearedevs/i,
    /GetFenv|getfenv\s*\(\s*\)\s*\[\s*["']Prometheus/i,
    /local\s+\w+\s*=\s*\{\s*["']\\[0-9]{3}/,
  ];
  let prom = 0;
  for (const re of promHits) if (re.test(s)) { prom++; reasons.push('prometheus:' + re.source.slice(0, 40)); }
  // common Prometheus constant array + wrapper pattern
  if (/return\s*\(\s*function\s*\(\s*\.\.\.\s*\)/.test(s) && /local\s+\w+\s*=\s*\{[\s\S]{20,}?\}/.test(s) && /string\.char|string\.byte|bit32|bit\./.test(s)) {
    prom += 2;
    reasons.push('prometheus:wrapper+constarray');
  }
  // dense Lua decimal escapes in string table (WeAreDevs / Prometheus)
  const escCount = (s.match(/\\[0-9]{3}/g) || []).length;
  if (escCount >= 20 && /return\s*\(\s*function/.test(s)) {
    prom += 2;
    reasons.push('prometheus:dense-decimal-escapes(' + escCount + ')');
  }
  if (prom >= 1 && confidence < 0.7) {
    engine = prom >= 2 ? 'prometheus' : (engine === 'unknown' ? 'prometheus' : engine);
    confidence = Math.max(confidence, Math.min(0.92, 0.5 + prom * 0.12));
  }

  // LuaObfuscator / online services style
  const luaobfHits = [
    /LuaObfuscator/i,
    /obfuscator\.io/i,
    /Luraph Obfuscator/i,
    /\):mq\(\)\(\.\.\.\)/,
    /LuraphContinue/,
  ];
  let lo = 0;
  for (const re of luaobfHits) if (re.test(s)) { lo++; reasons.push('luaobf:' + re.source.slice(0, 40)); }
  if (lo >= 1 && confidence < 0.75) {
    engine = 'luaobfuscator';
    confidence = Math.max(confidence, 0.7);
  }

  // Generic heavy obfuscation fallback
  if (engine === 'unknown') {
    if (/loadstring|load\s*\(/.test(s) && /string\.char|string\.byte/.test(s) && s.length > 800) {
      engine = 'generic';
      confidence = 0.4;
      reasons.push('generic:loadstring+char');
    }
  }

  return { engine, confidence, reasons };
}

function isProbablyLua(src) {
  if (!src || src.length < 10) return false;
  return /function|local|end|return|then|do\b/.test(src) || /--\[\[|loadstring|getfenv/.test(src);
}

module.exports = { detectEngine, isProbablyLua };
