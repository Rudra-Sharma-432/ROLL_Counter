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
  let model = null;
  let boxes = [];      // current review-mode detections {x,y,w,h,manual}
  let inReview = false;

  function safeGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { localStorage.setItem(key, val); } catch (e) {}
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
  undoBtn.addEventListener('click', () => {
    const last = history.pop();
    if (last !== undefined) addCount(-last - (history.length ? 0 : 0)); // simple decrement
  });
  // simpler, correct undo: pop last delta and subtract it directly
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

  // ---------------- AI-assisted scan mode ----------------
  modelStatus.classList.add('show');
  cocoSsd.load().then(m => {
    model = m;
    modelStatus.classList.remove('show');
  }).catch(() => {
    modelStatus.textContent = 'detector unavailable — manual mode still works';
    setTimeout(() => modelStatus.classList.remove('show'), 3000);
  });

  scanBtn.addEventListener('click', async () => {
    if (!model) {
      hint.textContent = 'Detector still loading, one moment…';
      return;
    }
    if (!video.videoWidth) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    video.classList.add('hidden');
    canvas.style.display = 'block';
    controls.style.display = 'none';
    inReview = true;

    modelStatus.textContent = 'scanning photo…';
    modelStatus.classList.add('show');

    const predictions = await model.detect(canvas);
    modelStatus.classList.remove('show');

    boxes = predictions
      .filter(p => p.class === 'person' && p.score > 0.4)
      .map(p => ({ x: p.bbox[0], y: p.bbox[1], w: p.bbox[2], h: p.bbox[3], manual: false }));

    drawBoxes();
    reviewBar.classList.add('show');
  });

  function drawBoxes() {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height); // repaint frame under boxes
    // wait: video may be hidden but still has current frame data; safe to draw from video element
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
    const size = canvas.width / 12;
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
