import {
  ChannelType,
  ChatInputCommandInteraction,
  ThreadAutoArchiveDuration,
} from "discord.js";
import {
  invariantLocale,
  type NameDesc,
  strings,
} from "../../localization/strings";
import { QuizMode } from "./handlers/QuizHandler";
import { DifficultyOption, SuitOption } from "../../mahjong/ChinitsuGenerator";
import { stringFormat } from "../../stringUtils";
import { ChinitsuQuizHandler } from "./handlers/ChinitsuQuizHandler";
import { localize } from "../../localizationUtils";
import { commonOptions } from "./quizCommands";

export const chinitsuOptions = {
  suit: strings.commands.quiz.chinitsu.params.suit,
  difficulty: strings.commands.quiz.chinitsu.params.difficulty,
};

export async function executeQuizChinitsu(itr: ChatInputCommandInteraction) {
  const nbRoundsParam = itr.options.getInteger(
    optionName(commonOptions.nbrounds),
    false
  );
  const modeParam = itr.options.getString(
    optionName(commonOptions.mode),
    false
  );
  const suitParam = itr.options.getInteger(
    optionName(chinitsuOptions.suit),
    false
  );
  const timeoutParam = itr.options.getInteger(
    optionName(commonOptions.timeout),
    false
  );
  const difficultyParam = itr.options.getString(
    optionName(chinitsuOptions.difficulty),
    false
  );
  if (itr.channel?.type === ChannelType.GuildText) {
    const threadManager = itr.channel.threads;
    const mode =
      modeParam === null ? QuizMode.Explore : (modeParam as QuizMode);
    const suit =
      suitParam === null ? SuitOption.Random : (suitParam as SuitOption);
    const nbRounds = nbRoundsParam === null ? 1 : nbRoundsParam;
    const timeout =
      timeoutParam === null
        ? mode === QuizMode.Explore
          ? 0
          : 30
        : timeoutParam;
    const difficulty =
      difficultyParam === null
        ? DifficultyOption.Normal
        : (difficultyParam as DifficultyOption);

    const currentDate = new Date().toLocaleDateString(itr.locale, {
      month: "narrow",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const timerDisclaimer =
      timeout > 0
        ? stringFormat(
            itr.locale,
            strings.commands.quiz.common.reply.timerDisclaimerFormat,
            timeout.toString()
          )
        : "";
    const startDisclaimer = stringFormat(
      itr.locale,
      strings.commands.quiz.chinitsu.reply.threadFirstMessageFormat,
      nbRounds.toString()
    );
    itr
      .editReply({
        content: `${startDisclaimer} ${timerDisclaimer}`,
      })
      .then((message) => {
        threadManager
          .create({
            name: stringFormat(
              itr.locale,
              strings.commands.quiz.nanikiru.reply.theadNameFormat,
              currentDate,
              nbRounds.toString()
            ),
            autoArchiveDuration: ThreadAutoArchiveDuration.ThreeDays,
            startMessage: message.id,
            type: 11,
          })
          .then((thread) => {
            if (thread.type === ChannelType.PublicThread) {
              const quizHandler = new ChinitsuQuizHandler(
                thread,
                itr,
                mode,
                timeout,
                nbRounds,
                suit,
                difficulty
              );
              quizHandler.startQuiz();
            }
          });
      });
  } else {
    itr.editReply({ content: "cant create a thread here!" });
  }
}

function optionName(path: NameDesc) {
  return localize(invariantLocale, path.name);
}
