/* ============================================================
   paw.js
   イラストの「肉球の手」を canvas に描く。
   画像ファイルを用意しなくてよいように、すべて図形で描いている。
   ============================================================ */

const TAU = Math.PI * 2;
const FUR = '#fff3e6';   // 手の色（クリーム）
const FUR_EDGE = '#efd9c4';
const PAD = '#ff9cb8';   // 肉球のピンク
const PAD_DARK = '#f27d9e';

// 指（肉球）の並び。canvas は下がプラスなので、上向き＝マイナスの角度。
const TOES = [-2.42, -1.94, -1.20, -0.72];

/**
 * 肉球の手を1つ描く。
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx,cy  手のひらの中心
 * @param {number} r      手のひらの半径
 * @param {number} rot    かたむき（ラジアン）
 */
export function drawPaw(ctx, cx, cy, r, rot = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);

  // ふんわりした影
  ctx.save();
  ctx.shadowColor = 'rgba(80,50,60,.28)';
  ctx.shadowBlur = r * 0.35;
  ctx.shadowOffsetY = r * 0.10;

  // 指（毛の部分）
  ctx.fillStyle = FUR;
  for (const a of TOES) {
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r * 0.80, Math.sin(a) * r * 0.80, r * 0.31, 0, TAU);
    ctx.fill();
  }
  // 手のひら（毛の部分）
  ctx.beginPath();
  ctx.ellipse(0, r * 0.06, r, r * 0.96, 0, 0, TAU);
  ctx.fill();
  ctx.restore();

  // ふちどり（やわらかい線）
  ctx.strokeStyle = FUR_EDGE;
  ctx.lineWidth = Math.max(1, r * 0.035);
  ctx.beginPath();
  ctx.ellipse(0, r * 0.06, r, r * 0.96, 0, 0, TAU);
  ctx.stroke();

  // 指の肉球
  ctx.fillStyle = PAD;
  for (const a of TOES) {
    ctx.beginPath();
    ctx.ellipse(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82,
                r * 0.185, r * 0.225, a + Math.PI / 2, 0, TAU);
    ctx.fill();
  }

  // まん中の大きい肉球（ハートに近い丸みのある三角）
  ctx.fillStyle = PAD_DARK;
  bigPad(ctx, 0, r * 0.22, r * 0.62);
  ctx.fillStyle = PAD;
  bigPad(ctx, 0, r * 0.19, r * 0.60);

  ctx.restore();
}

function bigPad(ctx, x, y, w) {
  const h = w * 0.92;
  ctx.beginPath();
  ctx.moveTo(x, y - h * 0.46);
  ctx.bezierCurveTo(x + w * 0.58, y - h * 0.62, x + w * 0.66, y + h * 0.30, x, y + h * 0.54);
  ctx.bezierCurveTo(x - w * 0.66, y + h * 0.30, x - w * 0.58, y - h * 0.62, x, y - h * 0.46);
  ctx.closePath();
  ctx.fill();
}

/** 「ばあ！」のときに飛び散るキラキラ（放射状の光） */
export function drawBurst(ctx, cx, cy, radius, strength) {
  if (strength <= 0) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = Math.min(1, strength);
  ctx.strokeStyle = '#ffd95e';
  ctx.lineCap = 'round';
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.2;
    const inner = radius * (0.72 + 0.35 * (1 - strength));
    const outer = inner + radius * 0.26 * strength;
    ctx.lineWidth = radius * 0.035;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
    ctx.stroke();
  }
  ctx.restore();
}
