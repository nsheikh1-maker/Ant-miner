import { createFileRoute, Link } from "@tanstack/react-router";
import { SignInGate, UserButton } from "@/lib/auth/gates";
import { formatAmount } from "@/game/economy";
import { claimOwner, loadOwner, saveOwner, setScoreHidden, type OwnerOrder, type OwnerScore } from "@/lib/mine.functions";
import { explorerTx, formatSol, lamportsToSolString, parseSolInput, type Lobby, type MineNetwork, type Pack } from "@/lib/mine-shared";
import { useEffect, useState } from "react";
import { MineSignIn } from "@/components/mine-sign-in";

const OWNER_KEY = "ant-mine-owner-key";

export const Route = createFileRoute("/owner")({
  component: OwnerPage,
});

type DraftPack = { id: string; name: string; sol: string; ant: string; blurb: string };

function toDraft(packs: Pack[]): DraftPack[] {
  return packs.map((pack) => ({
    id: pack.id,
    name: pack.name,
    sol: lamportsToSolString(pack.lamports),
    ant: String(pack.ant),
    blurb: pack.blurb,
  }));
}

function OwnerPage() {
  return (
    <main className="office">
      <p className="eyebrow">Ant Mine</p>
      <h1>Owner office</h1>
      <p className="fine">
        Packs and tips send real SOL to your wallet. Set the key and address before you share the game. Publishing
        starts a fresh office, so set them again on the live app.
      </p>
      <SignInGate fallback={<MineSignIn callbackURL="/owner" />}>
        <Office />
      </SignInGate>
      <Link to="/" className="text-btn office-back">
        Back to the mine
      </Link>
    </main>
  );
}

