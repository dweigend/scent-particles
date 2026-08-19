/**
 * Starts the demo, coordinates object groups, and runs the render loop.
 * Reusable loading, movement, settings, and particle logic live in the flat lib directory.
 */

import "./style.css";
import { Clock } from "three";
import { AnimalGroup } from "./animal-group";
import { loadModel } from "./lib/model-loader";
import { ScentParticleSystem, type ScentSourceSet } from "./lib/scent-particle-system";
import {
  ANIMAL_GROUP_SETTINGS,
  getMaximumParticleCount,
  OBJECT_GROUP_SETTINGS,
  SCENT_SYSTEM_SETTINGS,
  TREE_GROUP_SETTINGS,
  type ModelSettings,
  type ObjectGroupSettings,
} from "./lib/settings";
import { createScene, resizeScene } from "./scene";
import { TreeGroup } from "./tree-group";
import { createDemoUi } from "./ui";

type ObjectGroupState = {
  count: number;
  particlesPerObject: number;
  visible: boolean;
};

const groupStates = new Map(
  OBJECT_GROUP_SETTINGS.map((settings) => [settings.id, createInitialState(settings)]),
);
const ui = createDemoUi(OBJECT_GROUP_SETTINGS, {
  onModelChange,
  onCountChange,
  onParticleCountChange,
  onVisibilityChange,
  onResample: resampleScentParticles,
});
const sceneContext = createScene(ui.canvas, SCENT_SYSTEM_SETTINGS.maximumPixelRatio);
const scentParticleSystem = new ScentParticleSystem({
  particleCapacity: getMaximumParticleCount(OBJECT_GROUP_SETTINGS),
  pixelRatio: sceneContext.pixelRatio,
  wind: SCENT_SYSTEM_SETTINGS,
});
const clock = new Clock();

let treeGroup: TreeGroup | undefined;
let animalGroup: AnimalGroup | undefined;
let treeLoadRequestId = 0;
let animalLoadRequestId = 0;
let animationFrameId = 0;

sceneContext.scene.add(scentParticleSystem.sceneObject);
void switchTreeModel(TREE_GROUP_SETTINGS.models[0]!);
void switchAnimalModel(ANIMAL_GROUP_SETTINGS.models[0]!);
window.addEventListener("resize", onResize);
window.addEventListener("pagehide", dispose, { once: true });
animationFrameId = window.requestAnimationFrame(renderFrame);

function renderFrame(): void {
  const deltaSeconds = clock.getDelta();
  const elapsedSeconds = clock.elapsedTime;
  animalGroup?.update(elapsedSeconds, deltaSeconds);
  scentParticleSystem.setTime(elapsedSeconds);
  sceneContext.controls.update();
  sceneContext.renderer.render(sceneContext.scene, sceneContext.camera);
  animationFrameId = window.requestAnimationFrame(renderFrame);
}

async function switchTreeModel(model: ModelSettings): Promise<void> {
  const requestId = ++treeLoadRequestId;
  ui.setStatus(`${model.title} wird geladen …`);
  try {
    const nextGroup = new TreeGroup(await loadModel(model), TREE_GROUP_SETTINGS);
    if (requestId !== treeLoadRequestId) return nextGroup.dispose();
    replaceTreeGroup(nextGroup);
  } catch (error) {
    console.error("Failed to load tree group.", error);
    ui.setStatus("Bäume konnten nicht geladen werden.");
  }
}

async function switchAnimalModel(model: ModelSettings): Promise<void> {
  const requestId = ++animalLoadRequestId;
  try {
    const nextGroup = new AnimalGroup({
      loadedModel: await loadModel(model),
      settings: ANIMAL_GROUP_SETTINGS,
      footprints: treeGroup?.getGroundFootprints() ?? [],
      initialCount: getState(ANIMAL_GROUP_SETTINGS).count,
    });
    if (requestId !== animalLoadRequestId) return nextGroup.dispose();
    replaceAnimalGroup(nextGroup);
  } catch (error) {
    console.error("Failed to load animal group.", error);
    ui.setStatus("Tiere konnten nicht geladen werden.");
  }
}

function replaceTreeGroup(nextGroup: TreeGroup): void {
  if (treeGroup) {
    sceneContext.scene.remove(treeGroup.sceneObject);
    treeGroup.dispose();
  }
  treeGroup = nextGroup;
  nextGroup.setVisible(getState(TREE_GROUP_SETTINGS).visible);
  sceneContext.scene.add(nextGroup.sceneObject);
  applyPopulationState();
  updateAttributions();
}

