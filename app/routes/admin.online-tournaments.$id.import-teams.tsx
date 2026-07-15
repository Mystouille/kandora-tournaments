import { useEffect, useRef, useState } from "react";
import { Link, useLoaderData, useNavigate, useParams } from "react-router";
import { Button, Card, Result, Typography } from "antd";
import { ImportOutlined, UploadOutlined } from "@ant-design/icons";
import { basePath } from "../utils/basePath";
import { requireLeagueAdminOrRedirect } from "../utils/league-permissions.server";
import { connectToDatabase } from "../utils/dbConnection.server";
import { LeagueModel } from "../db/League";
import { useLocale } from "../contexts/LocaleContext";
import {
  type ImportResult,
  formatString,
} from "../components/import-teams/shared";
import { PlatformImport } from "../components/import-teams/PlatformImport";
import { CsvImport } from "../components/import-teams/CsvImport";

const { Title, Text, Paragraph } = Typography;

const csvCodeStyle: React.CSSProperties = {
  margin: 0,
  padding: "8px 12px",
  background: "#f5f5f5",
  border: "1px solid #f0f0f0",
  borderRadius: 4,
  fontSize: 13,
  fontFamily: "monospace",
  whiteSpace: "pre",
  overflowX: "auto",
};

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: { id: string };
}) {
  await requireLeagueAdminOrRedirect(request, params.id!);
  await connectToDatabase();
  const league = await LeagueModel.findById(params.id!)
    .select("rulesConfig.isTeamMode")
    .lean();
  return { isTeamMode: league?.rulesConfig?.isTeamMode ?? true };
}

export function meta() {
  return [{ title: "Import Teams - TNT Paris Mahjong" }];
}

type ImportMode = "choose" | "platform" | "csv";

export default function ImportTeamsPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { isTeamMode } = useLoaderData<typeof loader>();
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
      <Link to={`/`}>
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
        <>
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

          {/* CSV format guidance so admins know how to prepare their file */}
          <Card size="small" style={{ maxWidth: 640, margin: "0 auto" }}>
            <Text strong>{tt.importCsvFormatTitle}</Text>
            <Paragraph
              type="secondary"
              style={{ marginTop: 8, marginBottom: 8 }}
            >
              {tt.importCsvFormatIntro}
            </Paragraph>
            <pre style={csvCodeStyle}>
              {isTeamMode
                ? tt.importCsvFormatTeamColumns
                : tt.importCsvFormatIndividualColumns}
            </pre>
            <ul style={{ margin: "12px 0 0", paddingLeft: 18 }}>
              {isTeamMode && (
                <li>
                  <Text type="secondary">{tt.importCsvFormatTeamNameHelp}</Text>
                </li>
              )}
              {isTeamMode && (
                <li>
                  <Text type="secondary">
                    {tt.importCsvFormatDisplayNameHelp}
                  </Text>
                </li>
              )}
              <li>
                <Text type="secondary">{tt.importCsvFormatPlatformIdHelp}</Text>
              </li>
              <li>
                <Text type="secondary">{tt.importCsvFormatDiscordHelp}</Text>
              </li>
              <li>
                <Text type="secondary">{tt.importCsvFormatSubstituteHelp}</Text>
              </li>
            </ul>
            <Paragraph
              type="secondary"
              style={{ margin: "12px 0 4px", fontWeight: 500 }}
            >
              {tt.importCsvFormatExample}
            </Paragraph>
            <pre style={csvCodeStyle}>
              {isTeamMode
                ? "Red Dragons,Alice,12345678,123456789012345678\nRed Dragons,Bob,87654321,,sub"
                : "12345678,123456789012345678\n87654321,,sub"}
            </pre>
          </Card>
        </>
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
            <Link key="back" to="/">
              <Button type="primary">{tt.importBackToLeagues}</Button>
            </Link>,
          ]}
        />
      )}
    </div>
  );
}
