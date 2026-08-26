import { basePath, coreConfig } from "config";
import { UserModel } from "~/core/models/shared/User";
import { sendDirectMessage } from "./discordPublisher.server";
import { effectiveReviewAuthor } from "./replayReview.server";
import { trackError } from "./telemetry.server";

interface ReviewNotificationEdit {
  author?: unknown;
}

interface ReviewNotificationDocument {
  shortId: string;
  sourceGameId: string;
  createdBy: unknown;
  seat?: number | null;
  edits: ReviewNotificationEdit[];
}

interface ReviewNotificationUser {
  _id: unknown;
  discordIdentity?: { id?: string };
}

export interface NotifyReviewContributorsInput {
  review: ReviewNotificationDocument;
  publisherId: string;
  publisherName?: string;
  eventIndex: number;
}

function buildReviewUrl(
  review: ReviewNotificationDocument,
  eventIndex: number
): string {
  const normalizedBasePath = basePath
    ? `/${basePath.replace(/^\/+|\/+$/g, "")}`
    : "";
  const url = new URL(
    `${normalizedBasePath}/watch/replay/${encodeURIComponent(review.sourceGameId)}`,
    `${coreConfig.APP_BASE_URL.replace(/\/$/, "")}/`
  );
  if (typeof review.seat === "number") {
    url.searchParams.set("seat", String(review.seat));
  }
  url.searchParams.set("event", String(eventIndex));
  url.searchParams.set("review", review.shortId);
  return url.toString();
}

export async function notifyReviewContributors({
  review,
  publisherId,
  publisherName,
  eventIndex,
}: NotifyReviewContributorsInput): Promise<void> {
  const recipientUserIds = new Set<string>();
  for (const edit of review.edits) {
    const authorId = effectiveReviewAuthor(edit, review.createdBy);
    if (authorId !== publisherId) {
      recipientUserIds.add(authorId);
    }
  }
  if (recipientUserIds.size === 0) {
    return;
  }

  try {
    const users = await UserModel.find({
      _id: { $in: [...recipientUserIds] },
    })
      .select("_id discordIdentity.id")
      .lean<ReviewNotificationUser[]>();

    const reviewUrl = buildReviewUrl(review, eventIndex);
    const displayName = publisherName?.trim() || "A reviewer";
    const content = `${displayName} published new annotations on a replay you commented on:\n${reviewUrl}`;
    const sentDiscordIds = new Set<string>();

    await Promise.all(
      users.map(async (user) => {
        const discordUserId = user.discordIdentity?.id;
        if (!discordUserId || sentDiscordIds.has(discordUserId)) {
          return;
        }
        sentDiscordIds.add(discordUserId);
        try {
          await sendDirectMessage(discordUserId, content);
        } catch (error) {
          console.error(
            `[replay-review] failed to notify contributor ${String(user._id)} for review ${review.shortId}:`,
            error
          );
          trackError(error, {
            source: "replayReviewNotification",
            reviewShortId: review.shortId,
            recipientUserId: String(user._id),
          });
        }
      })
    );
  } catch (error) {
    console.error(
      `[replay-review] failed to resolve notifications for review ${review.shortId}:`,
      error
    );
    trackError(error, {
      source: "replayReviewNotification",
      reviewShortId: review.shortId,
    });
  }
}
