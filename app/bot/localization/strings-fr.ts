import type { StringResources } from "./strings";

export const stringsFr: StringResources = {
  commands: {
    common: {
      shantenGoodWaitInfo: "\\*:donne un tenpai de 5+ tuiles",
    },
    admin: {
      name: "admin",
      desc: "commandes admin",
      checkNanikiru: {
        name: "checknanikiru",
        desc: "affiche un problème nanikiru par sa source pour vérifier son contenu",
        params: {
          source: {
            name: "source",
            desc: "L'identifiant source du problème (ex: 300-Q-226)",
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
            desc: "Nombre de rounds du quiz",
          },
          mode: {
            name: "mode",
            desc: "Preums: Seul le premier gagne. Course: Soyez rapide. Explore: Prenez votre temps.",
            options: {
              first: "Preums",
              race: "Course",
              explore: "Explore",
            },
          },
          timeout: {
            name: "timeout",
            desc: "Nombre de secondes par question",
          },
        },
        reply: {
          timerDisclaimerFormat: "{0} secondes par question.",
          openingMessageExploreFormat:
            "Question **[{0} / {1}]**.\nRéagissez avec :eyes: pour afficher la réponse.",
          openingMessageFirstFormat:
            "Question **[{0} / {1}]**.\nSeul le premier à trouver la réponse remporte un point!",
          openingMessageRaceFormat:
            "Question **[{0} / {1}]**.\nVous avez {3} secondes.",
          problemIsLoading: "Affichage dans 3... 2... 1...",
          timeoutNoWinnerReply:
            "Personne n'a trouvé à temps. Ne vous découragez pas!",
          firstWinnerMessageFormat: "{0} a trouvé en premier!",
          roundOver: "(Manche terminée)",
          winnerFormat: "✅: {0}",
          loserFormat: "❌: {0}",
          continueQuizPrompt:
            "Réagissez avec :eyes: pour commencer la question suivante",
          quizIsOver: "Le quiz est fini!",
        },
      },
      nanikiru: {
        name: "nanikiru",
        desc: "commence un quiz de wwyd",
        params: {
          series: {
            name: "serie",
            desc: "La série d'exercices dont les problèmes seront tirés",
            options: {
              uzaku300: "Uzaku300",
              uzaku301: "Uzaku301",
              uzakuKin: "UzakuGold",
            },
          },
        },
        reply: {
          theadNameFormat: "Nanikiru du {0} ({1} problèmes)",
          threadFirstMessageFormat: "Une série de {0} nanikiru commence!",
          defaultOpeningMessage: "Trouvez la meilleure défause.",
          answerLabel: "Réponse: ",
        },
      },
      chinitsu: {
        name: "chinitsu",
        desc: "commence un quiz de chinitsu",
        params: {
          suit: {
            name: "famille",
            desc: "Choisi la famille de tuile utilisée (aléatoire par défaut)",
            options: {
              pinzu: "Pinzu",
              manzu: "Manzu",
              souzu: "Souzu",
            },
          },
          difficulty: {
            name: "niveau",
            desc: "Facile: avec kanchan. Difficile: 3 attentes ou plus. (défaut: Normal)",
            options: {
              easy: "Facile",
              normal: "Normal",
              hard: "Difficile",
            },
          },
        },
        reply: {
          theadNameFormat: "Chinitsu du {0} ({1} problèmes)",
          threadFirstMessageFormat: "Une série de {0} chinitsu commence!",
          openingMessage: "Trouvez la/les attentes de cette main:",
          answerLabel: "Réponse: ",
        },
      },
    },
    myinfo: {
      name: "myinfo",
      update: {
        name: "update",
        desc: "affiche/modifie vos informations",
      },
      delete: {
        name: "delete",
        desc: "supprime vos informations",
        reply: {
          noDataToDelete: "L'utilisateur n'a pas de données à supprimer.",
          modalTitle: "Confirmer la suppression des informations",
          confirmationMessage:
            "### ⚡💀Êtes-vous sûr de vouloir supprimer vos informations ? Cette action ne peut pas être annulée. Toutes vos données seront supprimées de la base de données de Kandora, y compris votre historique de jeux et de tournois.\nLes jeux enregistrés seront toujours conservés mais contiendront `anonyme` à la place de votre nom d'utilisateur.",
          usernameLabel: "Entrez votre nom d'utilisateur Discord : {0}",
          usernamePlaceholder: "Votre nom d'utilisateur Discord",
          userNotFound: "Utilisateur non trouvé.",
          successMessage:
            "Vos informations ont été supprimées. Tout ce qui était lié à votre identité a disparu, même si certaines données de jeu anonymes peuvent subsister.",
        },
      },
    },
    league: {
      name: "league",
      desc: "commandes de ligue",
      startnext: {
        name: "startnext",
        desc: "Démarre la prochaine série de parties du bracket",
        reply: {
          mustBeInServer:
            "❌ Cette commande doit être utilisée dans un serveur.",
          noActiveLeague:
            "❌ Aucune ligue active n'est configurée pour ce serveur.",
          noFinalPhase:
            "❌ Cette ligue n'a pas de phase finale (bracket) configurée.",
          finalPhaseNotStartedFormat:
            "❌ La phase finale n'a pas encore commencé. Elle débute le {0}.",
          noSchedulingChannel:
            "❌ Aucun salon de scheduling n'est configuré pour cette ligue.",
          noBracketSeedings:
            "❌ Aucun seeding de bracket trouvé pour cette ligue.",
          pendingRoundExists:
            "❌ Une ronde précédente est encore à venir ou en cours. Attends qu'elle se termine (ou utilise `/league cancelnext`) avant de lancer la suivante.",
          noStagesToSchedule:
            "ℹ️ Aucune étape n'a de parties à planifier. Soit toutes les rondes sont en cours, terminées, ou les étapes n'ont pas encore toutes les équipes définies.",
          stageLineFormat: "**{0}** — Ronde {1}/{2} ({3} table{4})",
          schedulingStartedFormat: "✅ Scheduling démarré :\n{0}",
          unexpectedError: "Une erreur inattendue s'est produite.",
        },
      },
      launch: {
        name: "launch",
        desc: "Vérifie que les joueurs sont prêts et lance les parties programmées",
        reply: {
          mustBeInServer:
            "❌ Cette commande doit être utilisée dans un serveur.",
          noActiveLeague:
            "❌ Aucune ligue active n'est configurée pour ce serveur.",
          noFinalPhase:
            "❌ Cette ligue n'a pas de phase finale (bracket) configurée.",
          noUpcomingGames:
            "ℹ️ Aucune partie à lancer. Utilisez `/league startnext` d'abord.",
          unsupportedPlatform:
            "❌ Cette plateforme ne supporte pas le lancement de parties.",
          noTournamentId:
            "❌ Aucun ID de tournoi n'est configuré pour cette ligue.",
          noBracketSeedings:
            "❌ Aucun seeding de bracket trouvé pour cette ligue.",
          playersNotReadyFormat:
            "❌ Les joueurs suivants ne sont pas prêts :\n- {0}",
          tableSuccessFormat: "✅ **{0}** — lancé ({1})",
          tableFailFormat: "❌ **{0}** — échec du lancement ({1}) : {2}",
          launchResultFormat: "🚀 Résultats du lancement :\n{0}",
          launchSummaryFormat: "🚀 {0}/{1} table(s) lancée(s).",
          unexpectedError: "Une erreur inattendue s'est produite.",
        },
      },
      cancelnext: {
        name: "cancelnext",
        desc: "Annuler la ronde de bracket planifiée en cours",
        reply: {
          mustBeInServer:
            "❌ Cette commande doit être utilisée dans un serveur.",
          noActiveLeague:
            "❌ Aucune ligue active n'est configurée pour ce serveur.",
          noPendingMessages:
            "ℹ️ Aucun message de scheduling en attente à annuler.",
          success:
            "✅ {0} message(s) de scheduling annulé(s) et l'agent de polling arrêté.",
          unexpectedError: "Une erreur inattendue s'est produite.",
        },
      },
      sub: {
        name: "sub",
        desc: "Enregistrer ou annuler un remplacement de joueur (inverser les paramètres pour annuler)",
        params: {
          player: {
            name: "joueur",
            desc: "ID en jeu du joueur à remplacer",
          },
          substitute: {
            name: "remplacant",
            desc: "ID en jeu du remplaçant",
          },
          rounds: {
            name: "rondes",
            desc: "Rondes ciblées, ex. 2,3 ou 2-3 (par défaut la prochaine ronde)",
          },
        },
        reply: {
          mustBeInServer:
            "❌ Cette commande doit être utilisée dans un serveur.",
          noActiveLeague:
            "❌ Aucune ligue active n'est configurée pour ce serveur.",
          noFinalPhase:
            "❌ Cette ligue n'a pas de phase finale (bracket) configurée.",
          unsupportedPlatform:
            "❌ Les remplacements ne sont pas supportés pour cette plateforme.",
          playerNotFound: "❌ Aucun utilisateur trouvé avec l'ID en jeu `{0}`.",
          substituteNotFound:
            "❌ Aucun utilisateur trouvé avec l'ID en jeu `{0}`.",
          playerNotInTeam:
            "❌ **{0}** n'est membre d'aucune équipe dans cette ligue.",
          substituteNotInRoster:
            "❌ **{0}** n'est pas dans la liste des remplaçants de **{1}**.",
          officialSubFormat:
            "✅ **Remplacement enregistré (remplaçant officiel).** **{0}** remplacera **{1}** pour la/les ronde(s) {2}.",
          finalsNotStarted:
            "❌ Le bracket n'a pas encore été initialisé. Les remplacements ne peuvent être enregistrés qu'une fois que les finales ont commencé.",
          playerNotScheduled:
            "❌ **{0}** n'est pas prévu pour jouer dans la prochaine ronde.",
          invalidRoundsFormat:
            "❌ Format de rondes invalide `{0}`. Utilisez des valeurs comme `2`, `2,3` ou `2-3`.",
          roundOutOfRange:
            "❌ La/les ronde(s) {0} n'existe(nt) pas dans cette étape (elle compte {1} rondes).",
          roundAlreadyCompleted:
            "❌ La/les ronde(s) {0} ont déjà été jouée(s) et ne peuvent plus être ciblée(s).",
          playerNotScheduledInRound:
            "❌ **{0}** n'est pas prévu pour jouer dans la/les ronde(s) {1}.",
          overlappingSubstitution:
            "❌ Un remplacement pour **{0}** couvre déjà l'une de ces rondes.",
          substitutionAlreadyExists:
            "❌ Un remplacement pour **{0}** existe déjà.",
          successFormat:
            "✅ **Remplacement enregistré.** **{0}** sera remplacé(e) par **{1}** pour la/les ronde(s) {2}.",
          cancelSuccessFormat:
            "↩️ **Remplacement annulé.** **{0}** rejouera la/les ronde(s) {2} (n'est plus remplacé(e) par **{1}**).",
          cancelNoMatchingRounds:
            "❌ Aucun remplacement trouvé pour **{0}** ↔ **{1}** dans la/les ronde(s) `{2}`.",
          unexpectedError: "Une erreur inattendue s'est produite.",
        },
      },
    },
    mjg: {
      name: "mjg",
      nanikiru: {
        desc: "commence un wwyd",
        name: "nanikiru",
        params: {
          hand: {
            name: "main",
            desc: "Exemple: 12333s456p555m11z. Optional: dragons= [RWG]d, winds= [ESWN]w",
          },
          discards: {
            name: "discards",
            desc: "[Optional] Allowed discards of the hand",
          },
          doras: {
            name: "doras",
            desc: "[Optionel] Exemple: 1p4s",
          },
          seat: {
            name: "joueur",
            desc: "[Optionel] Vent du joueur",
            options: {
              east: "Est",
              south: "Sud",
              west: "Ouest",
              north: "Nord",
            },
          },
          round: {
            name: "manche",
            desc: "[Optionel] Manche actuelle. Exemple: S3",
          },
          turn: {
            name: "tour",
            desc: "[Optionel] Tour dans la manche",
          },
          thread: {
            name: "fil",
            desc: "[Optionel] Crée un fil de discussion dédié",
          },
          spoiler: {
            name: "spoiler",
            desc: "[Optionel] Masque les ukeire",
          },
          ukeire: {
            name: "attentes",
            desc: "Affiche le nombre d'attentes de chaque défausse (Complet affiche aussi les tuiles attendues)",
            options: {
              no: "Non",
              yes: "Oui",
              full: "Complet",
            },
          },
        },
        reply: {
          seat: "Joueur `{0}`",
          round: "Pendant `{0}`",
          turn: "Tour `{0}`",
          doras: "Dora {0}",
          wwyd: "Que feriez vous?",
          threadTitle: "{0} réfléchi à {1}",
        },
      },
    },
  },
  system: {
    league: {
      unknownTeam: "Équipe inconnue",
      unknownUser: "Utilisateur inconnu",
      rankingTitleFormat: "**🏆 Classement des équipes - {0}**",
      rankingLineFormat: "**{0}.** {1} : {2} ({3} parties)",
      noGamesRecorded: "Aucune partie enregistrée.",
      pendingScoresHeader:
        "**⏳ Scores en attente (non comptabilisés à cause du quota de 35%)**",
      pendingScoreLineFormat: "- {0} ({1} {2}): {3}",
      lastUpdatedFormat: "_Dernière mise à jour {0}_",
      statisticsNote:
        "_Pour plus de statistiques, visitez https://www.tnt-sessions.com/online-tournaments_",
      newGameRecordedFormat: "**Nouvelle partie enregistrée pour {0}**",
      invalidGameDetectedFormat: "**Partie invalide détectée pour {0}**",
      playersNotInTeam:
        "Tous les joueurs ne sont pas inscrits dans une équipe pour cette ligue:",
      scoresNotAvailable: "Scores non disponibles",
      startTimeLabel: "**Début:**",
      endTimeLabel: "**Fin:**",
      gameLinkLabel: "**Lien de la partie:**",
      unknownTime: "Inconnu",
    },
  },
};
