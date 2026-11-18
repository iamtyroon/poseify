// Visible joint handles, and the pick-a-joint mode that Attach to Joint uses.
//
// Poseify has always picked bones invisibly: PoseController raycasts to bone
// world positions with a distance tolerance, so there is nothing to click.
// That works for posing but it cannot express "attach this prop to that joint"
// — the user needs to see which joint they are about to choose.
//
// PoseMy.Art solves this by rendering a sphere on every joint and blinking them
// while attach mode is live. Same idea here, minus the blink: a real click
// target per bone, sized from the model's own gizmo tuning so a chibi and a
// brute both get handles you can actually hit.
//
// Framework-free and Three-only, like PoseController and ObjectController, so
// it can be unit tested without a renderer.

import * as THREE from "three";
import type { PosableSkeleton } from "./PosableSkeleton";

/** Radius floor/ceiling, in the same units as gizmoSizeFor. */
const MIN_RADIUS = 0.003;
const MAX_RADIUS = 0.035;

type HandleColor = "left" | "right" | "center" | "hips" | "highlight";

export interface JointHandlesOptions {
  /**
   * Bones that never get a handle. Left to the caller because the right set
   * depends on the model: a permanently oversized hips handle obscures the
   * pelvis on every figure.
   */
  exclude?: readonly string[];
}

/**
 * A sphere per poseable bone, plus picking for attach mode.
 *
 * Handles are parented to the scene, not to the bones: a handle is UI, and UI
 * parented into a rig gets dragged along by every pose edit and would need
 * re-parenting on each commit. Instead they follow bone world positions once
 * per frame, which keeps them correct through FK, IK and group edits alike.
 */
export class JointHandles {
  private readonly group = new THREE.Group();
  private readonly geometry: THREE.CylinderGeometry;
  private readonly materials: Record<HandleColor, THREE.MeshBasicMaterial>;
  private skeleton: PosableSkeleton | null = null;
  private visible = false;
  private highlighted = false;

  /** Fired when the user clicks a handle while attach mode is active. */
  onPick: ((boneName: string) => void) | null = null;

