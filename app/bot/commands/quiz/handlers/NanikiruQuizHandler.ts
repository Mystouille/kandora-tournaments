import {
  ChatInputCommandInteraction,
  type PublicThreadChannel,
} from "discord.js";
import { QuizHandler, QuizMode, type QuizQuestion } from "./QuizHandler";
import { strings } from "../../../localization/strings";
import { stringFormat } from "../../../stringUtils";
import {
  compareTiles,
  fromStrToHandToDisplay,
  getEmoji,
  getEmojis,
  getHandContext,
  getHandEmojis,
  SUIT_NAMES,
} from "../../../mahjong/handParser";
import {
  NanikiruCollections,
  type NanikiruProblem,
  NanikiruType,
} from "../../../resources/nanikiru/NanikiruCollections";
import { AppEmojiName } from "../../../resources/emojis/AppEmojiCollection";
import { getImageFromTiles } from "../../../mahjong/imageUtils";
import { localize } from "../../../localizationUtils";
import { getShantenInfo, UkeireChoice } from "../../../mahjong/shantenUtils";

const nanikiruStrings = strings.commands.quiz.nanikiru;

export class NanikiruQuizHandler extends QuizHandler {
  public constructor(
    thread: PublicThreadChannel<false>,
    interaction: ChatInputCommandInteraction,
    quizMode: QuizMode,
    timeout: number | undefined,
    nbQuestion: number | undefined,
    public series: NanikiruType
  ) {
    super(thread, interaction, quizMode, timeout || 0, nbQuestion || 1);
  }

  protected get firstThreadMessage() {
    return stringFormat(
      this.locale,
      nanikiruStrings.reply.threadFirstMessageFormat
    );
  }

  async getNewQuestionData() {
    const problem = NanikiruCollections.instance.getNextProblem(this.series);
    return this.problemToQuestion(problem);
  }

  public async problemToQuestion(
    problem: NanikiruProblem
  ): Promise<QuizQuestion> {
    const fullAnswer = this.getAnswerTextFromProblem(problem);
    const answer = problem.answer.split(" ");
    answer.sort(compareTiles);

    const questionImage = await getImageFromTiles(
      fromStrToHandToDisplay(problem.hand)
    );

    const callOptions = problem.options?.split(" ") ?? [];

    const optionEmojis = getHandEmojis({
      hand: problem.hand,
      sorted: true,
      unique: true,
    });
    if (callOptions.includes("chii")) {
      optionEmojis.push(getEmoji(AppEmojiName.Chii));
    }
    if (callOptions.includes("pon")) {
      optionEmojis.push(getEmoji(AppEmojiName.Pon));
    }
    if (callOptions.includes("kan")) {
      optionEmojis.push(getEmoji(AppEmojiName.Kan));
    }
    if (callOptions.includes("skip")) {
      optionEmojis.push(getEmoji(AppEmojiName.Skip));
    }
    if (callOptions.includes("riichi")) {
      optionEmojis.push(getEmoji(AppEmojiName.Riichi));
    }

    let questionText = getHandContext(
      problem.seat,
      problem.round,
      problem.turn,
      problem.dora,
      this.locale
    );
    if (problem.context && problem.context.length > 0) {
      questionText += `\n\n${this.formatAnswerText(problem.context, "", false)}`;
    } else {
      questionText += `\n\n${localize(this.locale, nanikiruStrings.reply.defaultOpeningMessage)}`;
    }
    return { questionText, questionImage, answer, fullAnswer, optionEmojis };
  }

  protected getAnswerTextFromProblem(problem: NanikiruProblem) {
    const sb = [];
    const answerEmojiNames = problem.answer.split(" ");
    const answerEmojis = getEmojis(answerEmojiNames).join("");
    sb.push(
      `# ${localize(this.locale, nanikiruStrings.reply.answerLabel)} ||${answerEmojis}||`
    );

    if (problem.ukeire.startsWith("#")) {
      sb.push(
        getShantenInfo(
          problem.hand,
          UkeireChoice.Yes,
          this.locale,
          problem.ukeire
        )
      );
    } else {
      sb.push(this.formatAnswerText(problem.ukeire, "### ", true));
    }
    if (problem.explanation) {
      sb.push(this.formatAnswerText(problem.explanation, "### ", true));
    }
    sb.push("### " + problem.source);
    return sb.join("\n");
  }

  formatAnswerText(
    textRaw: string,
    prefix: string = "",
    spoiler: boolean = true
  ) {
    const compositeText = textRaw.split("#");

    for (let i = 0; i < compositeText.length; i++) {
      if ((i + 2) % 3 === 0) {
        const handText = compositeText[i].split("+");
        const emojiHand: string[] = [];
        handText.forEach((subHand) =>
          emojiHand.push(
            getHandEmojis({ hand: subHand, sorted: false, unique: false }).join(
              ""
            )
          )
        );
        compositeText[i] = "# " + emojiHand.join("➕");
      } else {
        let textWithEmojis = compositeText[i];
        for (let n = 0; n <= 9; n++) {
          SUIT_NAMES.forEach((s: string) => {
            if (s === "z" && (n > 7 || n === 0)) {
              return;
            }
            const emojiStr = n.toString() + s;
            textWithEmojis = textWithEmojis.replaceAll(
              emojiStr,
              getHandEmojis({ hand: emojiStr }).join("")
            );
          });
        }
        compositeText[i] =
          (textWithEmojis.length > 0 ? prefix : "") + textWithEmojis;
      }
    }
    let finalText = compositeText.join("\n");
    if (spoiler) {
      finalText = `${spoiler ? "||" : ""}${finalText}${spoiler ? "||" : ""}`;
    }
    return finalText;
  }
}
