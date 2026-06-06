import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { CHARACTERS } from "./simulation/GameModel";
import { CHAR_YAW } from "./render3d/Renderer3D";
import type { CharacterId } from "./simulation/types";

// Render each character's 3D model to a transparent PNG and use it as the
// character-select avatar. This guarantees the menu avatars match the in-game
// models exactly, share one consistent angle/background, and respect CHAR_YAW
// (so fixing a model's facing fixes both the avatar and gameplay).
export function renderCharacterAvatars(): void {
  const size = 320;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(2);
  renderer.setSize(size, size);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));
  const hemi = new THREE.HemisphereLight(0xdfeeff, 0x556070, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 1.7);
  dir.position.set(2, 4, 5);
  scene.add(dir);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);

  const loader = new GLTFLoader();
  const ids = Object.keys(CHARACTERS) as CharacterId[];
  let i = 0;

  const renderNext = (): void => {
    if (i >= ids.length) { renderer.dispose(); return; }
    const id = ids[i++];
    const url = `${import.meta.env.BASE_URL}assets/models/${id}.glb`;
    loader.load(url, (gltf) => {
      const model = gltf.scene;
      // normalise to height ~1.6, centre on X/Z, feet at y=0, then face the camera
      const box = new THREE.Box3().setFromObject(model);
      const sz = new THREE.Vector3(); box.getSize(sz);
      model.scale.setScalar(1.6 / (sz.y || 1));
      const b2 = new THREE.Box3().setFromObject(model);
      const c = new THREE.Vector3(); b2.getCenter(c);
      model.position.x -= c.x; model.position.z -= c.z; model.position.y -= b2.min.y;
      model.rotation.y = CHAR_YAW[id] ?? 0;
      const group = new THREE.Group();
      group.add(model);
      scene.add(group);

      camera.position.set(0, 1.0, 2.7);
      camera.lookAt(0, 0.92, 0);
      renderer.render(scene, camera);
      const dataUrl = renderer.domElement.toDataURL("image/png");

      document.querySelectorAll<HTMLElement>(`.sprite-${id}`).forEach((el) => {
        el.style.backgroundImage = `url(${dataUrl})`;
        el.style.backgroundSize = "contain";
        el.style.backgroundPosition = "center";
      });

      scene.remove(group);
      renderNext();
    }, undefined, () => renderNext()); // skip on error, keep static fallback
  };

  renderNext();
}
