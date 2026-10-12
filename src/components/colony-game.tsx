import {
  Check,
  Cloud,
  Coins,
  Download,
  Lock,
  Map,
  Pickaxe,
  Plus,
  RotateCcw,
  Settings,
  Trophy,
  Truck,
  Upload,
  Users,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SignInGate, UserButton } from "@/lib/auth/gates";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getLobby, myGrant } from "@/lib/mine.functions";
import type { Lobby } from "@/lib/mine-shared";
import { BoardModal } from "./board-modal";
import { MineSignIn } from "./mine-sign-in";
import { TreasuryModal } from "./treasury-modal";
import {
  playBurst,
  playBuy,
  playClick,
  playDig,
  playUnlock,
  setAudioEnabled,
  unlockAudio,
} from "../game/audio";
import {
  UNITS,
  WORLDS,
  bossMax,
  colonyCps,
  formatAmount,
  formatPrice,
  formatRate,
  formatSide,
  minerCount,
  pickCost,
  unitPrice,
  type UnitId,
} from "../game/economy";
import { flushSave, PRACTICE_KEY, SAVE_KEY, useColony, type PlayMode } from "../game/store";
import { MineStage } from "./mine-stage";

type Tab = "Mine" | "Upgrades" | "Ants" | "Vehicles" | "Map" | "Shop";

const SHOP_TABS: { id: Tab; label: string }[] = [
  { id: "Mine", label: "All" },
  { id: "Upgrades", label: "Upgrades" },
  { id: "Ants", label: "Ants" },
  { id: "Vehicles", label: "Vehicles" },
  { id: "Shop", label: "Shop" },
];

