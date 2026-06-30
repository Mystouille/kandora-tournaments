import { useEffect, useState } from "react";
import {
  Avatar,
  Button,
  Card,
  Modal,
  Select,
  Spin,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import {
  CheckCircleOutlined,
  ImportOutlined,
  PlusCircleOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { basePath } from "../../utils/basePath";
import { useLocale } from "../../contexts/LocaleContext";
import {
  type ImportResult,
  type DiscordMemberOption,
  formatString,
  compositeDisplayName,
  getPlatformLabel,
} from "./shared";

const { Text } = Typography;

interface MemberPreview {
  accountId: number;
  nickname: string;
  existingUser: {
    _id: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    avatarUrl: string | null;
    discordId: string | null;
    discordAvatarUrl: string | null;
    isOnServer: boolean | null;
  } | null;
}

interface TeamPreview {
  name: string;
  members: MemberPreview[];
}

interface ImportPreview {
  leagueId: string;
  leagueName: string;
  platform: string;
  discordServerId: string | null;
  teams: TeamPreview[];
}

type DiscordOverrides = Record<string, DiscordMemberOption>;

interface PlatformImportProps {
  id: string;
  onResult: (result: ImportResult) => void;
  onReset: () => void;
}

export function PlatformImport({ id, onResult, onReset }: PlatformImportProps) {
  const { t } = useLocale();
  const tt = t.onlineTournaments.admin;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [discordOverrides, setDiscordOverrides] = useState<DiscordOverrides>(
    {}
  );
  const [allDiscordMembers, setAllDiscordMembers] = useState<
    DiscordMemberOption[]
  >([]);
  const [discordMembersLoading, setDiscordMembersLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchPreview() {
      try {
        const res = await fetch(
          `${basePath}/api/admin/league-team-import?leagueId=${encodeURIComponent(id)}`
        );
        const data = await res.json();

        if (cancelled) {
          return;
        }

        if (!res.ok) {
          setError(data.error || tt.importFetchError);
          return;
        }

        setPreview(data);

        if (data.discordServerId) {
          setDiscordMembersLoading(true);
          try {
            const membersRes = await fetch(
              `${basePath}/api/admin/discord-server-members?serverId=${encodeURIComponent(data.discordServerId)}`
            );
            if (membersRes.ok) {
              const membersData = await membersRes.json();
              if (!cancelled) {
                setAllDiscordMembers(membersData.members ?? []);
              }
            }
          } catch {
            // ignore
          } finally {
            if (!cancelled) {
              setDiscordMembersLoading(false);
            }
          }
        }
      } catch {
        if (!cancelled) {
          setError(tt.importConnectError);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchPreview();

    return () => {
      cancelled = true;
    };
  }, [id, tt.importFetchError, tt.importConnectError]);

  const handleDiscordSelect = (accountId: number, discordId: string) => {
    const member = allDiscordMembers.find((m) => m.discordId === discordId);
    if (member) {
      setDiscordOverrides((prev) => ({
        ...prev,
        [accountId.toString()]: member,
      }));
    }
  };

  const handleDiscordClear = (accountId: number) => {
    setDiscordOverrides((prev) => {
      const next = { ...prev };
      delete next[accountId.toString()];
      return next;
    });
  };

  const handleConfirm = () => {
    if (!preview) {
      return;
    }

    const newUsersCount = preview.teams
      .flatMap((team) => team.members)
      .filter((m) => !m.existingUser).length;

    Modal.confirm({
      title: tt.importConfirmTitle,
      content: (
        <div>
          <p>
            {formatString(tt.importConfirmBody, {
              count: preview.teams.length,
            })}
          </p>
          {newUsersCount > 0 && (
            <p>
              <Tag color="blue" icon={<PlusCircleOutlined />}>
                {formatString(tt.importConfirmNewUsers, {
                  count: newUsersCount,
                })}
              </Tag>
            </p>
          )}
          {Object.keys(discordOverrides).length > 0 && (
            <p>
              <Tag color="purple">
                {formatString(tt.importConfirmDiscordLinks, {
                  count: Object.keys(discordOverrides).length,
                })}
              </Tag>
            </p>
          )}
          <p>{tt.importConfirmQuestion}</p>
        </div>
      ),
      okText: tt.importConfirmOk,
      cancelText: t.common.cancel,
      onOk: async () => {
        setConfirming(true);
        try {
          const res = await fetch(`${basePath}/api/admin/league-team-import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              leagueId: id,
              discordOverrides:
                Object.keys(discordOverrides).length > 0
                  ? discordOverrides
                  : undefined,
            }),
          });
          const data = await res.json();

          if (!res.ok) {
            message.error(data.error || tt.importFailed);
            return;
          }

          onResult(data);
          message.success(
            formatString(tt.importSuccess, {
              teams: data.teamsProcessed,
              users: data.usersCreated,
            })
          );
        } catch {
          message.error(tt.importConfirmFailed);
        } finally {
          setConfirming(false);
        }
      },
    });
  };

  const renderMemberRow = (member: MemberPreview) => {
    const accountIdStr = member.accountId.toString();
    const override = discordOverrides[accountIdStr];
    const hasDiscord = !!member.existingUser?.discordId || !!override;
    const isOnServer = member.existingUser?.isOnServer;
    const showWarning =
      member.existingUser?.discordId && isOnServer === false && !override;
    const showDropdown =
      !member.existingUser?.discordId && !override && preview?.discordServerId;

    const discordAvatarUrl =
      override?.avatarUrl ?? member.existingUser?.discordAvatarUrl ?? null;

    return (
      <div
        key={member.accountId}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "6px 0",
          borderBottom: "1px solid #f0f0f0",
          flexWrap: "wrap",
        }}
      >
        <div style={{ minWidth: 50, textAlign: "center", flexShrink: 0 }}>
          {member.existingUser ? (
            <CheckCircleOutlined style={{ color: "#52c41a", fontSize: 16 }} />
          ) : (
            <Tag
              color="blue"
              style={{
                margin: 0,
                fontSize: 11,
                padding: "0 4px",
                lineHeight: "18px",
                whiteSpace: "nowrap",
              }}
            >
              {tt.importNewTag}
            </Tag>
          )}
        </div>

        <Text strong style={{ minWidth: 120, flexShrink: 0 }}>
          {member.nickname}
        </Text>

        <Text
          type="secondary"
          style={{ fontSize: 12, minWidth: 100, flexShrink: 0 }}
        >
          {member.accountId}
        </Text>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flex: 1,
            minWidth: 0,
          }}
        >
          {hasDiscord && discordAvatarUrl && (
            <Avatar src={discordAvatarUrl} size="small" />
          )}
          {hasDiscord && !discordAvatarUrl && (
            <Avatar icon={<UserOutlined />} size="small" />
          )}
          {override && (
            <Tag
              color="purple"
              closable
              onClose={() => handleDiscordClear(member.accountId)}
              style={{ margin: 0 }}
            >
              {override.displayName}
            </Tag>
          )}
          {showWarning && (
            <Tooltip title={tt.importDiscordNotOnServer}>
              <WarningOutlined style={{ color: "#faad14", fontSize: 16 }} />
            </Tooltip>
          )}
          {showDropdown && (
            <Select
              showSearch
              allowClear
              placeholder={tt.importDiscordSearch}
              style={{ width: 200 }}
              loading={discordMembersLoading}
              filterOption={(input, option) => {
                const m = allDiscordMembers.find(
                  (dm) => dm.discordId === option?.value
                );
                if (!m) {
                  return false;
                }
                const lower = input.toLowerCase();
                return (
                  m.displayName.toLowerCase().includes(lower) ||
                  m.username.toLowerCase().includes(lower)
                );
              }}
              onSelect={(value: string) =>
                handleDiscordSelect(member.accountId, value)
              }
              options={allDiscordMembers.map((m) => ({
                value: m.discordId,
                label: (
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <Avatar
                      src={m.avatarUrl}
                      size={20}
                      icon={<UserOutlined />}
                    />
                    {m.displayName}
                    <Text
                      type="secondary"
                      style={{ fontSize: 11, marginLeft: "auto" }}
                    >
                      @{m.username}
                    </Text>
                  </span>
                ),
              }))}
            />
          )}
        </div>

        {member.existingUser && (
          <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
            {compositeDisplayName(member.existingUser)}
          </Text>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 48 }}>
        <Spin size="large" />
        <div style={{ marginTop: 16 }}>
          <Text type="secondary">{tt.importFetching}</Text>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ textAlign: "center", padding: 24 }}>
        <Text type="danger">{error}</Text>
        <div style={{ marginTop: 16 }}>
          <Button onClick={onReset}>{t.common.cancel}</Button>
        </div>
      </div>
    );
  }

  if (!preview) {
    return null;
  }

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <Text>
          {tt.importLeagueLabel} <strong>{preview.leagueName}</strong>
        </Text>
        <Tag style={{ marginLeft: 8 }}>
          {getPlatformLabel(preview.platform)}
        </Tag>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {preview.teams.map((team) => (
          <Card key={team.name} title={team.name} size="small" type="inner">
            {team.members.map(renderMemberRow)}
          </Card>
        ))}
      </div>

      <div
        style={{
          marginTop: 24,
          display: "flex",
          gap: 12,
          justifyContent: "flex-end",
        }}
      >
        <Button onClick={onReset}>{t.common.cancel}</Button>
        <Button
          type="primary"
          icon={<ImportOutlined />}
          loading={confirming}
          onClick={handleConfirm}
        >
          {tt.importConfirmOk}
        </Button>
      </div>
    </>
  );
}
