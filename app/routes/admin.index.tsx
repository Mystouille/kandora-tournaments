import { Button, Empty, List, Space, Tag, Typography } from "antd";
import {
  CalendarOutlined,
  PlusOutlined,
  SettingOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { Link, useOutletContext } from "react-router";
import { PageTitle } from "../components/PageTitle";
import { useLocale } from "../contexts/LocaleContext";
import type { TournamentAdminAccess } from "../utils/league-permissions.server";

type TournamentStatus = "upcoming" | "ongoing" | "finished";

function getStatus(startTime: string, endTime: string): TournamentStatus {
  const now = Date.now();
  if (now < new Date(startTime).getTime()) {
    return "upcoming";
  }
  if (now > new Date(endTime).getTime()) {
    return "finished";
  }
  return "ongoing";
}

export function meta() {
  return [{ title: "Administration - Kandora Tournaments" }];
}

export default function AdminIndexPage() {
  const { t, locale } = useLocale();
  const access = useOutletContext<TournamentAdminAccess>();
  const statusMeta = {
    upcoming: {
      color: "blue",
      label: t.onlineTournaments.statusUpcoming,
    },
    ongoing: {
      color: "green",
      label: t.onlineTournaments.statusOngoing,
    },
    finished: {
      color: "default",
      label: t.onlineTournaments.statusFinished,
    },
  } satisfies Record<TournamentStatus, { color: string; label: string }>;
  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";

  return (
    <div style={{ width: "100%", minHeight: "100%" }}>
      <PageTitle title={t.admin.title} />

      {access.isGlobalAdmin && (
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <Link to="/admin/online-tournaments/new">
            <Button type="primary" icon={<PlusOutlined />}>
              {t.onlineTournaments.admin.createNew}
            </Button>
          </Link>
        </div>
      )}

      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <Typography.Title level={3}>
          {t.admin.managedTournaments}
        </Typography.Title>
        {access.tournaments.length === 0 ? (
          <Empty description={t.admin.noManagedTournaments} />
        ) : (
          <List
            bordered
            dataSource={access.tournaments}
            renderItem={(tournament) => {
              const status =
                statusMeta[getStatus(tournament.startTime, tournament.endTime)];
              return (
                <List.Item
                  actions={[
                    <Link
                      key={tournament.id}
                      to={`/admin/online-tournaments/${tournament.id}`}
                    >
                      <Button type="link" icon={<SettingOutlined />}>
                        {t.admin.manage}
                      </Button>
                    </Link>,
                  ]}
                >
                  <List.Item.Meta
                    avatar={<TrophyOutlined style={{ fontSize: 20 }} />}
                    title={tournament.name}
                    description={
                      <Space size="small" wrap>
                        <Tag color={status.color}>{status.label}</Tag>
                        <Typography.Text type="secondary">
                          <CalendarOutlined />{" "}
                          {new Date(tournament.startTime).toLocaleDateString(
                            dateLocale
                          )}
                        </Typography.Text>
                        <Tag>{tournament.platformName}</Tag>
                      </Space>
                    }
                  />
                </List.Item>
              );
            }}
          />
        )}
      </div>
    </div>
  );
}
