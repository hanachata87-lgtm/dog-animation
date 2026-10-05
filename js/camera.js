/* ============================================================
   camera.js
   あそび用のカメラ。撮った写真は「どこにも のこらない」。

   ・画面したの まるいボタンで パシャッ（連打OK）。音と キラキラ。画面は 光らせない（まぶしくないように）
   ・撮った絵は、すぐに切り抜かれて、ライブ映像の上で 動きはじめる
       - その場ではずむ／スーパーボール／走りまわる
       - ときどき 「びっくり箱」：走りぬけて 消えてしまう
       - 6回に1回 「パレード」：いまある絵が みんなで走りぬける
   ・画面にいられるのは 12まい。ふえすぎると 古いものから ポンと消える
   ・写真は 端末のカメラロールにも、アプリの保存にも 入らない
     （メモリの中だけ。アプリを閉じれば 何も残らない）
   ・子どもロックは 再生画面と 共通（lock.js）。
     カメラの切りかえだけ 小さなボタンの 0.7秒ながおし
   ============================================================ */

import { createLock, attachHold } from './lock.js';
import { createTravel, RUN_MS } from './travel.js';
import { MOTIONS } from './motions.js';
import { loadSegmenter, segmentAt } from './segmenter.js';
import { maskFromLabels, buildCutout, resampleMask } from './cutout.js';
import { unlockAudio, shutter, voice, fanfare } from './sound.js';

const MAX_SPRITES   = 12;        // 画面にいられる数
const PARADE_EVERY  = 6;         // 何回に1回 パレードか
const MIN_INTERVAL  = 80;        // 連打のときの さいしょの間かく（ミリ秒）
const MAX_PENDING   = 3;         // 切り抜きを 待たせておける数（これをこえると 楕円のまま）
const TEMPO         = 2;         // はやさ（大きいほどゆっくり）。ふつう＝2
const SPARKLES      = ['✨', '💖', '⭐️', '🌸', '🎈'];
const POSE_KEYS     = ['pyoko', 'spin', 'shake', 'sway', 'pulse'];

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const easeOutBack = (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };

export const cameraSupported = () =>
  !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;

/** カメラが ひらけなかったときの、子ども向けではなく おうちの人向けの ひとこと */
export function cameraErrorMessage(err) {
  const name = err && err.name;
  if (!cameraSupported()) return 'このブラウザでは カメラが つかえません。（https のページで、Safari か Chrome で ひらいてください）';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'カメラの つかいかたが ゆるされていません。ブラウザの せってい（アドレスバーの カギ／ⓘ のマーク）から カメラを「ゆるす」にして、もういちど ためしてください。';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'カメラが 見つかりませんでした。';
  if (name === 'NotReadableError') return '他のアプリが カメラを つかっているようです。そちらを とじてから ためしてください。';
  return 'カメラを ひらけませんでした。';
}

