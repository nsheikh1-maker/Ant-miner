import { createFileRoute, Link } from "@tanstack/react-router";
import { MineSignIn } from "@/components/mine-sign-in";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  return (
    <main className="office">
      <p className="eyebrow">Ant Mine</p>
      <h1>Sign in</h1>
      <p className="fine">Post a ranked score, buy $ANT, or tip the colony. Free practice never needs an account.</p>
      <MineSignIn />
      <Link to="/" className="text-btn office-back">
        Back to the mine
      </Link>
    </main>
  );
}
