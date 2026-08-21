import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { invariantResources, strings } from "../../localization/strings";
import { buildOptionNameAndDescription } from "../../localizationUtils";
import { executeUpdateMyInfo } from "./update";

const myInfoUpdateSubCommandName =
  invariantResources.commands.myinfo.update.name;

export const data: any = new SlashCommandBuilder()
  .setName(invariantResources.commands.myinfo.name)
  .setDescription(invariantResources.commands.myinfo.name)
  .addSubcommand((sub) =>
    buildOptionNameAndDescription(sub, strings.commands.myinfo.update)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (interaction.options.getSubcommand() === myInfoUpdateSubCommandName) {
    await executeUpdateMyInfo(interaction);
  }
}
