import {
  ChatInputCommandInteraction,
  Locale,
  Message,
  type PublicThreadChannel,
} from "discord.js";
import { strings } from "../../../localization/strings";
import { localize } from "../../../localizationUtils";
import { AppEmojiName } from "../../../resources/emojis/AppEmojiCollection";
import { discordBotConfig } from "config";
import { stringFormat } from "../../../stringUtils";

export type QuizQuestion = {
  questionText: string | undefined;
  questionImage: string;
  optionEmojis: string[];
  answer: string[];
  fullAnswer: string;
};

export enum ChangeType {
  Collect = "collect",
  Remove = "remove",
}

export enum QuizMode {
  Explore = "Explore",
  First = "First",
  Race = "Race",
}

enum StopReason {
  Winner = "winner",
  Time = "time",
  Reveal = "reveal",
}

const commonStrings = strings.commands.quiz.common.reply;

export abstract class QuizHandler {
  protected startTime: Date;

  protected winnerTimings: { [id: string]: number };
  protected loserTimings: { [id: string]: number };
  protected playerPoints: { [id: string]: number };
  protected lastPlayersPerf: {
    [id: string]: { timing: number; scoreDelta: number };
  };
  protected abstract getNewQuestionData(): Promise<QuizQuestion>;
  protected abstract get firstThreadMessage(): string;
  protected currentQuestion: QuizQuestion;

  protected usersAnswers: { [id: string]: string[] };
  protected rewardTable: number[];

  protected nbQuestionsAsked: number;

  protected constructor(
    protected thread: PublicThreadChannel<false>,
    protected interaction: ChatInputCommandInteraction,
    protected quizMode: QuizMode,
    protected timeout: number,
    protected nbTotalQuestion: number,
    private pauseBetweenQuestion: boolean = false
  ) {
    this.nbQuestionsAsked = 0;
    this.currentQuestion = {
      questionText: "",
      answer: [],
      fullAnswer: "",
      optionEmojis: [],
      questionImage: "",
    };
    this.startTime = new Date();
    this.winnerTimings = {};
    this.loserTimings = {};
    this.playerPoints = {};
    this.usersAnswers = {};
    this.lastPlayersPerf = {};
    this.rewardTable = [6, 4, 2, 1, 1];
  }

  protected get locale() {
    return this.interaction.locale;
  }

  protected sortDict(dict: { [id: string]: number }, reverse: boolean = false) {
    const list: { player: string; value: number }[] = [];
    Object.keys(dict).forEach((key) =>
      list.push({ player: key, value: dict[key] })
    );
    return list.sort((a, b) =>
      reverse ? b.value - a.value : a.value - b.value
    );
  }

  private async generateNextQuestion() {
    this.currentQuestion = await this.getNewQuestionData();
    this.usersAnswers = {};
    this.lastPlayersPerf = {};
    this.winnerTimings = {};
    this.loserTimings = {};
    this.nbQuestionsAsked++;
  }

  protected changeUserAnswer(
    userId: string,
    answer: string,
    changeType: ChangeType
  ): boolean {
    if (changeType === ChangeType?.Collect) {
      if (!this.usersAnswers[userId]) {
        this.usersAnswers[userId] = [];
      }
      this.usersAnswers[userId].push(answer);
    } else {
      const index = this.usersAnswers[userId].findIndex((a) => a == answer);
      if (index >= 0) {
        this.usersAnswers[userId].splice(index, 1);
      }
    }
    const correctUserAnswers = this.usersAnswers[userId]?.filter(
      (x) => this.currentQuestion.answer.findIndex((y) => y === x) >= 0
    );
    const isWinner =
      correctUserAnswers.length == this.usersAnswers[userId].length &&
      correctUserAnswers.length === this.currentQuestion.answer.length;
    const endTime = new Date();
    const durationMs = endTime.getTime() - this.startTime.getTime();
    if (isWinner) {
      this.winnerTimings[userId] = durationMs;
      delete this.loserTimings[userId];
    } else {
      this.loserTimings[userId] = durationMs;
      delete this.winnerTimings[userId];
    }
    if (this.usersAnswers[userId].length === 0) {
      delete this.winnerTimings[userId];
      delete this.loserTimings[userId];
    }
    return isWinner;
  }

