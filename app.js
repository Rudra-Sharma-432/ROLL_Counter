// ============================================================
// PHASE 5: Automatic panorama alignment.
// Capture is still manual (you choose what to photograph), but the
// overlap between consecutive frames is now found automatically via
// a block-matching search (minimising pixel difference over the
// overlap region) instead of requiring you to drag it by hand.
// You can still nudge the result if the auto-guess isn't perfect.
// ============================================================

import {
  FaceDetector,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";

const state = {
  total: 0,
  photos: [],            // { detected, accepted } per accepted photo/panorama
  cameraStream: null,
  imageCapture: null,    // ImageCapture, if the browser supports full-res stills
  lastDetectedCount: 0,  // raw AI count for the photo currently in review
  reviewReturnScreen: "screen-camera", // where Retake/Add-to-total send you back to
  uploadQueue: [],        // canvases from an upload still waiting to be reviewed

  // panorama session
  panoMode: false,
  panoFrames: [],         // captured full-res canvases, not yet combined
  alignBaseCanvas: null,  // combined-so-far canvas while aligning
  alignIndex: 0,          // index into panoFrames currently being aligned
  alignScale: 1,          // display px -> natural px factor for current align step
  alignAutoPos: { x: 0, y: 0 }, // last auto-computed display-space position, for Reset
  drag: { active: false, startX: 0, startY: 0, baseX: 0, baseY: 0, x: 0, y: 0 },
};

let faceDetector = null;

// ---- Elements ----
const homeTotalEl = document.getElementById("home-total");
const cameraStatusEl = document.getElementById("camera-status");
const videoEl = document.getElementById("camera-preview");
const camPhotoCountEl = document.getElementById("cam-photo-count");
const camTotalEl = document.getElementById("cam-total");
const takePhotoBtn = document.getElementById("take-photo");
const reviewCanvas = document.getElementById("review-canvas");
const reviewNumberEl = document.getElementById("review-number");
const retakeBtn = document.getElementById("retake-photo");

const uploadInput = document.getElementById("upload-input");
const uploadPhotoBtn = document.getElementById("upload-photo");

const modeSingleBtn = document.getElementById("mode-single");
const modePanoBtn = document.getElementById("mode-panorama");
const panoInfoEl = document.getElementById("pano-info");
const panoFinishBtn = document.getElementById("pano-finish");

const alignFrame = document.getElementById("align-frame");
const alignBaseImg = document.getElementById("align-base");
const alignOverlayImg = document.getElementById("align-overlay");

const screens = document.querySelectorAll(".screen");
function showScreen(id) {
  screens.forEach((s) => s.classList.toggle("active", s.id === id));
}

function renderHome() {
  homeTotalEl.textContent = state.total;
}

document.getElementById("home-plus").addEventListener("click", () => {
  state.total += 1;
  renderHome();
});

document.getElementById("home-minus").addEventListener("click", () => {
  state.total = Math.max(0, state.total - 1);
  renderHome();
});

// ---- Load the face detector (once, on page load) ----
async function initDetector() {
  takePhotoBtn.disabled = true;
  takePhotoBtn.textContent = "Loading detector…";
  uploadPhotoBtn.disabled = true;

  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
    );

    faceDetector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_full_range/float16/1/blaze_face_full_range.tflite",
        delegate: "CPU",
      },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.5,
      minSuppressionThreshold: 0.3,
    });

    takePhotoBtn.disabled = false;
    takePhotoBtn.textContent = "Take photo";
    uploadPhotoBtn.disabled = false;
  } catch (err) {
    takePhotoBtn.textContent = "Detector failed to load";
    uploadPhotoBtn.disabled = true;
    console.error("MediaPipe load error:", err);
  }
}
initDetector();

