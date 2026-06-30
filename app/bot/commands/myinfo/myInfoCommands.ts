import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { invariantResources, strings } from "../../localization/strings";
import { buildOptionNameAndDescription } from "../../localizationUtils";
import { executeUpdateMyInfo } from "./update";
import { executeDeleteMyInfo } from "./delete";

const myInfoUpdateSubCommandName =
  invariantResources.commands.myinfo.update.name;
const myInfoDeleteSubCommandName =
  invariantResources.commands.myinfo.delete.name;

export const data: any = new SlashCommandBuilder()
  .setName(invariantResources.commands.myinfo.name)
  .setDescription(invariantResources.commands.myinfo.name)
  .addSubcommand((sub) =>
    buildOptionNameAndDescription(sub, strings.commands.myinfo.update)
  )
  .addSubcommand((sub) =>
    buildOptionNameAndDescription(sub, strings.commands.myinfo.delete)
  );

export async function execute(interaction: ChatInputCommandInteraction) {
  if (interaction.options.getSubcommand() === myInfoUpdateSubCommandName) {
    executeUpdateMyInfo(interaction);
  }
  if (interaction.options.getSubcommand() === myInfoDeleteSubCommandName) {
    executeDeleteMyInfo(interaction);
  }
}
