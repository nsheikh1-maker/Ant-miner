type AudioCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = true;

function ctor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const host = window as unknown as {
    AudioContext?: AudioCtor;
    webkitAudioContext?: AudioCtor;
  };
  return host.AudioContext ?? host.webkitAudioContext ?? null;
}

function context(): AudioContext | null {
  const Ctor = ctor();
  if (!Ctor) return null;
  if (!ctx) {
    ctx = new Ctor({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = enabled ? 0.85 : 0;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function unlockAudio(): void {
  context();
}

export function setAudioEnabled(on: boolean): void {
  enabled = on;
  if (master && ctx) master.gain.setTargetAtTime(on ? 0.85 : 0, ctx.currentTime, 0.02);
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0): void {
  const audio = context();
  if (!audio || !master || !enabled) return;
  const start = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const amp = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.012);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(amp);
  amp.connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.03);
}

export function playDig(): void {
  const jitter = 0.92 + Math.random() * 0.16;
  tone(170 * jitter, 0.07, "sine", 0.07);
  tone(620 * jitter, 0.05, "square", 0.025);
}

export function playBuy(): void {
  tone(523, 0.08, "triangle", 0.045);
  tone(659, 0.1, "triangle", 0.045, 0.07);
  tone(784, 0.14, "triangle", 0.04, 0.14);
}

export function playUnlock(): void {
  [523, 659, 784, 1046].forEach((freq, index) => {
    tone(freq, 0.16, "triangle", 0.05, index * 0.08);
  });
}

export function playBurst(): void {
  tone(90, 0.22, "sine", 0.09);
  tone(420, 0.1, "square", 0.035);
  tone(840, 0.16, "square", 0.028, 0.06);
}

export function playClick(): void {
  tone(680, 0.05, "triangle", 0.04);
}
