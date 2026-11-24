import { draggedValues, lockedReason } from '../cad/handles';
import { handleAt, handlePosition } from '../scene/handleQueries';
import { useDesignStore } from '../store/designStore';
import { applyHandleValues, beginDesignGesture, endDesignGesture, selectFeature } from './designActions';
import { formatSpecLength } from '../units';
import { useViewerStore } from '../store/viewerStore';
import { useUiStore } from '../store/uiStore';
import { beginComponentDrag, endComponentDrag, hoverComponent, isDraggingComponent, moveComponentDrag } from './componentDrag';

// One drag of a design handle, from mouse or pinch alike: begin where it was grabbed,
// move with the pointer, end on release. The whole drag is one undo step.
// In ASSEMBLE the same calls drag whole parts instead (actions/componentDrag.js).

let drag = null; // { handle, start }

const set = (partial) => useDesignStore.setState(partial);

function labelFor(handle, values) {
  const unit = useViewerStore.getState().lengthUnit;
  if (handle.kind === 'plane') return `X ${formatSpecLength(values.x, unit)} · Y ${formatSpecLength(values.y, unit)}`;
  const [key] = handle.keys;
  return `${handle.label} ${formatSpecLength(values[key], unit)}`;
}

const assembling = () => useUiStore.getState().workspace === 'assemble';

export function hoverHandle(screenX, screenY) {
  if (assembling()) return hoverComponent(screenX, screenY);
  const handle = handleAt(screenX, screenY);
  if (useDesignStore.getState().hoverHandleId !== (handle?.id ?? null)) set({ hoverHandleId: handle?.id ?? null });
  return handle;
}

// → true when a handle was grabbed (the caller then doesn't rotate or pick)
export function beginHandleDrag(screenX, screenY) {
  if (assembling()) return beginComponentDrag(screenX, screenY);
  const handle = handleAt(screenX, screenY);
  if (!handle) return false;
  selectFeature(handle.featureId);
  const reason = lockedReason(handle);
  if (reason) {
    set({ drag: { handleId: handle.id, text: `${handle.label}: ${reason}`, locked: true } });
    drag = { handle, start: null };
    return true;
  }
  const start = handlePosition(handle, screenX, screenY);
  if (start === null) return false;
  drag = { handle, start };
  beginDesignGesture(handle.id, `Drag ${handle.label}`);
  set({ drag: { handleId: handle.id, text: labelFor(handle, handle.values) } });
  return true;
}

export function moveHandleDrag(screenX, screenY, { fine = false } = {}) {
  if (isDraggingComponent()) {
    moveComponentDrag(screenX, screenY, { fine });
    return;
  }
  if (!drag?.start) return;
  const now = handlePosition(drag.handle, screenX, screenY);
  if (now === null) return;
  const moved = drag.handle.kind === 'axis' ? now - drag.start : [now[0] - drag.start[0], now[1] - drag.start[1]];
  const values = draggedValues(drag.handle, moved, { fine });
  applyHandleValues(drag.handle, values);
  set({ drag: { handleId: drag.handle.id, text: labelFor(drag.handle, values) } });
}

// → whether something actually moved (an assembly click that didn't drag still selects)
export function endHandleDrag() {
  if (isDraggingComponent()) return endComponentDrag();
  if (!drag) return false;
  drag = null;
  endDesignGesture();
  set({ drag: null });
  return true;
}

export const isDraggingHandle = () => drag !== null || isDraggingComponent();
