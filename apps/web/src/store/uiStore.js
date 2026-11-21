import { create } from 'zustand';

// Purely presentational HUD state (which tab is open). Remembered per browser.
const TAB_KEY = 'holocad.hudTab';
const TABS = ['parts', 'library', 'display'];

function storedTab() {
  try {
    const tab = localStorage.getItem(TAB_KEY);
    return TABS.includes(tab) ? tab : 'parts';
  } catch {
    return 'parts';
  }
}

export const useUiStore = create(() => ({ hudTab: typeof window === 'undefined' ? 'parts' : storedTab() }));

export function setHudTab(tab) {
  if (!TABS.includes(tab)) return;
  useUiStore.setState({ hudTab: tab });
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // Not remembered; fine.
  }
}
