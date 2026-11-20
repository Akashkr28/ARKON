# Integration hooks

Every feature below plugs into `src/actions/viewerActions.js` rather than the scene or gesture code.

- **Hand occlusion** — `src/scene/Scene.jsx`, `TODO(depth)`. Planned approach: depth-only
  (`colorWrite: false`) capsules along each finger bone, the palm and the forearm, placed at the
  hand's estimated depth, so the hologram is hidden behind your hand. Much cheaper than running a
  depth-estimation model such as Depth Anything.
- **Backend upload + STEP → GLB** — done in Phase 2: `actions/libraryActions.js` (upload, poll,
  retry, delete) and `models/catalog.js` (samples + ready uploads). `loadModel(id)` takes either id.
- **AI assistant** — `onAction` in `viewerActions.js`, `TODO(ai)`. Each exported action is a tool:
  `explode({ factor })`, `assemble()`, `selectPart({ partId })`, `scaleTo({ scale })`, … Part IDs
  and names come from `useViewerStore.getState().parts`.
- **Multi-user sessions (Socket.IO)** — `onAction` in `viewerActions.js`, `TODO(collab)`. Broadcast
  `(name, args)` and replay incoming events by calling the action of the same name.
