// "Take a picture of the view" for exports, without the exporter touching three.js.
let active = null;

export function registerSnapshot(take) {
  active = take;
  return () => {
    if (active === take) active = null;
  };
}

// → { dataUrl (JPEG), width, height } or null when no scene is up.
export function takeSnapshot(background = '#03131c') {
  return active ? active(background) : null;
}
