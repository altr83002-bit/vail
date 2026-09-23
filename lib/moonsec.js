/**
 * Emorce MoonSec V3 static helpers + upstream proxy target
 * Full VM recovery usually needs bytecode dump; this peels anti-tamper banners
 * and common string hides, then optionally forwards to leakd API if configured.
 */

function stripMoonSecBanner(src) {
  return src
    .replace(/\[\[This file was protected with MoonSec V3[^\]]*\]\]/gi, '""')
    .replace(/This file was protected with MoonSec V3[^\n]*/gi, '')
    .replace(/MoonSec_StringsHiddenAttr/g, 'Emorce_Strings')
    .replace(/\(\[\[This file was protected with MoonSec[^\]]*\]\]\):gsub[^\n]*/gi, '');
}

function tryExtractStringTable(src) {
  // very rough: look for large string tables assigned to locals
  const m = src.match(/local\s+([A-Za-z_][\w]*)\s*=\s*\{\s*((?:["'][\s\S]*?["']\s*,?\s*){3,})\s*\}/);
  if (!m) return null;
  return { name: m[1], snippet: m[0].slice(0, 200) };
}

function deobfuscateMoonSecStatic(src) {
  const notes = [];
  let code = stripMoonSecBanner(src);
  notes.push('stripped MoonSec V3 banners / anti-tamper markers');

  const st = tryExtractStringTable(code);
  if (st) notes.push(`possible string table: ${st.name}`);

  // neutralize common anti-debug hooks that break static read
  code = code.replace(/debug\.getinfo\s*=\s*function[\s\S]*?end/g, 'debug.getinfo=function()return{what="Lua",source="@emorce"}end');
  code = code.replace(/getfenv\s*=\s*function[\s\S]*?end/g, '-- getfenv override neutralized by Emorce\n');

  const header = [
    '-- Emorce MoonSec static pass',
    '-- Full recovery of MoonSec V3 VM usually requires dynamic dump (bytecode + luadec)',
    `-- Notes: ${notes.join('; ')}`,
    '-- If this output is still VM-heavy, use the /moonsec proxy endpoint or Nova .msdeobf',
    '',
  ].join('\n');

  return { success: true, code: header + code.trim() + '\n', engine: 'moonsec', notes, needsDynamic: true };
}

module.exports = { deobfuscateMoonSecStatic, stripMoonSecBanner };
