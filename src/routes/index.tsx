import { createFileRoute } from "@tanstack/react-router";
import { ColonyGame } from "../components/colony-game";

export const Route = createFileRoute("/")({
  component: ColonyGame,
  head: () => ({
    links: [{ rel: "preload", as: "image", href: "/art/mine-pit.jpg" }],
  }),
});
