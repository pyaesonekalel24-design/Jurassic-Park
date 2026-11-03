
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/* =========================================================
   DINOSAUR PARK — PROTOTYPE 01

   SYSTEMS:
   1. Island terrain
   2. Vegetation
   3. Camera
   4. Terrain editing

   ========================================================= */

/* =========================================================
   DOM ELEMENTS
   ========================================================= */

const container = document.getElementById("scene-container");

const loadingScreen = document.getElementById("loading-screen");
const loadingProgress = document.getElementById("loading-progress");
const loadingMessage = document.getElementById("loading-message");

const enterButton = document.getElementById("enter-button");
const introPanel = document.getElementById("intro-panel");
const controlsHint = document.getElementById("controls-hint");

const statusText = document.getElementById("status-text");

const brushSizeInput = document.getElementById("brush-size");
const brushStrengthInput = document.getElementById("brush-strength");

const brushSizeValue = document.getElementById("brush-size-value");
const brushStrengthValue = document.getElementById("brush-strength-value");

const resetTerrainButton = document.getElementById("reset-terrain");
const toolDescription = document.getElementById("tool-description");

const toolButtons = document.querySelectorAll(".tool-button");

/* =========================================================
   GLOBAL VARIABLES
   ========================================================= */

let scene;
let camera;
let renderer;
let controls;
let clock;

let islandGroup;
let water;

let terrainMesh;
let terrainGeometry;

let originalTerrainHeights;

let brushPreview;

let animationFrameId;

let activeTool = "camera";

let brushRadius = 10;
let brushStrength = 1.5;

let isEditing = false;
let activePointerId = null;

let flattenTargetHeight = 0;

let lastBrushTime = 0;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

const WORLD = {
  islandRadius: 72,
  terrainSegments: 180,
  waterLevel: 0,
  treeCount: 210,

  maximumTerrainHeight: 40,
  minimumTerrainHeight: -3
};

/* =========================================================
   INITIALIZATION
   ========================================================= */

init();

function init() {
  setLoading(12, "Preparing the scene...");

  createScene();

  setLoading(30, "Creating the island...");

  createLighting();
  createWater();
  createIsland();

  setLoading(65, "Growing the forest...");

  createVegetation();
  createAtmosphere();

  createBrushPreview();
  createControls();

  setupTerrainEditor();

  setLoading(100, "Island ready.");

  clock = new THREE.Clock();

  addEventListeners();

  animate();

  window.setTimeout(() => {
    loadingScreen.classList.add("done");
  }, 450);
}

/* =========================================================
   SCENE AND RENDERER
   ========================================================= */

function createScene() {
  scene = new THREE.Scene();

  scene.background = new THREE.Color(0x9bb8b0);

  scene.fog = new THREE.FogExp2(
    0x9bb8b0,
    0.0028
  );

  camera = new THREE.PerspectiveCamera(
    48,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
  );

  camera.position.set(112, 105, 145);

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

  renderer.shadowMap.type =
    THREE.PCFSoftShadowMap;

  renderer.outputColorSpace =
    THREE.SRGBColorSpace;

  renderer.toneMapping =
    THREE.ACESFilmicToneMapping;

  renderer.toneMappingExposure = 1.12;

  container.appendChild(renderer.domElement);

  renderer.domElement.style.touchAction = "none";

  islandGroup = new THREE.Group();

  scene.add(islandGroup);
}

/* =========================================================
   LIGHTING
   ========================================================= */

function createLighting() {
  const hemiLight = new THREE.HemisphereLight(
    0xd9efff,
    0x43523b,
    2.0
  );

  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(
    0xffedcf,
    3.0
  );

  sunLight.position.set(-90, 150, 75);

  sunLight.castShadow = true;

  sunLight.shadow.mapSize.set(2048, 2048);

  sunLight.shadow.camera.left = -115;
  sunLight.shadow.camera.right = 115;
  sunLight.shadow.camera.top = 115;
  sunLight.shadow.camera.bottom = -115;

  sunLight.shadow.normalBias = 0.035;

  scene.add(sunLight);
}

