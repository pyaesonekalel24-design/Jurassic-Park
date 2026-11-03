
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import RAPIER from "@dimforge/rapier3d-compat";

/* =========================================================
   WORLD SETTINGS
   ========================================================= */

const WORLD = {
  islandRadius: 216,
  terrainSegments: 240,
  waterLevel: 0,

  treeCount: 420,
  bushCount: 180,

  maximumTerrainHeight: 40,
  minimumTerrainHeight: -3
};

let scene;
let camera;
let renderer;
let controls;

let terrainGeometry;
let terrainMesh;
let originalTerrainHeights;

let vegetationGroup;
let terrainFollowingObjects = [];

let waterMesh;
let brushRing;

let physicsWorld;
let terrainBody;
let terrainCollider;

let physicsObjects = [];

let currentTool = "camera";
let brushSize = 12;
let brushStrength = 1.5;

let isSculpting = false;
let terrainChanged = false;
let flattenTarget = 0;
let lastBrushTime = 0;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const clock = new THREE.Clock();

let accumulator = 0;
const FIXED_STEP = 1 / 60;

/* =========================================================
   MATERIALS
   ========================================================= */

const trunkMaterial = new THREE.MeshStandardMaterial({
  color: 0x765037,
  roughness: 1
});

const leafMaterials = [
  new THREE.MeshStandardMaterial({
    color: 0x426b3e,
    roughness: 1
  }),
  new THREE.MeshStandardMaterial({
    color: 0x527c45,
    roughness: 1
  }),
  new THREE.MeshStandardMaterial({
    color: 0x345b39,
    roughness: 1
  })
];

const bushMaterials = [
  new THREE.MeshStandardMaterial({
    color: 0x3d673e,
    roughness: 1
  }),
  new THREE.MeshStandardMaterial({
    color: 0x547b45,
    roughness: 1
  })
];

/* =========================================================
   INITIALIZATION
   ========================================================= */

async function startApplication() {
  try {
    initializeThree();

    await RAPIER.init();

    initializePhysics();

    createIsland();
    createVegetation();
    createBrushPreview();

    setupUI();
    setupTerrainEditing();

    updatePhysicsStatus(true);

    document
      .getElementById("loading-screen")
      .classList.add("hidden");

    animate();

  } catch (error) {
    console.error("Initialization failed:", error);

    document.getElementById("loading-screen").innerHTML =
      `<div class="loading-title">WORLD FAILED TO LOAD</div>
       <div class="loading-subtitle">${error.message}</div>`;
  }
}

/* =========================================================
   THREE.JS SCENE
   ========================================================= */

function initializeThree() {
  scene = new THREE.Scene();

  scene.background = new THREE.Color(0x9ab8b6);

  scene.fog = new THREE.Fog(
    0x9ab8b6,
    500,
    1500
  );

  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    5000
  );

  camera.position.set(0, 310, 430);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance"
  });

  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, 1.75)
  );

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  document
    .getElementById("scene-container")
    .appendChild(renderer.domElement);

  controls = new OrbitControls(
    camera,
    renderer.domElement
  );

  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;

  controls.minDistance = 30;
  controls.maxDistance = 1200;
  controls.maxPolarAngle = Math.PI * 0.49;

  const ambientLight = new THREE.HemisphereLight(
    0xe4f0dc,
    0x58634b,
    2.0
  );

  scene.add(ambientLight);

  const sun = new THREE.DirectionalLight(
    0xffe7bd,
    3.0
  );

  sun.position.set(-250, 400, -150);
  sun.castShadow = true;

  sun.shadow.mapSize.set(2048, 2048);

  sun.shadow.camera.left = -400;
  sun.shadow.camera.right = 400;
  sun.shadow.camera.top = 400;
  sun.shadow.camera.bottom = -400;

  scene.add(sun);

  window.addEventListener("resize", onWindowResize);
}

/* =========================================================
   RAPier PHYSICS
   ========================================================= */

function initializePhysics() {
  physicsWorld = new RAPIER.World({
    x: 0,
    y: -9.81,
    z: 0
  });

  physicsWorld.timestep = FIXED_STEP;
}

/* =========================================================
   TERRAIN COLORS
   ========================================================= */

function getTerrainColor(height, color) {
  if (height < 0.2) {
    color.set(0xc2b58d);
  } else if (height < 4) {
    color.set(0x91a86a);
  } else if (height < 15) {
    color.set(0x668b50);
  } else if (height < 25) {
    color.set(0x54794a);
  } else {
    color.set(0x777d69);
  }

  return color;
}

