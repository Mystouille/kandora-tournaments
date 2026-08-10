import { useEffect, useMemo, useState } from "react";
import { useFetcher, useNavigate } from "react-router";
import { Alert, Button, Card, Input, Space, Typography } from "antd";
import { CheckCircleFilled, EyeOutlined } from "@ant-design/icons";
import { NagaExportSection } from "~/components/NagaExportSection";
import { PageTitle } from "~/components/PageTitle";
import { useLocale } from "~/contexts/LocaleContext";
import { inferReplaySource } from "~/game/replay/inferSource";
import {
  extractRiichiCityWind,
  normalizeReplayId,
} from "~/game/replay/normalizeReplayId";
import type { ReplaySource } from "~/game/replay/types";

export function meta() {
  return [
    { title: "Review - TNT Mahjong" },
    {
      name: "description",
      content:
        "Import and review a Tenhou, Mahjong Soul, or Riichi City replay",
    },
  ];
}

/**
 * `POST /review` — fetch + persist a replay log on demand.
 *
 * Mirrors the `cache-miss → fetchOrphanReplayLog` branch of the
 * `/replays/:gameId` loader, but exposed as an explicit user action
 * from the Review page so the user gets a clear loading state and
 * error feedback before being routed into the viewer.
 *
 * Returns:
 *   - `{ ok: true, gameId, source }` — the replay is in the DB and
 *     `/replays/:gameId` will resolve.
 *   - `{ ok: false, error }` — invalid id shape or platform fetch
 *     failure.
 */
export async function action({ request }: { request: Request }) {
  const startedAt = Date.now();
  const { trackEvent } = await import("~/services/telemetry.server");
  const sessionId = request.headers.get("X-Telemetry-Session") ?? undefined;
  const form = await request.formData();
  const raw = String(form.get("gameId") ?? "").trim();
  if (!raw) {
    trackEvent({
      type: "replay_review_import",
      statusCode: 400,
      sessionId,
      meta: { outcome: "missing-id" },
    });
    return Response.json({ ok: false, error: "missing" }, { status: 400 });
  }
  // Strip Tenhou share URLs, Majsoul `_a<n>`, and Riichi City `@<n>`
  // viewer suffixes so the user can paste a share link verbatim.
  const gameId = normalizeReplayId(raw);
  const source = inferReplaySource(gameId);
  if (!source) {
    trackEvent({
      type: "replay_review_import",
      statusCode: 400,
      sessionId,
      meta: { outcome: "unrecognized", gameId },
    });
    return Response.json({ ok: false, error: "unrecognized" }, { status: 400 });
  }
  // Lazy-load server-only modules so the client bundle stays clean.
  const [{ ReplayLogModel }, { connectToDatabase }, { fetchOrphanReplayLog }] =
    await Promise.all([
      import("~/db/models/ReplayLog"),
      import("~/utils/dbConnection.server"),
      import("~/services/fetchOrphanReplayLog.server"),
    ]);
  await connectToDatabase();
  const existing = await ReplayLogModel.findOne({
    source,
    sourceGameId: gameId,
  })
    .select({ _id: 1 })
    .lean()
    .exec();
  if (existing) {
    trackEvent({
      type: "replay_review_import",
      statusCode: 200,
      durationMs: Date.now() - startedAt,
      sessionId,
      meta: { outcome: "cache-hit", source, gameId },
    });
    return Response.json({ ok: true, gameId, source });
  }
  let fetched;
  try {
    fetched = await fetchOrphanReplayLog(source, gameId);
  } catch (error) {
    console.error(
      `[review] connector fetch failed for ${source}/${gameId}`,
      error
    );
    const message = error instanceof Error ? error.message : String(error);
    trackEvent({
      type: "replay_review_import",
      statusCode: 502,
      durationMs: Date.now() - startedAt,
      sessionId,
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
      meta: { outcome: "fetch-failed", source, gameId },
    });
    return Response.json(
      { ok: false, error: "fetch-failed", detail: message },
      { status: 502 }
    );
  }
  if (!fetched) {
    trackEvent({
      type: "replay_review_import",
      statusCode: 404,
      durationMs: Date.now() - startedAt,
      sessionId,
      meta: { outcome: "not-found", source, gameId },
    });
    return Response.json({ ok: false, error: "not-found" }, { status: 404 });
  }
  trackEvent({
    type: "replay_review_import",
    statusCode: 200,
    durationMs: Date.now() - startedAt,
    sessionId,
    meta: { outcome: "fetched", source, gameId },
  });
  return Response.json({ ok: true, gameId, source });
}

type ImportResponse =
  | { ok: true; gameId: string; source: ReplaySource }
  | {
      ok: false;
      error: "missing" | "unrecognized" | "not-found" | "fetch-failed";
      detail?: string;
    };

