/**
 * Declares the small, licensed 3D asset catalogue used by the MVP.
 * Asset metadata is static and deliberately separate from runtime loading.
 */

export type ModelAsset = Readonly<{
  id: string;
  title: string;
  modelPath: string;
  targetHeight: number;
  sourcePageUrl: string;
  attribution: string;
}>;

export const TREE_ASSETS: readonly ModelAsset[] = [
  {
    id: "tree",
    title: "Tree",
    modelPath: "/models/tree.glb",
    targetHeight: 3.2,
    sourcePageUrl: "https://poly.pizza/m/6pwiq7hSrHr",
    attribution: '"Tree" von Poly by Google · CC-BY 3.0',
  },
  {
    id: "pine-tree",
    title: "Pine Tree",
    modelPath: "/models/pine-tree.glb",
    targetHeight: 3.2,
    sourcePageUrl: "https://poly.pizza/m/2Qo-fmVKuSG",
    attribution: '"Pine Tree" von Danni Bittman · CC-BY 3.0',
  },
  {
    id: "fall-tree",
    title: "Fall Tree",
    modelPath: "/models/fall-tree.glb",
    targetHeight: 3.2,
    sourcePageUrl: "https://poly.pizza/m/4GYen9Xm3Kj",
    attribution: '"Fall Tree" von Danni Bittman · CC-BY 3.0',
  },
];

export const ANIMAL_ASSET: ModelAsset = {
  id: "deer",
  title: "Deer",
  modelPath: "/models/deer.glb",
  targetHeight: 1.35,
  sourcePageUrl: "https://poly.pizza/m/T6Cs7tmMHJ",
  attribution: '"Deer" von Quaternius · CC0 1.0',
};