/* =========================================================
   TERRAIN GENERATION
   ========================================================= */

function createIsland() {
  const segments = WORLD.terrainSegments;

  const size = WORLD.islandRadius * 2.35;

  terrainGeometry = new THREE.PlaneGeometry(
    size,
    size,
    segments,
    segments
  );

  terrainGeometry.rotateX(-Math.PI / 2);

  const positions =
    terrainGeometry.attributes.position;

  const colors = [];

  originalTerrainHeights =
    new Float32Array(positions.count);

  const color = new THREE.Color();

  const islandScale =
    WORLD.islandRadius / 72;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);

    const radius = Math.sqrt(x * x + z * z);
    const angle = Math.atan2(z, x);

    const edgeNoise =
      Math.sin(angle * 5.0 + 0.7) * 3.2 +
      Math.sin(angle * 9.0 - 1.1) * 1.6 +
      Math.sin(angle * 15.0) * 0.65;

    const effectiveRadius =
      WORLD.islandRadius + edgeNoise;

    const edgeDistance =
      effectiveRadius - radius;

    const edgeBlend = smoothstep(
      -5,
      7,
      edgeDistance
    );

    const tx = x / islandScale;
    const tz = z / islandScale;

    const hillA = gaussian(
      tx, tz, -22, -14, 25, 31, 14
    );

    const hillB = gaussian(
      tx, tz, 20, 7, 22, 25, 10
    );

    const hillC = gaussian(
      tx, tz, -2, 32, 18, 19, 6
    );

    const ridge =
      Math.max(
        0,
        Math.sin((tx + tz * 0.55) * 0.055)
      ) * 2.0;

    const smallNoise =
      Math.sin(tx * 0.19) *
      Math.cos(tz * 0.17) * 0.65 +
      Math.sin((tx + tz) * 0.31) * 0.28;

    const landHeight =
      1.4 +
      hillA +
      hillB +
      hillC +
      ridge +
      smallNoise;

    const height = THREE.MathUtils.lerp(
      -3.5,
      landHeight,
      edgeBlend
    );

    positions.setY(i, height);

    originalTerrainHeights[i] = height;

    getTerrainColor(height, color);

    const variation =
      0.94 +
      Math.sin(x * 0.037 + z * 0.021) * 0.035;

    color.multiplyScalar(variation);

    colors.push(
      color.r,
      color.g,
      color.b
    );
  }

  terrainGeometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(colors, 3)
  );

  terrainGeometry.computeVertexNormals();
  terrainGeometry.computeBoundingSphere();

  const terrainMaterial =
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1,
      metalness: 0
    });

  terrainMesh = new THREE.Mesh(
    terrainGeometry,
    terrainMaterial
  );

  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;

  scene.add(terrainMesh);

  createOcean();
  createShoreline();

  rebuildTerrainCollider();
}

/* =========================================================
   OCEAN AND SHORELINE
   ========================================================= */

function createOcean() {
  const waterGeometry = new THREE.PlaneGeometry(
    1600,
    1600
  );

  waterGeometry.rotateX(-Math.PI / 2);

  const waterMaterial =
    new THREE.MeshStandardMaterial({
      color: 0x397f91,
      roughness: 0.28,
      metalness: 0.08
    });

  waterMesh = new THREE.Mesh(
    waterGeometry,
    waterMaterial
  );

  waterMesh.position.y = -3.8;

  scene.add(waterMesh);
}

function createShoreline() {
  const shoreGeometry = new THREE.RingGeometry(
    WORLD.islandRadius - 1.5,
    WORLD.islandRadius + 5.5,
    180
  );

  const shoreMaterial =
    new THREE.MeshStandardMaterial({
      color: 0xc3b78d,
      roughness: 1,
      side: THREE.DoubleSide
    });

  const shore = new THREE.Mesh(
    shoreGeometry,
    shoreMaterial
  );

  shore.rotation.x = -Math.PI / 2;
  shore.position.y = 0.06;

  scene.add(shore);
}

/* =========================================================
   TERRAIN HEIGHT QUERY
   Reads the actual edited terrain vertices.
   ========================================================= */

