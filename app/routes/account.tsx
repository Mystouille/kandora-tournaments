import AccountPage from "~/core/ui/AccountPage";
import { normalizeLocalReturnPath } from "~/utils/gameReturnPath";

export function meta() {
  return [
    { title: "Account Settings - TNT Paris Mahjong" },
    { name: "description", content: "Manage your account settings" },
  ];
}

export function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  return {
    setupReturnTo: normalizeLocalReturnPath(
      url.searchParams.get("returnTo"),
      "/"
    ),
  };
}

export default function AccountRoute({
  loaderData,
}: {
  loaderData: { setupReturnTo: string };
}) {
  return <AccountPage setupReturnTo={loaderData.setupReturnTo} />;
}