// ---- Camera ----
async function startCamera() {
  cameraStatusEl.textContent = "";

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    cameraStatusEl.textContent = "This browser doesn't support camera access.";
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        // Ask for the highest resolution the device will give us so
        // students at the back of the room stay detectable.
        width: { ideal: 3840 },
        height: { ideal: 2160 },
      },
      audio: false,
    });

    state.cameraStream = stream;
    videoEl.srcObject = stream;
    state.reviewReturnScreen = "screen-camera";

    // Some browsers (mainly Android Chrome) expose ImageCapture, which
    // can grab a full sensor-resolution still - sharper than the video
    // stream. Safari doesn't support it, so we fall back to a video
    // frame automatically wherever it's missing.
    const track = stream.getVideoTracks()[0];
    state.imageCapture = "ImageCapture" in window ? new ImageCapture(track) : null;

    camPhotoCountEl.textContent = state.photos.length;
    camTotalEl.textContent = state.total;

    showScreen("screen-camera");
  } catch (err) {
    if (err.name === "NotAllowedError") {
      cameraStatusEl.textContent = "Camera permission was denied.";
    } else if (err.name === "NotFoundError") {
      cameraStatusEl.textContent = "No camera was found on this device.";
    } else {
      cameraStatusEl.textContent = "Couldn't start the camera: " + err.message;
    }
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
  }
  videoEl.srcObject = null;
  state.imageCapture = null;
}

document.getElementById("start-camera").addEventListener("click", startCamera);

document.getElementById("cancel-camera").addEventListener("click", () => {
  stopCamera();
  resetPanoramaSession();
  renderHome();
  showScreen("screen-home");
});

// ---- Grab one full-resolution frame as a canvas ----
async function captureFrameCanvas() {
  // Prefer a real high-res still photo when the browser supports it.
  if (state.imageCapture) {
    try {
      const blob = await state.imageCapture.takePhoto();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      return canvas;
    } catch (err) {
      console.warn("takePhoto() failed, falling back to video frame:", err);
    }
  }

  // Fallback: snapshot the live video frame at its native resolution.
  const canvas = document.createElement("canvas");
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  canvas.getContext("2d").drawImage(videoEl, 0, 0);
  return canvas;
}

// ---- Load an uploaded file as a full-resolution canvas ----
async function loadFileAsCanvas(file) {
  const bitmap = await createImageBitmap(file);
  // Cap extreme resolutions so huge phone photos don't stall weaker devices.
  const MAX_DIM = 4096;
  const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(bitmap, 0, 0, w, h);
  return canvas;
}

function processNextUpload() {
  if (state.uploadQueue.length === 0) {
    showScreen(state.reviewReturnScreen);
    return;
  }
  const canvas = state.uploadQueue.shift();
  setReviewOrigin("upload");
  detectAndShowReview(canvas);
}

uploadPhotoBtn.addEventListener("click", () => uploadInput.click());

uploadInput.addEventListener("change", async () => {
  const files = Array.from(uploadInput.files || []);
  uploadInput.value = ""; // allow re-selecting the same file later

  if (!faceDetector) {
    cameraStatusEl.textContent = "Still loading the detector — try again in a second.";
    return;
  }
  if (files.length === 0) return;

  cameraStatusEl.textContent = "";
  const canvases = [];
  for (const file of files) {
    try {
      canvases.push(await loadFileAsCanvas(file));
    } catch (err) {
      console.warn("Couldn't read uploaded file:", err);
    }
  }
  if (canvases.length === 0) return;

  state.uploadQueue = canvases;
  state.reviewReturnScreen = "screen-home";
  processNextUpload();
});


function setReviewOrigin(origin) {
  retakeBtn.textContent = origin === "upload" ? "Skip" : "Retake";
}

function detectAndShowReview(canvas) {
  const ctx = canvas.getContext("2d");
  const result = faceDetector.detect(canvas);
  const detections = result.detections || [];

  ctx.strokeStyle = "#F2A93B";
  ctx.lineWidth = Math.max(2, canvas.width * 0.004);
  detections.forEach((d) => {
    const box = d.boundingBox;
    ctx.strokeRect(box.originX, box.originY, box.width, box.height);
  });

  reviewCanvas.width = canvas.width;
  reviewCanvas.height = canvas.height;
  reviewCanvas.getContext("2d").drawImage(canvas, 0, 0);

  state.lastDetectedCount = detections.length;
  reviewNumberEl.textContent = detections.length;

  showScreen("screen-review");
}

// ---- Mode toggle ----
function setMode(mode) {
  state.panoMode = mode === "panorama";
  modeSingleBtn.classList.toggle("active", !state.panoMode);
  modePanoBtn.classList.toggle("active", state.panoMode);
  resetPanoramaSession();
  takePhotoBtn.textContent = state.panoMode ? "Capture frame" : "Take photo";
}

