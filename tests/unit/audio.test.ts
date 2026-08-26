import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "../../src/audio/engine";

function fakeContext() {
  const gain = {
    gain: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const oscillator = {
    type: "sine" as OscillatorType,
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
  const bufferSource = {
    buffer: null as AudioBuffer | null,
    loop: false,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
  const filter = {
    type: "lowpass" as BiquadFilterType,
    frequency: { value: 0 },
    Q: { value: 0 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const buffer = { getChannelData: vi.fn(() => new Float32Array(8)) };
  const context = {
    state: "running",
    currentTime: 10,
    destination: {},
    sampleRate: 8,
    resume: vi.fn().mockResolvedValue(undefined),
    createGain: vi.fn(() => gain),
    createOscillator: vi.fn(() => oscillator),
    createBufferSource: vi.fn(() => bufferSource),
    createBiquadFilter: vi.fn(() => filter),
    createBuffer: vi.fn(() => buffer),
  } as unknown as AudioContext;

  return { context, gain, oscillator, bufferSource, filter, buffer };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("AudioEngine", () => {
  it("is safe to call before ensureRunning without constructing audio", () => {
    vi.useFakeTimers();
    const factory = vi.fn();
    const onBeat = vi.fn();
    const audio = new AudioEngine(factory as unknown as () => AudioContext);

    expect(() => {
      audio.click();
      audio.alarm();
      audio.chime();
      audio.setStatic(0.5, 400);
      audio.stopStatic();
      audio.startMetronome(120, onBeat)();
    }).not.toThrow();
    vi.advanceTimersByTime(1_600);

    expect(factory).not.toHaveBeenCalled();
    expect(onBeat).not.toHaveBeenCalled();
  });

  it("initializes only once and creates bounded oscillator blips", () => {
    const { context, oscillator } = fakeContext();
    const factory = vi.fn(() => context);
    const audio = new AudioEngine(factory);

    audio.ensureRunning();
    audio.ensureRunning();
    audio.click();
    audio.alarm();
    audio.chime();

    expect(factory).toHaveBeenCalledTimes(1);
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(
      context.createOscillator as ReturnType<typeof vi.fn>,
    ).toHaveBeenCalledTimes(3);
    expect(oscillator.start).toHaveBeenCalledTimes(3);
    expect(oscillator.stop).toHaveBeenNthCalledWith(1, 10.04);
    expect(oscillator.stop).toHaveBeenNthCalledWith(2, 10.3);
    expect(oscillator.stop).toHaveBeenNthCalledWith(3, 10.2);
  });

  it("creates, controls, and stops filtered static", () => {
    const { context, gain, bufferSource, filter, buffer } = fakeContext();
    const audio = new AudioEngine(() => context);
    audio.ensureRunning();

    audio.setStatic(-3, 400);
    expect(gain.gain.value).toBe(0);
    audio.setStatic(2, 1_200);

    expect(context.createBuffer).toHaveBeenCalledWith(1, 8, 8);
    expect(buffer.getChannelData).toHaveBeenCalledWith(0);
    expect(bufferSource.loop).toBe(true);
    expect(bufferSource.start).toHaveBeenCalledTimes(1);
    expect(filter.type).toBe("bandpass");
    expect(filter.Q.value).toBe(8);
    expect(filter.frequency.value).toBe(1_200);
    expect(gain.gain.value).toBe(0.12);

    audio.stopStatic();
    expect(bufferSource.stop).toHaveBeenCalledTimes(1);
    expect(bufferSource.disconnect).toHaveBeenCalledTimes(1);

    audio.setStatic(0.5, 600);
    expect(context.createBufferSource).toHaveBeenCalledTimes(2);
    expect(bufferSource.start).toHaveBeenCalledTimes(2);
    expect(gain.gain.value).toBe(0.06);
  });

  it("metronome fires beats and stops cleanly", () => {
    vi.useFakeTimers();
    const { context } = fakeContext();
    const audio = new AudioEngine(() => context);
    const onBeat = vi.fn();
    audio.ensureRunning();

    const stop = audio.startMetronome(120, onBeat);
    vi.advanceTimersByTime(1_600);
    expect(onBeat).toHaveBeenCalledTimes(3);

    stop();
    vi.advanceTimersByTime(1_000);
    expect(onBeat).toHaveBeenCalledTimes(3);
  });

  it("enters audio-less mode when the context factory throws", () => {
    const factory = vi.fn(() => {
      throw new Error("no audio device");
    });
    const audio = new AudioEngine(factory);

    expect(() => {
      audio.ensureRunning();
      audio.click();
      audio.alarm();
      audio.chime();
      audio.setStatic(0.5, 400);
      audio.stopStatic();
    }).not.toThrow();
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
