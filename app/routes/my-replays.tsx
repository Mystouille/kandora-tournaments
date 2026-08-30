import { redirect } from "react-router";
import { Empty } from "antd";
import { PageTitle } from "~/components/PageTitle";
import { MyReplaysTable } from "~/components/my-replays/MyReplaysTable";
import { useLocale } from "~/contexts/LocaleContext";
import { getMyReplays } from "~/services/myReplays.server";
import type { MyReplayGroup } from "~/types/myReplays";
import { basePath } from "~/utils/basePath";
import { connectToDatabase } from "~/utils/dbConnection.server";
import {
  authSignInPath,
  localReturnPathFromRequest,
} from "~/utils/gameReturnPath";
import { getAuthenticatedUser } from "~/utils/jwt.server";

export function meta() {
  return [
    { title: "My replays - TNT Mahjong" },
    {
      name: "description",
      content: "Replays and collaborative reviews related to your account",
    },
  ];
}

export async function loader({ request }: { request: Request }) {
  const authenticatedUser = await getAuthenticatedUser(request);
  if (!authenticatedUser) {
    throw redirect(
      authSignInPath(localReturnPathFromRequest(request, basePath))
    );
  }
  await connectToDatabase();
  const groups = await getMyReplays(authenticatedUser.sub);
  if (!groups) {
    throw new Response("Authenticated user no longer exists.", {
      status: 401,
    });
  }
  return { groups };
}

export default function MyReplaysRoute({
  loaderData,
}: {
  loaderData: { groups: MyReplayGroup[] };
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
