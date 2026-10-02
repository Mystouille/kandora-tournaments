import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HighlightProvider } from "../../../app/contexts/HighlightContext";
import { LocaleProvider } from "../../../app/contexts/LocaleContext";
import { ThemeProvider } from "../../../app/contexts/ThemeContext";
import GraphsTab from "../../../app/components/statistics/GraphsTab";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Statistics graphs harness root is missing");
}

createRoot(root).render(
  <QueryClientProvider client={new QueryClient()}>
    <LocaleProvider initialLocale="en">
      <ThemeProvider>
        <HighlightProvider>
          <GraphsTab
            leagueIds={["graph-test"]}
            entityType="team"
            entityIds={[]}
            phaseFilter="both"
            startDate={null}
            endDate={null}
          />
        </HighlightProvider>
      </ThemeProvider>
    </LocaleProvider>
  </QueryClientProvider>
);
