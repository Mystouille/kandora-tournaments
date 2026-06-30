import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Result, Typography } from "antd";
import { ImportOutlined, UploadOutlined } from "@ant-design/icons";
import { basePath } from "../utils/basePath";
import { requireLeagueAdminOrRedirect } from "../utils/league-permissions.server";
import { useLocale } from "../contexts/LocaleContext";
import {
  type ImportResult,
  formatString,
} from "../components/import-teams/shared";
import { PlatformImport } from "../components/import-teams/PlatformImport";
import { CsvImport } from "../components/import-teams/CsvImport";

const { Title } = Typography;

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  await requireLeagueAdminOrRedirect(request, params.id!);
  return null;
}

export function meta() {
  return [{ title: "Import Teams - TNT Paris Mahjong" }];
}

type ImportMode = "choose" | "platform" | "csv";

export default function ImportTeamsPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { t } = useLocale();
  const tt = t.onlineTournaments.admin;

  const [mode, setMode] = useState<ImportMode>("choose");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [csvText, setCsvText] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        }
      })
      .catch(() => navigate("/"));
  }, [id, navigate]);

  const resetAll = () => {
    setMode("choose");
    setResult(null);
    setCsvText("");
  };

  const handleCsvFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleCsvFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    const text = await file.text();
    setCsvText(text);
    setMode("csv");

    // Reset file input so the same file can be re-selected
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div style={{ padding: "24px", maxWidth: 960, margin: "0 auto" }}>
      <Link to={`/online-tournaments`}>
        <Button size="small" style={{ marginBottom: 12 }}>
          ← {tt.importBackToLeagues}
        </Button>
      </Link>

      <Title level={3}>{tt.importRoster}</Title>

      {/* Hidden file input for CSV */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.txt"
        style={{ display: "none" }}
        onChange={handleCsvFileChange}
      />

      {/* Mode selection buttons */}
      {mode === "choose" && !result && (
        <div
          style={{
            textAlign: "center",
            padding: 48,
            display: "flex",
            gap: 16,
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <Button
            type="primary"
            size="large"
            icon={<ImportOutlined />}
            onClick={() => setMode("platform")}
          >
            {tt.importButton}
          </Button>
          <Button
            size="large"
            icon={<UploadOutlined />}
            onClick={handleCsvFileSelect}
          >
            {tt.importCsvButton}
          </Button>
        </div>
      )}

      {/* Platform import */}
      {mode === "platform" && !result && (
        <PlatformImport id={id!} onResult={setResult} onReset={resetAll} />
      )}

      {/* CSV import */}
      {mode === "csv" && !result && (
        <CsvImport
          id={id!}
          csvText={csvText}
          onResult={setResult}
          onReset={resetAll}
        />
      )}

      {/* Success result */}
      {result && (
        <Result
          status="success"
          title={
            result.teamsProcessed > 0
              ? tt.importComplete
              : tt.importPlayersComplete
          }
          subTitle={
            result.teamsProcessed > 0
              ? formatString(tt.importCompleteSubtitle, {
                  teams: result.teamsProcessed,
                  users: result.usersCreated,
                })
              : formatString(tt.importPlayersCompleteSubtitle, {
                  players: result.playersProcessed ?? 0,
                  users: result.usersCreated,
                })
          }
          extra={[
            <Button key="again" onClick={resetAll}>
              {tt.importAgain}
            </Button>,
            <Link key="back" to="/online-tournaments">
              <Button type="primary">{tt.importBackToLeagues}</Button>
            </Link>,
          ]}
        />
      )}
    </div>
  );
}
