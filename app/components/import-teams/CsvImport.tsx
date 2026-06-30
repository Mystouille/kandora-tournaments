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
  CloseCircleOutlined,
  ImportOutlined,
  PlusCircleOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { basePath } from "../../utils/basePath";
import { useLocale } from "../../contexts/LocaleContext";
import {
  type DiscordMemberOption,
  type ImportResult,
  formatString,
  compositeDisplayName,
  getPlatformLabel,
} from "./shared";

const { Text } = Typography;

interface CsvMemberPreview {
  friendId: string;
  nickname: string | null;
  accountId: string | null;
  platformError: boolean;
  noPlatformId: boolean;
  teamName: string;
  csvDisplayName: string;
  discordId: string;
  substitute: boolean;
  discordValid: boolean | null;
  discordAvatarUrl: string | null;
  discordDisplayName: string | null;
  existingUser: {
    _id: string;
    name: string;
    firstName: string | null;
    lastName: string | null;
    discordId: string | null;
  } | null;
}

interface CsvTeamPreview {
  name: string;
  members: CsvMemberPreview[];
}

interface CsvImportPreview {
  leagueId: string;
  leagueName: string;
  platform: string;
  isTeamMode: boolean;
  discordServerId: string | null;
  teams: CsvTeamPreview[];
}

interface CsvImportProps {
  id: string;
  csvText: string;
  onResult: (result: ImportResult) => void;
  onReset: () => void;
}

type DiscordOverrides = Record<string, DiscordMemberOption>;

