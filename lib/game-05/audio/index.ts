import type { MusicId } from "../contract";

/**
 * Game 05 audio manager (adapted from the retired Game 05 manager).
 *
 * Reads `${base}/manifest.json` written by the audio lane:
 *   { music: { <MusicId | sting.*>: { src, loopStart?, loopEnd?, gain } },
 *     sfx:   { <cue>: { src? | srcs?: [], gain, pitchVar } } }
 * Nothing is created or fetched before unlock(), which the host calls inside the first user
 * gesture. Music crossfades on every change, the village theme swaps to its night variant (or a
 * low-passed village theme when there is no night file), SFX are panned and pitch-varied, and a
 * missing manifest or file is always silent.
 *
 * Stings: `sting.gameOver` and `sting.chapterClear` STOP the music (it stays silent while the
 * sting plays and while the host holds it, e.g. on the game-over and chapter-clear screens);
 * every other `sting.*` ducks it. `rest` (the inn lullaby) fades the music out, plays, and the
 * music for the new time of day fades back in afterwards.
 */
export interface Volumes { master: number; music: number; sfx: number; muted: boolean }
/** Host-side UI sounds: menu moves and confirms, the dialog blip, the new-skill banner reveal. */
export type UiCue = "move" | "ok" | "back" | "deny" | "blip" | "unlock";
/** Debug trace of what the manager did (tests read it through the host's debug hook). */
export type AudioTrace = { t: number; kind: "unlock" | "sfx" | "music" | "stop" | "duck" | "hold" | "fetch"; detail: string };

/** Cue names the simulation may emit that the manifest files under another key. */
const CUE_ALIASES: Readonly<Record<string, string>> = { gameOver: "sting.gameOver", chapterClear: "sting.chapterClear", victory: "sting.victory" };
/** Stings that stop the music instead of ducking it. */
const STOPPING_STINGS = new Set(["sting.gameOver", "sting.chapterClear"]);
/** Fallback lengths (s) used to hold the music before a sting's buffer has decoded. */
const HOLD_FALLBACK: Readonly<Record<string, number>> = { "sting.gameOver": 6.1, "sting.chapterClear": 9.9, rest: 6.9 };

interface MusicClip { src: string; loopStart?: number; loopEnd?: number; gain?: number }
interface SfxClip { src?: string; srcs?: string[]; gain?: number; pitchVar?: number }
interface Manifest { music: Record<string, MusicClip>; sfx: Record<string, SfxClip> }
interface Voice { source: AudioBufferSourceNode; gain: GainNode; pan?: StereoPannerNode; loop: boolean }

const clamp01 = (v: number, fallback: number) => Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
const FADE = 1.2;
const MAX_VOICES = 24;
/** Cues worth decoding right after unlock so the first swing and menu blip are not late. */
const PRELOAD = [
  "ui.move", "ui.ok", "ui.back", "ui.deny", "text.blip", "swing1", "swing2", "swing3", "hit", "hitCrit", "hitHero", "miss",
  "cutGrass", "coin", "pickup", "chestOpen", "dodge", "door", "step.grass", "step.stone", "step.wood", "step.dirt",
];

function parseManifest(value: unknown): Manifest {
  const out: Manifest = { music: {}, sfx: {} };
  if (typeof value !== "object" || value === null) return out;
  const raw = value as { music?: unknown; sfx?: unknown };
  const str = (v: unknown) => typeof v === "string" && v.length < 300 && !v.includes("..") ? v : null;
  const n = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
  if (typeof raw.music === "object" && raw.music) {
    for (const [id, clip] of Object.entries(raw.music as Record<string, unknown>)) {
      const c = clip as Record<string, unknown> | null;
      const src = str(c?.src);
      if (src) out.music[id] = { src, loopStart: n(c?.loopStart), loopEnd: n(c?.loopEnd), gain: n(c?.gain) };
    }
  }
  if (typeof raw.sfx === "object" && raw.sfx) {
    for (const [cue, clip] of Object.entries(raw.sfx as Record<string, unknown>)) {
      const c = clip as Record<string, unknown> | null;
      const srcs = Array.isArray(c?.srcs) ? (c.srcs as unknown[]).map(str).filter((s): s is string => !!s) : [];
      const src = str(c?.src);
      if (src) srcs.push(src);
      if (srcs.length) out.sfx[cue] = { srcs, gain: n(c?.gain), pitchVar: n(c?.pitchVar) };
    }
  }
  return out;
}