function Office() {
  const [key, setKey] = useState("");
  const [confirm, setConfirm] = useState("");
  const [wallet, setWallet] = useState("");
  const [network, setNetwork] = useState<MineNetwork>("mainnet");
  const [claimed, setClaimed] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [config, setConfig] = useState<Lobby | null>(null);
  const [shopEnabled, setShopEnabled] = useState(false);
  const [multiplier, setMultiplier] = useState(1);
  const [announcement, setAnnouncement] = useState("");
  const [maintenance, setMaintenance] = useState(false);
  const [packs, setPacks] = useState<DraftPack[]>([]);
  const [orders, setOrders] = useState<OwnerOrder[]>([]);
  const [scores, setScores] = useState<OwnerScore[]>([]);
  const [totals, setTotals] = useState<{ network: MineNetwork; lamports: number; count: number }[]>([]);

  function applyConfig(next: Lobby) {
    setConfig(next);
    setWallet(next.wallet);
    setNetwork(next.network);
    setShopEnabled(next.shopEnabled);
    setMultiplier(next.multiplier);
    setAnnouncement(next.announcement);
    setMaintenance(next.maintenance);
    setPacks(toDraft(next.packs));
  }

  async function refresh(ownerKey: string) {
    const result = await loadOwner({ data: { key: ownerKey } });
    if (!result.ok) {
      setNote(result.error);
      if (result.error === "That owner key is wrong.") {
        localStorage.removeItem(OWNER_KEY);
        setUnlocked(false);
      }
      return;
    }
    setClaimed(result.claimed);
    setUnlocked(result.unlocked);
    if (result.unlocked) {
      applyConfig(result.config);
      setOrders(result.orders);
      setScores(result.scores);
      setTotals(result.totals);
      setNote(null);
    }
  }

  useEffect(() => {
    const stored = localStorage.getItem(OWNER_KEY) ?? "";
    if (stored) setKey(stored);
    void refresh(stored).catch(() => setNote("The office didn't answer."));
  }, []);

  async function claim() {
    if (key.trim() !== confirm.trim()) {
      setNote("The two keys don't match.");
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      const result = await claimOwner({ data: { key: key.trim(), wallet: wallet.trim(), network } });
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      localStorage.setItem(OWNER_KEY, key.trim());
      await refresh(key.trim());
    } catch {
      setNote("Couldn't claim the office.");
    } finally {
      setBusy(false);
    }
  }

  async function unlock() {
    setBusy(true);
    setNote(null);
    try {
      localStorage.setItem(OWNER_KEY, key.trim());
      await refresh(key.trim());
    } catch {
      setNote("Couldn't open the office.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const nextPacks: Pack[] = [];
    for (const pack of packs) {
      const lamports = parseSolInput(pack.sol);
      const ant = Number(pack.ant);
      if (lamports === null || !Number.isFinite(ant)) {
        setNote(`Check ${pack.name || "a pack"}: 0.01–50 SOL and a whole $ANT amount.`);
        return;
      }
      nextPacks.push({
        id: pack.id,
        name: pack.name.trim(),
        lamports,
        ant: Math.floor(ant),
        blurb: pack.blurb.trim(),
      });
    }
    setBusy(true);
    setNote(null);
    try {
      const stored = localStorage.getItem(OWNER_KEY) ?? key.trim();
      const result = await saveOwner({
        data: {
          key: stored,
          wallet: wallet.trim(),
          network,
          shopEnabled,
          multiplier,
          announcement,
          maintenance,
          packs: nextPacks,
        },
      });
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      await refresh(stored);
      setNote("Saved. Players pick this up within a few seconds.");
    } catch {
      setNote("Couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  async function hide(userId: string, hidden: boolean) {
    const stored = localStorage.getItem(OWNER_KEY) ?? key;
    const result = await setScoreHidden({ data: { key: stored, userId, hidden } });
    if (!result.ok) {
      setNote(result.error);
      return;
    }
    await refresh(stored);
  }

  if (claimed === null) return <p className="fine">Checking the office…</p>;

  if (!claimed) {
    return (
      <div className="settings-actions">
        <label className="field">
          Owner key
          <input type="password" value={key} autoComplete="new-password" onChange={(event) => setKey(event.target.value)} />
        </label>
        <label className="field">
          Confirm key
          <input type="password" value={confirm} autoComplete="new-password" onChange={(event) => setConfirm(event.target.value)} />
        </label>
        <label className="field">
          Your Solana wallet
          <input value={wallet} spellCheck={false} autoCapitalize="off" onChange={(event) => setWallet(event.target.value.trim())} />
        </label>
        <NetworkPick network={network} onChange={setNetwork} />
        <button type="button" className="gold-btn" disabled={busy} onClick={() => void claim()}>
          {busy ? "Saving…" : "Claim the mine"}
        </button>
        {note ? <p className="fine">{note}</p> : null}
      </div>
    );
  }

  if (!unlocked) {
    return (
      <div className="settings-actions">
        <label className="field">
          Owner key
          <input type="password" value={key} autoComplete="current-password" onChange={(event) => setKey(event.target.value)} />
        </label>
        <button type="button" className="gold-btn" disabled={busy} onClick={() => void unlock()}>
          {busy ? "Checking…" : "Unlock office"}
        </button>
        {note ? <p className="fine">{note}</p> : null}
      </div>
    );
  }

  return (
    <div className="office-grid">
      <section>
        <div className="account-row">
          <UserButton />
        </div>
        <label className="field">
          Solana wallet
          <input value={wallet} spellCheck={false} autoCapitalize="off" onChange={(event) => setWallet(event.target.value.trim())} />
        </label>
        <NetworkPick network={network} onChange={setNetwork} />
        <div className="tip-row">
          <button type="button" className={shopEnabled ? "gold-btn" : "ghost-btn"} onClick={() => setShopEnabled(true)}>
            Treasury open
          </button>
          <button type="button" className={!shopEnabled ? "gold-btn" : "ghost-btn"} onClick={() => setShopEnabled(false)}>
            Treasury closed
          </button>
        </div>
        <p className="fine">Dig multiplier. 2× and 3× count on the leaderboard.</p>
        <div className="tip-row">
          {[1, 2, 3].map((value) => (
            <button key={value} type="button" className={multiplier === value ? "gold-btn" : "ghost-btn"} onClick={() => setMultiplier(value)}>
              {value}×
            </button>
          ))}
        </div>
        <label className="field">
          Announcement
          <textarea value={announcement} maxLength={140} onChange={(event) => setAnnouncement(event.target.value)} />
        </label>
        <div className="tip-row">
          <button type="button" className={maintenance ? "gold-btn" : "ghost-btn"} onClick={() => setMaintenance(true)}>
            Pause ranked
          </button>
          <button type="button" className={!maintenance ? "gold-btn" : "ghost-btn"} onClick={() => setMaintenance(false)}>
            Ranked open
          </button>
        </div>
        <p className="fine">Practice stays open while ranked is paused.</p>
        {packs.map((pack, index) => (
          <div key={pack.id} className="pack-edit">
            <label className="field">
              Pack name
              <input
                value={pack.name}
                maxLength={24}
                onChange={(event) => updatePack(index, { name: event.target.value })}
              />
            </label>
            <div className="pack-split">
              <label className="field">
                SOL
                <input value={pack.sol} inputMode="decimal" onChange={(event) => updatePack(index, { sol: event.target.value })} />
              </label>
              <label className="field">
                $ANT
                <input value={pack.ant} inputMode="numeric" onChange={(event) => updatePack(index, { ant: event.target.value })} />
              </label>
            </div>
            <label className="field">
              Note
              <input value={pack.blurb} maxLength={80} onChange={(event) => updatePack(index, { blurb: event.target.value })} />
            </label>
          </div>
        ))}
        <button type="button" className="gold-btn" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save controls"}
        </button>
        {note ? <p className="fine">{note}</p> : null}
        {config ? <p className="fine">Players currently see {config.shopEnabled ? "an open" : "a closed"} treasury.</p> : null}
      </section>
      <section>
        <h2>Deposits</h2>
        {totals.length === 0 ? <p className="fine">No confirmed SOL yet.</p> : null}
        <ul className="plain-list">
          {totals.map((row) => (
            <li key={row.network}>
              {row.network} · {formatSol(row.lamports)} SOL · {row.count} payments
            </li>
          ))}
        </ul>
        <ul className="plain-list">
          {orders.map((order) => (
            <li key={order.id}>
              <strong>{order.payerName}</strong> · {order.kind === "tip" ? "tip" : `${formatAmount(order.antCredit)} $ANT`} ·{" "}
              {formatSol(order.lamports)} SOL
              <small>
                {order.createdAt} UTC
                {order.signature ? (
                  <>
                    {" "}
                    ·{" "}
                    <a href={explorerTx(order.signature, order.network)} target="_blank" rel="noreferrer">
                      View transaction
                    </a>
                  </>
                ) : null}
              </small>
            </li>
          ))}
        </ul>
        <h2>Board</h2>
        {scores.length === 0 ? <p className="fine">Nobody has posted.</p> : null}
        <ul className="plain-list">
          {scores.map((score) => (
            <li key={score.userId}>
              <strong>
                {score.name}
                {score.hidden ? " · hidden" : ""}
              </strong>
              <small>
                {formatAmount(score.total)} $ANT · level {score.level}
                {score.supporter ? " · supporter" : ""}
              </small>
              <button type="button" className="text-btn" onClick={() => void hide(score.userId, !score.hidden)}>
                {score.hidden ? "Show" : "Hide"}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );

  function updatePack(index: number, patch: Partial<DraftPack>) {
    setPacks((current) => current.map((pack, item) => (item === index ? { ...pack, ...patch } : pack)));
  }
}

function NetworkPick({ network, onChange }: { network: MineNetwork; onChange: (network: MineNetwork) => void }) {
  return (
    <div className="tip-row">
      <button type="button" className={network === "mainnet" ? "gold-btn" : "ghost-btn"} onClick={() => onChange("mainnet")}>
        Mainnet
      </button>
      <button type="button" className={network === "devnet" ? "gold-btn" : "ghost-btn"} onClick={() => onChange("devnet")}>
        Devnet
      </button>
    </div>
  );
}
