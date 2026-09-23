const {
  SlashCommandBuilder,
  AttachmentBuilder,
  EmbedBuilder,
} = require('discord.js');
const { deobfuscate } = require('../utils/deobf');
const { extractFromMessage } = require('../utils/extract');
const { isOwner, checkChannelLock } = require('../utils/permissions');

const ENGINES = ['auto', 'prometheus', 'moonsec', 'wearedevs', 'luaobfuscator', 'generic'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('deobf')
    .setDescription('Deobfuscate Lua (Prometheus / MoonSec / WeAreDevs / LuaObfuscator)')
    .addStringOption((o) =>
      o
        .setName('engine')
        .setDescription('Engine (default auto)')
        .addChoices(
          { name: 'auto', value: 'auto' },
          { name: 'prometheus', value: 'prometheus' },
          { name: 'moonsec', value: 'moonsec' },
          { name: 'wearedevs', value: 'wearedevs' },
          { name: 'luaobfuscator', value: 'luaobfuscator' },
          { name: 'generic', value: 'generic' }
        )
    )
    .addStringOption((o) =>
      o
        .setName('proxy')
        .setDescription('Use upstream leakd API')
        .addChoices(
          { name: 'auto', value: 'auto' },
          { name: 'force upstream', value: 'true' },
          { name: 'local only', value: 'false' }
        )
    )
    .addStringOption((o) =>
      o.setName('code').setDescription('Paste obfuscated Lua (or attach a .lua file)')
    )
    .addAttachmentOption((o) =>
      o.setName('file').setDescription('Obfuscated .lua file')
    ),

  async execute(interaction) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ content: 'not allowed.', ephemeral: true });
    }
    if (!checkChannelLock(interaction.channelId)) {
      return interaction.reply({ content: 'wrong channel.', ephemeral: true });
    }

    await interaction.deferReply();

    const engine = interaction.options.getString('engine') || 'auto';
    const useProxy = interaction.options.getString('proxy') || 'auto';
    const pasted = interaction.options.getString('code') || '';
    const fileOpt = interaction.options.getAttachment('file');

    let code = pasted;
    let filename = 'script.lua';

    try {
      if (fileOpt) {
        filename = fileOpt.name || filename;
        const res = await fetch(fileOpt.url);
        code = await res.text();
      } else if (!code && interaction.channel) {
        // nothing — still allow empty to error cleanly
      }

      // also try code blocks inside the string
      const fence = code.match(/```(?:lua|luau)?\s*([\s\S]*?)```/i);
      if (fence) code = fence[1].trim();

      if (!code || !code.trim()) {
        return interaction.editReply({
          content: 'paste code with `code:` or attach a `.lua` file.',
        });
      }

      const started = Date.now();
      const result = await deobfuscate(code, { engine, useProxy, filename });
      const took = ((Date.now() - started) / 1000).toFixed(2);

      if (!result.success && !result.code) {
        return interaction.editReply({
          content: `failed: \`${(result.error || 'unknown').slice(0, 200)}\``,
        });
      }

      const out = result.code || '';
      const lines = out.split(/\r?\n/).length;
      const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
      const det = result.detected
        ? `${result.detected.engine} (${Math.round((result.detected.confidence || 0) * 100)}%)`
        : '—';

      const embed = new EmbedBuilder()
        .setColor(0xa855f7)
        .setTitle('Emorce Deobf')
        .setDescription(
          [
            `**engine:** \`${result.engine || engine}\``,
            `**source:** \`${result.source || 'local'}\``,
            `**detected:** \`${det}\``,
            `**size:** ${kb} KB · ${lines} lines · ${took}s`,
            result.notes?.length ? `**notes:** ${result.notes.join('; ').slice(0, 200)}` : null,
            result.upstream_error
              ? `**upstream err:** \`${String(result.upstream_error).slice(0, 120)}\``
              : null,
          ]
            .filter(Boolean)
            .join('\n')
        )
        .setFooter({ text: 'emorce · prometheus · moonsec · wearedevs' })
        .setTimestamp();

      const outName =
        filename.replace(/\.(lua|luau|txt)$/i, '') +
        `_${result.engine || 'deobf'}_clean.lua`;

      if (Buffer.byteLength(out, 'utf8') > 7.5 * 1024 * 1024) {
        return interaction.editReply({
          embeds: [embed],
          content: 'output too large for discord attachment.',
        });
      }

      const att = new AttachmentBuilder(Buffer.from(out, 'utf8'), { name: outName });
      return interaction.editReply({ embeds: [embed], files: [att] });
    } catch (e) {
      return interaction.editReply({
        content: `error: \`${String(e.message || e).slice(0, 250)}\``,
      });
    }
  },
};
