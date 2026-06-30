import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { executeNanikiru, nanikiruOptions, SeatChoice } from "./nanikiru";
import { invariantResources, strings } from "../../localization/strings";
import { buildOptionNameAndDescription } from "../../localizationUtils";
import { UkeireChoice } from "../../mahjong/shantenUtils";

const nanikiruSubCommandName = invariantResources.commands.mjg.nanikiru.name;

export const data: any = new SlashCommandBuilder()
  .setName(invariantResources.commands.mjg.name)
  .setDescription(invariantResources.commands.mjg.name)
  .addSubcommand((sub) =>
    buildOptionNameAndDescription(sub, strings.commands.mjg.nanikiru)
      .addStringOption((option) =>
        buildOptionNameAndDescription(option, nanikiruOptions.hand).setRequired(
          true
        )
      )
      .addStringOption((option) =>
        buildOptionNameAndDescription(option, nanikiruOptions.discards)
      )
      .addStringOption((option) =>
        buildOptionNameAndDescription(option, nanikiruOptions.doras)
      )
      .addStringOption((option) =>
        buildOptionNameAndDescription(option, nanikiruOptions.seat)
          .addChoices([
            {
              name: invariantResources.commands.mjg.nanikiru.params.seat.options
                .east,
              value: SeatChoice.East,
            },
            {
              name: invariantResources.commands.mjg.nanikiru.params.seat.options
                .south,
              value: SeatChoice.South,
            },
            {
              name: invariantResources.commands.mjg.nanikiru.params.seat.options
                .west,
              value: SeatChoice.West,
            },
            {
              name: invariantResources.commands.mjg.nanikiru.params.seat.options
                .north,
              value: SeatChoice.North,
            },
          ])
          .setRequired(false)
      )
      .addStringOption((option) =>
        buildOptionNameAndDescription(option, nanikiruOptions.round)
      )
      .addStringOption((option) =>
        buildOptionNameAndDescription(option, nanikiruOptions.turn)
      )
      .addStringOption((option) =>
        buildOptionNameAndDescription(option, nanikiruOptions.ukeire)
          .addChoices([
            {
              name: invariantResources.commands.mjg.nanikiru.params.ukeire
                .options.no,
              value: UkeireChoice.No,
            },
            {
              name: invariantResources.commands.mjg.nanikiru.params.ukeire
                .options.yes,
              value: UkeireChoice.Yes,
            },
            {
              name: invariantResources.commands.mjg.nanikiru.params.ukeire
                .options.full,
              value: UkeireChoice.Full,
            },
          ])
          .setRequired(false)
      )
      .addBooleanOption((option) =>
        buildOptionNameAndDescription(option, nanikiruOptions.thread)
      )
      .addBooleanOption((option) =>
        buildOptionNameAndDescription(option, nanikiruOptions.spoiler)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (interaction.options.getSubcommand() === nanikiruSubCommandName) {
    interaction.deferReply({}).then(async () => {
      await executeNanikiru(interaction);
    });
  }
}
