/**
 * Coordinates scene collections, shared population controls, particles, and the render loop.
 * Structural UI changes are committed atomically so routes and scent sources stay synchronized.
 */

import "./style.css";
import { Clock } from "three";
import {
  AnimalGroup,
  DEFAULT_ANIMAL_COUNT,
  MAX_ANIMAL_COUNT,
  MIN_ANIMAL_COUNT,
} from "./animal-group";
import { ANIMAL_ASSET, TREE_ASSETS, type ModelAsset } from "./model-assets";
import {
  DEFAULT_TREE_COUNT,
  Forest,
  MAX_TREE_COUNT,
  MIN_TREE_COUNT,
} from "./forest";
import { loadModelAsset } from "./model-loader";
import {
  DEFAULT_PARTICLES_PER_EMITTER,
  MAX_PARTICLES_PER_EMITTER,
  MIN_PARTICLES_PER_EMITTER,
  ScentParticles,
  type ScentSource,
} from "./scent-particles";
import { createScene, resizeScene } from "./scene";

const canvas = requireElement("scene", HTMLCanvasElement);
const treeAssetSelect = requireElement("tree-asset", HTMLSelectElement);
const particlesPerEmitterInput = requireElement("particles-per-emitter", HTMLInputElement);
const particlesPerEmitterOutput = requireElement("particles-per-emitter-value", HTMLOutputElement);
const resampleButton = requireElement("resample", HTMLButtonElement);
const treeCountInput = requireElement("tree-count", HTMLInputElement);
const treeCountOutput = requireElement("tree-count-value", HTMLOutputElement);
const animalCountInput = requireElement("animal-count", HTMLInputElement);
const animalCountOutput = requireElement("animal-count-value", HTMLOutputElement);
const treeVisibilityButton = requireElement("tree-visibility", HTMLButtonElement);
const statusElement = requireElement("status", HTMLParagraphElement);
const renderedParticleCountElement = requireElement("rendered-particle-count", HTMLElement);
const attributionElement = requireElement("attribution", HTMLParagraphElement);

const numberFormat = new Intl.NumberFormat("de-DE");
const sceneContext = createScene(canvas);
const scentParticles = new ScentParticles(
  sceneContext.pixelRatio,
  MAX_TREE_COUNT + MAX_ANIMAL_COUNT,
);
const clock = new Clock();

let forest: Forest | undefined;
let animalGroup: AnimalGroup | undefined;
let particlesPerEmitter = DEFAULT_PARTICLES_PER_EMITTER;
let treeCount = DEFAULT_TREE_COUNT;
let animalCount = DEFAULT_ANIMAL_COUNT;
let treesVisible = true;
let treeAssetLoadRequestId = 0;

sceneContext.scene.add(scentParticles.sceneObject);
configureControls();
bindEvents();
void loadAnimalGroup();
void switchTreeAsset(TREE_ASSETS[0]!);
window.requestAnimationFrame(renderFrame);

function renderFrame(): void {
  const deltaTime = clock.getDelta();
  const elapsedTime = clock.elapsedTime;
  animalGroup?.update(elapsedTime, deltaTime);
  scentParticles.setTime(elapsedTime);
  sceneContext.controls.update();
  sceneContext.renderer.render(sceneContext.scene, sceneContext.camera);
  window.requestAnimationFrame(renderFrame);
}

async function loadAnimalGroup(): Promise<void> {
  try {
    const nextAnimalGroup = new AnimalGroup(
      await loadModelAsset(ANIMAL_ASSET),
      forest?.getGroundFootprints() ?? [],
      animalCount,
    );
    animalGroup = nextAnimalGroup;
    sceneContext.scene.add(nextAnimalGroup.sceneObject);
    resampleScentParticles();
    showAttributions();
    updateStatus();
  } catch {
    statusElement.textContent = "Tiere konnten nicht geladen werden.";
  }
}

async function switchTreeAsset(asset: ModelAsset): Promise<void> {
  const requestId = ++treeAssetLoadRequestId;
  statusElement.textContent = `Baumart ${asset.title} wird geladen …`;
  try {
    const nextForest = new Forest(await loadModelAsset(asset));
    if (requestId !== treeAssetLoadRequestId) return nextForest.dispose();
    replaceForest(nextForest);
  } catch {
    statusElement.textContent = "Bäume konnten nicht geladen werden.";
  }
}

function replaceForest(nextForest: Forest): void {
  if (forest) {
    sceneContext.scene.remove(forest.sceneObject);
    forest.dispose();
  }
  forest = nextForest;
  nextForest.setVisible(treesVisible);
  sceneContext.scene.add(nextForest.sceneObject);
  applyPopulationState();
  showAttributions();
}

function configureControls(): void {
  populateTreeAssetSelect();
  configureRange(particlesPerEmitterInput, {
    minimum: MIN_PARTICLES_PER_EMITTER,
    maximum: MAX_PARTICLES_PER_EMITTER,
    value: DEFAULT_PARTICLES_PER_EMITTER,
    step: 100,
  });
  configureRange(treeCountInput, {
    minimum: MIN_TREE_COUNT,
    maximum: MAX_TREE_COUNT,
    value: DEFAULT_TREE_COUNT,
    step: 1,
  });
  configureRange(animalCountInput, {
    minimum: MIN_ANIMAL_COUNT,
    maximum: MAX_ANIMAL_COUNT,
    value: DEFAULT_ANIMAL_COUNT,
    step: 1,
  });
  updateParticlesPerEmitter(DEFAULT_PARTICLES_PER_EMITTER);
  updateTreeCount(DEFAULT_TREE_COUNT);
  updateAnimalCount(DEFAULT_ANIMAL_COUNT);
  updateRenderedParticleCount();
  updateTreeVisibilityButton();
}