function resetPanoramaSession() {
  state.panoFrames = [];
  state.alignBaseCanvas = null;
  state.alignIndex = 0;
  panoInfoEl.classList.add("hidden");
  panoFinishBtn.classList.add("hidden");
}

modeSingleBtn.addEventListener("click", () => setMode("single"));
modePanoBtn.addEventListener("click", () => setMode("panorama"));

// ---- Take photo button: branches by mode ----
async function takePhoto() {
  if (!faceDetector || !videoEl.videoWidth) return;

  takePhotoBtn.disabled = true;
  try {
    const canvas = await captureFrameCanvas();

    if (state.panoMode) {
      state.panoFrames.push(canvas);
      panoInfoEl.textContent = `${state.panoFrames.length} frame(s) captured — pan a little and capture the next part of the room.`;
      panoInfoEl.classList.remove("hidden");
      if (state.panoFrames.length >= 2) {
        panoFinishBtn.classList.remove("hidden");
      }
    } else {
      setReviewOrigin("camera");
      detectAndShowReview(canvas);
    }
  } finally {
    takePhotoBtn.disabled = false;
  }
}

takePhotoBtn.addEventListener("click", takePhoto);

// ---- Automatic alignment (translation-only block matching) ----
// Downscales both frames to grayscale, then searches for the (dx, dy)
// pixel offset that makes the overlapping region match best. This
// assumes the pan between frames is close to pure horizontal/vertical
// translation, which holds well enough for a phone panned across a
// room at a normal distance.
function toGrayDownscaled(canvas, targetMaxDim) {
  const scale = targetMaxDim / Math.max(canvas.width, canvas.height);
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, w, h);
  const { data } = ctx.getImageData(0, 0, w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { gray, w, h, scale };
}

function autoAlign(baseCanvas, overlayCanvas, guessDxNatural, guessDyNatural) {
  const MAX_DIM = 220;
  const base = toGrayDownscaled(baseCanvas, MAX_DIM);
  const overlay = toGrayDownscaled(overlayCanvas, MAX_DIM);
  const scale = base.scale; // same scale used for both (same source resolution)

  function scoreAt(dx, dy) {
    const x0 = Math.max(0, dx);
    const y0 = Math.max(0, dy);
    const x1 = Math.min(base.w, dx + overlay.w);
    const y1 = Math.min(base.h, dy + overlay.h);
    if (x1 - x0 < overlay.w * 0.15 || y1 - y0 < overlay.h * 0.5) return Infinity;

    let sum = 0;
    let count = 0;
    const step = 2;
    for (let y = y0; y < y1; y += step) {
      const by = Math.floor(y) * base.w;
      const oy = Math.floor(y - dy) * overlay.w;
      for (let x = x0; x < x1; x += step) {
        const diff = base.gray[by + Math.floor(x)] - overlay.gray[oy + Math.floor(x - dx)];
        sum += diff * diff;
        count++;
      }
    }
    return count ? sum / count : Infinity;
  }

  let cx = guessDxNatural * scale;
  let cy = guessDyNatural * scale;
  const passes = [
    { span: Math.max(base.w, base.h) * 0.3, step: 8 },
    { span: 16, step: 2 },
    { span: 4, step: 1 },
  ];

  let best = { dx: cx, dy: cy, score: Infinity };
  for (const pass of passes) {
    let passBest = { dx: cx, dy: cy, score: scoreAt(cx, cy) };
    for (let dy = cy - pass.span; dy <= cy + pass.span; dy += pass.step) {
      for (let dx = cx - pass.span; dx <= cx + pass.span; dx += pass.step) {
        const s = scoreAt(dx, dy);
        if (s < passBest.score) passBest = { dx, dy, score: s };
      }
    }
    cx = passBest.dx;
    cy = passBest.dy;
    best = passBest;
  }

  if (!isFinite(best.score)) return null; // not enough overlap to trust a match

  return { dx: best.dx / scale, dy: best.dy / scale };
}

// ---- Panorama: align + combine ----
panoFinishBtn.addEventListener("click", () => {
  state.alignBaseCanvas = state.panoFrames[0];
  state.alignIndex = 1;
  openAlignStep();
});

