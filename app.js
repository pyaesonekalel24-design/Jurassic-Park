
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/* =========================================================
   DINOSAUR PARK — PROTOTYPE 01

   World foundation:
   - 3D island
   - Terrain
   - Water
   - Vegetation
   - Camera controls

   ========================================================= */

const container = document.getElementById("scene-container");

const loadingScreen = document.getElementById("loading-screen");
const loadingProgress = document.getElementById("loading-progress");
const loadingMessage = document.getElementById("loading-message");

const enterButton = document.getElementById("enter-button");
const introPanel = document.getElementById("intro-panel");
const controlsHint = document.getElementById("controls-hint");
const statusText = document.getElementById("status-text");

let scene;
let camera;
let renderer;
let controls;
let clock;

let islandGroup;
let water;

let animationFrameId;

const WORLD = {
  islandRadius: 72,
  terrainSegments: 180,
  waterLevel: 0,
  treeCount: 210
};

/* =========================================================
   INITIALIZATION
   ========================================================= */

init();

function init() {
  setLoading(12, "Preparing the scene...");

  createScene();

  setLoading(32, "Creating the island...");

  createLighting();
  createWater();
  createIsland();

  setLoading(70, "Growing the forest...");

  createVegetation();
  createAtmosphere();
  createControls();

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
  scene.fog = new THREE.FogExp2(0x9bb8b0, 0.0028);

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
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  renderer.outputColorSpace = THREE.SRGBColorSpace;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  container.appendChild(renderer.domElement);

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
    1200,
    1,
    1
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

  const geometry = new THREE.PlaneGeometry(
    size,
    size,
    segments,
    segments
  );

  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;

  const colors = [];

  const color = new THREE.Color();

  const grassLow = new THREE.Color(0x536f43);
  const grassMid = new THREE.Color(0x66864b);
  const grassHigh = new THREE.Color(0x82945a);

  const sandColor = new THREE.Color(0xb6a477);
  const rockColor = new THREE.Color(0x77796a);

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

    const nearShore = edgeDistance < 5.5;

    if (height < 0.2 || nearShore) {
      color.copy(sandColor);
    } else if (height > 17) {
      color.copy(rockColor);
    } else if (height > 9) {
      color.copy(grassHigh);
    } else if (height > 3.5) {
      color.copy(grassMid);
    } else {
      color.copy(grassLow);
    }

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

  geometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(colors, 3)
  );

  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0
  });

  const terrain = new THREE.Mesh(
    geometry,
    material
  );

  terrain.receiveShadow = true;
  terrain.castShadow = true;

  islandGroup.add(terrain);

  // Shallow shoreline ring

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

    // Keep a central clearing for future construction.

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

    tree.rotation.y = random() * Math.PI * 2;

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
   CAMERA
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

/* =========================================================
   INTERFACE AND EVENTS
   ========================================================= */

function addEventListeners() {
  window.addEventListener(
    "resize",
    onWindowResize
  );

  enterButton.addEventListener("click", () => {
    introPanel.classList.add("hidden");

    controlsHint.classList.add("visible");

    statusText.textContent = "EXPLORATION MODE";
  });
}

function focusIsland() {
  controls.target.set(0, 4, 0);

  controls.update();

  statusText.textContent =
    "CAMERA FOCUSED ON ISLAND";
}

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
  animationFrameId = requestAnimationFrame(animate);

  const delta = Math.min(
    clock.getDelta(),
    0.05
  );

  controls.update();

  // Subtle water opacity variation.
  // Visual only; no gameplay effect yet.

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
  loadingProgress.style.width = `${progress}%`;

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
