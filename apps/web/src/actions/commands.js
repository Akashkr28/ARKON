import * as viewer from './viewerActions';
import { redoDesign, undoDesign } from './designActions';
import { redoAssembly, undoAssembly } from './assemblyActions';
import { useUiStore } from '../store/uiStore';

// Commands that mean different things per workspace, shared by keyboard and gestures.
// In DESIGN, undo steps through the part's edits; in ASSEMBLE, the assembly's.

export function undoHere() {
  const { workspace } = useUiStore.getState();
  return workspace === 'design' ? undoDesign() : workspace === 'assemble' ? undoAssembly() : viewer.undo();
}

export function redoHere() {
  const { workspace } = useUiStore.getState();
  return workspace === 'design' ? redoDesign() : workspace === 'assemble' ? redoAssembly() : viewer.redo();
}
