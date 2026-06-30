import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { basePath } from "../utils/basePath";
import type { GlossaryTag } from "../types/glossary";

export interface GlossaryTermEntry {
  _id: string;
  name: string;
  japanese?: string;
  synonyms: string[];
  relatedNames: string[];
  tag: GlossaryTag;
  definition: string;
  definitionEn?: string;
}

interface GlossaryContextType {
  terms: GlossaryTermEntry[];
  termPattern: RegExp | null;
  termLookup: Map<string, GlossaryTermEntry>;
  activeTerm: GlossaryTermEntry | null;
  openTerm: (nameOrSynonym: string) => void;
  closeTerm: () => void;
}

const GlossaryContext = createContext<GlossaryContextType>({
  terms: [],
  termPattern: null,
  termLookup: new Map(),
  activeTerm: null,
  openTerm: () => {},
  closeTerm: () => {},
});

export function GlossaryProvider({ children }: { children: ReactNode }) {
  const { data } = useQuery<{ terms: GlossaryTermEntry[] }>({
    queryKey: ["glossary-terms"],
    queryFn: () => fetch(`${basePath}/api/glossary`).then((res) => res.json()),
  });

  const terms = data?.terms ?? [];

  const { termPattern, termLookup } = useMemo(() => {
    const lookup = new Map<string, GlossaryTermEntry>();
    const allNames: string[] = [];

    for (const term of terms) {
      const names = [term.name, ...(term.synonyms ?? [])];
      for (const n of names) {
        const lower = n.toLowerCase();
        if (!lookup.has(lower)) {
          lookup.set(lower, term);
          allNames.push(n);
        }
      }
    }

    if (allNames.length === 0) {
      return { termPattern: null, termLookup: lookup };
    }

    // Sort by length descending so longer terms match first
    allNames.sort((a, b) => b.length - a.length);

    // Build regex: word-boundary match for each name, case-insensitive
    const escaped = allNames.map((n) =>
      n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    const pattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");

    return { termPattern: pattern, termLookup: lookup };
  }, [terms]);

  const [activeTerm, setActiveTerm] = useState<GlossaryTermEntry | null>(null);

  const openTerm = useCallback(
    (nameOrSynonym: string) => {
      const entry = termLookup.get(nameOrSynonym.toLowerCase());
      if (entry) {
        setActiveTerm(entry);
      }
    },
    [termLookup]
  );

  const closeTerm = useCallback(() => {
    setActiveTerm(null);
  }, []);

  return (
    <GlossaryContext.Provider
      value={{
        terms,
        termPattern,
        termLookup,
        activeTerm,
        openTerm,
        closeTerm,
      }}
    >
      {children}
    </GlossaryContext.Provider>
  );
}

export function useGlossary() {
  return useContext(GlossaryContext);
}