  protected addCurrentWinners(sb: string[]) {
    if (this.timeout === 0) {
      return "";
    }
    const playerScoresSorted = this.sortDict(this.playerPoints, true);
    for (let i = 0; i < playerScoresSorted.length; i++) {
      const player = playerScoresSorted[i].player;
      const playerPerf = this.lastPlayersPerf[player];
      const totalPointData = `\`${this.playerPoints[player]}pts\``;
      const timingData =
        this.quizMode !== QuizMode.Explore && playerPerf !== undefined
          ? `\`${Math.round(playerPerf.timing / 1000).toFixed(1)}s\` : `
          : "";
      const pointChangeData =
        playerPerf !== undefined ? `\`+${playerPerf.scoreDelta}pts\`` : "";
      sb.push(
        `${i + 1}: <@${player}>: ${totalPointData}(${timingData}${pointChangeData})`
      );
    }
  }

  protected addPointsToUser(userId: string, points: number) {
    this.playerPoints[userId] = (this.playerPoints[userId] || 0) + points;
  }

  protected updateScores() {
    const timingList = this.sortDict(this.winnerTimings);
    if (
      this.quizMode === QuizMode.First ||
      this.quizMode === QuizMode.Explore
    ) {
      if (timingList.length > 0) {
        this.addPointsToUser(timingList[0].player, 1);
        this.lastPlayersPerf[timingList[0].player] = {
          timing: timingList[0].value,
          scoreDelta: 1,
        };
      }
    } else if (this.quizMode === QuizMode.Race) {
      for (let i = 0; i < timingList.length; i++) {
        this.addPointsToUser(timingList[i].player, this.rewardTable[i]);
        this.lastPlayersPerf[timingList[i].player] = {
          timing: timingList[i].value,
          scoreDelta: this.rewardTable[i],
        };
      }
    }
  }

  public startQuiz() {
    this.postNewQuestion();
  }

  private endQuiz() {}

  protected async postNewQuestion(): Promise<Message<true> | undefined> {
    await this.generateNextQuestion();
    const question = this.currentQuestion;
    let sb = [];
    sb.push(".");
    sb.push(this.getFullOpeningMessage(this.locale));
    if (this.currentQuestion.questionText !== undefined) {
      sb.push(this.currentQuestion.questionText);
    }
    const fullQuestionText = sb.join("\n");

    sb = [];
    sb.push(".");
    sb.push(localize(this.locale, commonStrings.problemIsLoading));
    const waitText = sb.join("\n");
    const image = this.currentQuestion.questionImage;
    let message;
    if (this.quizMode === QuizMode.Explore) {
      message = await this.thread.send({
        content: fullQuestionText,
        files: [image],
      });
      this.startTime = new Date();
    } else {
      message = await this.thread.send({
        content: waitText,
      });
    }
    const collector = message.createReactionCollector({
      dispose: true,
      time: this.timeout > 0 ? this.timeout * 1_000 : undefined,
    });
    collector.on("end", (_, reason: StopReason) => {
      this.onQuestionEnd(message, reason);
    });
    collector.on(ChangeType.Collect, (reaction, user) => {
      if (
        user.id !== discordBotConfig()?.DISCORD_CLIENT_ID &&
        reaction.emoji.name !== null
      ) {
        if (
          this.quizMode === QuizMode.Explore &&
          reaction.emoji.name === AppEmojiName.Eyes
        ) {
          collector.stop(StopReason.Reveal);
          return;
        }
        const isOk = this.changeUserAnswer(
          user.id,
          reaction.emoji.name,
          ChangeType.Collect
        );
        if (isOk && this.quizMode == QuizMode.First) {
          collector.stop(StopReason.Winner);
        }
      }
    });
    collector.on(ChangeType.Remove, (reaction, user) => {
      if (reaction.emoji.name !== null) {
        const isOk = this.changeUserAnswer(
          user.id,
          reaction.emoji.name,
          ChangeType.Remove
        );
        if (isOk && this.quizMode == QuizMode.First) {
          collector.stop(StopReason.Winner);
        }
      }
    });
    for (const option of question.optionEmojis) {
      await message.react(option);
    }
    if (this.quizMode === QuizMode.Explore) {
      await message.react(AppEmojiName.Eyes);
    }
    if (this.quizMode !== QuizMode.Explore) {
      await message.edit({ content: fullQuestionText, files: [image] });
      this.startTime = new Date();
    }
    return message;
  }

