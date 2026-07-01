import { useEffect, useState, useRef, lazy, Suspense } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  Button,
  Segmented,
  Spin,
  Modal,
  message,
  Typography,
  Input,
} from "antd";
import {
  SaveOutlined,
  TranslationOutlined,
  UploadOutlined,
  DeleteOutlined,
  PictureOutlined,
} from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";
import type { Route } from "./+types/admin.online-tournaments.$id.edit-presentation";
import { requireLeagueAdminOrRedirect } from "../utils/league-permissions.server";

const RichTextEditor = lazy(() =>
  import("../components/editor/RichTextEditor").then((m) => ({
    default: m.RichTextEditor,
  }))
);

const { Title, Text } = Typography;

const COVER_MAX_DIM = 1280;

/**
 * Read an image file and return a downscaled WebP data URL (bounded to
 * COVER_MAX_DIM on its longest side) so the upload payload stays small.
 */
async function fileToCoverDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = dataUrl;
  });
  const scale = Math.min(1, COVER_MAX_DIM / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return dataUrl;
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/webp", 0.85);
}

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
  const [summaryFr, setSummaryFr] = useState("");
  const [summaryEn, setSummaryEn] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState("");
  const coverInputRef = useRef<HTMLInputElement>(null);
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
          navigate("/");
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
          setSummaryFr(detail.summary?.fr ?? "");
          setSummaryEn(detail.summary?.en ?? "");
          setCoverImageUrl(detail.coverImageUrl ?? "");
        }
      })
      .catch(() => {
        message.error("Failed to load league");
        navigate("/");
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
          summaryFr,
          summaryEn,
          coverImageUrl,
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
        if (data.summary) {
          setSummaryFr(data.summary.fr ?? "");
          setSummaryEn(data.summary.en ?? "");
        }
        if (typeof data.coverImageUrl === "string") {
          setCoverImageUrl(data.coverImageUrl);
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

  const handleCoverSelected = async (file: File) => {
    try {
      const dataUrl = await fileToCoverDataUrl(file);
      setCoverImageUrl(dataUrl);
    } catch {
      message.error(t.onlineTournaments.admin.saveError);
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

  const currentSummary = editingLocale === "fr" ? summaryFr : summaryEn;
  const setCurrentSummary =
    editingLocale === "fr" ? setSummaryFr : setSummaryEn;

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

      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 4, fontWeight: 500 }}>
          {t.onlineTournaments.admin.coverImageLabel}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              width: 240,
              height: 120,
              borderRadius: 8,
              border: "1px solid #d9d9d9",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #722ed1, #1677ff)",
              flexShrink: 0,
            }}
          >
            {coverImageUrl ? (
              <img
                src={coverImageUrl}
                alt=""
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <PictureOutlined
                style={{ fontSize: 32, color: "rgba(255,255,255,0.85)" }}
              />
            )}
          </div>
          <div>
            <input
              ref={coverInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  handleCoverSelected(file);
                }
                e.target.value = "";
              }}
            />
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <Button
                icon={<UploadOutlined />}
                onClick={() => coverInputRef.current?.click()}
              >
                {t.onlineTournaments.admin.coverImageSelect}
              </Button>
              {coverImageUrl ? (
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => setCoverImageUrl("")}
                >
                  {t.onlineTournaments.admin.coverImageRemove}
                </Button>
              ) : null}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {coverImageUrl
                ? t.onlineTournaments.admin.coverImageHint
                : t.onlineTournaments.admin.coverImageNone}
            </Text>
          </div>
        </div>
      </div>

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

      <div style={{ marginBottom: 16 }}>
        <label
          style={{ display: "block", marginBottom: 4, fontWeight: 500 }}
          htmlFor="league-summary"
        >
          {t.onlineTournaments.admin.summaryLabel}
        </label>
        <Input.TextArea
          id="league-summary"
          value={currentSummary}
          onChange={(e) => setCurrentSummary(e.target.value)}
          placeholder={t.onlineTournaments.admin.summaryPlaceholder}
          autoSize={{ minRows: 2, maxRows: 4 }}
          maxLength={280}
          showCount
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
