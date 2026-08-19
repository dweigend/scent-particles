/**
 * Builds the small demo UI from object-group settings and reports user intent via callbacks.
 * Scene state, loading, particles, and rendering deliberately stay outside this module.
 */

import type { ModelSettings, NumberSetting, ObjectGroupSettings } from "./lib/settings";
import { clampNumberSetting } from "./lib/settings";

type DemoUiCallbacks = Readonly<{
  onModelChange: (groupId: string, modelId: string) => void;
  onCountChange: (groupId: string, count: number) => void;
  onParticleCountChange: (groupId: string, count: number) => void;
  onVisibilityChange: (groupId: string, visible: boolean) => void;
  onResample: () => void;
}>;

type DemoUi = Readonly<{
  canvas: HTMLCanvasElement;
  setStatus: (text: string) => void;
  setRenderedParticleCount: (count: number) => void;
  setAttributions: (models: readonly ModelSettings[]) => void;
}>;

const numberFormat = new Intl.NumberFormat("de-DE");

export function createDemoUi(
  groups: readonly ObjectGroupSettings[],
  callbacks: DemoUiCallbacks,
): DemoUi {
  const controls = requireElement("controls", HTMLElement);
  controls.replaceChildren(...groups.map((group) => createGroupControls(group, callbacks)));
  requireElement("resample", HTMLButtonElement).addEventListener("click", callbacks.onResample);

  const status = requireElement("status", HTMLParagraphElement);
  const renderedParticleCount = requireElement("rendered-particle-count", HTMLElement);
  const attribution = requireElement("attribution", HTMLParagraphElement);
  return {
    canvas: requireElement("scene", HTMLCanvasElement),
    setStatus: (text) => { status.textContent = text; },
    setRenderedParticleCount: (count) => {
      renderedParticleCount.textContent = numberFormat.format(count);
    },
    setAttributions: (models) => showAttributions(attribution, models),
  };
}

function createGroupControls(
  group: ObjectGroupSettings,
  callbacks: DemoUiCallbacks,
): HTMLElement {
  const section = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = group.title;
  section.append(heading);

  if (group.models.length > 1) section.append(createModelControl(group, callbacks.onModelChange));
  section.append(
    createNumberControl("Anzahl", group.count, (count) => callbacks.onCountChange(group.id, count)),
    createNumberControl("Partikel je Objekt", group.scent.particlesPerObject, (count) =>
      callbacks.onParticleCountChange(group.id, count),
    ),
    createVisibilityButton(group, callbacks.onVisibilityChange),
  );
  return section;
}

function createModelControl(
  group: ObjectGroupSettings,
  onChange: DemoUiCallbacks["onModelChange"],
): HTMLElement {
  const label = document.createElement("label");
  const select = document.createElement("select");
  label.textContent = "3D-Modell";
  for (const model of group.models) select.add(new Option(model.title, model.id));
  select.addEventListener("change", () => onChange(group.id, select.value));
  label.append(select);
  return label;
}

function createNumberControl(
  title: string,
  setting: NumberSetting,
  onChange: (value: number) => void,
): HTMLElement {
  const label = document.createElement("label");
  const titleRow = document.createElement("span");
  const output = document.createElement("output");
  const input = document.createElement("input");
  titleRow.textContent = title;
  input.type = "range";
  input.min = String(setting.minimum);
  input.max = String(setting.maximum);
  input.step = String(setting.step);
  input.value = String(setting.initial);
  updateRangeOutput(output, setting.initial);
  input.addEventListener("input", () => updateRangeOutput(output, Number(input.value)));
  input.addEventListener("change", () => onChange(clampNumberSetting(Number(input.value), setting)));
  label.append(titleRow, output, input);
  return label;
}

function createVisibilityButton(
  group: ObjectGroupSettings,
  onChange: DemoUiCallbacks["onVisibilityChange"],
): HTMLButtonElement {
  const button = document.createElement("button");
  let visible = true;
  button.type = "button";
  button.textContent = `${group.title} ausblenden`;
  button.addEventListener("click", () => {
    visible = !visible;
    button.textContent = `${group.title} ${visible ? "ausblenden" : "einblenden"}`;
    button.setAttribute("aria-pressed", String(!visible));
    onChange(group.id, visible);
  });
  return button;
}

function updateRangeOutput(output: HTMLOutputElement, value: number): void {
  output.value = numberFormat.format(value);
}

function showAttributions(
  container: HTMLParagraphElement,
  models: readonly ModelSettings[],
): void {
  const nodes = models.flatMap<Node>((model, index) => [
    ...(index === 0 ? [] : [document.createTextNode(" · ")]),
    createAttributionLink(model),
  ]);
  container.replaceChildren(...nodes);
}

function createAttributionLink(model: ModelSettings): HTMLAnchorElement {
  const link = document.createElement("a");
  link.href = model.sourcePageUrl;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = model.attribution;
  return link;
}

function requireElement<T extends Element>(id: string, elementType: { new (): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof elementType)) throw new Error(`Missing UI element: #${id}.`);
  return element;
}
