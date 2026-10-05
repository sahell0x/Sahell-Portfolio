"use client";

/**
 * The two halves of a browser voice call, once WebRTC is not doing them for you.
 *
 * A WebRTC track handled framing, resampling, jitter buffering and playout on
 * its own. On a plain socket all four are this file's problem, and each one is
 * a place a conversation can start to sound broken:
 *
 * * `Microphone` captures at the recogniser's rate and hands up 200ms frames of
 *   signed 16-bit PCM — the shape the backend's transcriber is fed (see the
 *   worklet's own header for why that number and not another).
 * * `Playback` schedules the assistant's voice on the audio clock rather than
 *   playing chunks as they land, because a chunk played on arrival is a chunk
 *   played late, and late twice in a row is a stutter. It also owns the mark
 *   acknowledgements: the engine only knows what the visitor *heard* because
 *   this side says so once a buffer has finished playing.
 *
 * Both expose a `level()` for the orb, read off an `AnalyserNode` so the meter
 * costs nothing on the audio thread.
 */

/** Where `addModule` finds the capture processor. Served from `public/`. */
const WORKLET_URL = "/voice/pcm-recorder.worklet.js";

/** Milliseconds of audio per frame sent upstream. Must match the recogniser. */
export const MIC_FRAME_MS = 200;

/**
 * How much of the assistant's voice to hold before letting it start playing.
 *
 * Sarvam does not deliver at a steady rate. Measured straight against the
 * provider with no engine in the way, one paragraph of speech came back at
 * anywhere from 0.45x to 1.4x realtime depending on the minute — so the stream
 * is roughly realtime *on average* while spending long stretches behind it.
 * That is the case buffering is actually for: playing a chunk the moment it
 * lands means the queue runs dry on every slow stretch, and each dry spell is
 * silence in the middle of a sentence.
 *
 * The cost is honest: she starts speaking this much later.
 */
export const PLAYBACK_CUSHION_S = 0.5;

/**
 * Added to the cushion each time the queue runs dry inside one response.
 *
 * A fixed cushion is a bet on how far behind the producer will fall, and a
 * wrong bet is either dead air at the start or a stutter in the middle. Growing
 * it only when this response has *actually* stalled means a fast turn stays
 * responsive and a slow one stops stuttering after the first gap — and the
 * whole thing resets when the next turn starts.
 */
const CUSHION_STEP_S = 0.35;
const MAX_CUSHION_S = 2.0;

/** Below this much scheduled audio the queue counts as drained. */
const DRAINED_S = 0.02;

function rms(analyser: AnalyserNode, scratch: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(scratch);
  let total = 0;
  for (let i = 0; i < scratch.length; i += 1) total += scratch[i] * scratch[i];
  return Math.sqrt(total / scratch.length);
}

