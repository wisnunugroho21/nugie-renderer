import type { World } from '../ecs/World';
import { Quat } from '../math/Quat';

/** Mouse orbit/zoom controller that drives a camera ENTITY's transform (the ECS stays authoritative). */
export class OrbitController {
  yaw = 0.6;
  pitch = 0.4;
  distance = 8;
  target = new Float32Array([0, 0, 0]);
  /** Auto-rotate speed (rad/s) while idle. */
  autoRotate = 0;
  private dragging = false;
  private qy = Quat.create();
  private qx = Quat.create();
  private q = Quat.create();

  /** Listen for drag (orbit) and wheel (zoom) input on `canvas`. */
  constructor(canvas: HTMLElement) {
    canvas.addEventListener('pointerdown', (e) => { this.dragging = true; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointerup', () => { this.dragging = false; });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw -= e.movementX * 0.005;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + e.movementY * 0.005));
    });
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); this.distance = Math.max(0.5, this.distance * Math.exp(e.deltaY * 0.001)); }, { passive: false });
  }

  /** Place and orient the camera entity on the orbit sphere around `target` (call once per frame); auto-rotates while not dragging. */
  update(world: World, cameraIndex: number, dt: number): void {
    if (!this.dragging) this.yaw += this.autoRotate * dt;
    const cp = Math.cos(this.pitch);
    world.transforms.setPosition(cameraIndex,
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw));
    Quat.fromAxisAngle(this.qy, 0, 1, 0, this.yaw);
    Quat.fromAxisAngle(this.qx, 1, 0, 0, -this.pitch);
    Quat.multiply(this.q, this.qy, this.qx);
    world.transforms.setRotation(cameraIndex, this.q[0], this.q[1], this.q[2], this.q[3]);
  }
}
