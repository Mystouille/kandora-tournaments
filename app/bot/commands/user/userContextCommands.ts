import {
  MessageFlags,
  UserContextMenuCommandInteraction,
  ContextMenuCommandBuilder,
  ApplicationCommandType,
} from "discord.js";
import { UserModel } from "../../../db/User";

export const data = new ContextMenuCommandBuilder()
  .setName("[Kandora] Mahjong Info")
  .setType(ApplicationCommandType.User);

export async function execute(interaction: UserContextMenuCommandInteraction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const user = await UserModel.findOne({
    "discordIdentity.id": interaction.targetUser.id,
  }).exec();
  if (!user) {
    await interaction.editReply({
      content: `No information found for user ${interaction.targetUser.username}.`,
    });
    return;
  }
  await interaction.editReply({
    content:
      `User Information for ${interaction.targetUser.displayName} (${interaction.targetUser.username}):\n` +
      `Mahjong Soul ID:\t\`${user.majsoulIdentity?.friendId ?? "[Not set]"}\`\n` +
      `Mahjong Soul name:\t\`${user.majsoulIdentity?.name ?? "[Not set]"}\`\n` +
      `RiichiCity ID:\t\`${user.riichiCityIdentity?.id ?? "[Not set]"}\`\n` +
      `RiichiCity name:\t\`${user.riichiCityIdentity?.name ?? "[Not set]"}\`\n` +
      `Tenhou ID:\t\`${user.tenhouIdentity?.name ?? "[Not set]"}\``,
  });
}
