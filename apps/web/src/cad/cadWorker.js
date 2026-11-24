// The design engine's home: OpenCASCADE (WebAssembly) runs here, off the main thread, so
// the view stays smooth while a part rebuilds. Loaded the first time the DESIGN
// workspace opens (the kernel is ~23 MB, ~7 MB compressed).
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import * as replicad from 'replicad';
import { assemblyStep, buildPart, describePart } from './buildPart';

const ready = opencascade({ locateFile: () => wasmUrl, print: () => {}, printErr: () => {} }).then((OC) => {
  replicad.setOC(OC);
  self.postMessage({ type: 'ready' });
});

let current = null; // the last part built, for exports

self.onmessage = async ({ data }) => {
  try {
    await ready;
    if (data.type === 'build') {
      const { shape, errors } = buildPart(replicad, data.features);
      // Parts built for an assembly don't replace the one being designed (its export).
      const keep = data.keep !== false;
      if (keep) {
        current?.delete();
        current = shape;
      }
      if (!shape) {
        self.postMessage({ type: 'built', id: data.id, part: null, errors });
        return;
      }
      const part = describePart(replicad, shape);
      if (!keep) shape.delete();
      const transfer = [part.positions.buffer, part.normals.buffer, part.indices.buffer, part.edgeLines.buffer];
      self.postMessage({ type: 'built', id: data.id, part, errors }, transfer);
    } else if (data.type === 'stepAssembly') {
      const { blob, skipped } = assemblyStep(replicad, data.parts);
      self.postMessage({ type: 'step', id: data.id, blob, skipped });
    } else if (data.type === 'step') {
      if (!current) throw new Error('Nothing to export yet');
      self.postMessage({ type: 'step', id: data.id, blob: current.blobSTEP() });
    }
  } catch (error) {
    self.postMessage({ type: 'error', id: data.id, message: error?.message ?? String(error) });
  }
};
