import { redirect, type LoaderFunctionArgs } from "react-router";

export async function loader({ params, request }: LoaderFunctionArgs) {
  const slug = params.slug;
  const stage = params.stage;

  if (!slug || !stage) {
    throw redirect("/");
  }

  const url = new URL(request.url);
  const target = new URL(`/live/${slug}/${stage}`, url.origin);
  target.searchParams.set("view", "games");

  const theme = url.searchParams.get("theme");
  const interval = url.searchParams.get("interval");
  const index = url.searchParams.get("index");
  if (theme) {
    target.searchParams.set("theme", theme);
  }
  if (interval) {
    target.searchParams.set("interval", interval);
  }
  if (index) {
    target.searchParams.set("index", index);
  }

  throw redirect(`${target.pathname}${target.search}`);
}
