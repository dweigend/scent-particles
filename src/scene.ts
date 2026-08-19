/**
 * Creates the minimal desktop Three.js scene and owns viewport resizing.
 * WebXR, post-processing, shadows, and runtime quality tiers are intentionally excluded.
 */

import {
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type SceneContext = Readonly<{
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  pixelRatio: number;
}>;

export function createScene(canvas: HTMLCanvasElement): SceneContext {
  const scene = new Scene();
  scene.background = new Color(0xe8eee6);

  const camera = new PerspectiveCamera(42, 1, 0.1, 50);
  camera.position.set(7, 4.5, 9);

  const renderer = new WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = "srgb";
  const pixelRatio = Math.min(window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(pixelRatio);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 1.45, 0);
  controls.enableDamping = true;
  controls.minDistance = 3.5;
  controls.maxDistance = 18;

  addEnvironment(scene);
  resizeScene(camera, renderer);
  return { scene, camera, renderer, controls, pixelRatio };
}

export function resizeScene(camera: PerspectiveCamera, renderer: WebGLRenderer): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function addEnvironment(scene: Scene): void {
  scene.add(new HemisphereLight(0xffffff, 0x617064, 2.2));
  const sun = new DirectionalLight(0xfff1d7, 2.5);
  sun.position.set(4, 7, 5);
  scene.add(sun);

  const ground = new Mesh(
    new PlaneGeometry(30, 30),
    new MeshStandardMaterial({ color: 0xdbe4d9, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
}
