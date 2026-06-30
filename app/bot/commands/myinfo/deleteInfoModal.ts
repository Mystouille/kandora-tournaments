import { MessageFlags, ModalSubmitInteraction } from "discord.js";
import { UserModel } from "../../../db/User";
import { localize } from "../../localizationUtils";
import { strings } from "../../localization/strings";

export async function execute(itr: ModalSubmitInteraction) {
  const user = await UserModel.findOne({
    "discordIdentity.id": itr.user.id,
  }).exec();

  if (!user) {
    await itr.reply({
      content: localize(
        itr.locale,
        strings.commands.myinfo.delete.reply.userNotFound
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  user.discordIdentity = undefined;
  user.name = "anonymous";
  user.riichiCityIdentity = undefined;
  user.majsoulIdentity = undefined;
  user.tenhouIdentity = undefined;
  await user.save();

  await itr.reply({
    content: localize(
      itr.locale,
      strings.commands.myinfo.delete.reply.successMessage
    ),
    flags: MessageFlags.Ephemeral,
  });
}
