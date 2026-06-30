import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { invariantResources, strings } from "../../localization/strings";
import { buildOptionNameAndDescription } from "../../localizationUtils";
import { localize } from "../../localizationUtils";
import { executeStartNext } from "./startNext";
import { executeLaunch } from "./launch";
import { executeCancelNext } from "./cancelNext";
import { executeSub } from "./sub";

const startNextSubCommandName =
  invariantResources.commands.league.startnext.name;
const launchSubCommandName = invariantResources.commands.league.launch.name;
const cancelNextSubCommandName =
  invariantResources.commands.league.cancelnext.name;
const subSubCommandName = invariantResources.commands.league.sub.name;

export const data: any = new SlashCommandBuilder()
  .setName(invariantResources.commands.league.name)
  .setDescription(invariantResources.commands.league.desc)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) =>
    buildOptionNameAndDescription(sub, strings.commands.league.startnext)
  )
  .addSubcommand((sub) =>
    buildOptionNameAndDescription(sub, strings.commands.league.launch)
  )
  .addSubcommand((sub) =>
    buildOptionNameAndDescription(sub, strings.commands.league.cancelnext)
  )
  .addSubcommand((sub) =>
    buildOptionNameAndDescription(sub, strings.commands.league.sub)
      .addStringOption((option) =>
        buildOptionNameAndDescription(
          option,
          strings.commands.league.sub.params.player
        ).setRequired(true)
      )
      .addStringOption((option) =>
        buildOptionNameAndDescription(
          option,
          strings.commands.league.sub.params.substitute
        ).setRequired(true)
      )
      .addStringOption((option) =>
        buildOptionNameAndDescription(
          option,
          strings.commands.league.sub.params.rounds
        ).setRequired(false)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (interaction.options.getSubcommand() === startNextSubCommandName) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await executeStartNext(interaction);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : localize(
              interaction.locale,
              strings.commands.league.startnext.reply.unexpectedError
            );
      await interaction.editReply(`❌ ${message}`);
    }
  } else if (interaction.options.getSubcommand() === launchSubCommandName) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await executeLaunch(interaction);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : localize(
              interaction.locale,
              strings.commands.league.launch.reply.unexpectedError
            );
      await interaction.editReply(`❌ ${message}`);
    }
  } else if (interaction.options.getSubcommand() === cancelNextSubCommandName) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await executeCancelNext(interaction);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : localize(
              interaction.locale,
              strings.commands.league.cancelnext.reply.unexpectedError
            );
      await interaction.editReply(`❌ ${message}`);
    }
  } else if (interaction.options.getSubcommand() === subSubCommandName) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await executeSub(interaction);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : localize(
              interaction.locale,
              strings.commands.league.sub.reply.unexpectedError
            );
      await interaction.editReply(`❌ ${message}`);
    }
  }
}
