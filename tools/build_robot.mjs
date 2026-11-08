// Turn Onshape's huge glTF export into a small GLB a Raspberry Pi 3 can spin.
// - drops tiny parts (screws, pins, decals)
// - welds + simplifies each unique part once (error-driven, meshoptimizer)
// - bakes part colours into vertex colours so each group is one draw call
// - groups by subassembly; the big flattened team drivetrain is split into a 3x3 grid of clusters
// - rotates CAD Z-up to glTF Y-up, quantizes and meshopt-compresses
// Usage: node build_robot.mjs <in.gltf> <out.glb> [minPartMm=12] [errorRel=0.01]
import { NodeIO, Document } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const [, , input, output, minMmArg, errArg] = process.argv;
const MIN_PART = Number(minMmArg || 12) / 1000;
const ERR = Number(errArg || 0.01);
const DENSITY = Number(process.argv[6] || 0.08); // triangles per mm^2 of part size
await MeshoptSimplifier.ready;
MeshoptSimplifier.useExperimentalFeatures = true; // for the Prune flag
await MeshoptEncoder.ready;

const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const src = await io.read(input);
const scene = src.getRoot().getDefaultScene() || src.getRoot().listScenes()[0];
const robot = scene.listChildren()[0];

// Z-up (Onshape) -> Y-up (glTF): (x, y, z) -> (x, z, -y)
const toYUp = (x, y, z) => [x, z, -y];
const xform = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];

// Which top-level subassembly each mesh node belongs to
function topOf(node) {
  let n = node;
  while (n.getParentNode() && n.getParentNode() !== robot) n = n.getParentNode();
  return n;
}
const TEAM = /Team robot|Team drivetrain/i;
const nice = (name) => name.replace(/^occurrence of /, '').replace(/^M0 /, '').replace(/ <\d+>$/, '').replace(/ \(your CAD\)/, '');

// Robot centre (Y-up) for drivetrain clustering
const all = [];
robot.traverse((n) => { if (n.getMesh()) all.push(n); });

const simpCache = new Map(); // mesh -> {pos, col, idx}: all face-primitives of a part merged, welded, simplified
function simplified(mesh) {
  if (simpCache.has(mesh)) return simpCache.get(mesh);
  const key = new Map(), pos = [], col = [], idxL = [];
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const prim of mesh.listPrimitives()) {
    const p = prim.getAttribute('POSITION').getArray();
    const c = baseColor(prim);
    const nv = p.length / 3;
    const ia = prim.getIndices() ? prim.getIndices().getArray() : Uint32Array.from({ length: nv }, (_, i) => i);
    const remap = new Uint32Array(nv);
    for (let v = 0; v < nv; v++) {
      const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
      // weld by position (0.01 mm grid); a vertex keeps the colour of the first face that used it
      const k = `${Math.round(x * 1e5)},${Math.round(y * 1e5)},${Math.round(z * 1e5)}`;
      let id = key.get(k);
      if (id === undefined) { id = pos.length / 3; key.set(k, id); pos.push(x, y, z); col.push(...c); }
      remap[v] = id;
      lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)];
      hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)];
    }
    for (let i = 0; i < ia.length; i++) idxL.push(remap[ia[i]]);
  }
  let idx = new Uint32Array(idxL);
  const posF = new Float32Array(pos);
  // triangle budget scales with the part's size, so tiny rollers stay cheap and plates stay crisp
  const sizeMm = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 1000;
  const budget = Math.round(24 + sizeMm * sizeMm * DENSITY);
  if (idx.length / 3 > budget) {
    [idx] = MeshoptSimplifier.simplify(idx, posF, 3, budget * 3, ERR, []);
    if (idx.length / 3 > budget * 1.5) [idx] = MeshoptSimplifier.simplify(idx, posF, 3, budget * 3, 1, ['Prune']);
  }
  // compact
  const used = new Map(), outPos = [], outCol = [];
  const outIdx = new Uint32Array(idx.length);
  for (let i = 0; i < idx.length; i++) {
    let id = used.get(idx[i]);
    if (id === undefined) {
      id = outPos.length / 3; used.set(idx[i], id);
      outPos.push(posF[idx[i] * 3], posF[idx[i] * 3 + 1], posF[idx[i] * 3 + 2]);
      outCol.push(col[idx[i] * 3], col[idx[i] * 3 + 1], col[idx[i] * 3 + 2]);
    }
    outIdx[i] = id;
  }
  const r = { pos: outPos, col: outCol, idx: outIdx };
  simpCache.set(mesh, r);
  return r;
}

function baseColor(prim) {
  const m = prim.getMaterial();
  return m ? m.getBaseColorFactor().slice(0, 3) : [0.6, 0.6, 0.6];
}

