// ============================================================
// PHASE 2: Camera added (getUserMedia, rear camera, live preview).
// MediaPipe face detection still comes in the next phase.
// ============================================================

const state = {
  total: 0,
  photos: [],       // { detected, accepted } per photo, filled in later phases
  cameraStream: null,
};

const homeTotalEl = document.getElementById("home-total");
const cameraStatusEl = document.getElementById("camera-status");
const videoEl = document.getElementById("camera-preview");
const camPhotoCountEl = document.getElementById("cam-photo-count");
const camTotalEl = document.getElementById("cam-total");

// ---- Screen switching ----
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

renderHome();