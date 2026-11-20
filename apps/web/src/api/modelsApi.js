// Thin client for the HoloCAD API (apps/api). Vite proxies /api in development.

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function request(path, options = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, options);
  } catch {
    throw new ApiError('The HoloCAD API is not reachable', 0);
  }
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  // The Vite proxy answers 500/502/504 with no JSON body when the API is down.
  if (!res.ok) throw new ApiError(body?.error ?? 'The HoloCAD API is not reachable', res.status);
  return body;
}

export async function listModels() {
  return (await request('/models')).models;
}

export function getModel(id) {
  return request(`/models/${id}`);
}

export function deleteModel(id) {
  return request(`/models/${id}`, { method: 'DELETE' });
}

export function retryModel(id, quality) {
  return request(`/models/${id}/retry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(quality ? { quality } : {}),
  });
}

// XHR rather than fetch: fetch can't report upload progress.
export function uploadModel(file, { quality, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    if (quality) form.append('quality', quality);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/models');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status === 201) resolve(xhr.response);
      else reject(new ApiError(xhr.response?.error ?? `Upload failed (HTTP ${xhr.status})`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError('Upload failed: the HoloCAD API is not reachable', 0));
    xhr.send(form);
  });
}
