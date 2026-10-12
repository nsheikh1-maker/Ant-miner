import { ChevronRight, Play, Zap } from "lucide-react";
import { type PointerEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { formatAmount, formatRate, formatSide, type World } from "../game/economy";
import { MineCanvas } from "./mine-canvas";

export type DigResult = {
  gained: number;
  bonus: number;
  burst: boolean;
  unlocked: boolean;
  combo: number;
  fever: number;
};

type Pop = {
  id: number;
  x: number;
  y: number;
  text: string;
  kind: "ant" | "side" | "burst";
};

type Spark = { id: number; x: number; y: number; dx: number; dy: number };

type Boss = { hp: number; max: number; breaks: number };

type Props = {
  playing: boolean;
  world: World;
  worldIndex: number;
  tapPower: number;
  perSec: number;
  total: number;
  miners: number;
  haulers: number;
  locked: boolean;
  closed?: boolean;
  eyebrow?: string;
  playingLabel?: string;
  status?: string;
  shake: boolean;
  boss: Boss | null;
  onPlay: () => void;
  onLeave: () => void;
  onDig: () => DigResult;
};

export function MineStage({
  playing,
  world,
  worldIndex,
  tapPower,
  perSec,
  total,
  miners,
  haulers,
  locked,
  closed = false,
  eyebrow,
  playingLabel,
  status = "Colony online",
  shake,
  boss,
  onPlay,
  onLeave,
  onDig,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLElement>(null);
  const oreRef = useRef<HTMLImageElement>(null);
  const trauma = useRef(0);
  const timer = useRef<number | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const popId = useRef(0);
  const pointed = useRef(false);
  const onDigRef = useRef(onDig);
  const worldRef = useRef(world);
  const [pops, setPops] = useState<Pop[]>([]);
  const [sparks, setSparks] = useState<Spark[]>([]);
  const [combo, setCombo] = useState(0);
  const [fever, setFever] = useState(1);
  const [step, setStep] = useState(0);
  const [flashOn, setFlashOn] = useState(false);

  onDigRef.current = onDig;
  worldRef.current = world;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    const loop = (time: number) => {
      trauma.current = Math.max(0, trauma.current - 0.016 * 1.8);
      const mag = shake && !media.matches ? trauma.current ** 2 : 0;
      if (mag > 0.001) {
        const ox = Math.sin(time * 0.05) * 8 * mag;
        const oy = Math.cos(time * 0.073) * 6 * mag;
        const rot = Math.sin(time * 0.04) * 1.1 * mag;
        frame.style.transform = `translate(${ox}px, ${oy}px) rotate(${rot}deg)`;
      } else {
        frame.style.transform = "";
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [shake]);

  useEffect(() => {
    const id = window.setInterval(() => setStep((frame) => (frame + 1) % 4), 140);
    return () => window.clearInterval(id);
  }, []);

  function stopHold() {
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }

  function spawn(x: number, y: number, text: string, kind: Pop["kind"]) {
    const id = ++popId.current;
    setPops((current) => [...current.slice(-16), { id, x, y, text, kind }]);
    window.setTimeout(() => {
      setPops((current) => current.filter((pop) => pop.id !== id));
    }, 880);
  }

  function punch() {
    const ore = oreRef.current;
    if (!ore) return;
    ore.classList.remove("pulse");
    void ore.offsetWidth;
    ore.classList.add("pulse");
  }

  function fire(clientX: number, clientY: number) {
    const scene = sceneRef.current;
    if (!scene) return;
    const rect = scene.getBoundingClientRect();
    const result = onDigRef.current();
    const mine = worldRef.current;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    last.current = { x: clientX, y: clientY };
    setCombo(result.combo);
    setFever(result.fever);
    const label = result.fever > 1 ? `+${formatAmount(result.gained)}  ${result.fever}×` : `+${formatAmount(result.gained)} $ANT`;
    spawn(x, y - 18, label, result.fever > 1 || result.burst ? "burst" : "ant");
    const side =
      mine.coin === "zec"
        ? `+${formatSide(result.gained / 100)} $zec`
        : mine.coin === "ansem"
          ? `+${formatSide(result.gained / 10)} $ansem`
          : null;
    if (side) spawn(x + 16, y + 22, side, "side");
    if (result.bonus > 0) spawn(x, y - 26, `VEIN BURST +${formatAmount(result.bonus)}`, "burst");
    trauma.current = Math.min(1, trauma.current + (result.burst ? 0.8 : result.fever > 1 ? 0.5 : 0.32));
    punch();
    const burst = Array.from({ length: result.burst ? 8 : 5 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / (result.burst ? 8 : 5) + Math.random() * 0.4;
      const dist = 36 + Math.random() * 42;
      return {
        id: ++popId.current,
        x,
        y,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
      };
    });
    setSparks((current) => [...current.slice(-24), ...burst]);
    window.setTimeout(() => {
      const ids = new Set(burst.map((spark) => spark.id));
      setSparks((current) => current.filter((spark) => !ids.has(spark.id)));
    }, 420);
    if (result.burst) {
      setFlashOn(true);
      window.setTimeout(() => setFlashOn(false), 160);
    }
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    pointed.current = true;
    fire(event.clientX, event.clientY);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic or unsupported pointers still mine on the first hit. */
    }
    stopHold();
    timer.current = window.setInterval(() => {
      fire(last.current.x, last.current.y);
    }, 150);
  }

  function clickDig(event: MouseEvent<HTMLButtonElement>) {
    if (pointed.current) {
      pointed.current = false;
      return;
    }
    fire(event.clientX, event.clientY);
  }

  useEffect(() => () => stopHold(), []);

  const sideLabel =
    world.coin === "zec"
      ? ` · +${formatSide(tapPower / 100)} $zec`
      : world.coin === "ansem"
        ? ` · +${formatSide(tapPower / 10)} $ansem`
        : "";

  return (
    <section className="scene" ref={sceneRef} aria-label={playing ? world.name : "Ant Mine"}>
      <MineCanvas
        playing={playing}
        world={world}
        miners={miners}
        haulers={haulers}
        perSec={perSec}
        shake={shake}
        boss={boss}
        onDig={onDig}
      />
      {!playing && !locked && !closed ? (
        <button type="button" className="dig" aria-label={`Play ${world.name}`} onClick={onPlay} />
      ) : null}
      <span className={flashOn ? "flash on" : "flash"} />
      <div className="hud">
        {playing ? (
          <div className="playing-top">
            <p className="zone">
              {playingLabel ?? `Level ${worldIndex + 1}`}
              <button type="button" className="text-btn" onClick={onLeave}>
                Worlds
              </button>
            </p>
            <h1 className="play-name">{world.name}</h1>
            <p className="production">
              <Zap aria-hidden="true" />
              {formatAmount(tapPower)} $ANT / tap{sideLabel}
            </p>
            {boss ? (
              <div className="boss">
                <div className="boss-top">
                  <span>The Vein Titan</span>
                  <span>
                    {Math.max(0, Math.ceil(boss.hp))} / {boss.max}
                  </span>
                </div>
                <div
                  className="track"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={boss.max}
                  aria-valuenow={Math.max(0, Math.ceil(boss.hp))}
                  aria-label="Vein titan core"
                >
                  <span style={{ width: `${Math.max(0, Math.min(100, (boss.hp / boss.max) * 100))}%` }} />
                </div>
                <small>{boss.breaks === 0 ? "Crack the core" : `Cores cracked · ${boss.breaks}`}</small>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="poster">
            <p className="eyebrow">{eyebrow ?? "The colony is calling"}</p>
            <h1 className="poster-title">
              <span>ANT</span>
              MINE
            </h1>
            <p className="title-coins">
              <span>$zec</span>
              <span>$ANT</span>
              <span>$ansem</span>
            </p>
          </div>
        )}
        <div className="cta">
          {playing ? (
            <p className="key-hint">Ants walk the tunnel · tap to dig faster</p>
          ) : (
            <>
              <p className="zone">
                <i className="live-dot" aria-hidden="true" />
                {world.zone}
              </p>
              <button type="button" className="play-btn" onClick={onPlay} disabled={locked || closed}>
                <Play aria-hidden="true" fill="currentColor" />
                <span>
                  <b>{closed ? "CLOSED" : locked ? "LOCKED" : "PLAY"}</b>
                  <small>
                    {closed
                      ? "RANKED MINE IS PAUSED"
                      : locked
                        ? `${formatAmount(world.goal)} $ANT TO UNLOCK`
                        : `LEVEL ${worldIndex + 1} · ${world.name.toUpperCase()}`}
                  </small>
                </span>
                <ChevronRight aria-hidden="true" />
              </button>
              {total === 0 ? <p className="hint">Tap the vein. Hire ants. Open deeper mines.</p> : null}
            </>
          )}
        </div>
      </div>
      <div className="scene-bottom">
        <span>
          <i className="live-dot" aria-hidden="true" /> {status}
        </span>
        <span>
          <Zap aria-hidden="true" /> {formatRate(perSec)} $ANT / sec
        </span>
      </div>
    </section>
  );
}
