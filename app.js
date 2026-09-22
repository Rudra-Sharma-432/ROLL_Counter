// ============================================================
// PHASE 3: Face detection added (MediaPipe, BlazeFace Full Range).
// Take photo -> detect faces -> review -> add to total.
// ============================================================

import {
  FaceDetector,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";

const state = {
  total: 0,
  photos: [],          // { detected, accepted } per photo
  cameraStream: null,
  lastDetectedCount: 0, // raw AI count for the photo currently in review
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
  } catch (err) {
    takePhotoBtn.textContent = "Detector failed to load";
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
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });

    state.cameraStream = stream;
    videoEl.srcObject = stream;

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
}

document.getElementById("start-camera").addEventListener("click", startCamera);

document.getElementById("cancel-camera").addEventListener("click", () => {
  stopCamera();
  renderHome();
  showScreen("screen-home");
});

// ---- Take photo -> detect faces -> draw boxes -> review ----
function takePhoto() {
  if (!faceDetector || !videoEl.videoWidth) return;

  reviewCanvas.width = videoEl.videoWidth;
  reviewCanvas.height = videoEl.videoHeight;
  const ctx = reviewCanvas.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, reviewCanvas.width, reviewCanvas.height);

  const result = faceDetector.detect(reviewCanvas);
  const detections = result.detections || [];

  // Draw a box around every detected face
  ctx.strokeStyle = "#F2A93B";
  ctx.lineWidth = Math.max(2, reviewCanvas.width * 0.004);
  detections.forEach((d) => {
    const box = d.boundingBox;
    ctx.strokeRect(box.originX, box.originY, box.width, box.height);
  });

  state.lastDetectedCount = detections.length;
  reviewNumberEl.textContent = detections.length;

  showScreen("screen-review");
}

takePhotoBtn.addEventListener("click", takePhoto);

// ---- Review screen: manual +/- correction ----
document.getElementById("review-plus").addEventListener("click", () => {
  reviewNumberEl.textContent = parseInt(reviewNumberEl.textContent, 10) + 1;
});

document.getElementById("review-minus").addEventListener("click", () => {
  const next = parseInt(reviewNumberEl.textContent, 10) - 1;
  reviewNumberEl.textContent = Math.max(0, next);
});

document.getElementById("retake-photo").addEventListener("click", () => {
  showScreen("screen-camera");
});

document.getElementById("add-to-total").addEventListener("click", () => {
  const accepted = parseInt(reviewNumberEl.textContent, 10);

  state.photos.push({ detected: state.lastDetectedCount, accepted });
  state.total += accepted;

  renderHome();
  camPhotoCountEl.textContent = state.photos.length;
  camTotalEl.textContent = state.total;

  showScreen("screen-camera");
});

renderHome();