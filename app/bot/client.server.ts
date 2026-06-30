import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { discordBotConfig } from "config";
import { commands } from "./commandUtils";
import { modals, userContextMenus } from "./interactionUtils";
import { AppEmojiCollection } from "./resources/emojis/AppEmojiCollection";
import { NanikiruCollections } from "./resources/nanikiru/NanikiruCollections";
import { markReady, markSkipped } from "~/services/readiness.server";
import {
  ONGOING_GAME_BUTTON_PREFIX,
  ONGOING_GAME_CONFIRM_MODAL_PREFIX,
} from "~/services/ongoingGameMessageRenderer";
import {
  executeOngoingGameButton,
  executeOngoingGameConfirmModal,
} from "./commands/admin/ongoingGameInteractions";

let client: Client | null = null;

export function getClient(): Client | null {
  return client;
}

export async function initDiscordBot(): Promise<void> {
  if (client) {
    return;
  } // already initialized

  const botCfg = discordBotConfig();
  if (!botCfg) {
    console.log(
      "DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID not configured — Discord bot disabled."
    );
    markSkipped("discord");
    markSkipped("nanikiru");
    markSkipped("emojis");
    return;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.MessageContent,
    ],
  });

  client.once(Events.ClientReady, () => {});

  // Modal submissions
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isModalSubmit()) {
      return;
    }
    const { customId } = interaction;
    try {
      if (customId.startsWith(`${ONGOING_GAME_CONFIRM_MODAL_PREFIX}:`)) {
        await executeOngoingGameConfirmModal(interaction);
      } else if (modals[customId as keyof typeof modals]) {
        await modals[customId as keyof typeof modals].execute(interaction);
      }
    } catch (error) {
      console.error(error);
      const errorMsg = `There was an error while executing this command! \n ${error}`;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: errorMsg,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: errorMsg,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  });

  // Button interactions (ongoing-game admin actions)
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isButton()) {
      return;
    }
    const { customId } = interaction;
    if (!customId.startsWith(`${ONGOING_GAME_BUTTON_PREFIX}:`)) {
      return;
    }
    try {
      await executeOngoingGameButton(interaction);
    } catch (error) {
      console.error(error);
      const errorMsg = `There was an error handling this button! \n ${error}`;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: errorMsg,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: errorMsg,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  });

  // User context menus
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isUserContextMenuCommand()) {
      return;
    }
    const { commandName } = interaction;
    try {
      if (userContextMenus[commandName as keyof typeof userContextMenus]) {
        await userContextMenus[
          commandName as keyof typeof userContextMenus
        ].execute(interaction);
      }
    } catch (error) {
      console.error(error);
      const errorMsg = `There was an error while executing this command! \n ${error}`;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: errorMsg,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: errorMsg,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  });

  // Slash commands
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    const { commandName } = interaction;
    try {
      if (commands[commandName as keyof typeof commands]) {
        await commands[commandName as keyof typeof commands].execute(
          interaction
        );
      }
    } catch (error) {
      console.error(error);
      const errorMsg = `There was an error while executing this command! \n ${error}`;
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: errorMsg,
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: errorMsg,
          flags: MessageFlags.Ephemeral,
        });
      }
    }
  });

  // Initialize Nanikiru data
  NanikiruCollections.instance;

  // Login and fetch emojis
  await client.login(botCfg.DISCORD_BOT_TOKEN);
  markReady("discord", `logged in as ${client.user?.tag}`);
  const emojis = await client.application?.emojis.fetch();
  if (emojis) {
    AppEmojiCollection.instance.setCollection(emojis);
  }
  markReady("emojis", `${emojis?.size ?? 0} emojis loaded`);
}
