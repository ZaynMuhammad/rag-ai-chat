"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const GLOBE_RADIUS = 1;
const GRATICULE_RADIUS = GLOBE_RADIUS * 1.002;
const GRATICULE_STEP_DEGREES = 15;
const CIRCLE_SEGMENTS = 128;
const MIN_FIELD_OF_VIEW_DEGREES = 45;

function fieldOfViewFitting(aspect: number) {
  if (aspect >= 1) return MIN_FIELD_OF_VIEW_DEGREES;
  const halfMinFieldOfView = THREE.MathUtils.degToRad(MIN_FIELD_OF_VIEW_DEGREES / 2);
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(halfMinFieldOfView) / aspect));
}

function circleSegments(pointAt: (angle: number) => THREE.Vector3) {
  return Array.from({ length: CIRCLE_SEGMENTS }, (_, index) => [
    pointAt((index / CIRCLE_SEGMENTS) * Math.PI * 2),
    pointAt(((index + 1) / CIRCLE_SEGMENTS) * Math.PI * 2),
  ]).flat();
}

function createGraticuleGeometry() {
  const latitudes = Array.from(
    { length: 180 / GRATICULE_STEP_DEGREES - 1 },
    (_, index) => THREE.MathUtils.degToRad(-90 + GRATICULE_STEP_DEGREES * (index + 1)),
  );
  const longitudes = Array.from(
    { length: 180 / GRATICULE_STEP_DEGREES },
    (_, index) => THREE.MathUtils.degToRad(GRATICULE_STEP_DEGREES * index),
  );

  const parallels = latitudes.flatMap((latitude) =>
    circleSegments((angle) =>
      new THREE.Vector3().setFromSphericalCoords(GRATICULE_RADIUS, Math.PI / 2 - latitude, angle),
    ),
  );
  const meridians = longitudes.flatMap((longitude) =>
    circleSegments((angle) =>
      new THREE.Vector3().setFromSphericalCoords(GRATICULE_RADIUS, angle, longitude),
    ),
  );

  return new THREE.BufferGeometry().setFromPoints([...parallels, ...meridians]);
}

function createGlobe() {
  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(GLOBE_RADIUS, 64, 32),
    new THREE.MeshStandardMaterial({ color: "#1d4ed8", roughness: 0.8 }),
  );
  const graticule = new THREE.LineSegments(
    createGraticuleGeometry(),
    new THREE.LineBasicMaterial({ color: "#93c5fd", transparent: true, opacity: 0.5 }),
  );
  return new THREE.Group().add(surface, graticule);
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
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
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const globe = createGlobe();
    scene.add(globe);
    scene.add(new THREE.AmbientLight("#ffffff", 0.6));
    const sun = new THREE.DirectionalLight("#ffffff", 2.4);
    sun.position.set(5, 3, 5);
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
      controls.update(timer.getDelta());
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      resizeObserver.disconnect();
      controls.dispose();
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={containerRef} className="absolute inset-0" />;
}
