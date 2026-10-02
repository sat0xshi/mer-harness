import type { Settings } from "./api";
export type Sound =
  | "tap"
  | "check"
  | "buckle"
  | "pikon"
  | "sold"
  | "coin"
  | "ship"
  | "levelup"
  | "streak"
  | "combo";
type Wave = OscillatorType | "triangle-with-octave";
interface Note {
  frequency: number;
  at: number;
  duration: number;
  peak: number;
  wave: Wave;
  attack?: number;
  to?: number;
  lowpass?: boolean;
  vibrato?: boolean;
}
const note = (
  frequency: number,
  at: number,
  duration: number,
  peak: number,
  wave: Wave = "sine",
  extra: Partial<Note> = {},
): Note => ({ frequency, at, duration, peak, wave, ...extra });
// DESIGN §6 recipes. Composite level-up wave counts as one voice and includes
// triangle + half-volume sine one octave below. This keeps overlapping tails <=4.
export const SOUND_RECIPES: Record<Sound, Note[]> = {
  tap: [note(660, 0, 0.1, 0.12, "triangle", { attack: 0.005 })],
  check: [note(880, 0, 0.13, 0.14, "sine", { attack: 0.005, to: 990 })],
  buckle: [note(180, 0, 0.06, 0.18, "square", { attack: 0.005 })],
  pikon: [
    note(988, 0, 0.28, 0.22),
    note(1976, 0, 0.28, 0.066, "triangle"),
    note(1319, 0.09, 0.45, 0.22, "sine", { vibrato: true }),
    note(2638, 0.09, 0.45, 0.066, "triangle"),
  ],
  sold: [
    ...[784, 988, 1319].map((f, i) => note(f, i * 0.08, 0.25, 0.24, "triangle")),
    ...[1319, 1661, 1976].map((f) => note(f, 0.42, 0.7, 0.08)),
  ],
  coin: [
    note(1319, 0, 0.15, 0.1, "square", { attack: 0.005, lowpass: true }),
    note(1976, 0.05, 0.15, 0.1, "square", { attack: 0.005, lowpass: true }),
  ],
  ship: [
    note(180, 0, 0.06, 0.18, "square", { attack: 0.005 }),
    note(1047, 0.08, 0.4, 0.2, "sine", { to: 1568 }),
  ],
  levelup: [523, 659, 784, 1047, 1319].map((f, i) =>
    note(f, i * 0.07, i === 4 ? 0.9 : 0.22, 0.24, "triangle-with-octave"),
  ),
  streak: [
    note(587, 0, 0.3, 0.16, "sine", { attack: 0.02 }),
    note(880, 0.1, 0.3, 0.16, "sine", { attack: 0.02 }),
  ],
  combo: [note(784, 0, 0.18, 0.15, "triangle", { attack: 0.005 })],
};
let context: AudioContext | undefined;
const scheduled: { start: number; end: number }[] = [];
export function unlockAudio() {
  try {
    context ??= new AudioContext();
    void context.resume();
  } catch {
    /* Visual feedback remains available. */
  }
}
export function playSound(name: Sound, settings: Settings, n = 0) {
  const hour = new Date().getHours();
  if (
    !settings.sound ||
    settings.quiet ||
    document.visibilityState !== "visible" ||
    (settings.night && (hour >= 22 || hour < 7)) ||
    context?.state !== "running"
  )
    return;
  const ctx = context,
    now = ctx.currentTime,
    master = ctx.createGain();
  master.gain.value = settings.volume * (settings.soft ? 0.5 : 1);
  master.connect(ctx.destination);
  for (let i = scheduled.length - 1; i >= 0; i--)
    if (scheduled[i].end <= now) scheduled.splice(i, 1);
  function reserve(at: number, duration: number) {
    const start = now + at,
      end = start + duration;
    const overlaps = scheduled.filter((v) => v.start < end && v.end > start);
    if (overlaps.length >= 8) return false;
    scheduled.push({ start, end });
    return true;
  }
  function envelope(at: number, duration: number, peak: number, attack = 0.008) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now + at);
    gain.gain.exponentialRampToValueAtTime(peak, now + at + Math.max(0.005, attack));
    gain.gain.exponentialRampToValueAtTime(0.0001, now + at + duration);
    return gain;
  }
  for (const spec of SOUND_RECIPES[name]) {
    if (!reserve(spec.at, spec.duration)) continue;
    const oscillator = ctx.createOscillator(),
      gain = envelope(spec.at, spec.duration, spec.peak, spec.attack);
    const f = spec.frequency * (name === "combo" ? 2 ** (Math.max(0, Math.min(7, n)) / 12) : 1);
    if (spec.wave === "triangle-with-octave") {
      const real = new Float32Array(34),
        imag = new Float32Array(34);
      imag[1] = 0.5;
      for (let harmonic = 1; harmonic < 16; harmonic += 2)
        imag[harmonic * 2] = ((8 / Math.PI ** 2) * (-1) ** ((harmonic - 1) / 2)) / harmonic ** 2;
      oscillator.setPeriodicWave(ctx.createPeriodicWave(real, imag));
      oscillator.frequency.setValueAtTime(f / 2, now + spec.at);
    } else {
      oscillator.type = spec.wave;
      oscillator.frequency.setValueAtTime(f, now + spec.at);
    }
    if (spec.to) oscillator.frequency.linearRampToValueAtTime(spec.to, now + spec.at + 0.04);
    oscillator.connect(gain);
    let filter: BiquadFilterNode | undefined;
    if (spec.lowpass) {
      filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 5000;
      gain.connect(filter);
      filter.connect(master);
    } else gain.connect(master);
    let lfo: OscillatorNode | undefined, depth: GainNode | undefined;
    if (spec.vibrato) {
      lfo = ctx.createOscillator();
      depth = ctx.createGain();
      lfo.frequency.value = 5;
      depth.gain.value = 6;
      lfo.connect(depth);
      depth.connect(oscillator.detune);
      lfo.start(now + spec.at);
      lfo.stop(now + spec.at + spec.duration);
    }
    oscillator.start(now + spec.at);
    oscillator.stop(now + spec.at + spec.duration);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      filter?.disconnect();
      lfo?.disconnect();
      depth?.disconnect();
    };
  }
  if (["buckle", "ship", "streak"].includes(name)) {
    const duration = name === "streak" ? 0.35 : 0.04;
    if (reserve(0, duration)) {
      const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate),
        data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const source = ctx.createBufferSource(),
        filter = ctx.createBiquadFilter(),
        gain = envelope(
          0,
          duration,
          name === "streak" ? 0.025 : 0.18,
          name === "streak" ? 0.02 : 0.005,
        );
      source.buffer = buffer;
      filter.type = name === "streak" ? "lowpass" : "bandpass";
      filter.frequency.value = 2400;
      filter.Q.value = 2;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      source.start(now);
      source.onended = () => {
        source.disconnect();
        filter.disconnect();
        gain.disconnect();
      };
    }
  }
  setTimeout(() => master.disconnect(), 1800);
}
