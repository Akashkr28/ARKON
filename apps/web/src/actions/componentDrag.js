import { dragFrame, dragPosition, mateOf, snapMm, toCadMm } from '../cad/assembly';
import { componentAt, faceAt, rayAt, viewDirection } from '../scene/assemblyQueries';
import { useAssemblyStore } from '../store/assemblyStore';
import {
  beginAssemblyGesture,
  endAssemblyGesture,
  moveComponentTo,
  selectComponent,
  setHoverFace,
  setMateSlide,
} from './assemblyActions';

// Dragging a part of the assembly, from mouse or pinch alike. A free part follows the
// pointer in the plane facing you; a mated part slides only the way its mate lets it
// (across the face it sits on, or along its axis). One drag is one undo step.

const START_PX = 3; // a click that wobbles isn't a drag

let drag = null; // { componentId, name, frame, start, startValue, x, y, moved }

const get = () => useAssemblyStore.getState();
const set = (partial) => useAssemblyStore.setState(partial);

const mm = (v) => `${v.toFixed(1)}`;

function labelFor(kind, value) {
  if (kind === 'free') {
    const [x, y, z] = toCadMm(value);
    return `X ${mm(x)} · Y ${mm(y)} · Z ${mm(z)} mm`;
  }
  if (kind === 'contact') return `Slide ${mm(value[0])}, ${mm(value[1])} mm`;
  return `Slide ${mm(value)} mm along the axis`;
}

// While a mate tool is on, hovering names the face under the cursor; otherwise it says
// whether there's a part to grab. → truthy when there's something under the cursor.
export function hoverComponent(x, y) {
  if (get().tool) {
    const face = faceAt(x, y);
    setHoverFace(face);
    return face;
  }
  return componentAt(x, y);
}

// → true when a part was grabbed (the caller then doesn't turn the view)
export function beginComponentDrag(x, y) {
  if (get().tool) return false; // clicks pick faces
  const hit = componentAt(x, y);
  if (!hit) return false;
  const { components, mates, placements } = get();
  const component = components.find((c) => c.id === hit.componentId);
  if (!component) return false;
  const mate = mateOf(mates, component.id);
  const frame = dragFrame(mate, mate ? placements[mate.target.componentId] : null, hit.point, viewDirection());
  const ray = rayAt(x, y);
  const start = ray && dragPosition(frame, ray);
  if (start === null || start === undefined) return false;
  selectComponent(component.id);
  drag = {
    componentId: component.id,
    name: component.name,
    mateId: mate?.id ?? null,
    frame,
    start,
    startValue: mate ? mate.slide : (placements[component.id] ?? component).position,
    x,
    y,
    moved: false,
  };
  return true;
}

export function moveComponentDrag(x, y, { fine = false } = {}) {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(x - drag.x, y - drag.y) < START_PX) return;
    drag.moved = true;
    beginAssemblyGesture(drag.componentId, `Move ${drag.name}`);
  }
  const ray = rayAt(x, y);
  const now = ray && dragPosition(drag.frame, ray);
  if (now === null || now === undefined) return;
  const { kind } = drag.frame;
  let value;
  if (kind === 'free') {
    // Metres in the assembly frame, snapped to whole (or tenth) millimetres.
    value = drag.startValue.map((v, i) => snapMm((v + now[i] - drag.start[i]) * 1000, fine) / 1000);
    moveComponentTo(drag.componentId, value);
  } else if (kind === 'contact') {
    value = drag.startValue.map((v, i) => snapMm(v + now[i] - drag.start[i], fine));
    setMateSlide(drag.mateId, value);
  } else {
    value = snapMm(drag.startValue + now - drag.start, fine);
    setMateSlide(drag.mateId, value);
  }
  set({ drag: { componentId: drag.componentId, text: `${drag.name} · ${labelFor(kind, value)}` } });
}

// → whether the part actually moved (a click without movement just selects it)
export function endComponentDrag() {
  if (!drag) return false;
  const { moved } = drag;
  drag = null;
  if (moved) endAssemblyGesture();
  set({ drag: null });
  return moved;
}

export const isDraggingComponent = () => drag !== null;
