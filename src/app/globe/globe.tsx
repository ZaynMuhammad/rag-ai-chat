"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const EARTH_RADIUS = 1;
const NIGHT_LIGHTS_RADIUS = EARTH_RADIUS * 1.001;
const CLOUDS_RADIUS = EARTH_RADIUS * 1.01;
const SPHERE_WIDTH_SEGMENTS = 128;
const SPHERE_HEIGHT_SEGMENTS = 64;
const SUN_DIRECTION = new THREE.Vector3(5, 3, 5).normalize();
const CLOUD_DRIFT_RADIANS_PER_SECOND = 0.008;
const MIN_FIELD_OF_VIEW_DEGREES = 45;
const MAX_PIXEL_RATIO = 2;

const nightLightsVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldNormal;

  void main() {
    vUv = uv;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const nightLightsFragmentShader = /* glsl */ `
  uniform sampler2D lightsMap;
  uniform vec3 sunDirection;
  uniform vec3 lightsColor;
  varying vec2 vUv;
  varying vec3 vWorldNormal;

  void main() {
    float darkness = smoothstep(0.1, -0.25, dot(normalize(vWorldNormal), sunDirection));
    gl_FragColor = vec4(lightsColor * texture2D(lightsMap, vUv).r * darkness, 1.0);
  }
`;

type EarthTextures = ReturnType<typeof loadEarthTextures>;

function fieldOfViewFitting(aspect: number) {
  if (aspect >= 1) return MIN_FIELD_OF_VIEW_DEGREES;
  const halfMinFieldOfView = THREE.MathUtils.degToRad(MIN_FIELD_OF_VIEW_DEGREES / 2);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfMinFieldOfView) / aspect));
}

function loadEarthTextures(anisotropy: number) {
  const loader = new THREE.TextureLoader();
  const load = (name: string) => {
    const texture = loader.load(`/textures/earth/${name}.jpg`);
    texture.anisotropy = anisotropy;
    return texture;
  };
  const day = load("day");
  day.colorSpace = THREE.SRGBColorSpace;
  return {
    day,
    roughness: load("roughness"),
    nightLights: load("night"),
    clouds: load("clouds"),
  };
}

function sphere(radius: number) {
  return new THREE.SphereGeometry(radius, SPHERE_WIDTH_SEGMENTS, SPHERE_HEIGHT_SEGMENTS);
}

function createEarth(textures: EarthTextures) {
  const surface = new THREE.Mesh(
    sphere(EARTH_RADIUS),
    new THREE.MeshStandardMaterial({
      map: textures.day,
      roughnessMap: textures.roughness,
      metalness: 0,
    }),
  );
  const nightLights = new THREE.Mesh(
    sphere(NIGHT_LIGHTS_RADIUS),
    new THREE.ShaderMaterial({
      uniforms: {
        lightsMap: { value: textures.nightLights },
        sunDirection: { value: SUN_DIRECTION },
        lightsColor: { value: new THREE.Color("#ffd8a0") },
      },
      vertexShader: nightLightsVertexShader,
      fragmentShader: nightLightsFragmentShader,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    }),
  );
  const clouds = new THREE.Mesh(
    sphere(CLOUDS_RADIUS),
    new THREE.MeshStandardMaterial({
      color: "#ffffff",
      alphaMap: textures.clouds,
      transparent: true,
      depthWrite: false,
    }),
  );
  nightLights.renderOrder = 1;
  clouds.renderOrder = 2;
  return { earth: new THREE.Group().add(surface, nightLights, clouds), clouds };
}

function disposeMeshes(root: THREE.Object3D) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      object.material.dispose();
    }
  });
}

export function Globe() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    container.appendChild(renderer.domElement);

    const textures = loadEarthTextures(renderer.capabilities.getMaxAnisotropy());
    const { earth, clouds } = createEarth(textures);
    const scene = new THREE.Scene();
    scene.add(earth);
    scene.add(new THREE.AmbientLight("#ffffff", 0.15));
    const sun = new THREE.DirectionalLight("#ffffff", 3);
    sun.position.copy(SUN_DIRECTION);
    scene.add(sun);

    const camera = new THREE.PerspectiveCamera(MIN_FIELD_OF_VIEW_DEGREES, 1, 0.1, 100);
    camera.position.set(0, 0, 3.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    controls.minDistance = 1.6;
    controls.maxDistance = 8;

    const resize = () => {
      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) return;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.fov = fieldOfViewFitting(camera.aspect);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    const timer = new THREE.Timer();
    renderer.setAnimationLoop((timestamp) => {
      timer.update(timestamp);
      const delta = timer.getDelta();
      clouds.rotation.y += CLOUD_DRIFT_RADIANS_PER_SECOND * delta;
      controls.update(delta);
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      controls.dispose();
      disposeMeshes(scene);
      Object.values(textures).forEach((texture) => texture.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0" />;
}