export function CsvImport({ id, csvText, onResult, onReset }: CsvImportProps) {
  const { t } = useLocale();
  const tt = t.onlineTournaments.admin;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [discordOverrides, setDiscordOverrides] = useState<DiscordOverrides>(
    {}
  );
  const [allDiscordMembers, setAllDiscordMembers] = useState<
    DiscordMemberOption[]
  >([]);
  const [discordMembersLoading, setDiscordMembersLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function validate() {
      try {
        const res = await fetch(`${basePath}/api/admin/league-csv-import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leagueId: id, csv: csvText }),
        });
        const data = await res.json();

        if (cancelled) {
          return;
        }

        if (!res.ok) {
          setError(data.error || tt.importFetchError);
          return;
        }

        setPreview(data);

        // Preload Discord guild members if server is configured
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

    validate();

    return () => {
      cancelled = true;
    };
  }, [id, csvText, tt.importFetchError, tt.importConnectError]);

  const handleDiscordSelect = (friendId: string, discordId: string) => {
    const member = allDiscordMembers.find((m) => m.discordId === discordId);
    if (member) {
      setDiscordOverrides((prev) => ({
        ...prev,
        [friendId]: member,
      }));
    }
  };

  const handleDiscordClear = (friendId: string) => {
    setDiscordOverrides((prev) => {
      const next = { ...prev };
      delete next[friendId];
      return next;
    });
  };

  const handleConfirm = () => {
    if (!preview) {
      return;
    }

    const allMembers = preview.teams.flatMap((team) => team.members);
    const errorCount = allMembers.filter((m) => m.platformError).length;

    if (errorCount > 0) {
      Modal.warning({
        title: tt.importCsvHasErrors,
        content: formatString(tt.importCsvErrorCount, { count: errorCount }),
      });
      return;
    }

    const newUsersCount = allMembers.filter((m) => !m.existingUser).length;

    Modal.confirm({
      title: preview.isTeamMode
        ? tt.importConfirmTitle
        : tt.importConfirmPlayersTitle,
      content: (
        <div>
          <p>
            {preview.isTeamMode
              ? formatString(tt.importConfirmBody, {
                  count: preview.teams.length,
                })
              : formatString(tt.importConfirmPlayersBody, {
                  count: allMembers.length,
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
          <p>{tt.importConfirmQuestion}</p>
        </div>
      ),
      okText: tt.importConfirmOk,
      cancelText: t.common.cancel,
      onOk: async () => {
        setConfirming(true);
        try {
          const res = await fetch(`${basePath}/api/admin/league-csv-import`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              leagueId: id,
              csv: csvText,
              confirm: true,
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
            preview.isTeamMode
              ? formatString(tt.importSuccess, {
                  teams: data.teamsProcessed,
                  users: data.usersCreated,
                })
              : formatString(tt.importPlayersSuccess, {
                  players: data.playersProcessed,
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

  const renderMemberRow = (member: CsvMemberPreview) => {
    const override = discordOverrides[member.friendId];
    const discordNotOnServer = member.discordValid === false && !override;
    const hasError = member.platformError;
    const noPlatformId = member.noPlatformId;

    return (
      <div
        key={member.friendId + member.discordId}
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
          {hasError ? (
            <Tooltip title={tt.importCsvPlatformError}>
              <CloseCircleOutlined style={{ color: "#ff4d4f", fontSize: 16 }} />
            </Tooltip>
          ) : noPlatformId ? (
            <Tooltip title={tt.importCsvNoPlatformId}>
              <WarningOutlined style={{ color: "#faad14", fontSize: 16 }} />
            </Tooltip>
          ) : discordNotOnServer ? (
            <Tooltip title={tt.importCsvDiscordError}>
              <CheckCircleOutlined style={{ color: "#bfbfbf", fontSize: 16 }} />
            </Tooltip>
          ) : member.existingUser ? (
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

        <Text
          strong
          style={{
            minWidth: 120,
            flexShrink: 0,
            color: member.platformError ? "#ff4d4f" : undefined,
          }}
        >
          {member.csvDisplayName ||
            member.nickname ||
            member.friendId ||
            member.discordDisplayName ||
            tt.importCsvNoPlatformIdName}
        </Text>

        {member.substitute && !member.teamName && (
          <Tag color="purple" style={{ margin: 0, flexShrink: 0 }}>
            {t.onlineTournaments.officialSubstitute}
          </Tag>
        )}

        {member.substitute && member.teamName && (
          <Tag color="orange" style={{ margin: 0, flexShrink: 0 }}>
            {t.onlineTournaments.substitute}
          </Tag>
        )}

        <Text
          type="secondary"
          style={{ fontSize: 12, minWidth: 100, flexShrink: 0 }}
        >
          {member.friendId}
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
          {member.discordId &&
            member.discordValid &&
            member.discordAvatarUrl && (
              <Avatar src={member.discordAvatarUrl} size="small" />
            )}
          {member.discordId &&
            member.discordValid &&
            !member.discordAvatarUrl && (
              <Avatar icon={<UserOutlined />} size="small" />
            )}
          {member.discordId &&
            member.discordValid &&
            member.discordDisplayName && (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {member.discordDisplayName}
              </Text>
            )}
          {override && (
            <Tag
              color="purple"
              closable
              onClose={() => handleDiscordClear(member.friendId)}
              style={{ margin: 0 }}
            >
              {override.displayName}
            </Tag>
          )}
          {member.discordId && member.discordValid === false && !override && (
            <>
              <Tooltip title={tt.importCsvDiscordError}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <WarningOutlined style={{ color: "#bfbfbf", fontSize: 14 }} />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {member.discordId}
                  </Text>
                </span>
              </Tooltip>
              {preview?.discordServerId && (
                <Select
                  showSearch
                  allowClear
                  placeholder={tt.importDiscordSearch}
                  style={{ width: 200 }}
                  loading={discordMembersLoading}
                  filterOption={(input, option) => {
                    const dm = allDiscordMembers.find(
                      (m) => m.discordId === option?.value
                    );
                    if (!dm) {
                      return false;
                    }
                    const lower = input.toLowerCase();
                    return (
                      dm.displayName.toLowerCase().includes(lower) ||
                      dm.username.toLowerCase().includes(lower)
                    );
                  }}
                  onSelect={(value: string) =>
                    handleDiscordSelect(member.friendId, value)
                  }
                  options={allDiscordMembers.map((dm) => ({
                    value: dm.discordId,
                    label: (
                      <span
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <Avatar
                          src={dm.avatarUrl}
                          size={20}
                          icon={<UserOutlined />}
                        />
                        {dm.displayName}
                        <Text
                          type="secondary"
                          style={{ fontSize: 11, marginLeft: "auto" }}
                        >
                          @{dm.username}
                        </Text>
                      </span>
                    ),
                  }))}
                />
              )}
            </>
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
          <Text type="secondary">{tt.importCsvValidating}</Text>
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
        <Tag color="orange" style={{ marginLeft: 4 }}>
          CSV
        </Tag>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {preview.isTeamMode ? (
          preview.teams.map((team) => {
            const isOfficialSubGroup =
              !team.name && team.members.every((m) => m.substitute);
            return (
              <Card
                key={team.name || "__no_team__"}
                title={
                  isOfficialSubGroup
                    ? t.onlineTournaments.officialSubstitutes
                    : team.name || tt.importCsvNoTeam
                }
                size="small"
                type="inner"
              >
                {team.members.map(renderMemberRow)}
              </Card>
            );
          })
        ) : (
          <Card title={tt.importPlayersTitle} size="small" type="inner">
            {preview.teams.flatMap((team) => team.members.map(renderMemberRow))}
          </Card>
        )}
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
