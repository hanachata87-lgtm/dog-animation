/* ============================================================
   segmenter.js
   MediaPipe Interactive Image Segmenter（Magic Touch）のラッパー。
   ・モデルもWASMもCDNから読み込み、処理はすべてブラウザの中で完結する。
   ・写真データはどこにも送信されない。
   ============================================================ */

const VERSION   = '0.10.14';
const BUNDLE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM_BASE  = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL_URL  = 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite';

let loading = null;

/** セグメンターを1回だけ読み込む。失敗したら次回また試せるようにする。 */
export function loadSegmenter() {
  if (!loading) {
    loading = init().catch((err) => { loading = null; throw err; });
  }
  return loading;
}

async function init() {
  const { FilesetResolver, InteractiveSegmenter } = await import(BUNDLE_URL);
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);

  const make = (delegate) => InteractiveSegmenter.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    outputCategoryMask: true,
    outputConfidenceMasks: false,
  });

  // Android端末によってはGPUが使えないのでCPUに落とす。
  try {
    return await make('GPU');
  } catch {
    return await make('CPU');
  }
}

/**
 * 画像の (nx, ny)（0〜1の割合）をタップしたとみなして切り抜き候補を得る。
 * 戻り値: { data: Uint8Array(w*h), width, height } … ラベル値の生データ
 */
export function segmentAt(segmenter, source, nx, ny) {
  return new Promise((resolve, reject) => {
    const roi = { keypoint: { x: nx, y: ny } };
    let done = false;

    const take = (result) => {
      const mask = result && result.categoryMask;
      if (!mask) { reject(new Error('マスクを取得できませんでした')); return; }
      // コールバックを抜けるとマスクは無効になるので、ここでコピーしておく。
      const out = {
        data: new Uint8Array(mask.getAsUint8Array()),
        width: mask.width,
        height: mask.height,
      };
      try { if (typeof result.close === 'function') result.close(); } catch { /* 自動で閉じる版もある */ }
      resolve(out);
    };

    try {
      const ret = segmenter.segment(source, roi, (result) => { done = true; take(result); });
      // 新しめのバージョンは戻り値で返すことがある
      if (!done && ret) take(ret);
    } catch (err) {
      reject(err);
    }
  });
}
