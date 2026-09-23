const { SlashCommandBuilder, AttachmentBuilder, EmbedBuilder } = require('discord.js');
const { deobfuscate } = require('../utils/deobf');
const { isOwner, checkChannelLock } = require('../utils/permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('prom')
    .setDescription('Deobfuscate Prometheus / WeAreDevs Lua')
    .addStringOption((o) => o.setName('code').setDescription('Paste script'))
    .addAttachmentOption((o) => o.setName('file').setDescription('.lua file'))
    .addStringOption((o) =>
      o
        .setName('proxy')
        .setDescription('Upstream')
        .addChoices(
          { name: 'auto', value: 'auto' },
          { name: 'force', value: 'true' },
          { name: 'local', value: 'false' }
        )
    ),

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
    const useProxy = interaction.options.getString('proxy') || 'auto';
    let filename = 'script.lua';

    try {
      if (file) {
        filename = file.name || filename;
        code = await (await fetch(file.url)).text();
      }
      const fence = code.match(/```(?:lua|luau)?\s*([\s\S]*?)```/i);
      if (fence) code = fence[1].trim();
      if (!code.trim()) {
        return interaction.editReply({ content: 'need code or file.' });
      }

      const result = await deobfuscate(code, {
        engine: 'prometheus',
        useProxy,
        filename,
      });
      if (!result.code) {
        return interaction.editReply({ content: `failed: \`${result.error || '?'}\`` });
      }

      const embed = new EmbedBuilder()
        .setColor(0xa855f7)
        .setTitle('Prometheus Deobf')
        .setDescription(
          `**source:** \`${result.source}\` · **${(Buffer.byteLength(result.code) / 1024).toFixed(1)} KB**`
        )
        .setTimestamp();

      const att = new AttachmentBuilder(Buffer.from(result.code, 'utf8'), {
        name: filename.replace(/\.\w+$/, '') + '_prometheus_clean.lua',
      });
      return interaction.editReply({ embeds: [embed], files: [att] });
    } catch (e) {
      return interaction.editReply({ content: `\`${String(e.message || e).slice(0, 200)}\`` });
    }
  },
};