function openAlignStep() {
  const base = state.alignBaseCanvas;
  const overlay = state.panoFrames[state.alignIndex];

  alignBaseImg.src = base.toDataURL();
  alignOverlayImg.src = overlay.toDataURL();

  showScreen("screen-align");

  // Wait for the base image to lay out so we know the display scale.
  alignBaseImg.onload = () => {
    const displayWidth = alignFrame.clientWidth;
    state.alignScale = displayWidth / base.width;

    alignBaseImg.style.width = displayWidth + "px";
    alignFrame.style.height = base.height * state.alignScale + "px";

    alignOverlayImg.onload = () => {
      const overlayDisplayWidth = overlay.width * state.alignScale;
      alignOverlayImg.style.width = overlayDisplayWidth + "px";

      // Heuristic fallback: about 30% overlap with the base's right edge.
      const guessDx = base.width - overlay.width * 0.3;
      const guessDy = 0;

      const auto = autoAlign(base, overlay, guessDx, guessDy);
      const natDx = auto ? auto.dx : guessDx;
      const natDy = auto ? auto.dy : guessDy;

      const x = natDx * state.alignScale;
      const y = natDy * state.alignScale;
      state.alignAutoPos = { x, y };
      setOverlayPosition(x, y);
    };
  };
}

function setOverlayPosition(x, y) {
  state.drag.x = x;
  state.drag.y = y;
  alignOverlayImg.style.left = x + "px";
  alignOverlayImg.style.top = y + "px";
}

alignOverlayImg.addEventListener("pointerdown", (e) => {
  state.drag.active = true;
  state.drag.startX = e.clientX;
  state.drag.startY = e.clientY;
  state.drag.baseX = state.drag.x;
  state.drag.baseY = state.drag.y;
  alignOverlayImg.setPointerCapture(e.pointerId);
});

alignOverlayImg.addEventListener("pointermove", (e) => {
  if (!state.drag.active) return;
  const dx = e.clientX - state.drag.startX;
  const dy = e.clientY - state.drag.startY;
  setOverlayPosition(state.drag.baseX + dx, state.drag.baseY + dy);
});

["pointerup", "pointercancel"].forEach((evt) => {
  alignOverlayImg.addEventListener(evt, () => {
    state.drag.active = false;
  });
});

document.getElementById("align-reset").addEventListener("click", () => {
  setOverlayPosition(state.alignAutoPos.x, state.alignAutoPos.y);
});

document.getElementById("align-confirm").addEventListener("click", () => {
  const base = state.alignBaseCanvas;
  const overlay = state.panoFrames[state.alignIndex];

  const natX = state.drag.x / state.alignScale;
  const natY = state.drag.y / state.alignScale;

  const combinedWidth = Math.round(Math.max(base.width, natX + overlay.width));
  const shiftDown = Math.max(0, -natY);
  const combinedHeight = Math.round(
    Math.max(base.height, natY + overlay.height) + shiftDown
  );

  const combined = document.createElement("canvas");
  combined.width = combinedWidth;
  combined.height = combinedHeight;
  const ctx = combined.getContext("2d");
  ctx.drawImage(base, 0, shiftDown);
  ctx.drawImage(overlay, natX, natY + shiftDown);

  state.alignBaseCanvas = combined;
  state.alignIndex += 1;

  if (state.alignIndex < state.panoFrames.length) {
    openAlignStep();
  } else {
    // All frames merged - run detection on the finished panorama.
    setReviewOrigin("camera");
    detectAndShowReview(state.alignBaseCanvas);
    resetPanoramaSession();
  }
});

// ---- Review screen: manual +/- correction ----
document.getElementById("review-plus").addEventListener("click", () => {
  reviewNumberEl.textContent = parseInt(reviewNumberEl.textContent, 10) + 1;
});

document.getElementById("review-minus").addEventListener("click", () => {
  const next = parseInt(reviewNumberEl.textContent, 10) - 1;
  reviewNumberEl.textContent = Math.max(0, next);
});

function afterReviewDone() {
  if (state.uploadQueue.length > 0) {
    processNextUpload();
  } else {
    showScreen(state.reviewReturnScreen);
  }
}

document.getElementById("retake-photo").addEventListener("click", () => {
  afterReviewDone();
});

document.getElementById("add-to-total").addEventListener("click", () => {
  const accepted = parseInt(reviewNumberEl.textContent, 10);

  state.photos.push({ detected: state.lastDetectedCount, accepted });
  state.total += accepted;

  renderHome();
  camPhotoCountEl.textContent = state.photos.length;
  camTotalEl.textContent = state.total;

  afterReviewDone();
});

renderHome();