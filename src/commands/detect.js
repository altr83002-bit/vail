const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { detectEngine } = require('../utils/deobf');
const { isOwner, checkChannelLock } = require('../utils/permissions');

function engineLabel(engine) {
  const map = {
    prometheus: 'Prometheus / WeAreDevs',
    wearedevs: 'WeAreDevs / Prometheus',
    moonsec: 'MoonSec V3',
    luaobfuscator: 'LuaObfuscator / Luraph-like',
    generic: 'Generic obfuscation',
    unknown: 'Unknown',
  };
  return map[engine] || engine;
}

function confBar(c) {
  const n = Math.max(0, Math.min(10, Math.round((c || 0) * 10)));
  return '█'.repeat(n) + '░'.repeat(10 - n) + ` ${Math.round((c || 0) * 100)}%`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('detect')
    .setDescription('Detect which obfuscator was used on a Lua script')
    .addStringOption((o) => o.setName('code').setDescription('Paste obfuscated Lua'))
    .addAttachmentOption((o) => o.setName('file').setDescription('.lua / .txt file')),

  async execute(interaction) {
    if (!isOwner(interaction.user.id)) {
      return interaction.reply({ content: 'not allowed.', ephemeral: true });
    }
    if (!checkChannelLock(interaction.channelId)) {
      return interaction.reply({ content: 'wrong channel.', ephemeral: true });
    }

    await interaction.deferReply();

    let code = interaction.options.getString('code') || '';
    const file = interaction.options.getAttachment('file');
    let filename = 'script.lua';

    try {
      if (file) {
        filename = file.name || filename;
        code = await (await fetch(file.url)).text();
      }
      const fence = code.match(/```(?:lua|luau)?\s*([\s\S]*?)```/i);
      if (fence) code = fence[1].trim();
      if (!code.trim()) {
        return interaction.editReply({ content: 'paste code or attach a file.' });
      }

      const detected = detectEngine(code);
      const sizeKb = (Buffer.byteLength(code, 'utf8') / 1024).toFixed(1);
      const reasons =
        (detected.reasons || []).slice(0, 8).map((r) => `• \`${r}\``).join('\n') || '• —';

      const embed = new EmbedBuilder()
        .setColor(0xa855f7)
        .setTitle('Emorce Detect')
        .setDescription(
          [
            `**detected:** \`${detected.engine}\` — ${engineLabel(detected.engine)}`,
            `**confidence:** ${confBar(detected.confidence)}`,
            `**file:** \`${filename}\` · **${sizeKb} KB**`,
            '',
            '**signatures**',
            reasons,
            '',
            'run `/deobf` or `.deobf` / `.prom` / `.moonsec` to clean it',
          ].join('\n')
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
    } catch (e) {
      return interaction.editReply({
        content: `error: \`${String(e.message || e).slice(0, 200)}\``,
      });
    }
  },
};
