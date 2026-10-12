import { create } from "zustand";
import {
  type ColonyData,
  type UnitId,
  UNITS,
  WORLDS,
  bossMax,
  colonyCps,
  deepestUnlock,
  freshColony,
  grant,
  pickCost,
  sanitize,
  unitPrice,
} from "./economy";

export const SAVE_KEY = "ant-mine-v1";
export const PRACTICE_KEY = "ant-mine-practice";
const MODE_KEY = "ant-mine-mode";
const OFFLINE_CAP_SEC = 60 * 60 * 2;

export type PlayMode = "ranked" | "practice";

type Store = ColonyData & {
  hydrated: boolean;
  mode: PlayMode;
  boost: number;
  maintenance: boolean;
  awayAnt: number;
  notice: string | null;
  status: string;
  combo: number;
  lastTapAt: number;
  hydrate: () => void;
  tick: (dt: number) => void;
  tap: () => { gained: number; bonus: number; burst: boolean; unlocked: boolean; combo: number; fever: number };
  buy: (id: UnitId) => boolean;
  upgradePick: () => boolean;
  setFocus: (index: number) => void;
  enterFocus: () => boolean;
  setName: (name: string) => void;
  toggleSound: () => void;
  toggleShake: () => void;
  dismissAway: () => void;
  resetColony: () => void;
  restockPractice: () => void;
  setMode: (mode: PlayMode) => void;
  setLiveRules: (rules: { boost: number; maintenance: boolean }) => void;
  applyPurchased: (antTotal: number) => number;
  importSave: (raw: unknown) => boolean;
};

let saveTimer: number | null = null;
let hydratedOnce = false;

function snapshot(state: ColonyData): ColonyData {
  return {
    version: state.version,
    name: state.name,
    ant: state.ant,
    zec: state.zec,
    ansem: state.ansem,
    total: state.total,
    pick: state.pick,
    level: state.level,
    focus: state.focus,
    owned: state.owned,
    bossHp: state.bossHp,
    bossBreaks: state.bossBreaks,
    purchasedApplied: state.purchasedApplied,
    sound: state.sound,
    shake: state.shake,
    lastTick: state.lastTick,
  };
}

export function persistColony(): void {
  if (typeof window === "undefined") return;
  const state = useColony.getState();
  if (!state.hydrated) return;
  try {
    localStorage.setItem(state.mode === "practice" ? PRACTICE_KEY : SAVE_KEY, JSON.stringify(snapshot(state)));
    localStorage.setItem(MODE_KEY, state.mode);
  } catch {
    useColony.setState({ status: "Device storage unavailable" });
  }
}

function scheduleSave(): void {
  if (typeof window === "undefined" || saveTimer !== null) return;
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    persistColony();
  }, 1200);
}

export function flushSave(): void {
  if (typeof window !== "undefined" && saveTimer !== null) {
    window.clearTimeout(saveTimer);
    saveTimer = null;
  }
  persistColony();
}

function saveKey(mode: PlayMode): string {
  return mode === "practice" ? PRACTICE_KEY : SAVE_KEY;
}

function stockedPractice(name: string, now = Date.now()): ColonyData {
  return {
    ...freshColony(now),
    name: name.trim() || "Guest Miner",
    ant: 2_500,
    total: 800,
    owned: { worker: 4, digger: 1 },
  };
}

function readStored(mode: PlayMode, fallbackName: string, now = Date.now()) {
  let raw: string | null = null;
  let parsed: ColonyData | null = null;
  try {
    raw = localStorage.getItem(saveKey(mode));
    parsed = raw ? sanitize(JSON.parse(raw) as unknown, now) : null;
  } catch {
    parsed = null;
  }
  const base =
    parsed ??
    (mode === "practice" ? stockedPractice(fallbackName, now) : { ...freshColony(now), name: fallbackName.trim() || "Guest Miner" });
  const elapsed = parsed ? Math.max(0, Math.min(OFFLINE_CAP_SEC, (now - base.lastTick) / 1000)) : 0;
  const cps = colonyCps(base.owned);
  let next = { ...base, lastTick: now };
  let awayAnt = 0;
  if (parsed && elapsed > 5 && cps > 0) {
    const granted = grant(next, cps * elapsed);
    awayAnt = granted.ant - next.ant;
    next = { ...granted, lastTick: now };
  }
  const unlocked = parsed ? deepestUnlock(base.total, next.total) : null;
  return {
    data: next,
    awayAnt,
    notice: unlocked ? `${unlocked.name} unlocked` : mode === "practice" && !parsed ? "Free practice shaft stocked" : null,
    broken: Boolean(raw) && !parsed,
  };
}

