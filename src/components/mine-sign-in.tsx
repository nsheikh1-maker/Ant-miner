import { GROK_PROVIDERS, signIn } from "@/lib/auth/client";

export function MineSignIn({ callbackURL = "/" }: { callbackURL?: string }) {
  return (
    <div className="settings-actions">
      {GROK_PROVIDERS.map((provider) => (
        <button
          key={provider.providerId}
          type="button"
          className="ghost-btn"
          onClick={() => signIn(provider.providerId, { callbackURL })}
        >
          Continue with {provider.label}
        </button>
      ))}
    </div>
  );
}
