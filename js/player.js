/* ============================================================
   player.js
   全画面ループ再生 ＋ 子どもロック。
   ・画面をさわっても止まらない／切り替わらない
   ・さわると わんちゃんが 大きくはねて キラキラが出る
   ・おわるのは「右上のボタンを2.5秒ながおし」だけ
   ============================================================ */

import { getMotion } from './motions.js';
import { drawBodyBack, drawBodyFront, BODY_HEIGHT } from './body.js';
import { buildWiggle } from './wiggle.js';
import { createTravel } from './travel.js';

const HOLD_MS   = 2500;   // 大人だけができるながおしの時間
const RING_LEN  = 2 * Math.PI * 20;
const SPARKLES  = ['✨', '💖', '⭐️', '🌸'];

export function createPlayer({ root, canvas, exitBtn, ring, toast }) {
  const ctx = canvas.getContext('2d');

  let running = false;
  let image = null;
  let motion = getMotion('pyoko');
  let duration = 800;
  let startTime = 0;
  let lastTime = 0;
  let boost = 0;                 // タップしたときの「もっと高くはねる」量
  let part = 'body';             // body / face / chara
  let wiggleData = null;         // しっぽ・前足をゆらすための絵（使うときだけ）
  let travel = createTravel('none');  // 画面のどこを動きまわるか
  let tapMode = 'dog';           // さわったときの反応 dog / sparkle / both
  let stamps = [];               // さわるたびに ふえる わんちゃん
  let particles = [];
  let rafId = 0;
  let wakeLock = null;
  let cssW = 0, cssH = 0;

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

  /* ---------- 背景 ---------- */
  function drawBackground(now) {
    const g = ctx.createLinearGradient(0, 0, 0, cssH);
    g.addColorStop(0, '#bfe6ff');
    g.addColorStop(0.55, '#e9f6ff');
    g.addColorStop(1, '#fff3e0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cssW, cssH);

    // ふわふわ浮かぶ雲
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    for (let i = 0; i < 3; i++) {
      const t = now / 9000 + i * 0.37;
      const x = ((t % 1) * (cssW + 240)) - 120;
      const y = cssH * (0.12 + i * 0.09) + Math.sin(now / 1400 + i) * 6;
      const r = cssW * (0.05 + i * 0.012);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.arc(x + r * 0.9, y + r * 0.15, r * 0.75, 0, Math.PI * 2);
      ctx.arc(x - r * 0.9, y + r * 0.2, r * 0.65, 0, Math.PI * 2);
      ctx.fill();
    }

    // 草はら
    const groundY = cssH * 0.80;
    ctx.fillStyle = '#a8e08f';
    ctx.beginPath();
    ctx.moveTo(0, groundY + 14);
    ctx.quadraticCurveTo(cssW / 2, groundY - 18, cssW, groundY + 14);
    ctx.lineTo(cssW, cssH); ctx.lineTo(0, cssH); ctx.closePath();
    ctx.fill();
    return groundY;
  }

  /* ---------- さわると ふえる わんちゃん ---------- */
  const STAMP_MAX = 40;          // ふえすぎて画面がうまらないように

  function addStamp(x, y) {
    stamps.push({
      x, y,
      born: performance.now(),
      size: (0.16 + Math.random() * 0.10) * Math.min(cssW, cssH),
      rot: (Math.random() - 0.5) * 0.7,
      phase: Math.random() * Math.PI * 2,
    });
    while (stamps.length > STAMP_MAX) stamps.shift();
  }

  function drawStamps(now) {
    if (!image) return;
    const long = Math.max(image.width, image.height);
    for (const st of stamps) {
      const age = now - st.born;
      // ぽんっと はずんで出てくる
      const t = Math.min(1, age / 320);
      const pop = (1 - Math.pow(1 - t, 3)) * (1 + 0.25 * Math.sin(t * Math.PI));
      const breathe = 1 + Math.sin(now / 700 + st.phase) * 0.03;
      const k = st.size / long * pop * breathe;
      const w = image.width * k, h = image.height * k;
      ctx.save();
      ctx.translate(st.x, st.y);
      ctx.rotate(st.rot + Math.sin(now / 900 + st.phase) * 0.04);
      ctx.drawImage(image, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }

  /* ---------- キラキラ ---------- */
  function spawnSparkles(x, y) {
    for (let i = 0; i < 10; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 260,
        vy: -140 - Math.random() * 220,
        life: 1,
        size: 18 + Math.random() * 18,
        char: SPARKLES[(Math.random() * SPARKLES.length) | 0],
      });
    }
    if (particles.length > 120) particles = particles.slice(-120);
  }

  function drawParticles(dt) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of particles) {
      p.life -= dt / 900;
      p.vy += 620 * dt / 1000;
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
      if (p.life <= 0) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
      ctx.font = `${p.size}px serif`;
      ctx.fillText(p.char, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    particles = particles.filter((p) => p.life > 0);
  }

  /* ---------- 1コマ描く ---------- */
  function frame(now) {
    if (!running) return;
    rafId = requestAnimationFrame(frame);

    const dt = Math.min(now - lastTime, 50);
    lastTime = now;
    boost *= Math.exp(-dt / 320);

    const groundY = drawBackground(now);
    const phase = (((now - startTime) / duration) % 1 + 1) % 1;
    const pose = motion.pose(phase);
    const hop = cssH * motion.hopHeight * (1 + boost * 0.7);

    // 先に「どれくらいの大きさで描くか」を決め、それを見て動きまわる位置を計算する
    const isChara = part === 'chara' && !!motion.rig;
    const m = isChara ? charaMetrics() : plainMetrics();
    const tr = travel.step(dt, cssW, cssH, m.w, m.h);
    if (isChara) drawCharacter(phase, pose, hop, groundY, m, tr);
    else drawPlainDog(phase, pose, hop, groundY, m, tr);

    drawStamps(now);   // さわって出したわんちゃんは、かならず見えるように手前へ

    drawParticles(dt);
  }

  /** 動きまわるときは、画面のはしまで行けるように 少し小さめに描く */
  const roomFactor = () => (travel.mode === 'none' ? 1 : 0.78);

  function plainMetrics() {
    const anchor = motion.anchor || 'ground';
    // 顔だけの動きは、左右に肉球の手が出るので少し小さめにする
    const maxH = cssH * (anchor === 'center' ? 0.40 : 0.42) * roomFactor();
    const maxW = cssW * (anchor === 'center' ? 0.52 : 0.72) * roomFactor();
    const scale = Math.min(maxW / image.width, maxH / image.height);
    return { anchor, w: image.width * scale, h: image.height * scale };
  }

  function charaMetrics() {
    const hs = Math.min(cssH * 0.34, cssW * 0.44) * roomFactor();
    const s = hs * 0.5;
    const bodyH = BODY_HEIGHT * s;
    // 頭のてっぺんから つま先まで
    return { hs, s, bodyH, w: hs * 1.9, h: hs * 0.98 + bodyH };
  }

  /* ---------- 写真そのものを動かす（ぜんしん・かおだけ） ---------- */
  function drawPlainDog(phase, pose, hop, groundY, m, tr) {
    const { anchor, w, h } = m;
    const cx = tr.x != null ? tr.x : cssW / 2 + pose.dx * cssW;
    let baseY;      // つぶれ／のび の軸になる位置
    let originY;    // その軸から見た 絵の上はしの位置

    if (anchor === 'center') {
      originY = -h / 2;
      baseY = tr.y != null ? tr.y : cssH * 0.46 - pose.lift * hop;
    } else {
      originY = -h;
      if (tr.y != null) {
        baseY = tr.y + h / 2;            // tr.y は まん中なので、足もとに直す
      } else {
        // タップでよろこんで高く跳んでも、画面の上からはみ出さないようにする
        const maxLift = Math.max(0, groundY - h * 1.15 - 12);
        baseY = groundY - Math.min(pose.lift * hop, maxLift);
      }
      drawGroundShadow(cx, groundY, w * 0.32, baseY);
    }

    ctx.save();
    ctx.translate(cx, baseY);
    ctx.rotate(pose.rot + tr.spin);
    ctx.scale(pose.sx * tr.flip, pose.sy);
    if (wiggleData && motion.wiggle) {
      // ゆらす場所いがいを先に描き、そのあと その場所だけを 付け根を軸にゆらす
      ctx.drawImage(wiggleData.base, -w / 2, originY, w, h);
      const px = -w / 2 + wiggleData.pivot.x / image.width  * w;
      const py = originY + wiggleData.pivot.y / image.height * h;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(motion.wiggle(phase));
      ctx.translate(-px, -py);
      ctx.drawImage(wiggleData.patch, -w / 2, originY, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(image, -w / 2, originY, w, h);
    }
    ctx.restore();

    if (motion.overlay) {
      motion.overlay(ctx, phase, { cx, cy: baseY + originY + h / 2, w, h, sw: cssW, sh: cssH });
    }
  }

  /* ---------- 顔に イラストの体をつけて動かす ---------- */
  function drawCharacter(phase, pose, hop, groundY, m, tr) {
    const { hs, s, bodyH } = m;
    const footY0 = cssH * 0.88;
    const neckX = tr.x != null ? tr.x : cssW / 2 + (pose.dx || 0) * cssW;
    const neckY = tr.y != null
      ? tr.y - (bodyH - hs * 0.98) / 2          // tr.y は 体ぜんたいの まん中
      : footY0 - bodyH - pose.lift * hop;
    const hw = image.width * (hs / image.height);
    const rig = motion.rig(phase);

    drawGroundShadow(neckX, footY0 + s * 0.30, s * 0.80, neckY + bodyH);

    ctx.save();
    ctx.translate(neckX, neckY);
    ctx.rotate(tr.spin);
    ctx.scale(tr.flip, 1);
    drawBodyBack(ctx, s, rig);

    // 顔（首のところを軸にかたむける）
    ctx.save();
    ctx.translate(0, hs * 0.02);   // 首のところ（顔の下はし）
    ctx.rotate(pose.rot);
    ctx.scale(pose.sx, pose.sy);
    ctx.drawImage(image, -hw / 2, -hs, hw, hs);
    ctx.restore();

    drawBodyFront(ctx, s, rig);
    ctx.restore();

    if (motion.overlay) {
      motion.overlay(ctx, phase, {
        cx: neckX, cy: neckY - hs * 0.48, w: hw, h: hs, sw: cssW, sh: cssH,
      });
    }
  }

  /** 地面の影。高く上がっているほど 小さく うすくなる */
  function drawGroundShadow(x, groundY, radius, bottomY) {
    const above = Math.max(0, Math.min(1, (groundY - bottomY) / (cssH * 0.45)));
    ctx.save();
    ctx.globalAlpha = 0.22 * (1 - above * 0.75);
    ctx.fillStyle = '#3b5d2a';
    ctx.beginPath();
    ctx.ellipse(x, groundY, radius * (1 - above * 0.40), radius * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---------- さわっても止まらないための守り ---------- */
  const block = (e) => { e.preventDefault(); };
  const onPointerDown = (e) => {
    if (exitBtn.contains(e.target)) return;   // おわるボタンだけは別あつかい
    boost = Math.min(1, boost + 0.8);
    if (tapMode === 'dog' || tapMode === 'both') addStamp(e.clientX, e.clientY);
    if (tapMode === 'sparkle' || tapMode === 'both') spawnSparkles(e.clientX, e.clientY);
  };

  /* --- キーボードを さわっても 何も起きないようにする ---
     （ページの中の動きは止められるが、電卓を出すような
       タブレット本体のショートカットは ブラウザからは止められない。
       そちらは Android の「アプリ固定」で止める。README を参照） */
  const blockKey = (e) => { e.preventDefault(); e.stopPropagation(); };

  /* --- 画面のはしを指ではらっても「もどる」が効かないようにする ---
     もどるが1回起きるたびに、履歴をつぎたして押しもどす。
     連打されても足りるように、はじめに何回ぶんか ためておく。 */
  const HISTORY_DEPTH = 15;
  let pushedStates = 0;
  function pushGuard(n) {
    for (let i = 0; i < n; i++) { history.pushState({ dogPlay: true }, ''); pushedStates++; }
  }
  const onPopState = () => {
    if (!running) return;
    pushedStates = Math.max(0, pushedStates - 1);
    pushGuard(3);                 // 1回もどられたら 3回ぶん つぎたす
  };

  /* --- まちがえてページを閉じそうになったら ひきとめる --- */
  const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };

  /* ---------- ながおしでおわる ---------- */
  let holdStart = 0, holdRaf = 0, holdId = null;

  function holdTick(now) {
    const p = Math.min(1, (now - holdStart) / HOLD_MS);
    ring.style.strokeDashoffset = String(RING_LEN * (1 - p));
    if (p >= 1) { cancelHold(); stop(); return; }
    holdRaf = requestAnimationFrame(holdTick);
  }
  function startHold(e) {
    e.preventDefault(); e.stopPropagation();
    holdId = e.pointerId;
    if (exitBtn.setPointerCapture) { try { exitBtn.setPointerCapture(e.pointerId); } catch {} }
    exitBtn.classList.add('is-holding');
    holdStart = performance.now();
    cancelAnimationFrame(holdRaf);
    holdRaf = requestAnimationFrame(holdTick);
  }
  function cancelHold(e) {
    if (e) { e.stopPropagation(); if (holdId !== null && e.pointerId !== holdId) return; }
    holdId = null;
    cancelAnimationFrame(holdRaf);
    exitBtn.classList.remove('is-holding');
    ring.style.strokeDashoffset = String(RING_LEN);
  }

  /* ---------- 画面をつけたままにする ---------- */
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* 使えない端末では何もしない */ }
  }
  const onVisibility = () => { if (running && document.visibilityState === 'visible') requestWakeLock(); };

  /* ---------- 開始・終了 ---------- */
  let onExitCallback = null;

  async function start({ cutout, motionName, speed, part: partName, spot,
                        travel: travelKind, tap, onExit }) {
    image = cutout;
    motion = getMotion(motionName);
    part = partName || 'body';
    wiggleData = (motion.wiggle && spot) ? buildWiggle(cutout, spot) : null;

    const tempo = Number(speed) || 1;                            // speed は倍率（大きいほどゆっくり）
    duration = motion.defaultDuration * tempo;
    travel = createTravel(travelKind || motion.defaultTravel || 'none', tempo);
    onExitCallback = onExit;

    root.hidden = false;
    resize();
    running = true;
    particles = [];
    stamps = [];
    tapMode = tap || 'dog';
    boost = 0;
    startTime = lastTime = performance.now();

    toast.classList.remove('is-hidden');
    setTimeout(() => toast.classList.add('is-hidden'), 3500);

    window.addEventListener('resize', resize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
    // 画面のはしからの スワイプも のがさないよう、ページ全体でうけとめる
    document.addEventListener('touchstart', block, { passive: false, capture: true });
    document.addEventListener('touchmove',  block, { passive: false, capture: true });
    root.addEventListener('contextmenu', block);
    root.addEventListener('dblclick', block);
    root.addEventListener('pointerdown', onPointerDown);
    for (const type of ['keydown', 'keyup', 'keypress']) {
      window.addEventListener(type, blockKey, { capture: true });
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    document.documentElement.classList.add('is-playing');
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    exitBtn.addEventListener('pointerdown', startHold);
    exitBtn.addEventListener('pointerup', cancelHold);
    exitBtn.addEventListener('pointercancel', cancelHold);
    exitBtn.addEventListener('pointerleave', cancelHold);
    document.addEventListener('visibilitychange', onVisibility);

    // もどるボタン・はしからのスワイプでも 抜けられないようにする
    pushedStates = 0;
    pushGuard(HISTORY_DEPTH);
    window.addEventListener('popstate', onPopState);

    try { if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' }); } catch {}
    // 全画面のあいだは、ブラウザが受けとるキーも ここで にぎっておく
    try { if (navigator.keyboard && navigator.keyboard.lock) await navigator.keyboard.lock(); } catch {}
    requestWakeLock();

    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(frame);
  }

  function stop() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);

    window.removeEventListener('resize', resize);
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', resize);
    document.removeEventListener('touchstart', block, { capture: true });
    document.removeEventListener('touchmove',  block, { capture: true });
    for (const type of ['keydown', 'keyup', 'keypress']) {
      window.removeEventListener(type, blockKey, { capture: true });
    }
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.documentElement.classList.remove('is-playing');
    try { if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); } catch {}
    root.removeEventListener('contextmenu', block);
    root.removeEventListener('dblclick', block);
    root.removeEventListener('pointerdown', onPointerDown);
    exitBtn.removeEventListener('pointerdown', startHold);
    exitBtn.removeEventListener('pointerup', cancelHold);
    exitBtn.removeEventListener('pointercancel', cancelHold);
    exitBtn.removeEventListener('pointerleave', cancelHold);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('popstate', onPopState);

    if (wakeLock) { try { wakeLock.release(); } catch {} wakeLock = null; }
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch {} }
    // ためておいた履歴を まとめて片づける（もどるボタンが効くようにもどす）
    if (pushedStates > 0) { const n = pushedStates; pushedStates = 0; try { history.go(-n); } catch {} }

    root.hidden = true;
    if (onExitCallback) onExitCallback();
  }

  return { start, stop };
}
