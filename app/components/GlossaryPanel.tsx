import { GlossaryPanel as CoreGlossaryPanel } from "~/db/ui/glossary/GlossaryPanel";
import { useGlossary } from "../contexts/GlossaryContext";
import { useLocale } from "../contexts/LocaleContext";
import { ArticleContent } from "./ArticleContent";

interface GlossaryPanelProps {
  container?: HTMLElement | null;
}

export function GlossaryPanel({ container }: GlossaryPanelProps = {}) {
  const { activeTerm, closeTerm, openTerm } = useGlossary();
  const { t, locale } = useLocale();

  return (
    <CoreGlossaryPanel
      activeTerm={activeTerm}
      locale={locale}
      labels={{
        synonyms: t.glossary.synonyms,
        relatedNames: t.glossary.relatedNames,
        tags: t.glossary.tags,
      }}
      onClose={closeTerm}
      onOpenTerm={openTerm}
      renderDefinition={({ html, skipTerms }) => (
        <ArticleContent html={html} skipTerms={skipTerms} />
      )}
      container={container}
    />
  );
}
