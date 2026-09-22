(function () {
  const video = document.getElementById('video');
  const canvas = document.getElementById('shotCanvas');
  const ctx = canvas.getContext('2d');
  const camMessage = document.getElementById('camMessage');
  const camMessageText = document.getElementById('camMessageText');
  const counterNumber = document.getElementById('counterNumber');
  const resetBtn = document.getElementById('resetBtn');
  const undoBtn = document.getElementById('undoBtn');
  const tapBtn = document.getElementById('tapBtn');
  const scanBtn = document.getElementById('scanBtn');
  const hint = document.getElementById('hint');
  const controls = document.getElementById('controls');
  const reviewBar = document.getElementById('reviewBar');
  const foundCount = document.getElementById('foundCount');
  const confirmBtn = document.getElementById('confirmBtn');
  const discardBtn = document.getElementById('discardBtn');
  const modelStatus = document.getElementById('modelStatus');

  let total = 0;
  const history = []; // stack of {delta} for undo
  let boxes = [];      // current review-mode detections {x,y,w,h,manual}
  let inReview = false;

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { }
  }

  const saved = safeGet('rollcount-total');
  if (saved !== null && !isNaN(parseInt(saved, 10))) {
    total = parseInt(saved, 10);
  }
  render();

  function render() {
    counterNumber.textContent = total;
    safeSet('rollcount-total', String(total));
  }

  function addCount(n) {
    total += n;
    if (total < 0) total = 0;
    history.push(n);
    render();
  }

  tapBtn.addEventListener('click', () => addCount(1));

  undoBtn.onclick = () => {
    const last = history.pop();
    if (last === undefined) return;
    total -= last;
    if (total < 0) total = 0;
    render();
  };

  resetBtn.addEventListener('click', () => {
    if (inReview) return;
    if (total === 0) return;
    if (confirm('Reset the count to 0?')) {
      total = 0;
      history.length = 0;
      render();
    }
  });

  // ---------------- Camera setup ----------------
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false
      });
      video.srcObject = stream;
      camMessage.classList.remove('show');
    } catch (err) {
      camMessageText.textContent = err && err.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in your browser settings, then reload.'
        : 'Could not open the camera on this device/browser. Try Safari (iPhone) or Chrome (Android), and make sure no other app is using the camera.';
      camMessage.classList.add('show');
      scanBtn.disabled = true;
      scanBtn.style.opacity = 0.4;
    }
  }
  startCamera();

  // ---------------- Face detector (yolov8n-face, ONNX Runtime Web) ----------------
  // Model: WIDERFACE-trained YOLOv8n-face, single class (face), 640x640 input.
  // Hosted as a GitHub Release asset (stable, CORS-open, no account needed).
  const MODEL_URL = 'https://github.com/yakhyo/yolov8-face-onnx-inference/releases/download/weights/yolov8n-face.onnx';
  const MODEL_INPUT_SIZE = 640;
  const CONF_THRESHOLD = 0.35;
  const IOU_THRESHOLD = 0.45;

  let session = null;
  let modelLoadPromise = null;

  function loadModel() {
    if (modelLoadPromise) return modelLoadPromise;
    modelStatus.textContent = 'loading detector…';
    modelStatus.classList.add('show');
    ort.env.wasm.numThreads = 1; // safest default across phone browsers
    modelLoadPromise = ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm']
    }).then(s => {
      session = s;
      modelStatus.classList.remove('show');
      return s;
    }).catch(err => {
      console.error('Model load failed:', err);
      modelStatus.textContent = 'detector unavailable — manual mode still works';
      setTimeout(() => modelStatus.classList.remove('show'), 3500);
      throw err;
    });
    return modelLoadPromise;
  }
  loadModel();

  // Letterbox-resize a source canvas region into a square MODEL_INPUT_SIZE canvas,
  // returning the canvas plus the scale/offset needed to map detections back.
  function letterbox(srcCanvas, sx, sy, sw, sh) {
    const size = MODEL_INPUT_SIZE;
    const scale = Math.min(size / sw, size / sh);
    const newW = Math.round(sw * scale);
    const newH = Math.round(sh * scale);
    const padX = Math.floor((size - newW) / 2);
    const padY = Math.floor((size - newH) / 2);

    const out = document.createElement('canvas');
    out.width = size;
    out.height = size;
    const octx = out.getContext('2d');
    octx.fillStyle = '#727272';
    octx.fillRect(0, 0, size, size);
    octx.drawImage(srcCanvas, sx, sy, sw, sh, padX, padY, newW, newH);

    return { canvas: out, scale, padX, padY };
  }

  function canvasToTensor(c) {
    const size = MODEL_INPUT_SIZE;
    const imgData = c.getContext('2d').getImageData(0, 0, size, size).data;
    const float32 = new Float32Array(3 * size * size);
    const plane = size * size;
    for (let i = 0; i < plane; i++) {
      const off = i * 4;
      float32[i] = imgData[off] / 255;               // R
      float32[plane + i] = imgData[off + 1] / 255;    // G
      float32[2 * plane + i] = imgData[off + 2] / 255;// B
    }
    return new ort.Tensor('float32', float32, [1, 3, size, size]);
  }

  // Decode YOLOv8 single-class output: shape [1, 5, 8400] -> (cx, cy, w, h, conf) per anchor.
  function decodeOutput(output, letter, offsetX, offsetY) {
    const data = output.data;
    const numAnchors = output.dims[2];
    const results = [];
    for (let i = 0; i < numAnchors; i++) {
      const conf = data[4 * numAnchors + i];
      if (conf < CONF_THRESHOLD) continue;
      const cx = data[0 * numAnchors + i];
      const cy = data[1 * numAnchors + i];
      const w = data[2 * numAnchors + i];
      const h = data[3 * numAnchors + i];

      // undo letterbox padding/scale, then map tile -> full-photo coords
      const fx = (cx - letter.padX) / letter.scale;
      const fy = (cy - letter.padY) / letter.scale;
      const fw = w / letter.scale;
      const fh = h / letter.scale;

      results.push({
        x: offsetX + fx - fw / 2,
        y: offsetY + fy - fh / 2,
        w: fw,
        h: fh,
        score: conf,
        manual: false
      });
    }
    return results;
  }

  function boxIou(a, b) {
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
    const iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1);
    const inter = iw * ih;
    const union = a.w * a.h + b.w * b.h - inter;
    return union <= 0 ? 0 : inter / union;
  }

  function nms(list, iouThresh) {
    const sorted = list.slice().sort((a, b) => b.score - a.score);
    const kept = [];
    for (const box of sorted) {
      const isDuplicate = kept.some(k => boxIou(box, k) > iouThresh);
      if (!isDuplicate) kept.push(box);
    }
    return kept;
  }

  async function detectFacesInRegion(fullCanvas, sx, sy, sw, sh) {
    const letter = letterbox(fullCanvas, sx, sy, sw, sh);
    const tensor = canvasToTensor(letter.canvas);
    const feeds = {};
    feeds[session.inputNames[0]] = tensor;
    const outMap = await session.run(feeds);
    const output = outMap[session.outputNames[0]];
    return decodeOutput(output, letter, sx, sy);
  }

  // A single full-classroom photo shrinks each face to a handful of pixels,
  // which the detector misses even at 640px input. So we slice the photo into
  // a grid of overlapping tiles and run detection on each tile at effectively
  // higher zoom, then merge results across tile boundaries with NMS.
  async function runTiledScan(fullCanvas) {
    const cols = 3, rows = 3, overlap = 0.15;
    const fw = fullCanvas.width, fh = fullCanvas.height;
    const tileW = fw / cols, tileH = fh / rows;
    const overlapW = tileW * overlap, overlapH = tileH * overlap;
    const totalTiles = cols * rows;
    let allBoxes = [];
    let tileIndex = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        tileIndex++;
        modelStatus.textContent = `scanning section ${tileIndex}/${totalTiles}…`;

        const sx = Math.max(0, c * tileW - overlapW);
        const sy = Math.max(0, r * tileH - overlapH);
        const ex = Math.min(fw, (c + 1) * tileW + overlapW);
        const ey = Math.min(fh, (r + 1) * tileH + overlapH);
        const sw = ex - sx, sh = ey - sy;

        const tileBoxes = await detectFacesInRegion(fullCanvas, sx, sy, sw, sh);
        allBoxes = allBoxes.concat(tileBoxes);
      }
    }
    return nms(allBoxes, IOU_THRESHOLD);
  }

  scanBtn.addEventListener('click', async () => {
    if (!video.videoWidth) return;

    if (!session) {
      hint.textContent = 'Detector still loading, one moment…';
      try {
        await loadModel();
      } catch (e) {
        hint.textContent = 'Detector failed to load — check your connection and try again.';
        return;
      }
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    video.classList.add('hidden');
    canvas.style.display = 'block';
    controls.style.display = 'none';
    inReview = true;

    modelStatus.classList.add('show');
    try {
      boxes = await runTiledScan(canvas);
    } catch (e) {
      console.error('Scan failed:', e);
      boxes = [];
      hint.textContent = 'Scan failed — you can still mark faces manually below.';
    }
    modelStatus.classList.remove('show');

    drawBoxes();
    reviewBar.classList.add('show');
  });

  function drawBoxes() {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height); // repaint frame under boxes
    const scaleFont = Math.max(14, canvas.width / 40);
    boxes.forEach((b, i) => {
      ctx.strokeStyle = b.manual ? '#e8b04b' : '#6fa98a';
      ctx.lineWidth = Math.max(2, canvas.width / 300);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.manual ? '#e8b04b' : '#6fa98a';
      ctx.font = `${scaleFont}px 'Space Mono', monospace`;
      ctx.fillText(String(i + 1), b.x + 4, Math.max(scaleFont, b.y - 4));
    });
    foundCount.textContent = boxes.length;
  }

  canvas.addEventListener('click', (e) => {
    if (!inReview) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    // check if tap lands inside an existing box -> remove it
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        boxes.splice(i, 1);
        drawBoxes();
        return;
      }
    }
    // otherwise add a manual mark centered on tap
    const size = canvas.width / 16; // faces are smaller than the old body boxes
    boxes.push({ x: x - size / 2, y: y - size / 2, w: size, h: size, manual: true });
    drawBoxes();
  });

  function endReview() {
    inReview = false;
    reviewBar.classList.remove('show');
    controls.style.display = 'block';
    canvas.style.display = 'none';
    video.classList.remove('hidden');
    boxes = [];
  }

  confirmBtn.addEventListener('click', () => {
    addCount(boxes.length);
    endReview();
  });

  discardBtn.addEventListener('click', endReview);

})();