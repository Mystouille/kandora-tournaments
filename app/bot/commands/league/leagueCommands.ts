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
import {
  logInteractionError,
  safeInteractionErrorMessage,
} from "~/bot/interactionError";

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
      await replyUnexpectedError(
        interaction,
        "league startnext",
        strings.commands.league.startnext.reply.unexpectedError,
        err
      );
    }
  } else if (interaction.options.getSubcommand() === launchSubCommandName) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await executeLaunch(interaction);
    } catch (err) {
      await replyUnexpectedError(
        interaction,
        "league launch",
        strings.commands.league.launch.reply.unexpectedError,
        err
      );
    }
  } else if (interaction.options.getSubcommand() === cancelNextSubCommandName) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await executeCancelNext(interaction);
    } catch (err) {
      await replyUnexpectedError(
        interaction,
        "league cancelnext",
        strings.commands.league.cancelnext.reply.unexpectedError,
        err
      );
    }
  } else if (interaction.options.getSubcommand() === subSubCommandName) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await executeSub(interaction);
    } catch (err) {
      await replyUnexpectedError(
        interaction,
        "league sub",
        strings.commands.league.sub.reply.unexpectedError,
        err
      );
    }
  }
}

async function replyUnexpectedError(
  interaction: ChatInputCommandInteraction,
  context: string,
  localizedMessage: string,
  error: unknown
): Promise<void> {
  const reference = logInteractionError(context, error);
  await interaction.editReply(
    `❌ ${localize(interaction.locale, localizedMessage)} ${safeInteractionErrorMessage(reference)}`
  );
}
