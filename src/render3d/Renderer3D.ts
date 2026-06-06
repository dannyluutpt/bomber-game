import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { CHARACTERS } from "../simulation/GameModel";
import { LEVEL_HEIGHT, LEVEL_WIDTH } from "../simulation/level";
import type { MapTheme } from "../render/themes";
import type { CharacterId, GameSnapshot, MapThemeId, Vec2 } from "../simulation/types";

// Distinct 3D block colours per theme — picked for strong value contrast so the
// indestructible walls (darker) read clearly apart from destructible bricks (bright).
const BLOCK_3D: Record<MapThemeId, { wall: number; brick: number }> = {
  space: { wall: 0x4a5666, brick: 0xd98a3c },       // dark slate vs warm wood/orange
  ice: { wall: 0x3f6088, brick: 0xe6f3ff },          // deep steel-blue vs bright ice
  industrial: { wall: 0x2b3850, brick: 0xc85a36 }    // dark navy steel vs rust orange
};

// Per-character yaw offset for models whose "forward" axis isn't +Z.
const CHAR_YAW: Partial<Record<CharacterId, number>> = {
  titan: Math.PI // SWAT model faces -Z; flip it
};

const TILE = 1;
const FLOOR_Y = -TILE * 0.45; // top surface of the floor / where actors stand
const BLOCK_Y = FLOOR_Y + (TILE * 0.78) / 2; // block centre so it rests on the floor
const BOMB_Y = FLOOR_Y + TILE * 0.3;          // bomb sphere resting on the floor

// Per-actor animation: an idle and (optional) walk clip that crossfade as it moves.
interface ActorAnim {
  mixer: THREE.AnimationMixer;
  idle?: THREE.AnimationAction;
  walk?: THREE.AnimationAction;
  current?: THREE.AnimationAction;
}
const HALF_W = (LEVEL_WIDTH - 1) / 2;
const HALF_H = (LEVEL_HEIGHT - 1) / 2;

// Map a board cell to world space. The board is centred on the origin and laid out
// on the X/Z plane (Y is up), so a perspective camera can look down at an angle.
function worldX(cellX: number): number { return (cellX - HALF_W) * TILE; }
function worldZ(cellY: number): number { return (cellY - HALF_H) * TILE; }

/**
 * Three.js renderer that draws a GameSnapshot in 3D. It owns its own canvas and is
 * fully decoupled from the simulation — it only reads snapshots, so the 2D logic,
 * networking and menus are untouched. Meshes are pooled/diffed by key for smooth,
 * allocation-light updates.
 */
export class Renderer3D {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private root: THREE.Group = new THREE.Group();

  private dir!: THREE.DirectionalLight;
  private ambient!: THREE.AmbientLight;
  private floor!: THREE.Mesh;

  // Shared geometry (cheap to reuse across many meshes). Blocks are kept lower than
  // the characters so the (taller) characters clearly stand out above them.
  private blockGeo = new THREE.BoxGeometry(TILE * 0.92, TILE * 0.78, TILE * 0.92);
  private bombGeo = new THREE.SphereGeometry(TILE * 0.32, 18, 14);
  private flameGeo = new THREE.BoxGeometry(TILE * 0.9, TILE * 0.55, TILE * 0.9);
  private bodyGeo = new THREE.CapsuleGeometry(TILE * 0.28, TILE * 0.32, 4, 10);
  private gemGeo = new THREE.OctahedronGeometry(TILE * 0.26);
  private puGeo = new THREE.BoxGeometry(TILE * 0.45, TILE * 0.45, TILE * 0.45);