function getHeightAt(x, z) {
  if (!terrainGeometry) return 0;

  const positions =
    terrainGeometry.attributes.position;

  const size = WORLD.islandRadius * 2.35;
  const halfSize = size / 2;
  const segments = WORLD.terrainSegments;

  const gridX = THREE.MathUtils.clamp(
    ((x + halfSize) / size) * segments,
    0,
    segments
  );

  const gridZ = THREE.MathUtils.clamp(
    ((z + halfSize) / size) * segments,
    0,
    segments
  );

  const x0 = Math.floor(gridX);
  const z0 = Math.floor(gridZ);

  const x1 = Math.min(x0 + 1, segments);
  const z1 = Math.min(z0 + 1, segments);

  const tx = gridX - x0;
  const tz = gridZ - z0;

  const rowSize = segments + 1;

  const a = positions.getY(
    z0 * rowSize + x0
  );

  const b = positions.getY(
    z0 * rowSize + x1
  );

  const c = positions.getY(
    z1 * rowSize + x0
  );

  const d = positions.getY(
    z1 * rowSize + x1
  );

  const top = THREE.MathUtils.lerp(a, b, tx);
  const bottom = THREE.MathUtils.lerp(c, d, tx);

  return THREE.MathUtils.lerp(top, bottom, tz);
}

/* =========================================================
   RAPier TERRAIN COLLIDER
   Static trimesh from actual terrain vertices.
   ========================================================= */

function rebuildTerrainCollider() {
  if (!physicsWorld || !terrainGeometry) return;

  if (terrainBody) {
    physicsWorld.removeRigidBody(terrainBody);
    terrainBody = null;
    terrainCollider = null;
  }

  const vertices = new Float32Array(
    terrainGeometry.attributes.position.array
  );

  const geometryIndex =
    terrainGeometry.index.array;

  const indices = new Uint32Array(geometryIndex);

  terrainBody = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
  );

  const colliderDescription =
    RAPIER.ColliderDesc.trimesh(
      vertices,
      indices
    );

  colliderDescription.setFriction(0.9);
  colliderDescription.setRestitution(0.05);

  terrainCollider = physicsWorld.createCollider(
    colliderDescription,
    terrainBody
  );

  updatePhysicsStatus(true);
}

/* =========================================================
   TERRAIN VISUAL UPDATE
   ========================================================= */

function updateTerrainMesh() {
  const positions =
    terrainGeometry.attributes.position;

  const colors =
    terrainGeometry.attributes.color;

  const color = new THREE.Color();

  for (let i = 0; i < positions.count; i++) {
    const height = positions.getY(i);

    getTerrainColor(height, color);

    colors.setXYZ(
      i,
      color.r,
      color.g,
      color.b
    );
  }

  positions.needsUpdate = true;
  colors.needsUpdate = true;

  terrainGeometry.computeVertexNormals();
  terrainGeometry.computeBoundingSphere();
  terrainGeometry.computeBoundingBox();
}

/* =========================================================
   VEGETATION
   ========================================================= */

function createVegetation() {
  vegetationGroup = new THREE.Group();

  terrainFollowingObjects = [];

  const trunkGeometry =
    new THREE.CylinderGeometry(
      0.35,
      0.55,
      3.1,
      7
    );

  const crownGeometry =
    new THREE.ConeGeometry(
      2.1,
      4.8,
      7
    );

  for (let i = 0; i < WORLD.treeCount; i++) {
    const angle = Math.random() * Math.PI * 2;

    const radius =
      Math.sqrt(Math.random()) *
      (WORLD.islandRadius - 10);

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    if (
      x > -35 &&
      x < 35 &&
      z > -30 &&
      z < 35 &&
      Math.random() > 0.12
    ) {
      continue;
    }

    const scale = 0.65 + Math.random() * 0.85;

    const tree = new THREE.Group();

    const trunk = new THREE.Mesh(
      trunkGeometry,
      trunkMaterial
    );

    trunk.position.y = 1.55 * scale;
    trunk.scale.setScalar(scale);
    trunk.castShadow = true;

    tree.add(trunk);

    const crown = new THREE.Mesh(
      crownGeometry,
      leafMaterials[
        Math.floor(
          Math.random() * leafMaterials.length
        )
      ]
    );

    crown.position.y = 4.0 * scale;

    crown.scale.set(
      0.85 + Math.random() * 0.35,
      0.9 + Math.random() * 0.5,
      0.85 + Math.random() * 0.35
    );

    crown.castShadow = true;

    tree.add(crown);

    tree.position.set(
      x,
      getHeightAt(x, z),
      z
    );

    tree.rotation.y =
      Math.random() * Math.PI * 2;

    vegetationGroup.add(tree);

    terrainFollowingObjects.push({
      object: tree,
      x,
      z,
      offsetY: 0
    });
  }

  createBushes();

  scene.add(vegetationGroup);
}

