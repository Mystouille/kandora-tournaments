import { useNavigate } from "react-router";
import type { Route } from "./+types/admin.online-tournaments.new";
import { LeagueForm } from "../components/LeagueForm";
import { PageTitle } from "../components/PageTitle";
import { useLocale } from "../contexts/LocaleContext";
import { requireAdmin } from "../utils/jwt.server";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  return {
    botFriendIds: {
      majsoul: process.env.MAJSOUL_FRIENDID ?? "",
      riichiCity: process.env.RIICHICITY_FRIENDID ?? "",
    },
  };
}

export function meta() {
  return [
    { title: "New Online Tournament - TNT Paris Mahjong" },
    {
      name: "description",
      content: "Create a new online tournament / league",
    },
  ];
}

export default function AdminNewOnlineTournamentPage({
  loaderData,
}: Route.ComponentProps) {
  const { t } = useLocale();
  const navigate = useNavigate();

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <PageTitle title={t.onlineTournaments.admin.createNew} />
      <LeagueForm
        botFriendIds={loaderData.botFriendIds}
        onSuccess={() => {
          navigate("/admin");
        }}
      />
    </div>
  );
}
