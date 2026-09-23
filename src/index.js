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
const { deobfuscate, LEAKD_BASE, PROXY_ENABLED } = require('./utils/deobf');
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

/** Prefix: .deobf / .prom / .moonsec / .ms / .wrd  + attach or paste */
const PREFIX_MAP = {
  deobf: 'auto',
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

  const engine = PREFIX_MAP[key];
  let useProxy = 'auto';
  let rest = (m[2] || '').trim();
  if (/^local\b/i.test(rest)) {
    useProxy = 'false';
    rest = rest.replace(/^local\s*/i, '');
  } else if (/^proxy\b/i.test(rest)) {
    useProxy = 'true';
    rest = rest.replace(/^proxy\s*/i, '');
  }

  const status = await message.reply({ content: `deobf \`${engine}\`…` }).catch(() => null);

  try {
    const { code, filename } = await extractFromMessage(message, rest);
    if (!code.trim()) {
      const t = 'attach a `.lua` file or paste code / codeblock.';
      if (status) return status.edit(t);
      return message.reply(t);
    }

    const result = await deobfuscate(code, { engine, useProxy, filename });
    if (!result.code) {
      const t = `failed: \`${(result.error || '?').slice(0, 180)}\``;
      if (status) return status.edit(t);
      return message.reply(t);
    }

    const embed = new EmbedBuilder()
      .setColor(0xa855f7)
      .setTitle('Emorce Deobf')
      .setDescription(
        [
          `**engine:** \`${result.engine}\``,
          `**source:** \`${result.source}\``,
          result.detected
            ? `**detected:** \`${result.detected.engine}\` (${Math.round((result.detected.confidence || 0) * 100)}%)`
            : null,
          `**size:** ${(Buffer.byteLength(result.code) / 1024).toFixed(1)} KB`,
        ]
          .filter(Boolean)
          .join('\n')
      )
      .setFooter({ text: `requested by ${message.author.username}` })
      .setTimestamp();

    const outName =
      filename.replace(/\.(lua|luau|txt)$/i, '') + `_${result.engine}_clean.lua`;
    const att = new AttachmentBuilder(Buffer.from(result.code, 'utf8'), { name: outName });

    if (status) {
      await status.edit({ content: null, embeds: [embed], files: [att] });
    } else {
      await message.reply({ embeds: [embed], files: [att] });
    }
  } catch (e) {
    const t = `error: \`${String(e.message || e).slice(0, 200)}\``;
    if (status) await status.edit(t).catch(() => {});
    else await message.reply(t).catch(() => {});
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('[emorce-deobf] DISCORD_TOKEN missing');
  process.exit(1);
}
client.login(token);
