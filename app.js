
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

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
    Math.min(window.devicePixelRatio, 1.25)
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

 sun.shadow.mapSize.set(1024, 1024);
   
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


// TERRAIN TEXTURES
const textureLoader = new THREE.TextureLoader();

const grassDiffuse = textureLoader.load(
  "model/map/textures/rocky_terrain_02_diff_2k.jpg"
);

const grassNormal = textureLoader.load(
  "model/map/textures/rocky_terrain_02_nor_gl_2k.png"
);

const grassRoughness = textureLoader.load(
  "model/map/textures/rocky_terrain_02_rough_2k.png"
);

const grassAO = textureLoader.load(
  "model/map/textures/rocky_terrain_02_ao_2k.png"
);

// Texture colour correction
grassDiffuse.colorSpace = THREE.SRGBColorSpace;

// Repeat textures across the island
const terrainSize = WORLD.islandRadius * 2.35;
const textureRepeat = terrainSize / 20;

const terrainTextures = [
  grassDiffuse,
  grassNormal,
  grassRoughness,
  grassAO
];

for (const texture of terrainTextures) {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;

  texture.repeat.set(
    textureRepeat,
    textureRepeat
  );

  texture.anisotropy = 8;
}

// Extra UV channel for ambient occlusion
terrainGeometry.setAttribute(
  "uv1",
  terrainGeometry.attributes.uv
);