/* =========================================================
   WATER
   ========================================================= */

function createWater() {
  const geometry = new THREE.PlaneGeometry(
    1200,
    1200
  );

  const material = new THREE.MeshStandardMaterial({
    color: 0x397f83,
    roughness: 0.32,
    metalness: 0.08,
    transparent: true,
    opacity: 0.96
  });

  water = new THREE.Mesh(
    geometry,
    material
  );

  water.rotation.x = -Math.PI / 2;

  water.position.y = WORLD.waterLevel - 0.12;

  water.receiveShadow = true;

  scene.add(water);
}

/* =========================================================
   ISLAND TERRAIN
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

    const hillA = gaussian(
      x, z, -22, -14, 25, 31, 14
    );

    const hillB = gaussian(
      x, z, 20, 7, 22, 25, 10
    );

    const hillC = gaussian(
      x, z, -2, 32, 18, 19, 6
    );

    const ridge =
      Math.max(
        0,
        Math.sin((x + z * 0.55) * 0.055)
      ) * 2.0;

    const smallNoise =
      Math.sin(x * 0.19) *
      Math.cos(z * 0.17) * 0.65 +
      Math.sin((x + z) * 0.31) * 0.28;

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
      Math.sin(x * 0.37 + z * 0.21) * 0.035;

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

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0
  });

  terrainMesh = new THREE.Mesh(
    terrainGeometry,
    material
  );

  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = true;

  islandGroup.add(terrainMesh);

  // Shoreline

  const shoreGeometry = new THREE.RingGeometry(
    WORLD.islandRadius - 1.5,
    WORLD.islandRadius + 5.5,
    128
  );

  const shoreMaterial = new THREE.MeshStandardMaterial({
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

  islandGroup.add(shore);
}

/* =========================================================
   TERRAIN COLORS
   ========================================================= */

function getTerrainColor(height, targetColor) {
  const sandColor = 0xb6a477;
  const grassLow = 0x536f43;
  const grassMid = 0x66864b;
  const grassHigh = 0x82945a;
  const rockColor = 0x77796a;

  if (height < 0.2) {
    targetColor.setHex(sandColor);
  } else if (height > 17) {
    targetColor.setHex(rockColor);
  } else if (height > 9) {
    targetColor.setHex(grassHigh);
  } else if (height > 3.5) {
    targetColor.setHex(grassMid);
  } else {
    targetColor.setHex(grassLow);
  }

  return targetColor;
}

/* =========================================================
   VEGETATION
   ========================================================= */

function createVegetation() {
  const random = seededRandom(82471);

  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x59432e,
    roughness: 1
  });

  const leafMaterials = [
    new THREE.MeshStandardMaterial({
      color: 0x294f36,
      roughness: 1
    }),

    new THREE.MeshStandardMaterial({
      color: 0x376443,
      roughness: 1
    }),

    new THREE.MeshStandardMaterial({
      color: 0x527449,
      roughness: 1
    }),

    new THREE.MeshStandardMaterial({
      color: 0x6c824b,
      roughness: 1
    })
  ];

  const trunkGeometry = new THREE.CylinderGeometry(
    0.22,
    0.38,
    3.4,
    6
  );

  const crownGeometry = new THREE.IcosahedronGeometry(
    2.5,
    1
  );

  const treeGroup = new THREE.Group();

  for (let i = 0; i < WORLD.treeCount; i++) {
    const angle = random() * Math.PI * 2;

    const radius =
      Math.sqrt(random()) *
      (WORLD.islandRadius - 9);

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    if (
      x > -17 &&
      x < 18 &&
      z > -15 &&
      z < 17 &&
      random() > 0.12
    ) {
      continue;
    }

    const groundY = getTerrainHeight(x, z);

    const scale = 0.65 + random() * 0.85;

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
        Math.floor(random() * leafMaterials.length)
      ]
    );

    crown.position.y = 4.0 * scale;

    crown.scale.set(
      0.85 + random() * 0.35,
      0.9 + random() * 0.5,
      0.85 + random() * 0.35
    );

    crown.castShadow = true;
    crown.receiveShadow = true;

    tree.add(crown);

    tree.position.set(
      x,
      groundY,
      z
    );

    tree.rotation.y =
      random() * Math.PI * 2;

    treeGroup.add(tree);
  }

  islandGroup.add(treeGroup);

  createBushes(random);
}