  private async onQuestionEnd(message: Message<true>, reason: StopReason) {
    const sb = [];
    this.updateScores();
    sb.push(localize(this.locale, commonStrings.roundOver));
    sb.push(this.getFullOpeningMessage(this.locale));
    if (this.currentQuestion.questionText !== undefined) {
      sb.push(this.currentQuestion.questionText);
    }
    message.edit({ content: sb.join("\n") });
    message.reactions.removeAll();
    this.replyWithAnswer(message, reason).then(async (message) => {
      if (this.nbQuestionsAsked >= this.nbTotalQuestion) {
        this.endQuiz();
        return;
      }
      if (this.pauseBetweenQuestion || this.quizMode === QuizMode.Explore) {
        await message.react(AppEmojiName.Eyes);
        await message.edit({
          content:
            message.content +
            "\n" +
            localize(this.locale, commonStrings.continueQuizPrompt),
        });
        const collector = message.createReactionCollector({
          time: 180_000, // 3min
        });
        collector.on("end", () => {
          this.postNewQuestion();
        });
        collector.on(ChangeType.Collect, (reaction, user) => {
          if (
            user.id !== discordBotConfig()?.DISCORD_CLIENT_ID &&
            reaction.emoji.name === AppEmojiName.Eyes
          ) {
            collector.stop();
          }
        });
      } else {
        this.postNewQuestion();
      }
    });
  }

  private replyWithAnswer(message: Message<true>, reason: StopReason) {
    const sb = [];
    if (
      reason === StopReason.Time &&
      Object.keys(this.winnerTimings).length === 0
    ) {
      sb.push(localize(this.locale, commonStrings.timeoutNoWinnerReply));
    } else if (
      Object.keys(this.winnerTimings).length > 0 ||
      Object.keys(this.loserTimings).length > 0
    ) {
      sb.push(".");
    }
    switch (this.quizMode) {
      case QuizMode.Explore:
        this.addScoresForExplore(sb);
        break;
      case QuizMode.First:
        this.addScoresForFirst(sb);
        break;
      case QuizMode.Race:
        this.addScoresForRace(sb);
        break;
    }
    sb.push(this.currentQuestion?.fullAnswer);
    return message.reply({ content: sb.join("\n") });
  }

  private addScoresForExplore(sb: string[]) {
    if (Object.keys(this.winnerTimings).length > 0) {
      const winners = this.sortDict(this.winnerTimings)
        .map((w) => `<@${w.player}>`)
        .join("");
      sb.push(stringFormat(this.locale, commonStrings.winnerFormat, winners));
    }
    if (Object.keys(this.loserTimings).length > 0) {
      const losers = this.sortDict(this.loserTimings)
        .map((l) => `<@${l.player}>`)
        .join("");
      sb.push(stringFormat(this.locale, commonStrings.loserFormat, losers));
    }
  }
  private addScoresForFirst(sb: string[]) {
    if (Object.keys(this.winnerTimings).length > 0) {
      const winners = this.sortDict(this.winnerTimings)
        .map((w) => `<@${w.player}>`)
        .join("");
      sb.push(stringFormat(this.locale, commonStrings.winnerFormat, winners));
    }
    if (Object.keys(this.loserTimings).length > 0) {
      const losers = this.sortDict(this.loserTimings)
        .map((l) => `<@${l.player}>`)
        .join("");
      sb.push(stringFormat(this.locale, commonStrings.loserFormat, losers));
    }
    this.addCurrentWinners(sb);
  }

  private addScoresForRace(sb: string[]) {
    if (Object.keys(this.winnerTimings).length > 0) {
      const winners = this.sortDict(this.winnerTimings)
        .map((w) => `<@${w.player}>`)
        .join("");
      sb.push(stringFormat(this.locale, commonStrings.winnerFormat, winners));
    }
    if (Object.keys(this.loserTimings).length > 0) {
      const losers = this.sortDict(this.loserTimings)
        .map((l) => `<@${l.player}>`)
        .join("");
      sb.push(stringFormat(this.locale, commonStrings.loserFormat, losers));
    }
    this.addCurrentWinners(sb);
  }

  protected getFullOpeningMessage(locale: Locale) {
    switch (this.quizMode) {
      case QuizMode.Explore:
        return stringFormat(
          locale,
          commonStrings.openingMessageExploreFormat,
          `${this.nbQuestionsAsked}`,
          `${this.nbTotalQuestion}`
        );
      case QuizMode.First:
        return stringFormat(
          locale,
          commonStrings.openingMessageFirstFormat,
          `${this.nbQuestionsAsked}`,
          `${this.nbTotalQuestion}`
        );
      case QuizMode.Race:
        return stringFormat(
          locale,
          commonStrings.openingMessageRaceFormat,
          `${this.nbQuestionsAsked}`,
          `${this.nbTotalQuestion}`,
          `${this.timeout}`
        );
    }
  }
}
