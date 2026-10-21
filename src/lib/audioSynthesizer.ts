/**
 * Ambient Audio Synthesizer for MoodTide
 * Uses Web Audio API to produce generative ambient chords & tones matching song tempo and valence.
 */

class AudioSynthesizer {
  private ctx: AudioContext | null = null;
  private isPlaying = false;
  private gainNode: GainNode | null = null;
  private intervalId: number | null = null;
  private volume = 0.6;

  private initContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setVolume(val: number) {
    this.volume = Math.max(0, Math.min(1, val));
    if (this.gainNode && this.ctx) {
      this.gainNode.gain.setTargetAtTime(this.volume * 0.25, this.ctx.currentTime, 0.05);
    }
  }

  public playTrack(features: { energy: number; happiness: number; tempo: number }) {
    try {
      this.initContext();
      if (!this.ctx) return;

      this.stop();
      this.isPlaying = true;

      // Master gain
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.setValueAtTime(this.volume * 0.22, this.ctx.currentTime);
      this.gainNode.connect(this.ctx.destination);

      // Pitch scale based on happiness & mood
      // Base frequencies (A minor / C major pentatonic)
      const baseFreqs = features.happiness > 0.5 
        ? [261.63, 329.63, 392.00, 523.25, 659.25] // C, E, G, C, E (warm major)
        : [220.00, 261.63, 329.63, 440.00, 523.25]; // A, C, E, A, C (reflective minor)

      const triggerChord = () => {
        if (!this.isPlaying || !this.ctx || !this.gainNode) return;

        const oscCount = Math.floor(2 + features.energy * 2);
        for (let i = 0; i < oscCount; i++) {
          const osc = this.ctx.createOscillator();
          const noteGain = this.ctx.createGain();
          const filter = this.ctx.createBiquadFilter();

          // Osc waveform
          osc.type = features.energy > 0.6 ? 'sawtooth' : 'sine';
          const freq = baseFreqs[Math.floor(Math.random() * baseFreqs.length)];
          osc.frequency.setValueAtTime(freq * (1 + (Math.random() * 0.02 - 0.01)), this.ctx.currentTime);

          // Warm low-pass filter
          filter.type = 'lowpass';
          filter.frequency.setValueAtTime(400 + features.energy * 1200, this.ctx.currentTime);

          const now = this.ctx.currentTime;
          const attack = 0.3 + (1 - features.energy) * 0.6;
          const decay = 1.5 + (1 - features.energy) * 2;

          noteGain.gain.setValueAtTime(0.001, now);
          noteGain.gain.exponentialRampToValueAtTime(0.12, now + attack);
          noteGain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);

          osc.connect(filter);
          filter.connect(noteGain);
          noteGain.connect(this.gainNode);

          osc.start(now);
          osc.stop(now + attack + decay + 0.1);
        }
      };

      triggerChord();
      const beatInterval = Math.max(800, (60 / Math.max(60, features.tempo)) * 2000);
      this.intervalId = window.setInterval(triggerChord, beatInterval);
    } catch {
      // Audio autoplay policy or unavailable
    }
  }

  public stop() {
    this.isPlaying = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.gainNode && this.ctx) {
      try {
        this.gainNode.gain.setValueAtTime(0, this.ctx.currentTime);
      } catch {
        // ignore
      }
      this.gainNode = null;
    }
  }

  public pause() {
    this.stop();
  }
}

export const audioSynth = new AudioSynthesizer();