/* =========================================================
   BUSHES
   ========================================================= */

function createBushes(random) {
  const bushGeometry = new THREE.IcosahedronGeometry(
    1.1,
    0
  );

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

  const bushes = new THREE.Group();

  for (let i = 0; i < 95; i++) {
    const angle = random() * Math.PI * 2;

    const radius =
      13 + random() * (WORLD.islandRadius - 18);

    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    const bush = new THREE.Mesh(
      bushGeometry,
      bushMaterials[
        Math.floor(random() * bushMaterials.length)
      ]
    );

    const scale = 0.45 + random() * 0.8;

    bush.scale.set(
      scale * 1.3,
      scale * 0.7,
      scale
    );

    bush.position.set(
      x,
      getTerrainHeight(x, z) + 0.65 * scale,
      z
    );

    bush.castShadow = true;

    bushes.add(bush);
  }

  islandGroup.add(bushes);
}

/* =========================================================
   ATMOSPHERE
   ========================================================= */

function createAtmosphere() {
  const skyGeometry = new THREE.SphereGeometry(
    700,
    32,
    20
  );

  const skyMaterial = new THREE.MeshBasicMaterial({
    color: 0x9bb8b0,
    side: THREE.BackSide
  });

  const sky = new THREE.Mesh(
    skyGeometry,
    skyMaterial
  );

  scene.add(sky);
}

/* =========================================================
   TERRAIN BRUSH PREVIEW
   ========================================================= */

function createBrushPreview() {
  const geometry = new THREE.RingGeometry(
    brushRadius - 0.2,
    brushRadius,
    64
  );

  const material = new THREE.MeshBasicMaterial({
    color: 0xb7d69a,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
    depthWrite: false
  });

  brushPreview = new THREE.Mesh(
    geometry,
    material
  );

  brushPreview.rotation.x = -Math.PI / 2;

  brushPreview.position.y = 0.2;

  brushPreview.visible = false;

  brushPreview.renderOrder = 5;

  scene.add(brushPreview);
}

function updateBrushPreviewSize() {
  const geometry = new THREE.RingGeometry(
    Math.max(0.1, brushRadius - 0.2),
    brushRadius,
    64
  );

  brushPreview.geometry.dispose();

  brushPreview.geometry = geometry;
}

function updateBrushPreviewColor() {
  const colors = {
    raise: 0x9ee58d,
    lower: 0xe9a17f,
    flatten: 0x91c9ef
  };

  if (colors[activeTool]) {
    brushPreview.material.color.setHex(
      colors[activeTool]
    );
  }
}

/* =========================================================
   CAMERA CONTROLS
   ========================================================= */

function createControls() {
  controls = new OrbitControls(
    camera,
    renderer.domElement
  );

  controls.target.set(0, 4, 0);

  controls.enableDamping = true;
  controls.dampingFactor = 0.055;

  controls.minDistance = 35;
  controls.maxDistance = 260;

  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minPolarAngle = 0.18;

  controls.enablePan = true;

  controls.panSpeed = 0.8;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 0.8;

  controls.update();

  renderer.domElement.addEventListener(
    "dblclick",
    focusIsland
  );
}

function focusIsland() {
  if (activeTool !== "camera") return;

  controls.target.set(0, 4, 0);

  controls.update();

  statusText.textContent =
    "CAMERA FOCUSED ON ISLAND";
}

/* =========================================================
   TERRAIN EDITOR SETUP
   ========================================================= */

