require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Collection,
  Events,
  EmbedBuilder,
  AttachmentBuilder,
  ActivityType,
  REST,
  Routes,
} = require('discord.js');
const fs = require('fs');
const path = require('path');
const { deobfuscate, detectEngine, LEAKD_BASE, PROXY_ENABLED } = require('./utils/deobf');
const { extractFromMessage } = require('./utils/extract');
const { isOwner, checkChannelLock } = require('./utils/permissions');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const slashPayload = [];
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsPath, file));
  if (!cmd.data || !cmd.execute) continue;
  client.commands.set(cmd.data.name, cmd);
  slashPayload.push(cmd.data.toJSON());
}

async function registerSlash() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;
  if (!token || !clientId) {
    console.warn('[emorce-deobf] CLIENT_ID or DISCORD_TOKEN missing — skip slash register');
    return;
  }
  const rest = new REST({ version: '10' }).setToken(token);
  try {
    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(clientId, process.env.GUILD_ID), {
        body: slashPayload,
      });
      console.log(`[emorce-deobf] guild slash registered (${slashPayload.length})`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body: slashPayload });
      console.log(`[emorce-deobf] global slash registered (${slashPayload.length})`);
    }
  } catch (e) {
    console.error('[emorce-deobf] slash register failed', e.message || e);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`[emorce-deobf] logged in as ${c.user.tag}`);
  console.log(`[emorce-deobf] LEAKD_BASE=${LEAKD_BASE} PROXY=${PROXY_ENABLED}`);
  c.user.setActivity('prometheus · moonsec', { type: ActivityType.Watching });
  await registerSlash();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = client.commands.get(interaction.commandName);
  if (!cmd) return;
  try {
    await cmd.execute(interaction);
  } catch (e) {
    console.error(e);
    const msg = { content: `error: \`${String(e.message || e).slice(0, 180)}\``, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
    else await interaction.reply(msg).catch(() => {});
  }
});

function engineLabel(engine) {
  const map = {
    prometheus: 'Prometheus / WeAreDevs',
    wearedevs: 'WeAreDevs / Prometheus',
    moonsec: 'MoonSec V3',
    luaobfuscator: 'LuaObfuscator / Luraph-like',
    generic: 'Generic obfuscation',
    unknown: 'Unknown',
    auto: 'Auto',
  };
  return map[engine] || engine;
}

function confBar(c) {
  const n = Math.max(0, Math.min(10, Math.round((c || 0) * 10)));
  return '█'.repeat(n) + '░'.repeat(10 - n) + ` ${Math.round((c || 0) * 100)}%`;
}

function detectEmbed(detected, filename, sizeKb, stage) {
  const reasons = (detected.reasons || []).slice(0, 6).map((r) => `• \`${r}\``).join('\n') || '• —';
  const embed = new EmbedBuilder()
    .setColor(0xa855f7)
    .setTitle(stage === 'done' ? 'Emorce Deobf — Done' : 'Emorce Detect')
    .setDescription(
      [
        `**detected:** \`${detected.engine}\` — ${engineLabel(detected.engine)}`,
        `**confidence:** ${confBar(detected.confidence)}`,
        filename ? `**file:** \`${filename}\` · **${sizeKb} KB**` : null,
        '',
        '**signatures**',
        reasons,
        stage === 'processing' ? '\n⏳ **processing…** running deobfuscator' : null,
        stage === 'detect_only' ? '\nuse `.deobf` / `.prom` / `.moonsec` to clean it' : null,
      ]
        .filter(Boolean)
        .join('\n')
    )
    .setTimestamp();
  return embed;
}

