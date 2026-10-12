export type MineNetwork = "mainnet" | "devnet";

export type Pack = {
  id: string;
  name: string;
  lamports: number;
  ant: number;
  blurb: string;
};

export type Lobby = {
  wallet: string;
  network: MineNetwork;
  shopEnabled: boolean;
  multiplier: number;
  announcement: string;
  maintenance: boolean;
  packs: Pack[];
};

export const DEFAULT_PACKS: Pack[] = [
  {
    id: "pebble",
    name: "Pebble sack",
    lamports: 50_000_000,
    ant: 5_000,
    blurb: "A head start for the first tunnels.",
  },
  {
    id: "vein",
    name: "Rich vein",
    lamports: 150_000_000,
    ant: 20_000,
    blurb: "Enough $ANT to hire a real crew.",
  },
  {
    id: "lode",
    name: "Motherlode",
    lamports: 400_000_000,
    ant: 80_000,
    blurb: "Spendable $ANT. The board still counts what you dig.",
  },
];

export const TIP_PRESETS = [20_000_000, 50_000_000, 100_000_000];

export const MIN_LAMPORTS = 10_000_000;
export const MAX_LAMPORTS = 50_000_000_000;

export function lamportsToSolString(lamports: number): string {
  const whole = Math.floor(lamports / 1_000_000_000);
  const frac = lamports % 1_000_000_000;
  if (frac === 0) return String(whole);
  return `${whole}.${String(frac).padStart(9, "0").replace(/0+$/, "")}`;
}

export function formatSol(lamports: number): string {
  const text = lamportsToSolString(lamports);
  const [whole, frac] = text.split(".");
  const grouped = Number(whole).toLocaleString("en-US");
  return frac ? `${grouped}.${frac}` : grouped;
}

export function parseSolInput(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const lamports = Number(whole) * 1_000_000_000 + Number(frac.padEnd(9, "0"));
  if (!Number.isSafeInteger(lamports) || lamports < MIN_LAMPORTS || lamports > MAX_LAMPORTS) return null;
  return lamports;
}

export function paymentUrl(input: {
  wallet: string;
  lamports: number;
  reference: string;
  memo: string;
  message: string;
}): string {
  const query = [
    `amount=${encodeURIComponent(lamportsToSolString(input.lamports))}`,
    `reference=${encodeURIComponent(input.reference)}`,
    `label=${encodeURIComponent("Ant Mine")}`,
    `message=${encodeURIComponent(input.message)}`,
    `memo=${encodeURIComponent(input.memo)}`,
  ].join("&");
  return `solana:${input.wallet}?${query}`;
}

export function explorerTx(signature: string, network: MineNetwork): string {
  const base = `https://solscan.io/tx/${encodeURIComponent(signature)}`;
  return network === "devnet" ? `${base}?cluster=devnet` : base;
}

export function parsePacks(raw: string): Pack[] {
  if (!raw.trim()) return DEFAULT_PACKS;
  try {
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data) || data.length < 1 || data.length > 4) return DEFAULT_PACKS;
    const packs: Pack[] = [];
    for (const item of data) {
      const pack = readPack(item);
      if (!pack) return DEFAULT_PACKS;
      packs.push(pack);
    }
    return packs;
  } catch {
    return DEFAULT_PACKS;
  }
}

export function readPack(item: unknown): Pack | null {
  if (!item || typeof item !== "object") return null;
  const row = item as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const lamports = Number(row.lamports);
  const ant = Number(row.ant);
  const blurb = typeof row.blurb === "string" ? row.blurb.slice(0, 80) : "";
  if (!/^[a-z0-9-]{2,16}$/.test(id)) return null;
  if (name.length < 1 || name.length > 24) return null;
  if (!Number.isSafeInteger(lamports) || lamports < MIN_LAMPORTS || lamports > MAX_LAMPORTS) return null;
  if (!Number.isFinite(ant) || ant < 1 || ant > 1_000_000_000) return null;
  return { id, name, lamports, ant: Math.floor(ant), blurb };
}

export function cleanMinerName(name: string): string {
  const cleaned = name.replace(/\s+/g, " ").trim().slice(0, 18);
  return cleaned || "Guest Miner";
}

export function cleanAnnouncement(value: string): string {
  return value.replace(/[\u0000-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
}
