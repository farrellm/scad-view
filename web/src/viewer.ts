import {
  AmbientLight, AxesHelper, Box3, BufferGeometry, Color, DirectionalLight, GridHelper,
  Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, Sphere, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DEFAULT_COLOR = 0xf9d72c; // OpenSCAD's own default model yellow

export class Viewer {
  #renderer: WebGLRenderer;
  #scene = new Scene();
  #camera: PerspectiveCamera;
  #controls: OrbitControls;
  #modelGroup = new Group();
  #mesh: Mesh | null = null;
  #grid: GridHelper;
  #axes: AxesHelper;

  constructor(canvas: HTMLCanvasElement) {
    // preserveDrawingBuffer keeps the canvas readable after compositing, so the
    // model can be screenshotted / saved straight out of the page.
    this.#renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.#renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.#scene.background = new Color(0x1b1d21);

    this.#camera = new PerspectiveCamera(45, 1, 0.1, 10_000);
    this.#camera.position.set(60, -80, 50);
    this.#camera.up.set(0, 0, 1); // OpenSCAD is Z-up

    this.#controls = new OrbitControls(this.#camera, canvas);
    this.#controls.enableDamping = true;
    this.#controls.dampingFactor = 0.12;

    this.#scene.add(new AmbientLight(0xffffff, 1.4));
    const key = new DirectionalLight(0xffffff, 2.0);
    key.position.set(1, -1.4, 1.8);
    this.#scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.7);
    fill.position.set(-1.2, 1, -0.6);
    this.#scene.add(fill);

    this.#grid = new GridHelper(200, 20, 0x4a5058, 0x2c3036);
    this.#grid.rotateX(Math.PI / 2); // GridHelper is XZ by default; OpenSCAD wants XY
    this.#scene.add(this.#grid);

    this.#axes = new AxesHelper(30);
    this.#scene.add(this.#axes);

    this.#scene.add(this.#modelGroup);

    const observer = new ResizeObserver(() => this.#resize());
    observer.observe(canvas.parentElement ?? canvas);
    this.#resize();

    const loop = () => {
      requestAnimationFrame(loop);
      this.#controls.update();
      this.#renderer.render(this.#scene, this.#camera);
    };
    loop();
  }

  #resize() {
    const parent = this.#renderer.domElement.parentElement;
    if (!parent) return;
    const { clientWidth: w, clientHeight: h } = parent;
    if (w === 0 || h === 0) return;
    this.#renderer.setSize(w, h, false);
    this.#camera.aspect = w / h;
    this.#camera.updateProjectionMatrix();
  }

  /**
   * Swap in a new mesh. `frame` should be true only when opening a different
   * model: on a watch-triggered re-render the camera must stay exactly put, or
   * the live-update workflow becomes unusable.
   */
  setGeometry(geometry: BufferGeometry, hasColor: boolean, frame: boolean) {
    this.clear();
    const material = new MeshStandardMaterial({
      color: hasColor ? 0xffffff : DEFAULT_COLOR,
      vertexColors: hasColor,
      flatShading: true,
      roughness: 0.55,
      metalness: 0.0,
    });
    this.#mesh = new Mesh(geometry, material);
    this.#modelGroup.add(this.#mesh);
    this.#fitHelpers(geometry);
    if (frame) this.frameAll(geometry);
  }

  /** Scale grid and axes to the model so they stay useful at any model size. */
  #fitHelpers(geometry: BufferGeometry) {
    const box = geometry.boundingBox ?? new Box3().setFromBufferAttribute(
      geometry.getAttribute('position') as never,
    );
    const size = box.getSize(new Vector3());
    const extent = Math.max(size.x, size.y, 1);
    const step = Math.pow(10, Math.round(Math.log10(extent)) - 1) || 1;
    const half = Math.ceil((extent * 0.9) / step) * step;

    this.#scene.remove(this.#grid);
    this.#grid.dispose();
    this.#grid = new GridHelper(half * 2, Math.max(2, Math.round((half * 2) / step)), 0x4a5058, 0x2c3036);
    this.#grid.rotateX(Math.PI / 2);
    this.#scene.add(this.#grid);

    this.#scene.remove(this.#axes);
    this.#axes.dispose();
    this.#axes = new AxesHelper(Math.max(extent * 0.6, 1));
    this.#scene.add(this.#axes);
  }

  frameAll(geometry?: BufferGeometry) {
    const g = geometry ?? this.#mesh?.geometry;
    if (!g) return;
    const sphere = g.boundingSphere ?? (g.computeBoundingSphere(), g.boundingSphere) as Sphere | null;
    if (!sphere || sphere.radius === 0) return;

    const fov = (this.#camera.fov * Math.PI) / 180;
    const distance = (sphere.radius / Math.sin(fov / 2)) * 1.25;
    const direction = new Vector3(0.6, -0.9, 0.55).normalize();

    this.#controls.target.copy(sphere.center);
    this.#camera.position.copy(sphere.center).addScaledVector(direction, distance);
    this.#camera.near = Math.max(distance / 1000, 0.01);
    this.#camera.far = distance * 100;
    this.#camera.updateProjectionMatrix();
    this.#controls.update();
  }

  /** Current camera placement, as plain numbers. Handy from the console. */
  cameraState() {
    const { x, y, z } = this.#camera.position;
    const t = this.#controls.target;
    return { position: [x, y, z], target: [t.x, t.y, t.z] };
  }

  clear() {
    if (!this.#mesh) return;
    this.#modelGroup.remove(this.#mesh);
    this.#mesh.geometry.dispose();
    (this.#mesh.material as MeshStandardMaterial).dispose();
    this.#mesh = null;
  }
}
