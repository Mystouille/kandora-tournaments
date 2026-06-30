import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Table, Spin } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CalendarOutlined,
  PlusOutlined,
  TeamOutlined,
  PlayCircleOutlined,
} from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";
import { PageTitle } from "../components/PageTitle";

interface LeagueSummary {
  _id: string;
  name: string;
  slug: string;
  startTime: string;
  endTime: string;
  playerCount: number;
  gameCount: number;
  rulesConfig: {
    gameRules: string;
    structure: string;
    isTeamMode: boolean;
  };
}

export function meta() {
  return [
    { title: "Online Tournaments - TNT Paris Mahjong" },
    {
      name: "description",
      content: "Browse online mahjong tournaments and leagues",
    },
  ];
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function OnlineTournaments() {
  const { t, locale } = useLocale();
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch(`${basePath}/api/online-tournaments`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to fetch");
        }
        return res.json();
      })
      .then((data) => {
        setLeagues(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });

    fetch(`${basePath}/api/auth/me`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.user?.isAdmin) {
          setIsAdmin(true);
        }
      })
      .catch(() => {});
  }, []);

  const columns: ColumnsType<LeagueSummary> = [
    {
      title: t.onlineTournaments.leagueName,
      dataIndex: "name",
      key: "name",
      render: (name: string, record: LeagueSummary) => (
        <Link to={`/online-tournaments/${record.slug}`}>
          <strong>{name}</strong>
        </Link>
      ),
    },
    {
      title: (
        <span>
          <CalendarOutlined /> {t.onlineTournaments.period}
        </span>
      ),
      key: "period",
      responsive: ["md"],
      render: (_: unknown, record: LeagueSummary) =>
        `${formatDate(record.startTime, locale)} — ${formatDate(record.endTime, locale)}`,
    },
    {
      title: (
        <span>
          <TeamOutlined /> {t.onlineTournaments.playerCount}
        </span>
      ),
      dataIndex: "playerCount",
      key: "playerCount",
      align: "center",
      width: 100,
    },
    {
      title: (
        <span>
          <PlayCircleOutlined /> {t.onlineTournaments.gameCount}
        </span>
      ),
      dataIndex: "gameCount",
      key: "gameCount",
      align: "center",
      width: 100,
    },
  ];

  return (
    <div style={{ width: "100%", minHeight: "100%" }}>
      <PageTitle title={t.onlineTournaments.title} />

      <div style={{ padding: "0 24px", maxWidth: 960, margin: "0 auto" }}>
        {isAdmin && (
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <Link to="/admin/online-tournaments/new">
              <Button type="primary" icon={<PlusOutlined />}>
                {t.onlineTournaments.admin.createNew}
              </Button>
            </Link>
          </div>
        )}
        {loading ? (
          <div style={{ textAlign: "center", padding: 48 }}>
            <Spin size="large" />
          </div>
        ) : (
          <Table
            dataSource={leagues}
            columns={columns}
            rowKey="_id"
            pagination={false}
            locale={{ emptyText: t.onlineTournaments.noLeagues }}
          />
        )}
      </div>
    </div>
  );
}
