import { createFileRoute } from "@tanstack/react-router";
import { FlyApp } from "@/components/fly/FlyApp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Fly — Social App" },
      {
        name: "description",
        content:
          "Fly — a social app with posts, stories, reels, messaging, groups and calls.",
      },
      { property: "og:title", content: "Fly — Social App" },
      {
        property: "og:description",
        content:
          "Fly — a social app with posts, stories, reels, messaging, groups and calls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  return <FlyApp />;
}
