/**
 * Coordinates model loading, forest controls, particle controls, and the render loop.
 * Continuous particle behavior stays in the shader; UI events trigger only bounded setup work.
 */

import "./style.css";
import { Clock } from "three";
import { MODEL_ASSETS, type ModelAsset } from "./assets";
import { Forest, MAX_TREE_COUNT } from "./forest";
import { loadModel } from "./models";
import {
  DEFAULT_PARTICLES_PER_TREE,
  MAX_PARTICLES_PER_TREE,
  MIN_PARTICLES_PER_TREE,
  ScentParticles,
} from "./scent-particles";
import { createScene, resizeScene } from "./scene";

const canvas = requireElement("scene", HTMLCanvasElement);
const modelSelect = requireElement("model", HTMLSelectElement);
const particleSlider = requireElement("particle-count", HTMLInputElement);
const particleValue = requireElement("particle-value", HTMLOutputElement);
const resampleButton = requireElement("resample", HTMLButtonElement);
const forestSlider = requireElement("forest-count", HTMLInputElement);
const forestValue = requireElement("forest-value", HTMLOutputElement);
const visibilityButton = requireElement("tree-visibility", HTMLButtonElement);
const statusLabel = requireElement("status", HTMLParagraphElement);
const renderedParticles = requireElement("rendered-particles", HTMLElement);
const attribution = requireElement("attribution", HTMLParagraphElement);

const numberFormat = new Intl.NumberFormat("de-DE");
const context = createScene(canvas);
const particles = new ScentParticles(context.pixelRatio, MAX_TREE_COUNT);
const clock = new Clock();
let currentForest: Forest | undefined;
let particlesPerTree = DEFAULT_PARTICLES_PER_TREE;
let treeCount = 1;
let treesVisible = true;
let loadRequest = 0;

context.scene.add(particles.object);
configureControls();
bindEvents();
void switchModel(MODEL_ASSETS[0]!);
window.requestAnimationFrame(renderFrame);

function renderFrame(): void {
  particles.setTime(clock.getElapsedTime());
  context.controls.update();
  context.renderer.render(context.scene, context.camera);
  window.requestAnimationFrame(renderFrame);
}

async function switchModel(asset: ModelAsset): Promise<void> {
  const request = ++loadRequest;
  statusLabel.textContent = `${asset.title} wird geladen …`;
  try {
    const forest = new Forest(await loadModel(asset));
    if (request !== loadRequest) return forest.dispose();
    replaceForest(forest);
  } catch (error: unknown) {
    statusLabel.textContent = getErrorMessage(error);
  }
}

function replaceForest(nextForest: Forest): void {
  if (currentForest) {
    context.scene.remove(currentForest.object);
    currentForest.dispose();
  }
  currentForest = nextForest;
  nextForest.setCount(treeCount);
  nextForest.setVisible(treesVisible);
  context.scene.add(nextForest.object);
  resampleParticles();
  showAttribution(nextForest.asset);
  statusLabel.textContent = "Kontinuierlicher Wind · Lebensdauer 4–8 Sekunden";
}

function configureControls(): void {
  populateModelSelect();
  particleSlider.min = String(MIN_PARTICLES_PER_TREE);
  particleSlider.max = String(MAX_PARTICLES_PER_TREE);
  particleSlider.step = "100";
  particleSlider.value = String(DEFAULT_PARTICLES_PER_TREE);
  forestSlider.min = "1";
  forestSlider.max = String(MAX_TREE_COUNT);
  updateParticlesPerTree(DEFAULT_PARTICLES_PER_TREE);
  updateRenderedCount();
  updateForestCount(treeCount);
  updateVisibilityButton();
}

function bindEvents(): void {
  modelSelect.addEventListener("change", onModelChange);
  particleSlider.addEventListener("input", onParticlesPerTreeInput);
  particleSlider.addEventListener("change", resampleParticles);
  resampleButton.addEventListener("click", resampleParticles);
  forestSlider.addEventListener("input", onForestCountInput);
  forestSlider.addEventListener("change", resampleParticles);
  visibilityButton.addEventListener("click", toggleTrees);
  window.addEventListener("resize", onResize);
}

function onModelChange(): void {
  const asset = MODEL_ASSETS.find(({ id }) => id === modelSelect.value);
  if (asset) void switchModel(asset);
}

function onParticlesPerTreeInput(): void {
  const count = readRangeValue(particleSlider, MIN_PARTICLES_PER_TREE, MAX_PARTICLES_PER_TREE);
  updateParticlesPerTree(count);
}

function onForestCountInput(): void {
  updateForestCount(readRangeValue(forestSlider, 1, MAX_TREE_COUNT));
}

function updateParticlesPerTree(count: number): void {
  particlesPerTree = count;
  particleValue.value = numberFormat.format(particlesPerTree);
}

function updateForestCount(count: number): void {
  treeCount = count;
  forestValue.value = numberFormat.format(treeCount);
  currentForest?.setCount(treeCount);
}

function resampleParticles(): void {
  if (!currentForest) return;
  particles.sample(currentForest.surface, currentForest.getActivePlacements(), particlesPerTree);
  updateRenderedCount();
}

function updateRenderedCount(): void {
  renderedParticles.textContent = numberFormat.format(particles.getCount());
}

function toggleTrees(): void {
  treesVisible = !treesVisible;
  currentForest?.setVisible(treesVisible);
  updateVisibilityButton();
}

function updateVisibilityButton(): void {
  visibilityButton.textContent = treesVisible ? "Bäume ausblenden" : "Bäume einblenden";
  visibilityButton.setAttribute("aria-pressed", String(!treesVisible));
}

function onResize(): void {
  resizeScene(context.camera, context.renderer);
  particles.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
}

function populateModelSelect(): void {
  for (const asset of MODEL_ASSETS) {
    const option = document.createElement("option");
    option.value = asset.id;
    option.textContent = asset.title;
    modelSelect.append(option);
  }
}

function showAttribution(asset: ModelAsset): void {
  const link = document.createElement("a");
  link.href = asset.sourceUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = asset.attribution;
  attribution.replaceChildren(link);
}

function readRangeValue(input: HTMLInputElement, minimum: number, maximum: number): number {
  const value = Number(input.value);
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.floor(value)));
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? `Fehler: ${error.message}` : "Das Modell konnte nicht geladen werden.";
}

function requireElement<T extends Element>(id: string, constructor: { new (): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`#${id} fehlt oder hat den falschen Typ.`);
  return element;
}