function replaceAnimalGroup(nextGroup: AnimalGroup): void {
  if (animalGroup) {
    sceneContext.scene.remove(animalGroup.sceneObject);
    animalGroup.dispose();
  }
  animalGroup = nextGroup;
  nextGroup.setVisible(getState(ANIMAL_GROUP_SETTINGS).visible);
  sceneContext.scene.add(nextGroup.sceneObject);
  resampleScentParticles();
  updateAttributions();
  updateStatus();
}

function onModelChange(groupId: string, modelId: string): void {
  const settings = getSettings(groupId);
  const model = settings?.models.find(({ id }) => id === modelId);
  if (!settings || !model) return;
  if (settings.behavior.kind === "static") void switchTreeModel(model);
  else void switchAnimalModel(model);
}

function onCountChange(groupId: string, count: number): void {
  const settings = getSettings(groupId);
  if (!settings) return;
  getState(settings).count = count;
  applyPopulationState();
}

function onParticleCountChange(groupId: string, count: number): void {
  const settings = getSettings(groupId);
  if (!settings) return;
  getState(settings).particlesPerObject = count;
  resampleScentParticles();
}

function onVisibilityChange(groupId: string, visible: boolean): void {
  const settings = getSettings(groupId);
  if (!settings) return;
  getState(settings).visible = visible;
  if (settings.behavior.kind === "static") treeGroup?.setVisible(visible);
  else animalGroup?.setVisible(visible);
}

function applyPopulationState(): void {
  treeGroup?.setCount(getState(TREE_GROUP_SETTINGS).count);
  animalGroup?.setCount(
    getState(ANIMAL_GROUP_SETTINGS).count,
    treeGroup?.getGroundFootprints() ?? [],
  );
  resampleScentParticles();
  updateStatus();
}

function resampleScentParticles(): void {
  scentParticleSystem.resample(createScentSourceSet());
  ui.setRenderedParticleCount(scentParticleSystem.getRenderedParticleCount());
}

function createScentSourceSet(): ScentSourceSet {
  const treeState = getState(TREE_GROUP_SETTINGS);
  const animalState = getState(ANIMAL_GROUP_SETTINGS);
  return {
    staticSources: treeGroup
      ? [treeGroup.getScentSource(treeState.particlesPerObject)]
      : [],
    routedSources: animalGroup
      ? {
          routeAtlas: animalGroup.getRouteAtlas(),
          sources: [animalGroup.getScentSource(animalState.particlesPerObject)],
        }
      : undefined,
  };
}

function updateAttributions(): void {
  const models = [treeGroup?.modelSettings, animalGroup?.modelSettings].filter(
    (model): model is ModelSettings => model !== undefined,
  );
  ui.setAttributions(models);
}

function updateStatus(): void {
  const animalCount = animalGroup ? getState(ANIMAL_GROUP_SETTINGS).count : 0;
  ui.setStatus(`${animalCount} animierte Tiere · Wind · Lebensdauer 4–8 Sekunden`);
}

function onResize(): void {
  const pixelRatio = Math.min(
    window.devicePixelRatio,
    SCENT_SYSTEM_SETTINGS.maximumPixelRatio,
  );
  sceneContext.renderer.setPixelRatio(pixelRatio);
  resizeScene(sceneContext.camera, sceneContext.renderer);
  scentParticleSystem.setPixelRatio(pixelRatio);
}

function dispose(): void {
  window.cancelAnimationFrame(animationFrameId);
  window.removeEventListener("resize", onResize);
  treeGroup?.dispose();
  animalGroup?.dispose();
  scentParticleSystem.dispose();
  sceneContext.controls.dispose();
  sceneContext.renderer.dispose();
}

function createInitialState(settings: ObjectGroupSettings): ObjectGroupState {
  return {
    count: settings.count.initial,
    particlesPerObject: settings.scent.particlesPerObject.initial,
    visible: true,
  };
}

function getSettings(groupId: string): ObjectGroupSettings | undefined {
  return OBJECT_GROUP_SETTINGS.find(({ id }) => id === groupId);
}

function getState(settings: ObjectGroupSettings): ObjectGroupState {
  return groupStates.get(settings.id)!;
}
