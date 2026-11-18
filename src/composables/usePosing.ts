// Bridges the framework-free 3D systems into Vue reactive state.

import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import * as THREE from "three";
import { Viewport } from "../renderer/Viewport";
import {
  DEFAULT_PICK_RADIUS,
  PoseController,
  type InteractionMode,
} from "../posing/PoseController";
import { PosableSkeleton } from "../posing/PosableSkeleton";
import {
  MODEL_CATALOG,
  findModel,
  loadModel,
  isVendorModel,
  type CatalogEntry,
} from "../models/ModelCatalog";
import { modelThumbnail } from "../models/ModelThumbnail";
import { usePreferences } from "../prefs/Preferences";
import { removePreset, upsertPreset } from "../prefs/CameraPresets";
import type { CameraPose } from "../prefs/CameraTypes";
import {
  groupIdFromName,
  removeGroup,
  resolveGroupBones,
  resetGroupBones,
  selectableBones,
  upsertGroup,
  validateGroups,
  type JointGroup,
} from "../posing/JointGroups";
import {
  removeAnchor,
  upsertAnchor,
  validateAnchor,
  validateAnchors,
  type Anchor,
} from "../posing/Anchors";
import { resolveShortcut, type ShortcutAction } from "../prefs/Shortcuts";
import type { GridState, LightState } from "../scene/SceneEnvironment";
import {
  RENDER_PASSES,
  exportModelObj,
  exportPasses,
  type ExportResult,
} from "../export/Exporter";
import { exportSceneObj, type SceneObjSource } from "../export/ObjExport";
import type { ObjExportResult } from "../export/Exporter";
import { POSE_LIBRARY } from "../pose/PoseLibrary";
import {
  loadVendorPose,
  loadVendorPoseIndex,
  searchVendorPoses,
  vendorPoseCategories,
  vendorPoseThumb,
  type VendorPoseSummary,
} from "../pose/VendorPoseLibrary";
import { PoseClipboard, randomPoseIndex } from "../pose/PoseClipboard";
import {
  HAND_POSE_LIBRARY,
  collectHandTags,
  findHandPose,
  handPosesForSide,
} from "../pose/HandPoseLibrary";
import { canApplyHandPose, missingHandBones, type HandPose } from "../pose/HandPose";
import type { HandSide } from "../rig/RigContract";
import {
  mirrorLimb,
  mirrorPose,
} from "../pose/PoseAuthoring";
import {
  collectTags,
  filterPoses,
  validatePose,
  type Pose,
} from "../pose/Pose";
import { poseThumbnailer } from "../pose/PoseThumbnail";
import {
  ClipPlayer,
  collectClipTags,
  filterClips,
  loadClipLibrary,
  type AnimationClip,
  type ClipSummary,
} from "../anim/ClipPlayer";
import {
  PROP_CATALOG,
  buildProp,
  findProp,
} from "../props/PropCatalog";
import {
  VENDOR_PROP_BASE,
  VENDOR_PROP_THUMB_BASE,
  VENDOR_PROP_CATALOG,
  type VendorPropEntry,
} from "../props/VendorPropCatalog";
import {
  centreOnOrigin,
  loadPropFromFile,
  measure,
  snapToFloor,
  type PropConfig,
} from "../props/PropSystem";
import { createImagePlane, updateImagePlane } from "../props/ImagePlane";
import {
  emptyScene,
  parseScene,
  sceneToJson,
  type PropAttach,
  type SceneState,
} from "../scene/Scene";
import {
  ObjectController,
  clearObjectColor,
  duplicateOffset,
  isHidden,
  isLocked,
  readObjectState,
  setHidden,
  setLocked,
  setObjectColor,
  type ObjectGizmoMode,
} from "../scene/ObjectState";
import { JointHandles } from "../posing/JointHandles";
import {
  applySavedAttach,
  attachPropToBone,
  detachPropFromBone,
} from "../scene/PropAttach";
import { History, historyShortcut } from "../scene/History";
import { PREMADE_SCENES } from "../scene/PremadeScenes";
import { loadGeneratedScenes } from "../scene/GeneratedScenes";
import {
  loadVendorScene,
  loadVendorSceneIndex,
  searchVendorScenes,
  vendorSceneCategories,
  type VendorSceneSummary,
} from "../scene/VendorSceneLoader";
import {
  deleteScene,
  downloadScene,
  listSavedScenes,
  loadScene as loadStoredScene,
  readSceneFile,
  saveScene,
  type SceneSummary,
} from "../scene/SceneStorage";

export interface PosedModel {
  config: CatalogEntry;
  skeleton: PosableSkeleton;
  root: THREE.Object3D;
  /**
   * Unique per loaded instance, not per catalogue entry.
   *
   * Duplicate (Shift+D) can put two copies of the same model in one scene, so
   * config.id is not a valid identity: Vue would reuse one <li> for both and
   * removing by config.id would take out both copies. This is what the Scene
   * list keys on and what removeModel/deleteSelectedObject target.
   */
  instanceId: string;
}

export interface PlacedProp {
  id: string;
  config: PropConfig;
  root: THREE.Object3D;
  /**
   * Joint this prop is pinned to, or null when it stands on its own.
   *
   * PoseMy.Art names the same idea `propAttachInfo`. Kept on the live prop as
   * well as in the saved scene so the object panel can label the button
   * Attach or Detach without re-deriving it from the parent chain.
   */
  attach: PropAttach | null;
}

export interface ImagePlaneEntry {
  id: string;
  name: string;
  mesh: THREE.Mesh;
}

/**
 * Monotonic instance counter for PosedModel.instanceId.
 *
 * Module scope on purpose: ids must stay unique across scene rebuilds inside
 * one session, and a reload clears them along with everything else.
 */
let modelInstanceCounter = 0;

function nextModelInstanceId(catalogId: string): string {
  modelInstanceCounter += 1;
  return `${catalogId}#${modelInstanceCounter}`;
}

