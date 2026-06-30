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
import { localize } from "../../localizationUtils";
import { NanikiruType } from "../../resources/nanikiru/NanikiruCollections";
import { stringFormat } from "../../stringUtils";
import { QuizMode } from "./handlers/QuizHandler";
import { NanikiruQuizHandler } from "./handlers/NanikiruQuizHandler";
import { commonOptions } from "./quizCommands";

export const nanikiruOptions = {
  series: strings.commands.quiz.nanikiru.params.series,
};

export async function executeQuizNanikiru(itr: ChatInputCommandInteraction) {
  const nbRoundsParam = itr.options.getInteger(
    optionName(commonOptions.nbrounds),
    false
  );
  const modeParam = itr.options.getString(
    optionName(commonOptions.mode),
    false
  );
  const seriesParam = itr.options.getString(
    optionName(nanikiruOptions.series),
    false
  );
  const timeoutParam = itr.options.getInteger(
    optionName(commonOptions.timeout),
    false
  );
  if (itr.channel?.type === ChannelType.GuildText) {
    const threadManager = itr.channel.threads;
    const mode =
      modeParam === null ? QuizMode.Explore : (modeParam as QuizMode);
    const series =
      seriesParam === null
        ? NanikiruType.Uzaku301
        : (seriesParam as NanikiruType);
    const nbRounds = nbRoundsParam === null ? 1 : nbRoundsParam;
    const timeout =
      timeoutParam === null
        ? mode === QuizMode.Explore
          ? 0
          : 30
        : timeoutParam;

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
      strings.commands.quiz.nanikiru.reply.threadFirstMessageFormat,
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
              const quizHandler = new NanikiruQuizHandler(
                thread,
                itr,
                mode,
                timeout,
                nbRounds,
                series
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
