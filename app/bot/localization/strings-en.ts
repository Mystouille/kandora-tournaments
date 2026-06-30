import type { StringResources } from "./strings";

export const stringsEn: StringResources = {
  commands: {
    common: {
      shantenGoodWaitInfo: "\\*:yields a 5+ tile tenpai",
    },
    admin: {
      name: "admin",
      desc: "admin commands",
      checkNanikiru: {
        name: "checknanikiru",
        desc: "display a nanikiru problem by its source to check its content",
        params: {
          source: {
            name: "source",
            desc: "The source identifier of the problem (e.g. 300-Q-226)",
          },
        },
      },
    },
    quiz: {
      name: "quiz",
      common: {
        params: {
          nbrounds: {
            name: "nbrounds",
            desc: "Number of rounds in the game",
          },
          mode: {
            name: "mode",
            desc: "First: Only the first wins. Race: Be fast. Explore: Take your time!",
            options: {
              first: "First",
              race: "Race",
              explore: "Explore",
            },
          },
          timeout: {
            name: "timeout",
            desc: "Number of seconds per question",
          },
        },
        reply: {
          timerDisclaimerFormat: "{0} seconds per question.",
          openingMessageExploreFormat:
            "Question **[{0} / {1}]**.\nReact with :eyes: to display the answer.",
          openingMessageFirstFormat:
            "Question **[{0} / {1}]**.\nOnly the first to answer correctly gets a point!",
          openingMessageRaceFormat:
            "Question **[{0} / {1}]**.\nYou have {2} seconds.",
          problemIsLoading: "Displaying in 3... 2... 1...",
          timeoutNoWinnerReply:
            "No one answered correctly. Don't get discouraged!",
          firstWinnerMessageFormat: "{0} got this one first!",
          roundOver: "(Round over)",
          winnerFormat: "✅: {0}",
          loserFormat: "❌: {0}",
          continueQuizPrompt: "React with :eyes: to start the next question",
          quizIsOver: "The quiz is over",
        },
      },
      nanikiru: {
        name: "nanikiru",
        desc: "Starts a wwyd quiz game",
        params: {
          series: {
            name: "series",
            desc: "The series from where the problems will be selected",
            options: {
              uzaku300: "Uzaku300",
              uzaku301: "Uzaku301",
              uzakuKin: "UzakuGold",
            },
          },
        },
        reply: {
          theadNameFormat: "Nanikiru of {0} ({1} problems)",
          threadFirstMessageFormat: "A series of {0} nanikiru is starting!",
          defaultOpeningMessage: "Find the best discard.",
          answerLabel: "Answer: ",
        },
      },
      chinitsu: {
        name: "chinitsu",
        desc: "Starts a chinitsu quiz game",
        params: {
          suit: {
            name: "suit",
            desc: "Select the suit used (random by default)",
            options: {
              pinzu: "Pinzu",
              manzu: "Manzu",
              souzu: "Souzu",
            },
          },
          difficulty: {
            name: "level",
            desc: "Easy: with single waits. Difficult: 3 or more waits. (Default: Normal)",
            options: {
              easy: "Easy",
              normal: "Normal",
              hard: "Difficult",
            },
          },
        },
        reply: {
          theadNameFormat: "Chinitsu of {0} ({1} problems)",
          threadFirstMessageFormat: "A series of {0} chinitsu is starting!",
          openingMessage: "Find the waits of this hand:",
          answerLabel: "Answer: ",
        },
      },
    },
    myinfo: {
      name: "myinfo",
      update: {
        name: "update",
        desc: "display/modify your information",
      },
      delete: {
        name: "delete",
        desc: "delete your information",
        reply: {
          noDataToDelete: "User has no data to delete.",
          modalTitle: "Confirm info deletion",
          confirmationMessage:
            "### ⚡💀Are you sure you want to delete your information? This action cannot be undone. All your data will be removed from Kandora's database, including your game and tournament history.\nThe recorded games will still be preserved but will contain `anonymous` instead of your username.",
          usernameLabel: "Enter your discord username: {0}",
          usernamePlaceholder: "Your discord username",
          userNotFound: "User not found.",
          successMessage:
            "Your information has been deleted. Everything that is linked to your identity is gone, eventhough some anonymous game data may remain.",
        },
      },
    },
    league: {
      name: "league",
      desc: "league commands",
      startnext: {
        name: "startnext",
        desc: "Start the next batch of bracket games",
        reply: {
          mustBeInServer: "❌ This command must be used in a server.",
          noActiveLeague: "❌ No active league is configured for this server.",
          noFinalPhase:
            "❌ This league has no final (bracket) phase configured.",
          finalPhaseNotStartedFormat:
            "❌ The final phase has not started yet. It begins on {0}.",
          noSchedulingChannel:
            "❌ No scheduling channel is configured on this league.",
          noBracketSeedings: "❌ No bracket seedings found for this league.",
          pendingRoundExists:
            "❌ A previous round is still upcoming or in progress. Wait for it to complete (or use `/league cancelnext`) before starting the next one.",
          noStagesToSchedule:
            "ℹ️ No stages have games ready to schedule. Either all rounds are in progress, completed, or the stages don't have all teams resolved yet.",
          stageLineFormat: "**{0}** — Round {1}/{2} ({3} table{4})",
          schedulingStartedFormat: "✅ Scheduling started:\n{0}",
          unexpectedError: "An unexpected error occurred.",
        },
      },
      launch: {
        name: "launch",
        desc: "Check player readiness and launch the scheduled games",
        reply: {
          mustBeInServer: "❌ This command must be used in a server.",
          noActiveLeague: "❌ No active league is configured for this server.",
          noFinalPhase:
            "❌ This league has no final (bracket) phase configured.",
          noUpcomingGames:
            "ℹ️ No upcoming games to launch. Use `/league startnext` first.",
          unsupportedPlatform:
            "❌ This platform does not support launching games.",
          noTournamentId: "❌ No tournament ID is configured for this league.",
          noBracketSeedings: "❌ No bracket seedings found for this league.",
          playersNotReadyFormat:
            "❌ The following players are not ready:\n- {0}",
          tableSuccessFormat: "✅ **{0}** — launched ({1})",
          tableFailFormat: "❌ **{0}** — failed to launch ({1}): {2}",
          launchResultFormat: "🚀 Launch results:\n{0}",
          launchSummaryFormat: "🚀 Launched {0}/{1} table(s).",
          unexpectedError: "An unexpected error occurred.",
        },
      },
      cancelnext: {
        name: "cancelnext",
        desc: "Cancel the current scheduled bracket round",
        reply: {
          mustBeInServer: "❌ This command must be used in a server.",
          noActiveLeague: "❌ No active league is configured for this server.",
          noPendingMessages: "ℹ️ No pending scheduling messages to cancel.",
          success:
            "✅ Cancelled {0} scheduling message(s) and stopped the polling agent.",
          unexpectedError: "An unexpected error occurred.",
        },
      },
      sub: {
        name: "sub",
        desc: "Register or cancel a player substitution (swap the parameters to cancel)",
        params: {
          player: {
            name: "player",
            desc: "In-game ID of the player to replace",
          },
          substitute: {
            name: "substitute",
            desc: "In-game ID of the substitute",
          },
          rounds: {
            name: "rounds",
            desc: "Rounds to target, e.g. 2,3 or 2-3 (defaults to the next round)",
          },
        },
        reply: {
          mustBeInServer: "❌ This command must be used in a server.",
          noActiveLeague: "❌ No active league is configured for this server.",
          noFinalPhase:
            "❌ This league has no final (bracket) phase configured.",
          unsupportedPlatform:
            "❌ Substitutions are not supported for this platform.",
          playerNotFound: "❌ No registered user found with in-game ID `{0}`.",
          substituteNotFound:
            "❌ No registered user found with in-game ID `{0}`.",
          playerNotInTeam:
            "❌ **{0}** is not a member of any team in this league.",
          substituteNotInRoster:
            "❌ **{0}** is not in the substitute list for **{1}**.",
          officialSubFormat:
            "✅ **Substitution registered (official sub).** **{0}** will replace **{1}** for round(s) {2}.",
          finalsNotStarted:
            "❌ The bracket has not been seeded yet. Substitutions can only be registered once the finals have started.",
          playerNotScheduled:
            "❌ **{0}** is not scheduled to play in the next round.",
          invalidRoundsFormat:
            "❌ Invalid rounds format `{0}`. Use values like `2`, `2,3` or `2-3`.",
          roundOutOfRange:
            "❌ Round(s) {0} do not exist in this stage (it has {1} rounds).",
          roundAlreadyCompleted:
            "❌ Round(s) {0} have already been played and can no longer be targeted.",
          playerNotScheduledInRound:
            "❌ **{0}** is not scheduled to play in round(s) {1}.",
          overlappingSubstitution:
            "❌ A substitution for **{0}** already covers one of those rounds.",
          substitutionAlreadyExists:
            "❌ A substitution for **{0}** already exists.",
          successFormat:
            "✅ **Substitution registered.** **{0}** will be replaced by **{1}** for round(s) {2}.",
          cancelSuccessFormat:
            "↩️ **Substitution cancelled.** **{0}** will play round(s) {2} again (no longer replaced by **{1}**).",
          cancelNoMatchingRounds:
            "❌ No substitution found for **{0}** ↔ **{1}** in round(s) `{2}`.",
          unexpectedError: "An unexpected error occurred.",
        },
      },
    },
    mjg: {
      name: "mjg",
      nanikiru: {
        name: "nanikiru",
        desc: "display a hand to think about",
        params: {
          hand: {
            name: "hand",
            desc: "Example: 12333s456p555m11z. Optional: dragons= [RWG]d, winds= [ESWN]w",
          },
          discards: {
            name: "defausses",
            desc: "[Optionel] Défausses permises de la main.",
          },
          doras: {
            name: "doras",
            desc: "[Optional] Example: 1p4s",
          },
          seat: {
            name: "seat",
            desc: "[Optional] Player's wind",
            options: {
              east: "East",
              south: "South",
              west: "West",
              north: "North",
            },
          },
          round: {
            name: "round",
            desc: "[Optional] Current round. Example: S3",
          },
          turn: {
            name: "turn",
            desc: "[Optional] Current turn",
          },
          thread: {
            name: "thread",
            desc: "[Optional] Create a thread to talk about it",
          },
          spoiler: {
            name: "spoiler",
            desc: "[Optional] Hide the ukeire",
          },
          ukeire: {
            name: "waits",
            desc: 'Displays the number of waits of each discard ("Full" also displays the waits)',
            options: {
              no: "No",
              yes: "Yes",
              full: "Full",
            },
          },
        },
        reply: {
          seat: "Player `{0}`",
          round: "During `{0}`",
          turn: "Turn `{0}`",
          doras: "Dora {0}",
          wwyd: "What would you do?",
          threadTitle: "{0} wonders about {1}",
        },
      },
    },
  },
  system: {
    league: {
      unknownTeam: "Unknown Team",
      unknownUser: "Unknown User",
      rankingTitleFormat: "**🏆 {0} Team Rankings**",
      rankingLineFormat: "**{0}.** {1} - {2} ({3} games)",
      noGamesRecorded: "No games recorded yet.",
      pendingScoresHeader:
        "**⏳ Pending Scores (not counted due to 35% quota)**",
      pendingScoreLineFormat: "- {0} ({1} {2}): {3}",
      lastUpdatedFormat: "_Last updated {0}_",
      statisticsNote:
        "_For more statistics, visit https://www.tnt-sessions.com/online-tournaments_",
      newGameRecordedFormat: "**New game recorded for {0}**",
      invalidGameDetectedFormat: "**Invalid game detected for {0}**",
      playersNotInTeam:
        "Not all players are registered in a team for this league:",
      scoresNotAvailable: "Scores not available",
      startTimeLabel: "**Start Time:**",
      endTimeLabel: "**End Time:**",
      gameLinkLabel: "**Game Link:**",
      unknownTime: "Unknown",
    },
  },
};
