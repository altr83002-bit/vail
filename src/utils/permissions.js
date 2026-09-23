function parseIds(raw) {
  if (!raw || !String(raw).trim()) return [];
  return String(raw)
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function isOwner(userId) {
  const owners = parseIds(process.env.OWNER_IDS);
  if (owners.length === 0) return true; // open if unset
  return owners.includes(String(userId));
}

function checkChannelLock(channelId) {
  const locked = (process.env.LOCKED_CHANNEL_ID || '').trim();
  if (!locked) return true;
  return String(channelId) === locked;
}

module.exports = { isOwner, checkChannelLock, parseIds };
