// Per-object edit state: transform gizmo, duplicate, hide, lock, colour.
//
// Phase 1 of the parity work. PoseMy.Art's model toolbar exposes
// Move/Rotate/Scale/Duplicate/Colour/Show/Lock on the selected *object*, while
// Poseify's existing gizmo only rotates a single *bone*. This module owns the
// object half: which object is selected, what mode its gizmo is in, and the
// Show/Lock/Colour flags that belong with the object rather than the pose.
//
// Deliberately framework-free and Three-only, matching the style of
// PoseController, so it can be unit tested without a Vue runtime.

import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { ObjectState, ObjectTransform } from "./Scene";

/** What a TransformControls gizmo is currently doing to the selected object. */
export type ObjectGizmoMode = "translate" | "rotate" | "scale";

/** Identity transform, matching Scene.ts's zeroed defaults. */
export const IDENTITY_TRANSFORM: ObjectTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
};

export function readTransform(root: THREE.Object3D): ObjectTransform {
  return {
    position: [root.position.x, root.position.y, root.position.z],
    rotation: [
      root.quaternion.x,
      root.quaternion.y,
      root.quaternion.z,
      root.quaternion.w,
    ],
    scale: [root.scale.x, root.scale.y, root.scale.z],
  };
}

export function applyTransform(
  root: THREE.Object3D,
  transform: ObjectTransform,
): void {
  root.position.fromArray(transform.position);
  root.quaternion.fromArray(transform.rotation);
  root.scale.fromArray(transform.scale);
}

/**
 * Read Show/Lock/Colour flags off an Object3D.
 *
 * These live on the object's userData rather than a side table so they travel
 * with the object through duplicate and scene rebuild, and so a locked object
 * stays locked however it was created.
 */
export function readObjectState(root: THREE.Object3D): ObjectState | undefined {
  const data = root.userData as {
    posifyHidden?: boolean;
    posifyLocked?: boolean;
    posifyColor?: string;
  };
  const state: ObjectState = {};
  if (data.posifyHidden) state.hidden = true;
  if (data.posifyLocked) state.locked = true;
  if (data.posifyColor) state.color = data.posifyColor;
  return Object.keys(state).length > 0 ? state : undefined;
}

/**
 * Drive a whole-object TransformControls gizmo.
 *
 * This is deliberately a *second* gizmo from PoseController's bone gizmo. The
 * two have incompatible spaces: bones rotate in the skeleton's local space at
 * joint scale, while an object translates/rotates/scales in the scene root's
 * space. Conflating them breaks bone lengths, which PoseController's header
 * already calls out.
 */
export class ObjectController {
  mode: ObjectGizmoMode = "translate";

  /** Fired when the gizmo moves the object, so the host can push history. */
  onChange: (() => void) | null = null;
  onSelect: ((object: THREE.Object3D | null) => void) | null = null;

  private readonly gizmo: TransformControls;
  private readonly gizmoHelper: THREE.Object3D;
  private readonly helperRoot = new THREE.Group();
  private readonly pivot = new THREE.Object3D();
  private readonly camera: THREE.Camera;
  private readonly orbit: OrbitControls;
  private target: THREE.Object3D | null = null;
  private isDragging = false;
  private readonly centerOffset = new THREE.Vector3();
  private readonly lastPosition = new THREE.Vector3();
  private readonly lastQuaternion = new THREE.Quaternion();
  private readonly lastScale = new THREE.Vector3(1, 1, 1);

  constructor(
    domElement: HTMLElement,
    camera: THREE.Camera,
    orbit: OrbitControls,
  ) {
    this.camera = camera;
    this.orbit = orbit;

    this.gizmo = new TransformControls(camera, domElement);
    this.gizmo.setMode("translate");
    this.gizmo.setSpace("world");
    this.gizmo.size = 0.9;
    this.gizmoHelper = this.gizmo.getHelper();
    this.gizmoHelper.visible = false;
    this.helperRoot.add(this.pivot, this.gizmoHelper);
    this.gizmo.attach(this.pivot);
    this.gizmoHelper.visible = false;

    this.gizmo.addEventListener("dragging-changed", (event) => {
      const dragging = (event as unknown as { value: boolean }).value;
      this.isDragging = dragging;
      // Orbit must yield while the gizmo is dragged or the camera fights it.
      this.orbit.enabled = !dragging;
      if (!dragging) {
        this.pivot.scale.set(1, 1, 1);
        this.lastScale.set(1, 1, 1);
      }
    });
    this.gizmo.addEventListener("objectChange", () => {
      this.applyPivotTransform();
      this.onChange?.();
    });
  }

