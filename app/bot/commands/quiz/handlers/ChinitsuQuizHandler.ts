import {
  ChatInputCommandInteraction,
  type PublicThreadChannel,
} from "discord.js";
import { QuizHandler, QuizMode, type QuizQuestion } from "./QuizHandler";
import { strings } from "../../../localization/strings";
import { stringFormat } from "../../../stringUtils";
import {
  fromStrToHandToDisplay,
  getHandEmojis,
} from "../../../mahjong/handParser";
import { getImageFromTiles } from "../../../mahjong/imageUtils";
import { localize } from "../../../localizationUtils";
import {
  type ChinitsuProblem,
  DifficultyOption,
  getNewChinitsuProblem,
  SuitOption,
} from "../../../mahjong/ChinitsuGenerator";

const chinitsuStrings = strings.commands.quiz.chinitsu;

export class ChinitsuQuizHandler extends QuizHandler {
  public constructor(
    thread: PublicThreadChannel<false>,
    interaction: ChatInputCommandInteraction,
    quizMode: QuizMode,
    timeout: number | undefined,
    nbQuestion: number | undefined,
    private suit: SuitOption,
    private difficulty: DifficultyOption
  ) {
    super(thread, interaction, quizMode, timeout || 0, nbQuestion || 1);
  }

  protected get firstThreadMessage() {
    return stringFormat(
      this.locale,
      chinitsuStrings.reply.threadFirstMessageFormat
    );
  }

  async getNewQuestionData() {
    const problem = getNewChinitsuProblem(this.suit, this.difficulty);
    return this.problemToQuestion(problem);
  }

  protected async problemToQuestion(
    problem: ChinitsuProblem
  ): Promise<QuizQuestion> {
    const answer = problem.answer;
    const suit = problem.hand[problem.hand.length - 1];
    answer.sort((a, b) => a - b);

    const answerStr = problem.answer.map((a) => `${a}${suit}`);
    const questionImage = await getImageFromTiles(
      fromStrToHandToDisplay(problem.hand)
    );

    const questionText = localize(
      this.locale,
      chinitsuStrings.reply.openingMessage
    );
    const optionEmojis = getHandEmojis({
      hand: `123456789${suit}`,
      sorted: true,
      unique: true,
    });

    const fullAnswer = this.getAnswerTextFromProblem(problem);

    return {
      questionText,
      questionImage,
      answer: answerStr,
      optionEmojis,
      fullAnswer,
    };
  }

  protected getAnswerTextFromProblem(problem: ChinitsuProblem) {
    const sb = [];
    const answer = problem.answer;
    const suit = problem.hand[problem.hand.length - 1];
    answer.sort((a, b) => a - b);
    const answerStr = problem.answer.map((a) => `${a}${suit}`);
    const answerEmojis = getHandEmojis({
      hand: answerStr.join(""),
    }).join("");
    sb.push(
      `# ${localize(this.locale, chinitsuStrings.reply.answerLabel)} ||${answerEmojis}||`
    );
    return sb.join("\n");
  }
}
