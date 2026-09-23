/**
 * Pull Lua source from message content, code blocks, or attachments
 */
// Node 18+ global fetch


async function extractFromMessage(message, extraText = '') {
  let code = '';
  let filename = 'script.lua';

  // code block in message or extra (slash option)
  const blob = [message?.content || '', extraText || ''].join('\n');
  const fence = blob.match(/```(?:lua|luau)?\s*([\s\S]*?)```/i);
  if (fence) {
    code = fence[1].trim();
  } else if (extraText && extraText.trim() && !extraText.includes('http')) {
    code = extraText.trim();
  } else if (blob.trim() && !message?.attachments?.size) {
    // bare text without fences
    const cleaned = blob.replace(/^(?:deobf|prom|moonsec|ms|wrd)\s+/i, '').trim();
    if (cleaned.length > 30) code = cleaned;
  }

  // attachment
  if (message?.attachments?.size) {
    const att = message.attachments.find(
      (a) =>
        /\.(lua|luau|txt)$/i.test(a.name || '') ||
        (a.contentType && /text|lua|octet/i.test(a.contentType))
    ) || message.attachments.first();
    if (att) {
      filename = att.name || filename;
      const res = await fetch(att.url, { timeout: 30000 });
      if (!res.ok) throw new Error('failed to download attachment');
      const text = await res.text();
      if (text && text.trim()) code = text;
    }
  }

  // URL in text
  if (!code) {
    const urlMatch = blob.match(/https?:\/\/[^\s<>()]+/i);
    if (urlMatch) {
      const res = await fetch(urlMatch[0], { timeout: 30000 });
      if (res.ok) {
        const text = await res.text();
        if (text && text.trim()) {
          code = text;
          filename = 'remote.lua';
        }
      }
    }
  }

  return { code: code || '', filename };
}

module.exports = { extractFromMessage };
