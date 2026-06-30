import { Locale } from "discord.js";
import { stringsFr } from "./strings-fr";
import { stringsEn } from "./strings-en";

export type NameDesc = {
  name: string;
  desc: string;
};

export const strings = {
  commands: {
    common: {
      shantenGoodWaitInfo: "commands.common.shantenGoodWaitInfo",
    },
    admin: {
      name: "commands.admin.name",
      desc: "commands.admin.desc",
      checkNanikiru: {
        name: "commands.admin.checkNanikiru.name",
        desc: "commands.admin.checkNanikiru.desc",
        params: {
          source: {
            name: "commands.admin.checkNanikiru.params.source.name",
            desc: "commands.admin.checkNanikiru.params.source.desc",
          },
        },
      },
    },
    quiz: {
      name: "commands.quiz.name",
      common: {
        params: {
          nbrounds: {
            name: "commands.quiz.common.params.nbrounds.name",
            desc: "commands.quiz.common.params.nbrounds.desc",
          },
          mode: {
            name: "commands.quiz.common.params.mode.name",
            desc: "commands.quiz.common.params.mode.desc",
            options: {
              first: "commands.quiz.common.params.mode.options.first",
              race: "commands.quiz.common.params.mode.options.race",
              explore: "commands.quiz.common.params.mode.options.explore",
            },
          },
          timeout: {
            name: "commands.quiz.common.params.timeout.name",
            desc: "commands.quiz.common.params.timeout.desc",
          },
        },
        reply: {
          timerDisclaimerFormat:
            "commands.quiz.common.reply.timerDisclaimerFormat",
          openingMessageExploreFormat:
            "commands.quiz.common.reply.openingMessageExploreFormat",
          openingMessageFirstFormat:
            "commands.quiz.common.reply.openingMessageFirstFormat",
          openingMessageRaceFormat:
            "commands.quiz.common.reply.openingMessageRaceFormat",
          problemIsLoading: "commands.quiz.common.reply.problemIsLoading",
          timeoutNoWinnerReply:
            "commands.quiz.common.reply.timeoutNoWinnerReply",
          firstWinnerMessageFormat:
            "commands.quiz.common.reply.firstWinnerMessageFormat",
          roundOver: "commands.quiz.common.reply.roundOver",
          winnerFormat: "commands.quiz.common.reply.winnerFormat",
          loserFormat: "commands.quiz.common.reply.loserFormat",
          continueQuizPrompt: "commands.quiz.common.reply.continueQuizPrompt",
          quizIsOver: "commands.quiz.common.reply.quizIsOver",
        },
      },
      nanikiru: {
        name: "commands.quiz.nanikiru.name",
        desc: "commands.quiz.nanikiru.desc",
        params: {
          series: {
            name: "commands.quiz.nanikiru.params.series.name",
            desc: "commands.quiz.nanikiru.params.series.desc",
            options: {
              uzaku300: "commands.quiz.nanikiru.params.series.options.uzaku300",
              uzaku301: "commands.quiz.nanikiru.params.series.options.uzaku301",
              uzakuKin: "commands.quiz.nanikiru.params.series.options.uzakuKin",
            },
          },
        },
        reply: {
          theadNameFormat: "commands.quiz.nanikiru.reply.theadNameFormat",
          threadFirstMessageFormat:
            "commands.quiz.nanikiru.reply.threadFirstMessageFormat",
          defaultOpeningMessage:
            "commands.quiz.nanikiru.reply.defaultOpeningMessage",
          answerLabel: "commands.quiz.nanikiru.reply.answerLabel",
        },
      },
      chinitsu: {
        name: "commands.quiz.chinitsu.name",
        desc: "commands.quiz.chinitsu.desc",
        params: {
          suit: {
            name: "commands.quiz.chinitsu.params.suit.name",
            desc: "commands.quiz.chinitsu.params.suit.desc",
            options: {
              pinzu: "commands.quiz.chinitsu.params.suit.options.pinzu",
              manzu: "commands.quiz.chinitsu.params.suit.options.manzu",
              souzu: "commands.quiz.chinitsu.params.suit.options.souzu",
            },
          },
          difficulty: {
            name: "commands.quiz.chinitsu.params.difficulty.name",
            desc: "commands.quiz.chinitsu.params.difficulty.desc",
            options: {
              easy: "commands.quiz.chinitsu.params.difficulty.options.easy",
              normal: "commands.quiz.chinitsu.params.difficulty.options.normal",
              hard: "commands.quiz.chinitsu.params.difficulty.options.hard",
            },
          },
        },
        reply: {
          theadNameFormat: "commands.quiz.chinitsu.reply.theadNameFormat",
          threadFirstMessageFormat:
            "commands.quiz.chinitsu.reply.threadFirstMessageFormat",
          openingMessage: "commands.quiz.chinitsu.reply.openingMessage",
          answerLabel: "commands.quiz.chinitsu.reply.answerLabel",
        },
      },
    },
    myinfo: {
      name: "commands.myinfo.name",
      update: {
        name: "commands.myinfo.update.name",
        desc: "commands.myinfo.update.desc",
      },
      delete: {
        name: "commands.myinfo.delete.name",
        desc: "commands.myinfo.delete.desc",
        reply: {
          noDataToDelete: "commands.myinfo.delete.reply.noDataToDelete",
          modalTitle: "commands.myinfo.delete.reply.modalTitle",
          confirmationMessage:
            "commands.myinfo.delete.reply.confirmationMessage",
          usernameLabel: "commands.myinfo.delete.reply.usernameLabel",
          usernamePlaceholder:
            "commands.myinfo.delete.reply.usernamePlaceholder",
          userNotFound: "commands.myinfo.delete.reply.userNotFound",
          successMessage: "commands.myinfo.delete.reply.successMessage",
        },
      },
    },
    league: {
      name: "commands.league.name",
      desc: "commands.league.desc",
      startnext: {
        name: "commands.league.startnext.name",
        desc: "commands.league.startnext.desc",
        reply: {
          mustBeInServer: "commands.league.startnext.reply.mustBeInServer",
          noActiveLeague: "commands.league.startnext.reply.noActiveLeague",
          noFinalPhase: "commands.league.startnext.reply.noFinalPhase",
          finalPhaseNotStartedFormat:
            "commands.league.startnext.reply.finalPhaseNotStartedFormat",
          noSchedulingChannel:
            "commands.league.startnext.reply.noSchedulingChannel",
          noBracketSeedings:
            "commands.league.startnext.reply.noBracketSeedings",
          pendingRoundExists:
            "commands.league.startnext.reply.pendingRoundExists",
          noStagesToSchedule:
            "commands.league.startnext.reply.noStagesToSchedule",
          stageLineFormat: "commands.league.startnext.reply.stageLineFormat",
          schedulingStartedFormat:
            "commands.league.startnext.reply.schedulingStartedFormat",
          unexpectedError: "commands.league.startnext.reply.unexpectedError",
        },
      },
      launch: {
        name: "commands.league.launch.name",
        desc: "commands.league.launch.desc",
        reply: {
          mustBeInServer: "commands.league.launch.reply.mustBeInServer",
          noActiveLeague: "commands.league.launch.reply.noActiveLeague",
          noFinalPhase: "commands.league.launch.reply.noFinalPhase",
          noUpcomingGames: "commands.league.launch.reply.noUpcomingGames",
          unsupportedPlatform:
            "commands.league.launch.reply.unsupportedPlatform",
          noTournamentId: "commands.league.launch.reply.noTournamentId",
          noBracketSeedings: "commands.league.launch.reply.noBracketSeedings",
          playersNotReadyFormat:
            "commands.league.launch.reply.playersNotReadyFormat",
          tableSuccessFormat: "commands.league.launch.reply.tableSuccessFormat",
          tableFailFormat: "commands.league.launch.reply.tableFailFormat",
          launchResultFormat: "commands.league.launch.reply.launchResultFormat",
          launchSummaryFormat:
            "commands.league.launch.reply.launchSummaryFormat",
          unexpectedError: "commands.league.launch.reply.unexpectedError",
        },
      },
      cancelnext: {
        name: "commands.league.cancelnext.name",
        desc: "commands.league.cancelnext.desc",
        reply: {
          mustBeInServer: "commands.league.cancelnext.reply.mustBeInServer",
          noActiveLeague: "commands.league.cancelnext.reply.noActiveLeague",
          noPendingMessages:
            "commands.league.cancelnext.reply.noPendingMessages",
          success: "commands.league.cancelnext.reply.success",
          unexpectedError: "commands.league.cancelnext.reply.unexpectedError",
        },
      },
      sub: {
        name: "commands.league.sub.name",
        desc: "commands.league.sub.desc",
        params: {
          player: {
            name: "commands.league.sub.params.player.name",
            desc: "commands.league.sub.params.player.desc",
          },
          substitute: {
            name: "commands.league.sub.params.substitute.name",
            desc: "commands.league.sub.params.substitute.desc",
          },
          rounds: {
            name: "commands.league.sub.params.rounds.name",
            desc: "commands.league.sub.params.rounds.desc",
          },
        },
        reply: {
          mustBeInServer: "commands.league.sub.reply.mustBeInServer",
          noActiveLeague: "commands.league.sub.reply.noActiveLeague",
          noFinalPhase: "commands.league.sub.reply.noFinalPhase",
          unsupportedPlatform: "commands.league.sub.reply.unsupportedPlatform",
          playerNotFound: "commands.league.sub.reply.playerNotFound",
          substituteNotFound: "commands.league.sub.reply.substituteNotFound",
          playerNotInTeam: "commands.league.sub.reply.playerNotInTeam",
          substituteNotInRoster:
            "commands.league.sub.reply.substituteNotInRoster",
          finalsNotStarted: "commands.league.sub.reply.finalsNotStarted",
          playerNotScheduled: "commands.league.sub.reply.playerNotScheduled",
          invalidRoundsFormat: "commands.league.sub.reply.invalidRoundsFormat",
          roundOutOfRange: "commands.league.sub.reply.roundOutOfRange",
          roundAlreadyCompleted:
            "commands.league.sub.reply.roundAlreadyCompleted",
          playerNotScheduledInRound:
            "commands.league.sub.reply.playerNotScheduledInRound",
          overlappingSubstitution:
            "commands.league.sub.reply.overlappingSubstitution",
          substitutionAlreadyExists:
            "commands.league.sub.reply.substitutionAlreadyExists",
          successFormat: "commands.league.sub.reply.successFormat",
          cancelSuccessFormat: "commands.league.sub.reply.cancelSuccessFormat",
          cancelNoMatchingRounds:
            "commands.league.sub.reply.cancelNoMatchingRounds",
          officialSubFormat: "commands.league.sub.reply.officialSubFormat",
          unexpectedError: "commands.league.sub.reply.unexpectedError",
        },
      },
    },
    mjg: {
      name: "commands.mjg.name",
      nanikiru: {
        name: "commands.mjg.nanikiru.name",
        desc: "commands.mjg.nanikiru.desc",
        params: {
          hand: {
            name: "commands.mjg.nanikiru.params.hand.name",
            desc: "commands.mjg.nanikiru.params.hand.desc",
          },
          discards: {
            name: "commands.mjg.nanikiru.params.discards.name",
            desc: "commands.mjg.nanikiru.params.discards.desc",
          },
          doras: {
            name: "commands.mjg.nanikiru.params.doras.name",
            desc: "commands.mjg.nanikiru.params.doras.desc",
          },
          seat: {
            name: "commands.mjg.nanikiru.params.seat.name",
            desc: "commands.mjg.nanikiru.params.seat.desc",
            options: {
              east: "commands.mjg.nanikiru.params.seat.options.east",
              south: "commands.mjg.nanikiru.params.seat.options.south",
              west: "commands.mjg.nanikiru.params.seat.options.west",
              north: "commands.mjg.nanikiru.params.seat.params.north",
            },
          },
          round: {
            name: "commands.mjg.nanikiru.params.round.name",
            desc: "commands.mjg.nanikiru.params.round.desc",
          },
          turn: {
            name: "commands.mjg.nanikiru.params.turn.name",
            desc: "commands.mjg.nanikiru.params.turn.desc",
          },
          thread: {
            name: "commands.mjg.nanikiru.params.thread.name",
            desc: "commands.mjg.nanikiru.params.thread.desc",
          },
          spoiler: {
            name: "commands.mjg.nanikiru.params.spoiler.name",
            desc: "commands.mjg.nanikiru.params.spoiler.desc",
          },
          ukeire: {
            name: "commands.mjg.nanikiru.params.ukeire.name",
            desc: "commands.mjg.nanikiru.params.ukeire.desc",
            options: {
              no: "commands.mjg.nanikiru.params.ukeire.options.no",
              yes: "commands.mjg.nanikiru.params.ukeire.options.yes",
              full: "commands.mjg.nanikiru.params.ukeire.options.full",
            },
          },
        },
        reply: {
          seat: "commands.mjg.nanikiru.reply.seat",
          round: "commands.mjg.nanikiru.reply.round",
          turn: "commands.mjg.nanikiru.reply.turn",
          doras: "commands.mjg.nanikiru.reply.doras",
          wwyd: "commands.mjg.nanikiru.reply.wwyd",
          threadTitle: "commands.mjg.nanikiru.reply.threadTitle",
        },
      },
    },
  },
  system: {
    league: {
      unknownTeam: "system.league.unknownTeam",
      unknownUser: "system.league.unknownUser",
      rankingTitleFormat: "system.league.rankingTitleFormat",
      rankingLineFormat: "system.league.rankingLineFormat",
      noGamesRecorded: "system.league.noGamesRecorded",
      pendingScoresHeader: "system.league.pendingScoresHeader",
      pendingScoreLineFormat: "system.league.pendingScoreLineFormat",
      lastUpdatedFormat: "system.league.lastUpdatedFormat",
      statisticsNote: "system.league.statisticsNote",
      newGameRecordedFormat: "system.league.newGameRecordedFormat",
      invalidGameDetectedFormat: "system.league.invalidGameDetectedFormat",
      playersNotInTeam: "system.league.playersNotInTeam",
      scoresNotAvailable: "system.league.scoresNotAvailable",
      startTimeLabel: "system.league.startTimeLabel",
      endTimeLabel: "system.league.endTimeLabel",
      gameLinkLabel: "system.league.gameLinkLabel",
      unknownTime: "system.league.unknownTime",
    },
  },
};

export type StringResources = typeof strings;

export const invariantLocale = Locale.French;
export const invariantResources = stringsFr;
export const resourceMap: { [id in Locale]?: StringResources } = {
  [Locale.French]: stringsFr,
  [Locale.EnglishUS]: stringsEn,
  [Locale.EnglishGB]: stringsEn,
};
