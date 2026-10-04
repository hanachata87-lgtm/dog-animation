/* ============================================================
   sound.js
   カメラの音。音のファイルは使わず、ぜんぶ その場で合成する。

     shutter()  … 「カシャッ」
     voice()    … 撮るたびに ちがう「ぴょん」「ワン」「ニャー」…

   ※ iPhone は、画面をさわったあとでないと 音が出せない。
     シャッターを押した「そのしゅんかん」に鳴らすので ちょうどよい。
   ※ iPhone の消音スイッチ（サイレント）が入っていると 鳴らない。
   ============================================================ */

let ac = null;
let lastVoice = -1;

function ctx() {
  if (!ac) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
  }
  if (ac.state === 'suspended') { try { ac.resume(); } catch { /* 無視 */ } }
  return ac;
}

/** 「さわった」しゅんかんに 呼んでおく（音を出せる状態にするため） */
export function unlockAudio() { ctx(); }

/** なめらかに 音のたかさを変える ふえ */
function tone(c, { type = 'sine', from, to, mid, dur, vol = 0.22, at = 0, lowpass, vibrato }) {
  const t0 = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, t0);
  if (mid) o.frequency.linearRampToValueAtTime(mid, t0 + dur * 0.5);
  o.frequency.linearRampToValueAtTime(to ?? from, t0 + dur);

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.02, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  let node = o;
  if (lowpass) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = lowpass;
    o.connect(f); node = f;
  }
  node.connect(g); g.connect(c.destination);

  if (vibrato) {
    const lfo = c.createOscillator();
    const lg = c.createGain();
    lfo.frequency.value = vibrato.hz; lg.gain.value = vibrato.depth;
    lfo.connect(lg); lg.connect(o.frequency);
    lfo.start(t0); lfo.stop(t0 + dur + 0.05);
  }
  o.start(t0); o.stop(t0 + dur + 0.05);
}

/** ノイズのひとかたまり（シャッターの「カシャ」） */
function noise(c, { dur, vol, freq, q = 1, at = 0 }) {
  const t0 = c.currentTime + at;
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(f); f.connect(g); g.connect(c.destination);
  src.start(t0);
}

/** カシャッ */
export function shutter() {
  const c = ctx(); if (!c) return;
  noise(c, { dur: 0.05, vol: 0.55, freq: 3200, q: 0.8 });
  tone(c, { type: 'square', from: 1800, to: 900, dur: 0.04, vol: 0.10 });
  noise(c, { dur: 0.09, vol: 0.40, freq: 1800, q: 0.9, at: 0.07 });
}

/** 撮るたびに ちがう声（おなじ声が 2回つづかない） */
const VOICES = [
  /* ぽん */   (c) => tone(c, { from: 380, to: 920, dur: 0.14 }),
  /* ぼいん */ (c) => tone(c, { from: 220, mid: 640, to: 240, dur: 0.34, vibrato: { hz: 14, depth: 40 } }),
  /* ワン */   (c) => { tone(c, { type: 'sawtooth', from: 300, to: 150, dur: 0.18, vol: 0.30, lowpass: 900 });
                        tone(c, { type: 'sawtooth', from: 300, to: 150, dur: 0.18, vol: 0.30, lowpass: 900, at: 0.24 }); },
  /* ニャー */ (c) => tone(c, { type: 'sawtooth', from: 520, mid: 860, to: 560, dur: 0.46, vol: 0.20, lowpass: 2200,
                               vibrato: { hz: 6, depth: 25 } }),
  /* ぴよぴよ */(c) => { for (let i = 0; i < 3; i++) tone(c, { type: 'triangle', from: 1900, mid: 2600, to: 2000, dur: 0.07, vol: 0.18, at: i * 0.11 }); },
  /* ぴゅー */ (c) => tone(c, { from: 600, to: 1900, dur: 0.28, vol: 0.20 }),
  /* ポロロン */(c) => { [523, 659, 784, 1047].forEach((f, i) => tone(c, { type: 'triangle', from: f, to: f, dur: 0.16, vol: 0.20, at: i * 0.07 })); },
  /* ぶー */   (c) => tone(c, { type: 'square', from: 110, to: 90, dur: 0.22, vol: 0.14, lowpass: 500 }),
];

export const VOICE_COUNT = VOICES.length;

export function voice() {
  const c = ctx(); if (!c) return;
  let i;
  do { i = (Math.random() * VOICES.length) | 0; } while (VOICES.length > 1 && i === lastVoice);
  lastVoice = i;
  VOICES[i](c);
}

/** パレードのはじまり（のぼっていく ファンファーレ） */
export function fanfare() {
  const c = ctx(); if (!c) return;
  [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, { type: 'triangle', from: f, to: f, dur: 0.22, vol: 0.2, at: i * 0.09 }));
  tone(c, { type: 'square', from: 1047, to: 1047, dur: 0.5, vol: 0.07, at: 0.45 });
}
