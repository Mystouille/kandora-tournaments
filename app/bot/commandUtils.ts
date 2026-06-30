import * as mjg from "./commands/mjg/mjgCommands";
import * as quiz from "./commands/quiz/quizCommands";
import * as admin from "./commands/admin/adminCommands";
import * as myinfo from "./commands/myinfo/myInfoCommands";
import * as league from "./commands/league/leagueCommands";
import { REST, Routes } from "discord.js";
import { discordBotConfig } from "config";
import { userContextMenus } from "./interactionUtils";

export const commands = {
  admin,
  league,
  mjg,
  myinfo,
  quiz,
};

const commandsData = Object.values(commands).map((command) =>
  command.data.toJSON()
);

const userContextCommandsData = Object.values(userContextMenus).map((command) =>
  command.data.toJSON()
);

const botCfg = discordBotConfig();
const rest = new REST({ version: "10" }).setToken(
  botCfg?.DISCORD_BOT_TOKEN ?? ""
);

export async function deployCommands() {
  if (!botCfg) {
    throw new Error("Discord Bot is not configured");
  }
  try {
    await rest
      .put(Routes.applicationCommands(botCfg.DISCORD_CLIENT_ID), {
        body: [...commandsData, ...userContextCommandsData],
      })
      .then(() => {
        console.log("Successfully reloaded application (/) commands.");
      });
  } catch (error) {
    console.error(error);
  }
}