  get helper(): THREE.Object3D {
    return this.helperRoot;
  }

  get attached(): THREE.Object3D | null {
    return this.target;
  }

  /** True while a gizmo drag is in flight, so picking can stand down. */
  get dragging(): boolean {
    return this.isDragging;
  }

  setMode(mode: ObjectGizmoMode): void {
    this.mode = mode;
    this.gizmo.setMode(mode);
    this.pivot.scale.set(1, 1, 1);
    this.lastScale.set(1, 1, 1);
  }

  /**
   * Attach the gizmo to an object. A locked object is never attachable, which
   * is what makes Lock actually block edits rather than just look locked.
   */
  attach(object: THREE.Object3D | null): void {
    this.target = null;
    this.gizmoHelper.visible = false;
    if (object && !isLocked(object)) {
      this.target = object;
      object.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(object);
      const center = bounds.isEmpty()
        ? object.getWorldPosition(new THREE.Vector3())
        : bounds.getCenter(new THREE.Vector3());
      this.centerOffset.copy(object.worldToLocal(center.clone()));
      this.pivot.position.copy(center);
      this.pivot.quaternion.copy(object.getWorldQuaternion(new THREE.Quaternion()));
      this.pivot.scale.set(1, 1, 1);
      this.lastPosition.copy(this.pivot.position);
      this.lastQuaternion.copy(this.pivot.quaternion);
      this.lastScale.set(1, 1, 1);
      this.gizmo.attach(this.pivot);
      this.gizmoHelper.visible = true;
    } else {
      this.gizmo.detach();
    }
    this.onSelect?.(this.target);
  }

  /** Apply gizmo deltas to the real object while keeping pivot at its center. */
  private applyPivotTransform(): void {
    if (!this.target) return;
    if (this.mode === "translate") {
      this.target.position.add(
        new THREE.Vector3().subVectors(this.pivot.position, this.lastPosition),
      );
    } else if (this.mode === "rotate") {
      const delta = this.pivot.quaternion
        .clone()
        .multiply(this.lastQuaternion.clone().invert());
      this.target.position
        .sub(this.lastPosition)
        .applyQuaternion(delta)
        .add(this.lastPosition);
      this.target.quaternion.premultiply(delta);
    } else {
      const ratio = new THREE.Vector3(
        this.pivot.scale.x / this.lastScale.x,
        this.pivot.scale.y / this.lastScale.y,
        this.pivot.scale.z / this.lastScale.z,
      );
      this.target.scale.multiply(ratio);
      this.target.position.sub(this.lastPosition).multiply(ratio).add(this.lastPosition);
    }

    this.target.updateWorldMatrix(true, true);
    this.pivot.position.copy(this.target.localToWorld(this.centerOffset.clone()));
    this.pivot.quaternion.copy(this.target.getWorldQuaternion(new THREE.Quaternion()));
    this.lastPosition.copy(this.pivot.position);
    this.lastQuaternion.copy(this.pivot.quaternion);
    this.lastScale.copy(this.pivot.scale);
  }

  /** Release without firing onSelect, for teardown paths. */
  detach(): void {
    this.target = null;
    this.gizmo.detach();
    this.gizmoHelper.visible = false;
  }

