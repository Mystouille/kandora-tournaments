import { Link } from "react-router";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "Kandora Tournaments" },
    {
      name: "description",
      content:
        "Self-hostable online mahjong tournament platform with Discord bot integration.",
    },
  ];
}

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-3xl font-bold dark:text-white">
        Kandora Tournaments
      </h1>
      <p className="text-gray-600 dark:text-gray-300">
        Self-hostable online mahjong tournament platform with Discord bot
        integration.
      </p>
      <Link
        to="/online-tournaments"
        className="rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white hover:bg-blue-700"
      >
        Browse online tournaments
      </Link>
    </main>
  );
}
