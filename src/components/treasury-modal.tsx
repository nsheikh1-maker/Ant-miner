import { SignInGate } from "@/lib/auth/gates";
import { formatAmount } from "@/game/economy";
import { createOrder, verifyPayment } from "@/lib/mine.functions";
import { TIP_PRESETS, formatSol, parseSolInput, type Lobby, type MineNetwork } from "@/lib/mine-shared";
import { useState } from "react";
import { GameModal } from "./game-modal";
import { MineSignIn } from "./mine-sign-in";

type Ticket = {
  orderId: string;
  url: string;
  sol: string;
  wallet: string;
  network: MineNetwork;
  memo: string;
  ant: number;
  kind: "ant" | "tip";
};

export function TreasuryModal({
  lobby,
  name,
  ranked,
  onClose,
  onCredited,
}: {
  lobby: Lobby | null;
  name: string;
  ranked: boolean;
  onClose: () => void;
  onCredited: (antTotal: number) => void;
}) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [signature, setSignature] = useState("");
  const [tip, setTip] = useState("0.05");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const area = document.createElement("textarea");
      area.value = value;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(label);
  }

  async function buy(kind: "ant" | "tip", packId?: string, lamports?: number) {
    setBusy(true);
    setNote(null);
    try {
      const result = await createOrder({ data: { kind, packId, lamports, name } });
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      setTicket(result);
      setSignature("");
    } catch {
      setNote("Sign in before paying.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!ticket) return;
    setBusy(true);
    setNote(null);
    try {
      const result = await verifyPayment({ data: { orderId: ticket.orderId, signature } });
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      if (result.kind === "ant") onCredited(result.antTotal);
      setNote(
        result.kind === "tip"
          ? "Tip received. You're marked as a supporter on the board."
          : `Payment confirmed. ${formatAmount(result.antCredit)} $ANT is in your ranked mine.`,
      );
      setTicket(null);
      setSignature("");
    } catch {
      setNote("Couldn't confirm that payment. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const open = lobby?.shopEnabled && lobby.wallet;

  return (
    <GameModal
      title="Treasury"
      subtitle="SOL goes to the colony wallet. Game $ANT cannot be withdrawn."
      onClose={onClose}
    >
      {!lobby ? <p className="fine">Opening the treasury…</p> : null}
      {lobby && !open ? (
        <p className="fine">The treasury is closed until the owner sets a Solana wallet in the office.</p>
      ) : null}
      {lobby && open ? (
        <>
          <p className="fine">
            {lobby.network === "devnet" ? "Devnet — this is test SOL, not mainnet." : "Mainnet SOL. This is a real transfer."}{" "}
            {ranked
              ? "Packs credit the ranked mine you're in."
              : "You're in practice. Packs still credit your ranked mine, not this shaft."}
          </p>
          {ticket ? (
            <div className="pay-box">
              <p>
                Send <strong>{ticket.sol} SOL</strong>
                {ticket.kind === "ant" ? ` for ${formatAmount(ticket.ant)} $ANT` : " as a tip"}.
              </p>
              <p className="pay-address">{ticket.wallet}</p>
              <p className="fine">Memo {ticket.memo}. Open wallet so the payment is tagged.</p>
              <div className="settings-actions">
                <a className="gold-btn" href={ticket.url}>
                  Open wallet
                </a>
                <button type="button" className="ghost-btn" onClick={() => void copy("link", ticket.url)}>
                  {copied === "link" ? "Link copied" : "Copy payment link"}
                </button>
                <button type="button" className="ghost-btn" onClick={() => void copy("address", ticket.wallet)}>
                  {copied === "address" ? "Address copied" : "Copy address"}
                </button>
                <label className="field">
                  Transaction signature
                  <input
                    value={signature}
                    spellCheck={false}
                    autoCapitalize="off"
                    onChange={(event) => setSignature(event.target.value.trim())}
                    placeholder="Paste the signature after you pay"
                  />
                </label>
                <button type="button" className="gold-btn" disabled={busy || signature.length < 32} onClick={() => void confirm()}>
                  {busy ? "Checking Solana…" : "Confirm deposit"}
                </button>
                <button type="button" className="ghost-btn" onClick={() => setTicket(null)}>
                  Back
                </button>
              </div>
            </div>
          ) : (
            <SignInGate
              fallback={
                <>
                  <p className="fine">Sign in so the $ANT can be tied to you.</p>
                  <MineSignIn />
                </>
              }
            >
              <div className="shop-grid">
                {lobby.packs.map((pack) => (
                  <button
                    key={pack.id}
                    type="button"
                    className="shop-item"
                    disabled={busy}
                    onClick={() => void buy("ant", pack.id)}
                  >
                    <span className="shop-copy">
                      <strong>{pack.name}</strong>
                      <small>{pack.blurb}</small>
                      <span className="price">
                        {formatAmount(pack.ant)} $ANT · {formatSol(pack.lamports)} SOL
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="tip-box">
                <strong>Tip the colony</strong>
                <p className="fine">A gift. No $ANT. Supporters get a mark on the board.</p>
                <div className="tip-row">
                  {TIP_PRESETS.map((lamports) => (
                    <button key={lamports} type="button" className="ghost-btn" disabled={busy} onClick={() => void buy("tip", undefined, lamports)}>
                      {formatSol(lamports)} SOL
                    </button>
                  ))}
                </div>
                <label className="field">
                  Custom tip in SOL
                  <input value={tip} inputMode="decimal" onChange={(event) => setTip(event.target.value)} />
                </label>
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  onClick={() => {
                    const lamports = parseSolInput(tip);
                    if (lamports === null) {
                      setNote("Tips are between 0.01 and 50 SOL.");
                      return;
                    }
                    void buy("tip", undefined, lamports);
                  }}
                >
                  Send custom tip
                </button>
              </div>
            </SignInGate>
          )}
        </>
      ) : null}
      {note ? (
        <p className="fine">
          {note}{" "}
          {ticket === null && note.startsWith("Payment") && lobby ? null : null}
        </p>
      ) : null}
      {note?.startsWith("Tip received") || note?.startsWith("Payment confirmed") ? (
        <p className="fine">The SOL is in the colony wallet. Game coins stay in the mine.</p>
      ) : null}
    </GameModal>
  );
}

