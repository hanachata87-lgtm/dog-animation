/* ============================================================
   cutout.js
   切り抜きマスクの操作（連結成分の抽出・ふでで修正・PNG化）
   マスクは写真と同じ大きさの Uint8Array で、0=外、255=中 とする。
   ============================================================ */

/** 写真を長辺 maxSide 以内に縮めた canvas にして返す（スマホでも軽く動かすため） */
export async function loadPhotoToCanvas(file, maxSide = 1024) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file); // 古いブラウザ向け
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  if (bitmap.close) bitmap.close();
  return canvas;
}

/**
 * セグメンターの生ラベルから「タップした場所とつながっている部分」だけを取り出す。
 * ラベルの割り当てはモデルによって 0/255 が逆のことがあるので、
 * タップ位置のラベルを正解とみなすことで、どちらでも正しく動く。
 */
export function maskFromLabels(raw, px, py) {
  const { data, width, height } = raw;
  const target = data[py * width + px];

  const mask = new Uint8Array(width * height);
  const seen = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0, count = 0;

  const start = py * width + px;
  stack[top++] = start; seen[start] = 1;

  while (top > 0) {
    const idx = stack[--top];
    if (data[idx] !== target) continue;
    mask[idx] = 255; count++;

    const x = idx % width, y = (idx / width) | 0;
    if (x > 0        && !seen[idx - 1])      { seen[idx - 1] = 1;      stack[top++] = idx - 1; }
    if (x < width-1  && !seen[idx + 1])      { seen[idx + 1] = 1;      stack[top++] = idx + 1; }
    if (y > 0        && !seen[idx - width])  { seen[idx - width] = 1;  stack[top++] = idx - width; }
    if (y < height-1 && !seen[idx + width])  { seen[idx + width] = 1;  stack[top++] = idx + width; }
  }
  return { mask, width, height, coverage: count / (width * height) };
}

/** ふで（丸）でマスクを足す / 消す */
export function paintCircle(mask, width, height, cx, cy, radius, value) {
  const r2 = radius * radius;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(height - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      if (dx * dx + dy * dy <= r2) mask[y * width + x] = value;
    }
  }
}

/** マスクの入っている範囲（余白を除いた四角）を返す。空なら null。 */
export function maskBounds(mask, width, height) {
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (mask[row + x]) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** マスクを白黒画像の canvas にする（アルファチャンネルとして使う） */
export function maskToCanvas(mask, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(width, height);
  const d = img.data;
  for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
    d[j] = 255; d[j + 1] = 255; d[j + 2] = 255; d[j + 3] = mask[i];
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * マスクを1画素ずつ内側に削る。
 * 切り抜きのふちに背景の色が残る（フリンジ）のを防ぐため。
 */
export function erodeMask(mask, width, height, times = 2) {
  let src = mask;
  for (let t = 0; t < times; t++) {
    const dst = new Uint8Array(src.length);
    let any = 0;
    for (let y = 1; y < height - 1; y++) {
      const row = y * width;
      for (let x = 1; x < width - 1; x++) {
        const i = row + x;
        if (src[i] && src[i - 1] && src[i + 1] && src[i - width] && src[i + width]) { dst[i] = 255; any++; }
      }
    }
    if (!any) return src;   // 細すぎて消えてしまう場合は削らない
    src = dst;
  }
  return src;
}

/**
 * 写真 + マスク から、余白を切り落とした透過PNG用の canvas を作る。
 * ふちを少し内側に削ってからぼかし、背景の色のにじみとギザギザを消す。
 */
export function buildCutout(photoCanvas, mask, width, height, { pad = 6, feather = 1.6, erode = 2 } = {}) {
  mask = erode > 0 ? erodeMask(mask, width, height, erode) : mask;
  const box = maskBounds(mask, width, height);
  if (!box) return null;

  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const w = Math.min(width  - x, box.w + pad * 2);
  const h = Math.min(height - y, box.h + pad * 2);

  const maskCanvas = maskToCanvas(mask, width, height);
  const out = document.createElement('canvas');
  out.width = w; out.height = h;
  const ctx = out.getContext('2d');

  ctx.drawImage(photoCanvas, x, y, w, h, 0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.filter = `blur(${feather}px)`;
  ctx.drawImage(maskCanvas, x, y, w, h, 0, 0, w, h);
  ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

/**
 * 切り抜いた犬から「顔だけ」を丸く取り出す。
 * ふちをぼかしてあるので、首のところがスパッと切れて不自然にならない。
 * @param {number} cx,cy,r  切り抜き画像の中での 円の中心と半径（画素）
 */
export function buildFaceCrop(cutout, cx, cy, r) {
  const size = Math.max(16, Math.round(r * 2));
  const out = document.createElement('canvas');
  out.width = size; out.height = size;
  const ctx = out.getContext('2d');

  ctx.drawImage(cutout, cx - r, cy - r, r * 2, r * 2, 0, 0, size, size);

  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.44,
                                     size / 2, size / 2, size * 0.50);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  return out;
}
