import { useEffect, useRef } from "react";
import { formatAmount, type World } from "../game/economy";

type Boss = { hp: number; max: number; breaks: number };

type Mote = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  spin: number;
  vr: number;
  kind: "gold" | "rock" | "label";
  text: string;
};

type Crack = { x1: number; y1: number; x2: number; y2: number };

type Live = {
  playing: boolean;
  miners: number;
  haulers: number;
  perSec: number;
  shake: boolean;
  boss: Boss | null;
  world: World;
};

function loadImage(src: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = src;
  return image;
}

type Art = {
  cave: HTMLImageElement;
  vein: HTMLImageElement;
  coin: HTMLImageElement;
  ants: HTMLImageElement[];
};

let artCache: Art | null = null;

function getArt(): Art | null {
  if (typeof Image === "undefined") return null;
  if (!artCache) {
    artCache = {
      cave: loadImage("/art/mine-pit.jpg"),
      vein: loadImage("/art/vein.webp"),
      coin: loadImage("/art/coin.png"),
      ants: [1, 2, 3, 4].map((frame) => loadImage(`/art/ant-${frame}.png`)),
    };
  }
  return artCache;
}

function ready(image: HTMLImageElement | null | undefined): image is HTMLImageElement {
  return !!image && image.complete && image.naturalWidth > 0;
}

function drawCover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, width: number, height: number) {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  ctx.drawImage(image, (width - dw) * 0.5, (height - dh) * 0.62, dw, dh);
}

type Props = {
  playing: boolean;
  world: World;
  miners: number;
  haulers: number;
  perSec: number;
  shake: boolean;
  boss: Boss | null;
  onDig: () => {
    gained: number;
    bonus: number;
    burst: boolean;
    combo: number;
    fever: number;
  };
};

