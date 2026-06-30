import {
  ChatInputCommandInteraction,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { UserModel } from "../../../db/User";
import { localize } from "../../localizationUtils";
import { strings } from "../../localization/strings";

export async function executeDeleteMyInfo(
  interaction: ChatInputCommandInteraction
) {
  await interaction.deferReply({
    flags: MessageFlags.Ephemeral,
  });
  const user = await UserModel.findOne({
    "discordIdentity.id": interaction.user.id,
  }).exec();

  if (!user) {
    await interaction.editReply({
      content: localize(
        interaction.locale,
        strings.commands.myinfo.delete.reply.noDataToDelete
      ),
    });
    return;
  }
  const modal = new ModalBuilder()
    .setCustomId("deleteInfoModal")
    .setTitle(
      localize(
        interaction.locale,
        strings.commands.myinfo.delete.reply.modalTitle
      )
    )
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        localize(
          interaction.locale,
          strings.commands.myinfo.delete.reply.confirmationMessage
        )
      )
    )
    .addLabelComponents(() =>
      new LabelBuilder()
        .setLabel(
          localize(
            interaction.locale,
            strings.commands.myinfo.delete.reply.usernameLabel
          ).replace("{0}", interaction.user.username)
        )
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("validationInput")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder(
              localize(
                interaction.locale,
                strings.commands.myinfo.delete.reply.usernamePlaceholder
              )
            )
        )
    );
  await interaction.showModal(modal);
}
