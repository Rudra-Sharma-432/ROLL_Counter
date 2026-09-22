// ============================================================
// PHASE 1: UI shell only.
// Home screen counter works. Camera/MediaPipe come in Phase 2+.
// ============================================================

const state = {
  total: 0,
};

const homeTotalEl = document.getElementById("home-total");
const cameraStatusEl = document.getElementById("camera-status");

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

document.getElementById("start-camera").addEventListener("click", () => {
  cameraStatusEl.textContent = "Camera comes in the next build step.";
});

renderHome();