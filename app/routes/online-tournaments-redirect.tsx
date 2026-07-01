import { redirect } from "react-router";

/**
 * The tournament list now lives at the app home page ("/"). This legacy route
 * keeps the old "/online-tournaments" URL working (portal link, Discord bot
 * messages, bookmarks) by redirecting to the home page.
 */
export function loader() {
  return redirect("/");
}

export default function OnlineTournamentsRedirect() {
  return null;
}