function bindEvents(): void {
  treeAssetSelect.addEventListener("change", onTreeAssetChange);
  particlesPerEmitterInput.addEventListener("input", onParticlesPerEmitterInput);
  particlesPerEmitterInput.addEventListener("change", resampleScentParticles);
  resampleButton.addEventListener("click", resampleScentParticles);
  treeCountInput.addEventListener("input", onTreeCountInput);
  treeCountInput.addEventListener("change", applyPopulationState);
  animalCountInput.addEventListener("input", onAnimalCountInput);
  animalCountInput.addEventListener("change", applyPopulationState);
  treeVisibilityButton.addEventListener("click", toggleTrees);
  window.addEventListener("resize", onResize);
}

function onTreeAssetChange(): void {
  const asset = TREE_ASSETS.find(({ id }) => id === treeAssetSelect.value);
  if (asset) void switchTreeAsset(asset);
}

function onParticlesPerEmitterInput(): void {
  updateParticlesPerEmitter(
    readRangeValue(
      particlesPerEmitterInput,
      MIN_PARTICLES_PER_EMITTER,
      MAX_PARTICLES_PER_EMITTER,
    ),
  );
}

function onTreeCountInput(): void {
  updateTreeCount(readRangeValue(treeCountInput, MIN_TREE_COUNT, MAX_TREE_COUNT));
}

function onAnimalCountInput(): void {
  updateAnimalCount(readRangeValue(animalCountInput, MIN_ANIMAL_COUNT, MAX_ANIMAL_COUNT));
}

function updateParticlesPerEmitter(count: number): void {
  particlesPerEmitter = count;
  particlesPerEmitterOutput.value = numberFormat.format(particlesPerEmitter);
}

function updateTreeCount(count: number): void {
  treeCount = count;
  treeCountOutput.value = numberFormat.format(treeCount);
}

function updateAnimalCount(count: number): void {
  animalCount = count;
  animalCountOutput.value = numberFormat.format(animalCount);
}

function applyPopulationState(): void {
  forest?.setCount(treeCount);
  animalGroup?.setCount(animalCount, forest?.getGroundFootprints() ?? []);
  resampleScentParticles();
  updateStatus();
}

function resampleScentParticles(): void {
  scentParticles.resample(createScentSources(), particlesPerEmitter, animalGroup?.getRouteAtlas());
  updateRenderedParticleCount();
}

function createScentSources(): readonly ScentSource[] {
  return [forest?.getScentSource(), animalGroup?.getScentSource()].filter(
    (source): source is ScentSource => source !== undefined,
  );
}

function updateRenderedParticleCount(): void {
  renderedParticleCountElement.textContent = numberFormat.format(
    scentParticles.getRenderedParticleCount(),
  );
}

function toggleTrees(): void {
  treesVisible = !treesVisible;
  forest?.setVisible(treesVisible);
  updateTreeVisibilityButton();
}

function updateTreeVisibilityButton(): void {
  treeVisibilityButton.textContent = treesVisible ? "Bäume ausblenden" : "Bäume einblenden";
  treeVisibilityButton.setAttribute("aria-pressed", String(!treesVisible));
}

function onResize(): void {
  resizeScene(sceneContext.camera, sceneContext.renderer);
  scentParticles.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
}

function populateTreeAssetSelect(): void {
  for (const asset of TREE_ASSETS) {
    const option = document.createElement("option");
    option.value = asset.id;
    option.textContent = asset.title;
    treeAssetSelect.append(option);
  }
}

function createAttributionLink(asset: ModelAsset): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = asset.sourcePageUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = asset.attribution;
  return link;
}

function showAttributions(): void {
  const assets = [forest?.asset, animalGroup?.asset].filter(
    (asset): asset is ModelAsset => asset !== undefined,
  );
  const nodes = assets.flatMap<Node>((asset, index) => [
    ...(index === 0 ? [] : [document.createTextNode(" · ")]),
    createAttributionLink(asset),
  ]);
  attributionElement.replaceChildren(...nodes);
}

function updateStatus(): void {
  const animalStatus = animalGroup ? `${animalGroup.getCount()} animierte Tiere · ` : "";
  statusElement.textContent = `${animalStatus}Wind · Lebensdauer 4–8 Sekunden`;
}

type RangeSettings = Readonly<{
  minimum: number;
  maximum: number;
  value: number;
  step: number;
}>;

function configureRange(input: HTMLInputElement, settings: RangeSettings): void {
  input.min = String(settings.minimum);
  input.max = String(settings.maximum);
  input.value = String(settings.value);
  input.step = String(settings.step);
}

function readRangeValue(input: HTMLInputElement, minimum: number, maximum: number): number {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function requireElement<T extends Element>(id: string, elementType: { new (): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof elementType)) throw new Error(`Bedienelement fehlt: #${id}.`);
  return element;
}
