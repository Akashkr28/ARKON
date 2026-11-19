import { useEffect, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { modelFailed } from '../actions/viewerActions';

const loader = new GLTFLoader();
const cache = new Map(); // url -> Promise<gltf>

function readableLoadError(url, error) {
  const message = error?.message ?? String(error);
  // Dev servers answer a missing file with index.html, which then fails JSON parsing.
  if (message.includes('<!doctype') || message.includes('<!DOCTYPE') || /\b404\b/.test(message)) {
    return `File not found: ${url}`;
  }
  return `${url}: ${message}`;
}

function loadOnce(url) {
  if (!cache.has(url)) {
    const promise = loader.loadAsync(url);
    promise.catch(() => cache.delete(url)); // let a retry try again
    cache.set(url, promise);
  }
  return cache.get(url);
}

// drei's useGLTF throws some load errors outside React's reach, so we load here
// and report failures through the store instead.
export function useModelFile(url) {
  const [gltf, setGltf] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setGltf(null);
    loadOnce(url)
      .then((result) => !cancelled && setGltf(result))
      .catch((error) => !cancelled && modelFailed(readableLoadError(url, error)));
    return () => {
      cancelled = true;
    };
  }, [url]);

  return gltf;
}
