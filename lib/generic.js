/**
 * Generic Lua cleanup used as fallback / post-pass
 */

function beautifyBasic(src) {
  let s = src;
  // normalize line endings
  s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // remove excessive blank lines
  s = s.replace(/\n{3,}/g, '\n\n');
  // space around keywords lightly
  return s.trim() + '\n';
}

function decodeCommonEscapes(src) {
  return src.replace(/\\(\d{1,3})/g, (_, n) => {
    const c = parseInt(n, 10);
    return c >= 32 && c <= 126 ? String.fromCharCode(c) : _;
  });
}

function deobfuscateGeneric(src) {
  let code = decodeCommonEscapes(src);
  code = beautifyBasic(code);
  const header = '-- Emorce generic cleanup pass\n\n';
  return { success: true, code: header + code, engine: 'generic', notes: ['escape decode', 'whitespace normalize'] };
}

module.exports = { deobfuscateGeneric, beautifyBasic };
