/* ============================================================
   travel.js
   「画面のどこを動きまわるか」。動きの種類とは別に組み合わせられる。

     none   … その場
     run    … 右から左へバーッと走って消え、つぎは反対から出てくる
     bounce … スーパーボールのように 画面じゅうを跳ねまわる

   step() は、えがく物の 中心の位置（x, y）を返す。
   null のときは「いつもの場所でいいよ」という意味。
   ============================================================ */

const GRAVITY = 2100;       // 落ちる速さ（px/秒/秒）
const RUN_MS  = 1700;       // 画面をよこぎるのにかかる時間
const REST_MS = 320;        // 消えてから 反対がわに出てくるまでの間

export const TRAVELS = {
  none:   { icon: '',   label: 'その場',            desc: 'まん中で じっとしたまま 動きます。' },
  run:    { icon: '🏃', label: '🏃 走ってく',        desc: '右から左へ バーッと走って消え、つぎは反対がわから出てきます。' },
  bounce: { icon: '🏀', label: '🏀 スーパーボール',  desc: '画面じゅうを あちこち 跳ねまわります。' },
};

/**
 * @param {string} kind  none / run / bounce
 * @param {number} tempo はやさの倍率（大きいほど ゆっくり）。動きの速さとそろえる。
 */
export function createTravel(kind, tempo = 1) {
  const mode = TRAVELS[kind] ? kind : 'none';
  const slow = Math.max(0.2, tempo);
  let started = false;
  let t = 0;                 // run 用の時間
  let dir = 1;               // 1 = 右へ、-1 = 左へ
  let x = 0, y = 0, vx = 0, vy = 0;
  let spin = 0, vspin = 0;
  const rand = (a, b) => a + Math.random() * (b - a);

  function startBounce(w, h, ow, oh) {
    x = w / 2;
    y = h * 0.35;
    vx = rand(0.30, 0.55) * w * (Math.random() < 0.5 ? -1 : 1);
    vy = 0;
    spin = 0; vspin = 0;
    void ow; void oh;
  }

  /**
   * @param {number} dt  前のコマからのミリ秒
   * @param {number} w,h 画面の大きさ
   * @param {number} ow,oh えがく物の大きさ
   */
  function step(dt, w, h, ow, oh) {
    if (mode === 'none') return { x: null, y: null, flip: 1, spin: 0 };

    if (!started) { started = true; t = 0; if (mode === 'bounce') startBounce(w, h, ow, oh); }
    const sec = Math.min(dt, 40) / 1000 / slow;   // カクついた時に飛びすぎないように

    if (mode === 'run') {
      t += Math.min(dt, 40) / slow;
      const span = w + ow * 1.4;           // 画面の外から外まで
      const k = t / RUN_MS;
      if (k >= 1) {
        if (t >= RUN_MS + REST_MS) { t = 0; dir = -dir; }
        // 画面の外で ひと呼吸おく
        return { x: dir > 0 ? w + ow : -ow, y: null, flip: dir, spin: 0 };
      }
      const from = dir > 0 ? -ow * 0.7 : w + ow * 0.7;
      return { x: from + dir * span * k, y: null, flip: dir, spin: 0 };
    }

    // bounce（スーパーボール）
    const rx = ow / 2, ry = oh / 2;
    vy += GRAVITY * sec;
    x += vx * sec;
    y += vy * sec;

    // 左右のかべ
    if (x - rx < 0)     { x = rx;     vx = Math.abs(vx) * 1.02; vspin = rand(-2.2, 2.2); }
    else if (x + rx > w) { x = w - rx; vx = -Math.abs(vx) * 1.02; vspin = rand(-2.2, 2.2); }

    // 天じょう
    if (y - ry < 0) { y = ry; vy = Math.abs(vy) * 0.7; }

    // ゆか（つくたびに 高さと横のいきおいを変えて、見あきないようにする）
    const floor = h * 0.94 - ry;
    if (y > floor) {
      y = floor;
      const up = rand(0.34, 0.62) * h;             // つぎに上がる高さ
      vy = -Math.sqrt(2 * GRAVITY * up);
      vx = vx * rand(0.85, 1.15) + rand(-0.10, 0.10) * w;
      vspin = rand(-2.0, 2.0);
    }

    // 横に行きすぎない／止まらないようにする
    const vmax = w * 0.85, vmin = w * 0.12;
    if (Math.abs(vx) > vmax) vx = Math.sign(vx) * vmax;
    if (Math.abs(vx) < vmin) vx = (vx >= 0 ? 1 : -1) * vmin;

    spin += vspin * sec;
    vspin *= Math.pow(0.35, sec);                  // だんだん まっすぐにもどる
    spin *= Math.pow(0.55, sec);

    return { x, y, flip: vx >= 0 ? 1 : -1, spin };
  }

  return { step, mode };
}
