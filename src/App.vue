<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePosing } from "./composables/usePosing";
import type { CatalogEntry } from "./models/ModelCatalog";
import { SHORTCUT_HELP } from "./prefs/Shortcuts";
import { isHidden, isLocked } from "./scene/ObjectState";
import { PASS_LABELS, type RenderPass } from "./export/RenderPasses";
import { handPoseThumbnail } from "./pose/HandPoseThumbnail";
import { poseThumbnailer } from "./pose/PoseThumbnail";
import { loadClip } from "./anim/ClipPlayer";

const {
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
  catalog,
  init,
  attachModel,
  setActive,
  activateModelWithPose,
  selectBone,
  selectObject,
  setObjectGizmoMode,
  duplicateSelectedObject,
  toggleObjectHidden,
  toggleObjectLocked,
  attachModeActive,
  attachableSelectedProp,
  attachError,
  attachStatus,
  toggleAttachToJoint,
  stopAttachMode,
  jointHandlesVisible,
  setJointHandlesVisible,
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
  handPoseError,
  setHandSide,
  handPoseStatus,
  handPoseSearch,
  visibleHandPoses,
  vendorSceneIndex,
  vendorPoseIndex,
  loadVendorPoseLibrary,
  vendorPoseError,
  vendorPoseTags,
  visibleVendorPoses,
  applyVendorPose,
  vendorThumb,
  vendorPropSearch,
  vendorPropFamily,
  vendorPropFamilies,
  visibleVendorProps,
  vendorPropThumb,
  addVendorProp,
  loadVendorSceneLibrary,
  vendorSceneError,
  vendorSceneTags,
  visibleVendorScenes,
  applyVendorScene,
  applyHandPose,
  copyHandPose,
  pasteHandOnly,
  resetHands,
  thumbnails,
  loadThumbnails,
  loadingId,
  frameScene,
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
  RENDER_PASSES,
  exporting,
  exportResults,
  exportError,
  exportSize,
  exportWidth,
  exportHeight,
  depthPreview,
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
  allPremadeScenes,
  loadGeneratedSceneLibrary,
  sceneLibraryError,
  poseThumbs,
  allPoseTags,
  visiblePoses,
  togglePoseTag,
  applyPose,
  loadPoseThumbnails,
  clipSearch,
  clipSummaries,
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
  propCatalog,
  props,
  selectedPropId,
  propError,
  imagePlanes,
  addProp,
  addPropFromFile,
  removeProp,
  dropPropToFloor,
  placePropAtBone,
  addImagePlane,
  removeImagePlane,
  sceneName,
  savedScenes,
  canUndo,
  canRedo,
  sceneError,
  loadPremadeScene,
  refreshSavedScenes,
  saveCurrentScene,
  openSavedScene,
  deleteSavedScene,
  exportCurrentScene,
  importSceneFile,
  undo,
  redo,
  handleShortcutKey,
  prefs,
  isFavorite,
  toggleFavorite,
  showFavoritesOnly,
  settingsOpen,
  openSettings,
  setPref,
  tourStep,
  tour,
  nextTourStep,
  prevTourStep,
  skipTour,
  replayTour,
} = usePosing();

onMounted(() => {
  init();
  loadThumbnails();
  void loadClips();
  refreshSavedScenes();
  void loadGeneratedSceneLibrary();
  void loadVendorPoseLibrary();
  void loadVendorSceneLibrary();
});

onMounted(() => {
  window.addEventListener("keydown", handleShortcutKey);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleShortcutKey);
});

async function addModel(config: CatalogEntry): Promise<void> {
  error.value = null;
  try {
    const posed = await attachModel(config);
    setActive(posed.config.id);
    frameScene();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  }
}

/** Capture the viewport and hand it to the download helper. */
function captureViewport(): void {
  const shot = takeScreenshot();
  if (shot) download("poseify-viewport.png", shot);
}

const imageFileInput = ref<HTMLInputElement | null>(null);
function chooseImage(): void {
  imageFileInput.value?.click();
}

function saveQuickCameraPreset(): void {
  const next = prefs.value.cameraPresets.length + 1;
  saveCameraPreset(`Camera ${next}`);
}
const groups = computed(() => {
  const map = new Map<string, CatalogEntry[]>();
  for (const m of catalog) {
    if (showFavoritesOnly.value && !isFavorite(m.id)) continue;
    const list = map.get(m.family);
    if (list) list.push(m);
    else map.set(m.family, [m]);
  }
  return [...map.entries()];
});

// Phase 1 object picker. Model entries are labelled from the catalogue and
// prop entries from their own name, so the select reads the same way the
// Scene list does.
const objectOptions = computed(() =>
  selectableObjects().map(({ id, root }) => {
    const prop = props.value.find((p) => p.id === id);
    const model = models.value.find((m) => m.instanceId === id);
    const name = prop ? prop.config.name : (model?.config.name ?? id);
    // Read the flags rather than root.visible, so a hidden *and* locked object
    // is labelled with both, matching what the buttons will do.
    const marks = [
      isHidden(root) ? "hidden" : "",
      isLocked(root) ? "locked" : "",
    ].filter(Boolean);
    return { id, label: marks.length ? `${name} (${marks.join(", ")})` : name };
  }),
);

const propGroups = computed(() => {
  const map = new Map<string, CatalogEntry[]>();
  for (const p of propCatalog) {
    const list = map.get(p.family);
    if (list) list.push(p);
    else map.set(p.family, [p]);
  }
  return [...map.entries()];
});

// ---------------------------------------------------------------- overlays
//
// PoseMy.Art keeps no permanent panels: every tool opens a large surface over
// the canvas. One overlay at a time matches that, and stops the previous
// layout's real failure mode, where twelve stacked sections in a 216px column
// meant Props and Animation were off-screen behind a scroll.
type OverlayName =
  | "models"
  | "props"
  | "poses"
  | "hands"
  | "animations"
  | "scenes"
  | "export"
  | "camera"
  | "objects"
  | "groups"
  | "anchors";

const activeOverlay = ref<OverlayName | null>(null);

const OVERLAY_TITLES: Record<OverlayName, string> = {
  models: "Add Models",
  props: "Add Props",
  poses: "Poses",
  hands: "Hand Poses",
  animations: "Animations",
  scenes: "Premade Scenes",
  export: "Export",
  camera: "Camera",
  objects: "Scene Objects",
  groups: "Joint Groups",
  anchors: "Anchors",
};

const overlayTitle = computed(() =>
  activeOverlay.value ? OVERLAY_TITLES[activeOverlay.value] : "",
);

function openOverlay(name: OverlayName): void {
  showLightPanel.value = false;
  // Clicking the active rail button closes it, so the rail toggles.
  activeOverlay.value = activeOverlay.value === name ? null : name;
}

function closeOverlay(): void {
  activeOverlay.value = null;
}

function toggleLightPanel(): void {
  showLightPanel.value = !showLightPanel.value;
  if (showLightPanel.value) closeOverlay();
}

function openSettingsMenu(): void {
  closeOverlay();
  showLightPanel.value = false;
  openSettings();
}

// Colour swatch needs a value to bind to; remember the last one chosen so the
// picker does not snap back to black each time an object is selected.
const objectColor = ref("#cccccc");

watch(objectColor, (value) => setSelectedObjectColor(value));

// Pose pagination. PoseMy.Art exposes rows-per-page and paging because its
// library is thousands of poses; ours grows past a thousand in the v2 run, so
// the same control is needed to keep the picker usable.
const posePageSize = ref(30);
const posePage = ref(0);

const posePageCount = computed(() =>
  Math.max(1, Math.ceil(visiblePoses.value.length / posePageSize.value)),
);

const pagedPoses = computed(() => {
  const start = posePage.value * posePageSize.value;
  return visiblePoses.value.slice(start, start + posePageSize.value);
});

// Any change to the filter has to reset the page, or a search that matches
// fewer poses than one page leaves the artist staring at an empty grid.
watch([poseSearch, poseTagFilter, posePageSize], () => {
  posePage.value = 0;
});

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") closeOverlay();
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});

function onPropFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void addPropFromFile(file);
  input.value = "";
}

function onImageFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void addImagePlane(file);
  input.value = "";
}

function onSceneFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void importSceneFile(file);
  input.value = "";
}

const premadeScenes = allPremadeScenes;

// Reference library tab. The three vendor sources are listed in one panel with
// a tab each, rather than as three separate sections: they are all "the big
// library", and an artist browsing poses does not want to hunt for them.
const libraryTab = ref<"poses" | "props" | "scenes">("poses");
const librarySearch = ref("");

// Model tools appear only while a model is selected in the viewport.
const hasSelectedModel = computed(() =>
  models.value.some(
    (model) => model.instanceId === selectedObjectId.value && model.config.id === activeModelId.value,
  ),
);
const showLightPanel = ref(false);
const lightControlsLocked = ref(false);
const lightControlMode = ref<"move" | "rotate" | "scale">("rotate");

function switchSelectedModel(direction: -1 | 1): void {
  const index = models.value.findIndex((model) => model.instanceId === selectedObjectId.value);
  if (index < 0 || models.value.length < 2) return;
  const next = models.value[(index + direction + models.value.length) % models.value.length];
  activateModelWithPose(next.config.id);
  selectObject(next.instanceId);
}

const handPoseThumbs = ref<Record<string, string>>({});
watch([activeOverlay, visibleHandPoses], async () => {
  if (activeOverlay.value !== "hands") return;
  const previewModel = catalog.find((model) => model.id === "mannequin_male") ?? catalog[0];
  if (!previewModel) return;
  for (const pose of visibleHandPoses.value) {
    if (handPoseThumbs.value[pose.id]) continue;
    const image = await handPoseThumbnail(previewModel, pose);
    if (image) handPoseThumbs.value = { ...handPoseThumbs.value, [pose.id]: image };
  }
});

const animationThumbs = ref<Record<string, string>>({});
const animationPage = ref(0);
const animationPageSize = 24;
const pagedAnimations = computed(() =>
  visibleClips.value.slice(
    animationPage.value * animationPageSize,
    (animationPage.value + 1) * animationPageSize,
  ),
);
const animationPageCount = computed(() =>
  Math.max(1, Math.ceil(visibleClips.value.length / animationPageSize)),
);
watch(clipSearch, () => {
  animationPage.value = 0;
});
watch([activeOverlay, pagedAnimations], async () => {
  if (activeOverlay.value !== "animations") return;
  for (const clip of pagedAnimations.value) {
    if (animationThumbs.value[clip.id]) continue;
    const loaded = await loadClip(clip.id);
    const frame = loaded?.frames[Math.floor((loaded.frames.length - 1) / 2)];
    if (!frame) continue;
    const image = await poseThumbnailer().thumbnail({
      id: `animation-preview:${clip.id}`,
      name: clip.name,
      tags: clip.tags,
      bones: frame.rotations,
      source: "clip",
    });
    if (image) animationThumbs.value = { ...animationThumbs.value, [clip.id]: image };
  }
});

const filteredVendorPoses = computed(() => {
  const needle = librarySearch.value.trim().toLowerCase();
  if (!needle) return visibleVendorPoses.value;
  // The vendor search already honours poseSearch; this narrows further on the
  // library box without having to re-fetch anything.
  return visibleVendorPoses.value.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) ||
      row.category.toLowerCase().includes(needle) ||
      row.description.toLowerCase().includes(needle),
  );
});
const shortcutHelp = SHORTCUT_HELP;

// Render thumbnails lazily: only the poses currently visible in the picker,
// so opening it does not generate 98 renders up front.
watch(
  visiblePoses,
  (poses) => {
    void loadPoseThumbnails(poses.slice(0, 60));
  },
  { immediate: true },
);
</script>

