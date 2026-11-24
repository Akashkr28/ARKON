import { create } from 'zustand';

// Purely presentational HUD state (which tab is open). Remembered per browser.
const TAB_KEY = 'holocad.hudTab';
const TABS = ['parts', 'specs', 'library', 'display'];

function storedTab() {
  try {
    const tab = localStorage.getItem(TAB_KEY);
    return TABS.includes(tab) ? tab : 'parts';
  } catch {
    return 'parts';
  }
}

export const useUiStore = create(() => ({
  hudTab: typeof window === 'undefined' ? 'parts' : storedTab(),
  grid: false, // ruler grid (G)
  workspace: 'view', // 'view' (open models) | 'design' (make a part) | 'assemble' (put parts together)
}));

export function setWorkspace(workspace) {
  useUiStore.setState({ workspace });
}

export function toggleGrid() {
  useUiStore.setState({ grid: !useUiStore.getState().grid });
}

export function setHudTab(tab) {
  if (!TABS.includes(tab)) return;
  useUiStore.setState({ hudTab: tab });
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // Not remembered; fine.
  }
}

export function toggleSpecsTab() {
  setHudTab(useUiStore.getState().hudTab === 'specs' ? 'parts' : 'specs');
}
