type ParsedIx = {
  program?: string;
  programId?: string;
  parsed?: unknown;
};

const SYSTEM = "11111111111111111111111111111111";
const MEMO = "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr";

function instructions(tx: unknown): ParsedIx[] {
  const root = tx as {
    transaction?: { message?: { instructions?: ParsedIx[] } };
    meta?: { innerInstructions?: { instructions?: ParsedIx[] }[] };
  };
  const out: ParsedIx[] = [];
  const top = root.transaction?.message?.instructions;
  if (Array.isArray(top)) out.push(...top);
  const inner = root.meta?.innerInstructions;
  if (Array.isArray(inner)) {
    for (const group of inner) {
      if (Array.isArray(group?.instructions)) out.push(...group.instructions);
    }
  }
  return out;
}

function accounts(tx: unknown): string[] {
  const root = tx as {
    transaction?: { message?: { accountKeys?: unknown[] } };
    meta?: { loadedAddresses?: { writable?: unknown[]; readonly?: unknown[] } };
  };
  const out: string[] = [];
  const keys = root.transaction?.message?.accountKeys;
  if (Array.isArray(keys)) {
    for (const key of keys) {
      if (typeof key === "string") out.push(key);
      else if (key && typeof key === "object" && typeof (key as { pubkey?: unknown }).pubkey === "string") {
        out.push((key as { pubkey: string }).pubkey);
      }
    }
  }
  const loaded = root.meta?.loadedAddresses;
  for (const list of [loaded?.writable, loaded?.readonly]) {
    if (!Array.isArray(list)) continue;
    for (const key of list) if (typeof key === "string") out.push(key);
  }
  return out;
}

function memoText(ix: ParsedIx): string | null {
  const memoProgram = ix.program === "spl-memo" || ix.programId === MEMO;
  if (!memoProgram) return null;
  if (typeof ix.parsed === "string") return ix.parsed;
  if (!ix.parsed || typeof ix.parsed !== "object") return null;
  const parsed = ix.parsed as { info?: unknown };
  if (typeof parsed.info === "string") return parsed.info;
  if (parsed.info && typeof parsed.info === "object" && typeof (parsed.info as { memo?: unknown }).memo === "string") {
    return (parsed.info as { memo: string }).memo;
  }
  return null;
}

export type PaymentCheck = {
  ok: boolean;
  reason: string;
};

export function checkSolPayment(
  tx: unknown,
  expected: { wallet: string; lamports: number; reference: string; memo: string },
): PaymentCheck {
  const root = tx as { meta?: { err?: unknown } | null };
  if (!tx || typeof tx !== "object") return { ok: false, reason: "That signature isn't on Solana yet. Wait a few seconds and try again." };
  if (!root.meta) return { ok: false, reason: "That signature isn't confirmed yet." };
  if (root.meta.err) return { ok: false, reason: "That transaction failed in the wallet." };

  const ixs = instructions(tx);
  let lamports = 0;
  const memos: string[] = [];
  for (const ix of ixs) {
    const memo = memoText(ix);
    if (memo) memos.push(memo);
    const parsed = ix.parsed;
    if (!parsed || typeof parsed !== "object") continue;
    const row = parsed as { type?: string; info?: { destination?: string; source?: string; lamports?: number } };
    const system = ix.program === "system" || ix.programId === SYSTEM;
    if (!system || row.type !== "transfer" || !row.info) continue;
    if (row.info.destination !== expected.wallet || row.info.source === expected.wallet) continue;
    const paid = Number(row.info.lamports);
    if (Number.isFinite(paid) && paid > 0) lamports += paid;
  }

  const tagged = accounts(tx).includes(expected.reference) || memos.some((memo) => memo.includes(expected.memo));
  if (!tagged) {
    return {
      ok: false,
      reason: "That payment isn't tagged with this order. Use Open wallet so the memo is included, then paste that signature.",
    };
  }
  if (lamports < expected.lamports) {
    return { ok: false, reason: "The SOL sent is less than this order." };
  }
  return { ok: true, reason: "" };
}