function createBushes() {
  const bushGeometry =
    new THREE.IcosahedronGeometry(1.1, 0);

  for (let i = 0; i < WORLD.bushCount; i++) {
    const angle = Math.random() * Math.PI * 2;

    const radius =
      13 +
      Math.random() * (WORLD.islandRadius - 25);

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const bush = new THREE.Mesh(
      bushGeometry,
      bushMaterials[
        Math.floor(
          Math.random() * bushMaterials.length
        )
      ]
    );

    const scale = 0.45 + Math.random() * 0.8;

    bush.scale.set(
      scale * 1.3,
      scale * 0.7,
      scale
    );

    const offsetY = 0.65 * scale;

    bush.position.set(
      x,
      getHeightAt(x, z) + offsetY,
      z
    );

    vegetationGroup.add(bush);

    terrainFollowingObjects.push({
      object: bush,
      x,
      z,
      offsetY
    });
  }
}

function updateVegetationHeights() {
  for (const item of terrainFollowingObjects) {
    item.object.position.y =
      getHeightAt(item.x, item.z) +
      item.offsetY;
  }
}

/* =========================================================
   TERRAIN BRUSH PREVIEW
   ========================================================= */

function createBrushPreview() {
  const geometry = new THREE.RingGeometry(
    0.94,
    1,
    64
  );

  const material =
    new THREE.MeshBasicMaterial({
      color: 0xe4efbb,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });

  brushRing = new THREE.Mesh(
    geometry,
    material
  );

  brushRing.rotation.x = -Math.PI / 2;
  brushRing.visible = false;

  scene.add(brushRing);
}

function getTerrainIntersection(event) {
  const rect =
    renderer.domElement.getBoundingClientRect();

  pointer.x =
    ((event.clientX - rect.left) / rect.width) * 2 - 1;

  pointer.y =
    -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObject(
    terrainMesh,
    false
  );

  return hits.length > 0 ? hits[0] : null;
}

/* =========================================================
   TERRAIN SCULPTING
   ========================================================= */

function applyBrush(hit, deltaTime) {
  if (!hit || currentTool === "camera") return;

  const positions =
    terrainGeometry.attributes.position;

  const centerX = hit.point.x;
  const centerZ = hit.point.z;

  const radius = brushSize;
  const strength = brushStrength;

  let changed = false;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);

    const dx = x - centerX;
    const dz = z - centerZ;

    const distance = Math.sqrt(
      dx * dx + dz * dz
    );

    if (distance >= radius) continue;

    const normalized =
      1 - distance / radius;

    const falloff =
      normalized * normalized *
      (3 - 2 * normalized);

    let height = positions.getY(i);

    if (currentTool === "raise") {
      height +=
        strength * deltaTime * 3 * falloff;
    }

    if (currentTool === "lower") {
      height -=
        strength * deltaTime * 3 * falloff;
    }

    if (currentTool === "flatten") {
      const blend = Math.min(
        1,
        strength * deltaTime * 2 * falloff
      );

      height = THREE.MathUtils.lerp(
        height,
        flattenTarget,
        blend
      );
    }

    height = THREE.MathUtils.clamp(
      height,
      WORLD.minimumTerrainHeight,
      WORLD.maximumTerrainHeight
    );

    if (Math.abs(height - positions.getY(i)) > 0.0001) {
      positions.setY(i, height);
      changed = true;
    }
  }

  if (changed) {
    terrainChanged = true;
    updateTerrainMesh();
  }
}

function setupTerrainEditing() {
  const canvas = renderer.domElement;

  canvas.addEventListener(
    "pointermove",
    onTerrainPointerMove
  );

  canvas.addEventListener(
    "pointerdown",
    onTerrainPointerDown
  );

  canvas.addEventListener(
    "pointerup",
    onTerrainPointerUp
  );

  canvas.addEventListener(
    "pointercancel",
    onTerrainPointerUp
  );

  canvas.addEventListener(
    "lostpointercapture",
    onTerrainPointerUp
  );
}