// Create terrain material
const terrainMaterial =
  new THREE.MeshStandardMaterial({
    map: grassDiffuse,
    normalMap: grassNormal,
    roughnessMap: grassRoughness,
    aoMap: grassAO,

    aoMapIntensity: 1,
    normalScale: new THREE.Vector2(1, 1),

    vertexColors: false,
    roughness: 1,
    metalness: 0,

    side: THREE.DoubleSide
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
   PROCEDURAL T-REX MODEL
   ========================================================= */

function createTRexModel() {
  const dinosaur = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({
    color: 0x65734b,
    roughness: 0.92
  });

  const belly = new THREE.MeshStandardMaterial({
    color: 0x9b916e,
    roughness: 1
  });

  const darkSkin = new THREE.MeshStandardMaterial({
    color: 0x394532,
    roughness: 1
  });

  const mouthMaterial = new THREE.MeshStandardMaterial({
    color: 0x542f2b,
    roughness: 1
  });

  const teethMaterial = new THREE.MeshStandardMaterial({
    color: 0xe5dfc5,
    roughness: 0.8
  });

  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0xe2ad35,
    roughness: 0.4
  });

  const pupilMaterial = new THREE.MeshStandardMaterial({
    color: 0x17140e
  });

  function ellipsoid(parent, material, x, y, z, sx, sy, sz) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      material
    );

    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    parent.add(mesh);
    return mesh;
  }

  function segment(parent, start, end, radiusTop, radiusBottom, material) {
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();

    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(
        radiusTop,
        radiusBottom,
        length,
        10
      ),
      material
    );

    mesh.position.copy(start).add(end).multiplyScalar(0.5);

    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize()
    );

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    parent.add(mesh);
    return mesh;
  }

  // Main muscular body
  ellipsoid(dinosaur, skin, 0, 0, 0, 1.05, 0.95, 2.05);

  // Belly
  ellipsoid(dinosaur, belly, 0, -0.52, 0.1, 0.83, 0.43, 1.55);

  // Back muscle and shoulder hump
  ellipsoid(dinosaur, darkSkin, 0, 0.73, -0.15, 0.88, 0.27, 1.15);

  // Neck
  segment(
    dinosaur,
    new THREE.Vector3(0, 0.25, 1.2),
    new THREE.Vector3(0, 0.65, 2.05),
    0.55,
    0.75,
    skin
  );

  // Head
  const head = new THREE.Group();
  head.position.set(0, 0.72, 2.05);
  dinosaur.add(head);

  ellipsoid(head, skin, 0, 0.12, 0.25, 0.72, 0.65, 0.85);

  // Long snout
  ellipsoid(head, skin, 0, -0.02, 0.9, 0.55, 0.43, 0.85);

  // Lower jaw
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.28, 0.55);
  head.add(jaw);

  ellipsoid(jaw, mouthMaterial, 0, -0.05, 0.28, 0.48, 0.12, 0.85);
  ellipsoid(jaw, skin, 0, -0.19, 0.3, 0.52, 0.18, 0.85);

  // Teeth
  for (let i = 0; i < 7; i++) {
    const x = (i - 3) * 0.125;

    const tooth = new THREE.Mesh(
      new THREE.ConeGeometry(0.065, 0.19, 8),
      teethMaterial
    );

    tooth.position.set(x, -0.02, 0.0 + i * 0.18);
    tooth.rotation.x = Math.PI;
    jaw.add(tooth);

    const upperTooth = tooth.clone();
    upperTooth.position.y = -0.15;
    upperTooth.rotation.x = 0;
    head.add(upperTooth);
  }

  // Eyes
  for (const side of [-1, 1]) {
    ellipsoid(
      head,
      darkSkin,
      side * 0.57,
      0.38,
      0.43,
      0.19,
      0.2,
      0.19
    );

    ellipsoid(
      head,
      eyeMaterial,
      side * 0.64,
      0.39,
      0.47,
      0.105,
      0.12,
      0.12
    );

    ellipsoid(
      head,
      pupilMaterial,
      side * 0.69,
      0.39,
      0.49,
      0.045,
      0.075,
      0.075
    );

    // Tiny arms
    const arm = new THREE.Group();
    arm.position.set(side * 0.78, -0.05, 1.0);
    dinosaur.add(arm);

    segment(
      arm,
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(side * 0.12, -0.32, 0.12),
      0.15,
      0.12,
      skin
    );

    segment(
      arm,
      new THREE.Vector3(side * 0.12, -0.32, 0.12),
      new THREE.Vector3(side * 0.1, -0.48, 0.2),
      0.11,
      0.08,
      skin
    );

    // Two little claws
    for (let claw = 0; claw < 2; claw++) {
      ellipsoid(
        arm,
        teethMaterial,
        side * (0.1 + claw * 0.08),
        -0.51,
        0.23,
        0.035,
        0.045,
        0.09
      );
    }
  }

  // Powerful animated legs
  const legs = [];

  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.62, -0.55, 0.2);
    dinosaur.add(leg);

    ellipsoid(leg, skin, 0, -0.32, 0, 0.43, 0.72, 0.48);

    segment(
      leg,
      new THREE.Vector3(0, -0.5, 0),
      new THREE.Vector3(0, -1.05, 0.05),
      0.27,
      0.2,
      skin
    );

    // Three-toed foot
    ellipsoid(
      leg,
      skin,
      0,
      -1.13,
      0.28,
      0.34,
      0.16,
      0.43
    );

    for (let toe = -1; toe <= 1; toe++) {
      ellipsoid(
        leg,
        skin,
        toe * 0.17,
        -1.15,
        0.58,
        0.12,
        0.11,
        0.24
      );

      ellipsoid(
        leg,
        teethMaterial,
        toe * 0.17,
        -1.15,
        0.77,
        0.065,
        0.07,
        0.12
      );
    }

    legs.push(leg);
  }

  // Long tapered tail
  segment(
    dinosaur,
    new THREE.Vector3(0, 0.05, -1.45),
    new THREE.Vector3(0, 0.0, -2.8),
    0.65,
    0.38,
    skin
  );

  segment(
    dinosaur,
    new THREE.Vector3(0, 0.0, -2.8),
    new THREE.Vector3(0, -0.12, -4.2),
    0.38,
    0.035,
    skin
  );

  // Dark markings along the back
  for (let i = 0; i < 8; i++) {
    const z = 1.1 - i * 0.38;

    ellipsoid(
      dinosaur,
      darkSkin,
      0,
      0.9,
      z,
      0.22,
      0.12,
      0.19
    );
  }

  dinosaur.traverse((object) => {
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  return {
    group: dinosaur,
    legs,
    head,
    jaw
  };
}

/* =========================================================
   PHYSICAL TEST OBJECTS
   ========================================================= */


function spawnPhysicsObject(type) {
  const x = (Math.random() - 0.5) * 35;
  const z = (Math.random() - 0.5) * 35;

  const groundY = getHeightAt(x, z);
  const startY = groundY + 35;

  // Physics-controlled dinosaur wrapper.
  const dinosaur = new THREE.Group();

  const bodyDescription =
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(x, startY, z)
      .setCanSleep(false)
      .setLinearDamping(0.5)
      .setAngularDamping(2);

  const colliderDescription =
    RAPIER.ColliderDesc.cuboid(1.0, 1.25, 2.3)
      .setFriction(1.0)
      .setRestitution(0.0);

  const body =
    physicsWorld.createRigidBody(bodyDescription);

  physicsWorld.createCollider(
    colliderDescription,
    body
  );

  scene.add(dinosaur);

  const dinosaurData = {
    mesh: dinosaur,
    body,
    mixer: null,
    age: 0,
    landed: false,
    direction: new THREE.Vector3(1, 0, 0),
    nextTurn: 0
  };

  physicsObjects.push(dinosaurData);

  const loader = new GLTFLoader();

  const MODEL_PATH = "models/trex/scene.gltf";

  loader.load(
    MODEL_PATH,

    function (gltf) {
      
const model = gltf.scene;

// Initial model scale.
model.scale.setScalar(1);

// Measure the actual dinosaur model.
const box = new THREE.Box3().setFromObject(model);
const center = new THREE.Vector3();

box.getCenter(center);

// Center the model and align its feet
// with the bottom of the physics collider.
model.position.set(
  -center.x,
  -box.min.y - 1.25,
  -center.z
);

console.log("T-Rex dimensions:", box.getSize(new THREE.Vector3()));

dinosaur.add(model);
     
model.traverse(function (child) {
  if (child.isMesh) {
    child.castShadow = true;
    child.receiveShadow = true;

    console.log("Mesh:", child.name);

    if (Array.isArray(child.material)) {
      child.material.forEach(material => {
        console.log(
          "Material:",
          material.name,
          "Texture:",
          material.map?.image?.src
        );
      });
    } else {
      console.log(
        "Material:",
        child.material.name,
        "Texture:",
        child.material.map?.image?.src
      );
    }
  }
});

      // Load included animations.
      if (gltf.animations.length > 0) {
        const mixer =
          new THREE.AnimationMixer(model);

        gltf.animations.forEach(function (clip) {
          console.log("Animation found:", clip.name);
        });

        const action = mixer.clipAction(
          gltf.animations[0]
        );

        action.play();

        dinosaurData.mixer = mixer;
      } else {
        console.warn("No animations found in T-Rex model.");
      }

      console.log("T-Rex loaded successfully!");
    },

    undefined,

    function (error) {
      console.error("T-Rex loading failed:", error);

      physicsWorld.removeRigidBody(body);
      scene.remove(dinosaur);

      const index = physicsObjects.indexOf(dinosaurData);

      if (index !== -1) {
        physicsObjects.splice(index, 1);
      }

      showToast("T-Rex model failed to load.");
    }
  );

  showToast("A T-Rex has entered the island!");
}

/* =========================================================
   PHYSICS UPDATE
   ========================================================= */
function clearPhysicsObjects() {
  for (const item of physicsObjects) {
    physicsWorld.removeRigidBody(item.body);

    scene.remove(item.mesh);

    item.mesh.traverse((object) => {
      if (object.isMesh) {
        object.geometry.dispose();

        if (Array.isArray(object.material)) {
          object.material.forEach(material => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
  }

  physicsObjects = [];

  showToast("Dinosaurs cleared");
}


function updatePhysics(deltaTime) {
  accumulator += Math.min(deltaTime, 0.1);

  while (accumulator >= FIXED_STEP) {
    physicsWorld.step();
    accumulator -= FIXED_STEP;
  }

  for (const item of physicsObjects) {
    const position = item.body.translation();

    item.mesh.position.set(
      position.x,
      position.y,
      position.z
    );

    if (!item.landed) {
      const groundY = getHeightAt(
        position.x,
        position.z
      );

      if (position.y <= groundY + 1.4) {
        item.landed = true;
        item.age = 0;

        showToast("T-Rex landed!");
      }
    }

    if (item.landed) {
      item.age += deltaTime;

      // Choose a new walking direction periodically.
      if (item.age >= item.nextTurn) {
        const angle = Math.random() * Math.PI * 2;

        item.direction.set(
          Math.sin(angle),
          0,
          Math.cos(angle)
        );

        item.nextTurn =
          item.age + 3 + Math.random() * 4;
      }

      const speed = 2.2;

      item.body.setLinvel(
        {
          x: item.direction.x * speed,
          y: item.body.linvel().y,
          z: item.direction.z * speed
        },
        true
      );

      // Turn the physics body in its walking direction.
      const yaw = Math.atan2(
        item.direction.x,
        item.direction.z
      );

      item.body.setRotation(
        {
          x: 0,
          y: Math.sin(yaw / 2),
          z: 0,
          w: Math.cos(yaw / 2)
        },
        true
      );
    }

    // Update the downloaded model's animation.
    if (item.mixer) {
      item.mixer.update(deltaTime);
    }

    // Sync visual dinosaur with physics rotation.
    const rotation = item.body.rotation();

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