function setupTerrainEditor() {
  toolButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectTool(button.dataset.tool);
    });
  });

  brushSizeInput.addEventListener("input", () => {
    brushRadius = Number(brushSizeInput.value);

    brushSizeValue.textContent =
      String(brushRadius);

    updateBrushPreviewSize();
  });

  brushStrengthInput.addEventListener("input", () => {
    brushStrength = Number(
      brushStrengthInput.value
    );

    brushStrengthValue.textContent =
      brushStrength.toFixed(1);
  });

  resetTerrainButton.addEventListener(
    "click",
    resetTerrain
  );

  const canvas = renderer.domElement;

  canvas.addEventListener(
    "pointerdown",
    onTerrainPointerDown
  );

  canvas.addEventListener(
    "pointermove",
    onTerrainPointerMove
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

/* =========================================================
   SELECT TERRAIN TOOL
   ========================================================= */

function selectTool(tool) {
  activeTool = tool;

  isEditing = false;
  activePointerId = null;

  controls.enabled = tool === "camera";

  brushPreview.visible = false;

  toolButtons.forEach((button) => {
    button.classList.toggle(
      "active",
      button.dataset.tool === tool
    );
  });

  const descriptions = {
    camera: "Rotate, zoom and explore your island.",

    raise: "Hold and drag to raise the terrain.",

    lower: "Hold and drag to lower the terrain.",

    flatten: "Hold and drag to flatten land to the starting height."
  };

  toolDescription.textContent =
    descriptions[tool];

  const statusNames = {
    camera: "CAMERA MODE",
    raise: "TERRAIN RAISE MODE",
    lower: "TERRAIN LOWER MODE",
    flatten: "TERRAIN FLATTEN MODE"
  };

  statusText.textContent =
    statusNames[tool];

  updateBrushPreviewColor();
}

/* =========================================================
   MOUSE RAYCASTING
   ========================================================= */

function getTerrainIntersection(event) {
  const rect = renderer.domElement.getBoundingClientRect();

  pointer.x =
    ((event.clientX - rect.left) / rect.width) * 2 - 1;

  pointer.y =
    -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  const intersections = raycaster.intersectObject(
    terrainMesh,
    false
  );

  if (intersections.length === 0) {
    return null;
  }

  return intersections[0];
}

/* =========================================================
   POINTER DOWN
   ========================================================= */

function onTerrainPointerDown(event) {
  if (activeTool === "camera") return;

  if (event.button !== 0) return;

  const hit = getTerrainIntersection(event);

  if (!hit) return;

  event.preventDefault();

  activePointerId = event.pointerId;

  renderer.domElement.setPointerCapture(
    event.pointerId
  );

  isEditing = true;

  lastBrushTime = performance.now();

  // Flatten remembers the height where the player
  // initially presses the mouse.

  if (activeTool === "flatten") {
    flattenTargetHeight = hit.point.y;
  }

  updateBrushPosition(hit.point);

  applyTerrainBrush(hit.point, 0.016);
}

/* =========================================================
   POINTER MOVE
   ========================================================= */

function onTerrainPointerMove(event) {
  const hit = getTerrainIntersection(event);

  if (hit && activeTool !== "camera") {
    updateBrushPosition(hit.point);
  } else {
    brushPreview.visible = false;
  }

  if (
    !isEditing ||
    activePointerId !== event.pointerId
  ) {
    return;
  }

  if (!hit) return;

  event.preventDefault();

  const now = performance.now();

  const deltaTime = THREE.MathUtils.clamp(
    (now - lastBrushTime) / 1000,
    0.005,
    0.05
  );

  lastBrushTime = now;

  applyTerrainBrush(
    hit.point,
    deltaTime
  );
}

/* =========================================================
   POINTER UP
   ========================================================= */

function onTerrainPointerUp(event) {
  if (activePointerId !== event.pointerId) return;

  isEditing = false;

  activePointerId = null;
}

/* =========================================================
   BRUSH POSITION
   ========================================================= */

function updateBrushPosition(point) {
  if (activeTool === "camera") {
    brushPreview.visible = false;
    return;
  }

  brushPreview.visible = true;

  brushPreview.position.set(
    point.x,
    point.y + 0.18,
    point.z
  );
}

/* =========================================================
   APPLY TERRAIN BRUSH
   ========================================================= */

function applyTerrainBrush(worldPoint, deltaTime) {
  if (!terrainGeometry) return;

  const positions =
    terrainGeometry.attributes.position;

  const center = islandGroup.worldToLocal(
    worldPoint.clone()
  );

  let changed = false;

  const radius = brushRadius;

  const strength = brushStrength;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);

    const dx = x - center.x;
    const dz = z - center.z;

    const distance = Math.sqrt(
      dx * dx + dz * dz
    );

    if (distance > radius) continue;

    // Smooth falloff:
    // Strongest in the center, weaker near the edge.

    const falloff =
      1 - smoothstep(0, radius, distance);

    const weight = falloff * falloff;

    let height = positions.getY(i);

    if (activeTool === "raise") {
      height +=
        strength *
        deltaTime *
        3.0 *
        weight;
    }

    else if (activeTool === "lower") {
      height -=
        strength *
        deltaTime *
        3.0 *
        weight;
    }

    else if (activeTool === "flatten") {
      const flattenAmount = THREE.MathUtils.clamp(
        strength * deltaTime * 2.5 * weight,
        0,
        1
      );

      height = THREE.MathUtils.lerp(
        height,
        flattenTargetHeight,
        flattenAmount
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
    updateTerrainMesh();
  }
}

/* =========================================================
   UPDATE TERRAIN MESH
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
   RESET TERRAIN
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

  statusText.textContent =
    "TERRAIN RESTORED TO ORIGINAL";
}

/* =========================================================
   INTERFACE EVENTS
   ========================================================= */

function addEventListeners() {
  window.addEventListener(
    "resize",
    onWindowResize
  );

  enterButton.addEventListener("click", () => {
    introPanel.classList.add("hidden");

    controlsHint.classList.add("visible");

    statusText.textContent =
      "EXPLORATION MODE";
  });
}

/* =========================================================
   RESIZE
   ========================================================= */

function onWindowResize() {
  camera.aspect =
    window.innerWidth / window.innerHeight;

  camera.updateProjectionMatrix();

  renderer.setSize(
    window.innerWidth,
    window.innerHeight
  );

  renderer.setPixelRatio(
    Math.min(window.devicePixelRatio, 1.75)
  );
}

/* =========================================================
   ANIMATION LOOP
   ========================================================= */

function animate() {
  animationFrameId =
    requestAnimationFrame(animate);

  const delta = Math.min(
    clock.getDelta(),
    0.05
  );

  controls.update();

  if (water) {
    water.material.opacity =
      0.945 +
      Math.sin(clock.elapsedTime * 0.35) * 0.012;
  }

  renderer.render(scene, camera);
}

/* =========================================================
   LOADING SCREEN
   ========================================================= */

function setLoading(progress, message) {
  loadingProgress.style.width =
    `${progress}%`;

  loadingMessage.textContent = message;
}

/* =========================================================
   TERRAIN HEIGHT HELPERS
   ========================================================= */

function getTerrainHeight(x, z) {
  const hillA = gaussian(
    x, z, -22, -14, 25, 31, 14
  );

  const hillB = gaussian(
    x, z, 20, 7, 22, 25, 10
  );

  const hillC = gaussian(
    x, z, -2, 32, 18, 19, 6
  );

  const ridge =
    Math.max(
      0,
      Math.sin((x + z * 0.55) * 0.055)
    ) * 2.0;

  const smallNoise =
    Math.sin(x * 0.19) *
    Math.cos(z * 0.17) * 0.65 +
    Math.sin((x + z) * 0.31) * 0.28;

  return (
    1.4 +
    hillA +
    hillB +
    hillC +
    ridge +
    smallNoise
  );
}

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
   SEEDED RANDOM GENERATOR
   ========================================================= */

function seededRandom(seed) {
  let value = seed;

  return function () {
    value =
      (value * 1664525 + 1013904223) %
      4294967296;

    return value / 4294967296;
  };
}

/* =========================================================
   CLEANUP
   ========================================================= */

window.addEventListener("beforeunload", () => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
});
