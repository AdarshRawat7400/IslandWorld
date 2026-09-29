// Keep the walking view's pitch local to the camera, independent of heading.
// Three.js's default XYZ order makes vertical look collapse near east/west.
export function orientFirstPersonCamera(camera, yaw, pitch) {
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
}