<template>
  <div class="app">
    <div ref="mount" class="viewport"></div>

    <input
      ref="imageFileInput"
      type="file"
      accept="image/*"
      hidden
      @change="onImageFile"
    />

    <nav class="rail rail-top-left" aria-label="Add to scene">
      <button
        type="button"
        class="icon-btn"
        aria-label="Add Models"
        title="Add Models"
        @click="openOverlay('models')"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2.5"/><path d="M12 8v6m-8-4 8 2 8-2M8 21v-5l4-2 4 2v5"/></svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Add Props"
        title="Add Props"
        @click="openOverlay('props')"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m12 2 9 5v10l-9 5-9-5V7l9-5Z"/><path d="m3 7 9 5 9-5M12 12v10"/></svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Premade Scenes"
        title="Premade Scenes"
        @click="openOverlay('scenes')"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/><rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/></svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Add Image"
        title="Add Image"
        @click="chooseImage()"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Camera"
        title="Camera controls and saved views"
        @click="openOverlay('camera')"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/></svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Save Camera View"
        title="Save current camera view"
        @click="saveQuickCameraPreset()"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M3 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v5"/><path d="M3 7v11a2 2 0 0 0 2 2h9"/><circle cx="11" cy="13" r="4"/><path d="M19 16v6m-3-3h6"/></svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Export"
        title="Export"
        @click="openOverlay('export')"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M4 19v2h16v-2"/></svg>
      </button>
    </nav>

    <nav class="rail rail-top-right" aria-label="Scene and settings">
      <button
        type="button"
        class="icon-btn"
        aria-label="Save and load"
        title="Save &amp; Load"
        @click="openOverlay('scenes')"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 3h13l4 4v14H3V3h1Z"/><path d="M7 3v6h10V3M7 21v-8h10v8"/></svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Settings"
        title="Settings and keyboard shortcuts (Ctrl+,)"
        @click="openSettingsMenu()"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1a1.7 1.7 0 1 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.4a1.7 1.7 0 1 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 1 1-2.4-2.4l.1-.1a1.7 1.7 0 0 0-1.2-2.9h-.4a1.7 1.7 0 1 1 0-3.4h.2a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a1.7 1.7 0 1 1 2.4-2.4l.1.1a1.7 1.7 0 0 0 2.9-1.2v-.4a1.7 1.7 0 1 1 3.4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a1.7 1.7 0 1 1 2.4 2.4l-.1.1a1.7 1.7 0 0 0 1.2 2.9h.4a1.7 1.7 0 1 1 0 3.4h-.2a1.7 1.7 0 0 0-1.2 2.9Z"/></svg>
      </button>
    </nav>

    <nav class="rail rail-bottom-left" aria-label="Scene controls">
      <button
        type="button"
        class="icon-btn"
        aria-label="Undo"
        title="Undo (Ctrl/Cmd + Z)"
        :disabled="!canUndo"
        @click="undo()"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h9a7 7 0 0 1 7 7v3"/></svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        aria-label="Redo"
        title="Redo (Ctrl/Cmd + Shift + Z)"
        :disabled="!canRedo"
        @click="redo()"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9h-9a7 7 0 0 0-7 7v3"/></svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        :class="{ on: showLightPanel }"
        :aria-pressed="showLightPanel"
        aria-label="Directional Light"
        title="Directional Light controls"
        @click="toggleLightPanel()"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></svg>
      </button>
    </nav>

    <section v-if="showLightPanel" class="light-panel" aria-label="Directional Light">
      <header class="drawer-head">
        <strong>Directional Light</strong>
        <button type="button" class="icon-btn close" aria-label="Close light controls" @click="showLightPanel = false">&times;</button>
      </header>
      <div class="segmented light-modes" role="group" aria-label="Light transform mode">
        <button :class="{ on: lightControlMode === 'move' }" @click="lightControlMode = 'move'">Move</button>
        <button :class="{ on: lightControlMode === 'rotate' }" @click="lightControlMode = 'rotate'">Rotate</button>
        <button :class="{ on: lightControlMode === 'scale' }" @click="lightControlMode = 'scale'">Scale</button>
      </div>
      <label v-if="lightControlMode === 'move'" class="field">
        <span>Position <b>{{ light.distance.toFixed(1) }} m</b></span>
        <input type="range" min="3" max="15" step="0.1" :disabled="lightControlsLocked" :value="light.distance" @input="setLight({ distance: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <template v-else-if="lightControlMode === 'rotate'">
        <label class="field">
          <span>Azimuth <b>{{ Math.round(light.azimuth) }}&deg;</b></span>
          <input type="range" min="0" max="360" step="1" :disabled="lightControlsLocked" :value="light.azimuth" @input="setLight({ azimuth: Number(($event.target as HTMLInputElement).value) })" />
        </label>
        <label class="field">
          <span>Elevation <b>{{ Math.round(light.elevation) }}&deg;</b></span>
          <input type="range" min="1" max="179" step="1" :disabled="lightControlsLocked" :value="light.elevation" @input="setLight({ elevation: Number(($event.target as HTMLInputElement).value) })" />
        </label>
      </template>
      <label v-else class="field">
        <span>Intensity <b>{{ light.intensity.toFixed(1) }}</b></span>
        <input type="range" min="0" max="6" step="0.1" :disabled="lightControlsLocked" :value="light.intensity" @input="setLight({ intensity: Number(($event.target as HTMLInputElement).value) })" />
      </label>
      <label class="check">
        <input type="checkbox" :checked="lightGizmoVisible" @change="setLightGizmo(($event.target as HTMLInputElement).checked)" />
        <span>Show light gizmo</span>
      </label>
      <label class="check">
        <input type="checkbox" :checked="light.castShadows" :disabled="lightControlsLocked" @change="setLight({ castShadows: ($event.target as HTMLInputElement).checked })" />
        <span>Shadows</span>
      </label>
      <button type="button" class="chip wide" :class="{ on: lightControlsLocked }" :aria-pressed="lightControlsLocked" @click="lightControlsLocked = !lightControlsLocked">
        {{ lightControlsLocked ? "Unlock light" : "Lock light" }}
      </button>
    </section>

    <!--
      Attach mode feedback. An artist who presses Attach and sees nothing
      change has no way to know the app is now waiting for a click, so the
      prompt is stated rather than implied.
    -->
    <p v-if="attachModeActive" class="status-pill attach-hint" aria-live="polite">
      Click a highlighted joint to attach it, or press Escape to cancel
    </p>
    <p v-else-if="attachError" class="status-pill attach-hint warn" aria-live="polite">
      {{ attachError }}
    </p>
    <p v-else-if="attachStatus" class="status-pill attach-hint" aria-live="polite">
      {{ attachStatus }}
    </p>

    <!--
      Overlay surfaces. Exactly one is open at a time; the rail buttons swap
      between them. Each is a large panel over the canvas rather than a
      scrolling column beside it.
    -->
    <section
      v-if="activeOverlay"
      class="overlay"
      :class="{ 'hand-overlay': activeOverlay === 'hands' }"
      role="dialog"
      :aria-label="overlayTitle"
    >
      <header class="overlay-head">
        <h2>{{ overlayTitle }}</h2>
        <button
          type="button"
          class="icon-btn close"
          aria-label="Close"
          title="Close"
          @click="closeOverlay()"
        >
          <span aria-hidden="true">&times;</span>
        </button>
      </header>
      <div class="overlay-body">
        <div v-if="activeOverlay === 'camera'" class="overlay-pane">
          <label class="field">
            <span>Field of view <b>{{ Math.round(fov) }}&deg;</b></span>
            <input type="range" min="10" max="110" step="1" :value="fov" @input="setFov(Number(($event.target as HTMLInputElement).value))" />
          </label>
          <div class="chip-grid">
            <button type="button" class="chip" @click="frameScene">Frame scene</button>
            <button type="button" class="chip" @click="toggleCameraLock">{{ cameraLocked ? "Unlock camera" : "Lock camera" }}</button>
            <button type="button" class="chip" @click="resetCamera">Reset camera</button>
            <button type="button" class="chip" @click="captureViewport">Screenshot</button>
          </div>
          <label class="field">
            <span>Save current view</span>
            <input v-model="cameraPresetName" type="text" placeholder="Preset name" />
          </label>
          <button type="button" class="chip" :disabled="!cameraPresetName.trim()" @click="saveCameraPreset()">Save view</button>
          <p v-if="cameraError" class="hint warn">{{ cameraError }}</p>
          <ul v-if="prefs.cameraPresets.length" class="list">
            <li v-for="preset in prefs.cameraPresets" :key="preset.name">
              <button type="button" @click="applyCameraPreset(preset)">{{ preset.name }}</button>
              <button type="button" class="danger" :aria-label="`Delete preset ${preset.name}`" @click="deleteCameraPreset(preset.name)">&times;</button>
            </li>
          </ul>
        </div>
        <div v-else-if="activeOverlay === 'hands'" class="overlay-pane hand-pose-browser">
          <div class="hand-side-tabs" role="group" aria-label="Hand side">
            <button type="button" :class="{ on: handSide === 'Right' }" @click="setHandSide('Right')">Right hand</button>
            <button type="button" :class="{ on: handSide === 'Left' }" @click="setHandSide('Left')">Left hand</button>
          </div>
          <div class="overlay-controls">
            <label class="field grow">
              <span>Find hand poses</span>
              <input v-model="handPoseSearch" type="search" placeholder="fist, point, open palm" />
            </label>
            <div class="row">
              <button type="button" class="chip" title="Copy pose and hands" @click="copyHandPose()">Copy</button>
              <button type="button" class="chip" title="Paste hands only" @click="pasteHandOnly()">Paste</button>
              <button type="button" class="chip" title="Reset hands" @click="resetHands()">Reset</button>
            </div>
          </div>
          <p v-if="handPoseStatus" class="hint">{{ handPoseStatus }}</p>
          <p v-if="handPoseError" class="hint warn">{{ handPoseError }}</p>
          <div class="pose-grid hand-pose-grid">
            <button
              v-for="pose in visibleHandPoses"
              :key="pose.id"
              type="button"
              class="pose-tile hand-pose-tile"
              :title="`${pose.name} — ${pose.tags.join(', ')}`"
              @click="applyHandPose(pose)"
            >
              <img v-if="handPoseThumbs[pose.id]" :src="handPoseThumbs[pose.id]" :alt="pose.name" />
              <span v-else class="hand-preview-loading" aria-hidden="true"></span>
              <span class="pose-name">{{ pose.name }}</span>
            </button>
          </div>
        </div>
        <div v-else-if="activeOverlay === 'animations'" class="overlay-pane animation-browser">
          <label class="field">
            <span>Find animations</span>
            <input v-model="clipSearch" type="search" placeholder="walk, run, idle" />
          </label>
          <p v-if="clipError && clipSummaries.length" class="hint warn">{{ clipError }}</p>
          <p v-if="clipSummaries.length === 0" class="animation-empty">Animations will appear here when you add them.</p>
          <div v-else class="pose-grid animation-grid">
            <button
              v-for="clip in pagedAnimations"
              :key="clip.id"
              type="button"
              class="pose-tile animation-tile"
              :class="{ on: clip.id === activeClipId }"
              :title="`${clip.name} — ${clip.durationSeconds.toFixed(1)} seconds`"
              @click="selectClip(clip.id)"
            >
              <img v-if="animationThumbs[clip.id]" :src="animationThumbs[clip.id]" :alt="`${clip.name} preview`" />
              <span v-else class="thumb placeholder" aria-hidden="true"></span>
              <span class="pose-name">{{ clip.name }}</span>
              <span class="clip-meta">{{ clip.durationSeconds.toFixed(1) }}s</span>
            </button>
          </div>
          <div v-if="animationPageCount > 1" class="pager">
            <button type="button" class="chip" :disabled="animationPage === 0" @click="animationPage = Math.max(0, animationPage - 1)">Previous</button>
            <span class="hint">Page {{ animationPage + 1 }} of {{ animationPageCount }}</span>
            <button type="button" class="chip" :disabled="animationPage >= animationPageCount - 1" @click="animationPage = Math.min(animationPageCount - 1, animationPage + 1)">Next</button>
          </div>
          <div v-if="activeClipId" class="animation-transport">
            <button type="button" class="chip" @click="togglePlayback()">{{ playing ? "Pause" : "Play" }}</button>
            <button type="button" class="chip" @click="stopPlayback()">Stop</button>
            <input class="scrub" type="range" min="0" :max="clipDuration" step="0.01" :value="clipTime" @input="seekClip(Number(($event.target as HTMLInputElement).value))" />
            <span class="hint">{{ clipTime.toFixed(1) }} / {{ clipDuration.toFixed(1) }}s</span>
          </div>
        </div>
        <!-- Models -->
        <div v-if="activeOverlay === 'models'" class="overlay-pane">
          <div v-for="[family, items] in groups" :key="family" class="group">
            <h3>{{ family }}</h3>
            <div class="tile-grid">
              <div v-for="m in items" :key="m.id" class="tile-wrap">
                <button
                  class="chip tile"
                  :class="{
                    hasThumb: !!thumbnails[m.id],
                    loading: loadingId === m.id,
                  }"
                  :disabled="loadingId === m.id"
                  type="button"
                  @click="addModel(m)"
                >
                  <img
                    v-if="thumbnails[m.id]"
                    :src="thumbnails[m.id]"
                    :alt="m.name"
                  />
                  <span v-else class="thumb placeholder" aria-hidden="true"></span>
                  <span class="pose-name">{{ m.name }}</span>
                </button>
                <button
                  type="button"
                  class="fav"
                  :class="{ on: isFavorite(m.id) }"
                  :aria-label="`Favourite ${m.name}`"
                  :aria-pressed="isFavorite(m.id)"
                  @click="toggleFavorite(m.id)"
                >
                  &#9829;
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Poses -->
        <div v-else-if="activeOverlay === 'poses'" class="overlay-pane">
          <div class="overlay-controls">
            <label class="field grow">
              <span>Search poses</span>
              <input
                v-model="poseSearch"
                type="search"
                placeholder="e.g. sword, wave, kneel"
              />
            </label>
            <label class="field compact">
              <span>Per page</span>
              <input
                v-model.number="posePageSize"
                type="number"
                min="6"
                max="120"
                step="6"
              />
            </label>
          </div>

          <div class="tags">
            <button
              v-for="tag in allPoseTags"
              :key="tag"
              type="button"
              class="tag"
              :class="{ on: poseTagFilter.includes(tag) }"
              @click="togglePoseTag(tag)"
            >
              {{ tag }}
            </button>
          </div>

          <p v-if="poseError" class="hint warn">{{ poseError }}</p>
          <p v-else-if="clipboardStatus" class="hint">{{ clipboardStatus }}</p>

          <div class="pose-grid">
            <button
              v-for="pose in pagedPoses"
              :key="pose.id"
              type="button"
              class="pose-tile"
              :class="{ on: appliedPoseId === pose.id }"
              :title="`${pose.name} — ${pose.tags.join(', ')}`"
              @click="applyPose(pose)"
            >
              <img
                v-if="poseThumbs[pose.id]"
                :src="poseThumbs[pose.id]"
                :alt="`${pose.name} pose`"
              />
              <span v-else class="thumb placeholder" aria-hidden="true"></span>
              <span class="pose-name">{{ pose.name }}</span>
            </button>
          </div>

          <div class="pager">
            <button
              type="button"
              class="chip"
              :disabled="posePage === 0"
              @click="posePage = Math.max(0, posePage - 1)"
            >
              Previous
            </button>
            <span class="hint">
              Page {{ posePage + 1 }} of {{ posePageCount }} —
              {{ visiblePoses.length }}
              {{ visiblePoses.length === 1 ? "pose" : "poses" }}
            </span>
            <button
              type="button"
              class="chip"
              :disabled="posePage >= posePageCount - 1"
              @click="posePage = Math.min(posePageCount - 1, posePage + 1)"
            >
              Next
            </button>
          </div>
        </div>

        <!-- Props -->
        <div v-else-if="activeOverlay === 'props'" class="overlay-pane">
          <p v-if="propError" class="hint warn">{{ propError }}</p>

          <div v-for="[family, items] in propGroups" :key="family" class="group">
            <h3>{{ family }}</h3>
            <div class="chip-grid">
              <button
                v-for="p in items"
                :key="p.id"
                type="button"
                class="chip"
                @click="addProp(p)"
              >
                {{ p.name }}
              </button>
            </div>
          </div>

          <label class="file-btn">
            Import .obj / .glb
            <input
              type="file"
              accept=".obj,.glb,.gltf"
              hidden
              @change="onPropFile"
            />
          </label>

          <div v-if="props.length" class="prop-list">
            <div
              v-for="placed in props"
              :key="placed.id"
              class="prop-row"
              :class="{ on: placed.id === selectedPropId }"
            >
              <span
                class="prop-name"
                role="button"
                tabindex="0"
                @click="selectedPropId = placed.id"
              >
                {{ placed.config.name }}
              </span>
              <span class="prop-actions">
                <button
                  type="button"
                  class="chip tiny"
                  title="Drop to floor"
                  @click="dropPropToFloor(placed.id)"
                >
                  v
                </button>
                <button
                  type="button"
                  class="chip tiny"
                  title="Place at the figure's feet"
                  @click="placePropAtBone(placed.id, 'LeftFoot')"
                >
                  @
                </button>
                <button
                  type="button"
                  class="chip tiny danger"
                  :aria-label="`Remove ${placed.config.name}`"
                  @click="removeProp(placed.id)"
                >
                  &times;
                </button>
              </span>
            </div>
          </div>

          <h3 class="sub">Image planes</h3>
          <p v-if="imagePlanes.length === 0" class="hint">
            Import an image to compose and check perspective against it.
          </p>
          <div v-else class="prop-list">
            <div
              v-for="plane in imagePlanes"
              :key="plane.id"
              class="prop-row"
            >
              <span class="prop-name">{{ plane.name }}</span>
              <span class="prop-actions">
                <button
                  type="button"
                  class="chip tiny danger"
                  :aria-label="`Remove ${plane.name}`"
                  @click="removeImagePlane(plane.id)"
                >
                  &times;
                </button>
              </span>
            </div>
          </div>
          <label class="file-btn">
            Import an image
            <input type="file" accept="image/*" hidden @change="onImageFile" />
          </label>
        </div>

        <!-- Scenes and save/load -->
        <div v-else-if="activeOverlay === 'scenes'" class="overlay-pane">
          <p v-if="sceneError" class="hint warn">{{ sceneError }}</p>

          <label class="field">
            <span>Scene name</span>
            <input v-model="sceneName" type="text" />
          </label>
          <div class="row wrap">
            <button type="button" class="chip" @click="saveCurrentScene()">
              Save
            </button>
            <button type="button" class="chip" @click="exportCurrentScene()">
              Export file
            </button>
            <button type="button" class="chip" @click="undo()" :disabled="!canUndo">
              Undo
            </button>
            <button type="button" class="chip" @click="redo()" :disabled="!canRedo">
              Redo
            </button>
          </div>

          <template v-if="savedScenes.length">
            <h3 class="sub">Saved</h3>
            <div class="scene-list">
              <div
                v-for="s in savedScenes"
                :key="s.name"
                class="scene-row saved"
              >
                <span class="scene-name" @click="openSavedScene(s.name)">
                  {{ s.name }}
                </span>
                <button
                  type="button"
                  class="chip tiny danger"
                  :aria-label="`Delete ${s.name}`"
                  @click="deleteSavedScene(s.name)"
                >
                  &times;
                </button>
              </div>
            </div>
          </template>

          <h3 class="sub">Premade</h3>
          <div class="scene-list">
            <button
              v-for="s in premadeScenes"
              :key="s.name"
              type="button"
              class="scene-row"
              :title="s.description"
              @click="loadPremadeScene(s.name)"
            >
              {{ s.name }}
            </button>
          </div>
        </div>

        <!-- Export. PoseMy.Art offers one button per pass rather than a single
             "export all", because an artist usually wants the regular image
             and only occasionally the depth or normal map. -->
        <div v-else-if="activeOverlay === 'export'" class="overlay-pane">
          <label class="field">
            <span>Resolution <b>{{ exportSize }}&times;{{ exportSize }}</b></span>
            <input
              type="range"
              min="512"
              max="2048"
              step="256"
              :value="exportSize"
              @input="exportSize = Number(($event.target as HTMLInputElement).value)"
            />
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="exportTransparent"
              @change="exportTransparent = ($event.target as HTMLInputElement).checked"
            />
            <span>Transparent background</span>
          </label>

          <h3 class="sub">Passes</h3>
          <div class="chip-grid">
            <button
              v-for="pass in RENDER_PASSES"
              :key="pass"
              type="button"
              class="chip"
              :disabled="exporting || !activeModelId"
              @click="runExport()"
            >
              Export {{ pass }}
            </button>
          </div>

          <div class="row wrap">
            <button
              type="button"
              class="chip"
              :disabled="exporting || !activeModelId"
              @click="runExport()"
            >
              {{ exporting ? "Rendering..." : `Export all ${RENDER_PASSES.length}` }}
            </button>
            <button
              type="button"
              class="chip"
              :disabled="!activeModelId"
              @click="
                (() => {
                  const obj = exportObjNow();
                  if (obj) download(obj.filename, obj.text);
                })()
              "
            >
              Export OBJ
            </button>
          </div>
          <p class="hint">
            {{ RENDER_PASSES.length }} passes: regular, OpenPose, depth, canny,
            normals.
          </p>
        </div>

        <!--
          Joint groups stay in their own overlay and remain reachable from the
          model action dock.
        -->
        <div v-else-if="activeOverlay === 'groups'" class="overlay-pane">
          <p class="hint">
            Group a chain so it can be posed or reset as a unit.
          </p>
          <div class="row preset-row">
            <input
              v-model="groupDraftName"
              type="text"
              placeholder="Group name"
              aria-label="Group name"
            />
            <button
              type="button"
              class="chip"
              :disabled="!groupDraftName.trim() || groupDraftBones.length === 0"
              @click="createGroup()"
            >
              Add
            </button>
          </div>
          <div class="tags bone-tags">
            <button
              v-for="bone in groupableBones"
              :key="bone"
              type="button"
              class="tag"
              :class="{ on: groupDraftBones.includes(bone) }"
              @click="
                groupDraftBones = groupDraftBones.includes(bone)
                  ? groupDraftBones.filter((b) => b !== bone)
                  : [...groupDraftBones, bone]
              "
            >
              {{ bone }}
            </button>
          </div>
          <ul v-if="jointGroups.length" class="list">
            <li v-for="group in jointGroups" :key="group.id">
              <button type="button" @click="resetGroup(group.id)">
                {{ group.name }}
                <small>({{ group.bones.length }})</small>
              </button>
              <button
                type="button"
                class="danger"
                :aria-label="`Delete group ${group.name}`"
                @click="deleteGroup(group.id)"
              >
                &times;
              </button>
            </li>
          </ul>
          <p v-else class="hint">No groups yet.</p>
          <p v-if="groupStatus" class="hint">{{ groupStatus }}</p>
        </div>

        <!-- Anchors. Same reasoning as groups above. -->
        <div v-else-if="activeOverlay === 'anchors'" class="overlay-pane">
          <p class="hint">
            Pin a joint to another joint or a prop. Cycles are refused.
          </p>
          <label class="field">
            <span>Joint</span>
            <select v-model="anchorDraftBone">
              <option :value="null">Pick a joint</option>
              <option v-for="bone in groupableBones" :key="bone" :value="bone">
                {{ bone }}
              </option>
            </select>
          </label>
          <label class="field">
            <span>Pin to</span>
            <select v-model="anchorDraftTarget">
              <option :value="null">Pick a target</option>
              <optgroup label="Joints">
                <option
                  v-for="bone in groupableBones"
                  :key="bone"
                  :value="{ kind: 'bone', name: bone }"
                >
                  {{ bone }}
                </option>
              </optgroup>
              <optgroup v-if="props.length" label="Props">
                <option
                  v-for="prop in props"
                  :key="prop.id"
                  :value="{ kind: 'prop', id: prop.id }"
                >
                  {{ prop.config.name }}
                </option>
              </optgroup>
            </select>
          </label>
          <div class="row wrap">
            <label class="field inline-field">
              <span>Offset X</span>
              <input v-model.number="anchorDraftOffset[0]" type="number" step="0.05" />
            </label>
            <label class="field inline-field">
              <span>Offset Y</span>
              <input v-model.number="anchorDraftOffset[1]" type="number" step="0.05" />
            </label>
            <label class="field inline-field">
              <span>Offset Z</span>
              <input v-model.number="anchorDraftOffset[2]" type="number" step="0.05" />
            </label>
          </div>
          <button
            type="button"
            class="chip wide"
            :disabled="!anchorDraftBone || !anchorDraftTarget"
            @click="createAnchor()"
          >
            Add anchor
          </button>
          <p v-if="anchorError" class="hint warn">{{ anchorError }}</p>
          <ul v-if="anchors.length" class="list">
            <li v-for="anchor in anchors" :key="anchor.id">
              <button type="button" disabled>
                {{ anchor.bone }} &rarr;
                {{ anchor.target.kind === "bone"
                  ? anchor.target.name
                  : (props.find((p) => p.id === anchor.target.id)?.config.name
                    ?? anchor.target.id) }}
              </button>
              <button
                type="button"
                class="danger"
                :aria-label="`Remove anchor on ${anchor.bone}`"
                @click="deleteAnchor(anchor.id)"
              >
                &times;
              </button>
            </li>
          </ul>
          <p v-else class="hint">No anchors yet.</p>
        </div>
      </div>
    </section>

    <aside class="panel panel-left">
      <section>
        <h2>Models</h2>
        <div v-for="[family, items] in groups" :key="family" class="group">
          <h3>{{ family }}</h3>
          <div class="grid">
            <!-- The tile and its heart are siblings: a <span role="button">
                 inside a <button> is invalid nesting and its click never
                 reaches the Vue handler. -->
            <div
              v-for="m in items"
              :key="m.id"
              class="tile-wrap"
            >
              <button
                class="chip"
                :class="{
                  tile: true,
                  hasThumb: !!thumbnails[m.id],
                  loading: loadingId === m.id,
                }"
                :disabled="loadingId === m.id"
                type="button"
                @click="addModel(m)"
              >
                <img
                  v-if="thumbnails[m.id]"
                  class="thumb"
                  :src="thumbnails[m.id]"
                  :alt="`${m.name} preview`"
                />
                <span v-else class="thumb placeholder" aria-hidden="true"></span>
                {{ m.name }}
              </button>
              <button
                type="button"
                class="fav"
                :aria-label="`${isFavorite(m.id) ? 'Unfavourite' : 'Favourite'} ${m.name}`"
                :aria-pressed="isFavorite(m.id)"
                :class="{ on: isFavorite(m.id) }"
                @click="toggleFavorite(m.id)"
              >
                &#9829;
              </button>
            </div>
          </div>
        </div>
      </section>

      <section v-if="models.length">
        <h2>Scene</h2>
        <ul class="list">
          <li
            v-for="m in models"
            :key="m.instanceId"
            :class="{ active: m.config.id === activeModelId }"
          >
            <button type="button" @click="setActive(m.config.id)">
              {{ m.config.name }}
            </button>
            <button
              type="button"
              class="danger"
              :aria-label="`Remove ${m.config.name}`"
              @click="removeModel(m.instanceId)"
            >
              &times;
            </button>
          </li>
        </ul>
      </section>
    </aside>

    <nav v-if="hasSelectedModel" class="model-dock" aria-label="Selected model actions">
      <button type="button" class="model-tool" title="Pose library" aria-label="Pose library" @click="openOverlay('poses')"><span>♟</span></button>
      <button type="button" class="model-tool" title="Move (G)" aria-label="Move model" :class="{ on: objectGizmoMode === 'translate' }" @click="setObjectGizmoMode('translate')"><span>↖</span></button>
      <button type="button" class="model-tool" title="Rotate (Shift+R)" aria-label="Rotate model" :class="{ on: objectGizmoMode === 'rotate' }" @click="setObjectGizmoMode('rotate')"><span>⟳</span></button>
      <button type="button" class="model-tool" title="Scale (S)" aria-label="Scale model" :class="{ on: objectGizmoMode === 'scale' }" @click="setObjectGizmoMode('scale')"><span>⛶</span></button>
      <button type="button" class="model-tool" title="Switch to previous model, keeping pose" aria-label="Previous model" @click="switchSelectedModel(-1)"><span>⇤</span></button>
      <button type="button" class="model-tool" title="Switch to next model, keeping pose" aria-label="Next model" @click="switchSelectedModel(1)"><span>⇥</span></button>
      <button type="button" class="model-tool" title="Copy pose" aria-label="Copy pose" @click="copyPose()"><span>⧉</span></button>
      <button type="button" class="model-tool" title="Paste pose" aria-label="Paste pose" @click="pastePose()"><span>▣</span></button>
      <button type="button" class="model-tool" title="Hand poses" aria-label="Hand poses" @click="openOverlay('hands')"><span>☷</span></button>
      <button type="button" class="model-tool" title="Animations" aria-label="Animations" @click="openOverlay('animations')"><span>▶</span></button>
      <button type="button" class="model-tool" title="Reset pose" aria-label="Reset pose" @click="resetPose()"><span>↺</span></button>
      <button type="button" class="model-tool" title="Mirror arms" aria-label="Mirror arms" @click="mirrorArmLimb()"><span>⇋</span></button>
      <button type="button" class="model-tool" title="Mirror legs" aria-label="Mirror legs" @click="mirrorLegLimb()"><span>⇅</span></button>
      <button type="button" class="model-tool" title="Switch pose sides" aria-label="Switch pose sides" @click="switchPoseSides()"><span>⇄</span></button>
      <button type="button" class="model-tool" title="Show or hide joint handles" aria-label="Show or hide joint handles" :class="{ on: jointHandlesVisible }" @click="setJointHandlesVisible(!jointHandlesVisible)"><span>✣</span></button>
      <button type="button" class="model-tool" title="Joint groups" aria-label="Joint groups" @click="openOverlay('groups')"><span>♧</span></button>
      <button type="button" class="model-tool" title="Duplicate model" aria-label="Duplicate model" @click="duplicateSelectedObject()"><span>▢+</span></button>
      <label class="model-tool color-tool" title="Model color" aria-label="Model color"><span>●</span><input type="color" aria-label="Model color" @input="setSelectedObjectColor(($event.target as HTMLInputElement).value)" /></label>
      <button type="button" class="model-tool" title="Show or hide model" aria-label="Show or hide model" @click="toggleObjectHidden()"><span>◉</span></button>
      <button type="button" class="model-tool" title="Lock or unlock model" aria-label="Lock or unlock model" @click="toggleObjectLocked()"><span>▣</span></button>
      <button type="button" class="model-tool danger" title="Delete model" aria-label="Delete model" @click="deleteSelectedObject()"><span>×</span></button>
    </nav>



    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="exportError" class="error" role="alert">{{ exportError }}</p>

    <section v-if="exportResults.length" class="export-strip">
      <div class="export-head">
        <span>Exported {{ exportResults.length }} passes</span>
        <button type="button" class="chip small" @click="clearExport">
          Dismiss
        </button>
      </div>
      <div class="export-grid">
        <figure v-for="r in exportResults" :key="r.pass">
          <img :src="r.dataUrl" :alt="`${r.pass} pass`" />
          <figcaption>
            <span>{{ r.pass }}</span>
            <button
              type="button"
              class="chip small"
              @click="download(r.filename, r.dataUrl)"
            >
              Save
            </button>
          </figcaption>
        </figure>
      </div>
    </section>

    <div v-if="settingsOpen" class="modal" @click.self="openSettings()">
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Settings">
        <header>
          <h2>Settings</h2>
          <button type="button" class="chip" @click="openSettings()">&times;</button>
        </header>

        <section>
          <h3>Preferences</h3>
          <label class="toggle">
            <input
              type="checkbox"
              :checked="prefs.exportTransparencyDefault"
              @change="setPref('exportTransparencyDefault', ($event.target as HTMLInputElement).checked)"
            />
            <span>Transparent background by default</span>
          </label>
          <label class="toggle">
            <input
              type="checkbox"
              :checked="prefs.snapPropsByDefault"
              @change="setPref('snapPropsByDefault', ($event.target as HTMLInputElement).checked)"
            />
            <span>Snap new props to the floor</span>
          </label>
          <label class="toggle">
            <input
              type="checkbox"
              :checked="prefs.autoKeyframes"
              @change="setPref('autoKeyframes', ($event.target as HTMLInputElement).checked)"
            />
            <span>Record a keyframe on every pose change</span>
          </label>
        </section>

        <section>
          <h3>Keyboard shortcuts</h3>
          <dl class="shortcuts">
            <template v-for="s in shortcutHelp" :key="s.keys">
              <dt>{{ s.keys }}</dt>
              <dd>{{ s.label }}</dd>
            </template>
          </dl>
          <button type="button" class="chip wide" @click="replayTour()">
            Replay the tour
          </button>
        </section>
      </div>
    </div>

    <div v-if="tourStep !== null" class="tour">
      <div class="tour-card" role="dialog" aria-modal="true">
        <h3>{{ tour[tourStep].title }}</h3>
        <p>{{ tour[tourStep].body }}</p>
        <footer>
          <span class="tour-dots">
            <i
              v-for="(t, i) in tour"
              :key="t.title"
              :class="{ on: i === tourStep }"
            ></i>
          </span>
          <button type="button" class="chip" @click="skipTour()">Skip</button>
          <button
            type="button"
            class="chip"
            :disabled="tourStep === 0"
            @click="prevTourStep()"
          >
            Back
          </button>
          <button type="button" class="chip primary" @click="nextTourStep()">
            {{ tourStep >= tour.length - 1 ? "Done" : "Next" }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  position: relative;
  height: 100%;
}