const SOURCE_LABEL: Record<ReplaySource, string> = {
  tenhou: "Tenhou",
  majsoul: "Mahjong Soul",
  riichicity: "Riichi City",
  ingame: "Kandora",
};

export default function ReviewRoute() {
  const { t } = useLocale();
  const fetcher = useFetcher<ImportResponse>();
  const navigate = useNavigate();
  const [gameId, setGameId] = useState("");

  // Strip the same viewer-suffixes / share-URLs client-side so the
  // recognition checkmark matches what the server will look up.
  const cleanedId = useMemo(() => normalizeReplayId(gameId), [gameId]);
  // Riichi City share links carry the sharer's round-1 wind
  // position as an `@<n>` suffix that `normalizeReplayId` strips.
  // Capture it so we can re-attach it when forwarding the user to
  // the viewer; the loader resolves the value to an absolute seat
  // using the parsed log's round-1 dealer.
  const rcWind = useMemo(() => extractRiichiCityWind(gameId), [gameId]);

  const detectedSource = useMemo<ReplaySource | null>(() => {
    if (!cleanedId) {
      return null;
    }
    return inferReplaySource(cleanedId);
  }, [cleanedId]);

  const isSubmitting = fetcher.state !== "idle";
  const result = fetcher.data;
  const succeeded = result?.ok === true;

  // Auto-navigate to the replay viewer once the import succeeds.
  //
  // We intentionally wait for `fetcher.state === "idle"` before
  // calling `navigate()`. A successful action triggers an automatic
  // revalidation of all active loaders (root, etc.); React Router's
  // state machine considers the fetcher "loading" until that
  // revalidation settles. If we fire `navigate()` mid-revalidation
  // the navigation can race with the in-flight revalidation: the new
  // route's loader fetch is silently dropped and React renders an
  // empty body. The symptom is a black screen on `/replays/:gameId`
  // that only goes away with a hard refresh.
  //
  // We re-attach the Riichi City `@<n>` suffix instead of forwarding
  // the value directly as `?seat=`: the index is a round-1 wind
  // position (0=E, 1=S, 2=W, 3=N), not an absolute seat, and the
  // `/replays/:gameId` loader has the parsed log on hand to do the
  // wind→seat translation.
  useEffect(() => {
    if (result?.ok && fetcher.state === "idle") {
      const suffix = rcWind !== null ? `@${rcWind}` : "";
      navigate(`/replays/${result.gameId}${suffix}`);
    }
  }, [result, fetcher.state, navigate, rcWind]);

  const canSubmit = detectedSource !== null && !isSubmitting && !succeeded;

  const onSubmit = () => {
    if (!canSubmit) {
      return;
    }
    const fd = new FormData();
    fd.set("gameId", cleanedId);
    fetcher.submit(fd, { method: "post" });
  };

  let errorMessage: string | null = null;
  if (result && !result.ok) {
    if (result.error === "unrecognized") {
      errorMessage = t.review.errorUnrecognized;
    } else if (result.error === "not-found") {
      errorMessage = t.review.errorNotFound;
    } else if (result.error === "fetch-failed") {
      errorMessage = result.detail
        ? `${t.review.errorGeneric} (${result.detail})`
        : t.review.errorGeneric;
    } else {
      errorMessage = t.review.errorGeneric;
    }
  }

  return (
    <div style={{ width: "100%", minHeight: "100%" }}>
      <PageTitle title={t.review.title} subtitle={t.review.subtitle} />
      <Card
        style={{ maxWidth: 720, margin: "0 auto" }}
        title={t.review.manualReviewTitle}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Typography.Text>{t.review.description}</Typography.Text>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "stretch",
              flexWrap: "wrap",
            }}
          >
            <Input
              placeholder={t.review.placeholder}
              value={gameId}
              onChange={(e) => setGameId(e.target.value)}
              onPressEnter={onSubmit}
              disabled={isSubmitting || succeeded}
              style={{ flex: "1 1 240px", minWidth: 240 }}
              size="large"
              autoFocus
            />
            <Button
              type="primary"
              size="large"
              loading={isSubmitting}
              icon={<EyeOutlined />}
              onClick={onSubmit}
              disabled={!canSubmit && !succeeded}
            >
              {t.review.openReplay}
            </Button>
          </div>

          {detectedSource && !errorMessage && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                color: "#52c41a",
              }}
            >
              <CheckCircleFilled />
              <span>
                {t.review.recognized.replace(
                  "{platform}",
                  SOURCE_LABEL[detectedSource]
                )}
              </span>
            </div>
          )}

          {!detectedSource && cleanedId && !errorMessage && (
            <Typography.Text type="secondary">
              {t.review.notRecognizedHint}
            </Typography.Text>
          )}

          {errorMessage && (
            <Alert type="error" showIcon message={errorMessage} closable />
          )}
        </Space>
      </Card>
      <NagaExportSection />
    </div>
  );
}
