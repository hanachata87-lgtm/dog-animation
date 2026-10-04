/* ============================================================
   lock.js
   子どもロック（全画面の再生・カメラで共通）。

   ・さわっても止まらない／画面が切り替わらない
   ・キーボードの入力を止める
   ・「もどる」「はしからのスワイプ」で抜けられない
   ・画面が消えない
   ・おわるのは「右上のボタンを2.5秒ながおし」だけ

   ※ 電卓を出すような端末本体のショートカットは、
      ブラウザからは止められない。アプリ固定／ガイドアクセスで止める。
   ============================================================ */

const HOLD_MS  = 2500;                     // 大人だけができる ながおしの時間
const RING_LEN = 2 * Math.PI * 20;         // 輪っかの長さ（r=20）
const HISTORY_DEPTH = 15;                  // 「もどる」を ためておく数

/**
 * ながおしボタンを つくる。輪っかが1周すると onDone が呼ばれる。
 * @returns {{detach: Function}}
 */
export function attachHold(btn, ring, ms, onDone) {
  let startAt = 0, raf = 0, id = null;

  function tick(now) {
    const p = Math.min(1, (now - startAt) / ms);
    ring.style.strokeDashoffset = String(RING_LEN * (1 - p));
    if (p >= 1) { cancel(); onDone(); return; }
    raf = requestAnimationFrame(tick);
  }
  function down(e) {
    e.preventDefault(); e.stopPropagation();
    id = e.pointerId;
    if (btn.setPointerCapture) { try { btn.setPointerCapture(e.pointerId); } catch { /* 無視 */ } }
    btn.classList.add('is-holding');
    startAt = performance.now();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(tick);
  }
  function cancel(e) {
    if (e) { e.stopPropagation(); if (id !== null && e.pointerId !== id) return; }
    id = null;
    cancelAnimationFrame(raf);
    btn.classList.remove('is-holding');
    ring.style.strokeDashoffset = String(RING_LEN);
  }

  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointercancel', cancel);
  btn.addEventListener('pointerleave', cancel);
  ring.style.strokeDashoffset = String(RING_LEN);

  return {
    detach() {
      cancel();
      btn.removeEventListener('pointerdown', down);
      btn.removeEventListener('pointerup', cancel);
      btn.removeEventListener('pointercancel', cancel);
      btn.removeEventListener('pointerleave', cancel);
    },
  };
}

/**
 * ロックを つくる。
 * @param {object} o
 * @param {HTMLElement} o.root     全画面にする要素
 * @param {HTMLElement} o.exitBtn  ながおしで おわるボタン
 * @param {SVGElement}  o.ring     その輪っか
 * @param {Function}    o.onExit   おわるときに呼ぶ（後かたづけは そちらで）
 * @param {Function}    [o.onTouch] おわるボタン以外をさわったとき（pointerdown）
 */
export function createLock({ root, exitBtn, ring, onExit, onTouch }) {
  let active = false;
  let pushedStates = 0;
  let wakeLock = null;
  let hold = null;

  const block = (e) => { e.preventDefault(); };
  const blockKey = (e) => { e.preventDefault(); e.stopPropagation(); };
  const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; return ''; };

  const onPointerDown = (e) => {
    if (exitBtn.contains(e.target)) return;   // おわるボタンだけは別あつかい
    if (onTouch) onTouch(e);
  };

  /* もどる：1回おきるたびに 履歴をつぎたして押しもどす（連打されても足りるように） */
  function pushGuard(n) {
    for (let i = 0; i < n; i++) { history.pushState({ kidLock: true }, ''); pushedStates++; }
  }
  const onPopState = () => {
    if (!active) return;
    pushedStates = Math.max(0, pushedStates - 1);
    pushGuard(3);
  };

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* 使えない端末では何もしない */ }
  }
  const onVisibility = () => { if (active && document.visibilityState === 'visible') requestWakeLock(); };

  async function start() {
    if (active) return;
    active = true;

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
    document.addEventListener('visibilitychange', onVisibility);

    hold = attachHold(exitBtn, ring, HOLD_MS, () => { stop(); onExit(); });

    pushedStates = 0;
    pushGuard(HISTORY_DEPTH);
    window.addEventListener('popstate', onPopState);

    try { if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' }); } catch { /* 無視 */ }
    try { if (navigator.keyboard && navigator.keyboard.lock) await navigator.keyboard.lock(); } catch { /* 無視 */ }
    requestWakeLock();
  }

  /** ロックを外す（onExit は呼ばない。呼ぶのは ながおし完了のときだけ） */
  function stop() {
    if (!active) return;
    active = false;

    document.removeEventListener('touchstart', block, { capture: true });
    document.removeEventListener('touchmove',  block, { capture: true });
    root.removeEventListener('contextmenu', block);
    root.removeEventListener('dblclick', block);
    root.removeEventListener('pointerdown', onPointerDown);
    for (const type of ['keydown', 'keyup', 'keypress']) {
      window.removeEventListener(type, blockKey, { capture: true });
    }
    window.removeEventListener('beforeunload', onBeforeUnload);
    document.documentElement.classList.remove('is-playing');
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('popstate', onPopState);
    try { if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock(); } catch { /* 無視 */ }

    if (hold) { hold.detach(); hold = null; }
    if (wakeLock) { try { wakeLock.release(); } catch { /* 無視 */ } wakeLock = null; }
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch { /* 無視 */ } }
    // ためておいた履歴を まとめて片づける（もどるボタンが効くようにもどす）
    if (pushedStates > 0) { const n = pushedStates; pushedStates = 0; try { history.go(-n); } catch { /* 無視 */ } }
  }

  return { start, stop, get active() { return active; } };
}
