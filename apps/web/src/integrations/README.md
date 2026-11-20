# Integration hooks (not built in Phase 1)

Every feature below plugs into `src/actions/viewerActions.js` rather than the scene or gesture code.

- **Depth occlusion (Depth Anything)** — `src/scene/Scene.jsx`, `TODO(depth)`. Render a depth mask
  between the video and the model so hands can pass in front of it.
- **Backend upload + STEP → GLB** — done in Phase 2: `actions/libraryActions.js` (upload, poll,
  retry, delete) and `models/catalog.js` (samples + ready uploads). `loadModel(id)` takes either id.
- **AI assistant** — `onAction` in `viewerActions.js`, `TODO(ai)`. Each exported action is a tool:
  `explode({ factor })`, `assemble()`, `selectPart({ partId })`, `scaleTo({ scale })`, … Part IDs
  and names come from `useViewerStore.getState().parts`.
- **Multi-user sessions (Socket.IO)** — `onAction` in `viewerActions.js`, `TODO(collab)`. Broadcast
  `(name, args)` and replay incoming events by calling the action of the same name.