.viewport {
  position: fixed;
  inset: 0;
}

.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 40px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid var(--poseify-border);
  background: color-mix(in srgb, var(--poseify-panel) 92%, transparent);
  backdrop-filter: blur(6px);
  z-index: 2;
}

.brand {
  font-weight: 600;
  letter-spacing: 0.02em;
}

.status {
  color: var(--poseify-text-dim);
  font-size: 12px;
}

.panel {
  position: fixed;
  top: 48px;
  bottom: 12px;
  width: 216px;
  padding: 10px 12px;
  border: 1px solid var(--poseify-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--poseify-panel) 94%, transparent);
  backdrop-filter: blur(6px);
  overflow-y: auto;
  z-index: 2;
}

.panel-left {
  left: 12px;
}

.model-dock {
  position: fixed;
  z-index: 3;
  left: 50%;
  bottom: 8px;
  transform: translateX(-50%);
  display: flex;
  gap: 2px;
  max-width: calc(100vw - 16px);
  overflow-x: auto;
  padding: 4px;
  border: 1px solid var(--poseify-border);
  border-radius: 7px;
  background: color-mix(in srgb, var(--poseify-panel) 92%, transparent);
  backdrop-filter: blur(8px);
  box-shadow: 0 4px 18px #0006;
}

.model-tool {
  position: relative;
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--poseify-text);
  font-size: 22px;
  cursor: pointer;
}

