/**
 * Vendor entry point. Bundled by `npm run vendor:three` into
 * vendor/three.bundle.js, which is committed — the app build stays
 * dependency-free and only ever inlines the result.
 *
 * Named imports rather than `import * as THREE`: a namespace import defeats
 * tree-shaking and drags in loaders, curves, animation, audio and every
 * material the page never touches.
 *
 * Keep this list in sync with the symbols the page actually references:
 *   grep -o "THREE\.[A-Za-z0-9_]*" src/index.html | sort -u
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ColorManagement,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  REVISION,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Sphere,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
} from 'three';

globalThis.THREE = {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  ColorManagement,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  REVISION,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  Sphere,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  WebGLRenderTarget,
  WebGLRenderer,
};