/** Decode a `data:image/png;base64,...` URL into a Blob for download. */
function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return new Blob([dataUrl], { type: "image/png" });
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /data:([^;]+)/.exec(meta)?.[1] ?? "image/png";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function usePosing() {
  const mount = ref<HTMLDivElement | null>(null);
  const viewport = shallowRef<Viewport | null>(null);
  const controller = shallowRef<PoseController | null>(null);

  const models = shallowRef<PosedModel[]>([]);
  const activeModelId = ref<string | null>(null);
  const selectedBone = ref<string | null>(null);
  const selectedObjectId = ref<string | null>(null);
  const objectGizmoMode = ref<ObjectGizmoMode>("translate");
  const mode = ref<InteractionMode>("fk");
  const status = ref("starting");
  const error = ref<string | null>(null);
  const boneNames = ref<string[]>([]);
  const loadingId = ref<string | null>(null);
  const objectController = shallowRef<ObjectController | null>(null);
  const jointHandles = shallowRef<JointHandles | null>(null);
  // Set while the user is choosing a joint for a prop. The prop id and the
  // pending bone are held together so a click in the viewport can be routed to
  // exactly one prop.
  const attachModeFor = ref<string | null>(null);
  const attachError = ref<string | null>(null);
  const attachStatus = ref<string | null>(null);
  // Set while a gizmo drag is moving; consumed on drag end to push one history
  // entry per drag rather than per frame.
  const gizmoDirty = ref(false);
  // Show/Lock are flags on three.js objects, which Vue cannot track, so the
  // UI needs an explicit reactive mirror. Bumped after any change to make
  // computeds that read Object3D.userData re-evaluate.
  const objectStateVersion = ref(0);

  function touchObjectState(): void {
    objectStateVersion.value += 1;
  }

  /** Objects that can be picked: loaded model roots and placed prop roots. */
  function selectableObjects(): { id: string; root: THREE.Object3D }[] {
    // Reading the version makes this function a reactive dependency, so the
    // object picker re-renders when Show/Lock change on a three.js object.
    void objectStateVersion.value;
    const out: { id: string; root: THREE.Object3D }[] = [];
    // Keyed by instanceId, not index, so the selection survives a removal or a
    // reorder instead of silently retargeting a different figure.
    models.value.forEach((m) => out.push({ id: m.instanceId, root: m.root }));
    props.value.forEach((p) => out.push({ id: p.id, root: p.root }));
    return out;
  }

  /** Find the model or prop backing a selection id, and its root. */
  function findSelectedObject(
    id: string | null,
  ): { root: THREE.Object3D; model?: PosedModel; prop?: PlacedProp } | null {
    if (!id) return null;
    const model = models.value.find((m) => m.instanceId === id);
    if (model) return { root: model.root, model };
    const prop = props.value.find((p) => p.id === id);
    return prop ? { root: prop.root, prop } : null;
  }

  async function attachModel(config: CatalogEntry): Promise<PosedModel> {
    const vp = viewport.value;
    if (!vp) throw new Error("Viewport not ready");

    loadingId.value = config.id;
    let root: THREE.Object3D;
    try {
      const built = await loadModel(config, { renderer: vp.renderer });
      root = built.root;
    } finally {
      loadingId.value = null;
    }
    // Fan new models out along X so several can be posed side by side instead
    // of stacking inside one another.
    root.position.x = models.value.length * 1.1;
    vp.scene.add(root);
    vp.scene.updateMatrixWorld(true);

    // bindHands (not requireHands) asks the retargeter to bind the finger bones
    // when the model has them, without rejecting a model that has none. The
    // horse and the mermaids still load and pose; every humanoid now actually
    // exposes its fingers to hand export and per-limb mirroring.
    const skeleton = new PosableSkeleton(root, config, { bindHands: true });
    if (!skeleton.isValid) {
      vp.scene.remove(root);
      throw new Error(
        `Model "${config.name}" failed rig validation: ` +
          skeleton.retarget.errors.join(" "),
      );
    }

    const posed: PosedModel = {
      config,
      skeleton,
      root,
      instanceId: nextModelInstanceId(config.id),
    };
    models.value = [...models.value, posed];
    return posed;
  }

  function setActive(id: string | null): void {
    activeModelId.value = id;
    const posed = models.value.find((m) => m.config.id === id) ?? null;
    controller.value?.setSkeleton(posed?.skeleton ?? null);
    boneNames.value = posed ? [...posed.skeleton.getBoneNames()] : [];
    selectedBone.value = null;
    // Handles belong to whichever figure is active, and an attach in flight
    // targets that figure's joints.
    refreshHandles();
  }

  /** Switch figures while carrying the current joint rotations onto the new rig. */
  function activateModelWithPose(id: string): void {
    const target = models.value.find((model) => model.config.id === id);
    if (!target || id === activeModelId.value) return;
    const source = activeSkeleton();
    if (source) target.skeleton.applyPose(source.getPose());
    setActive(id);
    commit();
  }

  function selectBone(name: string | null): void {
    controller.value?.selectBone(name);
  }

  function setMode(next: InteractionMode): void {
    mode.value = next;
    controller.value?.setMode(next);
  }

  function removeModel(id: string): void {
    const vp = viewport.value;
    // Accept either a catalogue id or an instance id. Duplicate puts several
    // copies of one model in a scene, so callers that mean "this copy" pass the
    // instance id; the old catalogue-id callers (Delete key, × on the first
    // match) keep working.
    const posed =
      models.value.find((m) => m.instanceId === id) ??
      models.value.find((m) => m.config.id === id);
    if (!posed || !vp) return;
    vp.scene.remove(posed.root);
    models.value = models.value.filter((m) => m.instanceId !== posed.instanceId);
    if (activeModelId.value === id) setActive(null);
    // Selection ids embed the model index, so a removal invalidates any
    // object selection rather than silently pointing at the wrong figure.
    selectObject(null);
    // Close the gap left by the removed model.
    models.value.forEach((m, i) => {
      m.root.position.x = i * 1.1;
    });
  }

  const hasRemoteModels = MODEL_CATALOG.some(isVendorModel);

  function resetPose(): void {
    const posed = models.value.find((m) => m.config.id === activeModelId.value);
    posed?.skeleton.resetPose();
  }

  // ------------------------------------------- Phase 2: pose surgery

  // -------------------------------------------------- Phase 5: hand posing

  const handSide = ref<HandSide>("Left");
  function setHandSide(side: HandSide): void {
    handSide.value = side;
  }
  const handPoseError = ref<string | null>(null);
  const handPoseSearch = ref("");
  const handClipboard = new PoseClipboard();

  /** Hand poses for the chosen side, filtered by the search box. */
  const visibleHandPoses = computed(() => {
    const needle = handPoseSearch.value.trim().toLowerCase();
    const pool = handPosesForSide(handSide.value);
    if (!needle) return pool;
    return pool.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        p.tags.some((t) => t.toLowerCase().includes(needle)),
    );
  });

  const allHandTags = collectHandTags();

  /**
   * Apply a hand pose to the active model.
   *
   * Reports exactly which bones the model lacks rather than failing silently:
   * the horse and the mermaids have no fingers, and an artist who presses a
   * hand pose and sees nothing happen has no way to tell why.
   */
  function applyHandPose(pose: HandPose): boolean {
    const skeleton = activeSkeleton();
    if (!skeleton) {
      handPoseError.value = "Add and select a model first.";
      return false;
    }
    const known = new Set(skeleton.getBoneNames());
    if (!canApplyHandPose(pose, known)) {
      const missing = missingHandBones(pose, known);
      const shown = missing.slice(0, 3).join(", ");
      const more = missing.length > 3 ? ", ..." : "";
      handPoseError.value =
        `${activeModelName.value} cannot take "${pose.name}": ` +
        `missing ${missing.length} finger bone(s) (${shown}${more}).`;
      return false;
    }
    skeleton.applyHandPose(pose.bones);
    handPoseError.value = null;
    handPoseStatus.value = `Applied ${pose.name} to the ${pose.side.toLowerCase()} hand`;
    commit();
    return true;
  }

  const handPoseStatus = ref<string | null>(null);

  function activeModelName(): string {
    return (
      models.value.find((m) => m.config.id === activeModelId.value)?.config.name ??
      "This model"
    );
  }

  /** Copy the current finger bones to the hand clipboard. */
  function copyHandPose(): void {
    const skeleton = activeSkeleton();
    if (!skeleton) {
      handPoseError.value = "Add and select a model first.";
      return;
    }
    const hands = skeleton.getHandPose();
    const ok = handClipboard.copy(hands, activeModelId.value ?? "model");
    handPoseStatus.value = ok
      ? `Copied ${Object.keys(hands).length} finger bones`
      : "There are no finger bones set to copy";
  }

  /**
   * Paste the hand clipboard without touching the body pose.
   *
   * This is the command the whole subsystem exists for: an artist with a
   * finished body pose fixes the hands without re-picking anything.
   */
  function pasteHandOnly(): void {
    const skeleton = activeSkeleton();
    const held = handClipboard.paste();
    if (!skeleton || !held || Object.keys(held).length === 0) {
      handPoseError.value = "The hand clipboard is empty.";
      return;
    }
    const missing = skeleton.applyHandPose(held);
    if (missing.length > 0) {
      handPoseError.value =
        `${activeModelName()} is missing ${missing.length} of those finger bones.`;
      return;
    }
    handPoseError.value = null;
    handPoseStatus.value = `Pasted ${Object.keys(held).length} finger bones`;
    commit();
  }

  /** Reset every finger bone to bind, leaving the body pose alone. */
  function resetHands(): void {
    const skeleton = activeSkeleton();
    if (!skeleton) return;
    skeleton.resetHandPose();
    handPoseError.value = null;
    handPoseStatus.value = "Hands reset";
    commit();
  }
  // ------------------------------------ Phase 6: joint groups and anchors

  // Loaded from preferences once, then owned here so the editor can work on
  // drafts without a round-trip through storage on every keystroke.
  const jointGroups = ref<JointGroup[]>(
    validateGroups(usePreferences().prefs.value.jointGroups),
  );
  const anchors = ref<Anchor[]>(
    validateAnchors(usePreferences().prefs.value.anchors),
  );
  const groupDraftName = ref("");
  const groupDraftBones = ref<string[]>([]);
  const anchorDraftBone = ref<string | null>(null);
  const anchorDraftTarget = ref<Anchor["target"] | null>(null);
  const anchorDraftOffset = ref<[number, number, number]>([0, 0, 0]);
  const anchorError = ref<string | null>(null);

  /** Bones this model has, for the group editor and anchor pickers. */
  const groupableBones = computed<string[]>(() => {
    const skeleton = activeSkeleton();
    return skeleton ? selectableBones(new Set(skeleton.getBoneNames())) : [];
  });

  /**
   * Create a group from the current draft.
   *
   * Refuses an empty group rather than storing it, because a group with no
   * bones is a dead row in the picker.
   */
  function createGroup(): boolean {
    const name = groupDraftName.value.trim();
    const bones = [...groupDraftBones.value];
    if (!name || bones.length === 0) {
      return false;
    }
    jointGroups.value = upsertGroup(jointGroups.value, {
      id: groupIdFromName(name),
      name,
      bones,
    });
    groupDraftName.value = "";
    groupDraftBones.value = [];
    return true;
  }

  function deleteGroup(id: string): void {
    jointGroups.value = removeGroup(jointGroups.value, id);
  }

  /**
   * Reset every bone in a group to bind, leaving the rest of the pose alone.
   *
   * Applies through resetBone per bone rather than re-applying a filtered pose,
   * so bones that are not on this model are reported instead of silently kept.
   */
  function resetGroup(id: string): void {
    const skeleton = activeSkeleton();
    const group = jointGroups.value.find((g) => g.id === id);
    if (!skeleton || !group) return;
    const known = new Set(skeleton.getBoneNames());
    const { bones, missing } = resolveGroupBones(group, known);
    for (const bone of bones) skeleton.resetBone(bone);
    anchorError.value = null;
    groupStatus.value =
      missing.length > 0
        ? `Reset ${bones.length} bone(s); ${missing.length} not on this model`
        : `Reset ${bones.length} bone(s) in ${group.name}`;
    commit();
  }

  /** Rotate every bone in a group by the same Euler, for posing a chain as a unit. */
  function rotateGroup(id: string, degrees: [number, number, number]): void {
    const skeleton = activeSkeleton();
    const group = jointGroups.value.find((g) => g.id === id);
    if (!skeleton || !group) return;
    const known = new Set(skeleton.getBoneNames());
    const { bones } = resolveGroupBones(group, known);
    const euler = new THREE.Euler(
      (degrees[0] * Math.PI) / 180,
      (degrees[1] * Math.PI) / 180,
      (degrees[2] * Math.PI) / 180,
      "XYZ",
    );
    for (const bone of bones) skeleton.rotateBone(bone, euler);
    anchorError.value = null;
    groupStatus.value = `Rotated ${bones.length} bone(s) in ${group.name}`;
    commit();
  }

  const groupStatus = ref<string | null>(null);

  // Mirror groups and anchors into preferences so they survive a reload.
  // Written through the same setter as every other preference rather than to
  // localStorage directly, so there is one persistence path.
  watch(jointGroups, (value) => {
    usePreferences().set("jointGroups", value);
  }, { deep: true });
  watch(anchors, (value) => {
    usePreferences().set("anchors", value);
  }, { deep: true });

  /**
   * Create an anchor from the current draft.
   *
   * Cycles are rejected here, at creation, rather than discovered in the
   * per-frame pass where there is no safe way to recover.
   */
  function createAnchor(): boolean {
    const bone = anchorDraftBone.value;
    const target = anchorDraftTarget.value;
    if (!bone || !target) return false;
    const candidate: Anchor = {
      id: `anchor_${bone}`,
      bone,
      target,
      offset: [...anchorDraftOffset.value],
    };
    const check = validateAnchor(candidate, anchors.value);
    if (!check.ok) {
      anchorError.value = check.reason;
      return false;
    }
    anchors.value = upsertAnchor(anchors.value, candidate);
    anchorError.value = null;
    groupStatus.value = `Anchored ${bone}`;
    anchorDraftBone.value = null;
    anchorDraftTarget.value = null;
    anchorDraftOffset.value = [0, 0, 0];
    return true;
  }

  function deleteAnchor(id: string): void {
    // Removing an anchor must not move the bone: it stays exactly where the
    // last pass left it rather than snapping back to bind.
    anchors.value = removeAnchor(anchors.value, id);
    anchorError.value = null;
  }

  /**
   * Run the anchor constraint pass for this frame.
   *
   * Called from the render loop after IK and before the skeleton is applied,
   * which is what lets an anchor win over an IK solve being dragged.
   */
  function updateAnchors(): void {
    const skeleton = activeSkeleton();
    if (!skeleton || anchors.value.length === 0) return;
    const props = new Map(props.value.map((p) => [p.id, p.root]));
    skeleton.applyAnchors(anchors.value, props);
  }
  const clipboard = new PoseClipboard();
  const clipboardStatus = ref<string | null>(null);

  /** The active model's skeleton, or null when nothing is selected. */
  function activeSkeleton(): PosableSkeleton | null {
    return (
      models.value.find((m) => m.config.id === activeModelId.value)?.skeleton ??
      null
    );
  }

  /**
   * Reset one joint to its bind rotation, leaving the rest of the pose alone.
   *
   * This is the "fix one bad elbow without re-picking the pose" case. The
   * other 21 bones must come back bit-identical, so it reads the pose before
   * and after rather than re-applying a filtered copy.
   */
  function resetSelectedJoint(): void {
    const skeleton = activeSkeleton();
    if (!skeleton) return;
    const bone = selectedBone.value;
    if (!bone) {
      poseError.value = "Select a joint first.";
      return;
    }
    skeleton.resetBone(bone);
    poseError.value = null;
    commit();
  }

  /**
   * Apply a pose operation to the active model and record it.
   *
   * Every pose-surgery action goes through here so undo captures the result
   * once, rather than each action remembering to push history.
   */
  function mutateActivePose(
    mutate: (skeleton: PosableSkeleton) => void,
    okMessage: string,
  ): void {
    const skeleton = activeSkeleton();
    if (!skeleton) {
      poseError.value = "Add and select a model first.";
      return;
    }
    mutate(skeleton);
    poseError.value = null;
    clipboardStatus.value = okMessage;
    commit();
  }

  /** Mirror only the arm chain, across the sagittal plane. */
  function mirrorArmLimb(): void {
    mutateActivePose((skeleton) => {
      skeleton.applyPose(mirrorLimb(skeleton.getPose(), "arm"));
    }, "Arms mirrored");
  }

  /** Mirror only the leg chain, across the sagittal plane. */
  function mirrorLegLimb(): void {
    mutateActivePose((skeleton) => {
      skeleton.applyPose(mirrorLimb(skeleton.getPose(), "leg"));
    }, "Legs mirrored");
  }

  /**
   * Switch Pose Sides — the existing whole-body mirror, exposed.
   *
   * mirrorPose already existed and was tested but unreachable from the UI, so
   * this only adds the call site rather than a second implementation.
   */
  function switchPoseSides(): void {
    mutateActivePose((skeleton) => {
      skeleton.applyPose(mirrorPose(skeleton.getPose()));
    }, "Pose sides switched");
  }

  function copyPose(): void {
    const skeleton = activeSkeleton();
    if (!skeleton) {
      poseError.value = "Add and select a model first.";
      return;
    }
    const pose = skeleton.getPose();
    const ok = clipboard.copy(pose, activeModelId.value ?? "pose");
    clipboardStatus.value = ok
      ? `Copied ${Object.keys(pose).length} bones`
      : "Could not copy an empty pose";
  }

  function pastePose(): void {
    const held = clipboard.paste();
    if (!held) {
      poseError.value = "The pose clipboard is empty.";
      return;
    }
    mutateActivePose(
      (skeleton) => skeleton.applyPose(held),
      `Pasted ${Object.keys(held).length} bones`,
    );
  }

  /**
   * Apply a pose without its rootOffset, keeping the figure where the artist
   * put it.
   *
   * Seated and kneeling poses carry a root drop so the figure lands on a
   * chair. Applying one of those to a figure the artist has already placed
   * would teleport it, which is what In Place avoids.
   */
  function toggleInPlace(): boolean {
    const skeleton = activeSkeleton();
    if (!skeleton) return false;
    inPlace.value = !inPlace.value;
    // Re-apply immediately so the toggle has a visible effect rather than
    // waiting for the next pose selection.
    const pose = lastPose.value;
    if (pose) {
      mutateActivePose(
        (s) => s.applyPose(pose, inPlace.value ? undefined : pose.rootOffset),
        inPlace.value ? "Applied in place" : "Applied with root offset",
      );
    }
    return inPlace.value;
  }

  /** Pick a pose at random from the current filtered set. */
  function applyRandomPose(): void {
    const pool = visiblePoses.value;
    if (pool.length === 0) {
      poseError.value = "No poses match the current filter.";
      return;
    }
    // A seed derived from the current filter and time gives a different pick
    // per press while staying reproducible for a test.
    const seed = (randomSeedCounter += 1) + pool.length * 7919;
    const pick = pool[randomPoseIndex(pool.length, seed)];
    if (pick) applyPose(pick);
  }

  let randomSeedCounter = 0;

  const thumbnails = ref<Record<string, string>>({});

  async function loadThumbnails(): Promise<void> {
    // Thumbnails are real FBX renders, so they resolve asynchronously. Build
    // the map once every tile has settled; a model that cannot be rendered
    // (no WebGL, missing file) simply gets no entry and shows its placeholder.
    const entries = await Promise.all(
      MODEL_CATALOG.map(async (config) => {
        const url = await modelThumbnail(config);
        return [config.id, url] as const;
      }),
    );
    const next: Record<string, string> = {};
    for (const [id, url] of entries) {
      if (url) next[id] = url;
    }
    thumbnails.value = next;
  }

  // Frame the camera on everything currently in the scene so newly added
  // models are actually visible instead of sitting off-screen.
  function frameScene(): void {
    const vp = viewport.value;
    if (!vp || models.value.length === 0) return;

    const box = new THREE.Box3();
    for (const m of models.value) {
      // SkinnedMesh bounds come from the bind-pose geometry, so refresh the
      // skeleton first or the frame will be computed against stale vertices.
      m.root.updateMatrixWorld(true);
      box.expandByObject(m.root, true);
    }
    if (box.isEmpty()) return;
    vp.environment.frame(box, vp.controls);
  }

  /**
   * TEMPORARY diagnostic for "model loaded but not visible".
   *
   * Reads the live scene rather than anything cached, so the numbers describe
   * what is actually about to be rendered. Removed once the cause is fixed.
   */
  function modelDebug(): string {
    const vp = viewport.value;
    if (!vp || models.value.length === 0) return "no models";
    const m = models.value[0];
    m.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m.root);
    const f = (n: number) => n.toFixed(2);
    const cam = vp.camera.position;
    const empty = box.isEmpty();
    return [
      `count=${models.value.length}`,
      `box=${empty ? "EMPTY" : `${f(box.min.x)},${f(box.min.y)},${f(box.min.z)}..${f(box.max.x)},${f(box.max.y)},${f(box.max.z)}`}`,
      `h=${empty ? "n/a" : f(box.max.y - box.min.y)}`,
      `rootPos=${f(m.root.position.x)},${f(m.root.position.y)},${f(m.root.position.z)}`,
      `rootScale=${f(m.root.scale.x)}`,
      `visible=${m.root.visible}`,
      `bones=${m.skeleton.getBoneNames().length}`,
      `cam=${f(cam.x)},${f(cam.y)},${f(cam.z)}`,
    ].join(" ");
  }

  const fov = ref(50);
  const light = ref<LightState>({
    azimuth: 40,
    elevation: 55,
    intensity: 2.4,
    distance: 9,
    castShadows: true,
  });
  const grid = ref<GridState>({
    visible: true,
    cellSize: 1,
    divisions: 40,
    opacity: 0.55,
  });
  const lightGizmoVisible = ref(true);

  // ------------------------------------------------- Phase 4a: camera control

  const cameraLocked = ref(false);
  const cameraPresetName = ref("");
  const cameraError = ref<string | null>(null);

  function toggleCameraLock(): void {
    const rig = viewport.value?.cameraRig;
    if (!rig) return;
    cameraLocked.value = rig.toggleLock();
  }

  function resetCamera(): void {
    const rig = viewport.value?.cameraRig;
    if (!rig) return;
    rig.reset();
    fov.value = viewport.value?.environment.getFov() ?? fov.value;
  }

  /**
   * Park the current framing under a name.
   *
   * Upserting by name rather than appending is what makes pressing Save twice
   * safe: the second press updates the first instead of leaving a duplicate the
   * artist then has to delete.
   */
  function saveCameraPreset(name?: string): boolean {
    const rig = viewport.value?.cameraRig;
    const prefsApi = usePreferences();
    const finalName = (name ?? cameraPresetName.value).trim();
    if (!rig || !finalName) {
      cameraError.value = "Give the camera preset a name first.";
      return false;
    }
    prefsApi.set(
      "cameraPresets",
      upsertPreset(prefsApi.prefs.value.cameraPresets, rig.current(finalName)),
    );
    cameraPresetName.value = "";
    cameraError.value = null;
    return true;
  }

  function applyCameraPreset(pose: CameraPose): void {
    const rig = viewport.value?.cameraRig;
    if (!rig) return;
    rig.apply(pose);
    fov.value = viewport.value?.environment.getFov() ?? pose.fov;
  }

  function deleteCameraPreset(name: string): void {
    const prefsApi = usePreferences();
    prefsApi.set(
      "cameraPresets",
      removePreset(prefsApi.prefs.value.cameraPresets, name),
    );
  }

  /**
   * Capture the viewport as it looks right now.
   *
   * Distinct from an export pass on purpose: this includes the grid, light
   * gizmo and prop helpers, which export deliberately hides.
   */
  function takeScreenshot(): string | null {
    return viewport.value?.cameraRig.screenshot() ?? null;
  }
  function setFov(degrees: number): void {
    viewport.value?.environment.setFov(degrees);
    fov.value = viewport.value?.environment.getFov() ?? degrees;
  }

  function setLight(partial: Partial<LightState>): void {
    viewport.value?.environment.setLight(partial);
    light.value = viewport.value?.environment.getLight() ?? light.value;
  }

  function setGrid(partial: Partial<GridState>): void {
    viewport.value?.environment.setGrid(partial);
    grid.value = viewport.value?.environment.getGrid() ?? grid.value;
  }

  function setLightGizmo(visible: boolean): void {
    viewport.value?.environment.setLightGizmoVisible(visible);
    lightGizmoVisible.value =
      viewport.value?.environment.lightGizmoVisible ?? visible;
  }

  function init(): void {
    if (!mount.value) return;
    const vp = new Viewport(mount.value);
    viewport.value = vp;

    const pc = new PoseController(
      vp.renderer.domElement,
      vp.camera,
      vp.controls,
    );
    pc.onSelect = (name) => {
      selectedBone.value = name;
    };
    // While a prop is waiting for a joint, a viewport click picks the joint
    // instead of selecting a bone. The handles do the picking, so the target
    // is guaranteed to be a joint the artist can actually see.
    pc.onViewportClick = (event) => {
      const vp = viewport.value;
      if (!vp) return;
      const rect = vp.renderer.domElement.getBoundingClientRect();
      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, vp.camera);
      if (attachModeFor.value !== null) {
        const handles = jointHandles.value;
        if (!handles) return true;
        attachPendingPropToBone(handles.pickBone(raycaster, DEFAULT_PICK_RADIUS));
        return true;
      }

      const objects = selectableObjects();
      const hit = raycaster.intersectObjects(objects.map((object) => object.root), true)[0];
      const selected = hit
        ? objects.find(({ root }) => {
            let node: THREE.Object3D | null = hit.object;
            while (node && node !== root) node = node.parent;
            return node === root;
          })
        : undefined;
      const model = selected && models.value.find((item) => item.instanceId === selected.id);
      if (model) {
        setActive(model.config.id);
        selectObject(model.instanceId);
      } else {
        selectObject(selected?.id ?? null);
        setActive(null);
      }
    };
    vp.scene.add(pc.helper);
    controller.value = pc;

    // Phase 1: a second gizmo for whole-object translate/rotate/scale. The
    // bone gizmo above stays for FK joint rotation; the two never share a
    // TransformControls instance because their spaces are incompatible.
    const oc = new ObjectController(
      vp.renderer.domElement,
      vp.camera,
      vp.controls,
    );
    // History is pushed on drag end, not per frame, so one drag is one undo.
    oc.onChange = () => {
      gizmoDirty.value = true;
    };
    vp.scene.add(oc.helper);
    objectController.value = oc;

    // Visible joint handles. PoseMy.Art draws a sphere on every joint and
    // blinks them while Attach to Joint is live; these are the click targets
    // that make the mode usable at all, and they stay available as a plain
    // toggle so an artist can see what they are aiming at while posing.
    const handles = new JointHandles();
    vp.scene.add(handles.object);
    jointHandles.value = handles;

    // Clip playback advances on the render loop's clock. The gizmo check turns
    // a finished drag into exactly one history entry: objectChange fires on
    // every frame of the drag, so we wait until dragging stops and commit once.
    vp.onFrame = (delta) => {
      updateClip(delta);
      // Anchors run after IK and before the frame is presented, so an anchored
      // joint wins over a solution being dragged.
      updateAnchors();
      // Handles follow the pose, so they re-place after every frame that moved
      // something rather than only on attach.
      jointHandles.value?.sync();
      if (gizmoDirty.value && !objectController.value?.dragging) {
        gizmoDirty.value = false;
        commit();
      }
    };
    vp.start();
    status.value = "running";

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__poseify = {
        scene: vp.scene,
        camera: vp.camera,
        renderer: vp.renderer,
        controller: pc,
      };
    }
  }

  function dispose(): void {
    jointHandles.value?.dispose();
    objectController.value?.dispose();
    controller.value?.dispose();
    viewport.value?.dispose();
    objectController.value = null;
    controller.value = null;
    viewport.value = null;
  }

  const exporting = ref(false);
  const exportResults = ref<ExportResult[]>([]);
  const exportError = ref<string | null>(null);
  const exportSize = ref(2048);
  // Width and height are separate because a reference image is often not
  // square: a 16:9 crop for a background plate or a tall portrait crop both
  // come up, and a single slider could not express either.
  const exportWidth = ref(2048);
  const exportHeight = ref(2048);
  // Live depth preview: iterate on a composition's depth without exporting.
  const depthPreview = ref(false);

  function setDepthPreview(on: boolean): void {
    const vp = viewport.value;
    if (!vp) return;
    depthPreview.value = vp.setDepthPreview(on);
  }

  function toggleDepthPreview(): void {
    setDepthPreview(!depthPreview.value);
  }
  const exportTransparent = ref(false);

  /**
   * Scene furniture to hide while exporting: the ground grid, the light
   * gizmo, and any model that is not the one being exported.
   */
  function helperObjects(): THREE.Object3D[] {
    const vp = viewport.value;
    if (!vp) return [];
    const active = models.value.find((m) => m.config.id === activeModelId.value);
    const out: THREE.Object3D[] = [];
    for (const child of vp.scene.children) {
      if (child.name === "Ground" || child.name === "LightGizmo") {
        out.push(child);
      } else if (child.type === "Group" && child !== active?.root) {
        out.push(child);
      }
    }
    return out;
  }

  async function runExport(
    passes = RENDER_PASSES,
  ): Promise<ExportResult[]> {
    const vp = viewport.value;
    const active = models.value.find((m) => m.config.id === activeModelId.value);
    if (!vp || !active) {
      exportError.value = "Add and select a model before exporting.";
      return [];
    }

    exporting.value = true;
    exportError.value = null;
    try {
      const results = exportPasses(
        {
          renderer: vp.renderer,
          scene: vp.scene,
          camera: vp.camera,
          skeleton: active.skeleton,
          helpers: helperObjects(),
        },
        {
          passes,
          options: {
            width: exportWidth.value,
            height: exportHeight.value,
            transparent: exportTransparent.value,
            hideHelpers: true,
          },
          name: active.config.id,
        },
      );
      exportResults.value = results;
      return results;
    } catch (err) {
      exportError.value = err instanceof Error ? err.message : String(err);
      return [];
    } finally {
      exporting.value = false;
    }
  }

  function exportObjNow(): ReturnType<typeof exportModelObj> | null {
    const active = models.value.find((m) => m.config.id === activeModelId.value);
    if (!active) {
      exportError.value = "Add and select a model before exporting.";
      return null;
    }
    if (!active.config.exportable) {
      exportError.value = `${active.config.name} is not available for OBJ export.`;
      return null;
    }
    exportError.value = null;
    return exportModelObj(active.skeleton, active.config.id);
  }

  /**
   * Export the whole scene to OBJ, models and props together.
   *
   * Hidden objects are excluded: an OBJ is a baked snapshot of what the artist
   * can currently see, and a hidden figure still exporting would be a silent
   * surprise. Figure-only export stays available as exportObjNow.
   */
  function exportSceneObjNow(): ObjExportResult | null {
    const sources: SceneObjSource[] = [];
    for (const m of models.value) {
      if (isHidden(m.root)) continue;
      if (!m.config.exportable) continue;
      sources.push({ name: m.config.id, root: m.skeleton.root });
    }
    for (const p of props.value) {
      if (isHidden(p.root)) continue;
      sources.push({ name: p.config.id || p.config.name, root: p.root });
    }
    if (sources.length === 0) {
      exportError.value =
        "Nothing visible to export. Add a model or prop and make sure it is not hidden.";
      return null;
    }
    exportError.value = null;
    const text = exportSceneObj(sources, {
      name: sceneName.value.replace(/[^\w.-]+/g, "-") || "poseify-scene",
    });
    return {
      filename: `${sceneName.value.replace(/[^\w.-]+/g, "-") || "poseify-scene"}.obj`,
      text,
      vertexCount: (text.match(/^v /gm) ?? []).length,
      faceCount: (text.match(/^f /gm) ?? []).length,
    };
  }

  /** Trigger a browser download for a PNG data URL or a text payload. */
  function download(filename: string, payload: string): void {
    const blob = payload.startsWith("data:")
      ? dataUrlToBlob(payload)
      : new Blob([payload], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoke on the next tick so the click has been handled.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function clearExport(): void {
    exportResults.value = [];
    exportError.value = null;
  }

  // -------------------------------------------------------------- poses

  const poseSearch = ref("");
  const poseTagFilter = ref<string[]>([]);
  const appliedPoseId = ref<string | null>(null);
  const poseError = ref<string | null>(null);
  const poseThumbs = ref<Record<string, string>>({});
  // Phase 2: apply a pose without its rootOffset, for figures the artist has
  // already positioned by hand.
  const inPlace = ref(false);
  // The last library pose applied, so In Place can re-apply it with or without
  // its root drop rather than needing the artist to re-pick it.
  const lastPose = shallowRef<Pose | null>(null);

  // Vendor pose library: the creator-approved scrape, fetched once. Kept as a
  // separate source rather than merged into the local libraries so the picker
  // can show where a pose came from and so a missing vendor payload degrades
  // to the 1,298 local poses instead of emptying the picker.
  const vendorPoseIndex = shallowRef<readonly VendorPoseSummary[]>([]);
  const vendorPoseError = ref<string | null>(null);

  async function loadVendorPoseLibrary(): Promise<void> {
    try {
      vendorPoseIndex.value = await loadVendorPoseIndex();
      vendorPoseError.value = null;
    } catch (err) {
      vendorPoseError.value = err instanceof Error ? err.message : String(err);
    }
  }

  /** Categories the vendor library actually contains, for the filter UI. */
  const vendorPoseTags = computed(() => vendorPoseCategories(vendorPoseIndex.value));

  /**
   * Vendor poses matching the current search and tag filter.
   *
   * A separate list from visiblePoses because each row needs its own async
   // load: the index carries metadata only, and the rotations live in a
   // per-pose file fetched on click.
   */
  const visibleVendorPoses = computed(() =>
    // The vendor search takes one category, not a list, so the multi-tag
    // filter is applied afterwards rather than being flattened into one string.
    searchVendorPoses(
      vendorPoseIndex.value,
      poseSearch.value,
      poseTagFilter.value.length === 1 ? poseTagFilter.value[0] : undefined,
    ).filter(
      (row) =>
        poseTagFilter.value.length <= 1 ||
        poseTagFilter.value.some((tag) =>
          row.category.toLowerCase().split(",").some((c) => c.trim() === tag),
        ),
    ),
  );

  /** Fetch one vendor pose and apply it to the active model. */
  async function applyVendorPose(summary: VendorPoseSummary): Promise<boolean> {
    const active = models.value.find((m) => m.config.id === activeModelId.value);
    if (!active) {
      poseError.value = "Add and select a model first.";
      return false;
    }
    try {
      const pose = await loadVendorPose(summary);
      const known = new Set(active.skeleton.getBoneNames());
      const unknown = Object.keys(pose.bones).filter((b) => !known.has(b));
      if (unknown.length > 0) {
        poseError.value =
          `${active.config.name} cannot take "${pose.name}": ` +
          `missing ${unknown.length} bone(s) (${unknown.slice(0, 3).join(", ")}).`;
        return false;
      }
      active.skeleton.applyPose(pose.bones);
      appliedPoseId.value = pose.id;
      poseError.value = null;
      commit();
      return true;
    } catch (err) {
      poseError.value = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  /** Thumbnail URL for a vendor pose, or null when the scrape missed it. */
  function vendorThumb(summary: VendorPoseSummary): string | null {
    return vendorPoseThumb(summary);
  }
  const allPoseTags = computed(() => collectTags(POSE_LIBRARY));

  const visiblePoses = computed(() =>
    filterPoses(POSE_LIBRARY, {
      search: poseSearch.value,
      tags: poseTagFilter.value,
    }),
  );

  function togglePoseTag(tag: string): void {
    const current = poseTagFilter.value;
    poseTagFilter.value = current.includes(tag)
      ? current.filter((t) => t !== tag)
      : [...current, tag];
  }

  /**
   * Apply a pose to the active model.
   *
   * Bones the model lacks are reported rather than silently dropped: a
   * non-humanoid cannot take a humanoid pose, and the artist needs to know why
   * nothing happened.
   */
  function applyPose(pose: Pose): boolean {
    const active = models.value.find((m) => m.config.id === activeModelId.value);
    if (!active) {
      poseError.value = "Add and select a model first.";
      return false;
    }

    const known = new Set(active.skeleton.getBoneNames());
    const check = validatePose(pose, known);
    if (!check.ok) {
      const shown = check.unknownBones.slice(0, 3).join(", ");
      const more = check.unknownBones.length > 3 ? ", ..." : "";
      poseError.value =
        `${active.config.name} cannot take "${pose.name}": ` +
        `missing ${check.unknownBones.length} bone(s) (${shown}${more}).`;
      return false;
    }

    // In Place drops the root offset so a seated or kneeling pose does not
    // teleport a figure the artist has already positioned.
    active.skeleton.applyPose(pose.bones, inPlace.value ? undefined : pose.rootOffset);
    appliedPoseId.value = pose.id;
    lastPose.value = pose;
    poseError.value = null;
    commit();
    return true;
  }

  /** Render thumbnails for the poses currently visible in the picker. */
  async function loadPoseThumbnails(poses: readonly Pose[]): Promise<void> {
    const thumbnailer = poseThumbnailer();
    const next = { ...poseThumbs.value };
    for (const pose of poses) {
      if (next[pose.id]) continue;
      const url = await thumbnailer.thumbnail(pose);
      if (url) next[pose.id] = url;
    }
    poseThumbs.value = next;
  }

  // ---------------------------------------------------------- animations

  const clipSummaries = ref<ClipSummary[]>([]);
  const clipSearch = ref("");
  const clipError = ref<string | null>(null);
  const playing = ref(false);
  const clipTime = ref(0);
  const clipDuration = ref(0);
  const clipFrame = ref(0);
  const activeClipId = ref<string | null>(null);
  const clipPlayer = new ClipPlayer();

  const visibleClips = computed(() =>
    filterClips(clipSummaries.value as unknown as AnimationClip[], {
      search: clipSearch.value,
    }),
  );

  /** Load the clip manifest so the picker can list every clip. */
  async function loadClips(): Promise<void> {
    clipError.value = null;
    const library = await loadClipLibrary();
    clipSummaries.value = library.clips;
    if (library.clips.length === 0) {
      clipError.value =
        "No motion clips found. Run `npm run clips:build` to fetch and convert them.";
    }
  }

  /** Push a clip frame onto the active model as a static pose. */
  function applyFrame(frame: {
    rotations: Record<string, [number, number, number, number]>;
  }): void {
    const active = models.value.find((m) => m.config.id === activeModelId.value);
    if (!active) return;
    active.skeleton.applyPose(frame.rotations);
  }

  async function selectClip(id: string): Promise<boolean> {
    clipError.value = null;
    const ok = await clipPlayer.load(id);
    if (!ok) {
      clipError.value = `Could not load clip ${id}.`;
      return false;
    }
    activeClipId.value = id;
    clipDuration.value = clipPlayer.duration;
    clipTime.value = 0;
    clipFrame.value = 0;

    clipPlayer.onFrame = (frame, index) => {
      applyFrame(frame);
      clipFrame.value = index;
    };
    // Show the first frame immediately so selecting a clip previews it.
    const first = clipPlayer.currentFrame();
    if (first) applyFrame(first);
    return true;
  }

  function togglePlayback(): void {
    if (!activeClipId.value) return;
    clipPlayer.toggle();
    playing.value = clipPlayer.playing;
  }

  function stopPlayback(): void {
    clipPlayer.stop();
    playing.value = false;
    clipTime.value = 0;
  }

  /** Scrub. The frozen frame stays applied as a static pose. */
  function seekClip(seconds: number): void {
    clipPlayer.seek(seconds);
    clipTime.value = clipPlayer.time;
    playing.value = clipPlayer.playing;
  }

  function stepClip(frames: number): void {
    clipPlayer.step(frames);
    clipTime.value = clipPlayer.time;
    playing.value = clipPlayer.playing;
  }

  /** Advance playback; called from the render loop. */
  function updateClip(deltaSeconds: number): void {
    if (!clipPlayer.playing) return;
    clipPlayer.update(deltaSeconds);
    clipTime.value = clipPlayer.time;
    playing.value = clipPlayer.playing;
  }

  // --------------------------------------------------------------- props

  const props = ref<PlacedProp[]>([]);
  const selectedPropId = ref<string | null>(null);
  const propError = ref<string | null>(null);
  const imagePlanes = ref<ImagePlaneEntry[]>([]);

  /** Add a built-in prop, centred and resting on the floor. */
  function addProp(config: PropConfig): PlacedProp | null {
    const vp = viewport.value;
    if (!vp) return null;
    propError.value = null;

    try {
      const root = buildProp(config.procedural!);
      // Offset along X so several props do not stack on one another.
      root.position.x = props.value.length * 0.9;
      centreOnOrigin(root);
      vp.scene.add(root);

      const placed: PlacedProp = {
        id: `${config.id}_${props.value.length}`,
        config,
        root,
        attach: null,
      };
      props.value = [...props.value, placed];
      selectedPropId.value = placed.id;
      commit();
      return placed;
    } catch (err) {
      propError.value = err instanceof Error ? err.message : String(err);
      return null;
    }
  }

  /** Add a prop from a user-supplied OBJ or GLB file. */
  async function addPropFromFile(file: File): Promise<void> {
    const vp = viewport.value;
    if (!vp) return;
    propError.value = null;
    try {
      const root = await loadPropFromFile(file);
      root.position.x = props.value.length * 0.9;
      centreOnOrigin(root);
      vp.scene.add(root);

      const placed: PlacedProp = {
        id: `imported_${props.value.length}`,
        config: {
          id: file.name,
          name: file.name,
          family: "imported",
          tags: ["imported"],
          size: [1, 1, 1],
        },
        root,
        attach: null,
      };
      props.value = [...props.value, placed];
      selectedPropId.value = placed.id;
      commit();
    } catch (err) {
      propError.value = err instanceof Error ? err.message : String(err);
    }
  }

  // Vendor props: the creator-approved scrape, loaded on demand from FBX. A
  // separate list from the procedural catalogue so the picker can group them
  // and so a missing asset leaves the built-ins working.
  const vendorPropSearch = ref("");
  const vendorPropFamily = ref<string | null>(null);

  /** Vendor prop families, for the group filter. */
  const vendorPropFamilies = computed(() => {
    const set = new Set<string>();
    for (const entry of VENDOR_PROP_CATALOG) {
      // A prop can belong to several families ("Environment,Building"); take
      // them all rather than arbitrarily picking the first.
      for (const part of entry.family.split(",")) {
        const name = part.trim();
        if (name) set.add(name);
      }
    }
    return [...set].sort();
  });

  const visibleVendorProps = computed(() => {
    const needle = vendorPropSearch.value.trim().toLowerCase();
    return VENDOR_PROP_CATALOG.filter((entry) => {
      if (
        vendorPropFamily.value &&
        !entry.family.split(",").some((f) => f.trim() === vendorPropFamily.value)
      ) {
        return false;
      }
      if (!needle) return true;
      return (
        entry.name.toLowerCase().includes(needle) ||
        entry.tags.some((t) => t.toLowerCase().includes(needle))
      );
    });
  });

  /** Thumbnail for a vendor prop, or null when the scrape missed it. */
  function vendorPropThumb(entry: VendorPropEntry): string | null {
    if (!entry.hasThumb) return null;
    return `${VENDOR_PROP_THUMB_BASE}/${entry.slug}.png`;
  }

  /**
   * Load and place a vendor prop.
   *
   * FBXLoader is dynamically imported inside the loader, so the picker stays
   * cheap until one of these is actually clicked.
   */
  async function addVendorProp(entry: VendorPropEntry): Promise<void> {
    const vp = viewport.value;
    if (!vp) return;
    propError.value = null;
    try {
      const { loadModelFromURL } = await import("../models/ModelLoader");
      const loaded = await loadModelFromURL(`${VENDOR_PROP_BASE}/${entry.file}`, {
        renderer: vp.renderer,
      });
      const root = loaded.root;
      // Fan new props out so several do not stack inside one another.
      root.position.x = props.value.length * 0.9;
      centreOnOrigin(root);
      snapToFloor(root);
      vp.scene.add(root);

      const placed: PlacedProp = {
        id: `${entry.id}_${props.value.length}`,
        config: {
          id: entry.id,
          name: entry.name.trim(),
          family: entry.family.split(",")[0].trim() || "vendor",
          tags: entry.tags,
          size: [1, 1, 1],
          procedural: undefined,
          path: `${VENDOR_PROP_BASE}/${entry.file}`,
        },
        root,
        attach: null,
      };
      props.value = [...props.value, placed];
      selectedPropId.value = placed.id;
      commit();
    } catch (err) {
      propError.value = err instanceof Error ? err.message : String(err);
    }
  }
  function removeProp(id: string): void {
    const vp = viewport.value;
    const placed = props.value.find((p) => p.id === id);
    if (!placed || !vp) return;
    // An attached prop is a child of a bone, not of the scene, so removing it
    // from the scene would silently leave it riding the figure.
    if (!detachPropFromBone(placed.root)) vp.scene.remove(placed.root);
    if (attachModeFor.value === id) stopAttachMode();
    props.value = props.value.filter((p) => p.id !== id);
    if (selectedPropId.value === id) selectedPropId.value = null;
    commit();
  }

  /** Re-drop a prop onto the floor after it has been moved. */
  function dropPropToFloor(id: string): void {
    const placed = props.value.find((p) => p.id === id);
    if (placed) snapToFloor(placed.root);
  }

  // ------------------------------------------ attach a prop to a joint

  /** The prop currently waiting for a joint, or null. */
  const attachingProp = computed<PlacedProp | null>(
    () => props.value.find((p) => p.id === attachModeFor.value) ?? null,
  );

  /** True while the viewport is waiting for a joint click. */
  const attachModeActive = computed(() => attachModeFor.value !== null);

  /**
   * The selected prop when it could actually be attached, else null.
   *
   * The toolbar button binds to this so it disappears for a model and for the
   * no-model case, rather than sitting disabled and implying a bug.
   */
  const attachableSelectedProp = computed<PlacedProp | null>(() => {
    if (!activeModelId.value) return null;
    const id = selectedObjectId.value;
    if (!id) return null;
    return props.value.find((p) => p.id === id) ?? null;
  });

  /** Keep the handles pointed at whatever is active. */
  function refreshHandles(): void {
    const handles = jointHandles.value;
    if (!handles) return;
    handles.setSkeleton(activeSkeleton());
    // Keep pose handles visible by default; attach mode forces them on too.
    handles.setVisible(jointHandlesVisible.value || attachModeFor.value !== null);
    handles.setHighlighted(attachModeFor.value !== null);
  }

  /**
   * Enter attach mode for a prop, or detach it if it is already pinned.
   *
   * One button for both, matching PoseMy.Art: the label is derived from
   * whether the prop currently has an attach record, so the artist never has
   * to remember which of the two a prop is in.
   */
  function toggleAttachToJoint(id: string): boolean {
    const placed = props.value.find((p) => p.id === id);
    const skeleton = activeSkeleton();
    if (!placed) return false;
    if (!skeleton) {
      attachError.value = "Add and select a model first.";
      return false;
    }

    if (placed.attach) {
      detachPropFromBone(placed.root);
      placed.attach = null;
      viewport.value?.scene.add(placed.root);
      stopAttachMode();
      attachError.value = null;
      attachStatus.value = `Detached ${placed.config.name} from ${placed.root.userData.lastAttachBone ?? "the joint"}`;
      commit();
      return true;
    }

    // Store the bone name for the status line before the attach overwrites the
    // userData slot detach reads it back from.
    placed.root.userData.lastAttachBone = "";
    attachModeFor.value = id;
    attachError.value = null;
    attachStatus.value = `Pick a joint for ${placed.config.name}`;
    refreshHandles();
    // The prop gizmo would fight the joint click for the pointer.
    objectController.value?.detach();
    return true;
  }

  /** Leave attach mode without changing anything. */
  function stopAttachMode(): void {
    attachModeFor.value = null;
    attachStatus.value = null;
    refreshHandles();
  }

  /**
   * Pin the pending prop to the bone the user just clicked.
   *
   * Reports the missing bone by name when the click did not land on one, since
   * "nothing happened" is the worst possible feedback here.
   */
  function attachPendingPropToBone(boneName: string | null): boolean {
    const placed = attachingProp.value;
    const skeleton = activeSkeleton();
    if (!placed || !skeleton) return false;
    if (!boneName) {
      attachError.value = "Click one of the highlighted joints to attach.";
      return false;
    }
    const bone = skeleton.getBone(boneName);
    if (!bone) {
      attachError.value = `${skeleton.config.name} has no joint called ${boneName}.`;
      return false;
    }
    // A prop already riding one bone must leave it first, or a re-attach would
    // nest a bone inside a bone. Harmless when it is a plain scene child.
    detachPropFromBone(placed.root);
    placed.attach = attachPropToBone(placed.root, bone);
    placed.root.userData.lastAttachBone = boneName;
    attachModeFor.value = null;
    attachError.value = null;
    attachStatus.value = `${placed.config.name} attached to ${boneName}`;
    refreshHandles();
    commit();
    return true;
  }

  /** Show or hide the joint handles without entering attach mode. */
  function setJointHandlesVisible(visible: boolean): void {
    jointHandles.value?.setVisible(visible || attachModeFor.value !== null);
    jointHandlesVisible.value = visible;
  }

  const jointHandlesVisible = ref(true);

  // ------------------------------------------- Phase 1: object-level operations

  function setObjectGizmoMode(next: ObjectGizmoMode): void {
    objectGizmoMode.value = next;
    objectController.value?.setMode(next);
  }

  /**
   * Select an object and attach the object gizmo to it.
   *
   * A locked object can be selected (so it can be unlocked again) but the
   * gizmo refuses to attach, which is the enforcement point for Lock.
   */
  function selectObject(id: string | null): void {
    selectedObjectId.value = id;
    const found = findSelectedObject(id);
    objectController.value?.attach(found ? found.root : null);
    if (!id && found?.prop) selectedPropId.value = null;
  }

  /** Toggle Show on the selected object. */
  function toggleObjectHidden(): void {
    const found = findSelectedObject(selectedObjectId.value);
    if (!found) return;
    setHidden(found.root, !isHidden(found.root));
    touchObjectState();
    commit();
  }

  /** Toggle Lock on the selected object. */
  function toggleObjectLocked(): void {
    const found = findSelectedObject(selectedObjectId.value);
    if (!found) return;
    const next = !isLocked(found.root);
    setLocked(found.root, next);
    touchObjectState();
    // Unlocking must re-attach the gizmo or the object stays inert until the
    // artist clicks it again.
    if (!next) objectController.value?.attach(found.root);
    else objectController.value?.detach();
    commit();
  }

  /** Recolor the selected object. Passing null clears the override. */
  function setSelectedObjectColor(color: string | null): void {
    const found = findSelectedObject(selectedObjectId.value);
    if (!found) return;
    if (color) setObjectColor(found.root, color);
    else clearObjectColor(found.root);
    touchObjectState();
    commit();
  }

  /**
   * Duplicate the selected model, including its current pose.
   *
   * A SkinnedMesh cannot share one Skeleton instance with a second hierarchy
   * without cross-driving bones, so the duplicate gets its own PosableSkeleton
   * and the source pose is copied onto it. Props duplicate as a plain clone.
   */
  function duplicateSelectedObject(): void {
    const vp = viewport.value;
    const found = findSelectedObject(selectedObjectId.value);
    if (!vp || !found) return;

    if (found.prop) {
      const clone = found.prop.root.clone(true);
      clone.position.x += duplicateOffset(found.prop.root);
      vp.scene.add(clone);
      props.value = [
        ...props.value,
        {
          id: `${found.prop.config.id}_${props.value.length}`,
          config: found.prop.config,
          root: clone,
        },
      ];
      commit();
      return;
    }

    if (!found.model) return;
    const source = found.model;
    const cloneRoot = objectController.value
      ? objectController.value.duplicateObject(source.root, duplicateOffset(source.root))
      : source.root.clone(true);
    vp.scene.add(cloneRoot);

    const skeleton = new PosableSkeleton(cloneRoot, source.config, {
      requireHands: false,
      bindHands: true,
    });
    // Copy the pose so the duplicate is visibly a second *posed* instance.
    skeleton.applyPose(source.skeleton.getPose(), 0);
    models.value = [
      ...models.value,
      {
        config: source.config,
        skeleton,
        root: cloneRoot,
        instanceId: nextModelInstanceId(source.config.id),
      },
    ];
    commit();
  }

  /** Delete the selected object, model or prop. */
  function deleteSelectedObject(): void {
    const found = findSelectedObject(selectedObjectId.value);
    if (!found) return;
    if (found.prop) removeProp(found.prop.id);
    else if (found.model) removeModel(found.model.instanceId);
    selectObject(null);
  }

  /**
   * Place a prop at a figure contact point, snapped to the floor. This is what
   * makes "sitting on the chair" work without hand placement.
   */
  function placePropAtBone(
    propId: string,
    boneName: string,
    offset = 0.6,
  ): boolean {
    const placed = props.value.find((p) => p.id === propId);
    const active = models.value.find((m) => m.config.id === activeModelId.value);
    if (!placed || !active) return false;

    const anchor = active.skeleton.getWorldPosition(boneName, new THREE.Vector3());
    if (!anchor) {
      propError.value = `Unknown joint: ${boneName}`;
      return false;
    }

    placed.root.position.set(anchor.x + offset, 0, anchor.z);
    // Face across the figure rather than away from it.
    placed.root.rotation.y = Math.PI / 2;
    placed.root.updateMatrixWorld(true);
    snapToFloor(placed.root);
    return true;
  }

  /** Import an image as a 3D plane for composition and perspective checks. */
  async function addImagePlane(file: File, widthMetres = 2): Promise<void> {
    const vp = viewport.value;
    if (!vp) return;
    propError.value = null;
    const url = URL.createObjectURL(file);
    try {
      const result = await createImagePlane(url, { width: widthMetres });
      result.mesh.position.set(0, 1.2, -1.5);
      result.mesh.name = `ImagePlane_${imagePlanes.value.length}`;
      vp.scene.add(result.mesh);
      imagePlanes.value = [
        ...imagePlanes.value,
        { id: result.mesh.name, name: file.name, mesh: result.mesh },
      ];
    } catch (err) {
      propError.value = err instanceof Error ? err.message : String(err);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function removeImagePlane(id: string): void {
    const vp = viewport.value;
    const plane = imagePlanes.value.find((p) => p.id === id);
    if (!plane || !vp) return;
    vp.scene.remove(plane.mesh);
    (plane.mesh.material as THREE.Material).dispose();
    (plane.mesh.geometry as THREE.BufferGeometry).dispose();
    imagePlanes.value = imagePlanes.value.filter((p) => p.id !== id);
  }

  function setImagePlaneOpacity(id: string, opacity: number): void {
    const plane = imagePlanes.value.find((p) => p.id === id);
    if (plane) updateImagePlane(plane.mesh, { opacity });
  }

  /** Bounds of a placed prop, for framing and clearance. */
  function propBounds(id: string): THREE.Box3 | null {
    const placed = props.value.find((p) => p.id === id);
    return placed ? measure(placed.root) : null;
  }

  // -------------------------------------------------------------- scenes

  const sceneName = ref("Untitled");
  const savedScenes = ref<SceneSummary[]>([]);
  const canUndo = ref(false);
  const canRedo = ref(false);
  const sceneError = ref<string | null>(null);
  const history = new History<SceneState>({ limit: 80 });

  /** Capture the live scene as plain data. */
  function captureScene(): SceneState {
    const vp = viewport.value;
    const base = emptyScene(sceneName.value);
    return {
      ...base,
      name: sceneName.value,
      models: models.value.map((m) => ({
        id: m.config.id,
        pose: m.skeleton.getPose(),
        transform: {
          position: [m.root.position.x, m.root.position.y, m.root.position.z],
          rotation: [
            m.root.quaternion.x,
            m.root.quaternion.y,
            m.root.quaternion.z,
            m.root.quaternion.w,
          ],
          scale: [m.root.scale.x, m.root.scale.y, m.root.scale.z],
        },
        state: readObjectState(m.root),
      })),
      props: props.value.map((p) => ({
        id: p.config.procedural ?? null,
        name: p.config.name,
        transform: {
          position: [p.root.position.x, p.root.position.y, p.root.position.z],
          rotation: [
            p.root.quaternion.x,
            p.root.quaternion.y,
            p.root.quaternion.z,
            p.root.quaternion.w,
          ],
          scale: [p.root.scale.x, p.root.scale.y, p.root.scale.z],
        },
        state: readObjectState(p.root),
        attach: p.attach ?? undefined,
      })),
      camera: vp
        ? {
            position: [
              vp.camera.position.x,
              vp.camera.position.y,
              vp.camera.position.z,
            ],
            target: [
              vp.controls.target.x,
              vp.controls.target.y,
              vp.controls.target.z,
            ],
            fov: vp.camera.fov,
          }
        : base.camera,
      light: vp ? { ...vp.environment.getLight() } : base.light,
      grid: vp ? { ...vp.environment.getGrid() } : base.grid,
    };
  }

  /** Record the current state so the change can be undone. Call AFTER a change. */
  function commit(): void {
    history.push(captureScene());
    canUndo.value = history.canUndo;
    canRedo.value = history.canRedo;
  }

  function undo(): void {
    const state = history.undo();
    if (!state) return;
    void applyScene(state);
    canUndo.value = history.canUndo;
    canRedo.value = history.canRedo;
  }

  function redo(): void {
    const state = history.redo();
    if (!state) return;
    void applyScene(state);
    canUndo.value = history.canUndo;
    canRedo.value = history.canRedo;
  }

  /** Rebuild the scene from data. Models load asynchronously. */
  async function applyScene(state: SceneState): Promise<void> {
    const vp = viewport.value;
    if (!vp) return;
    sceneError.value = null;

    for (const m of models.value) vp.scene.remove(m.root);
    for (const p of props.value) vp.scene.remove(p.root);
    for (const plane of imagePlanes.value) vp.scene.remove(plane.mesh);
    models.value = [];
    props.value = [];
    imagePlanes.value = [];
    selectedPropId.value = null;
    selectObject(null);
    touchObjectState();

    sceneName.value = state.name || "Untitled";
    const missing: string[] = [];

    for (const spec of state.models) {
      const config = findModel(spec.id);
      if (!config) {
        missing.push(spec.id);
        continue;
      }
      try {
        const built = await loadModel(config, { renderer: vp.renderer });
        built.root.position.fromArray(spec.transform.position);
        built.root.quaternion.fromArray(spec.transform.rotation);
        built.root.scale.fromArray(spec.transform.scale);
        vp.scene.add(built.root);

        // Show/Lock/Colour restore before the skeleton binds so a hidden
        // figure is never briefly rendered at full opacity on load.
        if (spec.state?.hidden) setHidden(built.root, true);
        if (spec.state?.locked) setLocked(built.root, true);
        if (spec.state?.color) setObjectColor(built.root, spec.state.color);

        const skeleton = new PosableSkeleton(built.root, config, {
          requireHands: false,
          bindHands: true,
        });
        skeleton.applyPose(spec.pose, spec.rootOffset);
        models.value = [
          ...models.value,
          {
            config,
            skeleton,
            root: built.root,
            instanceId: nextModelInstanceId(config.id),
          },
        ];
      } catch (err) {
        // Surface why a model failed rather than only reporting it missing:
        // a silently empty scene is the hardest kind of bug to diagnose.
        missing.push(`${spec.id} (${err instanceof Error ? err.message : String(err)})`);
      }
    }

    for (const spec of state.props) {
      const config = spec.id ? findProp(spec.id) : undefined;
      if (!config) {
        missing.push(spec.id ?? spec.name ?? "prop");
        continue;
      }
      const root = buildProp(config.procedural!);
      root.position.fromArray(spec.transform.position);
      root.quaternion.fromArray(spec.transform.rotation);
      root.scale.fromArray(spec.transform.scale);
      if (spec.state?.hidden) setHidden(root, true);
      if (spec.state?.locked) setLocked(root, true);
      if (spec.state?.color) setObjectColor(root, spec.state.color);
      vp.scene.add(root);
      const placedProp: PlacedProp = {
        id: `${config.id}_${props.value.length}`,
        config,
        root,
        attach: null,
      };
      // Re-pin to the recorded joint. Models load before props in this
      // function, so the bone exists by the time an attach is applied.
      if (spec.attach) {
        const owner = models.value.find(
          (m) => m.skeleton.getBone(spec.attach!.bone) !== undefined,
        );
        const bone = owner?.skeleton.getBone(spec.attach.bone);
        if (bone && applySavedAttach(root, bone, spec.attach)) {
          placedProp.attach = spec.attach;
          root.userData.lastAttachBone = spec.attach.bone;
        } else {
          // The scene names a joint this model does not have. The prop still
          // loads, standing free, and says so rather than vanishing.
          missing.push(`${config.name} -> ${spec.attach.bone}`);
        }
      }
      props.value = [...props.value, placedProp];
    }

    vp.camera.position.fromArray(state.camera.position);
    vp.controls.target.fromArray(state.camera.target);
    vp.environment.setFov(state.camera.fov);
    vp.controls.update();

    vp.environment.setLight(state.light);
    vp.environment.setGrid(state.grid);
    fov.value = vp.environment.getFov();
    light.value = vp.environment.getLight();
    grid.value = vp.environment.getGrid();

    if (models.value.length > 0) setActive(models.value[0].config.id);

    if (missing.length > 0) {
      sceneError.value =
        `Scene loaded with ${missing.length} unavailable item(s): ` +
        missing.slice(0, 3).join(", ") +
        (missing.length > 3 ? ", ..." : "");
    }
  }

  // Phase 7: the generated scene library, fetched once and concatenated onto
  // the authored premade scenes.
  const generatedSceneList = shallowRef<readonly SceneState[]>([]);
  const sceneLibraryError = ref<string | null>(null);

  async function loadGeneratedSceneLibrary(): Promise<void> {
    try {
      generatedSceneList.value = await loadGeneratedScenes();
      sceneLibraryError.value = null;
    } catch (err) {
      sceneLibraryError.value = err instanceof Error ? err.message : String(err);
    }
  }

  /** Every loadable scene, authored first so curated setups lead the list. */
  // Vendor scenes: the creator-approved scrape. Listed separately from the
  // premade and generated scenes because each row costs a fetch, and a broken
  // one must not take the other 500-odd rows with it.
  const vendorSceneIndex = shallowRef<readonly VendorSceneSummary[]>([]);
  const vendorSceneError = ref<string | null>(null);

  async function loadVendorSceneLibrary(): Promise<void> {
    try {
      vendorSceneIndex.value = await loadVendorSceneIndex();
      vendorSceneError.value = null;
    } catch (err) {
      vendorSceneError.value = err instanceof Error ? err.message : String(err);
    }
  }

  const vendorSceneTags = computed(() =>
    vendorSceneCategories(vendorSceneIndex.value),
  );

  const visibleVendorScenes = computed(() =>
    searchVendorScenes(vendorSceneIndex.value, poseSearch.value),
  );

  /** Fetch one vendor scene and load it into the viewport. */
  async function applyVendorScene(summary: VendorSceneSummary): Promise<void> {
    sceneError.value = null;
    try {
      const { scene, skipped } = await loadVendorScene(summary.file, summary.name);
      await applyScene(scene);
      history.initial(captureScene());
      canUndo.value = false;
      canRedo.value = false;
      // Report rather than silently drop: a scene that loaded with a missing
      // prop looks like a bug in the app rather than in the source asset.
      if (skipped.length > 0) {
        sceneError.value =
          `Loaded with ${skipped.length} unsupported item(s): ` +
          skipped.slice(0, 2).join(", ") +
          (skipped.length > 2 ? ", ..." : "");
      }
    } catch (err) {
      sceneError.value = err instanceof Error ? err.message : String(err);
    }
  }
  const allPremadeScenes = computed<readonly SceneState[]>(() => [
    ...PREMADE_SCENES,
    ...generatedSceneList.value,
  ]);

  async function loadPremadeScene(name: string): Promise<void> {
    const scene = allPremadeScenes.value.find((s) => s.name === name);
    if (!scene) {
      sceneError.value = `Unknown scene: ${name}`;
      return;
    }
    await applyScene(scene);
    history.initial(captureScene());
    canUndo.value = false;
    canRedo.value = false;
  }

  function refreshSavedScenes(): void {
    savedScenes.value = listSavedScenes();
  }

  function saveCurrentScene(): boolean {
    const ok = saveScene(captureScene());
    if (!ok) sceneError.value = "Could not save the scene (storage unavailable).";
    refreshSavedScenes();
    return ok;
  }

  async function openSavedScene(name: string): Promise<void> {
    const state = loadStoredScene(name);
    if (!state) {
      sceneError.value = `Could not open "${name}".`;
      return;
    }
    await applyScene(state);
    history.initial(captureScene());
    canUndo.value = false;
    canRedo.value = false;
  }

  function deleteSavedScene(name: string): void {
    deleteScene(name);
    refreshSavedScenes();
  }

  function exportCurrentScene(): void {
    downloadScene(captureScene());
  }

  async function importSceneFile(file: File): Promise<void> {
    sceneError.value = null;
    try {
      const state = readSceneFile(await file.text());
      if (!state) {
        sceneError.value = "That file is not a valid Poseify scene.";
        return;
      }
      await applyScene(state);
      history.initial(captureScene());
      canUndo.value = false;
      canRedo.value = false;
    } catch {
      sceneError.value = "Could not read that file.";
    }
  }

  function handleHistoryKey(event: KeyboardEvent): void {
    const action = historyShortcut(event);
    if (action === "undo") {
      event.preventDefault();
      undo();
    } else if (action === "redo") {
      event.preventDefault();
      redo();
    }
  }

  // ---- M10: preferences, favourites and keyboard shortcuts ---------------
  const {
    prefs,
    isFavorite,
    toggleFavorite,
    set: setPref,
    completeOnboarding,
    restartOnboarding,
  } = usePreferences();

  const settingsOpen = ref(false);
  const showFavoritesOnly = ref(prefs.value.showFavoritesOnly);
  const tourStep = ref<number | null>(prefs.value.onboardingDone ? null : 0);

  const TOUR: readonly { title: string; body: string; target?: string }[] = [
    {
      title: "Welcome to Poseify",
      body: "Pick a model on the left, click a joint in the viewport to select it, then drag the ring to rotate.",
    },
    {
      title: "FK and IK",
      body: "FK rotates a single joint. Switch to IK and drag a hand or foot to solve the whole chain.",
      target: "mode",
    },
    {
      title: "Poses and clips",
      body: "Apply a pose, or scrub a CMU motion clip and freeze any frame as a static pose.",
      target: "poses",
    },
    {
      title: "Export",
      body: "Render Regular, OpenPose, Depth, Canny and Normals passes, or export the posed figure as OBJ.",
      target: "export",
    },
  ];

  function nextTourStep(): void {
    if (tourStep.value === null) return;
    if (tourStep.value >= TOUR.length - 1) {
      tourStep.value = null;
      completeOnboarding();
    } else {
      tourStep.value += 1;
    }
  }

  function prevTourStep(): void {
    if (tourStep.value === null || tourStep.value <= 0) return;
    tourStep.value -= 1;
  }

  function skipTour(): void {
    tourStep.value = null;
    completeOnboarding();
  }

  function replayTour(): void {
    // tourStep is its own ref, so clearing the preference alone would not
    // reopen the tour.
    restartOnboarding();
    tourStep.value = 0;
    settingsOpen.value = false;
  }

  function toggleFavoritesFilter(): void {
    showFavoritesOnly.value = !showFavoritesOnly.value;
    setPref("showFavoritesOnly", showFavoritesOnly.value);
  }

  function openSettings(): void {
    settingsOpen.value = !settingsOpen.value;
  }

  function deleteSelection(): void {
    // A selected prop wins over the active model; both are optional.
    if (selectedPropId.value) {
      removeProp(selectedPropId.value);
      return;
    }
    if (activeModelId.value) removeModel(activeModelId.value);
  }

  const catalogById = computed(
    () => new Map(MODEL_CATALOG.map((m) => [m.id, m])),
  );

  const favoriteModels = computed(() =>
    prefs.value.favorites
      .map((id) => catalogById.value.get(id))
      .filter((m): m is CatalogEntry => !!m),
  );

  function handleShortcutKey(event: KeyboardEvent): void {
    const action: ShortcutAction | null = resolveShortcut(event);
    if (!action) return;
    // Let the browser keep the chords we do not own.
    if (action !== "help") event.preventDefault();
    switch (action) {
      case "undo":
        undo();
        break;
      case "redo":
        redo();
        break;
      case "delete":
        deleteSelection();
        break;
      case "resetPose":
        if (activeModelId.value) resetPose();
        break;
      case "gizmoTranslate":
        setObjectGizmoMode("translate");
        break;
      case "gizmoRotate":
        setObjectGizmoMode("rotate");
        break;
      case "gizmoScale":
        setObjectGizmoMode("scale");
        break;
      case "duplicateObject":
        duplicateSelectedObject();
        break;
      case "toggleHidden":
        toggleObjectHidden();
        break;
      case "toggleLock":
        toggleObjectLocked();
        break;
      case "switchPoseSides":
        switchPoseSides();
        break;
      case "resetJoint":
        resetSelectedJoint();
        break;
      case "toggleFavorites":
        toggleFavoritesFilter();
        break;
      case "openSettings":
        openSettings();
        break;
      case "togglePlayback":
        if (activeClipId.value) togglePlayback();
        break;
      case "frameScene":
        frameScene();
        break;
      case "help":
        settingsOpen.value = true;
        break;
      case "cancelAttach":
        // Attach mode first: a half-finished attach should be abandonable
        // without also losing the prop the artist selected.
        if (attachModeFor.value !== null) {
          stopAttachMode();
          break;
        }
        selectObject(null);
        break;
    }
  }

  onBeforeUnmount(dispose);

  return {
    mount,
    status,
    error,
    mode,
    models,
    activeModelId,
    selectedBone,
    selectedObjectId,
    objectGizmoMode,
    boneNames,
    loadingId,
    hasRemoteModels,
    attachModeActive,
    attachingProp,
    attachableSelectedProp,
    attachError,
    attachStatus,
    jointHandlesVisible,
    toggleAttachToJoint,
    stopAttachMode,
    setJointHandlesVisible,
    fov,
    light,
    grid,
    lightGizmoVisible,
    setFov,
    cameraLocked,
    cameraPresetName,
    cameraError,
    toggleCameraLock,
    resetCamera,
    saveCameraPreset,
    applyCameraPreset,
    deleteCameraPreset,
    takeScreenshot,
    setLight,
    setGrid,
    setLightGizmo,
    catalog: MODEL_CATALOG,
    thumbnails,
    init,
    dispose,
    attachModel,
    setActive,
    activateModelWithPose,
    selectBone,
    selectObject,
    setObjectGizmoMode,
    duplicateSelectedObject,
    toggleObjectHidden,
    toggleObjectLocked,
    setSelectedObjectColor,
    selectableObjects,
    deleteSelectedObject,
    setMode,
    removeModel,
    resetPose,
    resetSelectedJoint,
    mirrorArmLimb,
    mirrorLegLimb,
    switchPoseSides,
    copyPose,
    pastePose,
    toggleInPlace,
    inPlace,
    applyRandomPose,
    clipboardStatus,
    jointGroups,
    anchors,
    groupableBones,
    groupDraftName,
    groupDraftBones,
    groupStatus,
    createGroup,
    deleteGroup,
    resetGroup,
    rotateGroup,
    anchorDraftBone,
    anchorDraftTarget,
    anchorDraftOffset,
    anchorError,
    createAnchor,
    deleteAnchor,
    handSide,
    setHandSide,
    handPoseError,
    handPoseStatus,
    handPoseSearch,
    visibleHandPoses,
    allHandTags,
    applyHandPose,
    copyHandPose,
    pasteHandOnly,
    resetHands,
    loadThumbnails,
    frameScene,
    modelDebug,
    RENDER_PASSES,
    exporting,
    exportResults,
    exportError,
    exportSize,
    exportWidth,
    exportHeight,
    depthPreview,
    setDepthPreview,
    toggleDepthPreview,
    exportTransparent,
    runExport,
    exportObjNow,
    exportSceneObjNow,
    download,
    clearExport,
    poseSearch,
    poseTagFilter,
    appliedPoseId,
    poseError,
    loadVendorPoseLibrary,
    vendorPoseIndex,
    vendorPoseError,
    vendorPoseTags,
    visibleVendorPoses,
    applyVendorPose,
    vendorThumb,
    poseThumbs,
    allPoseTags,
    visiblePoses,
    togglePoseTag,
    applyPose,
    loadPoseThumbnails,
    clipSummaries,
    clipSearch,
    clipError,
    playing,
    clipTime,
    clipDuration,
    clipFrame,
    activeClipId,
    visibleClips,
    loadClips,
    selectClip,
    togglePlayback,
    stopPlayback,
    seekClip,
    stepClip,
    propCatalog: PROP_CATALOG,
    findProp,
    props,
    selectedPropId,
    propError,
    imagePlanes,
    addProp,
    vendorPropSearch,
    vendorPropFamily,
    vendorPropFamilies,
    visibleVendorProps,
    vendorPropThumb,
    addVendorProp,
    addPropFromFile,
    removeProp,
    dropPropToFloor,
    placePropAtBone,
    addImagePlane,
    removeImagePlane,
    setImagePlaneOpacity,
    propBounds,
    sceneName,
    savedScenes,
    canUndo,
    canRedo,
    sceneError,
    captureScene,
    commit,
    undo,
    redo,
    allPremadeScenes,
    loadVendorSceneLibrary,
    vendorSceneIndex,
    vendorSceneError,
    vendorSceneTags,
    visibleVendorScenes,
    applyVendorScene,
    loadGeneratedSceneLibrary,
    sceneLibraryError,
    loadPremadeScene,
    refreshSavedScenes,
    saveCurrentScene,
    openSavedScene,
    deleteSavedScene,
    exportCurrentScene,
    importSceneFile,
    handleHistoryKey,
    handleShortcutKey,
    prefs,
    isFavorite,
    toggleFavorite,
    favoriteModels,
    showFavoritesOnly,
    toggleFavoritesFilter,
    settingsOpen,
    openSettings,
    setPref,
    tourStep,
    tour: TOUR,
    nextTourStep,
    prevTourStep,
    skipTour,
    completeOnboarding,
    restartOnboarding,
    replayTour,
  };
}

















