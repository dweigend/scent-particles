# Duftschatten MVP

Ein bewusst kleiner Three.js-Prototyp: Bis zu 5.000 Duftpartikel je Baum entstehen kontinuierlich auf beliebigen statischen Mesh-Oberflächen und folgen anschließend einem gemeinsamen Windstrom. Ein einfacher Waldmodus verteilt bis zu 30 Instanzen deterministisch auf der Landschaft.

## Start

```bash
bun install
bun run dev
```

## Technischer Umfang

- Three.js mit `GLTFLoader` und dem offiziellen `MeshSurfaceSampler`
- ein `THREE.Points`-Drawcall für alle Partikel
- kontinuierliche Lebensdauer von vier bis acht Sekunden im GPU-Shader
- eine Sekunde Oberflächenhaftung vor der Ablösung
- ein langsames kohärentes Windfeld statt zufälliger Einzelbewegungen
- zufällige Varianz innerhalb einer vollständig grünen Farbpalette
- `InstancedMesh`-Wald mit einmalig erzeugten, stabilen Zufallspositionen
- bis zu 150.000 Partikel für bewusste Belastungstests
- keine Physics-Library, kein WebXR, kein Post-Processing
- begrenzte Pixeldichte und keine Schatten für mobile GPU-Budgets

Die drei Beispielmodelle stammen von Poly Pizza. Details stehen in [`public/models/ATTRIBUTION.md`](public/models/ATTRIBUTION.md).
