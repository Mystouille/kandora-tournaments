import { useState, type ReactNode } from "react";
import {
  Alert,
  Button,
  Input,
  List,
  Modal,
  Result,
  Typography,
  message,
} from "antd";
import {
  CalendarOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  ImportOutlined,
  PictureOutlined,
  TeamOutlined,
  TrophyOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Link,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router";
import type { Route } from "./+types/admin.online-tournaments.$id";
import { PageTitle } from "../components/PageTitle";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";
import {
  requireLeagueAdminOrRedirect,
  type TournamentAdminAccess,
} from "../utils/league-permissions.server";

interface AdminDestination {
  key: string;
  label: string;
  href: string;
  icon: ReactNode;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireLeagueAdminOrRedirect(request, params.id!);
  return null;
}

export function meta() {
  return [{ title: "Manage Tournament - Kandora Tournaments" }];
}

function DestinationList({ items }: { items: AdminDestination[] }) {
  return (
    <List
      bordered
      dataSource={items}
      renderItem={(item) => (
        <List.Item
          actions={[
            <Link key={item.key} to={item.href}>
              <Button type="link">{item.label}</Button>
            </Link>,
          ]}
        >
          <Typography.Text strong>
            {item.icon}
            <span style={{ marginLeft: 8 }}>{item.label}</span>
          </Typography.Text>
        </List.Item>
      )}
    />
  );
}

export default function AdminTournamentPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const navigate = useNavigate();
  const access = useOutletContext<TournamentAdminAccess>();
  const [savingRcTables, setSavingRcTables] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const tournament = access.tournaments.find((item) => item.id === id);

  if (!tournament) {
    return <Result status="404" title="404" />;
  }

  const routeBase = `/admin/online-tournaments/${tournament.id}`;
  const tournamentItems: AdminDestination[] = [
    {
      key: "presentation",
      label: t.onlineTournaments.admin.editPresentation,
      href: `${routeBase}/edit-presentation`,
      icon: <EditOutlined />,
    },
    ...(tournament.hasSchedule
      ? [
          {
            key: "schedule",
            label: t.onlineTournaments.admin.setSchedule,
            href: `${routeBase}/set-schedule`,
            icon: <CalendarOutlined />,
          },
        ]
      : []),
  ];
  const participantItems: AdminDestination[] = [
    {
      key: "import-roster",
      label: t.onlineTournaments.admin.importRoster,
      href: `${routeBase}/import-teams`,
      icon: <ImportOutlined />,
    },
    {
      key: "edit-roster",
      label: t.onlineTournaments.admin.editRoster,
      href: `${routeBase}/edit-roster`,
      icon: <TeamOutlined />,
    },
    ...(tournament.isTeamMode
      ? [
          {
            key: "team-pictures",
            label: t.onlineTournaments.admin.editTeamPictures,
            href: `${routeBase}/edit-team-pictures`,
            icon: <PictureOutlined />,
          },
        ]
      : []),
    {
      key: "player-pictures",
      label: t.onlineTournaments.admin.editPlayerPictures,
      href: `${routeBase}/edit-player-pictures`,
      icon: <UserOutlined />,
    },
    ...(tournament.isTeamMode
      ? [
          {
            key: "finals-roster",
            label: t.onlineTournaments.admin.editFinalsRoster,
            href: `${routeBase}/edit-finals-roster`,
            icon: <TrophyOutlined />,
          },
        ]
      : []),
  ];

  const handleSaveRcTables = () => {
    Modal.confirm({
      title: t.onlineTournaments.admin.saveRcTablesConfirmTitle,
      content: t.onlineTournaments.admin.saveRcTablesConfirmBody,
      okText: t.onlineTournaments.admin.saveRcTables,
      cancelText: t.common.cancel,
      onOk: async () => {
        setSavingRcTables(true);
        try {
          const response = await fetch(
            `${basePath}/api/admin/league-save-rc-tables`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ leagueId: tournament.id }),
            }
          );
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            message.error(
              typeof data?.error === "string"
                ? data.error
                : t.onlineTournaments.admin.saveRcTablesError
            );
            return;
          }
          const rounds = Number(data?.totalRoundsSaved ?? 0);
          const stages = Array.isArray(data?.stagesProcessed)
            ? data.stagesProcessed.length
            : 0;
          const tables = Number(data?.totalTablesSaved ?? 0);
          if (rounds === 0) {
            message.info(t.onlineTournaments.admin.saveRcTablesNoStages);
            return;
          }
          message.success(
            t.onlineTournaments.admin.saveRcTablesSuccess
              .replace("{rounds}", String(rounds))
              .replace("{stages}", String(stages))
              .replace("{tables}", String(tables))
          );
        } catch {
          message.error(t.onlineTournaments.admin.saveRcTablesError);
        } finally {
          setSavingRcTables(false);
        }
      },
    });
  };

  const closeDeleteModal = () => {
    if (deleting) {
      return;
    }
    setDeleteModalOpen(false);
    setDeleteConfirmation("");
  };

  const handleDeleteTournament = async () => {
    if (deleteConfirmation !== tournament.name) {
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(`${basePath}/api/admin/league-delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: tournament.id,
          confirmationName: deleteConfirmation,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        message.error(t.onlineTournaments.admin.deleteTournamentError);
        return;
      }

      message.success(
        t.onlineTournaments.admin.deleteTournamentSuccess
          .replace("{games}", String(data.deletedGames ?? 0))
          .replace("{users}", String(data.deletedUsers ?? 0))
          .replace("{preserved}", String(data.preservedGames ?? 0))
      );
      setDeleteModalOpen(false);
      void navigate("/admin");
    } catch {
      message.error(t.onlineTournaments.admin.deleteTournamentError);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div style={{ width: "100%", maxWidth: 880, margin: "0 auto" }}>
      <PageTitle title={t.admin.manageTournament} subtitle={tournament.name} />

      <Typography.Title level={3}>{t.admin.tournament}</Typography.Title>
      <DestinationList items={tournamentItems} />

      <Typography.Title level={3} style={{ marginTop: 32 }}>
        {t.admin.participants}
      </Typography.Title>
      <DestinationList items={participantItems} />

      {tournament.platformName === "RIICHICITY" && (
        <>
          <Typography.Title level={3} style={{ marginTop: 32 }}>
            {t.admin.platform}
          </Typography.Title>
          <List bordered>
            <List.Item
              actions={[
                <Button
                  key="save-rc-tables"
                  icon={<CloudUploadOutlined />}
                  loading={savingRcTables}
                  onClick={handleSaveRcTables}
                >
                  {t.onlineTournaments.admin.saveRcTables}
                </Button>,
              ]}
            >
              <Typography.Text strong>
                <CloudUploadOutlined />
                <span style={{ marginLeft: 8 }}>
                  {t.onlineTournaments.admin.saveRcTables}
                </span>
              </Typography.Text>
            </List.Item>
          </List>
        </>
      )}

      <Typography.Title level={3} style={{ marginTop: 32 }}>
        {t.onlineTournaments.admin.dangerZone}
      </Typography.Title>
      <List bordered>
        <List.Item
          actions={[
            <Button
              key="delete-tournament"
              danger
              icon={<DeleteOutlined />}
              onClick={() => setDeleteModalOpen(true)}
            >
              {t.onlineTournaments.admin.deleteTournament}
            </Button>,
          ]}
        >
          <div>
            <Typography.Text strong type="danger">
              {t.onlineTournaments.admin.deleteTournament}
            </Typography.Text>
            <br />
            <Typography.Text type="secondary">
              {t.onlineTournaments.admin.deleteTournamentDescription}
            </Typography.Text>
          </div>
        </List.Item>
      </List>

      <Modal
        open={deleteModalOpen}
        title={t.onlineTournaments.admin.deleteTournamentModalTitle.replace(
          "{name}",
          tournament.name
        )}
        okText={t.onlineTournaments.admin.deleteTournamentConfirm}
        cancelText={t.common.cancel}
        okButtonProps={{
          danger: true,
          disabled: deleteConfirmation !== tournament.name,
        }}
        confirmLoading={deleting}
        closable={!deleting}
        keyboard={!deleting}
        maskClosable={!deleting}
        onCancel={closeDeleteModal}
        onOk={handleDeleteTournament}
      >
        <Alert
          type="error"
          showIcon
          message={t.onlineTournaments.admin.deleteTournamentIrreversible}
          description={t.onlineTournaments.admin.deleteTournamentWarning}
          style={{ marginBottom: 20 }}
        />
        <Typography.Paragraph>
          {t.onlineTournaments.admin.deleteTournamentNamePrompt}
        </Typography.Paragraph>
        <Typography.Paragraph copyable={{ text: tournament.name }}>
          <Typography.Text code>{tournament.name}</Typography.Text>
        </Typography.Paragraph>
        <Input
          value={deleteConfirmation}
          placeholder={
            t.onlineTournaments.admin.deleteTournamentNamePlaceholder
          }
          disabled={deleting}
          status={
            deleteConfirmation && deleteConfirmation !== tournament.name
              ? "error"
              : undefined
          }
          autoComplete="off"
          onChange={(event) => setDeleteConfirmation(event.target.value)}
          onPressEnter={() => {
            if (deleteConfirmation === tournament.name) {
              void handleDeleteTournament();
            }
          }}
        />
      </Modal>
    </div>
  );
}
