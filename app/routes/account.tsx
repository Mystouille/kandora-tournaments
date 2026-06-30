import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  Form,
  Input,
  Button,
  message,
  Alert,
  Spin,
  Modal,
  Divider,
  Card,
  Space,
} from "antd";
import { LinkOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { useTileSet } from "../contexts/TileSetContext";
import { TileSetName } from "../components/mahjong/HandImage";
import { TileSetSelector } from "../components/mahjong/TileSetSelector";
import { HandDisplay } from "../components/mahjong/TileDisplay";
import { PageTitle } from "../components/PageTitle";
import { basePath } from "../utils/basePath";
import { DiscordOAuth } from "../utils/discord-oauth";

export function meta() {
  return [
    { title: "Account Settings - TNT Paris Mahjong" },
    { name: "description", content: "Manage your account settings" },
  ];
}

export default function AccountPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState<any>(null);
  const isSetup = searchParams.get("setup") === "true";

  // Mahjong Soul linking modal state
  const [mahjongsoulModalOpen, setMahjongsoulModalOpen] = useState(false);
  const [mahjongsoulFriendId, setMahjongsoulFriendId] = useState("");
  const [mahjongsoulValidating, setMahjongsoulValidating] = useState(false);
  const [mahjongsoulValidated, setMahjongsoulValidated] = useState<{
    nickname: string;
    accountId: string;
  } | null>(null);
  const [riichiCityModalOpen, setRiichiCityModalOpen] = useState(false);
  const [riichiCityUserId, setRiichiCityUserId] = useState("");
  const [riichiCityValidating, setRiichiCityValidating] = useState(false);
  const [riichiCityValidated, setRiichiCityValidated] = useState<{
    nickname: string;
    accountId: string;
  } | null>(null);
  const [tenhouModalOpen, setTenhouModalOpen] = useState(false);
  const [tenhouUsername, setTenhouUsername] = useState("");
  const [discordLinkError, setDiscordLinkError] = useState<string | null>(null);
  const { tileSet: contextTileSet, setTileSet: setContextTileSet } =
    useTileSet();
  const [selectedTileSet, setSelectedTileSet] =
    useState<TileSetName>(contextTileSet);
  const [savingPreferences, setSavingPreferences] = useState(false);

  useEffect(() => {
    const checkAuth = () => {
      fetch(`${basePath}/api/auth/me`)
        .then((res) => res.json())
        .then((data) => {
          if (data.authenticated && data.user) {
            setUser(data.user);
            form.setFieldsValue({
              firstName: data.user.firstName ?? "",
              lastName: data.user.lastName ?? "",
            });
            const userTileSet = data.user.preferences?.tileSet;
            if (
              userTileSet &&
              Object.values(TileSetName).includes(userTileSet)
            ) {
              setSelectedTileSet(userTileSet as TileSetName);
            }
          } else {
            navigate("/", { replace: true });
          }
        })
        .finally(() => setLoading(false));
    };

    checkAuth();

    const handleAuthChanged = () => {
      navigate("/", { replace: true });
    };
    window.addEventListener("auth-changed", handleAuthChanged);
    return () => window.removeEventListener("auth-changed", handleAuthChanged);
  }, [form, navigate]);

  // Handle Discord link result from OAuth redirect
  useEffect(() => {
    const discordLink = searchParams.get("discord_link");
    if (discordLink === "success") {
      message.success(
        t.account.discordLinked || "Discord account linked successfully!"
      );
      // Re-fetch user to get updated discordIdentity
      fetch(`${basePath}/api/auth/me`)
        .then((res) => res.json())
        .then((data) => {
          if (data.authenticated && data.user) {
            setUser(data.user);
          }
        });
      setSearchParams({}, { replace: true });
    } else if (discordLink === "error") {
      const errorMsg = searchParams.get("discord_link_error");
      setDiscordLinkError(
        errorMsg ||
          t.account.discordLinkError ||
          "Failed to link Discord account."
      );
      setSearchParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (values: any) => {
    setSaving(true);
    try {
      const res = await fetch(`${basePath}/api/auth/account`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: values.firstName,
          lastName: values.lastName,
        }),
      });
      const data = await res.json();
      if (data.success) {
        message.success(t.account.saved);
        window.dispatchEvent(new Event("profile-updated"));
        if (isSetup) {
          navigate("/", { replace: true });
        }
      } else {
        message.error(data.error || t.account.saveError);
      }
    } catch {
      message.error(t.account.saveError);
    } finally {
      setSaving(false);
    }
  };

  const handleValidateMahjongsoul = async () => {
    if (!mahjongsoulFriendId.trim()) {
      message.error(t.account.mahjongsoulIdRequired || "Friend ID is required");
      return;
    }

    setMahjongsoulValidating(true);
    try {
      const res = await fetch(`${basePath}/api/auth/validate-identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "majsoulfId",
          id: mahjongsoulFriendId.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMahjongsoulValidated({
          nickname: data.nickname,
          accountId: data.accountId,
        });
      } else {
        message.error(data.error || "Failed to validate Mahjong Soul user");
        setMahjongsoulValidated(null);
      }
    } catch {
      message.error("Failed to validate Mahjong Soul user");
      setMahjongsoulValidated(null);
    } finally {
      setMahjongsoulValidating(false);
    }
  };

  const handleConfirmMahjongsoulLink = async () => {
    if (!mahjongsoulValidated) {
      return;
    }

    try {
      const res = await fetch(`${basePath}/api/auth/link-identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "mahjongsoulId",
          id: mahjongsoulFriendId.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setUser({
          ...user,
          majsoulIdentity: {
            friendId: data.mahjongsoulId,
            name: mahjongsoulValidated.nickname,
          },
        });
        setMahjongsoulModalOpen(false);
        setMahjongsoulFriendId("");
        setMahjongsoulValidated(null);
        message.success(t.account.linked || "Account linked successfully!");
        window.dispatchEvent(new Event("profile-updated"));
      } else {
        message.error(data.error || "Failed to link account");
      }
    } catch {
      message.error("Failed to link account");
    }
  };

  const handleConfirmRiichiCityLink = async () => {
    if (!riichiCityValidated) {
      return;
    }

    if (!riichiCityUserId.trim()) {
      message.error(t.account.riichiCityIdRequired || "User ID is required");
      return;
    }

    try {
      const res = await fetch(`${basePath}/api/auth/link-identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "riichiCityId",
          id: riichiCityUserId.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setUser({
          ...user,
          riichiCityIdentity: {
            id: data.riichiCityId,
            name: riichiCityValidated.nickname,
          },
        });
        setRiichiCityModalOpen(false);
        setRiichiCityUserId("");
        setRiichiCityValidated(null);
        message.success(t.account.linked || "Account linked successfully!");
        window.dispatchEvent(new Event("profile-updated"));
      } else {
        message.error(data.error || "Failed to link account");
      }
    } catch {
      message.error("Failed to link account");
    }
  };

  const handleConfirmTenhouLink = async () => {
    if (!tenhouUsername.trim()) {
      message.error("Tenhou username is required");
      return;
    }

    try {
      const res = await fetch(`${basePath}/api/auth/link-identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "tenhouId",
          id: tenhouUsername.trim(),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setUser({
          ...user,
          tenhouIdentity: { name: data.tenhouId },
        });
        setTenhouModalOpen(false);
        setTenhouUsername("");
        message.success(t.account.linked || "Account linked successfully!");
        window.dispatchEvent(new Event("profile-updated"));
      } else {
        message.error(data.error || "Failed to link account");
      }
    } catch {
      message.error("Failed to link account");
    }
  };

  const handleValidateRiichiCity = async () => {
    if (!riichiCityUserId.trim()) {
      message.error(t.account.riichiCityIdRequired || "User ID is required");
      return;
    }

    setRiichiCityValidating(true);
    try {
      const res = await fetch(`${basePath}/api/auth/validate-identity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "riichiCityId",
          id: riichiCityUserId.trim(),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setRiichiCityValidated({
          nickname: data.nickname,
          accountId: data.accountId,
        });
      } else {
        message.error(data.error || "Failed to validate Riichi City user");
        setRiichiCityValidated(null);
      }
    } catch {
      message.error("Failed to validate Riichi City user");
      setRiichiCityValidated(null);
    } finally {
      setRiichiCityValidating(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", padding: 60 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!user) {
    return (
      <div style={{ padding: 24, maxWidth: 500, margin: "0 auto" }}>
        <Alert title={t.account.notLoggedIn} type="warning" showIcon />
      </div>
    );
  }

  return (
    <div style={{ padding: 24, maxWidth: 500, margin: "0 auto" }}>
      {isSetup && (
        <Alert
          title={t.account.setupPrompt}
          type="info"
          showIcon
          closable
          style={{ marginBottom: 24 }}
          onClose={() => setSearchParams({}, { replace: true })}
        />
      )}
      <PageTitle title={t.account.title} />
      <Form form={form} layout="vertical" onFinish={handleSave}>
        <Form.Item
          label={t.account.firstName}
          name="firstName"
          rules={[
            { required: true, message: t.auth.firstNameRequired },
            { min: 2, message: t.auth.firstNameMin },
            { max: 50, message: t.auth.firstNameMax },
          ]}
        >
          <Input size="large" />
        </Form.Item>

        <Form.Item
          label={t.account.lastName}
          name="lastName"
          rules={[{ max: 50, message: t.auth.lastNameMax }]}
        >
          <Input size="large" />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0 }}>
          <Button
            type="primary"
            htmlType="submit"
            size="large"
            block
            loading={saving}
          >
            {t.account.save}
          </Button>
        </Form.Item>
      </Form>

      <Divider style={{ margin: "32px 0" }} />

      <h2 style={{ marginBottom: 16 }}>
        {t.account.linkedAccounts || "Linked Accounts"}
      </h2>

      {/* Mahjong Soul Identity Card */}
      <Card
        style={{ marginBottom: 16 }}
        title={t.account.mahjongsoulId}
        extra={
          !user.majsoulIdentity && (
            <Button
              type="primary"
              size="small"
              icon={<LinkOutlined />}
              onClick={() => setMahjongsoulModalOpen(true)}
            >
              {t.account.linkAccount || "Link Account"}
            </Button>
          )
        }
      >
        {user.majsoulIdentity ? (
          <div>
            <div>
              <strong>{t.account.accountIdLabel}:</strong>{" "}
              {user.majsoulIdentity.friendId}
            </div>
            {user.majsoulIdentity.name ? (
              <div style={{ marginTop: 8 }}>
                <strong>{t.account.usernameLabel}:</strong>{" "}
                {user.majsoulIdentity.name}
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ color: "#999" }}>
            {t.account.notLinked || "Not linked"}
          </div>
        )}
      </Card>

      <Card
        style={{ marginBottom: 16 }}
        title={t.account.riichiCityId}
        extra={
          !user.riichiCityIdentity && (
            <Button
              type="primary"
              size="small"
              icon={<LinkOutlined />}
              onClick={() => setRiichiCityModalOpen(true)}
            >
              {t.account.linkAccount || "Link Account"}
            </Button>
          )
        }
      >
        {user.riichiCityIdentity ? (
          <div>
            <div>
              <strong>{t.account.accountIdLabel}:</strong>{" "}
              {user.riichiCityIdentity.id}
            </div>
            {user.riichiCityIdentity.name ? (
              <div style={{ marginTop: 8 }}>
                <strong>{t.account.usernameLabel}:</strong>{" "}
                {user.riichiCityIdentity.name}
              </div>
            ) : null}
          </div>
        ) : (
          <div style={{ color: "#999" }}>
            {t.account.notLinked || "Not linked"}
          </div>
        )}
      </Card>

      {/* Tenhou Identity Card */}
      <Card
        style={{ marginBottom: 16 }}
        title="Tenhou"
        extra={
          !user.tenhouIdentity && (
            <Button
              type="primary"
              size="small"
              icon={<LinkOutlined />}
              onClick={() => setTenhouModalOpen(true)}
            >
              {t.account.linkAccount || "Link Account"}
            </Button>
          )
        }
      >
        {user.tenhouIdentity ? (
          <div>
            <strong>{t.account.usernameLabel}:</strong>{" "}
            {user.tenhouIdentity.name}
          </div>
        ) : (
          <div style={{ color: "#999" }}>
            {t.account.notLinked || "Not linked"}
          </div>
        )}
      </Card>

      {/* Discord Identity Card */}
      {discordLinkError && (
        <Alert
          message={
            t.account.discordLinkError || "Failed to link Discord account"
          }
          description={discordLinkError}
          type="error"
          showIcon
          closable
          onClose={() => setDiscordLinkError(null)}
          style={{ marginBottom: 16 }}
        />
      )}
      <Card
        style={{ marginBottom: 16 }}
        title={t.account.discordAccount || "Discord"}
        extra={
          !user.discordIdentity && (
            <Button
              type="primary"
              size="small"
              icon={<LinkOutlined />}
              style={{ backgroundColor: "#5865F2", borderColor: "#5865F2" }}
              onClick={() => DiscordOAuth.redirectToDiscordForLink()}
            >
              {t.account.linkAccount || "Link Account"}
            </Button>
          )
        }
      >
        {user.discordIdentity ? (
          <div>
            <div>
              <strong>{t.account.usernameLabel}:</strong>{" "}
              {user.discordIdentity.displayName || user.discordIdentity.id}
            </div>
          </div>
        ) : (
          <div style={{ color: "#999" }}>
            {t.account.notLinked || "Not linked"}
          </div>
        )}
      </Card>

      <Divider style={{ margin: "32px 0" }} />

      <h2 style={{ marginBottom: 16 }}>{t.account.preferences}</h2>

      <Card style={{ marginBottom: 16 }} title={t.account.tileStyle}>
        <p
          style={{
            fontSize: 14,
            color: "#888",
            marginBottom: 12,
            marginTop: 0,
          }}
        >
          {t.account.tileStyleDesc}
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: 16,
          }}
        >
          <HandDisplay
            hand="123m456p3z 7'89sx66xz"
            tileSet={selectedTileSet}
            tileHeight={48}
            separateLastTile={false}
          />
        </div>
        <TileSetSelector
          value={selectedTileSet}
          onChange={setSelectedTileSet}
        />
        <Button
          type="primary"
          style={{ marginTop: 16 }}
          loading={savingPreferences}
          onClick={async () => {
            setSavingPreferences(true);
            try {
              const res = await fetch(`${basePath}/api/auth/account`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  preferences: { tileSet: selectedTileSet },
                }),
              });
              const data = await res.json();
              if (data.success) {
                setContextTileSet(selectedTileSet);
                message.success(t.account.preferencesSaved);
              } else {
                message.error(data.error || t.account.preferencesSaveError);
              }
            } catch {
              message.error(t.account.preferencesSaveError);
            } finally {
              setSavingPreferences(false);
            }
          }}
        >
          {t.account.save}
        </Button>
      </Card>

      <Button
        onClick={async () => {
          try {
            await fetch(`${basePath}/api/auth/logout`, { method: "POST" });
          } catch {}
          window.dispatchEvent(new Event("auth-changed"));
          message.success(t.auth.logoutSuccess);
          navigate("/", { replace: true });
        }}
      >
        {t.auth.logout}
      </Button>

      {/* Mahjong Soul Linking Modal */}
      <Modal
        title={t.account.linkMahjongsoul || "Link Mahjong Soul Account"}
        open={mahjongsoulModalOpen}
        onCancel={() => {
          setMahjongsoulModalOpen(false);
          setMahjongsoulFriendId("");
          setMahjongsoulValidated(null);
        }}
        footer={null}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!mahjongsoulValidated ? (
            <>
              <div>
                <p style={{ marginBottom: 8, fontSize: 14, color: "#666" }}>
                  {t.account.mahjongsoulIdDesc ||
                    "Enter your Mahjong Soul friend ID to link your account."}
                </p>
                <Input
                  placeholder="e.g., 123456789"
                  value={mahjongsoulFriendId}
                  onChange={(e) => setMahjongsoulFriendId(e.target.value)}
                  disabled={mahjongsoulValidating}
                  onPressEnter={() => handleValidateMahjongsoul()}
                />
              </div>
              <Button
                type="primary"
                onClick={handleValidateMahjongsoul}
                loading={mahjongsoulValidating}
              >
                {mahjongsoulValidating ? "Validating..." : "Validate"}
              </Button>
            </>
          ) : (
            <>
              <Alert
                message="Account Found"
                description={`Mahjong Soul user: ${mahjongsoulValidated.nickname}`}
                type="success"
                showIcon
              />
              <p style={{ fontSize: 14, color: "#666", marginTop: 8 }}>
                {t.account.confirmLink ||
                  "Click the button below to permanently link this account. This action cannot be undone."}
              </p>
              <Space style={{ justifyContent: "flex-end" }}>
                <Button
                  onClick={() => {
                    setMahjongsoulFriendId("");
                    setMahjongsoulValidated(null);
                  }}
                >
                  Back
                </Button>
                <Button
                  type="primary"
                  onClick={handleConfirmMahjongsoulLink}
                  loading={saving}
                >
                  Confirm Link
                </Button>
              </Space>
            </>
          )}
        </div>
      </Modal>

      <Modal
        title={t.account.linkRiichiCity || "Link Riichi City Account"}
        open={riichiCityModalOpen}
        onCancel={() => {
          setRiichiCityModalOpen(false);
          setRiichiCityUserId("");
          setRiichiCityValidated(null);
        }}
        footer={null}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {!riichiCityValidated ? (
            <>
              <div>
                <p style={{ marginBottom: 8, fontSize: 14, color: "#666" }}>
                  {t.account.riichiCityIdDesc ||
                    "Enter your Riichi City user ID to link your account."}
                </p>
                <Input
                  placeholder="e.g., 123456789"
                  value={riichiCityUserId}
                  onChange={(e) => setRiichiCityUserId(e.target.value)}
                  disabled={riichiCityValidating}
                  onPressEnter={() => handleValidateRiichiCity()}
                />
              </div>
              <Button
                type="primary"
                onClick={handleValidateRiichiCity}
                loading={riichiCityValidating}
              >
                {riichiCityValidating ? "Validating..." : "Validate"}
              </Button>
            </>
          ) : (
            <>
              <Alert
                message="Account Found"
                description={`Riichi City user: ${riichiCityValidated.nickname || riichiCityValidated.accountId}`}
                type="success"
                showIcon
              />
              <p style={{ fontSize: 14, color: "#666", marginTop: 8 }}>
                {t.account.confirmLink ||
                  "Click the button below to permanently link this account. This action cannot be undone."}
              </p>
              <Space style={{ justifyContent: "flex-end" }}>
                <Button
                  onClick={() => {
                    setRiichiCityUserId("");
                    setRiichiCityValidated(null);
                  }}
                >
                  Back
                </Button>
                <Button
                  type="primary"
                  onClick={handleConfirmRiichiCityLink}
                  loading={saving}
                >
                  Confirm Link
                </Button>
              </Space>
            </>
          )}
        </div>
      </Modal>

      <Modal
        title="Link Tenhou Account"
        open={tenhouModalOpen}
        onCancel={() => {
          setTenhouModalOpen(false);
          setTenhouUsername("");
        }}
        footer={null}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <p style={{ marginBottom: 8, fontSize: 14, color: "#666" }}>
              Enter your Tenhou username to link your account.
            </p>
            <Input
              placeholder="e.g., MyTenhouName"
              value={tenhouUsername}
              onChange={(e) => setTenhouUsername(e.target.value)}
              onPressEnter={() => handleConfirmTenhouLink()}
            />
          </div>
          <Button
            type="primary"
            onClick={handleConfirmTenhouLink}
            loading={saving}
          >
            Link Account
          </Button>
        </div>
      </Modal>
    </div>
  );
}
