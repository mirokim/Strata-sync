/**
 * Imperative callbacks registered by Graph3D.
 * Allows sibling components (e.g. PhysicsControls) to trigger camera operations
 * without prop drilling or complex state management.
 */
export const graphCallbacks = {
  resetCamera: null as (() => void) | null,
}