function rewardMult(state: { mode: PlayMode; maintenance: boolean; boost: number }): number {
  if (state.mode === "ranked" && state.maintenance) return 0;
  return state.boost === 2 || state.boost === 3 ? state.boost : 1;
}

function withNotice(before: number, next: ColonyData, current: string | null): string | null {
  const unlocked = deepestUnlock(before, next.total);
  return unlocked ? `${unlocked.name} unlocked` : current;
}

export const useColony = create<Store>((set, get) => ({
  ...freshColony(),
  hydrated: false,
  mode: "ranked",
  boost: 1,
  maintenance: false,
  awayAnt: 0,
  notice: null,
  status: "Saved on this device",
  combo: 0,
  lastTapAt: 0,

  hydrate: () => {
    if (hydratedOnce || typeof window === "undefined") return;
    hydratedOnce = true;
    const now = Date.now();
    try {
      const storedMode = localStorage.getItem(MODE_KEY) === "practice" ? "practice" : "ranked";
      const loaded = readStored(storedMode, "Guest Miner", now);
      set({
        ...loaded.data,
        mode: storedMode,
        hydrated: true,
        awayAnt: loaded.awayAnt,
        notice: loaded.notice,
        combo: 0,
        lastTapAt: 0,
        status: loaded.broken
          ? "Save was unreadable, so a new colony started"
          : storedMode === "practice"
            ? "Practice stays on this device"
            : "Saved on this device",
      });
    } catch {
      set({ ...freshColony(now), hydrated: true, mode: "ranked", status: "Device storage unavailable" });
    }
  },

  tick: (dt) => {
    const state = get();
    if (!state.hydrated || dt <= 0) return;
    const mult = rewardMult(state);
    if (mult === 0) {
      if (Date.now() - state.lastTick > 1000) {
        set({ lastTick: Date.now() });
        scheduleSave();
      }
      return;
    }
    const cps = colonyCps(state.owned);
    if (cps <= 0) return;
    const next = grant(state, cps * dt * mult);
    set({
      ...next,
      lastTick: Date.now(),
      notice: withNotice(state.total, next, state.notice),
    });
    scheduleSave();
  },

  tap: () => {
    const state = get();
    const world = WORLDS[state.level] ?? WORLDS[0];
    const mult = rewardMult(state);
    if (mult === 0) return { gained: 0, bonus: 0, burst: false, unlocked: false, combo: 0, fever: 1 };
    const now = Date.now();
    const combo = now - state.lastTapAt < 480 ? Math.min(20, state.combo + 1) : 1;
    const fever = combo >= 15 ? 2 : combo >= 8 ? 1.5 : 1;
    let next = grant(state, state.pick * mult * fever);
    const gained = next.ant - state.ant;
    let bonus = 0;
    let burst = false;
    if (state.level === WORLDS.length - 1) {
      const hp = state.bossHp - state.pick;
      if (hp <= 0) {
        const burstState = grant(next, state.pick * 12 * mult);
        bonus = burstState.ant - next.ant;
        const breaks = state.bossBreaks + 1;
        next = { ...burstState, bossBreaks: breaks, bossHp: bossMax(breaks) };
        burst = true;
      } else {
        next = { ...next, bossHp: hp };
      }
    }
    set({
      ...next,
      combo,
      lastTapAt: now,
      lastTick: now,
      notice: withNotice(state.total, next, state.notice),
    });
    scheduleSave();
    return {
      gained,
      bonus,
      burst,
      combo,
      fever,
      unlocked: next.total >= (world.goal || 0) && deepestUnlock(state.total, next.total) !== null,
    };
  },

  buy: (id) => {
    const state = get();
    const unit = UNITS.find((entry) => entry.id === id);
    if (!unit) return false;
    const count = state.owned[id] ?? 0;
    const price = unitPrice(unit.base, count);
    if (!Number.isFinite(price) || state.ant < price) return false;
    set({
      ant: state.ant - price,
      owned: { ...state.owned, [id]: count + 1 },
      lastTick: Date.now(),
    });
    flushSave();
    return true;
  },

  upgradePick: () => {
    const state = get();
    const cost = pickCost(state.pick);
    if (!Number.isFinite(cost) || state.ant < cost) return false;
    set({
      ant: state.ant - cost,
      pick: Math.min(1e9, state.pick * 2),
      lastTick: Date.now(),
    });
    flushSave();
    return true;
  },

  setFocus: (index) => {
    if (index < 0 || index >= WORLDS.length) return;
    set({ focus: index });
    scheduleSave();
  },

  enterFocus: () => {
    const state = get();
    const world = WORLDS[state.focus];
    if (!world || state.total < world.goal) return false;
    if (state.level !== state.focus) {
      set({ level: state.focus });
      flushSave();
    }
    return true;
  },

  setName: (name) => {
    const cleaned = name.replace(/\s+/g, " ").slice(0, 18);
    set({ name: cleaned });
    scheduleSave();
  },

toggleSound: () => {
    set({ sound: !get().sound });
    scheduleSave();
  },
  toggleShake: () => {
    set({ shake: !get().shake });
    scheduleSave();
  },
  dismissAway: () => set({ awayAnt: 0 }),

  resetColony: () => {
    const state = get();
    set({
      ...freshColony(),
      name: state.name.trim() || "Guest Miner",
      sound: state.sound,
      shake: state.shake,
      hydrated: true,
      awayAnt: 0,
      notice: null,
      combo: 0,
      lastTapAt: 0,
      status: state.mode === "practice" ? "Practice stays on this device" : "Saved on this device",
    });
    flushSave();
  },

  restockPractice: () => {
    const state = get();
    if (state.mode !== "practice") return;
    set({
      ...stockedPractice(state.name),
      sound: state.sound,
      shake: state.shake,
      hydrated: true,
      awayAnt: 0,
      notice: "Practice shaft restocked",
      combo: 0,
      lastTapAt: 0,
      status: "Practice stays on this device",
    });
    flushSave();
  },

  setMode: (mode) => {
    const state = get();
    if (!state.hydrated || mode === state.mode) return;
    flushSave();
    const loaded = readStored(mode, state.name.trim() || "Guest Miner");
    set({
      ...loaded.data,
      name: loaded.data.name.trim() || state.name,
      mode,
      hydrated: true,
      boost: state.boost,
      maintenance: state.maintenance,
      sound: state.sound,
      shake: state.shake,
      awayAnt: loaded.awayAnt,
      notice: loaded.notice ?? (mode === "practice" ? "Free practice shaft" : "Ranked mine"),
      combo: 0,
      lastTapAt: 0,
      status: loaded.broken
        ? "Save was unreadable, so a new colony started"
        : mode === "practice"
          ? "Practice stays on this device"
          : "Saved on this device",
    });
    flushSave();
  },

  setLiveRules: ({ boost, maintenance }) => {
    const state = get();
    const nextBoost = boost === 2 || boost === 3 ? boost : 1;
    if (state.boost === nextBoost && state.maintenance === maintenance) return;
    set({ boost: nextBoost, maintenance });
  },

  applyPurchased: (antTotal) => {
    const state = get();
    if (state.mode !== "ranked" || !Number.isFinite(antTotal) || antTotal <= state.purchasedApplied) return 0;
    const delta = antTotal - state.purchasedApplied;
    set({
      ant: state.ant + delta,
      purchasedApplied: antTotal,
      lastTick: Date.now(),
    });
    flushSave();
    return delta;
  },

  importSave: (raw) => {
    const loaded = sanitize(raw);
    if (!loaded) return false;
    set({
      ...loaded,
      lastTick: Date.now(),
      hydrated: true,
      awayAnt: 0,
      notice: null,
      status: "Backup restored",
    });
    flushSave();
    return true;
  },
}));
