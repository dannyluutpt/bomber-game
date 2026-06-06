import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

// Candidate CC0 character models (loaded straight from the poly.pizza CDN, which
// sends permissive CORS — so nothing heavy is committed to the repo). The user
// browses these in 3D and picks one by number; only the chosen model is then
// downloaded into the game.
const MODELS = [
  { name: "Adventurer", url: "https://static.poly.pizza/bbe369ee-a686-42c7-adad-14356f5f2f15.glb" },
  { name: "Animated Woman", url: "https://static.poly.pizza/ba7a1955-ea51-4cb9-a561-188bdef0a6c7.glb" },
  { name: "Astronaut", url: "https://static.poly.pizza/0076345b-bbea-42d5-931c-4a5ad2050b18.glb" },
  { name: "King", url: "https://static.poly.pizza/29a3436b-3b06-4dbf-a236-bcec18f3351a.glb" },
  { name: "Punk", url: "https://static.poly.pizza/e56f23b5-3270-406f-8924-f77cad980c43.glb" },
  { name: "SWAT", url: "https://static.poly.pizza/713f6535-f4f3-4367-a4c6-ced126ae0936.glb" },
  { name: "Robot", url: "https://static.poly.pizza/7d95dbce-8c73-489b-8298-f430b1f0dbdf.glb" },
  { name: "Hoodie", url: "https://static.poly.pizza/bcd66ec5-5e81-4901-a222-47abc875fe2a.glb" }
];

const COLS = 4;
const GAP_X = 2.6;
const GAP_Z = 3.2;

const container = document.getElementById("scene")!;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0e1a);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 4.5, 9);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
container.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
labelRenderer.domElement.style.position = "fixed";
labelRenderer.domElement.style.top = "0";
labelRenderer.domElement.style.pointerEvents = "none";
container.appendChild(labelRenderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, 0);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 1.0));
const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x404040, 0.9);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.6);
dir.position.set(5, 10, 7);
dir.castShadow = true;
dir.shadow.mapSize.set(1024, 1024);
scene.add(dir);

// Ground
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x141c2c, roughness: 1 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const loader = new GLTFLoader();
const spinners: THREE.Object3D[] = [];
const mixers: THREE.AnimationMixer[] = [];

MODELS.forEach((m, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const x = (col - (COLS - 1) / 2) * GAP_X;
  const z = (row - 0.5) * GAP_Z;

  // pedestal
  const pad = new THREE.Mesh(
    new THREE.CylinderGeometry(0.85, 0.85, 0.15, 24),
    new THREE.MeshStandardMaterial({ color: 0x1e2740, roughness: 0.8 })
  );
  pad.position.set(x, 0.075, z);
  pad.receiveShadow = true;
  scene.add(pad);

  const pivot = new THREE.Group();
  pivot.position.set(x, 0.15, z);
  scene.add(pivot);
  spinners.push(pivot);

  // numbered label
  const div = document.createElement("div");
  div.className = "label";
  div.innerHTML = `${i + 1}. ${m.name} <small>CC0</small>`;
  const label = new CSS2DObject(div);
  label.position.set(x, -0.05, z);
  scene.add(label);

  loader.load(m.url, (gltf) => {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); box.getSize(size);
    model.scale.setScalar(1.7 / (size.y || 1));
    const box2 = new THREE.Box3().setFromObject(model);
    const ctr = new THREE.Vector3(); box2.getCenter(ctr);
    model.position.x -= ctr.x;
    model.position.z -= ctr.z;
    model.position.y -= box2.min.y;
    model.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).castShadow = true; });
    pivot.add(model);
    if (gltf.animations.length) {
      const mixer = new THREE.AnimationMixer(model);
      mixer.clipAction(gltf.animations[0]).play();
      mixers.push(mixer);
    }
  });
});

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
function animate(): void {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  for (const s of spinners) s.rotation.y += dt * 0.6;
  for (const mx of mixers) mx.update(dt);
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
