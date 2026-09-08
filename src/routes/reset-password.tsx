import { createFileRoute } from "@tanstack/react-router";
import { ResetPasswordPage } from "@/components/fly/ResetPasswordPage";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset Password — Fly" },
      { name: "description", content: "Set a new password for your Fly account." },
      { property: "og:title", content: "Reset Password — Fly" },
      { property: "og:description", content: "Set a new password for your Fly account." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResetPasswordPage,
});
