import { redirect } from "react-router";
import { Empty } from "antd";
import { isbot } from "isbot";
import { PageTitle } from "~/components/PageTitle";
import { MyReplaysTable } from "~/components/my-replays/MyReplaysTable";
import { useLocale } from "~/contexts/LocaleContext";
import { getMyReplaysApiResponse } from "~/services/myReplaysApi.server";
import type { MyReplayGroup } from "~/types/myReplays";
import { basePath } from "~/utils/basePath";
import {
  authSignInPath,
  localReturnPathFromRequest,
} from "~/utils/gameReturnPath";
import { getAuthenticatedPrincipal } from "~/utils/requestAuth.server";

const META_TITLE = "My Replays | TNT Paris Mahjong";
const META_DESCRIPTION =
  "Find your mahjong replay logs and collaborative reviews across Kandora, Tenhou, Mahjong Soul, and Riichi City.";

interface MyReplaysLoaderData {
  groups: MyReplayGroup[];
  canonicalUrl: string;
  imageUrl: string;
  previewOnly: boolean;
}

function publicOrigin(request: Request): string {
  const forwardedProto = request.headers.get("X-Forwarded-Proto");
  const forwardedHost =
    request.headers.get("X-Forwarded-Host") ?? request.headers.get("Host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

function metadataForRequest(request: Request) {
  const origin = publicOrigin(request);
  return {
    canonicalUrl: `${origin}${basePath}/my-replays`,
    imageUrl: `${origin}${basePath}/banner/TNT_logo-WHITE.png`,
  };
}

export function meta({ data }: { data?: MyReplaysLoaderData }) {
  const canonicalUrl = data?.canonicalUrl;
  const imageUrl = data?.imageUrl;
  return [
    { title: META_TITLE },
    { name: "description", content: META_DESCRIPTION },
    { name: "robots", content: "noindex, nofollow" },
    { property: "og:title", content: META_TITLE },
    { property: "og:description", content: META_DESCRIPTION },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "TNT Paris Mahjong" },
    ...(canonicalUrl ? [{ property: "og:url", content: canonicalUrl }] : []),
    ...(imageUrl
      ? [
          { property: "og:image", content: imageUrl },
          { property: "og:image:width", content: "306" },
          { property: "og:image:height", content: "306" },
          {
            property: "og:image:alt",
            content: "TNT Paris Mahjong logo",
          },
        ]
      : []),
    { name: "twitter:card", content: "summary" },
    { name: "twitter:title", content: META_TITLE },
    { name: "twitter:description", content: META_DESCRIPTION },
    ...(imageUrl ? [{ name: "twitter:image", content: imageUrl }] : []),
  ];
}

export async function loader({
  request,
}: {
  request: Request;
}): Promise<MyReplaysLoaderData> {
  const metadata = metadataForRequest(request);
  const userAgent = request.headers.get("User-Agent");
  if (userAgent && isbot(userAgent)) {
    return { groups: [], ...metadata, previewOnly: true };
  }

  const principal = await getAuthenticatedPrincipal(request, {
    transport: "web-cookie",
  });
  if (principal === null) {
    throw redirect(
      authSignInPath(localReturnPathFromRequest(request, basePath))
    );
  }
  const response = await getMyReplaysApiResponse(principal.userId);
  if (response === null) {
    throw new Response("Authenticated user no longer exists.", {
      status: 401,
    });
  }
  return { groups: response.replays, ...metadata, previewOnly: false };
}

export default function MyReplaysRoute({
  loaderData,
}: {
  loaderData: MyReplaysLoaderData;
}) {
  const { t } = useLocale();
  return (
    <div style={{ width: "100%", minHeight: "100%" }}>
      <PageTitle title={t.myReplays.title} subtitle={t.myReplays.subtitle} />
      <div style={{ padding: "0 24px 32px", maxWidth: 1440, margin: "0 auto" }}>
        {loaderData.groups.length === 0 ? (
          <Empty description={t.myReplays.empty} />
        ) : (
          <MyReplaysTable groups={loaderData.groups} />
        )}
      </div>
    </div>
  );
}