.model-tool:hover,
.model-tool.on {
  background: color-mix(in srgb, var(--poseify-accent) 30%, transparent);
}

.model-tool.danger {
  color: #f87171;
}

.color-tool input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}

@media (max-width: 600px) {
  .model-dock {
    justify-content: flex-start;
    left: 8px;
    right: 8px;
    transform: none;
  }

  .model-tool {
    flex-basis: 36px;
    width: 36px;
    height: 36px;
  }
}

.panel h2 {
  margin: 10px 0 6px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--poseify-text-dim);
}

.panel h3 {
  margin: 8px 0 4px;
  font-size: 11px;
  font-weight: 500;
  color: var(--poseify-text-dim);
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.grid.bones {
  grid-template-columns: 1fr;
  max-height: 260px;
  overflow-y: auto;
}

button.chip {
  padding: 5px 6px;
  border: 1px solid var(--poseify-border);
  border-radius: 6px;
  background: #232833;
  color: var(--poseify-text);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}

button.chip:hover {
  border-color: var(--poseify-accent);
}

button.chip.on {
  border-color: var(--poseify-accent);
  background: color-mix(in srgb, var(--poseify-accent) 26%, #232833);
}

button.chip.small {
  font-size: 10px;
  padding: 3px 6px;
}

button.chip.wide {
  width: 100%;
  text-align: center;
}

/* Phase 1 object toolbar: a segmented control for the gizmo mode and a
   wrapping row of the per-object commands. */
.row {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}

.row.wrap {
  flex-wrap: wrap;
}

/* Camera preset name field sits beside its Save button. */
.preset-row input[type="text"] {
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid var(--poseify-border);
  border-radius: 6px;
  background: #1b1f27;
  color: var(--poseify-text);
  font-size: 11px;
}

.vendor-grid {
  max-height: 320px;
  overflow-y: auto;
}

.vendor-grid .pose-tile img,
.vendor-grid .prop-tile img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 5px;
  background: #101319;
}

.vendor-list {
  max-height: 320px;
  overflow-y: auto;
}

.bone-tags {
  max-height: 120px;
  overflow-y: auto;
}

.inline-field {
  flex: 1 1 0;
  min-width: 0;
}

.inline-field input {
  width: 100%;
  padding: 3px 5px;
  border: 1px solid var(--poseify-border);
  border-radius: 6px;
  background: #1b1f27;
  color: var(--poseify-text);
  font-size: 11px;
}

.hand-tile {
  align-items: stretch;
}

.hand-thumb {
  aspect-ratio: 3 / 4;
}

.gizmo-modes button.chip {
  flex: 1 1 0;
  text-align: center;
}

button.chip.danger {
  color: var(--poseify-danger, #ff8080);
}

button.chip.tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 4px;
  text-align: center;
  width: 100%;
  height: 100%;
}

.tile-wrap {
  position: relative;
}

button.chip.tile.hasThumb {
  padding: 3px 3px 5px;
}

.thumb {
  width: 100%;
  height: 58px;
  object-fit: contain;
  border-radius: 4px;
  background: linear-gradient(180deg, #1b1f27, #14171d);
}

.thumb.placeholder {
  display: block;
}

button.chip.tile.loading {
  border-color: var(--poseify-accent);
  opacity: 0.6;
}

/* Compact controls float above the canvas; detailed tools stay in panels. */
.rail {
  position: fixed;
  top: 8px;
  z-index: 3;
  display: flex;
  gap: 4px;
}

.rail-top-left {
  left: 4px;
}

.rail-top-right {
  right: 4px;
}

.rail-bottom-left {
  top: auto;
  bottom: 10px;
  left: 8px;
}

.light-panel {
  position: fixed;
  z-index: 3;
  left: 12px;
  bottom: 54px;
  width: min(280px, calc(100vw - 24px));
  padding: 10px 12px;
  border: 1px solid var(--poseify-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--poseify-panel) 96%, transparent);
  backdrop-filter: blur(10px);
}

.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.light-modes {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin-bottom: 10px;
}

.light-modes button {
  padding: 6px 4px;
  border: 1px solid var(--poseify-border);
  background: #232833;
  color: var(--poseify-text);
  cursor: pointer;
}

.light-modes button:first-child {
  border-radius: 6px 0 0 6px;
}

.light-modes button:last-child {
  border-radius: 0 6px 6px 0;
}

.light-modes button.on {
  border-color: var(--poseify-accent);
  background: color-mix(in srgb, var(--poseify-accent) 30%, #232833);
}

.icon-btn {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--poseify-text);
  font-size: 21px;
  line-height: 1;
  cursor: pointer;
  transition: background 120ms ease;
}

.icon-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--poseify-panel) 76%, transparent);
}