function onTerrainPointerDown(event) {
  if (currentTool === "camera") return;
  if (event.button !== 0) return;

  const hit = getTerrainIntersection(event);

  if (!hit) return;

  event.preventDefault();

  isSculpting = true;
  terrainChanged = false;

  controls.enabled = false;

  try {
    renderer.domElement.setPointerCapture(
      event.pointerId
    );
  } catch (error) {
    // Pointer capture may be unavailable on some devices.
  }

  if (currentTool === "flatten") {
    flattenTarget = hit.point.y;
  }

  lastBrushTime = performance.now();

  applyBrush(hit, 0.016);
}

function onTerrainPointerMove(event) {
  const hit = getTerrainIntersection(event);

  if (!hit) {
    brushRing.visible = false;
    return;
  }

  brushRing.visible = true;

  brushRing.position.set(
    hit.point.x,
    hit.point.y + 0.18,
    hit.point.z
  );

  brushRing.scale.setScalar(brushSize);

  if (!isSculpting) return;

  const now = performance.now();

  const deltaTime = THREE.MathUtils.clamp(
    (now - lastBrushTime) / 1000,
    0.005,
    0.05
  );

  lastBrushTime = now;

  applyBrush(hit, deltaTime);
}

function onTerrainPointerUp(event) {
  if (!isSculpting) return;

  isSculpting = false;
  controls.enabled = currentTool === "camera";

  if (terrainChanged) {
    rebuildTerrainCollider();
    updateVegetationHeights();

    terrainChanged = false;

    showToast("Terrain collision updated");
  }
}

/* =========================================================
   TERRAIN RESET
   ========================================================= */

function resetTerrain() {
  const positions =
    terrainGeometry.attributes.position;

  for (let i = 0; i < positions.count; i++) {
    positions.setY(
      i,
      originalTerrainHeights[i]
    );
  }

  updateTerrainMesh();
  rebuildTerrainCollider();
  updateVegetationHeights();

  showToast("Terrain restored");
}

/* =========================================================
   PHYSICAL TEST OBJECTS
   ========================================================= */

function spawnPhysicsObject(type) {
  const x = (Math.random() - 0.5) * 35;
  const z = (Math.random() - 0.5) * 35;

  const groundY = getHeightAt(x, z);

  const startY = groundY + 35;

  let mesh;
  let bodyDescription;
  let colliderDescription;

  if (type === "box") {
    const size = 2.5;

    const geometry = new THREE.BoxGeometry(
      size,
      size,
      size
    );

    const material =
      new THREE.MeshStandardMaterial({
        color: 0xb18b62,
        roughness: 0.7
      });

    mesh = new THREE.Mesh(geometry, material);

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    bodyDescription =
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, startY, z)
        .setCanSleep(true);

    colliderDescription =
      RAPIER.ColliderDesc.cuboid(
        size / 2,
        size / 2,
        size / 2
      );

  } else {
    const radius = 1.5;

    const geometry =
      new THREE.SphereGeometry(radius, 20, 16);

    const material =
      new THREE.MeshStandardMaterial({
        color: 0x8bacc0,
        roughness: 0.45
      });

    mesh = new THREE.Mesh(geometry, material);

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    bodyDescription =
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, startY, z)
        .setCanSleep(true);

    colliderDescription =
      RAPIER.ColliderDesc.ball(radius);
  }

  colliderDescription.setFriction(0.8);
  colliderDescription.setRestitution(0.15);

  const body = physicsWorld.createRigidBody(
    bodyDescription
  );

  physicsWorld.createCollider(
    colliderDescription,
    body
  );

  scene.add(mesh);

  physicsObjects.push({
    mesh,
    body
  });

  showToast(
    type === "box"
      ? "Physical box spawned"
      : "Physical sphere spawned"
  );
}

function clearPhysicsObjects() {
  for (const item of physicsObjects) {
    physicsWorld.removeRigidBody(item.body);

    scene.remove(item.mesh);

    item.mesh.geometry.dispose();
    item.mesh.material.dispose();
  }

  physicsObjects = [];

  showToast("Test objects cleared");
}

/* =========================================================
   PHYSICS UPDATE
   ========================================================= */

function updatePhysics(deltaTime) {
  accumulator += Math.min(deltaTime, 0.1);

  while (accumulator >= FIXED_STEP) {
    physicsWorld.step();
    accumulator -= FIXED_STEP;
  }

  for (const item of physicsObjects) {
    const position = item.body.translation();
    const rotation = item.body.rotation();

    item.mesh.position.set(
      position.x,
      position.y,
      position.z
    );

    item.mesh.quaternion.set(
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w
    );
  }
}

