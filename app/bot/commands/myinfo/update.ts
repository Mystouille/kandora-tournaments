import {
  ChatInputCommandInteraction,
  LabelBuilder,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { UserModel } from "../../../db/User";

export async function executeUpdateMyInfo(
  interaction: ChatInputCommandInteraction
) {
  const user = await UserModel.findOne({
    "discordIdentity.id": interaction.user.id,
  }).exec();

  const modal = new ModalBuilder()
    .setCustomId("infoModal")
    .setTitle("Edit my information")
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        "📌 To link your Mahjong Soul or Riichi City accounts, please visit your account settings on the web portal."
      )
    )
    .addLabelComponents(() =>
      new LabelBuilder().setLabel("Tenhou ID").setTextInputComponent(
        new TextInputBuilder()
          .setCustomId("tenhouId")
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder("Your Tenhou username")
          .setValue(user?.tenhouIdentity?.name ?? "")
      )
    );
  await interaction.showModal(modal);
}
