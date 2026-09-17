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

    if (part === 'chara' && motion.rig) drawCharacter(phase, pose, hop);
    else drawPlainDog(phase, pose, hop, groundY);

    drawParticles(dt);
  }

  /* ---------- 写真そのものを動かす（ぜんしん・かおだけ） ---------- */
  function drawPlainDog(phase, pose, hop, groundY) {
    const anchor = motion.anchor || 'ground';
    // 顔だけの動きは、左右に肉球の手が出るので少し小さめにする
    const maxH = cssH * (anchor === 'center' ? 0.40 : 0.42);
    const maxW = cssW * (anchor === 'center' ? 0.52 : 0.72);
    const scale = Math.min(maxW / image.width, maxH / image.height);
    const w = image.width * scale, h = image.height * scale;

    const cx = cssW / 2 + pose.dx * cssW;
    let baseY;      // つぶれ／のび の軸になる位置
    let originY;    // その軸から見た 絵の上はしの位置
    if (anchor === 'center') {
      baseY = cssH * 0.46 - pose.lift * hop;
      originY = -h / 2;
    } else {
      // タップでよろこんで高く跳んでも、画面の上からはみ出さないようにする
      const maxLift = Math.max(0, groundY - h * 1.15 - 12);
      baseY = groundY - Math.min(pose.lift * hop, maxLift);
      originY = -h;
      drawShadow(cx, groundY, w * 0.32, pose.lift);
    }

    ctx.save();
    ctx.translate(cx, baseY);
    ctx.rotate(pose.rot);
    ctx.scale(pose.sx, pose.sy);
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
  function drawCharacter(phase, pose, hop) {
    const hs = Math.min(cssH * 0.34, cssW * 0.44);   // 顔の大きさ
    const s = hs * 0.5;                              // 体の基本の長さ（＝顔の半径）
    const footY = cssH * 0.88;
    const bob = pose.lift * hop;
    const neckX = cssW / 2 + (pose.dx || 0) * cssW;
    const neckY = footY - BODY_HEIGHT * s - bob;
    const hw = image.width * (hs / image.height);
    const rig = motion.rig(phase);

    drawShadow(neckX, footY + s * 0.30, s * 0.80, pose.lift);

    ctx.save();
    ctx.translate(neckX, neckY);
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

  /** 地面の影（高く上がるほど 小さく うすく） */
  function drawShadow(x, y, radius, lift) {
    ctx.save();
    ctx.globalAlpha = 0.22 * (1 - Math.max(0, lift) * 0.7);
    ctx.fillStyle = '#3b5d2a';
    ctx.beginPath();
    ctx.ellipse(x, y, radius * (1 - Math.max(0, lift) * 0.35), radius * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---------- さわっても止まらないための守り ---------- */
  const block = (e) => { e.preventDefault(); };
  const onPointerDown = (e) => {
    if (exitBtn.contains(e.target)) return;   // おわるボタンだけは別あつかい
    boost = Math.min(1, boost + 0.8);
    spawnSparkles(e.clientX, e.clientY);
  };
  const onPopState = () => { if (running) history.pushState({ dogPlay: true }, ''); };

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

  async function start({ cutout, motionName, speed, part: partName, spot, onExit }) {
    image = cutout;
    motion = getMotion(motionName);
    part = partName || 'body';
    wiggleData = (motion.wiggle && spot) ? buildWiggle(cutout, spot) : null;
    duration = motion.defaultDuration * (Number(speed) || 1);   // speed は倍率
    onExitCallback = onExit;

    root.hidden = false;
    resize();
    running = true;
    particles = [];
    boost = 0;
    startTime = lastTime = performance.now();

    toast.classList.remove('is-hidden');
    setTimeout(() => toast.classList.add('is-hidden'), 3500);

    window.addEventListener('resize', resize);
    if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
    root.addEventListener('touchstart', block, { passive: false });
    root.addEventListener('touchmove',  block, { passive: false });
    root.addEventListener('contextmenu', block);
    root.addEventListener('dblclick', block);
    root.addEventListener('pointerdown', onPointerDown);
    exitBtn.addEventListener('pointerdown', startHold);
    exitBtn.addEventListener('pointerup', cancelHold);
    exitBtn.addEventListener('pointercancel', cancelHold);
    exitBtn.addEventListener('pointerleave', cancelHold);
    document.addEventListener('visibilitychange', onVisibility);

    // もどるボタンでも抜けられないようにする
    history.pushState({ dogPlay: true }, '');
    window.addEventListener('popstate', onPopState);

    try { if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' }); } catch {}
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
    root.removeEventListener('touchstart', block);
    root.removeEventListener('touchmove',  block);
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
    if (history.state && history.state.dogPlay) history.back();

    root.hidden = true;
    if (onExitCallback) onExitCallback();
  }

  return { start, stop };
}
