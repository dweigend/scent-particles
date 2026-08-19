# Duftschatten MVP

Ein bewusst kleiner Three.js-Prototyp: Bis zu 5.000 Duftpartikel je Objekt entstehen kontinuierlich auf statischen Bäumen und einer frei einstellbaren Anzahl bewegter Tiere. Baumpartikel haften zunächst an der Oberfläche, Tierpartikel werden sofort freigesetzt. Anschließend folgen alle demselben Windstrom. Ein einfacher Waldmodus verteilt bis zu 30 Bauminstanzen deterministisch auf der Landschaft.

## Start

```bash
bun install
bun run dev
```

## Technischer Umfang

- Three.js mit `GLTFLoader` und dem offiziellen `MeshSurfaceSampler`
- ein `THREE.Points`-Drawcall für alle Partikel
- kontinuierliche Lebensdauer von vier bis acht Sekunden im GPU-Shader
- sofort abgelöste braune Tierpartikel und eine Sekunde haftende grüne Baumpartikel
- einheitliche Zahlenbereiche für Haftzeit, Lebensdauer, Größe und Farbe je Objektgruppe
- ein bis zehn skelettanimierte Tiere auf prozedural erzeugten Routen
- universelle Kreis-Fußabdrücke für statische und bewegte Bodenobjekte
- gebackene gegenseitige Abstandsprüfung ohne Physics- oder Steering-Loop
- ein kleiner statischer Route-Atlas für Tierinstanzen und die Geburtsorte ihrer Partikel
- ein langsames kohärentes Windfeld statt zufälliger Einzelbewegungen
- zufällige Farbvarianz innerhalb der jeweiligen Objektgruppe
- `InstancedMesh`-Wald mit einmalig erzeugten, stabilen Zufallspositionen
- geteilte Tier-Geometrien und -Materialien; unabhängige Skelette via `SkeletonUtils.clone()`
- bis zu 200.000 Partikel für bewusste Belastungstests
- keine Physics-Library, kein WebXR, kein Post-Processing
- begrenzte Pixeldichte und keine Schatten für mobile GPU-Budgets

Die vier Beispielmodelle stammen von Poly Pizza. Details stehen in [`public/models/ATTRIBUTION.md`](public/models/ATTRIBUTION.md).
