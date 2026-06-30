import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";

import { invariantResources, strings } from "../../localization/strings";
import { buildOptionNameAndDescription } from "../../localizationUtils";
import { executeQuizNanikiru, nanikiruOptions } from "./nanikiru";
import { NanikiruType } from "../../resources/nanikiru/NanikiruCollections";
import { QuizMode } from "./handlers/QuizHandler";
import { chinitsuOptions, executeQuizChinitsu } from "./chinitsu";
import { DifficultyOption, SuitOption } from "../../mahjong/ChinitsuGenerator";

const nanikiruSubCommandName = invariantResources.commands.quiz.nanikiru.name;
const chinitsuSubCommandName = invariantResources.commands.quiz.chinitsu.name;

export const commonOptions = {
  nbrounds: strings.commands.quiz.common.params.nbrounds,
  mode: strings.commands.quiz.common.params.mode,
  timeout: strings.commands.quiz.common.params.timeout,
};

export const data: any = new SlashCommandBuilder()
  .setName(invariantResources.commands.quiz.name)
  .setDescription(invariantResources.commands.quiz.name)
  .addSubcommand((sub) =>
    buildOptionNameAndDescription(sub, strings.commands.quiz.nanikiru)
      .addIntegerOption((option) =>
        buildOptionNameAndDescription(
          option,
          commonOptions.nbrounds
        ).setRequired(true)
      )
      .addStringOption((option) =>
        buildOptionNameAndDescription(option, commonOptions.mode)
          .addChoices([
            {
              name: invariantResources.commands.quiz.common.params.mode.options
                .explore,
              value: QuizMode.Explore,
            },
            {
              name: invariantResources.commands.quiz.common.params.mode.options
                .first,
              value: QuizMode.First,
            },
            {
              name: invariantResources.commands.quiz.common.params.mode.options
                .race,
              value: QuizMode.Race,
            },
          ])
          .setRequired(false)
      )
      .addStringOption((option) =>
        buildOptionNameAndDescription(option, nanikiruOptions.series)
          .addChoices([
            {
              name: invariantResources.commands.quiz.nanikiru.params.series
                .options.uzaku300,
              value: NanikiruType.Uzaku300,
            },
            {
              name: invariantResources.commands.quiz.nanikiru.params.series
                .options.uzaku301,
              value: NanikiruType.Uzaku301,
            },
            {
              name: invariantResources.commands.quiz.nanikiru.params.series
                .options.uzakuKin,
              value: NanikiruType.UzakuKin,
            },
          ])
          .setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    buildOptionNameAndDescription(sub, strings.commands.quiz.chinitsu)
      .addIntegerOption((option) =>
        buildOptionNameAndDescription(
          option,
          commonOptions.nbrounds
        ).setRequired(true)
      )
      .addStringOption((option) =>
        buildOptionNameAndDescription(option, commonOptions.mode)
          .addChoices([
            {
              name: invariantResources.commands.quiz.common.params.mode.options
                .explore,
              value: QuizMode.Explore,
            },
            {
              name: invariantResources.commands.quiz.common.params.mode.options
                .first,
              value: QuizMode.First,
            },
            {
              name: invariantResources.commands.quiz.common.params.mode.options
                .race,
              value: QuizMode.Race,
            },
          ])
          .setRequired(false)
      )
      .addIntegerOption((option) =>
        buildOptionNameAndDescription(option, chinitsuOptions.suit)
          .addChoices([
            {
              name: invariantResources.commands.quiz.chinitsu.params.suit
                .options.manzu,
              value: SuitOption.Manzu.valueOf(),
            },
            {
              name: invariantResources.commands.quiz.chinitsu.params.suit
                .options.pinzu,
              value: SuitOption.Pinzu.valueOf(),
            },
            {
              name: invariantResources.commands.quiz.chinitsu.params.suit
                .options.souzu,
              value: SuitOption.Souzu.valueOf(),
            },
          ])
          .setRequired(false)
      )
      .addStringOption((option) =>
        buildOptionNameAndDescription(option, chinitsuOptions.difficulty)
          .addChoices([
            {
              name: invariantResources.commands.quiz.chinitsu.params.difficulty
                .options.easy,
              value: DifficultyOption.Easy,
            },
            {
              name: invariantResources.commands.quiz.chinitsu.params.difficulty
                .options.normal,
              value: DifficultyOption.Normal,
            },
            {
              name: invariantResources.commands.quiz.chinitsu.params.difficulty
                .options.hard,
              value: DifficultyOption.Hard,
            },
          ])
          .setRequired(false)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  switch (interaction.options.getSubcommand()) {
    case nanikiruSubCommandName:
      interaction.deferReply({}).then(async () => {
        await executeQuizNanikiru(interaction);
      });
      break;
    case chinitsuSubCommandName:
      interaction.deferReply({}).then(async () => {
        await executeQuizChinitsu(interaction);
      });
      break;
  }
}
