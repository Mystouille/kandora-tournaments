import mongoose from "mongoose";
import { MatchModel } from "~/core/models/game/Match";
import { ReplayLogModel } from "~/core/models/game/ReplayLog";
import { UserModel } from "~/core/models/shared/User";
import type { ReplaySource } from "~/game/replay/types";

export interface ResolvedReplayReviewTarget {
  user?: mongoose.Types.ObjectId;
  name: string;
}

interface TargetReplayDocument {
  seats?: Array<{
    seat: number;
    userDbId?: mongoose.Types.ObjectId;
    displayName?: string;
  }>;
}

interface TargetMatchDocument {
  players?: Array<{
    seat: number;
    userId: string;
    displayName?: string;
  }>;
}

interface TargetUserDocument {
  _id: mongoose.Types.ObjectId;
  name: string;
}

const IDENTITY_FIELD_BY_SOURCE: Partial<Record<ReplaySource, string>> = {
  majsoul: "majsoulIdentity.name",
  tenhou: "tenhouIdentity.name",
  riichicity: "riichiCityIdentity.name",
};

function nonEmptyName(value: string | undefined): string | null {
  const name = value?.trim();
  return name ? name : null;
}

function objectId(value: unknown): mongoose.Types.ObjectId | null {
  if (!mongoose.isValidObjectId(value)) {
    return null;
  }
  return new mongoose.Types.ObjectId(String(value));
}

export async function resolveReplayReviewTarget({
  source,
  sourceGameId,
  seat,
}: {
  source: ReplaySource;
  sourceGameId: string;
  seat: number;
}): Promise<ResolvedReplayReviewTarget | null> {
  const replay = await ReplayLogModel.findOne(
    { source, sourceGameId },
    {
      "seats.seat": 1,
      "seats.userDbId": 1,
      "seats.displayName": 1,
    }
  )
    .lean<TargetReplayDocument | null>()
    .exec();
  const replaySeat = replay?.seats?.find(
    (candidate) => candidate.seat === seat
  );
  let linkedUserId = objectId(replaySeat?.userDbId);
  let platformName = nonEmptyName(replaySeat?.displayName);

  if (source === "ingame" && !linkedUserId) {
    const match = await MatchModel.findOne(
      { _id: sourceGameId },
      {
        "players.seat": 1,
        "players.userId": 1,
        "players.displayName": 1,
      }
    )
      .lean<TargetMatchDocument | null>()
      .exec();
    const matchPlayer = match?.players?.find(
      (candidate) => candidate.seat === seat
    );
    linkedUserId = objectId(matchPlayer?.userId);
    platformName ??= nonEmptyName(matchPlayer?.displayName);
  }

  const identityField = IDENTITY_FIELD_BY_SOURCE[source];
  let user: TargetUserDocument | null = null;
  if (linkedUserId) {
    user = await UserModel.findOne(
      { _id: linkedUserId, isDeleted: { $ne: true } },
      { _id: 1, name: 1 }
    )
      .lean<TargetUserDocument | null>()
      .exec();
  } else if (identityField && platformName) {
    const matches = await UserModel.find(
      { [identityField]: platformName, isDeleted: { $ne: true } },
      { _id: 1, name: 1 }
    )
      .limit(2)
      .lean<TargetUserDocument[]>()
      .exec();
    if (matches.length === 1) {
      user = matches[0];
    }
  }
  const userName = nonEmptyName(user?.name);
  if (user && userName) {
    return { user: user._id, name: userName };
  }
  return platformName ? { name: platformName } : null;
}