  // Per-theme materials (recoloured on setTheme)
  private wallMat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.1 });
  private brickMat = new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.05 });
  private floorMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.0 });
  private bombMat = new THREE.MeshStandardMaterial({ color: 0x0a0e17, roughness: 0.4, metalness: 0.3 });
  private flameMat = new THREE.MeshStandardMaterial({ color: 0xff7a18, emissive: 0xff7a18, emissiveIntensity: 1.4, transparent: true, opacity: 0.92 });

  // Pools keyed for diffing
  private blocks = new Map<string, { mesh: THREE.Mesh; type: "wall" | "brick" }>();
  private bombs = new Map<number, THREE.Mesh>();
  private actors = new Map<string, THREE.Object3D>(); // players "p0"/"p1", enemies "e<id>"
  private actorTargets = new Map<string, Vec2>();
  // One CC0 model template per character id (+ its animation clips).
  private actorTemplates = new Map<CharacterId, { object: THREE.Object3D; animations: THREE.AnimationClip[] }>();
  private actorAnims = new Map<string, ActorAnim>(); // per-actor idle/walk animation state
  private powerUps = new Map<number, THREE.Mesh>();
  private gems = new Map<number, THREE.Mesh>();
  private flames: THREE.Mesh[] = [];

  private theme!: MapTheme;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    const canvas = this.renderer.domElement;
    canvas.style.position = "absolute";
    canvas.style.inset = "0";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    // Sit behind Phaser's (transparent) canvas and the DOM menus.
    canvas.style.zIndex = "0";
    container.insertBefore(canvas, container.firstChild);

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
    this.positionCamera();

    this.scene.add(this.root);
    this.setupLights();
    this.setupFloor();
    this.resize();
    this.loadActorModels();
  }

  private hemi!: THREE.HemisphereLight;

  // Load one CC0 character model per game character (assets/models/<id>.glb). Each
  // is normalised + cached as a template that is cloned per actor (native materials).
  // Async — actors fall back to a tinted capsule until their model arrives.
  private loadActorModels(): void {
    const loader = new GLTFLoader();
    (Object.keys(CHARACTERS) as CharacterId[]).forEach((id) => {
      const url = `${import.meta.env.BASE_URL}assets/models/${id}.glb`;
      loader.load(url, (gltf) => {
        this.actorTemplates.set(id, { object: this.normalizeModel(gltf.scene), animations: gltf.animations });
        // existing capsule/old actors rebuild as models on the next frame
        this.rebuildActors();
      }, undefined, () => { /* missing model — keep capsule fallback for this id */ });
    });
  }

  // Scale a model to ~tile height, centre it on X/Z and drop its feet to local y=0,
  // wrapped in a group so cloning + absolute placement stays correct.
  private normalizeModel(model: THREE.Object3D): THREE.Object3D {
    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3(); box.getSize(size);
    model.scale.setScalar((TILE * 1.15) / (size.y || 1)); // taller than blocks → visible
    const box2 = new THREE.Box3().setFromObject(model);
    const ctr = new THREE.Vector3(); box2.getCenter(ctr);
    model.position.x -= ctr.x;
    model.position.z -= ctr.z;
    model.position.y -= box2.min.y;
    const wrapper = new THREE.Group();
    wrapper.add(model);
    return wrapper;
  }

  private rebuildActors(): void {
    for (const [key, m] of this.actors) { this.root.remove(m); this.disposeObject(m); this.actorAnims.delete(key); }
    this.actors.clear(); this.actorTargets.clear();
  }

  private positionCamera(): void {
    // Angled top-down view that frames the whole board (tuned for ~13×11 tiles).
    this.camera.position.set(0, 12, 10);
    this.camera.lookAt(0, 0, 0);
  }

  private setupLights(): void {
    this.ambient = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(this.ambient);

    // Sky/ground fill so nothing reads as flat black.
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x404040, 0.9);
    this.hemi.position.set(0, 20, 0);
    this.scene.add(this.hemi);

    this.dir = new THREE.DirectionalLight(0xffffff, 1.7);
    this.dir.position.set(7, 16, 9);
    this.dir.castShadow = true;
    this.dir.shadow.mapSize.set(2048, 2048);
    this.dir.shadow.bias = -0.0005;
    const d = 12;
    const cam = this.dir.shadow.camera as THREE.OrthographicCamera;
    cam.left = -d; cam.right = d; cam.top = d; cam.bottom = -d;
    cam.near = 1; cam.far = 60;
    this.scene.add(this.dir);
    this.scene.add(this.dir.target);
  }

  private setupFloor(): void {
    const geo = new THREE.PlaneGeometry(LEVEL_WIDTH * TILE + 1, LEVEL_HEIGHT * TILE + 1);
    geo.rotateX(-Math.PI / 2);
    this.floor = new THREE.Mesh(geo, this.floorMat);
    this.floor.position.y = -TILE * 0.45;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
  }

  setTheme(theme: MapTheme): void {
    if (this.theme === theme) return; // only reapply on an actual theme change
    this.theme = theme;
    this.scene.background = new THREE.Color(theme.bgBottom);
    this.scene.fog = new THREE.Fog(theme.bgBottom, 30, 60);
    // High-contrast 3D block colours (walls dark, bricks bright) so destructible vs
    // indestructible is obvious even under flat 3D lighting.
    this.wallMat.color.setHex(BLOCK_3D[theme.id].wall);
    this.brickMat.color.setHex(BLOCK_3D[theme.id].brick);
    this.floorMat.color.setHex(theme.floor);
    this.hemi.color.setHex(theme.star);
    this.hemi.groundColor.setHex(theme.floor);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Draw one snapshot. dtMs drives position smoothing for actors.
  frame(snapshot: GameSnapshot, dtMs: number): void {
    if (!this.theme || !snapshot.tiles.length) { this.renderer.render(this.scene, this.camera); return; }
    this.syncBlocks(snapshot);
    this.syncBombs(snapshot);
    this.syncPowerUps(snapshot);
    this.syncGems(snapshot);
    this.syncFlames(snapshot);
    this.syncActors(snapshot, dtMs);
    for (const a of this.actorAnims.values()) a.mixer.update(dtMs / 1000); // idle/walk anims
    this.renderer.render(this.scene, this.camera);
  }

  // --- Static-ish blocks (walls fixed, bricks destroyed over time) ---
  private syncBlocks(s: GameSnapshot): void {
    const seen = new Set<string>();
    for (let y = 0; y < s.height; y++) {
      for (let x = 0; x < s.width; x++) {
        const tile = s.tiles[y][x];
        if (tile !== "wall" && tile !== "brick") continue;
        const key = `${x},${y}`;
        seen.add(key);
        const existing = this.blocks.get(key);
        if (existing && existing.type === tile) continue;
        if (existing) { this.root.remove(existing.mesh); this.blocks.delete(key); }
        const mesh = new THREE.Mesh(this.blockGeo, tile === "wall" ? this.wallMat : this.brickMat);
        mesh.position.set(worldX(x), BLOCK_Y, worldZ(y));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.root.add(mesh);
        this.blocks.set(key, { mesh, type: tile });
      }
    }
    for (const [key, b] of this.blocks) {
      if (!seen.has(key)) { this.root.remove(b.mesh); this.blocks.delete(key); }
    }
  }

  private syncBombs(s: GameSnapshot): void {
    const seen = new Set<number>();
    const pulse = 1 + Math.sin(performance.now() / 110) * 0.08;
    for (const bomb of s.bombs) {
      seen.add(bomb.id);
      let mesh = this.bombs.get(bomb.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.bombGeo, this.bombMat);
        mesh.castShadow = true;
        this.root.add(mesh);
        this.bombs.set(bomb.id, mesh);
      }
      mesh.position.set(worldX(bomb.cell.x), BOMB_Y, worldZ(bomb.cell.y));
      mesh.scale.setScalar(pulse);
    }
    for (const [id, mesh] of this.bombs) {
      if (!seen.has(id)) { this.root.remove(mesh); this.bombs.delete(id); }
    }
  }

  private syncFlames(s: GameSnapshot): void {
    // Flames are short-lived; rebuild each frame from a small pool.
    for (const m of this.flames) m.visible = false;
    let i = 0;
    for (const exp of s.explosions) {
      for (const cell of exp.cells) {
        let m = this.flames[i];
        if (!m) { m = new THREE.Mesh(this.flameGeo, this.flameMat); this.root.add(m); this.flames.push(m); }
        m.visible = true;
        m.position.set(worldX(cell.x), TILE * 0.1, worldZ(cell.y));
        i++;
      }
    }
  }

  private syncPowerUps(s: GameSnapshot): void {
    const seen = new Set<number>();
    for (const pu of s.powerUps) {
      if (s.tiles[pu.cell.y][pu.cell.x] !== "floor") continue;
      seen.add(pu.id);
      let mesh = this.powerUps.get(pu.id);
      if (!mesh) {
        const color = pu.type === "bomb" ? 0xff4d9d : pu.type === "range" ? 0x35d9ff : 0x80ed99;
        mesh = new THREE.Mesh(this.puGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 }));
        this.root.add(mesh);
        this.powerUps.set(pu.id, mesh);
      }
      mesh.position.set(worldX(pu.cell.x), TILE * 0.0, worldZ(pu.cell.y));
      mesh.rotation.y += 0.03;
    }
    for (const [id, mesh] of this.powerUps) {
      if (!seen.has(id)) { this.root.remove(mesh); this.disposeMesh(mesh); this.powerUps.delete(id); }
    }
  }

  private syncGems(s: GameSnapshot): void {
    const seen = new Set<number>();
    for (const gem of s.gems) {
      if (s.tiles[gem.cell.y][gem.cell.x] !== "floor") continue;
      seen.add(gem.id);
      let mesh = this.gems.get(gem.id);
      if (!mesh) {
        const color = this.gemColor(gem.type);
        mesh = new THREE.Mesh(this.gemGeo, new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, metalness: 0.3, roughness: 0.2 }));
        this.root.add(mesh);
        this.gems.set(gem.id, mesh);
      }
      mesh.position.set(worldX(gem.cell.x), TILE * 0.1 + Math.sin(performance.now() / 300 + gem.id) * 0.05, worldZ(gem.cell.y));
      mesh.rotation.y += 0.04;
    }
    for (const [id, mesh] of this.gems) {
      if (!seen.has(id)) { this.root.remove(mesh); this.disposeMesh(mesh); this.gems.delete(id); }
    }
  }

  private syncActors(s: GameSnapshot, dtMs: number): void {
    const seen = new Set<string>();
    const place = (key: string, cell: Vec2, charId: CharacterId, alive: boolean): void => {
      if (!alive) return;
      seen.add(key);
      const baseY = this.actorTemplates.has(charId) ? FLOOR_Y : TILE * 0.35;
      const yaw = CHAR_YAW[charId] ?? 0; // correct models whose forward axis isn't +Z
      let mesh = this.actors.get(key);
      if (!mesh) {
        mesh = this.makeActor(key, charId);
        mesh.position.set(worldX(cell.x), baseY, worldZ(cell.y));
        mesh.rotation.y = yaw; // face the camera while idle
        this.root.add(mesh);
        this.actors.set(key, mesh);
      }
      this.actorTargets.set(key, cell);
      const tx = worldX(cell.x), tz = worldZ(cell.y);
      const dx = tx - mesh.position.x, dz = tz - mesh.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > TILE * 1.6) {
        mesh.position.set(tx, baseY, tz); // snap on respawn/teleport
      } else {
        const f = 1 - Math.exp(-16 * (dtMs / 1000));
        mesh.position.x += dx * f;
        mesh.position.z += dz * f;
        if (Math.abs(dx) + Math.abs(dz) > 0.012) mesh.rotation.y = Math.atan2(dx, dz) + yaw; // face travel
      }
      // Crossfade idle <-> walk based on whether the actor is still travelling.
      const anim = this.actorAnims.get(key);
      if (anim) {
        const want = (dist > 0.08 && anim.walk) ? anim.walk : anim.idle;
        if (want && anim.current !== want) {
          want.reset().fadeIn(0.18).play();
          anim.current?.fadeOut(0.18);
          anim.current = want;
        }
      }
    };

    for (const p of s.players) place(`p${p.index}`, p.cell, p.character, p.alive);
    for (const e of s.enemies) place(`e${e.id}`, e.cell, e.character, true);
    for (const [key, mesh] of this.actors) {
      if (!seen.has(key)) {
        this.root.remove(mesh); this.disposeObject(mesh);
        this.actors.delete(key); this.actorTargets.delete(key); this.actorAnims.delete(key);
      }
    }
  }

  // Build one actor: a clone of that character's CC0 model (native materials, with
  // its idle animation playing), or a colour-tinted capsule until the model loads.
  private makeActor(key: string, charId: CharacterId): THREE.Object3D {
    const tmpl = this.actorTemplates.get(charId);
    if (tmpl) {
      const obj = cloneSkinned(tmpl.object);
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if ((mesh as unknown as { isMesh?: boolean }).isMesh) mesh.castShadow = true;
      });
      if (tmpl.animations.length) {
        const mixer = new THREE.AnimationMixer(obj);
        const find = (re: RegExp) => tmpl.animations.find((c) => re.test(c.name));
        const idleClip = find(/idle/i) ?? tmpl.animations[0];
        const walkClip = find(/walk/i) ?? find(/run/i) ?? find(/jog|move/i);
        const idle = mixer.clipAction(idleClip);
        idle.play();
        const walk = walkClip ? mixer.clipAction(walkClip) : undefined;
        this.actorAnims.set(key, { mixer, idle, walk, current: idle });
      }
      return obj;
    }
    const mesh = new THREE.Mesh(this.bodyGeo, new THREE.MeshStandardMaterial({ color: CHARACTERS[charId].color, roughness: 0.5, metalness: 0.15 }));
    mesh.castShadow = true;
    return mesh;
  }

  private disposeObject(obj: THREE.Object3D): void {
    obj.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!(mesh as unknown as { isMesh?: boolean }).isMesh) return;
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    });
  }

  // Clear all per-match meshes (call on a new match so stale actors/blocks vanish).
  reset(): void {
    for (const b of this.blocks.values()) this.root.remove(b.mesh);
    this.blocks.clear();
    for (const m of this.bombs.values()) this.root.remove(m);
    this.bombs.clear();
    for (const m of this.actors.values()) { this.root.remove(m); this.disposeObject(m); }
    this.actors.clear(); this.actorTargets.clear(); this.actorAnims.clear();
    for (const m of this.powerUps.values()) { this.root.remove(m); this.disposeMesh(m); }
    this.powerUps.clear();
    for (const m of this.gems.values()) { this.root.remove(m); this.disposeMesh(m); }
    this.gems.clear();
    for (const m of this.flames) m.visible = false;
  }

  private disposeMesh(mesh: THREE.Mesh): void {
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat.dispose();
  }

  private gemColor(type: string): number {
    switch (type) {
      case "extraLife": return 0xff6b9d;
      case "phaseWalk": return 0xb5a8d5;
      case "megaBlast": return 0xff7c43;
      case "speedSurge": return 0xffd166;
      default: return 0x06d6a0;
    }
  }
}
