import { Outlet, redirect } from "react-router";
import type { Route } from "./+types/admin";
import { getTournamentAdminAccess } from "../utils/league-permissions.server";

export async function loader({ request }: Route.LoaderArgs) {
  const access = await getTournamentAdminAccess(request);
  if (!access || (!access.isGlobalAdmin && access.tournaments.length === 0)) {
    throw redirect("/");
  }
  return access;
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return <Outlet context={loaderData} />;
}
