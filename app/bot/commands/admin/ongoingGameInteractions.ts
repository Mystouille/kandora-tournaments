import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ModalActionRowComponentBuilder,
  type ModalSubmitInteraction,
} from "discord.js";
import { LeagueModel, type League } from "~/db/League";
import { connectToDatabase } from "~/utils/dbConnection.server";
import { createConnectorForLeague } from "~/services/connectors/createConnectorForLeague.server";
import {
  refreshOngoingGameMessage,
  setOngoingGameMessageBusy,
} from "~/services/ongoingGameMessageService.server";
import {
  buildConfirmModalCustomId,
  parseOngoingGameCustomId,
  type OngoingGameAction,
} from "~/services/ongoingGameMessageRenderer";

const ACTION_TITLES: Record<OngoingGameAction, string> = {
  pause: "Pause game",
  resume: "Resume game",
  terminate: "Terminate game",
};

const ACTION_DESCRIPTIONS: Record<OngoingGameAction, string> = {
  pause: "Submit to pause this game. Cancel to abort.",
  resume: "Submit to resume this game. Cancel to abort.",
  terminate: "Submit to TERMINATE this game (destructive). Cancel to abort.",
};

/**
 * Handles the click on an ongoing-game action button. Opens a confirmation
 * modal whose submission triggers the actual action via {@link executeOngoingGameConfirmModal}.
 */
export async function executeOngoingGameButton(
  interaction: ButtonInteraction
): Promise<void> {
  const parsed = parseOngoingGameCustomId(interaction.customId);
  if (!parsed) {
    await interaction.reply({
      content: "Invalid ongoing-game button payload.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const { action, leagueId, gameId } = parsed;

  // Discord modals require at least one component.  We use a single short-text
  // input prefilled with "OK" so the user can just press Submit (or close the
  // modal with the Cancel ✕ button to abort).  The value is ignored.
  const promptInput = new TextInputBuilder()
    .setCustomId("noop")
    .setLabel(ACTION_DESCRIPTIONS[action].slice(0, 45))
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setValue("OK")
    .setMaxLength(100);

  const modal = new ModalBuilder()
    .setCustomId(buildConfirmModalCustomId(action, leagueId, gameId))
    .setTitle(ACTION_TITLES[action])
    .addComponents(
      new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
        promptInput
      )
    );

  await interaction.showModal(modal);
}

/**
 * Handles confirmation-modal submission for an ongoing-game action. Performs
 * pause/resume/terminate via the connector, then immediately refreshes the
 * admin-channel message for that game so the operator sees the result.
 */
export async function executeOngoingGameConfirmModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  const parsed = parseOngoingGameCustomId(interaction.customId);
  if (!parsed) {
    await interaction.reply({
      content: "Invalid ongoing-game confirmation payload.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const { action, leagueId, gameId } = parsed;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await connectToDatabase();

  const league = await LeagueModel.findById(leagueId)
    .populate("leagueTypeConfig")
    .lean<League>();
  if (!league) {
    await interaction.editReply(`League ${leagueId} not found.`);
    return;
  }
  const tournamentId = league.platformConfig.tournamentId;
  if (!tournamentId) {
    await interaction.editReply(
      `League ${league.name} has no platform tournament id configured.`
    );
    return;
  }

  const connector = createConnectorForLeague(league);

  // Capability check up-front so we don't strip the buttons unnecessarily.
  if (action === "pause" && typeof connector.pauseGame !== "function") {
    await interaction.editReply(
      `Pause is not supported for platform ${league.platformConfig.platformName}.`
    );
    return;
  }
  if (action === "resume" && typeof connector.resumeGame !== "function") {
    await interaction.editReply(
      `Resume is not supported for platform ${league.platformConfig.platformName}.`
    );
    return;
  }
  if (action === "terminate" && typeof connector.terminateGame !== "function") {
    await interaction.editReply(
      `Terminate is not supported for platform ${league.platformConfig.platformName}.`
    );
    return;
  }

  // Strip buttons + show a working notice while the platform call is in
  // flight, to prevent double-clicks. Best-effort.
  await setOngoingGameMessageBusy(
    leagueId,
    gameId,
    `⏳ ${action} in progress…`
  );

  let actionError: unknown;
  try {
    switch (action) {
      case "pause":
        await connector.pauseGame!(gameId, tournamentId);
        break;
      case "resume":
        await connector.resumeGame!(gameId, tournamentId);
        break;
      case "terminate":
        await connector.terminateGame!(gameId, tournamentId);
        break;
      default:
        actionError = new Error(`Unknown action: ${action}`);
    }
  } catch (err) {
    actionError = err;
    console.error(
      `Ongoing-game ${action} failed for league ${league.name}, game ${gameId}:`,
      err
    );
  }

  // Always refresh: on success the message gets the proper buttons back (or
  // is deleted, for terminate); on failure the original buttons are restored.
  try {
    await refreshOngoingGameMessage(leagueId, gameId);
  } catch (err) {
    console.error(`Ongoing-game ${action} refresh failed:`, err);
  }

  if (actionError) {
    await interaction.editReply(
      `❌ ${action} failed: ${
        actionError instanceof Error ? actionError.message : String(actionError)
      }`
    );
    return;
  }

  await interaction.editReply(`✅ ${action} OK`);
}
