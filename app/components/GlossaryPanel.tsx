import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { Drawer, Tag, Typography } from "antd";
import { useGlossary } from "../contexts/GlossaryContext";
import { useLocale } from "../contexts/LocaleContext";
import { ArticleContent } from "./ArticleContent";
import { GlossaryTermLink } from "./GlossaryTermLink";
import type { GlossaryTag } from "../types/glossary";

const { Title, Text } = Typography;

const portraitQuery = "(max-width: 576px) and (orientation: portrait)";

function subscribeMediaQuery(cb: () => void) {
  const mql = window.matchMedia(portraitQuery);
  mql.addEventListener("change", cb);
  return () => mql.removeEventListener("change", cb);
}

function getIsPortraitMobile() {
  return window.matchMedia(portraitQuery).matches;
}

const serverSnapshot = false;

function useIsPortraitMobile() {
  return useSyncExternalStore(
    subscribeMediaQuery,
    getIsPortraitMobile,
    () => serverSnapshot
  );
}

function subscribeViewportHeight(cb: () => void) {
  window.addEventListener("resize", cb);
  window.addEventListener("orientationchange", cb);
  return () => {
    window.removeEventListener("resize", cb);
    window.removeEventListener("orientationchange", cb);
  };
}

function getViewportHeight() {
  return window.innerHeight;
}

function useViewportHeight() {
  return useSyncExternalStore(
    subscribeViewportHeight,
    getViewportHeight,
    () => 0
  );
}

const tagColors: Record<GlossaryTag, string> = {
  action: "blue",
  shape: "green",
  wait: "orange",
  yaku: "red",
  rule: "purple",
  scoring: "gold",
  other: "default",
};

interface GlossaryPanelProps {
  container?: HTMLElement | null;
}

export function GlossaryPanel({ container }: GlossaryPanelProps = {}) {
  const { activeTerm, closeTerm, openTerm } = useGlossary();
  const { t, locale } = useLocale();
  const isPortrait = useIsPortraitMobile();
  const viewportHeight = useViewportHeight();
  // Keep a snapshot of the last term so content stays visible during the close animation
  const lastTermRef = useRef(activeTerm);
  if (activeTerm) {
    lastTermRef.current = activeTerm;
  }
  const term = activeTerm ?? lastTermRef.current;

  useEffect(() => {
    if (!activeTerm) {
      return;
    }
    function handleClick(e: MouseEvent) {
      const drawerEl = document.querySelector(
        ".glossary-panel-drawer .ant-drawer-content-wrapper"
      );
      if (drawerEl && !drawerEl.contains(e.target as Node)) {
        closeTerm();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [activeTerm, closeTerm]);

  const definition =
    term && locale === "en" && term.definitionEn
      ? term.definitionEn
      : (term?.definition ?? "");

  const synonyms = term?.synonyms ?? [];
  const relatedNames = term?.relatedNames ?? [];

  const skipTerms = useMemo(() => {
    if (!term) {
      return undefined;
    }
    const set = new Set<string>();
    set.add(term.name.toLowerCase());
    for (const s of term.synonyms ?? []) {
      set.add(s.toLowerCase());
    }
    return set;
  }, [term]);

  return (
    <Drawer
      rootClassName="glossary-panel-drawer"
      title={
        term ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>{term.name}</span>
            <Tag color={tagColors[term.tag]}>{t.glossary.tags[term.tag]}</Tag>
          </div>
        ) : null
      }
      placement={isPortrait ? "bottom" : "right"}
      onClose={closeTerm}
      open={!!activeTerm}
      size={isPortrait ? Math.round(viewportHeight * 0.6) : 400}
      mask={false}
      push={false}
      // The replay viewer renders inside a `fixed inset-0 z-[9999]`
      // overlay; antd's Drawer defaults to z-index 1000, which would
      // hide the glossary behind the canvas. Bump above the overlay
      // so glossary term clicks stay usable inside the replay route.
      zIndex={10002}
      {...(container ? { getContainer: () => container } : {})}
      styles={{ body: { paddingTop: 8 } }}
    >
      {term?.japanese && (
        <div style={{ marginBottom: 4 }}>
          <Text style={{ fontSize: 15 }}>{term.japanese}</Text>
        </div>
      )}

      {synonyms.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            ({synonyms.join(", ")})
          </Text>
        </div>
      )}

      <ArticleContent html={definition} skipTerms={skipTerms} />

      {relatedNames.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Title level={5} style={{ marginBottom: 4 }}>
            {t.glossary.relatedNames}
          </Title>
          <Text type="secondary">
            {relatedNames.map((name, i) => (
              <span key={name}>
                {i > 0 && ", "}
                <GlossaryTermLink text={name} onClick={() => openTerm(name)} />
              </span>
            ))}
          </Text>
        </div>
      )}
    </Drawer>
  );
}
