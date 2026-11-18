// Pose data model.
//
// A pose is a flat map from contract bone name to a local quaternion. Because
// every model shares the rig contract, the same record applies to any model
// without conversion, which is what makes pose transfer a straight copy.

import type { PoseData } from "../posing/PosableSkeleton";

export type { PoseData };

export type BoneRotation = [number, number, number, number];

/**
 * Where a pose came from.
 *
 * "authored" is the built-in pose library. Other values identify imported,
 * clip-derived, or user-created poses.
 */
export type PoseSource = "authored" | "clip" | "imported" | "user";

export interface Pose {
  // Stable id, unique within the library.
  id: string;
  name: string;
  tags: readonly string[];
  // Contract bone name -> local quaternion.
  bones: PoseData;
  /**
   * Root translation in metres applied on top of the rig bind offset.
   * Seated and kneeling poses need this: the rig has no pelvis bone and Hips
   * is the skeleton root, so rotating it spins the figure without lowering it
   * onto the prop or the floor.
   */
  rootOffset?: [number, number, number];
  source: PoseSource;
}

export const POSE_TAGS = [
  "standing",
  "sitting",
  "walking",
  "running",
  "fighting",
  "aiming",
  "kneeling",
  "lying",
  "dancing",
  "gesture",
] as const;

export type PoseTag = (typeof POSE_TAGS)[number];

/** Filter a library by free-text search and tag selection. */
export function filterPoses(
  poses: readonly Pose[],
  options: { search?: string; tags?: readonly string[] } = {},
): Pose[] {
  const { search = "", tags = [] } = options;
  const needle = search.trim().toLowerCase();
  const wanted = tags.map((t) => t.toLowerCase());

  return poses.filter((pose) => {
    if (wanted.length > 0) {
      const poseTags = pose.tags.map((t) => t.toLowerCase());
      // Any selected tag matches; an empty selection means "no tag filter".
      if (!wanted.some((t) => poseTags.includes(t))) return false;
    }
    if (needle.length === 0) return true;
    if (pose.name.toLowerCase().includes(needle)) return true;
    return pose.tags.some((t) => t.toLowerCase().includes(needle));
  });
}

export function findPose(poses: readonly Pose[], id: string): Pose | undefined {
  return poses.find((p) => p.id === id);
}

/** Every tag present in a library, sorted, for building the filter UI. */
export function collectTags(poses: readonly Pose[]): string[] {
  const tags = new Set<string>();
  for (const pose of poses) for (const t of pose.tags) tags.add(t);
  return [...tags].sort();
}

/** Validate a pose against a model's available bones before applying it. */
export function validatePose(
  pose: Pose,
  knownBones: ReadonlySet<string>,
): { ok: boolean; unknownBones: string[] } {
  const unknownBones = Object.keys(pose.bones).filter(
    (b) => !knownBones.has(b),
  );
  return { ok: unknownBones.length === 0, unknownBones };
}

/** Serialise a pose to JSON for save/load and scene embedding. */
export function poseToJson(pose: Pose): string {
  return JSON.stringify(
    {
      id: pose.id,
      name: pose.name,
      tags: pose.tags,
      source: pose.source,
      bones: pose.bones,
      ...(pose.rootOffset ? { rootOffset: pose.rootOffset } : {}),
    },
    null,
    2,
  );
}

/** Parse a pose from JSON, returning null on anything malformed. */
export function poseFromJson(text: string): Pose | null {
  try {
    const raw = JSON.parse(text) as Partial<Pose>;
    if (
      typeof raw.id !== "string" ||
      typeof raw.name !== "string" ||
      !raw.bones ||
      typeof raw.bones !== "object"
    ) {
      return null;
    }
    const bones: PoseData = {};
    for (const [bone, value] of Object.entries(raw.bones)) {
      if (
        Array.isArray(value) &&
        value.length === 4 &&
        value.every((n) => typeof n === "number" && Number.isFinite(n))
      ) {
        bones[bone] = value as BoneRotation;
      }
    }
    return {
      id: raw.id,
      name: raw.name,
      tags: Array.isArray(raw.tags)
        ? raw.tags.filter((t) => typeof t === "string")
        : [],
      ...(Array.isArray(raw.rootOffset) && raw.rootOffset.length === 3
        ? { rootOffset: raw.rootOffset as [number, number, number] }
        : {}),
      source: raw.source ?? "imported",
      bones,
    };
  } catch {
    return null;
  }
}


