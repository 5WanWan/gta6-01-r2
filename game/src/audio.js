// audio.js — every sound is synthesized with WebAudio: engine hum, sirens,
// gunshots, chimes and a small bass-and-hats music loop. No audio files.
export function makeAudio() {
  const api = {
    ctx: null, master: null, muted: false, musicTimer: null, musicStep: 0,
    engineOsc: null, engineGain: null,
    /** Create the context on first user gesture (browsers require one). */
    ensure() {
      if (api.ctx) return true;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        api.ctx = new AC();
        api.master = api.ctx.createGain();
        api.master.gain.value = 0.5;
        api.master.connect(api.ctx.destination);
        api.startMusic();
        return true;
      } catch {
        return false;
      }
    },
    toggleMute() {
      api.muted = !api.muted;
      if (api.master) api.master.gain.value = api.muted ? 0 : 0.5;
      return api.muted;
    },
    tone(freq, dur, type, vol, slideTo) {
      if (!api.ctx || api.muted) return;
      const t = api.ctx.currentTime;
      const osc = api.ctx.createOscillator();
      const gain = api.ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
      gain.gain.setValueAtTime(vol || 0.2, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(api.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    },
    noise(dur, vol, lowpass) {
      if (!api.ctx || api.muted) return;
      const t = api.ctx.currentTime;
      const len = Math.max(1, Math.floor(api.ctx.sampleRate * dur));
      const buf = api.ctx.createBuffer(1, len, api.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = api.ctx.createBufferSource();
      src.buffer = buf;
      const gain = api.ctx.createGain();
      gain.gain.value = vol || 0.25;
      if (lowpass) {
        const filter = api.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = lowpass;
        src.connect(filter);
        filter.connect(gain);
      } else {
        src.connect(gain);
      }
      gain.connect(api.master);
      src.start(t);
    },
    shot() { api.noise(0.12, 0.4, 2400); api.tone(180, 0.08, 'square', 0.12, 60); },
    enemyShot() { api.noise(0.1, 0.18, 1800); },
    punch() { api.noise(0.08, 0.3, 900); },
    crash() { api.noise(0.3, 0.4, 700); api.tone(90, 0.25, 'sawtooth', 0.15, 40); },
    honk() { api.tone(370, 0.18, 'square', 0.1); api.tone(466, 0.18, 'square', 0.08); },
    chime() { api.tone(880, 0.12, 'sine', 0.2); setTimeout(() => api.tone(1318, 0.18, 'sine', 0.2), 90); },
    door() { api.noise(0.07, 0.2, 1200); api.tone(140, 0.07, 'triangle', 0.15, 90); },
    steal() { api.tone(520, 0.1, 'square', 0.12); setTimeout(() => api.tone(660, 0.14, 'square', 0.12), 100); },
    missionStart() { api.tone(392, 0.14, 'triangle', 0.22); setTimeout(() => api.tone(523, 0.14, 'triangle', 0.22), 130); setTimeout(() => api.tone(659, 0.22, 'triangle', 0.22), 260); },
    missionDone() {
      [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => api.tone(f, 0.2, 'triangle', 0.22), i * 120));
    },
    fail() { api.tone(330, 0.25, 'sawtooth', 0.15, 160); },
    busted() { api.tone(220, 0.5, 'sawtooth', 0.2, 110); api.noise(0.4, 0.2, 800); },
    wasted() { api.tone(180, 0.8, 'sawtooth', 0.2, 55); },
    sirenBurst() { api.tone(700, 0.3, 'sine', 0.1, 950); setTimeout(() => api.tone(950, 0.3, 'sine', 0.1, 700), 300); },
    sirenLoop() { api.tone(720, 0.9, 'sine', 0.05, 980); },
    /** Engine hum follows the player's speed; called every frame. */
    engine(speed, maxSpeed) {
      if (!api.ctx || api.muted) return;
      const t = api.ctx.currentTime;
      if (!api.engineOsc) {
        api.engineOsc = api.ctx.createOscillator();
        api.engineGain = api.ctx.createGain();
        api.engineOsc.type = 'sawtooth';
        api.engineGain.gain.value = 0;
        const filter = api.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        api.engineOsc.connect(filter);
        filter.connect(api.engineGain);
        api.engineGain.connect(api.master);
        api.engineOsc.start();
      }
      const ratio = Math.max(0, Math.min(1, speed / (maxSpeed || 400)));
      api.engineOsc.frequency.setTargetAtTime(55 + ratio * 130, t, 0.05);
      api.engineGain.gain.setTargetAtTime(0.02 + ratio * 0.05, t, 0.1);
    },
    /** A lazy sun-soaked bassline: A-minor groove, hats on the off-beat. */
    startMusic() {
      if (api.musicTimer || !api.ctx) return;
      const bass = [55, 0, 55, 0, 65.4, 0, 55, 0, 49, 0, 49, 0, 58.3, 0, 65.4, 0];
      api.musicTimer = setInterval(() => {
        if (api.muted || !api.ctx) return;
        const step = api.musicStep % 16;
        const note = bass[step];
        if (note) api.tone(note, 0.22, 'triangle', 0.11);
        if (step % 4 === 2) api.tone(880, 0.05, 'sine', 0.04);
        if (step % 2 === 1) api.noise(0.03, 0.03, 6000);
        api.musicStep += 1;
      }, 210);
    },
  };
  return api;
}