export function ColonyGame() {
  const colony = useColony();
  const user = useCurrentUser();
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState<Tab>("Mine");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [treasuryOpen, setTreasuryOpen] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    colony.hydrate();
    const booted = useColony.getState();
    const bootWorld = WORLDS[booted.focus] ?? WORLDS[0];
    if (!(booted.mode === "ranked" && booted.maintenance) && booted.total >= bootWorld.goal) {
      booted.enterFocus();
    }
    setPlaying(false);
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      if (acc >= 0.1) {
        const step = acc;
        acc = 0;
        useColony.getState().tick(step);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onHide = () => {
      if (document.visibilityState === "hidden") flushSave();
      else unlockAudio();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushSave);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushSave);
    };
  }, [colony.hydrate]);

  useEffect(() => {
    setAudioEnabled(colony.sound);
  }, [colony.sound]);

  useEffect(() => {
    if (!colony.notice) return;
    const timer = window.setTimeout(() => useColony.setState({ notice: null }), 2600);
    return () => window.clearTimeout(timer);
  }, [colony.notice]);

  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const next = await getLobby();
        if (stop) return;
        setLobby(next);
        useColony.getState().setLiveRules({ boost: next.multiplier, maintenance: next.maintenance });
      } catch {
        // The dig still runs if the office is briefly unreachable.
      }
    }
    void pull();
    const timer = window.setInterval(() => void pull(), 20_000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (colony.mode === "ranked" && colony.maintenance) setPlaying(false);
  }, [colony.mode, colony.maintenance]);

  useEffect(() => {
    if (!user?.id || colony.mode !== "ranked" || !colony.hydrated) return;
    let stop = false;
    void myGrant()
      .then((grant) => {
        if (stop) return;
        const delta = useColony.getState().applyPurchased(grant.antTotal);
        if (delta > 0) {
          useColony.setState({ notice: `+${formatAmount(delta)} $ANT landed in the ranked mine` });
        }
      })
      .catch(() => undefined);
    return () => {
      stop = true;
    };
  }, [user?.id, colony.mode, colony.hydrated]);

  const active = WORLDS[colony.level] ?? WORLDS[0];
  const focus = WORLDS[colony.focus] ?? WORLDS[0];
  const shown = playing ? active : focus;
  const shownIndex = playing ? colony.level : colony.focus;
  const next = WORLDS.find((world) => colony.total < world.goal) ?? null;
  const progress = next ? Math.min(100, (colony.total / next.goal) * 100) : 100;
  const perSec = colonyCps(colony.owned) * active.reward;
  const tapPower = colony.pick * active.reward;
  const miners = minerCount(colony.owned);
  const haulers = (colony.owned.cart ?? 0) + (colony.owned.train ?? 0) + (colony.owned.heli ?? 0);
  const openWorlds = WORLDS.filter((world) => colony.total >= world.goal).length;
  const focusLocked = colony.total < focus.goal;
  const upgrade = pickCost(colony.pick);
  const showPick = tab === "Mine" || tab === "Upgrades" || tab === "Shop" || tab === "Map";
  const units = UNITS.filter((unit) => {
    if (tab === "Upgrades") return false;
    if (tab === "Vehicles") return unit.vehicle;
    if (tab === "Ants") return !unit.vehicle;
    return true;
  });

  function go(nextTab: Tab) {
    setTab(nextTab);
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (nextTab === "Map") {
      document.getElementById("worlds")?.scrollIntoView({ behavior, block: "start" });
    } else if (nextTab !== "Mine") {
      document.getElementById("colony")?.scrollIntoView({ behavior, block: "start" });
    }
  }

  function playFocused() {
    unlockAudio();
    if (!useColony.getState().enterFocus()) return;
    setPlaying(true);
    if (useColony.getState().sound) playClick();
  }

  function leave() {
    setPlaying(false);
    const level = useColony.getState().level;
    useColony.getState().setFocus(level);
    setTab("Map");
    document.getElementById("worlds")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function switchMode(mode: PlayMode) {
    if (mode === useColony.getState().mode) return;
    useColony.getState().setMode(mode);
    setPlaying(false);
  }

  const ranked = colony.mode === "ranked";
  const paused = ranked && colony.maintenance;
  const modal = settingsOpen || boardOpen || treasuryOpen;

  return (
    <main className={playing ? "pit" : "hub"}>
      <header className="topbar">
        <button type="button" className="profile" onClick={() => setSettingsOpen(true)}>
          <img className="avatar" src="/art/avatar.jpg" alt="" width={48} height={48} />
          <span className="profile-copy">
            <strong>{colony.name.trim() || "Guest Miner"}</strong>
            <small>
              LV. {colony.level + 1} <em>{formatAmount(colony.total)} XP</em>
            </small>
            <span
              className="track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress)}
              aria-label={next ? `Progress toward ${next.name}` : "All mines open"}
            >
              <span style={{ width: `${progress}%` }} />
            </span>
          </span>
        </button>
        <div className="wallet">
          <Coin mark="Ƶ" label="zec" value={formatSide(colony.zec)} testId="balance-zec" tone="zec" />
          <Coin mark="✦" label="ANT" value={formatAmount(colony.ant)} testId="balance-ANT" tone="ant" hot />
          <Coin mark="a" label="ansem" value={formatSide(colony.ansem)} testId="balance-ansem" tone="ansem" />
        </div>
        <div className="top-actions">
          <button type="button" className="icon-btn" aria-label="Treasury" onClick={() => setTreasuryOpen(true)}>
            <Coins />
          </button>
          <button type="button" className="icon-btn" aria-label="Leaderboard" onClick={() => setBoardOpen(true)}>
            <Trophy />
          </button>
          <button type="button" className="icon-btn" aria-label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings />
          </button>
        </div>
      </header>

      <div className="mode-switch compact" role="tablist" aria-label="Mine">
        <button
          type="button"
          role="tab"
          aria-selected={ranked}
          className={ranked ? "mode-card on" : "mode-card"}
          onClick={() => switchMode("ranked")}
        >
          <strong>Ranked mine</strong>
          <small>Posts to the board. Purchased $ANT lands here.</small>
        </button>
        <button
          type="button"
          role="tab"
          data-testid="practice-mode"
          aria-selected={!ranked}
          className={ranked ? "mode-card" : "mode-card on"}
          onClick={() => switchMode("practice")}
        >
          <strong>Free practice</strong>
          <small>A separate shaft. No score, no payment.</small>
        </button>
      </div>

      {lobby?.announcement ? (
        <div className="banner" role="status">
          <p>{lobby.announcement}</p>
        </div>
      ) : null}
      {lobby && lobby.multiplier > 1 ? (
        <div className="banner" role="status">
          <p>
            Owner event: <strong>{lobby.multiplier}×</strong> dig rewards
            {ranked ? ", and they count on the board." : " in practice too. Scores still stay off the board."}
          </p>
        </div>
      ) : null}
      {paused ? (
        <div className="banner" role="status">
          <p>The ranked mine is paused. Free practice is still open.</p>
        </div>
      ) : null}

      {colony.awayAnt >= 1 ? (
        <div className="banner" role="status">
          <p>
            While you were away the colony dug <strong>+{formatAmount(colony.awayAnt)} $ANT</strong>.
          </p>
          <button type="button" className="text-btn" onClick={() => colony.dismissAway()}>
            Nice
          </button>
        </div>
      ) : null}

      {playing ? (
      <section className="pit-stage">
        <MineStage
          playing={playing && !modal}
          world={shown}
          worldIndex={shownIndex}
          tapPower={tapPower}
          perSec={perSec}
          total={colony.total}
          miners={miners}
          haulers={haulers}
          locked={focusLocked}
          closed={paused}
          eyebrow={ranked ? "The colony is calling" : "Free practice shaft"}
          playingLabel={ranked ? undefined : "Free practice"}
          status={ranked ? "Ranked mine" : "Practice shaft"}
          shake={colony.shake}
          boss={
            playing && colony.level === WORLDS.length - 1
              ? { hp: colony.bossHp, max: bossMax(colony.bossBreaks), breaks: colony.bossBreaks }
              : null
          }
          onPlay={playFocused}
          onLeave={leave}
          onDig={() => {
            unlockAudio();
            const before = useColony.getState().notice;
            const result = useColony.getState().tap();
            const sound = useColony.getState().sound;
            if (sound) {
              if (result.burst || result.fever >= 2) playBurst();
              else playDig();
              if (result.unlocked && useColony.getState().notice !== before) playUnlock();
            }
            return result;
          }}
        />
      </section>
      ) : (
      <>
      <section className="hub-hero">
        <p>The colony is calling</p>
        <h1>ANT MINE</h1>
        <p className="hub-coins">$zec · $ANT · $ansem</p>
        <p className="colony-online">
          Colony online <strong>{formatRate(perSec)} $ANT / sec</strong>
        </p>
      </section>
      <button
        type="button"
        className="play-card"
        disabled={focusLocked || paused}
        onClick={playFocused}
      >
        <img src={`/art/world-${shownIndex}.jpg`} alt="" width={960} height={540} />
        <span className="play-card-copy">
          <small>{shown.zone}</small>
          <strong>
            Play level {shownIndex + 1} · {shown.name}
          </strong>
          <em>{focusLocked ? `${formatAmount(focus.goal)} $ANT to unlock` : `${shown.reward}× rewards`}</em>
        </span>
      </button>
      <section className="band" id="worlds">
        <div className="section-head">
          <h2>
            <Map aria-hidden="true" /> Explore the mines
          </h2>
          <span>
            {openWorlds} / {WORLDS.length} worlds unlocked
          </span>
        </div>
        <div className="world-grid">
          {WORLDS.map((world, index) => {
            const locked = colony.total < world.goal;
            const selected = colony.focus === index;
            return (
              <button
                key={world.name}
                type="button"
                className={`world-tile${selected ? " selected" : ""}${locked ? " locked" : ""}`}
                aria-label={`Level ${index + 1}: ${world.name}${locked ? ", locked" : ""}`}
                onClick={() => {
                  if (locked) {
                    useColony.setState({ notice: `${world.name} needs ${formatAmount(world.goal)} $ANT` });
                    return;
                  }
                  colony.setFocus(index);
                  if (useColony.getState().enterFocus()) setPlaying(true);
                }}
              >
                <img src={`/art/world-${index}.jpg`} alt="" width={640} height={360} loading="lazy" />
                <span className="tile-shade" />
                <span className="tile-top">
                  <span>LEVEL {String(index + 1).padStart(2, "0")}</span>
                  {locked ? <Lock aria-hidden="true" /> : selected ? <Check aria-hidden="true" /> : <i className="unlocked-dot" />}
                </span>
                <span className="tile-bottom">
                  <strong>{world.name}</strong>
                  <span>
                    {locked ? `${formatAmount(world.goal)} $ANT to unlock` : `${world.reward}× rewards`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="band" id="colony">
        <div className="section-head">
          <h2>
            <Users aria-hidden="true" /> Your colony
          </h2>
          <span>
            {miners} miners · level {colony.level + 1}
          </span>
        </div>
        <div className="colony-grid">
          <div className="stats">
            <Stat label="Total mined" value={formatAmount(colony.total)} unit="$ANT" />
            <Stat label="Mining power" value={formatRate(perSec)} unit="/ sec" />
            <Stat label="Pickaxe" value={formatAmount(tapPower)} unit="/ tap" />
            <div className="next-world">
              <span>{next ? "Next world" : "All worlds unlocked"}</span>
              <strong>{next?.name ?? "Colony legend"}</strong>
              <div
                className="track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
                aria-label={next ? `Progress toward ${next.name}` : "All mines open"}
              >
                <span style={{ width: `${progress}%` }} />
              </div>
              <small>
                {next ? `${formatAmount(colony.total)} / ${formatAmount(next.goal)} $ANT` : "The entire mine is yours."}
              </small>
            </div>
            <p className="save-line">
              <Cloud aria-hidden="true" /> {colony.status}
            </p>
          </div>
          <div className="shop">
            <div className="tabs" role="tablist" aria-label="Colony shop">
              {SHOP_TABS.map((item) => {
                const on = tab === item.id || (item.id === "Mine" && tab === "Map");
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    className={on ? "tab active" : "tab"}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>
            <div className="shop-grid">
              {showPick ? (
                <button
                  type="button"
                  className="shop-item"
                  disabled={!Number.isFinite(upgrade) || colony.ant < upgrade}
                  onClick={() => {
                    if (useColony.getState().upgradePick() && useColony.getState().sound) playBuy();
                  }}
                >
                  <span className="shop-icon">
                    <Pickaxe aria-hidden="true" />
                  </span>
                  <span className="shop-copy">
                    <strong>Pickaxe upgrade</strong>
                    <small>
                      Tap power {formatAmount(colony.pick)} → {formatAmount(Math.min(1e9, colony.pick * 2))}
                    </small>
                    <span className="price">{formatPrice(upgrade)}</span>
                  </span>
                  <Plus aria-hidden="true" />
                </button>
              ) : null}
              {units.map((unit) => {
                const count = colony.owned[unit.id] ?? 0;
                const price = unitPrice(unit.base, count);
                const rate = unit.cps * active.reward;
                return (
                  <button
                    key={unit.id}
                    type="button"
                    className="shop-item"
                    disabled={!Number.isFinite(price) || colony.ant < price}
                    onClick={() => buyUnit(unit.id)}
                  >
                    <span className="shop-icon">{unit.vehicle ? <Truck aria-hidden="true" /> : <Users aria-hidden="true" />}</span>
                    <span className="shop-copy">
                      <strong>
                        {unit.name} <em>×{count}</em>
                      </strong>
                      <small>{unit.desc}</small>
                      <small>
                        +{formatRate(rate)} $ANT / sec
                      </small>
                      <span className="price">{formatPrice(price)}</span>
                    </span>
                    <Plus aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>
      </>
      )}

      {colony.notice ? (
        <p className="toast" role="status">
          {colony.notice}
        </p>
      ) : null}

      {boardOpen ? (
        <BoardModal
          name={colony.name.trim() || "Guest Miner"}
          total={colony.total}
          level={colony.level + 1}
          ranked={ranked}
          onClose={() => setBoardOpen(false)}
        />
      ) : null}

      {treasuryOpen ? (
        <TreasuryModal
          lobby={lobby}
          name={colony.name.trim() || "Guest Miner"}
          ranked={ranked}
          onClose={() => setTreasuryOpen(false)}
          onCredited={(antTotal) => {
            if (useColony.getState().mode !== "ranked") useColony.getState().setMode("ranked");
            const delta = useColony.getState().applyPurchased(antTotal);
            if (delta > 0) useColony.setState({ notice: `+${formatAmount(delta)} $ANT from the treasury` });
          }}
        />
      ) : null}

      {settingsOpen ? (
        <Modal title="Colony settings" subtitle="Ranked scores post when you sign in. Practice stays on this device." onClose={() => { setSettingsOpen(false); setConfirmReset(false); }}>
          <div className="settings-actions">
            <SignInGate fallback={<MineSignIn />}>
              <UserButton />
            </SignInGate>
            <Link to="/owner" className="ghost-btn">
              Owner office
            </Link>
          </div>
          <label className="field">
            Miner name
            <input
              value={colony.name}
              maxLength={18}
              onChange={(event) => colony.setName(event.target.value)}
              onBlur={() => {
                if (!colony.name.trim()) colony.setName("Guest Miner");
              }}
            />
          </label>
          <div className="settings-actions">
            <button type="button" className="ghost-btn" onClick={() => colony.toggleSound()}>
              {colony.sound ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
              Sound {colony.sound ? "on" : "off"}
            </button>
            <button type="button" className="ghost-btn" onClick={() => colony.toggleShake()}>
              Shake {colony.shake ? "on" : "off"}
            </button>
            {!ranked ? (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  colony.restockPractice();
                  setPlaying(false);
                }}
              >
                <RotateCcw aria-hidden="true" /> Restock practice
              </button>
            ) : null}
            <button type="button" className="ghost-btn" onClick={downloadSave}>
              <Download aria-hidden="true" /> Export save
            </button>
            <button type="button" className="ghost-btn" onClick={() => fileRef.current?.click()}>
              <Upload aria-hidden="true" /> Import save
            </button>
            <input
              ref={fileRef}
              className="file-input"
              type="file"
              accept="application/json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                void file.text().then((text) => {
                  try {
                    const ok = useColony.getState().importSave(JSON.parse(text) as unknown);
                    useColony.setState({
                      status: ok ? "Backup restored" : "That file is not an Ant Mine save",
                    });
                    if (ok) {
                      setPlaying(false);
                      setSettingsOpen(false);
                    }
                  } catch {
                    useColony.setState({ status: "That file is not an Ant Mine save" });
                  }
                });
              }}
            />
            {confirmReset ? (
              <button
                type="button"
                className="danger-btn"
                onClick={() => {
                  colony.resetColony();
                  setPlaying(false);
                  setConfirmReset(false);
                  setSettingsOpen(false);
                }}
              >
                <RotateCcw aria-hidden="true" /> Yes, wipe this colony
              </button>
            ) : (
              <button type="button" className="danger-btn" onClick={() => setConfirmReset(true)}>
                <RotateCcw aria-hidden="true" /> Reset colony
              </button>
            )}
          </div>
          <p className="fine">{colony.status}</p>
        </Modal>
      ) : null}
    </main>
  );
}

function buyUnit(id: UnitId) {
  if (useColony.getState().buy(id) && useColony.getState().sound) playBuy();
}

function downloadSave() {
  flushSave();
  const mode = useColony.getState().mode;
  const key = mode === "practice" ? PRACTICE_KEY : SAVE_KEY;
  const raw = localStorage.getItem(key) ?? "{}";
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = mode === "practice" ? "ant-mine-practice.json" : "ant-mine-save.json";
  link.click();
  URL.revokeObjectURL(url);
}

function Coin({
  mark,
  label,
  value,
  testId,
  tone,
  hot = false,
}: {
  mark: string;
  label: string;
  value: string;
  testId: string;
  tone: "zec" | "ant" | "ansem";
  hot?: boolean;
}) {
  return (
    <div className={`coin coin-${tone}${hot ? " coin-hot" : ""}`}>
      <span className="mark" aria-hidden="true">
        {tone === "ant" ? <img className="coin-art" src="/art/coin.png" alt="" width={28} height={28} /> : mark}
      </span>
      <span className="coin-label">${label}</span>
      <strong key={value} className="coin-value" data-testid={testId}>
        {value}
      </strong>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong>
        {value} <small>{unit}</small>
      </strong>
    </div>
  );
}

function Modal({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

