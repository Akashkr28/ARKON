import { useHandStore } from '../store/handStore';
import { useUiStore } from '../store/uiStore';
import { hoverHandle } from '../actions/handleDrag';
import { HUD_SELECTOR, clickAt, doubleClickAt } from './pointer';

// The page side of the hand cursor: what's under a hand, and doing to it what a mouse
// would. The gesture engine decides *when* (an air tap, a pinch-drag); this decides
// *what* — press a button, open a dropdown, drag a slider, scroll a panel, or click the
// scene exactly as a mouse click would (pointer.js clickAt).

export { clickAt, doubleClickAt };

const INTERACTIVE = 'button, select, input, textarea, label, a[href], summary, [role="button"]';

// → { element, interactive } under a screen point when it's part of the HUD, else null.
export function hudTargetAt(x, y) {
  if (typeof document === 'undefined') return null;
  const element = document.elementFromPoint(x, y);
  if (!element?.closest?.(HUD_SELECTOR)) return null;
  return { element, interactive: element.closest(INTERACTIVE) };
}

// --- Hover --------------------------------------------------------------------------

let hovered = null;

// Outline what a tap would press, so you can see where you're aiming.
export function setHandHover(x, y) {
  const next = x === null ? null : (hudTargetAt(x, y)?.interactive ?? null);
  if (next !== hovered) {
    hovered?.classList.remove('is-hand-hover');
    next?.classList.add('is-hand-hover');
    hovered = next;
  }
  // Over the scene: design handles and assembly parts light up as under the mouse.
  const { workspace } = useUiStore.getState();
  if (x !== null && !next && workspace !== 'view')
    document.body.classList.toggle('is-handle-hover', Boolean(hoverHandle(x, y)));
}

// --- Pressing -----------------------------------------------------------------------

function flash(element) {
  element.classList.add('is-hand-pressed');
  setTimeout(() => element.classList.remove('is-hand-pressed'), 180);
}

// Sets a form control's value so React sees it (React tracks the native setter).
function setNativeValue(element, value, eventType) {
  const prototype = Object.getPrototypeOf(element);
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, String(value));
  element.dispatchEvent(new Event(eventType, { bubbles: true }));
}

export function isSlider(element) {
  return element?.tagName === 'INPUT' && element.type === 'range';
}

// A range input follows the hand across its width.
export function slideHud(element, x) {
  const rect = element.getBoundingClientRect();
  const t = Math.min(1, Math.max(0, (x - rect.left) / Math.max(rect.width, 1)));
  const min = Number(element.min || 0);
  const max = Number(element.max || 100);
  const step = Number(element.step) || 1;
  const value = Math.round((min + t * (max - min)) / step) * step;
  if (Number(element.value) !== value) setNativeValue(element, value, 'input');
}

function scrollableAncestor(element, axis) {
  for (let node = element; node && node !== document.body; node = node.parentElement) {
    const style = getComputedStyle(node);
    const overflow = axis === 'x' ? style.overflowX : style.overflowY;
    const room = axis === 'x' ? node.scrollWidth > node.clientWidth : node.scrollHeight > node.clientHeight;
    if ((overflow === 'auto' || overflow === 'scroll') && room) return node;
  }
  return null;
}

// Pinch-drag on a panel scrolls it like a finger on a phone, either way it can go.
export function scrollHud(element, dx, dy) {
  const across = dx && scrollableAncestor(element, 'x');
  if (across) across.scrollLeft -= dx;
  const down = dy && scrollableAncestor(element, 'y');
  if (down) down.scrollTop -= dy;
}

// An air tap on the HUD at x, y: press what's there.
export function pressHud(target, x, y) {
  const { element, interactive } = target;
  const picker = useHandStore.getState().picker;
  if (picker && !element.closest('.gesture-picker')) {
    closeGesturePicker();
    return;
  }
  if (!interactive || interactive.disabled) return;
  flash(interactive);
  if (interactive.tagName === 'SELECT') return openGesturePicker(interactive, x, y);
  if (isSlider(interactive)) return slideHud(interactive, x);
  if (
    interactive.tagName === 'TEXTAREA' ||
    (interactive.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(interactive.type))
  ) {
    interactive.focus(); // typing still needs the keyboard
    interactive.select?.();
    return;
  }
  interactive.click();
}

// --- Dropdowns ----------------------------------------------------------------------
// A native <select> can't be opened from script, so a tap shows its options as big
// buttons instead (hud/GesturePicker.jsx); tapping one chooses it.

let pickerSelect = null;

export function openGesturePicker(select, x, y) {
  pickerSelect = select;
  const label = select.getAttribute('aria-label') ?? select.title ?? '';
  const options = [...select.options]
    .filter((option) => !option.hidden)
    .map((option) => ({
      value: option.value,
      label: option.textContent,
      disabled: option.disabled,
      selected: option.selected && option.value !== '',
    }));
  useHandStore.setState({ picker: { x, y, label, options } });
}

export function chooseGesturePicker(value) {
  const select = pickerSelect;
  closeGesturePicker();
  if (select?.isConnected) setNativeValue(select, value, 'change');
}

// → whether a picker was open (Esc closes it before anything else)
export function closeGesturePicker() {
  pickerSelect = null;
  if (!useHandStore.getState().picker) return false;
  useHandStore.setState({ picker: null });
  return true;
}
