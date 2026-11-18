import * as THREE from "three";
import { loadModel, type CatalogEntry } from "../models/ModelCatalog";
import { PosableSkeleton } from "../posing/PosableSkeleton";
import type { HandPose } from "./HandPose";

const WIDTH = 176;
const HEIGHT = 120;
const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

let renderer: THREE.WebGLRenderer | null = null;
let scene: THREE.Scene | null = null;
let camera: THREE.PerspectiveCamera | null = null;
let source: Promise<{ root: THREE.Object3D; skeleton: PosableSkeleton } | null> | null = null;

function initRenderer(): boolean {
  if (renderer) return true;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch {
    return false;
  }
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);
  renderer.setClearColor(0x1b1b1b, 1);
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x606060, 2));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1, 3, 4);
  scene.add(key);
  camera = new THREE.PerspectiveCamera(38, WIDTH / HEIGHT, 0.01, 20);
  return true;
}

async function loadPreviewModel(config: CatalogEntry) {
  if (!source) {
    source = (async () => {
      const { root } = await loadModel(config);
      const skeleton = new PosableSkeleton(root, config, { bindHands: true });
      if (!skeleton.isValid) return null;
      return { root, skeleton };
    })().catch(() => null);
  }
  return source;
}

/** Render the selected finger articulation on the catalogue's real hand mesh. */
export function handPoseThumbnail(
  config: CatalogEntry,
  pose: HandPose,
): Promise<string | null> {
  const key = `${config.id}:${pose.id}`;
  if (cache.has(key)) return Promise.resolve(cache.get(key) ?? null);
  const existing = pending.get(key);
  if (existing) return existing;

  const task = (async () => {
    if (!initRenderer() || !renderer || !scene || !camera) return null;
    const preview = await loadPreviewModel(config);
    if (!preview) return null;

    const { root, skeleton } = preview;
    const handName = `${pose.side}Hand`;
    const hand = skeleton.getBone(handName);
    if (!hand) return null;

    skeleton.resetHandPose();
    skeleton.applyHandPose(pose.bones);
    root.updateMatrixWorld(true);
    const center = hand.getWorldPosition(new THREE.Vector3());
    const sideView = pose.side === "Right" ? -0.22 : 0.22;
    camera.position.set(center.x + sideView, center.y + 0.12, center.z + 0.34);
    camera.lookAt(center.x, center.y + 0.015, center.z);
    camera.updateProjectionMatrix();
    if (root.parent !== scene) scene.add(root);
    renderer.render(scene, camera);
    const image = renderer.domElement.toDataURL("image/png");
    cache.set(key, image);
    return image;
  })().catch(() => null).finally(() => pending.delete(key));

  pending.set(key, task);
  return task;
}
