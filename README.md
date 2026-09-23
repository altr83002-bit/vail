# Emorce Deobf Bot

Discord bot for **Prometheus**, **MoonSec V3**, **WeAreDevs**, and **LuaObfuscator**.

Local static engines + optional proxy to `leakd.up.railway.app` (same as Nova).

## Commands

### Slash
| Command | Description |
|---------|-------------|
| `/deobf` | Auto or pick engine + optional file |
| `/prom` | Prometheus / WeAreDevs |
| `/moonsec` | MoonSec V3 (prefers upstream) |

### Prefix (message + attach)
```
.deobf          auto
.prom           prometheus
.moonsec / .ms  moonsec
.wrd            wearedevs
.luaobf         luaobfuscator

.prom local     force local engine
.moonsec proxy  force upstream
```

Attach a `.lua` file or paste a codeblock / raw script after the command.

## Railway setup

1. Unzip, push to GitHub (or deploy directory).
2. Railway → New Project → deploy this folder.
3. Variables:

| Variable | Required | Notes |
|----------|----------|--------|
| `DISCORD_TOKEN` | yes | Bot token |
| `CLIENT_ID` | yes | Application ID (slash register) |
| `OWNER_IDS` | no | Comma-separated user IDs. Empty = everyone |
| `LOCKED_CHANNEL_ID` | no | Only this channel |
| `GUILD_ID` | no | Instant guild slash register |
| `LEAKD_BASE` | no | Default `https://leakd.up.railway.app` |
| `PROXY_ENABLED` | no | `1` / `0` (default on) |

4. Start command: `node src/index.js` (already set).
5. Invite bot with `applications.commands` + `bot` scopes, permissions: Send Messages, Attach Files, Embed Links, Read Message History.

### Discord Developer Portal
1. Create Application → Bot → copy token → `DISCORD_TOKEN`
2. General Information → Application ID → `CLIENT_ID`
3. OAuth2 URL Generator → scopes: `bot`, `applications.commands`
4. Bot permissions: Send Messages, Embed Links, Attach Files, Read Message History

### Local
```bash
cp .env.example .env
# fill DISCORD_TOKEN + CLIENT_ID
npm install
npm start
# optional: npm run register
```

## Notes
- Heavy MoonSec / full Prometheus VMs: use upstream (`proxy` / default auto for moonsec).
- Simple Prometheus constant-array scripts: local pass is enough.
- Same deobf libs as `emorce-deobf-railway`.