.icon-btn:active:not(:disabled) {
  background: color-mix(in srgb, var(--poseify-accent) 35%, var(--poseify-panel));
}

.icon-btn.on {
  background: color-mix(in srgb, var(--poseify-accent) 60%, var(--poseify-panel));
}

.icon-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.icon-btn.close {
  width: 30px;
  height: 30px;
  font-size: 20px;
}

.icon-btn svg {
  width: 22px;
  height: 22px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

.status-pill {
  position: fixed;
  left: 60px;
  top: 16px;
  z-index: 2;
  margin: 0;
  padding: 4px 10px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--poseify-panel) 80%, transparent);
  color: var(--poseify-text-dim);
  font-size: 12px;
  pointer-events: none;
}

/* Attach-mode feedback sits under the status pill so the two never overlap,
 * and takes the warn colour only when there is something to report. */
.attach-hint {
  top: 44px;
  color: var(--poseify-accent, #ffc53d);
}

.attach-hint.warn {
  color: #ff8f6b;
}

/* Overlay surface: large, centred, and offset from the rails so it never
 * covers the buttons that opened it. */
.overlay {
  position: fixed;
  z-index: 4;
  top: 52px;
  left: 12px;
  right: 12px;
  bottom: 12px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--poseify-border);
  border-radius: 12px;
  background: color-mix(in srgb, var(--poseify-panel) 96%, transparent);
  backdrop-filter: blur(12px);
  box-shadow: 0 18px 50px rgb(0 0 0 / 45%);
  overflow: hidden;
}

