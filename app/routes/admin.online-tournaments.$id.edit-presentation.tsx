import { useEffect, useState, lazy, Suspense } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Segmented, Spin, Modal, message, Typography } from "antd";
import { SaveOutlined, TranslationOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";
import type { Route } from "./+types/admin.online-tournaments.$id.edit-presentation";
import { requireLeagueAdminOrRedirect } from "../utils/league-permissions.server";

const RichTextEditor = lazy(() =>
  import("../components/editor/RichTextEditor").then((m) => ({
    default: m.RichTextEditor,
  }))
);

const { Title } = Typography;

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireLeagueAdminOrRedirect(request, params.id!);
  return null;
}

export function meta() {
  return [{ title: "Edit Presentation - TNT Paris Mahjong" }];
}

export default function EditLeaguePresentationPage() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [leagueName, setLeagueName] = useState("");
  const [leagueSlug, setLeagueSlug] = useState("");
  const [contentFr, setContentFr] = useState("");
  const [contentEn, setContentEn] = useState("");
  const [editingLocale, setEditingLocale] = useState<"fr" | "en">("fr");

  useEffect(() => {
    if (!id) {
      return;
    }
    fetch(
      `${basePath}/api/online-tournaments/${encodeURIComponent(id)}/can-edit`
    )
      .then((res) => res.json())
      .then((data) => {
        if (!data?.canEdit) {
          navigate("/");
        } else {
          setIsAdmin(true);
        }
      })
      .catch(() => navigate("/"));
  }, [id]);

  useEffect(() => {
    if (!isAdmin || !id) {
      return;
    }

    // Fetch all leagues to find the one matching this ID
    fetch(`${basePath}/api/online-tournaments`)
      .then((res) => res.json())
      .then((data) => {
        const leagues: Array<{
          _id: string;
          name: string;
          slug: string;
        }> = data ?? [];
        const league = leagues.find((l) => l._id === id);
        if (!league) {
          message.error("League not found");
          navigate("/online-tournaments");
          return;
        }
        setLeagueName(league.name);
        setLeagueSlug(league.slug);
        // Fetch the full detail to get presentation content
        return fetch(
          `${basePath}/api/online-tournaments/${encodeURIComponent(league.slug)}`
        );
      })
      .then((res) => {
        if (!res) {
          return;
        }
        return res.json();
      })
      .then((detail) => {
        if (detail) {
          setContentFr(detail.presentation?.fr ?? "");
          setContentEn(detail.presentation?.en ?? "");
        }
      })
      .catch(() => {
        message.error("Failed to load league");
        navigate("/online-tournaments");
      })
      .finally(() => setLoading(false));
  }, [isAdmin, id]);

  const handleSave = async (translate: boolean) => {
    if (translate) {
      Modal.confirm({
        title: t.common.saveAndTranslate,
        content: t.common.translateWarning,
        okText: t.common.saveAndTranslate,
        cancelText: t.common.cancel,
        onOk: () => doSave(true),
      });
    } else {
      await doSave(false);
    }
  };

  const doSave = async (translate: boolean) => {
    setSaving(true);
    try {
      const res = await fetch(`${basePath}/api/admin/league-presentation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: id,
          fr: contentFr,
          en: contentEn,
          translate,
        }),
      });
      const data = await res.json();
      if (data.success) {
        message.success(t.onlineTournaments.admin.saveSuccess);
        if (data.presentation) {
          setContentFr(data.presentation.fr ?? "");
          setContentEn(data.presentation.en ?? "");
        }
        navigate(`/online-tournaments/${encodeURIComponent(leagueSlug)}`);
      } else {
        message.error(data.error || t.onlineTournaments.admin.saveError);
      }
    } catch {
      message.error(t.onlineTournaments.admin.saveError);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !isAdmin) {
    return (
      <div style={{ textAlign: "center", padding: 48 }}>
        <Spin size="large" />
      </div>
    );
  }

  const currentContent = editingLocale === "fr" ? contentFr : contentEn;
  const setCurrentContent =
    editingLocale === "fr" ? setContentFr : setContentEn;

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      <Link to={`/online-tournaments/${encodeURIComponent(leagueSlug)}`}>
        <Button size="small" style={{ marginBottom: 12 }}>
          ← {t.onlineTournaments.admin.backToLeague}
        </Button>
      </Link>

      <Title level={3}>
        {t.onlineTournaments.admin.presentationEditor} — {leagueName}
      </Title>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Segmented
          value={editingLocale}
          onChange={(val) => setEditingLocale(val as "fr" | "en")}
          options={[
            {
              label: `🇫🇷 ${t.onlineTournaments.admin.editingFrench}`,
              value: "fr",
            },
            {
              label: `🇬🇧 ${t.onlineTournaments.admin.editingEnglish}`,
              value: "en",
            },
          ]}
        />
      </div>

      <Suspense fallback={<Spin />}>
        <RichTextEditor
          key={editingLocale}
          content={currentContent}
          onChange={setCurrentContent}
        />
      </Suspense>

      <div
        style={{
          marginTop: 24,
          display: "flex",
          gap: 12,
          justifyContent: "flex-end",
        }}
      >
        <Button
          type="default"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={() => handleSave(false)}
        >
          {saving ? t.common.saving : t.common.saveAsIs}
        </Button>
        <Button
          type="primary"
          icon={<TranslationOutlined />}
          loading={saving}
          onClick={() => handleSave(true)}
        >
          {saving ? t.common.saving : t.common.saveAndTranslate}
        </Button>
      </div>
    </div>
  );
}
