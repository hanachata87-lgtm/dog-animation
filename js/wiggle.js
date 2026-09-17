/* ============================================================
   wiggle.js
   「しっぽふりふり」「おてふり」のしくみ。

   えらんだ場所のまわりを 丸く切りとって（patch）、
   もとの絵からは その場所をうすく消しておく（base）。
   再生中は base の上で patch だけを 付け根を軸にゆらす。
   ふちをぼかしてあるので、つなぎ目が目立たない。
   ============================================================ */

/**
 * @param {HTMLCanvasElement|HTMLImageElement} image 切り抜いた犬
 * @param {{x:number,y:number,r:number}} spot 絵の中での ゆらす場所（画素）
 */
export function buildWiggle(image, spot) {
  const w = image.width, h = image.height;
  const { x, y, r } = spot;

  // ゆらす部分だけを取り出す
  const patch = document.createElement('canvas');
  patch.width = w; patch.height = h;
  const pc = patch.getContext('2d');
  pc.drawImage(image, 0, 0);
  pc.globalCompositeOperation = 'destination-in';
  pc.fillStyle = radial(pc, x, y, r * 0.72, r);
  pc.fillRect(0, 0, w, h);
  pc.globalCompositeOperation = 'source-over';

  // もとの絵から その部分をうすく消す（少し小さめに消して、すき間ができないように）
  const base = document.createElement('canvas');
  base.width = w; base.height = h;
  const bc = base.getContext('2d');
  bc.drawImage(image, 0, 0);
  bc.globalCompositeOperation = 'destination-out';
  bc.fillStyle = radial(bc, x, y, r * 0.30, r * 0.80);
  bc.fillRect(0, 0, w, h);
  bc.globalCompositeOperation = 'source-over';

  // 付け根（体の中心に近いがわ）を、ゆれの軸にする
  const dx = w / 2 - x, dy = h / 2 - y;
  const len = Math.hypot(dx, dy) || 1;
  const pivot = { x: x + dx / len * r * 0.85, y: y + dy / len * r * 0.85 };

  return { base, patch, pivot };
}

function radial(ctx, x, y, r0, r1) {
  const g = ctx.createRadialGradient(x, y, Math.max(0, r0), x, y, Math.max(1, r1));
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  return g;
}