  constructor(options: JointHandlesOptions = {}) {
    this.group.name = "JointHandles";
    this.group.visible = false;
    this.geometry = new THREE.CylinderGeometry(0.78, 1, 0.9, 6, 1);
    this.geometry.rotateX(Math.PI / 2);
    const material = (color: number) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.72,
        metalness: 0.04,
        flatShading: true,
        transparent: true,
        opacity: 0.9,
        // depthTest off so a handle behind the mesh is still visible and still
        // clickable. A handle you cannot see is a handle you cannot trust.
        depthTest: false,
      });
    this.materials = {
      left: material(0x4268e8),
      right: material(0xc95555),
      center: material(0x4da85c),
      hips: material(0xb4a83d),
      highlight: material(0xffc53d),
    };
    if (options.exclude?.length) {
      this.group.userData.exclude = [...options.exclude];
    }
  }

  /** The object to add to the scene. */
  get object(): THREE.Object3D {
    return this.group;
  }

  get showing(): boolean {
    return this.visible;
  }

  /** Number of live handles, for tests and status text. */
  get count(): number {
    return this.group.children.length;
  }

  /**
   * Point the handles at a skeleton, rebuilding them for its bone list.
   *
   * Pass null to clear. Rebuilding rather than toggling visibility is what
   * makes a model swap correct: the horse has no finger bones and the
   * mannequin has them, and a shared pool would show stale handles.
   */
  setSkeleton(skeleton: PosableSkeleton | null): void {
    this.skeleton = skeleton;
    this.clear();
    if (!skeleton) {
      this.group.visible = false;
      this.visible = false;
      return;
    }
    const exclude = new Set(
      (this.group.userData.exclude as string[] | undefined) ?? [],
    );
    for (const name of skeleton.getBoneNames()) {
      if (exclude.has(name)) continue;
      const mesh = new THREE.Mesh(
        this.geometry,
        this.highlighted ? this.materials.highlight : this.materialForBone(name),
      );
      mesh.name = `JointHandle:${name}`;
      mesh.userData.boneName = name;
      // Handles must never intercept an orbit drag. Picking happens in JS from
      // bone positions, so the mesh raycast is stubbed out entirely.
      mesh.raycast = () => undefined;
      mesh.renderOrder = 999;
      this.group.add(mesh);
    }
    this.sync();
  }

  /** Show or hide every handle. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.group.visible = visible && this.count > 0;
  }

  /** Highlight all handles while the user is choosing a joint for a prop. */
  setHighlighted(on: boolean): void {
    this.highlighted = on;
    for (const child of this.group.children) {
      const mesh = child as THREE.Mesh;
      const name = mesh.userData.boneName as string | undefined;
      if (name) {
        mesh.material = on
          ? this.materials.highlight
          : this.materialForBone(name);
      }
    }
  }

  /**
   * Re-place every handle on its bone.
   *
   * Called once per rendered frame, after posing has been applied, so the
   * handles track the pose rather than the rest position.
   */
  sync(): void {
    if (!this.skeleton) return;
    const worldPosition = new THREE.Vector3();
    const childPosition = new THREE.Vector3();
    this.group.updateMatrixWorld(true);
    for (const child of this.group.children) {
      const mesh = child as THREE.Mesh;
      const name = mesh.userData.boneName as string | undefined;
      if (!name) continue;
      const bone = this.skeleton.getBone(name);
      if (!bone) continue;
      bone.getWorldPosition(worldPosition);
      mesh.position.copy(this.group.worldToLocal(worldPosition));
      const childBones = bone.children.filter(
        (candidate): candidate is THREE.Bone => candidate instanceof THREE.Bone,
      );
      let boneLength = 0;
      if (childBones.length > 0) {
        for (const childBone of childBones) {
          childBone.getWorldPosition(childPosition);
          boneLength += worldPosition.distanceTo(childPosition);
        }
        boneLength /= childBones.length;
      } else if (bone.parent instanceof THREE.Bone) {
        bone.parent.getWorldPosition(childPosition);
        boneLength = worldPosition.distanceTo(childPosition);
      }
      // Scale each marker to its bone segment, retaining per-model tuning.
      const radius = THREE.MathUtils.clamp(
        boneLength * (this.skeleton.gizmoSize(name) / 3) * 0.18,
        MIN_RADIUS,
        MAX_RADIUS,
      );
      mesh.scale.setScalar(radius);
    }
  }

  /**
   * Nearest handle to the pointer ray, or null.
   *
   * Same distance rule as PoseController.pickBone, plus the handle's own radius
   * so a large hips handle is easier to hit than a small toe handle.
   */
  pickBone(
    raycaster: THREE.Raycaster,
    pickRadius: number,
  ): string | null {
    if (!this.skeleton || !this.visible) return null;
    let best: { name: string; distance: number } | null = null;
    const worldPos = new THREE.Vector3();
    const projected = new THREE.Vector3();
    for (const child of this.group.children) {
      const mesh = child as THREE.Mesh;
      const name = mesh.userData.boneName as string | undefined;
      if (!name) continue;
      mesh.getWorldPosition(worldPos);
      projected.copy(worldPos).project(raycaster.camera);
      if (projected.z > 1) continue;
      const distance = raycaster.ray.distanceToPoint(worldPos);
      const tolerance = pickRadius * (distance / 10 + 0.5) + mesh.scale.x;
      if (distance < tolerance && (!best || distance < best.distance)) {
        best = { name, distance };
      }
    }
    return best?.name ?? null;
  }

  private clear(): void {
    for (const child of [...this.group.children]) this.group.remove(child);
  }

  private materialForBone(name: string): THREE.MeshBasicMaterial {
    const side = name.toLowerCase();
    if (side.includes("hip")) return this.materials.hips;
    if (side.includes("left")) return this.materials.left;
    if (side.includes("right")) return this.materials.right;
    return this.materials.center;
  }

  dispose(): void {
    this.clear();
    this.geometry.dispose();
    for (const material of Object.values(this.materials)) material.dispose();
    this.skeleton = null;
  }
}
