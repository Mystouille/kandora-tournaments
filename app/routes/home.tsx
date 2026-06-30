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
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-bold dark:text-white">
        Kandora Tournaments
      </h1>
      <p className="text-gray-600 dark:text-gray-300">
        Self-hostable online mahjong tournament platform with Discord bot
        integration. Scaffolding in progress.
      </p>
    </main>
  );
}
