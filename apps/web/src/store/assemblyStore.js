import { create } from 'zustand';

// The assembly being put together (ASSEMBLE workspace). Written only by
// actions/assemblyActions.js. Maths in cad/assembly.js.
export const useAssemblyStore = create(() => ({
  name: 'Untitled assembly',
  // { id, name, source, position, quaternion }: source is { kind: 'design', design }
  // (a part made in DESIGN, kept with the assembly) or { kind: 'model', modelId }.
  components: [],
  mates: [], // cad/assembly.js createMate
  placements: {}, // componentId -> placement, solved from the above
  content: {}, // componentId -> { status: 'loading' | 'ready' | 'error', error }
  contentVersion: 0, // bumped when a part's geometry arrives, so the scene rebuilds
  selectedComponentId: null,
  tool: null, // null | 'contact' | 'axis': picking faces for a mate
  pick: null, // the first face picked: { componentId, geometry, label, highlight }
  hoverFace: null, // the face under the cursor while picking: same shape
  drag: null, // { componentId, text } while a part is being dragged
  frame: null, // { center, radius }: fixed view framing (see designStore)
  undoLabel: null,
  redoLabel: null,
  saving: null, // null | 'glb' | 'step' | 'library'
  message: null,
}));
