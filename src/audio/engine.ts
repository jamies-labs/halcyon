export class AudioEngine {
  private ctx: AudioContext | null = null;
  private tried = false;
  private staticSrc: AudioBufferSourceNode | null = null;
  private staticFilter: BiquadFilterNode | null = null;
  private staticGain: GainNode | null = null;

  constructor(
    private readonly factory: () => AudioContext = () => new AudioContext(),
  ) {}

  ensureRunning(): void {
    if (this.tried) {
      void this.ctx?.resume();
      return;
    }

    this.tried = true;
    try {
      this.ctx = this.factory();
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private blip(
    frequency: number,
    durationMs: number,
    type: OscillatorType = "square",
    gainValue = 0.08,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;

    try {
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      gain.gain.value = gainValue;
      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + durationMs / 1_000);
    } catch {
      // Browsers may expose WebAudio but reject it until a user gesture.
    }
  }

  click(): void {
    this.blip(880, 40);
  }

  alarm(): void {
    this.blip(220, 300, "sawtooth", 0.06);
  }

  chime(): void {
    this.blip(1320, 200, "sine", 0.06);
  }

  setStatic(intensity: number, pitchHz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    try {
      if (!this.staticSrc) {
        const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) {
          data[i] = Math.random() * 2 - 1;
        }

        const source = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        source.buffer = buffer;
        source.loop = true;
        filter.type = "bandpass";
        filter.Q.value = 8;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        source.start();
        this.staticSrc = source;
        this.staticFilter = filter;
        this.staticGain = gain;
      }

      this.staticFilter!.frequency.value = pitchHz;
      this.staticGain!.gain.value = Math.max(
        0,
        Math.min(0.12, intensity * 0.12),
      );
    } catch {
      this.stopStatic();
    }
  }

  stopStatic(): void {
    try {
      this.staticSrc?.stop();
      this.staticSrc?.disconnect();
      this.staticFilter?.disconnect();
      this.staticGain?.disconnect();
    } catch {
      // A source can only be stopped once; cleanup remains idempotent.
    }
    this.staticSrc = null;
    this.staticFilter = null;
    this.staticGain = null;
  }

  startMetronome(bpm: number, onBeat: () => void): () => void {
    if (!this.ctx) return () => {};

    const periodMs = 60_000 / bpm;
    const id = setInterval(() => {
      onBeat();
      this.blip(660, 30, "sine", 0.05);
    }, periodMs);
    return () => clearInterval(id);
  }
}
