import type { ReplaySource } from "~/game/replay/types";

export interface SerializedReviewEdit {
  eventIndex: number;
  author: string;
  authorName: string;
  colorIndex: number;
  text: string;
  drawingBase64: string | null;
  updatedAt: string;
}

export interface SerializedReviewer {
  user: string;
  name: string;
}

export interface SerializedReviewTarget {
  name: string;
}

export interface SerializedReview {
  shortId: string;
  source: ReplaySource;
  sourceGameId: string;
  createdBy: string;
  seat: number | null;
  target?: SerializedReviewTarget;
  reviewers: SerializedReviewer[];
  edits: SerializedReviewEdit[];
}
