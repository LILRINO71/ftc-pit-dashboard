// 3D robot for judge mode: turntable + exploded-view loop.
// Tuned for a Raspberry Pi 3: no shadow maps, capped pixel ratio, drops quality if FPS sags.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";

const host = document.getElementById("robot3d");
const status = document.getElementById("robot3dStatus");
const caption = document.getElementById("robot3dCaption");
const cfg = window.PIT_CONFIG || {};
// app.js adds .fx on capable desktops; Pis and other low-power boards get the lighter model
const lowPower = !document.documentElement.classList.contains("fx");
const url = (lowPower && cfg.robotModelLite) || cfg.robotModel || "models/robot.glb";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let renderer, scene, camera, pivot, parts = [], running = false, lowQuality = false;
let radius = 1, t0 = performance.now();

// Cycle: hold assembled, explode, hold, reassemble (seconds)
const CYCLE = { hold: 9, out: 1.8, open: 4, back: 1.6 };
const CYCLE_LEN = CYCLE.hold + CYCLE.out + CYCLE.open + CYCLE.back;

function init() {
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  } catch (e) {
    status.textContent = "3D needs WebGL, which this browser doesn't have.";
    return false;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  host.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);

  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1410, 0.85));
  const key = new THREE.DirectionalLight(0xffffff, 2.9);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff9a3c, 1.6);
  rim.position.set(-4, 2.5, -3);
  scene.add(rim);

  pivot = new THREE.Group();
  scene.add(pivot);
  pivot.add(contactShadow());

  new ResizeObserver(resize).observe(host);
  resize();
  return true;
}

// Soft radial shadow under the robot, a texture instead of a shadow map
function contactShadow() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.name = "shadow";
  return m;
}

function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function load() {
  status.textContent = "Loading robot…";
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.load(url, (gltf) => {
    const model = gltf.scene;
    // CAD is Z-up in some exports; stand it on the ground and center it
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);
    model.position.y += size.y / 2;
    radius = size.length() / 2;

    const shadow = pivot.getObjectByName("shadow");
    shadow.scale.setScalar(Math.max(size.x, size.z) * 1.5);
    pivot.add(model);
    model.updateMatrixWorld(true);

    // Each mesh gets an explode direction away from the robot's center
    const mid = new THREE.Vector3(0, size.y / 2, 0);
    model.traverse((o) => {
      if (!o.isMesh) return;
      // the simplified model ships without normals: smooth curves, keep CAD edges sharp
      if (!o.geometry.attributes.normal) o.geometry = toCreasedNormals(o.geometry, THREE.MathUtils.degToRad(35));
      o.material.side = THREE.FrontSide;
      if (o.material.metalness !== undefined) {
        o.material.metalness = Math.min(o.material.metalness, 0.6);
        o.material.roughness = Math.max(o.material.roughness, 0.35);
      }
      const b = new THREE.Box3().setFromObject(o);
      const c = b.getCenter(new THREE.Vector3());
      const dir = c.clone().sub(mid);
      dir.y *= 1.6;
      const dWorld = dir.multiplyScalar(0.55);
      const parentInv = new THREE.Matrix4().copy(o.parent.matrixWorld).invert();
      const start = o.position.clone();
      const endWorld = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld).add(dWorld);
      const end = endWorld.applyMatrix4(parentInv);
      parts.push({ o, start, end });
    });

    camera.position.set(radius * 2.15, radius * 1.4, radius * 2.15);
    camera.lookAt(0, size.y * 0.42, 0);
    status.textContent = "";
    host.classList.add("ready");
  }, undefined, () => {
    status.textContent = "No robot model yet. Export your CAD to " + url;
  });
}

const ease = (x) => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

function explodeAmount(t) {
  if (reduceMotion) return 0;
  let s = t % CYCLE_LEN;
  if (s < CYCLE.hold) return 0;
  s -= CYCLE.hold;
  if (s < CYCLE.out) return ease(s / CYCLE.out);
  s -= CYCLE.out;
  if (s < CYCLE.open) return 1;
  s -= CYCLE.open;
  return 1 - ease(s / CYCLE.back);
}

// FPS watchdog: drop resolution once if the Pi can't keep up
let frames = 0, fpsT = performance.now();
function watchFps(now) {
  frames++;
  if (now - fpsT < 2500) return;
  const fps = (frames * 1000) / (now - fpsT);
  frames = 0;
  fpsT = now;
  if (!lowQuality && fps < 24) {
    lowQuality = true;
    renderer.setPixelRatio(0.7);
    resize();
  }
}

function frame(now) {
  if (!running) return;
  requestAnimationFrame(frame);
  const t = (now - t0) / 1000;
  pivot.rotation.y = reduceMotion ? 0.6 : t * 0.28;
  const k = explodeAmount(t);
  for (const p of parts) p.o.position.lerpVectors(p.start, p.end, k);
  const cap = k > 0.02 ? "Exploded view" : "Assembled";
  if (caption.textContent !== cap && parts.length) caption.textContent = cap;
  camera.position.y = radius * (1.45 + 0.12 * Math.sin(t * 0.35));
  camera.lookAt(0, radius * 0.45, 0);
  renderer.render(scene, camera);
  watchFps(now);
}

let ready = false;
export function start() {
  if (!ready) {
    if (!init()) return;
    load();
    ready = true;
  }
  if (running) return;
  running = true;
  fpsT = performance.now();
  frames = 0;
  requestAnimationFrame(frame);
}
export function stop() { running = false; }

window.Robot3D = { start, stop };
window.dispatchEvent(new Event("robot3d-ready"));
