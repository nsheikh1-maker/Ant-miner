export type Coin = "ANT" | "zec" | "ansem";

export type World = {
  name: string;
  zone: string;
  goal: number;
  reward: number;
  coin: Coin;
  alt: string;
};

export const WORLDS: World[] = [
  {
    name: "The Entrance",
    zone: "GOLDEN HOLLOW",
    goal: 0,
    reward: 1,
    coin: "ANT",
    alt: "A sunlit canyon mine with timber beams, gold ore, and an ant miner",
  },
  {
    name: "Deep Tunnels",
    zone: "THE UNDERGROUND",
    goal: 100,
    reward: 2,
    coin: "ANT",
    alt: "Lantern-lit underground tunnels with gold veins in the walls",
  },
  {
    name: "Crystal Caves",
    zone: "CRYSTAL KINGDOM",
    goal: 500,
    reward: 3,
    coin: "zec",
    alt: "A glowing cave of teal and rose crystals around a still pool",
  },
  {
    name: "Lava Zone",
    zone: "THE MOLTEN DEPTHS",
    goal: 2_000,
    reward: 5,
    coin: "ANT",
    alt: "A lava mine with magma rivers and black cliffs",
  },
  {
    name: "Sky Mine",
    zone: "ABOVE THE CLOUDS",
    goal: 6_000,
    reward: 8,
    coin: "ansem",
    alt: "Floating islands and rope bridges above the clouds",
  },
  {
    name: "Snow Mountain",
    zone: "FROZEN FRONTIER",
    goal: 15_000,
    reward: 12,
    coin: "zec",
    alt: "A snowy ice mine under pale aurora light",
  },
  {
    name: "Underwater Mine",
    zone: "THE SUNKEN CITY",
    goal: 40_000,
    reward: 20,
    coin: "ansem",
    alt: "Sunken stone arches, coral, and gold chests under the sea",
  },
  {
    name: "Boss Battle",
    zone: "THE FINAL SHOWDOWN",
    goal: 100_000,
    reward: 40,
    coin: "zec",
    alt: "A crystal ant titan looming in a dark arena",
  },
];

export type UnitId =
  | "worker"
  | "digger"
  | "soldier"
  | "drone"
  | "queen"
  | "cart"
  | "train"
  | "heli";

export type Unit = {
  id: UnitId;
  name: string;
  base: number;
  cps: number;
  desc: string;
  vehicle: boolean;
};

export const UNITS: Unit[] = [
  { id: "worker", name: "Worker Ant", base: 15, cps: 0.5, desc: "Every colony starts small.", vehicle: false },
  { id: "digger", name: "Digger Ant", base: 120, cps: 4, desc: "Small ant. Serious pickaxe.", vehicle: false },
  { id: "soldier", name: "Soldier Ant", base: 900, cps: 25, desc: "Protects the precious cargo.", vehicle: false },
  { id: "drone", name: "Drone Swarm", base: 7_000, cps: 150, desc: "Taking the colony sky-high.", vehicle: false },
  { id: "queen", name: "Queen Ant", base: 50_000, cps: 1_000, desc: "Long live the colony.", vehicle: false },
  { id: "cart", name: "Minecart", base: 250, cps: 8, desc: "More cargo. More coins.", vehicle: true },
  { id: "train", name: "Gold Express", base: 2_500, cps: 80, desc: "Full steam ahead.", vehicle: true },
  { id: "heli", name: "Mining Helicopter", base: 20_000, cps: 500, desc: "The sky is not the limit.", vehicle: true },
];

export type Owned = Partial<Record<UnitId, number>>;

export type ColonyData = {
  version: number;
  name: string;
  ant: number;
  zec: number;
  ansem: number;
  total: number;
  pick: number;
  level: number;
  focus: number;
  owned: Owned;
  bossHp: number;
  bossBreaks: number;
  purchasedApplied: number;
  sound: boolean;
  shake: boolean;
  lastTick: number;
};

export const SAVE_VERSION = 1;

export function bossMax(breaks: number): number {
  return 50 + Math.max(0, breaks) * 35;
}

export function colonyCps(owned: Owned): number {
  return UNITS.reduce((sum, unit) => sum + (owned[unit.id] ?? 0) * unit.cps, 0);
}

export function minerCount(owned: Owned): number {
  return UNITS.reduce((sum, unit) => sum + (unit.vehicle ? 0 : (owned[unit.id] ?? 0)), 0);
}

