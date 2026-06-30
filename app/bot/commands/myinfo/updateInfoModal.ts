import { MessageFlags, ModalSubmitInteraction } from "discord.js";
import { UserModel } from "../../../db/User";

export async function execute(itr: ModalSubmitInteraction) {
  let user = await UserModel.findOne({
    "discordIdentity.id": itr.user.id,
  }).exec();

  if (!user) {
    user = await UserModel.create({
      discordIdentity: { id: itr.user.id },
      name: itr.user.username,
    });
  }
  const tenhouId = itr.fields.getTextInputValue("tenhouId");

  if (tenhouId.length > 0 && user?.tenhouIdentity?.name !== tenhouId) {
    if (!user.tenhouIdentity) {
      user.tenhouIdentity = { name: tenhouId };
    } else {
      user.tenhouIdentity.name = tenhouId;
    }
  }
  await user.save();
  await itr.reply({
    content:
      "Your information has been updated. To link your Mahjong Soul or Riichi City accounts, please visit your account settings on the web portal.",
    flags: MessageFlags.Ephemeral,
  });
}
