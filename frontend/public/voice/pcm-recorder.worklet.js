/**
 * Turns the microphone into the frames the speech recogniser expects.
 *
 * Two jobs, both of which have to happen off the main thread if the page is to
 * stay smooth while it also animates and renders a transcript:
 *
 *   1. **Framing.** Saaras is fed one WAV file per message and advances its own
 *      audio clock by a fixed 200ms per message (see `audio_frame_duration` in
 *      the backend's `vox/transcriber/sarvam_transcriber.py`). Sending the audio
 *      graph's native 128-sample quanta would be ~375 files a second and would
 *      run that clock 75x fast, so samples are accumulated here into exactly
 *      one 200ms frame at a time.
 *
 *   2. **Rate.** The recogniser wants 16kHz. Browsers that honour the
 *      `sampleRate` option on `AudioContext` resample in native code with a
 *      proper filter, and this runs at a ratio of 1. The interpolation below is
 *      the fallback for browsers that ignore it and hand us 48kHz anyway.
 *
 * Int16 conversion also happens here, so what crosses to the main thread is
 * already the bytes that go on the wire.
 */
class PcmRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { frameSamples, inputRate, outputRate } = options.processorOptions;

    this.frameSamples = frameSamples;
    this.step = inputRate / outputRate;
    this.frame = new Int16Array(frameSamples);
    this.filled = 0;

    // Fractional read position into the incoming quantum, carried across calls
    // so a resampled stream has no discontinuity at the quantum boundary.
    this.cursor = 0;
    this.previous = 0;
  }

  /** Clamp and scale one float sample to signed 16-bit. */
  static toInt16(sample) {
    const clamped = Math.max(-1, Math.min(1, sample));
    return clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }

  push(sample) {
    this.frame[this.filled++] = PcmRecorder.toInt16(sample);
    if (this.filled === this.frameSamples) {
      // Hand over the buffer rather than copying it; a fresh one costs less
      // than 200ms of memcpy every 200ms forever.
      const frame = this.frame;
      this.frame = new Int16Array(this.frameSamples);
      this.filled = 0;
      this.port.postMessage(frame, [frame.buffer]);
    }
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    // No input yet, or the track ended. Keeping the processor alive means a
    // muted-then-unmuted microphone resumes instead of needing a new node.
    if (!channel || channel.length === 0) return true;

    if (this.step === 1) {
      for (let i = 0; i < channel.length; i += 1) this.push(channel[i]);
      return true;
    }

    // Linear interpolation between the last sample of the previous quantum and
    // the current one, so the seam is interpolated like everything else.
    let position = this.cursor;
    while (position < channel.length) {
      const index = Math.floor(position);
      const fraction = position - index;
      const before = index === 0 ? this.previous : channel[index - 1];
      const after = channel[index];
      this.push(before + (after - before) * fraction);
      position += this.step;
    }
    this.cursor = position - channel.length;
    this.previous = channel[channel.length - 1];
    return true;
  }
}

registerProcessor("pcm-recorder", PcmRecorder);