export function unitPrice(base: number, count: number): number {
  if (count >= 500) return Number.POSITIVE_INFINITY;
  const price = Math.ceil(base * 1.15 ** count);
  return Number.isFinite(price) ? price : Number.POSITIVE_INFINITY;
}

export function pickCost(pick: number): number {
  if (pick >= 1e9) return Number.POSITIVE_INFINITY;
  const cost = Math.ceil(100 * pick ** 1.3);
  return Number.isFinite(cost) ? cost : Number.POSITIVE_INFINITY;
}

export function grant(state: ColonyData, baseAmount: number): ColonyData {
  const world = WORLDS[state.level] ?? WORLDS[0];
  const reward = baseAmount * world.reward;
  if (!Number.isFinite(reward) || reward <= 0) return state;
  return {
    ...state,
    ant: state.ant + reward,
    total: state.total + reward,
    zec: state.zec + (world.coin === "zec" ? reward / 100 : 0),
    ansem: state.ansem + (world.coin === "ansem" ? reward / 10 : 0),
  };
}

export function deepestUnlock(before: number, after: number): World | null {
  const crossed = WORLDS.filter((world) => world.goal > 0 && before < world.goal && after >= world.goal);
  return crossed.at(-1) ?? null;
}

export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return (
    sign +
    abs.toLocaleString("en-US", {
      maximumFractionDigits: abs < 10 ? 1 : 0,
    })
  );
}

export function formatRate(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0";
  if (value >= 1e4) return formatAmount(value);
  if (Number.isInteger(value)) return value.toLocaleString("en-US");
  if (value >= 100) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return value.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function formatSide(value: number): string {
  if (!Number.isFinite(value)) return "0.00";
  if (Math.abs(value) >= 1e4) return formatAmount(value);
  return value.toFixed(2);
}

export function formatPrice(value: number): string {
  return Number.isFinite(value) ? `${formatAmount(value)} $ANT` : "MAXED";
}

export function sideGain(world: World, antGain: number): string | null {
  if (world.coin === "zec") return `+${formatSide(antGain / 100)} $zec`;
  if (world.coin === "ansem") return `+${formatSide(antGain / 10)} $ansem`;
  return null;
}

function finite(value: unknown, fallback = 0, max = 1e15): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(0, value));
}

export function freshColony(now = Date.now()): ColonyData {
  return {
    version: SAVE_VERSION,
    name: "Guest Miner",
    ant: 0,
    zec: 0,
    ansem: 0,
    total: 0,
    pick: 1,
    level: 0,
    focus: 0,
    owned: {},
    bossHp: bossMax(0),
    bossBreaks: 0,
    purchasedApplied: 0,
    sound: true,
    shake: true,
    lastTick: now,
  };
}

export function sanitize(raw: unknown, now = Date.now()): ColonyData | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.ant !== "number" && typeof row.total !== "number") return null;

  const owned: Owned = {};
  if (row.owned && typeof row.owned === "object") {
    const bag = row.owned as Record<string, unknown>;
    for (const unit of UNITS) {
      const count = bag[unit.id];
      if (typeof count === "number" && Number.isFinite(count)) {
        owned[unit.id] = Math.max(0, Math.min(500, Math.floor(count)));
      }
    }
  }

  const breaks = Math.min(10_000, Math.floor(finite(row.bossBreaks)));
  let hp = finite(row.bossHp, bossMax(breaks));
  if (hp <= 0) hp = bossMax(breaks);

  const cleaned =
    typeof row.name === "string" ? row.name.replace(/\s+/g, " ").trim().slice(0, 18) : "";

  const lastTick =
    typeof row.lastTick === "number" && row.lastTick > 1e12 ? row.lastTick : now;

  return {
    version: SAVE_VERSION,
    name: cleaned || "Guest Miner",
    ant: finite(row.ant),
    zec: finite(row.zec),
    ansem: finite(row.ansem),
    total: finite(row.total),
    pick: Math.max(1, Math.min(1e9, finite(row.pick, 1))),
    level: Math.min(WORLDS.length - 1, Math.floor(finite(row.level))),
    focus: Math.min(WORLDS.length - 1, Math.floor(finite(row.focus, finite(row.level)))),
    owned,
    bossHp: hp,
    bossBreaks: breaks,
    purchasedApplied: finite(row.purchasedApplied),
    sound: row.sound !== false,
    shake: row.shake !== false,
    lastTick,
  };
}