export class Game05Audio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private sfxBus: GainNode | null = null;
  /** Stings follow the music volume but skip the duck they cause. */
  private stingBus: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private volumes: Volumes = { master: 0.85, music: 0.7, sfx: 0.85, muted: false };
  private disposed = false;
  private unlocked = false;
  private paused = false;
  private hidden = false;
  private night = false;
  private requested: MusicId = "none";
  private playingKey = "";
  private revision = 0;
  private current: Voice | null = null;
  private manifestPromise: Promise<Manifest> | null = null;
  private readonly abort = typeof AbortController !== "undefined" ? new AbortController() : null;
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private readonly voices = new Set<Voice>();
  private readonly lastPlayed = new Map<string, number>();
  private readonly lastVariant = new Map<string, number>();
  private duckUntil = 0;
  /** Music stays silent until this performance.now() time (a stopping sting or the lullaby). */
  private silentUntil = 0;
  private silentTimer: ReturnType<typeof setTimeout> | null = null;
  /** Host hold: silent while true (game-over and chapter-clear screens). */
  private held = false;
  /** Optional trace sink (debug builds and tests). */
  trace: ((entry: AudioTrace) => void) | null = null;

  constructor(private readonly base = "/games/game-05/audio") {}

  private log(kind: AudioTrace["kind"], detail: string) {
    try { this.trace?.({ t: Math.round(performance.now()), kind, detail }); } catch { /* tracing never breaks audio */ }
  }

  get isUnlocked(): boolean { return this.unlocked; }

  /** Call synchronously inside a user gesture (pointerdown / keydown). Safe to call repeatedly. */
  unlock(): Promise<void> {
    if (this.disposed || typeof window === "undefined") return Promise.resolve();
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext
          ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return Promise.resolve();
        const ctx = new Ctor();
        this.ctx = ctx;
        this.master = ctx.createGain();
        this.musicBus = ctx.createGain();
        this.duckGain = ctx.createGain();
        this.musicFilter = ctx.createBiquadFilter();
        this.musicFilter.type = "lowpass";
        this.musicFilter.frequency.value = 20000;
        this.musicFilter.Q.value = 0.5;
        this.sfxBus = ctx.createGain();
        this.stingBus = ctx.createGain();
        this.limiter = ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -6;
        this.limiter.knee.value = 6;
        this.limiter.ratio.value = 10;
        this.limiter.attack.value = 0.003;
        this.limiter.release.value = 0.2;
        this.musicBus.connect(this.musicFilter);
        this.musicFilter.connect(this.duckGain);
        this.duckGain.connect(this.master);
        this.sfxBus.connect(this.master);
        this.stingBus.connect(this.master);
        this.master.connect(this.limiter);
        this.limiter.connect(ctx.destination);
        this.applyVolumes(true);
      }
      // resume() must start inside the gesture, before any await.
      const resumed = this.ctx.state === "running" ? Promise.resolve() : this.ctx.resume();
      if (!this.unlocked) this.log("unlock", this.ctx.state);
      this.unlocked = true;
      void this.manifest().then(m => this.preload(m)).catch(() => {});
      this.refreshMusic();
      return resumed.catch(() => {});
    } catch { return Promise.resolve(); }
  }

  setVolumes(volumes: Volumes): void {
    this.volumes = {
      master: clamp01(volumes.master, this.volumes.master), music: clamp01(volumes.music, this.volumes.music),
      sfx: clamp01(volumes.sfx, this.volumes.sfx), muted: volumes.muted === true,
    };
    this.applyVolumes(false);
    this.refreshMusic();
  }

  /** Background music by id ('none' fades out). */
  setMusic(id: MusicId): void {
    if (this.disposed) return;
    this.requested = id;
    this.refreshMusic();
  }

  /** Night swaps the village theme for its night variant. */
  setNight(night: boolean): void {
    if (this.disposed || night === this.night) return;
    this.night = night;
    this.refreshMusic();
  }

  /** Host hold: the music stops while held (game over, chapter clear) and returns on release. */
  setHold(hold: boolean): void {
    if (this.disposed || hold === this.held) return;
    this.held = hold;
    this.log("hold", String(hold));
    this.refreshMusic();
  }

  /** The music the manager is playing now ("" = silent). */
  get playing(): string { return this.playingKey; }

  /** Pause menu: the music drops and muffles; SFX (menu sounds) stay clear. */
  setPaused(paused: boolean): void {
    if (this.disposed || paused === this.paused) return;
    this.paused = paused;
    this.applyFilter();
  }

  /** Hidden tab or blurred window: suspend the whole context. */
  setHidden(hidden: boolean): void {
    if (this.disposed || hidden === this.hidden) return;
    this.hidden = hidden;
    const ctx = this.ctx;
    if (!ctx) return;
    if (hidden) void ctx.suspend().catch(() => {});
    else if (this.unlocked) void ctx.resume().catch(() => {});
  }

  ui(cue: UiCue): void {
    const name = cue === "blip" ? "text.blip" : cue === "unlock" ? "unlock" : `ui.${cue}`;
    this.sfx(name, 0, cue === "blip" ? 0.6 : 1);
  }

  /** One-shot effect. `sting.*` cues duck the music (or stop it, see above) while they play. */
  sfx(name: string, pan = 0, gain = 1): void {
    const cue = CUE_ALIASES[name] ?? name;
    // The music reacts even when effects are muted or the context is still locked.
    if (!this.disposed && (STOPPING_STINGS.has(cue) || cue === "rest")) this.silence(cue, HOLD_FALLBACK[cue] ?? 3);
    if (this.disposed || !this.unlocked || !this.ctx || this.hidden || this.volumes.muted) return;
    if (this.volumes.master * this.volumes.sfx <= 0 && !cue.startsWith("sting.")) return;
    const now = performance.now();
    const gap = cue.startsWith("step.") ? 85 : cue === "text.blip" ? 45 : 28;
    if (now - (this.lastPlayed.get(cue) ?? -Infinity) < gap) return;
    this.lastPlayed.set(cue, now);
    const sting = cue.startsWith("sting.");
    void (async () => {
      try {
        const m = await this.manifest();
        const music = sting ? m.music[cue] : undefined;
        const clip: SfxClip | undefined = music ? { srcs: [music.src], gain: music.gain } : m.sfx[cue];
        const srcs = clip?.srcs ?? [];
        if (!srcs.length) return;
        let pick = Math.floor(Math.random() * srcs.length);
        if (srcs.length > 1 && pick === this.lastVariant.get(cue)) pick = (pick + 1) % srcs.length;
        this.lastVariant.set(cue, pick);
        const data = await this.buffer(srcs[pick]);
        const ctx = this.ctx;
        // Late first-use sounds are dropped instead of playing out of context.
        if (this.disposed || !ctx || this.hidden || performance.now() - now > (sting ? 2500 : 700)) return;
        const effects = [...this.voices].filter(v => !v.loop);
        if (effects.length >= MAX_VOICES) this.stop(effects[0]);
        const bus = sting ? this.stingBus! : this.sfxBus!;
        const voice = this.voice(data, bus, false);
        const variation = Math.max(0, Math.min(0.25, clip?.pitchVar ?? 0.03));
        voice.source.playbackRate.value = sting ? 1 : 1 + (Math.random() * 2 - 1) * variation;
        const level = (clip?.gain ?? 1) * Math.max(0, Math.min(2, Number.isFinite(gain) ? gain : 1));
        voice.gain.gain.value = level;
        if (!sting && pan && ctx.createStereoPanner) {
          const panner = ctx.createStereoPanner();
          panner.pan.value = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan * 0.7 : 0));
          voice.gain.disconnect();
          voice.gain.connect(panner);
          panner.connect(bus);
          voice.pan = panner;
        }
        voice.source.start();
        this.log("sfx", cue);
        if (STOPPING_STINGS.has(cue) || cue === "rest") this.silence(cue, data.duration);
        else if (sting) this.duck(data.duration);
      } catch { /* Optional sound: failures stay silent and retry next time. */ }
    })();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.revision++;
    if (this.silentTimer) clearTimeout(this.silentTimer);
    this.silentTimer = null;
    this.trace = null;
    this.abort?.abort();
    for (const voice of [...this.voices]) this.stop(voice);
    this.buffers.clear();
    this.current = null;
    this.manifestPromise = null;
    for (const node of [this.master, this.musicBus, this.duckGain, this.musicFilter, this.sfxBus, this.stingBus, this.limiter]) node?.disconnect();
    if (this.ctx) void this.ctx.close().catch(() => {});
    this.ctx = null;
  }

  // ─── internals ───────────────────────────────────────────────────────────────────────────────
  private manifest(): Promise<Manifest> {
    if (!this.manifestPromise) {
      this.log("fetch", "manifest.json");
      this.manifestPromise = fetch(`${this.base}/manifest.json`, { signal: this.abort?.signal, cache: "force-cache" })
        .then(r => { if (!r.ok) throw new Error("Audio manifest unavailable"); return r.json() as Promise<unknown>; })
        .then(parseManifest)
        .catch(error => { this.manifestPromise = null; throw error; });
    }
    return this.manifestPromise;
  }

  private buffer(src: string): Promise<AudioBuffer> {
    let pending = this.buffers.get(src);
    if (!pending) {
      const ctx = this.ctx;
      if (!ctx) return Promise.reject(new Error("Audio locked"));
      this.log("fetch", src);
      pending = fetch(`${this.base}/${src}`, { signal: this.abort?.signal })
        .then(r => { if (!r.ok) throw new Error("Audio clip unavailable"); return r.arrayBuffer(); })
        .then(data => {
          if (this.disposed) throw new Error("Audio disposed");
          return new Promise<AudioBuffer>((resolve, reject) => {
            // Callback form for older Safari; the promise form elsewhere.
            const result = ctx.decodeAudioData(data, resolve, reject);
            if (result && typeof result.then === "function") result.then(resolve, reject);
          });
        })
        .catch(error => { this.buffers.delete(src); throw error; });
      this.buffers.set(src, pending);
    }
    return pending;
  }

  private preload(m: Manifest): void {
    if (this.disposed) return;
    for (const cue of PRELOAD) for (const src of m.sfx[cue]?.srcs ?? []) void this.buffer(src).catch(() => {});
  }

  private voice(data: AudioBuffer, bus: AudioNode, loop: boolean): Voice {
    const ctx = this.ctx!;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = data;
    source.connect(gain);
    gain.connect(bus);
    const voice: Voice = { source, gain, loop };
    this.voices.add(voice);
    source.onended = () => this.disconnect(voice);
    return voice;
  }

  private disconnect(voice: Voice): void {
    try { voice.source.disconnect(); voice.gain.disconnect(); voice.pan?.disconnect(); } catch { /* already gone */ }
    this.voices.delete(voice);
  }

  private stop(voice: Voice, at = 0): void {
    try { voice.source.stop(at); } catch { /* already stopped */ }
    if (!at) this.disconnect(voice);
  }

  private ramp(param: AudioParam, value: number, seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    param.cancelScheduledValues(now);
    param.setValueAtTime(param.value, now);
    param.linearRampToValueAtTime(value, now + Math.max(0.01, seconds));
  }

  private applyVolumes(immediate: boolean): void {
    if (!this.master || !this.musicBus || !this.sfxBus || !this.stingBus) return;
    const v = this.volumes;
    const master = v.muted ? 0 : v.master;
    if (immediate) {
      this.master.gain.value = master;
      this.musicBus.gain.value = v.music;
      this.sfxBus.gain.value = v.sfx;
      this.stingBus.gain.value = Math.max(v.music, v.sfx * 0.6);
    } else {
      this.ramp(this.master.gain, master, 0.08);
      this.ramp(this.musicBus.gain, v.music, 0.08);
      this.ramp(this.sfxBus.gain, v.sfx, 0.08);
      this.ramp(this.stingBus.gain, Math.max(v.music, v.sfx * 0.6), 0.08);
    }
    this.applyFilter();
  }

  private musicKey(manifest: Manifest | null): string {
    const id = this.requested;
    if (id === "none") return "";
    if (id === "village" && this.night && (!manifest || manifest.music.villageNight)) return "villageNight";
    return id;
  }

  /** Low-pass for the pause menu and for a night village without its own night track. */
  private applyFilter(): void {
    const filter = this.musicFilter, duck = this.duckGain;
    if (!filter || !duck || !this.ctx) return;
    const nightFallback = this.requested === "village" && this.night && this.playingKey === "village";
    const cutoff = this.paused ? 900 : nightFallback ? 2200 : 20000;
    const now = this.ctx.currentTime;
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(filter.frequency.value, now);
    filter.frequency.exponentialRampToValueAtTime(cutoff, now + 0.35);
    if (now >= this.duckUntil) this.ramp(duck.gain, this.paused ? 0.45 : 1, 0.35);
  }

  /** Stop the music now and keep it silent for `seconds` (from this call), then bring it back. */
  private silence(cue: string, seconds: number): void {
    const until = performance.now() + Math.max(0.2, seconds) * 1000;
    if (until <= this.silentUntil) return;
    this.silentUntil = until;
    this.log("stop", `${cue} ${seconds.toFixed(1)}s`);
    // The lullaby fades the music gently; stopping stings cut it fast.
    this.fadeOutCurrent(cue === "rest" ? 0.8 : 0.25);
    this.playingKey = "";
    if (this.silentTimer) clearTimeout(this.silentTimer);
    this.silentTimer = setTimeout(() => { this.silentTimer = null; this.refreshMusic(); }, until - performance.now() + 30);
  }

  private duck(seconds: number): void {
    const duck = this.duckGain, ctx = this.ctx;
    if (!duck || !ctx) return;
    const now = ctx.currentTime;
    const hold = Math.max(0.2, seconds - 0.4);
    const rest = this.paused ? 0.45 : 1;
    duck.gain.cancelScheduledValues(now);
    duck.gain.setValueAtTime(duck.gain.value, now);
    duck.gain.linearRampToValueAtTime(0.18, now + 0.08);
    duck.gain.setValueAtTime(0.18, now + hold);
    duck.gain.linearRampToValueAtTime(rest, now + hold + 0.9);
    this.duckUntil = now + hold + 0.9;
    this.log("duck", seconds.toFixed(1));
  }

  private refreshMusic(): void {
    if (this.disposed) return;
    const version = ++this.revision;
    void this.changeMusic(version);
  }

  private async changeMusic(version: number): Promise<void> {
    if (!this.unlocked || !this.ctx) return;
    let manifest: Manifest | null = null;
    try { manifest = await this.manifest(); } catch { manifest = null; }
    if (this.disposed || version !== this.revision || !this.ctx) return;
    let key = this.musicKey(manifest);
    if (key === "villageNight" && !manifest?.music.villageNight) key = "village";
    // Held by the host, or inside a stopping sting or the lullaby: stay silent (a timer retries).
    if (this.held || performance.now() < this.silentUntil) key = "";
    if (key === this.playingKey && (this.current || !key)) { this.applyFilter(); return; }
    const clip = key && manifest ? manifest.music[key] : undefined;
    if (!clip) {
      // 'none', or a missing manifest or track: fade out; the next change retries.
      this.fadeOutCurrent();
      this.playingKey = "";
      return;
    }
    // Silent volume never downloads music; a later volume change retries.
    if (this.volumes.muted || this.volumes.master * this.volumes.music <= 0) { this.fadeOutCurrent(); this.playingKey = ""; return; }
    try {
      const data = await this.buffer(clip.src);
      const ctx = this.ctx;
      if (this.disposed || version !== this.revision || !ctx) return;
      const voice = this.voice(data, this.musicBus!, true);
      voice.source.loop = true;
      const loopEnd = clip.loopEnd && clip.loopEnd > 0 ? Math.min(clip.loopEnd, data.duration) : data.duration;
      const loopStart = clip.loopStart && clip.loopStart > 0 && clip.loopStart < loopEnd - 0.5 ? clip.loopStart : 0;
      voice.source.loopStart = loopStart;
      voice.source.loopEnd = loopEnd;
      const now = ctx.currentTime;
      const level = Math.max(0, Math.min(1.5, clip.gain ?? 1));
      voice.gain.gain.setValueAtTime(0, now);
      voice.gain.gain.linearRampToValueAtTime(level, now + FADE);
      voice.source.start(now);
      this.fadeOutCurrent();
      this.current = voice;
      this.playingKey = key;
      this.log("music", key);
      this.applyFilter();
      // Keep at most three decoded music tracks; the HTTP cache serves returns.
      if (manifest) {
        const musicSrcs = new Set(Object.values(manifest.music).map(c => c.src));
        const loaded = [...this.buffers.keys()].filter(src => musicSrcs.has(src) && src !== clip.src);
        for (const src of loaded.slice(0, Math.max(0, loaded.length - 2))) this.buffers.delete(src);
      }
    } catch { /* Missing music stays silent; the next change retries. */ }
  }

  private fadeOutCurrent(seconds = FADE): void {
    const voice = this.current, ctx = this.ctx;
    if (!voice || !ctx) { this.current = null; return; }
    const now = ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, now + seconds);
    this.stop(voice, now + seconds + 0.05);
    this.current = null;
  }
}
