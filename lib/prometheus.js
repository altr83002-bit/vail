/**
 * Emorce Prometheus / WeAreDevs static deobfuscator (Node)
 * Handles common patterns: constant arrays, string.char chains, simple CFF unwrap, wrapper peel.
 * Not a full AST recompiler — best-effort cleanup for Railway deploy.
 */

function decodeEscapedString(str) {
  // Lua-style decimal escapes \072 \101 etc, then hex / common
  let out = '';
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\' && i + 1 < str.length) {
      const rest = str.slice(i + 1);
      const dec = rest.match(/^(\d{1,3})/);
      if (dec) {
        const code = parseInt(dec[1], 10);
        if (code <= 255) {
          out += String.fromCharCode(code);
          i += dec[1].length;
          continue;
        }
      }
      const hex = rest.match(/^x([0-9a-fA-F]{2})/i);
      if (hex) {
        out += String.fromCharCode(parseInt(hex[1], 16));
        i += 1 + hex[1].length;
        continue;
      }
      const map = { n: '\n', r: '\r', t: '\t', '\\': '\\', '"': '"', "'": "'" };
      if (map[str[i + 1]] !== undefined) {
        out += map[str[i + 1]];
        i += 1;
        continue;
      }
    }
    out += str[i];
  }
  return out;
}

function extractConstantArray(src) {
  // local A={"\056...","abc",...}
  const m = src.match(/local\s+([A-Za-z_][\w]*)\s*=\s*\{([\s\S]*?)\}\s*(?:;|,|\n|local|return|function)/);
  if (!m) return null;
  const name = m[1];
  const body = m[2];
  const items = [];
  // split on commas at top level of string/number literals
  let i = 0;
  let cur = '';
  let inStr = false;
  let strCh = '';
  let depth = 0;
  while (i < body.length) {
    const c = body[i];
    if (!inStr) {
      if (c === '"' || c === "'") { inStr = true; strCh = c; cur += c; }
      else if (c === '{') { depth++; cur += c; }
      else if (c === '}') { depth--; cur += c; }
      else if (c === ',' && depth === 0) {
        const t = cur.trim();
        if (t) items.push(t);
        cur = '';
      } else cur += c;
    } else {
      cur += c;
      if (c === '\\') { i++; if (i < body.length) cur += body[i]; }
      else if (c === strCh) inStr = false;
    }
    i++;
  }
  const last = cur.trim();
  if (last) items.push(last);

  const decoded = items.map((it) => {
    const sm = it.match(/^["']([\s\S]*)["']$/);
    if (sm) return decodeEscapedString(sm[1]);
    if (/^\d+$/.test(it)) return Number(it);
    return it;
  });
  return { name, items: decoded, raw: m[0] };
}

function foldStringCharChains(src) {
  // string.char(65,66,67) or string.char(0x41,...)
  return src.replace(/string\.char\s*\(\s*((?:\d+|0x[0-9a-fA-F]+)(?:\s*,\s*(?:\d+|0x[0-9a-fA-F]+))*)\s*\)/g, (_, nums) => {
    const parts = nums.split(',').map((n) => {
      n = n.trim();
      return n.startsWith('0x') || n.startsWith('0X') ? parseInt(n, 16) : parseInt(n, 10);
    });
    if (parts.some((p) => isNaN(p) || p < 0 || p > 255)) return _;
    try {
      return JSON.stringify(String.fromCharCode(...parts));
    } catch {
      return _;
    }
  });
}

function peelOuterWrapper(src) {
  // return(function(...) ... end)(...)
  let s = src.trim();
  const wrap = s.match(/^return\s*\(\s*function\s*\(\s*\.\.\.\s*\)\s*([\s\S]*)\s*end\s*\)\s*\(\s*\.\.\.\s*\)\s*;?\s*$/);
  if (wrap) return wrap[1].trim();
  const wrap2 = s.match(/^return\s*\(\s*function\s*\(\s*\)\s*([\s\S]*)\s*end\s*\)\s*\(\s*\)\s*;?\s*$/);
  if (wrap2) return wrap2[1].trim();
  return s;
}

function removeJunkComments(src) {
  return src
    .replace(/--\[\[[\s\S]*?\]\]/g, '')
    .replace(/--[^\n]*/g, (line) => {
      if (/wearedevs|prometheus|obfuscat|PHASE_BOUNDARY|v\d+\.\d+/i.test(line)) return '';
      return line;
    });
}

function simplifyGetfenv(src) {
  return src
    .replace(/getfenv\s*\(\s*\)\s*\[\s*["']([\w.]+)["']\s*\]/g, (_, k) => k)
    .replace(/_ENV\s*\[\s*["']([\w.]+)["']\s*\]/g, (_, k) => k);
}

function deobfuscatePrometheus(src) {
  const notes = [];
  let code = src;

  code = removeJunkComments(code);
  notes.push('stripped obfuscator banners');

  const peeled = peelOuterWrapper(code);
  if (peeled !== code) {
    code = peeled;
    notes.push('peeled return(function(...)...end)(...) wrapper');
  }

  code = foldStringCharChains(code);
  notes.push('folded string.char(...) chains');

  const arr = extractConstantArray(code);
  if (arr && arr.items.length > 0) {
    notes.push(`found constant array '${arr.name}' with ${arr.items.length} entries`);
    // replace simple A[n] lookups when n is literal
    const name = arr.name;
    code = code.replace(new RegExp(`\\b${name}\\s*\\[\\s*(\\d+)\\s*\\]`, 'g'), (_, idx) => {
      const i = parseInt(idx, 10) - 1; // Lua 1-based often
      const alt = parseInt(idx, 10); // sometimes 0-based storage
      let val = arr.items[i];
      if (val === undefined) val = arr.items[alt];
      if (val === undefined) return _;
      if (typeof val === 'string') return JSON.stringify(val);
      if (typeof val === 'number') return String(val);
      return _;
    });
    // also try 0-based
    code = code.replace(new RegExp(`\\b${name}\\s*\\[\\s*(\\d+)\\s*\\]`, 'g'), (_, idx) => {
      const i = parseInt(idx, 10);
      const val = arr.items[i];
      if (val === undefined) return _;
      if (typeof val === 'string') return JSON.stringify(val);
      if (typeof val === 'number') return String(val);
      return _;
    });
  }

  code = simplifyGetfenv(code);
  code = foldStringCharChains(code); // second pass after inlining

  // collapse consecutive string concatenations of literals
  let prev;
  do {
    prev = code;
    code = code.replace(/(["'])((?:\\.|(?!\1).)*)\1\s*\.\.\s*(["'])((?:\\.|(?!\3).)*)\3/g, (_, q1, a, q3, b) => {
      try {
        const sa = JSON.parse(`"${a.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
        // simpler: just join raw
        return JSON.stringify(JSON.parse('"' + a.replace(/"/g, '\\"') + '"') + JSON.parse('"' + b.replace(/"/g, '\\"') + '"'));
      } catch {
        return JSON.stringify(a + b);
      }
    });
  } while (code !== prev && code.length < prev.length + 100);

  const header = [
    '-- Emorce Prometheus / WeAreDevs deobfuscator',
    '-- Static pass only — complex VMs need dynamic dump (Nova L4/L5/L6)',
    `-- Notes: ${notes.join('; ')}`,
    '',
  ].join('\n');

  return { success: true, code: header + code.trim() + '\n', engine: 'prometheus', notes };
}

module.exports = { deobfuscatePrometheus, extractConstantArray, foldStringCharChains, peelOuterWrapper };