.overlay.hand-overlay {
  right: auto;
  width: min(600px, calc(100vw - 24px));
  top: 8px;
  bottom: 8px;
  border-radius: 0 8px 8px 0;
}

.overlay-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--poseify-border);
}

.overlay-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.overlay-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px;
}

.overlay-pane {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* The old side panel is superseded by the rails, dock, and focused overlays. */
.panel-left {
  display: none;
}

.overlay-controls {
  display: flex;
  align-items: flex-end;
  gap: 10px;
}

.overlay-controls .grow {
  flex: 1;
}

.overlay-controls .compact {
  width: 110px;
}

.overlay-controls input[type="number"] {
  width: 100%;
}

.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 4px 0 2px;
}

.pager .hint {
  margin: 0;
  min-width: 200px;
  text-align: center;
}

/* The pose grid's own rule is 2 columns with a 320px cap, sized for the old
 * 216px rail. Inside the overlay it has the full width, so it becomes an
 * auto-fill grid and gives up the inner scroll — the overlay body scrolls
 * instead, which keeps the pager reachable.
 */
.overlay-pane .pose-grid {
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
  gap: 8px;
  max-height: none;
  overflow-y: visible;
  margin-top: 0;
}

.hand-pose-browser {
  gap: 8px;
}

.hand-side-tabs {
  display: flex;
  width: min(520px, 100%);
  background: #292929;
}

.hand-side-tabs button {
  flex: 1;
  min-height: 34px;
  border: 0;
  background: transparent;
  color: var(--poseify-text);
  cursor: pointer;
}

.hand-side-tabs button.on {
  background: #4b4b4b;
}

.overlay-pane .hand-pose-grid {
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.hand-pose-tile img,
.hand-preview-loading {
  width: 100%;
  height: 104px;
  object-fit: cover;
  border-radius: 3px;
  background: #1b1b1b;
}

.hand-preview-loading {
  display: block;
  background: #1b1b1b;
}

.animation-browser {
  max-width: 1040px;
}

.overlay-pane .animation-grid {
  grid-template-columns: repeat(auto-fill, minmax(145px, 1fr));
  gap: 8px;
}

.animation-tile {
  position: relative;
}

.animation-tile .clip-meta {
  position: absolute;
  right: 5px;
  top: 5px;
  padding: 2px 4px;
  border-radius: 3px;
  background: #111c;
}

.animation-empty {
  min-height: 180px;
  display: grid;
  place-items: center;
  border: 1px solid var(--poseify-border);
  border-radius: 6px;
  color: var(--poseify-text-dim);
}

.animation-transport {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 600px;
}

.animation-transport .scrub {
  flex: 1;
}

/* Prop and export-pass buttons flow rather than sitting in the old 2-column
 * grid, so an overlay of any width lays them out sensibly. */
.chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip-grid .chip {
  padding: 7px 12px;
  text-align: center;
}

.overlay-pane .scene-list {
  max-height: 260px;
}

/* Overlay headings sit closer together than the old panel ones: the overlay
 * scrolls, so the spacing is spent on content rather than on air. */
.overlay-pane h3,
.overlay-pane .sub {
  margin: 6px 0 4px;
  font-size: 13px;
}

.overlay-pane > .group:first-child h3 {
  margin-top: 0;
}

/* Model tiles go from 2-up in a 216px rail to 5-up across the overlay, which
 * is what makes the renders readable. */
.tile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}

.segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}

.segmented button {
  padding: 6px;
  border: 1px solid var(--poseify-border);
  border-radius: 6px;
  background: #232833;
  color: var(--poseify-text);
  font-size: 12px;
  cursor: pointer;
}

.segmented button.on {
  border-color: var(--poseify-accent);
  background: color-mix(in srgb, var(--poseify-accent) 30%, #232833);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.list li {
  display: flex;
  align-items: stretch;
  gap: 3px;
}

.list li button:first-child {
  flex: 1;
  padding: 5px 6px;
  border: 1px solid var(--poseify-border);
  border-radius: 6px;
  background: #232833;
  color: var(--poseify-text);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}

.list li.active button:first-child {
  border-color: var(--poseify-accent);
}

.list li button.danger {
  width: 24px;
  border: 1px solid var(--poseify-border);
  border-radius: 6px;
  background: #232833;
  color: var(--poseify-text-dim);
  cursor: pointer;
}

.hint {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--poseify-text-dim);
}

.field {
  display: block;
  margin: 6px 0;
}

.field > span {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--poseify-text-dim);
  margin-bottom: 3px;
}

.field b {
  color: var(--poseify-text);
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

.field input[type="range"] {
  width: 100%;
  height: 16px;
  accent-color: var(--poseify-accent);
  cursor: pointer;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 5px 0;
  font-size: 11px;
  color: var(--poseify-text-dim);
  cursor: pointer;
}

.check input {
  accent-color: var(--poseify-accent);
  cursor: pointer;
}

.hint.warn {
  color: #f0b4b4;
}

.field input[type="search"] {
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--poseify-border);
  border-radius: 5px;
  background: #1a1e26;
  color: var(--poseify-text);
  font-size: 11px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
  margin: 6px 0;
}

button.tag {
  padding: 2px 6px;
  border: 1px solid var(--poseify-border);
  border-radius: 10px;
  background: transparent;
  color: var(--poseify-text-dim);
  font-size: 10px;
  cursor: pointer;
}

button.tag.on {
  border-color: var(--poseify-accent);
  background: color-mix(in srgb, var(--poseify-accent) 28%, transparent);
  color: var(--poseify-text);
}

.pose-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  max-height: 320px;
  overflow-y: auto;
  margin-top: 6px;
}

.pose-tile {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 3px;
  border: 1px solid var(--poseify-border);
  border-radius: 5px;
  background: #232833;
  color: var(--poseify-text);
  cursor: pointer;
  text-align: center;
}

.pose-tile:hover {
  border-color: var(--poseify-accent);
}

.pose-tile.on {
  border-color: var(--poseify-accent);
  background: color-mix(in srgb, var(--poseify-accent) 24%, #232833);
}

.pose-tile img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  border-radius: 3px;
  background: #0e1014;
}

.pose-name {
  font-size: 9px;
  line-height: 1.2;
  color: var(--poseify-text-dim);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.clip-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 160px;
  overflow-y: auto;
  margin: 6px 0;
}

.clip-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 4px 6px;
  border: 1px solid var(--poseify-border);
  border-radius: 5px;
  background: #232833;
  color: var(--poseify-text);
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}

.clip-row:hover {
  border-color: var(--poseify-accent);
}

.clip-row.on {
  border-color: var(--poseify-accent);
  background: color-mix(in srgb, var(--poseify-accent) 24%, #232833);
}

.clip-meta {
  color: var(--poseify-text-dim);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.transport {
  margin-top: 6px;
}

.transport-buttons {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
}

.transport-buttons .chip.wide {
  grid-column: span 2;
}

.scrub {
  width: 100%;
  height: 18px;
  margin-top: 4px;
  accent-color: var(--poseify-accent);
  cursor: pointer;
}

.file-btn {
  display: block;
  margin-top: 6px;
  padding: 5px 6px;
  border: 1px dashed var(--poseify-border);
  border-radius: 6px;
  color: var(--poseify-text-dim);
  font-size: 11px;
  text-align: center;
  cursor: pointer;
}

.file-btn:hover {
  border-color: var(--poseify-accent);
  color: var(--poseify-text);
}

.prop-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 6px;
}

.prop-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 4px 6px;
  border: 1px solid var(--poseify-border);
  border-radius: 5px;
  background: #232833;
  font-size: 11px;
}

.prop-row.on {
  border-color: var(--poseify-accent);
  background: color-mix(in srgb, var(--poseify-accent) 22%, #232833);
}

.prop-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.prop-actions {
  display: flex;
  gap: 2px;
}

button.chip.tiny {
  padding: 1px 5px;
  font-size: 10px;
  line-height: 1.3;
}

button.chip.tiny.danger {
  color: #f0b4b4;
}

.scene-buttons {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 4px;
}

.panel h3.sub {
  margin: 8px 0 3px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--poseify-text-dim);
}

.scene-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
}

button.scene-row,
.scene-row.saved {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--poseify-border);
  border-radius: 5px;
  background: #232833;
  color: var(--poseify-text);
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}

button.scene-row:hover,
.scene-row.saved:hover {
  border-color: var(--poseify-accent);
}

.scene-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.error {
  position: fixed;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  margin: 0;
  padding: 8px 12px;
  border: 1px solid #7a3030;
  border-radius: 6px;
  background: #2a1a1a;
  color: #f0b4b4;
  font-size: 12px;
  z-index: 3;
}

.export-buttons {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

button.chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.export-strip {
  position: fixed;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  max-width: min(92vw, 860px);
  padding: 8px 10px;
  border: 1px solid var(--poseify-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--poseify-panel) 95%, transparent);
  backdrop-filter: blur(6px);
  z-index: 4;
}

.export-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--poseify-text-dim);
}

.export-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 6px;
}

.export-grid figure {
  margin: 0;
}

.export-grid img {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  object-fit: contain;
  border-radius: 4px;
  background: #0e1014;
}

.export-grid figcaption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  margin-top: 3px;
  font-size: 10px;
  color: var(--poseify-text-dim);
}

/* ---- M10: favourites, settings and onboarding tour ---- */
.fav {
  position: absolute;
  top: 4px;
  right: 6px;
  padding: 0 2px;
  border: 0;
  background: none;
  font-size: 14px;
  line-height: 1;
  color: rgba(255, 255, 255, 0.45);
  cursor: pointer;
  user-select: none;
}

.fav.on {
  color: #ff5c7a;
}

.modal {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  background: rgba(6, 8, 14, 0.68);
}

.sheet {
  width: min(460px, 92vw);
  max-height: 84vh;
  overflow: auto;
  padding: 16px 18px 20px;
  border-radius: 10px;
  background: #14171f;
  border: 1px solid #262b36;
  color: #e6e8ee;
}

.sheet header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.sheet h2 {
  margin: 0 0 8px;
  font-size: 16px;
}

.sheet h3 {
  margin: 14px 0 6px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #8f97a8;
}

.toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 0;
  cursor: pointer;
}

.shortcuts {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 12px;
  margin: 0 0 12px;
  font-size: 13px;
}

.shortcuts dt {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #9fd0ff;
  white-space: nowrap;
}

.shortcuts dd {
  margin: 0;
  color: #c3c8d4;
}

.tour {
  position: fixed;
  inset: auto 0 0 0;
  z-index: 70;
  display: flex;
  justify-content: center;
  padding: 18px;
  pointer-events: none;
}

.tour-card {
  pointer-events: auto;
  width: min(520px, 94vw);
  padding: 14px 16px;
  border-radius: 10px;
  background: #171b24;
  border: 1px solid #2b3140;
  box-shadow: 0 10px 32px rgba(0, 0, 0, 0.45);
  color: #e6e8ee;
}

.tour-card h3 {
  margin: 0 0 6px;
  font-size: 15px;
}

.tour-card p {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 1.5;
  color: #c3c8d4;
}

.tour-card footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tour-dots {
  display: flex;
  gap: 5px;
  margin-right: auto;
}

.tour-dots i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #3a4152;
}

.tour-dots i.on {
  background: #6fb4ff;
}
</style>