/* =========================================================
   USER INTERFACE
   ========================================================= */

function setupUI() {
  const terrainPanel =
    document.getElementById("terrain-panel");

  const terrainToggle =
    document.getElementById("terrain-toggle");

  const closeTerrain =
    document.getElementById("close-terrain");

  function toggleTerrainPanel(open) {
    terrainPanel.classList.toggle("open", open);

    document.getElementById("toggle-arrow").textContent =
      open ? "⌃" : "⌄";
  }

  terrainToggle.addEventListener("click", () => {
    toggleTerrainPanel(
      !terrainPanel.classList.contains("open")
    );
  });

  closeTerrain.addEventListener("click", () => {
    toggleTerrainPanel(false);
  });

  document
    .getElementById("enter-button")
    .addEventListener("click", () => {
      document
        .getElementById("intro-panel")
        .style.display = "none";
    });

  document
    .querySelectorAll(".tool-button")
    .forEach(button => {
      button.addEventListener("click", () => {
        currentTool = button.dataset.tool;

        document
          .querySelectorAll(".tool-button")
          .forEach(item => {
            item.classList.toggle(
              "active",
              item === button
            );
          });

        controls.enabled =
          currentTool === "camera";

        brushRing.visible = false;

        const descriptions = {
          camera:
            "Camera mode: drag to rotate, scroll to zoom, right-drag to pan.",

          raise:
            "Raise: hold and drag over the terrain to create hills.",

          lower:
            "Lower: hold and drag over the terrain to create valleys.",

          flatten:
            "Flatten: hold and drag to level the ground to the starting brush height."
        };

        document.getElementById(
          "tool-description"
        ).textContent = descriptions[currentTool];
      });
    });

  const sizeInput =
    document.getElementById("brush-size");

  sizeInput.addEventListener("input", () => {
    brushSize = Number(sizeInput.value);

    document.getElementById(
      "brush-size-value"
    ).textContent = brushSize;

    brushRing.scale.setScalar(brushSize);
  });

  const strengthInput =
    document.getElementById("brush-strength");

  strengthInput.addEventListener("input", () => {
    brushStrength = Number(strengthInput.value);

    document.getElementById(
      "brush-strength-value"
    ).textContent = brushStrength.toFixed(1);
  });

  document
    .getElementById("reset-terrain")
    .addEventListener("click", resetTerrain);

  document
    .getElementById("drop-box")
    .addEventListener("click", () => {
      spawnPhysicsObject("box");
    });

  document
    .getElementById("drop-sphere")
    .addEventListener("click", () => {
      spawnPhysicsObject("sphere");
    });

  document
    .getElementById("clear-objects")
    .addEventListener("click", clearPhysicsObjects);

  // The editor starts closed.
  toggleTerrainPanel(false);
}

function updatePhysicsStatus(ready) {
  const dot =
    document.querySelector(".status-dot");

  dot.classList.toggle("ready", ready);

  document.getElementById(
    "physics-status-text"
  ).textContent = ready
    ? "Physics online"
    : "Physics loading";
}

function showToast(message) {
  const toast = document.getElementById("toast");

  toast.textContent = message;
  toast.classList.add("show");

  window.clearTimeout(showToast.timeout);

  showToast.timeout = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 1800);
}

/* =========================================================
   MATHEMATICAL HELPERS
   ========================================================= */

function gaussian(
  x,
  z,
  centerX,
  centerZ,
  spreadX,
  spreadZ,
  height
) {
  const dx = (x - centerX) / spreadX;
  const dz = (z - centerZ) / spreadZ;

  return (
    height *
    Math.exp(-0.5 * (dx * dx + dz * dz))
  );
}

function smoothstep(edge0, edge1, value) {
  const t = THREE.MathUtils.clamp(
    (value - edge0) / (edge1 - edge0),
    0,
    1
  );

  return t * t * (3 - 2 * t);
}

/* =========================================================
   WINDOW RESIZE
   ========================================================= */

function onWindowResize() {
  camera.aspect =
    window.innerWidth / window.innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );
}

/* =========================================================
   MAIN ANIMATION LOOP
   ========================================================= */

function animate() {
  requestAnimationFrame(animate);

  const deltaTime = Math.min(
    clock.getDelta(),
    0.1
  );

  controls.update();

  updatePhysics(deltaTime);

  renderer.render(scene, camera);
}

/* =========================================================
   START
   ========================================================= */

startApplication();
