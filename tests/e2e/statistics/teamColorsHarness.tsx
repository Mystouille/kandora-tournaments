import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocaleProvider } from "../../../app/contexts/LocaleContext";
import { ThemeProvider, useAppTheme } from "../../../app/contexts/ThemeContext";
import { TelemetryProvider } from "../../../app/contexts/TelemetryContext";
import LeagueStatisticsPage from "../../../app/routes/online-tournaments.$slug.statistics";
import EditRosterPage from "../../../app/routes/admin.online-tournaments.$id.edit-roster";

function Harness() {
  const { isDark } = useAppTheme();
  return (
    <main
      style={{
        padding: 16,
        minHeight: "100vh",
        backgroundColor: isDark ? "#141414" : "#fff",
      }}
    >
      <Routes>
        <Route
          path="/online-tournaments/:slug/statistics/:tab?"
          element={<LeagueStatisticsPage />}
        />
        <Route
          path="/admin/online-tournaments/:id/edit-roster"
          element={<EditRosterPage />}
        />
      </Routes>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Team colors harness root is missing");
}

createRoot(root).render(
  <BrowserRouter>
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <LocaleProvider initialLocale="en">
        <ThemeProvider
          initialTheme={
            new URLSearchParams(location.search).get("theme") === "light"
              ? "light"
              : "dark"
          }
        >
          <TelemetryProvider>
            <Harness />
          </TelemetryProvider>
        </ThemeProvider>
      </LocaleProvider>
    </QueryClientProvider>
  </BrowserRouter>
);
