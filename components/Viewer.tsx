

import React, { useRef, useEffect, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CubeIcon } from './Icons';

interface ViewerProps {
  modelUrl?: string;
  onModelUpload?: (url: string) => void;
}

const Viewer: React.FC<ViewerProps> = ({ modelUrl, onModelUpload }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(!!modelUrl);
  const [error, setError] = useState<string | null>(null);

  const loaderRef = useRef<((url: string) => void) | null>(null);
  const modelRemoverRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;

    const currentMount = mountRef.current;
    let animationFrameId: number;
    
    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111827); // bg-gray-900

    // Camera setup
    const camera = new THREE.PerspectiveCamera(75, currentMount.clientWidth / currentMount.clientHeight, 0.1, 1000);
    camera.position.z = 5;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    currentMount.appendChild(renderer.domElement);
    
    // Controls setup
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // Lighting setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    let model: THREE.Group | null = null;
    const loader = new GLTFLoader();

    modelRemoverRef.current = () => {
      if (model) {
        scene.remove(model);
        model = null;
      }
    };

    loaderRef.current = (url: string) => {
      modelRemoverRef.current?.();
      
      setIsLoading(true);
      setError(null);
      setModelLoaded(false);

      loader.load(url, (gltf) => {
        model = gltf.scene;
        
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);
        
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const cameraDistance = 5; // Adjust this value to control zoom
        const scale = cameraDistance / maxDim;
        model.scale.set(scale, scale, scale);
        
        scene.add(model);
        
        controls.reset();
        controls.target.copy(model.position);
        
        setIsLoading(false);
        setModelLoaded(true);
      }, undefined, (error) => {
        console.error('An error happened during loading:', error);
        setError('Failed to load model. Please ensure it is a valid .glb file or the URL is correct.');
        setIsLoading(false);
      });
    };
    
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver(() => {
        if (!mountRef.current) return;
        const { clientWidth, clientHeight } = mountRef.current;
        // Avoid issues with 0 dimensions, which can happen during layout shifts
        if (clientWidth === 0 || clientHeight === 0) return;
        
        camera.aspect = clientWidth / clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(clientWidth, clientHeight);
    });
    resizeObserver.observe(currentMount);

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      if (renderer.domElement.parentNode === currentMount) {
        currentMount.removeChild(renderer.domElement);
      }
      renderer.dispose();
      controls.dispose();
    };
  }, []);
  
  useEffect(() => {
    if (modelUrl && loaderRef.current) {
      loaderRef.current(modelUrl);
    } else {
      // If no modelUrl is provided, reset to initial state and clear model
      modelRemoverRef.current?.();
      setModelLoaded(false);
      setIsLoading(false);
    }
  }, [modelUrl]);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && onModelUpload) {
      const url = URL.createObjectURL(file);
      onModelUpload(url);
    }
    // Reset the input value to allow re-uploading the same file
    if (event.target) {
      event.target.value = '';
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="w-full h-full flex flex-col relative">
      <div ref={mountRef} className="w-full h-full rounded-lg" />
      
      {/* This input is always in the DOM, so it can be triggered from either button */}
      <input
        type="file"
        accept=".glb"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        aria-label="Upload GLB model"
      />

      {modelLoaded && !isLoading && (
        <div className="absolute top-4 left-4">
            <button
              onClick={handleUploadClick}
              className="px-4 py-2 bg-gray-800/80 backdrop-blur-sm border border-gray-700/50 text-white text-sm font-semibold rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors pointer-events-auto"
              aria-label="Change 3D model"
            >
              Change Model
            </button>
        </div>
      )}

      {(!modelLoaded && !isLoading) && (
        <div className="absolute inset-0 bg-gray-900 border-2 border-dashed border-gray-700 rounded-lg flex flex-col justify-center items-center pointer-events-none">
          <div className="text-center p-8">
            <CubeIcon />
            <h2 className="mt-4 text-xl font-semibold text-gray-400">3D Model Viewer</h2>
            <p className="mt-1 text-sm text-gray-500">Upload a .glb file or select a date to get started.</p>
            <button
              onClick={handleUploadClick}
              className="mt-6 px-4 py-2 bg-cyan-600 text-white font-semibold rounded-md hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors pointer-events-auto"
            >
              Upload .glb
            </button>
            {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
          </div>
        </div>
      )}

      {isLoading && (
         <div className="absolute inset-0 bg-gray-900/80 rounded-lg flex flex-col justify-center items-center">
           <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-cyan-400"></div>
           <p className="mt-4 text-lg text-gray-300">Loading Model...</p>
         </div>
      )}
    </div>
  );
};

export default Viewer;