export function MineCanvas({ playing, world, miners, haulers, perSec, shake, boss, onDig }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onDigRef = useRef(onDig);
  const live = useRef<Live>({ playing, miners, haulers, perSec, shake, boss, world });
  live.current = { playing, miners, haulers, perSec, shake, boss, world };
  onDigRef.current = onDig;

  const fx = useRef({
    motes: [] as Mote[],
    cracks: [] as Crack[],
    squash: 0,
    combo: 0,
    fever: 1,
    holding: false,
    holdAcc: 0,
    autoAcc: 0,
    hits: 0,
    pointer: { x: 0, y: 0 },
  });

  const strikeRef = useRef<(x: number, y: number) => void>(() => undefined);
  strikeRef.current = (clientX, clientY) => {
    const canvas = canvasRef.current;
    const view = live.current;
    if (!canvas || !view.playing) return;
    const rect = canvas.getBoundingClientRect();
    const result = onDigRef.current();
    if (result.gained <= 0 && result.bonus <= 0) return;
    const state = fx.current;
    state.combo = result.combo;
    state.fever = result.fever;
    state.squash = 1;
    state.hits += 1;
    const label =
      result.fever > 1 ? `+${formatAmount(result.gained)}  ${result.fever}×` : `+${formatAmount(result.gained)}`;
    spray(fx.current.motes, clientX - rect.left, clientY - rect.top, label, result.burst || result.fever > 1);
    if (result.bonus > 0) {
      spray(fx.current.motes, rect.width / 2, rect.height * 0.48, `BURST +${formatAmount(result.bonus)}`, true);
    }
    if (state.cracks.length > 16) state.cracks.length = 0;
    const angle = Math.random() * Math.PI * 2;
    const reach = 0.28 + Math.random() * 0.28;
    state.cracks.push({
      x1: Math.cos(angle) * 0.04,
      y1: Math.sin(angle) * 0.04,
      x2: Math.cos(angle) * reach,
      y2: Math.sin(angle) * reach,
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const state = fx.current;
      const view = live.current;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      if (state.holding && view.playing) {
        state.holdAcc += dt;
        if (state.holdAcc >= 0.12) {
          state.holdAcc = 0;
          strikeRef.current(state.pointer.x, state.pointer.y);
        }
      }
      if (view.playing && view.perSec > 0 && !media.matches) {
        state.autoAcc += dt;
        if (state.autoAcc >= 0.42) {
          state.autoAcc = 0;
          state.squash = Math.max(state.squash, 0.45);
          spray(state.motes, width * 0.5 + (Math.random() - 0.5) * 40, height * 0.52, "", false);
        }
      }
      state.squash = Math.max(0, state.squash - dt * 3.4);

      const dpr = canvas.width / Math.max(1, width);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);

      let ox = 0;
      let oy = 0;
      if (view.shake && !media.matches && state.squash > 0.08) {
        ox = (Math.random() - 0.5) * 10 * state.squash;
        oy = (Math.random() - 0.5) * 8 * state.squash;
      }
      ctx.save();
      ctx.translate(ox, oy);

      const pictures = getArt();
      if (pictures && ready(pictures.cave)) drawCover(ctx, pictures.cave, width, height);
      else {
        ctx.fillStyle = "#1a120c";
        ctx.fillRect(0, 0, width, height);
      }

      const count = view.playing ? Math.min(7, Math.max(1, view.miners)) : 0;
      const ant = pictures?.ants[Math.floor(now / 140) % 4];
      const floor = height * 0.8;
      if (count > 0 && ready(ant)) {
        for (let index = 0; index < count; index += 1) {
          const speed = 78 + (index % 3) * 16;
          const span = width + 140;
          const x = ((now / 1000) * speed + index * (span / count)) % span - 70;
          const bob = media.matches ? 0 : Math.sin(now / 150 + index) * 2;
          const size = index === 0 && view.haulers > 0 ? 96 : 76;
          const near = Math.abs(x + size / 2 - width / 2) < 70;
          const swing = near && state.squash > 0.2 ? -0.35 : 0;
          ctx.save();
          ctx.translate(x + size / 2, floor - size / 2 + bob);
          ctx.rotate(swing);
          ctx.drawImage(ant, -size / 2, -size / 2, size, size);
          ctx.restore();
        }
      }

      if (view.playing && pictures && ready(pictures.vein)) {
        const vw = Math.min(width * 0.38, 250);
        const vh = vw * (pictures.vein.naturalHeight / Math.max(1, pictures.vein.naturalWidth));
        const top = height * 0.46 - vh / 2;
        const pulse = 1 + Math.sin(Math.min(1, state.squash) * Math.PI) * 0.14;
        ctx.save();
        ctx.translate(width / 2, top + vh * 0.62);
        ctx.scale(pulse, 2 - pulse);
        ctx.translate(-width / 2, -(top + vh * 0.62));
        if (state.fever > 1) {
          ctx.shadowColor = "#ffd36a";
          ctx.shadowBlur = 28;
        }
        ctx.drawImage(pictures.vein, width / 2 - vw / 2, top, vw, vh);
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(42, 18, 8, 0.9)";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        for (const crack of state.cracks) {
          ctx.beginPath();
          ctx.moveTo(width / 2 + crack.x1 * vw, top + vh * 0.48 + crack.y1 * vh);
          ctx.lineTo(width / 2 + crack.x2 * vw, top + vh * 0.48 + crack.y2 * vh);
          ctx.stroke();
        }
        if (state.combo > 1) {
          ctx.font = "700 26px Pixelify Sans, sans-serif";
          ctx.fillStyle = "#2a1c08";
          ctx.textAlign = "center";
          ctx.fillText(`${state.combo}×`, width / 2, top + 36);
        }
        ctx.restore();
      }

      if (view.boss && view.playing) {
        const ratio = Math.max(0, Math.min(1, view.boss.hp / view.boss.max));
        const barW = Math.min(280, width - 48);
        const barX = (width - barW) / 2;
        ctx.fillStyle = "rgba(12, 18, 24, 0.72)";
        ctx.fillRect(barX, 78, barW, 10);
        ctx.fillStyle = ratio < 0.35 ? "#d4534a" : "#f0c14b";
        ctx.fillRect(barX, 78, barW * ratio, 10);
      }

      for (let index = state.motes.length - 1; index >= 0; index -= 1) {
        const mote = state.motes[index];
        mote.life -= dt;
        if (mote.life <= 0) {
          state.motes.splice(index, 1);
          continue;
        }
        if (mote.kind !== "label") mote.vy += 640 * dt;
        mote.x += mote.vx * dt;
        mote.y += mote.vy * dt;
        mote.spin += mote.vr * dt;
        ctx.save();
        ctx.globalAlpha = Math.max(0, mote.life / mote.max);
        ctx.translate(mote.x, mote.y);
        if (mote.kind === "label") {
          ctx.font = "700 22px Pixelify Sans, Barlow, sans-serif";
          ctx.fillStyle = "#ffe7a3";
          ctx.strokeStyle = "#2a1c08";
          ctx.lineWidth = 4;
          ctx.textAlign = "center";
          ctx.strokeText(mote.text, 0, 0);
          ctx.fillText(mote.text, 0, 0);
        } else if (mote.kind === "gold" && pictures && ready(pictures.coin)) {
          ctx.rotate(mote.spin);
          ctx.drawImage(pictures.coin, -mote.size / 2, -mote.size / 2, mote.size, mote.size);
        } else {
          ctx.rotate(mote.spin);
          ctx.fillStyle = "#6a4630";
          ctx.fillRect(-mote.size / 2, -mote.size / 2, mote.size, mote.size * 0.65);
        }
        ctx.restore();
      }

      if (view.playing && state.hits === 0) {
        const blink = 0.65 + Math.sin(now / 220) * 0.35;
        ctx.globalAlpha = blink;
        ctx.font = "700 20px Pixelify Sans, sans-serif";
        ctx.fillStyle = "#ffe7a3";
        ctx.textAlign = "center";
        ctx.fillText("HOLD ANYWHERE", width / 2, height * 0.9);
        ctx.globalAlpha = 1;
      }

      ctx.restore();
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.repeat || !live.current.playing) return;
      if (event.code !== "Space" && event.code !== "Enter") return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("input, textarea, a, [role='dialog']")) return;
      if (target?.closest("button")) return;
      event.preventDefault();
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      fx.current.holding = true;
      fx.current.pointer = { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.5 };
      strikeRef.current(fx.current.pointer.x, fx.current.pointer.y);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space" || event.code === "Enter") fx.current.holding = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="mine-canvas"
      data-dig="true"
      aria-label={playing ? `Dig ${world.name}. Hold to mine.` : world.name}
      onPointerDown={(event) => {
        if (!playing || event.button !== 0) return;
        event.preventDefault();
        fx.current.holding = true;
        fx.current.pointer = { x: event.clientX, y: event.clientY };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* The first hit still counts. */
        }
        strikeRef.current(event.clientX, event.clientY);
      }}
      onPointerMove={(event) => {
        if (!fx.current.holding) return;
        fx.current.pointer = { x: event.clientX, y: event.clientY };
      }}
      onPointerUp={() => {
        fx.current.holding = false;
      }}
      onPointerCancel={() => {
        fx.current.holding = false;
      }}
    />
  );
}

function spray(motes: Mote[], x: number, y: number, text: string, heavy: boolean) {
  const count = heavy ? 14 : 8;
  for (let index = 0; index < count; index += 1) {
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.5;
    const speed = (heavy ? 240 : 150) + Math.random() * 140;
    motes.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 90,
      life: 0.65 + Math.random() * 0.25,
      max: 0.9,
      size: 10 + Math.random() * 10,
      spin: Math.random() * 6,
      vr: (Math.random() - 0.5) * 10,
      kind: index % 4 === 0 ? "rock" : "gold",
      text: "",
    });
  }
  if (text) {
    motes.push({
      x,
      y: y - 16,
      vx: (Math.random() - 0.5) * 16,
      vy: -70,
      life: 0.8,
      max: 0.8,
      size: 18,
      spin: 0,
      vr: 0,
      kind: "label",
      text,
    });
  }
}
