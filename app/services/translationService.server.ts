import { translationConfig } from "config";

const DEEPL_API_URL = "https://api-free.deepl.com/v2/translate";

function getApiKey(): string {
  const cfg = translationConfig();
  if (!cfg) {
    throw new Error("Translation is not configured (missing DEEPL_API_KEY)");
  }
  return cfg.DEEPL_API_KEY;
}

export async function translateText(
  text: string,
  tagHandling?: "html"
): Promise<string> {
  if (!text.trim()) {
    return "";
  }

  const params = new URLSearchParams({
    text,
    source_lang: "FR",
    target_lang: "EN",
  });

  if (tagHandling) {
    params.set("tag_handling", tagHandling);
    // Tell DeepL to ignore our custom mahjong tags
    params.set("ignore_tags", "mahjong-tile,mahjong-hand");
  }

  const res = await fetch(DEEPL_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `DeepL-Auth-Key ${getApiKey()}`,
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`DeepL API error ${res.status}: ${body}`);
    throw new Error(`DeepL translation failed: ${res.status}`);
  }

  const data = await res.json();
  const translated: string = data.translations?.[0]?.text ?? "";

  if (tagHandling === "html") {
    // DeepL adds extra spaces around custom inline tags
    return (
      translated
        // Strip all whitespace between adjacent tiles (no gap between consecutive tiles)
        .replace(/(<\/mahjong-tile>)\s+(<mahjong-tile\b)/g, "$1$2")
        // Collapse multiple spaces around tile tags to a single space
        .replace(/\s{2,}(<mahjong-tile\b)/g, " $1")
        .replace(/(<\/mahjong-tile>)\s{2,}/g, "$1 ")
    );
  }

  return translated;
}

/**
 * Translate article fields from French to English.
 * Content is translated with HTML tag handling so that markup
 * (including custom <mahjong-tile> / <mahjong-hand> tags) is preserved.
 */
export async function translateArticle(fields: {
  title: string;
  summary: string;
  content: string;
}): Promise<{ title: string; summary: string; content: string }> {
  const [title, summary, content] = await Promise.all([
    translateText(fields.title),
    translateText(fields.summary),
    translateText(fields.content, "html"),
  ]);

  return { title, summary, content };
}

export async function translateTournamentGeneralFields(fields: {
  name: string;
  venueAccess: string;
  description: string;
  mealsInfo: string;
}): Promise<{
  name: string;
  venueAccess: string;
  description: string;
  mealsInfo: string;
}> {
  const [name, venueAccess, description, mealsInfo] = await Promise.all([
    translateText(fields.name),
    translateText(fields.venueAccess, "html"),
    translateText(fields.description, "html"),
    translateText(fields.mealsInfo, "html"),
  ]);

  return { name, venueAccess, description, mealsInfo };
}

/**
 * Translate a single rich-text (HTML) field from French to English.
 */
export async function translateHtmlField(text: string): Promise<string> {
  return translateText(text, "html");
}