// World-space bounds (Y-up) of a node's mesh
function bounds(node) {
  const m = node.getWorldMatrix();
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const prim of node.getMesh().listPrimitives()) {
    const acc = prim.getAttribute('POSITION');
    const lo = acc.getMin([]), hi = acc.getMax([]);
    for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) {
      const w = toYUp(...xform(m, x, y, z));
      for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], w[k]); max[k] = Math.max(max[k], w[k]); }
    }
  }
  return { min, max };
}

let rmin = [Infinity, Infinity, Infinity], rmax = [-Infinity, -Infinity, -Infinity];
const info = all.map((n) => {
  const b = bounds(n);
  for (let k = 0; k < 3; k++) { rmin[k] = Math.min(rmin[k], b.min[k]); rmax[k] = Math.max(rmax[k], b.max[k]); }
  return { n, b };
});
const rc = rmin.map((v, k) => (v + rmax[k]) / 2);
const half = rmax.map((v, k) => (v - rmin[k]) / 2);

const groups = new Map(); // name -> {pos:[], col:[], idx:[]}
let dropped = 0, kept = 0, srcTris = 0;
for (const { n, b } of info) {
  const size = Math.max(...b.max.map((v, k) => v - b.min[k]));
  const name = n.getName() || '';
  const top = topOf(n);
  for (const prim of n.getMesh().listPrimitives()) srcTris += (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount()) / 3;
  if (size < MIN_PART || /^PAINT$/i.test(name)) { dropped++; continue; }
  kept++;
  let g = nice(top.getName() || 'Robot');
  if (TEAM.test(top.getName() || '')) {
    // 3x3 grid in plan view (x, z after Y-up), dead zone in the middle
    const c = b.min.map((v, k) => (v + b.max[k]) / 2);
    const gx = Math.abs(c[0] - rc[0]) > half[0] * 0.35 ? Math.sign(c[0] - rc[0]) : 0;
    const gz = Math.abs(c[2] - rc[2]) > half[2] * 0.35 ? Math.sign(c[2] - rc[2]) : 0;
    g = `Drivetrain ${gx},${gz}`;
  }
  if (!groups.has(g)) groups.set(g, { pos: [], col: [], idx: [] });
  const G = groups.get(g);
  const m = n.getWorldMatrix();
  const s = simplified(n.getMesh());
  const base = G.pos.length / 3;
  for (let v = 0; v < s.pos.length / 3; v++) {
    G.pos.push(...toYUp(...xform(m, s.pos[v * 3], s.pos[v * 3 + 1], s.pos[v * 3 + 2])));
    G.col.push(s.col[v * 3], s.col[v * 3 + 1], s.col[v * 3 + 2]);
  }
  // mirrored instances (negative determinant) flip triangle winding; swap two corners to keep faces outward
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  for (let i = 0; i < s.idx.length; i += 3) {
    if (det < 0) G.idx.push(base + s.idx[i], base + s.idx[i + 2], base + s.idx[i + 1]);
    else G.idx.push(base + s.idx[i], base + s.idx[i + 1], base + s.idx[i + 2]);
  }
}

// Build the output document
const out = new Document();
const buf = out.createBuffer();
const mat = out.createMaterial('robot').setBaseColorFactor([1, 1, 1, 1]).setMetallicFactor(0.25).setRoughnessFactor(0.55);
const root = out.createNode('Robot');
let outTris = 0;
for (const [name, G] of [...groups].sort()) {
  if (!G.idx.length) continue;
  // mirrored instances flip winding: three uses FrontSide, so keep a uniform winding by leaving as-is (DoubleSide set at runtime if needed)
  const prim = out.createPrimitive()
    .setAttribute('POSITION', out.createAccessor().setType('VEC3').setArray(new Float32Array(G.pos)).setBuffer(buf))
    .setAttribute('COLOR_0', out.createAccessor().setType('VEC3').setArray(new Float32Array(G.col)).setBuffer(buf))
    .setIndices(out.createAccessor().setType('SCALAR').setArray(new Uint32Array(G.idx)).setBuffer(buf))
    .setMaterial(mat);
  root.addChild(out.createNode(name).setMesh(out.createMesh(name).addPrimitive(prim)));
  outTris += G.idx.length / 3;
  console.log(`${name.padEnd(28)} ${(G.idx.length / 3).toLocaleString().padStart(9)} tris`);
}
out.createScene('Scene').addChild(root);
await out.transform(quantize({ quantizeColor: 8 }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await io.write(output, out);
console.log(`parts kept ${kept}, dropped ${dropped}; tris ${Math.round(srcTris).toLocaleString()} -> ${outTris.toLocaleString()}; groups ${groups.size}`);