  /**
   * Clone a model root and its object state, offset so it reads as a second
   * instance.
   *
   * clone() shallow-copies userData by reference, so the Show/Lock/Colour
   * flags are re-assigned explicitly. Otherwise locking or hiding either copy
   * would silently change the other.
   */
  duplicateObject(root: THREE.Object3D, offsetX: number): THREE.Object3D {
    const clone = root.clone(true);
    clone.position.x += offsetX;
    const source = root.userData as {
      posifyHidden?: boolean;
      posifyLocked?: boolean;
      posifyColor?: string;
    };
    const cloneData = clone.userData as typeof source;
    cloneData.posifyHidden = source.posifyHidden;
    cloneData.posifyColor = source.posifyColor;
    // A duplicate must be immediately editable, so it never inherits a lock.
    delete cloneData.posifyLocked;
    return clone;
  }

  dispose(): void {
    this.gizmo.detach();
    // Same three 0.169 caveat as PoseController: TransformControls extends
    // Controls, not Object3D, so its dispose() would traverse a missing
    // method. disconnect() releases the DOM listeners; the helper owns the
    // geometry and materials.
    this.gizmo.disconnect();
    this.gizmoHelper.traverse((child) => {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      const material = mesh.material;
      if (Array.isArray(material)) material.forEach((m) => m.dispose());
      else material?.dispose();
    });
  }
}

// ------------------------------------------------------------ show / lock / colour

export function isLocked(object: THREE.Object3D): boolean {
  return (object.userData as { posifyLocked?: boolean }).posifyLocked === true;
}

export function isHidden(object: THREE.Object3D): boolean {
  return (object.userData as { posifyHidden?: boolean }).posifyHidden === true;
}

/**
 * Hide or show an object.
 *
 * Visibility is set recursively so a SkinnedMesh with skinned children leaves
 * nothing rendering. The flag is stored too, so a scene round-trip can restore
 * the intent rather than inferring it from a stray visible=false.
 */
export function setHidden(object: THREE.Object3D, hidden: boolean): void {
  (object.userData as { posifyHidden?: boolean }).posifyHidden = hidden;
  object.traverse((child) => {
    child.visible = !hidden;
  });
}

export function setLocked(object: THREE.Object3D, locked: boolean): void {
  (object.userData as { posifyLocked?: boolean }).posifyLocked = locked;
}

/**
 * Recolour a model's materials, keeping the originals so Clear can restore.
 *
 * Models are loaded with several materials and often share them, so originals
 * are recorded once per material *instance*. Re-colouring twice and then
 * clearing therefore returns to the authored colour, not to the first
 * override.
 */
export function setObjectColor(object: THREE.Object3D, color: string): void {
  const data = object.userData as {
    posifyColor?: string;
    posifyOriginalColors?: Map<THREE.Material, string>;
  };
  const parsed = new THREE.Color(color);

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      if (!data.posifyOriginalColors) data.posifyOriginalColors = new Map();
      const withColor = material as THREE.Material & { color?: THREE.Color };
      if (!withColor.color) continue;
      if (!data.posifyOriginalColors.has(material)) {
        data.posifyOriginalColors.set(
          material,
          `#${withColor.color.getHexString()}`,
        );
      }
      withColor.color.copy(parsed);
    }
  });
  data.posifyColor = color;
}

/** Drop a colour override, restoring each material's authored colour. */
export function clearObjectColor(object: THREE.Object3D): void {
  const data = object.userData as {
    posifyColor?: string;
    posifyOriginalColors?: Map<THREE.Material, string>;
  };
  if (data.posifyOriginalColors) {
    for (const [material, hex] of data.posifyOriginalColors) {
      const withColor = material as THREE.Material & { color?: THREE.Color };
      if (withColor.color) withColor.color.set(hex);
    }
    data.posifyOriginalColors.clear();
    delete data.posifyOriginalColors;
  }
  delete data.posifyColor;
}

/**
 * Horizontal offset that makes a duplicate read as a separate instance.
 *
 * Measured from the model's own bounds so a chibi and a brute do not end up at
 * the same separation, with a fallback because an empty or degenerate box would
 * otherwise stack the duplicate exactly inside the original.
 */
export function duplicateOffset(root: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(root);
  const width = box.max.x - box.min.x;
  return Number.isFinite(width) && width > 0.05 ? width * 1.15 : 1.1;
}