const PREFIX_MAP = {
  deobf: 'auto',
  detect: 'detect',
  what: 'detect',
  id: 'detect',
  prom: 'prometheus',
  prometheus: 'prometheus',
  moonsec: 'moonsec',
  ms: 'moonsec',
  msdeobf: 'moonsec',
  wrd: 'wearedevs',
  wearedevs: 'wearedevs',
  luaobf: 'luaobfuscator',
};

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!isOwner(message.author.id)) return;
  if (!checkChannelLock(message.channel.id)) return;

  const content = message.content || '';
  const m = content.match(/^[.!](\w+)(?:\s+([\s\S]*))?$/);
  if (!m) return;
  const key = m[1].toLowerCase();
  if (!PREFIX_MAP[key]) return;

  const mapped = PREFIX_MAP[key];
  const isDetectOnly = mapped === 'detect';
  const engine = isDetectOnly ? 'auto' : mapped;

  let useProxy = 'auto';
  let rest = (m[2] || '').trim();
  if (/^local\b/i.test(rest)) {
    useProxy = 'false';
    rest = rest.replace(/^local\s*/i, '');
  } else if (/^proxy\b/i.test(rest)) {
    useProxy = 'true';
    rest = rest.replace(/^proxy\s*/i, '');
  }

  const status = await message
    .reply({ content: isDetectOnly ? 'detecting…' : `deobf \`${engine}\`…` })
    .catch(() => null);

  const WALL_MS = parseInt(process.env.COMMAND_TIMEOUT_MS || '45000', 10);
  let finished = false;
  const wall = setTimeout(async () => {
    if (finished) return;
    finished = true;
    const t =
      'timed out. try `.prom local` / `.deobf local` (skip upstream) or check LEAKD_BASE.';
    if (status) await status.edit({ content: t }).catch(() => {});
    else await message.reply(t).catch(() => {});
  }, WALL_MS);

  try {
    const { code, filename } = await extractFromMessage(message, rest);
    if (finished) return;
    if (!code.trim()) {
      finished = true;
      clearTimeout(wall);
      const t = 'attach a `.lua` / `.txt` or paste code / codeblock after the command.';
      if (status) return status.edit({ content: t });
      return message.reply(t);
    }

    const sizeKb = (Buffer.byteLength(code, 'utf8') / 1024).toFixed(1);
    const detected = detectEngine(code);

    // show detect result first
    if (status) {
      await status
        .edit({
          content: null,
          embeds: [detectEmbed(detected, filename, sizeKb, isDetectOnly ? 'detect_only' : 'processing')],
        })
        .catch(() => {});
    }

    if (isDetectOnly) {
      finished = true;
      clearTimeout(wall);
      return;
    }

    // run deobf with detected engine when auto
    const runEngine = engine === 'auto'
      ? (detected.engine === 'unknown' ? 'generic' : detected.engine)
      : engine;

    const result = await deobfuscate(code, {
      engine: runEngine,
      useProxy,
      filename,
    });
    if (finished) return;
    finished = true;
    clearTimeout(wall);

    if (!result.success && !result.code) {
      const t = `failed: \`${(result.error || '?').slice(0, 180)}\``;
      if (status) return status.edit({ content: t, embeds: [] });
      return message.reply(t);
    }

    const out = result.code || '';
    const finalDetected = result.detected || detected;
    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('Emorce Deobf — Done')
      .setDescription(
        [
          `**detected:** \`${finalDetected.engine}\` (${Math.round((finalDetected.confidence || 0) * 100)}%)`,
          `**ran as:** \`${result.engine || runEngine}\``,
          `**source:** \`${result.source || 'local'}\``,
          `**out:** ${(Buffer.byteLength(out) / 1024).toFixed(1)} KB`,
          result.upstream_error
            ? `**upstream:** \`${String(result.upstream_error).slice(0, 100)}\``
            : null,
          (result.notes || []).length
            ? `**notes:** ${(result.notes || []).slice(0, 3).join('; ')}`
            : null,
        ]
          .filter(Boolean)
          .join('\n')
      )
      .setFooter({ text: `requested by ${message.author.username}` })
      .setTimestamp();

    const outName =
      filename.replace(/\.(lua|luau|txt)$/i, '') +
      `_${result.engine || runEngine}_clean.lua`;

    if (Buffer.byteLength(out, 'utf8') > 7.8 * 1024 * 1024) {
      if (status) return status.edit({ content: null, embeds: [embed], files: [] });
      return message.reply({ embeds: [embed] });
    }

    const att = new AttachmentBuilder(Buffer.from(out, 'utf8'), { name: outName });
    if (status) {
      await status.edit({ content: null, embeds: [embed], files: [att] });
    } else {
      await message.reply({ embeds: [embed], files: [att] });
    }
  } catch (e) {
    if (finished) return;
    finished = true;
    clearTimeout(wall);
    console.error('[emorce-deobf] command error', e);
    const t = `error: \`${String(e.message || e).slice(0, 200)}\``;
    if (status) await status.edit({ content: t, embeds: [] }).catch(() => {});
    else await message.reply(t).catch(() => {});
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('[emorce-deobf] DISCORD_TOKEN missing');
  process.exit(1);
}
client.login(token);
