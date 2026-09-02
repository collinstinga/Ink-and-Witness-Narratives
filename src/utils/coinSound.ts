/**
 * Ink & Witness - Web Audio API Synthesizer
 * Produces a crisp, bright, 1-second golden coin drop and chime sound effect
 * without requiring external media files or network downloads.
 */

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioCtx || audioCtx.state === 'closed') {
      audioCtx = new AudioContextClass();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function playCoinDropSound(volume = 0.65): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // Helper to create an impulse metallic clink
    const createCoinClink = (startTime: number, freq: number, gainVal: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq, startTime);
      filter.Q.setValueAtTime(14, startTime);

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      osc.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 0.95), startTime + duration);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(gainVal * volume, startTime + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.05);
    };

    // Helper to create sparkling harmonic resonance
    const createShimmer = (startTime: number, freq: number, gainVal: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.linearRampToValueAtTime(gainVal * volume, startTime + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration + 0.05);
    };

    // 1-second coin drop sequence:
    // 1. Initial crisp coin strike at 0.00s
    createCoinClink(now + 0.00, 2093, 0.45, 0.16); // C7
    createCoinClink(now + 0.00, 3136, 0.35, 0.12); // G7
    createShimmer(now + 0.00, 4186, 0.18, 0.30);   // C8

    // 2. Secondary bounce clink at 0.12s
    createCoinClink(now + 0.12, 2349, 0.38, 0.14); // D7
    createCoinClink(now + 0.12, 3520, 0.26, 0.10); // A7

    // 3. Third settling clink at 0.24s
    createCoinClink(now + 0.24, 2637, 0.30, 0.14); // E7
    createCoinClink(now + 0.24, 3951, 0.20, 0.10); // B7

    // 4. Golden metallic chime ring-out sustaining through exactly 1.0s
    createShimmer(now + 0.25, 2093, 0.24, 0.75); // Ring tone until t=1.0s
    createShimmer(now + 0.25, 2793, 0.16, 0.72); // Harmonic resonance
  } catch (err) {
    console.warn('[Coin Sound] Playback note:', err);
  }
}