export function createCamera({ root, canvas, exitBtn, ring, flipBtn, flipRing, toast, shutterBtn }) {
  const ctx = canvas.getContext('2d');

  /* ---------- じょうたい ---------- */
  let running = false;
  let rafId = 0;
  let lastTime = 0;
  let cssW = 0, cssH = 0;
  let stream = null;
  let facing = 'user';
  let onExitCallback = null;

  let sprites = [];
  let particles = [];
  let shots = 0;
  let lastShotAt = 0;
  let aiReady = false;
  let pending = 0;
  let chain = Promise.resolve();
  let flipHold = null;

  // 映像を うけとる video（画面には出さず、canvas に うつして使う）
  const video = document.createElement('video');
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');
  video.muted = true;
  video.autoplay = true;
  Object.assign(video.style, { position: 'fixed', left: '-9999px', top: '0', width: '2px', height: '2px', opacity: '0' });
  root.appendChild(video);

  const mirror = () => facing === 'user';
  const videoReady = () => video.readyState >= 2 && video.videoWidth > 0;

  /* ---------- 大きさあわせ ---------- */
  function resize() {
    const vv = window.visualViewport;
    cssW = Math.round(vv ? vv.width  : window.innerWidth);
    cssH = Math.round(vv ? vv.height : window.innerHeight);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /* ---------- カメラ ---------- */
  async function openStream(want) {
    const tries = [
      { video: { facingMode: { ideal: want }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: true, audio: false },
    ];
    let lastErr;
    for (const c of tries) {
      try { return await navigator.mediaDevices.getUserMedia(c); }
      catch (e) {
        lastErr = e;
        if (e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')) throw e;   // 許可されないなら 何度やっても同じ
      }
    }
    throw lastErr;
  }

  function stopStream() {
    if (stream) { for (const t of stream.getTracks()) { try { t.stop(); } catch { /* 無視 */ } } }
    stream = null;
    video.srcObject = null;
  }

  async function attach(s) {
    stream = s;
    video.srcObject = s;
    try { await video.play(); } catch { /* 自動再生がだめでも 映像は くる */ }
  }

  /** 前のカメラ ⇄ うしろのカメラ */
  async function flip() {
    const next = facing === 'user' ? 'environment' : 'user';
    try {
      const s = await openStream(next);
      stopStream();
      facing = next;
      await attach(s);
      root.dataset.facing = facing;
    } catch { /* 切りかえられなかったら そのまま */ }
  }

  /** アプリを はなれて もどってきたとき、止まっていたら ひらきなおす */
  async function onVisibility() {
    if (!running || document.visibilityState !== 'visible') return;
    const live = stream && stream.getTracks().some((t) => t.readyState === 'live');
    if (live) return;
    try { await attach(await openStream(facing)); } catch { /* 無視 */ }
  }

  /* ---------- 映像のうつしかた（画面いっぱいに ぴったり） ---------- */
  /** 画面に見えている はんいを、映像の座標で返す（cover） */
  function visibleRect() {
    const vw = video.videoWidth, vh = video.videoHeight;
    const sa = cssW / cssH, va = vw / vh;
    const sw = va > sa ? vh * sa : vw;
    const sh = va > sa ? vh : vw / sa;
    return { x: (vw - sw) / 2, y: (vh - sh) / 2, w: sw, h: sh };
  }

  function drawVideo() {
    if (!videoReady()) {
      const g = ctx.createLinearGradient(0, 0, 0, cssH);
      g.addColorStop(0, '#bfe6ff'); g.addColorStop(1, '#fff3e0');
      ctx.fillStyle = g; ctx.fillRect(0, 0, cssW, cssH);
      ctx.fillStyle = 'rgba(64,50,58,.7)';
      ctx.font = '700 18px system-ui, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('カメラを じゅんびちゅう…', cssW / 2, cssH / 2);
      return;
    }
    const r = visibleRect();
    ctx.save();
    if (mirror()) { ctx.translate(cssW, 0); ctx.scale(-1, 1); }
    ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, cssW, cssH);
    ctx.restore();
  }

  /** いま見えている絵を 1まい ぬきとる（鏡うつしのまま） */
  function grabFrame(maxSide = 640) {
    const r = visibleRect();
    const sc = Math.min(1, maxSide / Math.max(r.w, r.h));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(r.w * sc));
    c.height = Math.max(1, Math.round(r.h * sc));
    const g = c.getContext('2d');
    if (mirror()) { g.translate(c.width, 0); g.scale(-1, 1); }
    g.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, c.width, c.height);
    return c;
  }

  /* ---------- 切り抜き ---------- */
  /** すぐ使える 切り抜き：まん中を やわらかい楕円で くりぬく（AIを待たない） */
  function ovalCutout(frame) {
    const w = frame.width, h = frame.height;
    const rx = w * 0.36, ry = h * 0.44;
    const out = document.createElement('canvas');
    out.width = Math.max(2, Math.round(rx * 2));
    out.height = Math.max(2, Math.round(ry * 2));
    const g = out.getContext('2d');
    g.drawImage(frame, w / 2 - rx, h / 2 - ry, rx * 2, ry * 2, 0, 0, out.width, out.height);
    g.globalCompositeOperation = 'destination-in';
    g.save();
    g.translate(out.width / 2, out.height / 2);
    g.scale(out.width / 2, out.height / 2);
    const grad = g.createRadialGradient(0, 0, 0.72, 0, 0, 1);
    grad.addColorStop(0, 'rgba(0,0,0,1)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(-1, -1, 2, 2);
    g.restore();
    return out;
  }

  /** AIで ちゃんと切り抜く。まん中あたりに うつっているものを 切り出す。だめなら null */
  async function aiCutout(frame) {
    const seg = await loadSegmenter();
    const raw = await segmentAt(seg, frame, 0.5, 0.55);
    const px = clamp(Math.round(0.5 * raw.width), 0, raw.width - 1);
    const py = clamp(Math.round(0.55 * raw.height), 0, raw.height - 1);
    const res = maskFromLabels(raw, px, py);
    if (res.coverage < 0.03 || res.coverage > 0.9) return null;     // 小さすぎ／画面ぜんぶ は あてにしない
    const mask = (res.width === frame.width && res.height === frame.height)
      ? res.mask : resampleMask(res.mask, res.width, res.height, frame.width, frame.height);
    return buildCutout(frame, mask, frame.width, frame.height);
  }

  /** 切り抜きは 順番に 1つずつ。たまりすぎたら あきらめて 楕円のままにする */
  function enqueueUpgrade(frame, sp) {
    if (!aiReady || pending >= MAX_PENDING) return;
    pending++;
    chain = chain.then(async () => {
      try {
        const cut = await aiCutout(frame);
        if (cut && sp.alive && running) {
          setImage(sp, cut);
          puff(sp.x, sp.y);
          root.dataset.upgraded = String((+root.dataset.upgraded || 0) + 1);   // 見た目には出ない（テスト用の目印）
        }
      } catch { /* AIがだめなら 楕円のまま */ }
      finally { pending--; }
    });
  }

  /* ---------- 絵（スプライト） ---------- */
  function setImage(sp, img) {
    sp.img = img;
    const k = sp.size / Math.max(img.width, img.height);
    sp.w = img.width * k;
    sp.h = img.height * k;
  }

  /** どの動きかたに するか。はじめの1まいは かならず 残る動きにする */
  function chooseKind(first) {
    const r = Math.random();
    if (first) return r < 0.5 ? 'bounce' : 'stay';
    if (r < 0.30) return 'bounce';
    if (r < 0.55) return 'stay';
    if (r < 0.78) return 'run';
    return 'dash';                    // びっくり箱：走りぬけて きえる
  }

  function spawn(img, at, now, first) {
    const kind = chooseKind(first);
    const size = Math.min(cssW, cssH) * rand(0.34, 0.46);
    const margin = size * 0.5;
    const home = { x: clamp(at.x, margin, cssW - margin), y: clamp(at.y, margin, cssH - margin) };
    const motionKey = pick(POSE_KEYS);
    const sp = {
      alive: true, kind, motionKey, size, home,
      born: now, phase0: Math.random(), dying: 0,
      lane: rand(0.30, 0.72),                // 走るときの たかさ
      x: home.x, y: home.y,
      tempo: kind === 'dash' ? 1.4 : TEMPO,
      travel: null, parade: null,
    };
    if (kind === 'bounce') sp.travel = createTravel('bounce', TEMPO, home);
    if (kind === 'run' || kind === 'dash') sp.travel = createTravel('run', sp.tempo);
    setImage(sp, img);
    sprites.push(sp);

    // いっぱいになったら いちばん古いのを ポンと消す
    const living = sprites.filter((s) => !s.dying);
    if (living.length > MAX_SPRITES) { living[0].dying = now; puff(living[0].x, living[0].y); }
    return sp;
  }

  /** パレード：いまいる絵が、順ぐりに 走りぬける */
  function startParade(now) {
    let i = 0;
    for (const sp of sprites) {
      if (sp.dying || sp.kind === 'dash') continue;
      const delay = 300 + i * 260;
      sp.parade = { start: now + delay, end: now + delay + RUN_MS * 1.4 + 300, travel: createTravel('run', 1.4) };
      i++;
    }
  }

  function updateSprite(sp, now, dt) {
    const m = MOTIONS[sp.motionKey];
    const dur = m.defaultDuration * sp.tempo;
    const phase = (((now - sp.born) / dur + sp.phase0) % 1 + 1) % 1;
    const pose = m.pose(phase);

    // どの動きまわりかたを つかうか（パレード中は 走る）
    let travel = sp.travel, kind = sp.kind;
    if (sp.parade) {
      if (now >= sp.parade.end) sp.parade = null;
      else if (now >= sp.parade.start) { travel = sp.parade.travel; kind = 'run'; }
    }

    let x = sp.home.x, y = sp.home.y, flip = 1, spin = 0;
    if (kind === 'stay' || !travel) {
      y = sp.home.y - pose.lift * cssH * m.hopHeight * 0.7;
      x = sp.home.x + pose.dx * cssW;
    } else {
      const tr = travel.step(dt, cssW, cssH, sp.w, sp.h);
      x = tr.x != null ? tr.x : sp.home.x;
      y = tr.y != null ? tr.y : sp.lane * cssH;
      flip = tr.flip; spin = tr.spin;
    }
    sp.x = x; sp.y = y;

    // びっくり箱は 1回よこぎったら おしまい
    if (sp.kind === 'dash' && now - sp.born > RUN_MS * sp.tempo + 250) { sp.alive = false; return; }

    // ぽんっと はずんで でてくる／ポンと きえる
    let pop = easeOutBack(clamp((now - sp.born) / 380, 0, 1));
    if (sp.dying) {
      const k = clamp((now - sp.dying) / 280, 0, 1);
      pop *= 1 - k;
      if (k >= 1) { sp.alive = false; return; }
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(pose.rot + spin);
    ctx.scale(pose.sx * flip * pop, pose.sy * pop);
    ctx.drawImage(sp.img, -sp.w / 2, -sp.h / 2, sp.w, sp.h);
    ctx.restore();
  }

  /* ---------- キラキラ ---------- */
  function puff(x, y, n = 10) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 320,
        vy: -120 - Math.random() * 260,
        life: 1, size: 16 + Math.random() * 18,
        ch: pick(SPARKLES),
      });
    }
    if (particles.length > 140) particles = particles.slice(-140);
  }

  function drawParticles(dt) {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const p of particles) {
      p.life -= dt / 900;
      p.vy += 620 * dt / 1000;
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
      if (p.life <= 0) continue;
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.font = `${p.size}px serif`;
      ctx.fillText(p.ch, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    particles = particles.filter((p) => p.life > 0);
  }

  /* ---------- パシャッ！（まるいボタン） ---------- */
  function shoot() {
    const now = performance.now();
    if (now - lastShotAt < MIN_INTERVAL) return;       // 連打でも 追いつけるぐらいの 間かく
    lastShotAt = now;
    unlockAudio();
    if (!videoReady()) return;

    shots++;
    root.dataset.shots = String(shots);
    shutter();
    setTimeout(voice, 110);                            // カシャッ → ぴょん／ワン／ニャー
    // 画面は 光らせない。ボタンが ぽよんと へこむだけ
    shutterBtn.classList.remove('is-shot'); void shutterBtn.offsetWidth; shutterBtn.classList.add('is-shot');

    // 絵は 画面の うえのほうの どこかに ぽんっと出てくる（ボタンや つまみの下は さける）
    const at = { x: rand(cssW * 0.15, cssW * 0.85), y: rand(cssH * 0.2, cssH * 0.6) };
    const frame = grabFrame();
    const sp = spawn(ovalCutout(frame), at, now, shots === 1);
    enqueueUpgrade(frame, sp);
    puff(at.x, at.y);

    if (shots % PARADE_EVERY === 0) {
      setTimeout(fanfare, 250);
      startParade(now + 400);
    }
    root.dataset.sprites = String(sprites.filter((s) => s.alive && !s.dying).length);
  }

  /* ---------- 1コマ ---------- */
  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    const dt = Math.min(now - lastTime, 50);
    lastTime = now;

    drawVideo();
    for (const sp of sprites) updateSprite(sp, now, dt);
    sprites = sprites.filter((s) => s.alive);
    drawParticles(dt);

    root.dataset.sprites = String(sprites.filter((s) => !s.dying).length);
  }

  /* ---------- 子どもロック ---------- */
  const lock = createLock({
    root, exitBtn, ring,
    onTouch: (e) => { if (shutterBtn.contains(e.target)) shoot(); },      // まるいボタンだけ パシャッ（ほかは なにも起きない）
    onExit: () => finish(),
  });

  /* ---------- はじめる・おわる ---------- */
  /** カメラをひらいて、ロックをかける。ひらけなかったら 例外を投げる（ロックはかけない） */
  async function start({ onExit }) {
    if (running) return;
    onExitCallback = onExit;
    unlockAudio();

    const s = await openStream(facing);                // 許可されなければ ここで例外（画面はそのまま）

    try {
      root.hidden = false;
      resize();
      running = true;
      sprites = []; particles = []; shots = 0; pending = 0; chain = Promise.resolve();
      root.dataset.shots = '0'; root.dataset.sprites = '0'; root.dataset.facing = facing; root.dataset.upgraded = '0';
      lastTime = performance.now();
      await attach(s);
    } catch (err) {
      // うまく はじめられなかったら カメラを止めて、もとの画面に もどす（ランプを点けっぱなしにしない）
      running = false;
      stopStream();
      s.getTracks().forEach((t) => { try { t.stop(); } catch { /* 無視 */ } });
      root.hidden = true;
      throw err;
    }

    window.addEventListener('resize', resize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    flipHold = attachHold(flipBtn, flipRing, 700, flip);
    lock.start();

    // 切り抜きAIは うらで じゅんび。できるまでは 楕円で切り抜く
    aiReady = false;
    loadSegmenter().then(() => { aiReady = true; root.dataset.ai = 'ready'; }).catch(() => { root.dataset.ai = 'failed'; });
    root.dataset.ai = 'loading';

    toast.classList.remove('is-hidden');
    setTimeout(() => toast.classList.add('is-hidden'), 4000);
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  /** 後かたづけ。撮った絵は ここで ぜんぶ すてる */
  function finish() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resize);
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', onVisibility);
    if (flipHold) { flipHold.detach(); flipHold = null; }
    stopStream();
    sprites = []; particles = []; chain = Promise.resolve();
    root.hidden = true;
    if (onExitCallback) onExitCallback();
  }

  function stop() { lock.stop(); finish(); }

  return { start, stop };
}
