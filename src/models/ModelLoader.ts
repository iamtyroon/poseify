// Lazy model loading. Loaders are heavy, so FBX and OBJ are dynamically
// imported and only cost anything when a model of that format is requested.
// Draco and KTX2 decoders live on a CDN configured at runtime rather than
// being bundled, which keeps the initial payload small.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";

export type ModelFormat = "gltf" | "glb" | "fbx" | "obj";

export interface LoadedModel {
  root: THREE.Object3D;
  format: ModelFormat;
}

export class ModelLoadError extends Error {
  constructor(
    message: string,
    readonly url: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ModelLoadError";
  }
}

let decoderPath = "https://www.gstatic.com/draco/versioned/decoders/1.5.6/";
let ktx2Path =
  "https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/basis/";

export function setDecoderPaths(paths: {
  draco?: string;
  ktx2?: string;
}): void {
  if (paths.draco) decoderPath = paths.draco;
  if (paths.ktx2) ktx2Path = paths.ktx2;
}

let dracoLoader: DRACOLoader | null = null;
let ktx2Loader: KTX2Loader | null = null;

function restoreSkinBindPose(root: THREE.Object3D): void {
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
  });
  for (const skeleton of skeletons) skeleton.pose();
  root.updateMatrixWorld(true);
}

function getDraco(): DRACOLoader {
  if (!dracoLoader) {
    dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(decoderPath);
  }
  return dracoLoader;
}

// KTX2 needs a renderer to detect support. Returns null without one so
// headless and unit-test paths never touch WebGL.
function getKTX2(renderer?: THREE.WebGLRenderer): KTX2Loader | null {
  if (!renderer) return null;
  if (!ktx2Loader) {
    ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath(ktx2Path);
    ktx2Loader.detectSupport(renderer);
  }
  return ktx2Loader;
}

export function detectFormat(url: string): ModelFormat {
  const clean = url.split("?")[0].toLowerCase();
  if (clean.endsWith(".glb")) return "glb";
  if (clean.endsWith(".gltf")) return "gltf";
  if (clean.endsWith(".fbx")) return "fbx";
  if (clean.endsWith(".obj")) return "obj";
  throw new ModelLoadError(`Unsupported model extension: ${url}`, url);
}

/**
 * Load a model by URL. FBX and OBJ loaders are dynamically imported so they
 * only load when a model of that format is actually requested.
 */
export async function loadModelFromURL(
  url: string,
  options: { renderer?: THREE.WebGLRenderer } = {},
): Promise<LoadedModel> {
  const format = detectFormat(url);

  try {
    switch (format) {
      case "glb":
      case "gltf": {
        const loader = new GLTFLoader();
        loader.setDRACOLoader(getDraco());
        const ktx2 = getKTX2(options.renderer);
        if (ktx2) loader.setKTX2Loader(ktx2);
        const gltf = await loader.loadAsync(url);
        restoreSkinBindPose(gltf.scene);
        return { root: gltf.scene, format };
      }
      case "fbx": {
        const { FBXLoader } = await import(
          "three/examples/jsm/loaders/FBXLoader.js"
        );
        const loader = new FBXLoader();
        // FBXLoader has no Draco path: FBX stores geometry uncompressed, and
        // three's FBXLoader does not expose setDRACOLoader. Only GLTF does.
        const root = await loader.loadAsync(url);
        restoreSkinBindPose(root);
        return { root, format };
      }
      case "obj": {
        const { OBJLoader } = await import(
          "three/examples/jsm/loaders/OBJLoader.js"
        );
        const root = await new OBJLoader().loadAsync(url);
        return { root, format };
      }
    }
  } catch (err) {
    throw new ModelLoadError(`Failed to load model: ${url}`, url, err);
  }
}

/** Load a model from a user-supplied File (drag-and-drop or file input). */
export async function loadModelFromFile(
  file: File,
  options: { renderer?: THREE.WebGLRenderer } = {},
): Promise<LoadedModel> {
  const url = URL.createObjectURL(file);
  try {
    return await loadModelFromURL(url, options);
  } finally {
    URL.revokeObjectURL(url);
  }
}
