import {
  type AllowedThreadTypeForTextChannel,
  ChannelType,
  ChatInputCommandInteraction,
  GuildTextThreadManager,
  Locale,
  ThreadAutoArchiveDuration,
} from "discord.js";
import { getImageFromTiles } from "../../mahjong/imageUtils";
import {
  invariantLocale,
  type NameDesc,
  strings,
} from "../../localization/strings";
import {
  getHandEmojis,
  fromStrToHandToDisplay,
  getHandContext,
} from "../../mahjong/handParser";
import { localize } from "../../localizationUtils";
import { stringFormat } from "../../stringUtils";
import { getShantenInfo, UkeireChoice } from "../../mahjong/shantenUtils";

export async function executeNanikiru(itr: ChatInputCommandInteraction) {
  const thread = itr.options.getBoolean(
    optionName(nanikiruOptions.thread),
    false
  );

  if (thread && itr.channel?.type === ChannelType.GuildText) {
    replyInThread(itr, itr.channel.threads);
  } else {
    replyInSitu(itr);
  }
}

export enum SeatChoice {
  East = "East",
  South = "South",
  West = "West",
  North = "North",
}

export const nanikiruOptions = {
  hand: strings.commands.mjg.nanikiru.params.hand,
  discards: strings.commands.mjg.nanikiru.params.discards,
  doras: strings.commands.mjg.nanikiru.params.doras,
  seat: strings.commands.mjg.nanikiru.params.seat,
  round: strings.commands.mjg.nanikiru.params.round,
  turn: strings.commands.mjg.nanikiru.params.turn,
  ukeire: strings.commands.mjg.nanikiru.params.ukeire,
  thread: strings.commands.mjg.nanikiru.params.thread,
  spoiler: strings.commands.mjg.nanikiru.params.spoiler,
};

function optionName(path: NameDesc) {
  return localize(invariantLocale, path.name);
}

async function replyInSitu(itr: ChatInputCommandInteraction) {
  const hand = itr.options.getString(optionName(nanikiruOptions.hand), true);
  const discards = itr.options.getString(
    optionName(nanikiruOptions.discards),
    false
  );
  const doras = itr.options.getString(optionName(nanikiruOptions.doras), false);
  const seat = itr.options.getString(optionName(nanikiruOptions.seat), false);
  const round = itr.options.getString(optionName(nanikiruOptions.round), false);
  const turn = itr.options.getString(optionName(nanikiruOptions.turn), false);
  const ukeireChoiceParam = itr.options.getString(
    optionName(nanikiruOptions.ukeire),
    false
  );
  const spoiler =
    itr.options.getBoolean(optionName(nanikiruOptions.spoiler), false) ?? false;
  const ukeireChoice =
    ukeireChoiceParam !== null
      ? (ukeireChoiceParam as UkeireChoice)
      : UkeireChoice.No;
  const contextStr = getFullHandContext(seat, round, turn, doras, itr.locale);
  const message = await itr.editReply({
    content: contextStr,
  });

  const messageResp = Promise.resolve(
    getShantenInfo(hand, ukeireChoice, itr.locale, discards || undefined)
  ).then((shantenInfo) =>
    itr.editReply({
      content: `${contextStr}\n${spoiler ? "||" : ""}${shantenInfo}${spoiler ? "||" : ""}`,
    })
  );
  const toDisplay = fromStrToHandToDisplay(hand);
  getImageFromTiles(toDisplay).then((image) =>
    itr.editReply({ files: [image] })
  );

  const emojis = getHandEmojis({
    hand: discards || toDisplay.closedTiles,
    sorted: true,
    unique: true,
  });
  emojis.forEach(async (emoji) => message.react(emoji));
  return messageResp;
}

async function replyInThread(
  itr: ChatInputCommandInteraction,
  threadManager: GuildTextThreadManager<AllowedThreadTypeForTextChannel>
) {
  const hand = itr.options.getString(optionName(nanikiruOptions.hand), true);
  const discards = itr.options.getString(
    optionName(nanikiruOptions.discards),
    false
  );
  const doras = itr.options.getString(optionName(nanikiruOptions.doras), false);
  const seat = itr.options.getString(optionName(nanikiruOptions.seat), false);
  const round = itr.options.getString(optionName(nanikiruOptions.round), false);
  const turn = itr.options.getString(optionName(nanikiruOptions.turn), false);
  const ukeireChoice = itr.options.getString(
    optionName(nanikiruOptions.ukeire),
    false
  ) as UkeireChoice;

  const replyMessage = getFullHandContext(seat, round, turn, doras, itr.locale);
  itr.editReply({
    content: replyMessage,
  });

  const toDisplay = fromStrToHandToDisplay(hand);
  getImageFromTiles(toDisplay)
    .then((image) => itr.editReply({ files: [image] }))
    .then((message) =>
      threadManager.create({
        name: stringFormat(
          itr.locale,
          strings.commands.mjg.nanikiru.reply.threadTitle,
          itr.member?.user.username || "",
          hand
        ),
        autoArchiveDuration: ThreadAutoArchiveDuration.ThreeDays,
        startMessage: message.id,
        type: 11,
      })
    )
    .then((thread) => {
      thread
        .send({
          content: getShantenInfo(hand, ukeireChoice, itr.locale),
        })
        .then((message) => {
          const emojis = getHandEmojis({
            hand: discards || toDisplay.closedTiles,
            sorted: true,
            unique: true,
          });

          emojis.forEach(async (emoji) => {
            message.react(emoji);
          });
        });
    });
}

function getFullHandContext(
  seat: string | null,
  round: string | null,
  turn: string | null,
  doras: string | null,
  locale: Locale
) {
  const replyStrings = strings.commands.mjg.nanikiru.reply;
  const wwyd = localize(locale, replyStrings.wwyd) + "\n";
  return wwyd + getHandContext(seat, round, turn, doras, locale);
}