/** base64 for a block of bytes, chunked so a big frame can't blow the stack. */
export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/** The bytes behind a base64 string, truncated to whole 16-bit samples. */
export function decodePcm(encoded: string): Int16Array {
  const binary = atob(encoded);
  const usable = binary.length - (binary.length % 2);
  const bytes = new Uint8Array(usable);
  for (let i = 0; i < usable; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

// ---------------------------------------------------------------------------

export class Microphone {
  private constructor(
    private readonly context: AudioContext,
    private readonly stream: MediaStream,
    private readonly analyser: AnalyserNode,
    private readonly scratch: Float32Array<ArrayBuffer>,
  ) {}

  /**
   * Start capturing from an already-granted stream.
   *
   * The context is asked for the recogniser's rate directly, which lets the
   * browser resample in native code with a real filter. An engine that refuses
   * — by throwing, or by quietly handing back its own rate — falls through to
   * the worklet's interpolation instead: worse, but only ever the fallback.
   */
  static async open(
    stream: MediaStream,
    sampleRate: number,
    onFrame: (pcm: Int16Array) => void,
  ): Promise<Microphone> {
    let context: AudioContext;
    try {
      context = new AudioContext({ sampleRate });
    } catch {
      context = new AudioContext();
    }
    await context.audioWorklet.addModule(WORKLET_URL);

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);

    const recorder = new AudioWorkletNode(context, "pcm-recorder", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      processorOptions: {
        frameSamples: Math.round((sampleRate * MIC_FRAME_MS) / 1000),
        inputRate: context.sampleRate,
        outputRate: sampleRate,
      },
    });
    recorder.port.onmessage = (event) => onFrame(event.data as Int16Array);
    source.connect(recorder);

    // A node with no path to the destination is not guaranteed to be pulled.
    // Silenced rather than merely unconnected, so nothing can leak back out of
    // the speakers and into the microphone.
    const mute = context.createGain();
    mute.gain.value = 0;
    recorder.connect(mute).connect(context.destination);

    await context.resume();
    return new Microphone(context, stream, analyser, new Float32Array(analyser.fftSize));
  }

  level(): number {
    return rms(this.analyser, this.scratch);
  }

  close(): void {
    this.stream.getTracks().forEach((track) => track.stop());
    void this.context.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------

interface Scheduled {
  source: AudioBufferSourceNode;
  /** Marks due once this buffer has finished playing. */
  marks: string[];
}

export class Playback {
  private readonly context: AudioContext;
  private readonly gain: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly scratch: Float32Array<ArrayBuffer>;

  /** Sources still scheduled or playing, so a barge-in can stop all of them. */
  private readonly live = new Set<AudioBufferSourceNode>();
  /** The most recently scheduled buffer; marks attach to its end. */
  private tail: Scheduled | null = null;
  /** Audio-clock time the next buffer should start at. */
  private nextTime = 0;
  /** This response's cushion, grown each time its queue runs dry. */
  private cushion = PLAYBACK_CUSHION_S;
  /** Whether anything has been scheduled since the response began. */
  private started = false;

  constructor(
    private readonly sampleRate: number,
    private readonly onMark: (name: string) => void,
  ) {
    this.context = new AudioContext();
    this.gain = this.context.createGain();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.4;
    this.gain.connect(this.analyser).connect(this.context.destination);
    this.scratch = new Float32Array(this.analyser.fftSize);
  }

  /**
   * Begin a new response, resetting the cushion earned by the last one.
   *
   * Called when the server says the agent has taken the turn, so a single slow
   * answer does not make every answer after it start late.
   */
  startResponse(): void {
    this.cushion = PLAYBACK_CUSHION_S;
    this.started = false;
  }

  /** Whether there is still audio scheduled to play. */
  isBusy(): boolean {
    return this.nextTime > this.context.currentTime;
  }

  /** Autoplay needs a user gesture; the visitor's click on "start" is ours. */
  async resume(): Promise<void> {
    if (this.context.state !== "running") {
      await this.context.resume().catch(() => undefined);
    }
  }

  /**
   * Schedule one chunk of the assistant's voice.
   *
   * The buffer is created at the rate the *server* said it synthesized at; the
   * audio graph resamples to the output device once, on playout, rather than
   * per chunk. That matters: a per-chunk resample carries no filter state
   * across the seam and clicks between sentences.
   */
  enqueue(pcm: Int16Array): void {
    if (pcm.length === 0) return;

    const buffer = this.context.createBuffer(1, pcm.length, this.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i += 1) channel[i] = pcm[i] / 0x8000;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);

    const now = this.context.currentTime;
    if (this.nextTime < now + DRAINED_S) {
      // Dry again inside the same response: the producer is running behind, so
      // give the next stretch more room rather than stuttering through it.
      if (this.started) this.cushion = Math.min(this.cushion + CUSHION_STEP_S, MAX_CUSHION_S);
      this.nextTime = now + this.cushion;
    }
    this.started = true;
    const startAt = this.nextTime;
    this.nextTime += buffer.duration;

    const entry: Scheduled = { source, marks: [] };
    source.onended = () => {
      this.live.delete(source);
      if (this.tail === entry) this.tail = null;
      for (const name of entry.marks) this.onMark(name);
    };
    source.start(startAt);

    this.live.add(source);
    this.tail = entry;
  }

  /**
   * Hold a mark until the audio in front of it has played, then echo it.
   *
   * This is the whole contract the engine's turn-taking rests on. A mark that
   * arrives with nothing queued is due immediately — that is how the *opening*
   * mark of a response, which the server sends just before the first chunk,
   * ends up meaning "she has started speaking".
   */
  mark(name: string): void {
    if (this.tail) this.tail.marks.push(name);
    else this.onMark(name);
  }

  /**
   * Drop everything scheduled: the visitor cut in.
   *
   * Pending marks go with it, deliberately. A mark is a claim that the visitor
   * heard those words, and audio stopped before it played was not heard.
   */
  clear(): void {
    for (const source of this.live) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already finished between the check and the call; nothing to stop.
      }
    }
    this.live.clear();
    this.tail = null;
    this.nextTime = 0;
    this.started = false;
  }

  level(): number {
    return rms(this.analyser, this.scratch);
  }

  close(): void {
    this.clear();
    void this.context.close().catch(() => undefined);
  }
}
