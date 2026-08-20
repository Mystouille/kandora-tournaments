import { MessageFlags, ModalSubmitInteraction } from "discord.js";
import { UserModel } from "../../../core/models/shared/User";
import { linkPlatformIdentity } from "../../../core/services/identityLinking";
import { identityLinkDeps } from "../../../services/identityLinkDeps.server";

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
  const tenhouId = itr.fields.getTextInputValue("tenhouId").trim();

  if (tenhouId.length > 0 && user.tenhouIdentity?.name !== tenhouId) {
    const result = await linkPlatformIdentity(
      user._id.toString(),
      "tenhouId",
      tenhouId,
      identityLinkDeps
    );
    if (result.status !== 200) {
      await itr.reply({
        content:
          typeof result.body.error === "string"
            ? result.body.error
            : "Unable to link that Tenhou username.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }
  await itr.reply({
    content:
      "Your information has been updated. To link your Mahjong Soul or Riichi City accounts, please visit your account settings on the web portal.",
    flags: MessageFlags.Ephemeral,
  });
}
