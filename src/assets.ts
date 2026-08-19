/**
 * Declares the small, licensed model catalogue used by the MVP.
 * Asset metadata is static and deliberately separate from runtime loading.
 */

export type ModelAsset = Readonly<{
  id: string;
  title: string;
  path: string;
  sourceUrl: string;
  attribution: string;
}>;

export const MODEL_ASSETS: readonly ModelAsset[] = [
  {
    id: "tree",
    title: "Tree",
    path: "/models/tree.glb",
    sourceUrl: "https://poly.pizza/m/6pwiq7hSrHr",
    attribution: '"Tree" von Poly by Google · CC-BY 3.0',
  },
  {
    id: "pine-tree",
    title: "Pine Tree",
    path: "/models/pine-tree.glb",
    sourceUrl: "https://poly.pizza/m/2Qo-fmVKuSG",
    attribution: '"Pine Tree" von Danni Bittman · CC-BY 3.0',
  },
  {
    id: "fall-tree",
    title: "Fall Tree",
    path: "/models/fall-tree.glb",
    sourceUrl: "https://poly.pizza/m/4GYen9Xm3Kj",
    attribution: '"Fall Tree" von Danni Bittman · CC-BY 3.0',
  },
];
