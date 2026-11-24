// Talks to the CAD worker. One worker per page, started on first use.

let worker = null;
let nextId = 1;
const pending = new Map(); // id -> { resolve, reject }
let onReady = null;

function start() {
  if (worker) return worker;
  worker = new Worker(new URL('./cadWorker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'ready') {
      onReady?.();
      return;
    }
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.type === 'error') request.reject(new Error(data.message));
    else request.resolve(data);
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'The design engine failed to start');
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  return worker;
}

function send(message) {
  start();
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...message, id });
  });
}

export function whenKernelReady(callback) {
  onReady = callback;
  start();
}

// → { part (mesh + properties) or null, errors }. keep: false builds a part for show (an
// assembly's) without making it the one STEP export saves.
export function buildInWorker(features, { keep = true } = {}) {
  return send({ type: 'build', features, keep });
}

// → { blob (STEP with every part placed, named and coloured), skipped } (cad/buildPart.js
// assemblyStep for the part list)
export async function stepOfAssembly(parts) {
  const { blob, skipped } = await send({ type: 'stepAssembly', parts });
  return { blob, skipped };
}

// → Blob (STEP AP214) of the part last built
export async function stepOfCurrentPart() {
  return (await send({ type: 'step' })).blob;
}
