import { useEffect, useState } from "react";
import { Spin } from "antd";
import { useNavigate } from "react-router";
import type { Route } from "./+types/admin.online-tournaments.new";
import { LeagueForm } from "../components/LeagueForm";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";
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
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch(`${basePath}/api/auth/me`)
      .then((res) => res.json())
      .then((data) => {
        if (!data?.user?.isAdmin) {
          navigate("/");
        } else {
          setIsAdmin(true);
        }
      })
      .catch(() => navigate("/"))
      .finally(() => setLoading(false));
  }, [navigate]);

  if (loading || !isAdmin) {
    return (
      <div style={{ textAlign: "center", padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <h1>{t.onlineTournaments.admin.createNew}</h1>
      <LeagueForm
        botFriendIds={loaderData.botFriendIds}
        onSuccess={() => {
          navigate("/");
        }}
      />
    </div>
  );
}
