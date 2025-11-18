

import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CubeIcon, PencilIcon, CloseIcon } from './Icons';
import { ThreeDAnnotation, ThreeDPoint, Insight } from '../types';

interface ViewerProps {
  modelUrl?: string;
  onModelUpload?: (url: string) => void;
  annotations?: ThreeDAnnotation[];
  onAnnotationAdd?: (annotation: ThreeDAnnotation) => void;
  insights?: Insight[];
}

const Viewer: React.FC<ViewerProps> = ({ modelUrl, onModelUpload, annotations = [], onAnnotationAdd, insights = [] }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(!!modelUrl);
  const [error, setError] = useState<string | null>(null);
  
  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [startPoint, setStartPoint] = useState<ThreeDPoint | null>(null);
  const [currentPoint, setCurrentPoint] = useState<ThreeDPoint | null>(null);
  const [showInsightModal, setShowInsightModal] = useState(false);
  const [tempAnnotation, setTempAnnotation] = useState<Partial<ThreeDAnnotation> | null>(null);

  const loaderRef = useRef<((url: string) => void) | null>(null);
  const modelRemoverRef = useRef<(() => void) | null>(null);
  
  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const annotationsGroupRef = useRef<THREE.Group | null>(null);
  const previewLineRef = useRef<THREE.Line | null>(null);
  const startPointMarkerRef = useRef<THREE.Mesh | null>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());

  // Helper to create line geometry
  const createLine = (start: ThreeDPoint, end: ThreeDPoint, color: string) => {
    const material = new THREE.LineBasicMaterial({ color: color, linewidth: 3 }); // linewidth might not work on all browsers (WebGL limitation)
    // Use a tube geometry for thicker lines if needed, but Line is standard for simple needs
    const points = [
        new THREE.Vector3(start.x, start.y, start.z),
        new THREE.Vector3(end.x, end.y, end.z)
    ];
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.Line(geometry, material);
  };

  // Render annotations
  useEffect(() => {
    if (!annotationsGroupRef.current || !sceneRef.current) return;
    
    // Clear existing annotations
    while(annotationsGroupRef.current.children.length > 0){ 
        const child = annotationsGroupRef.current.children[0];
        annotationsGroupRef.current.remove(child);
        if (child instanceof THREE.Line) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
        }
    }

    // Add annotations
    annotations.forEach(ann => {
        const line = createLine(ann.start, ann.end, ann.color);
        annotationsGroupRef.current?.add(line);
        
        // Add markers at ends
        const markerGeo = new THREE.SphereGeometry(0.05, 16, 16);
        const markerMat = new THREE.MeshBasicMaterial({ color: ann.color });
        const startMarker = new THREE.Mesh(markerGeo, markerMat);
        startMarker.position.set(ann.start.x, ann.start.y, ann.start.z);
        const endMarker = new THREE.Mesh(markerGeo, markerMat);
        endMarker.position.set(ann.end.x, ann.end.y, ann.end.z);
        annotationsGroupRef.current?.add(startMarker);
        annotationsGroupRef.current?.add(endMarker);
    });
  }, [annotations, modelLoaded]);

  // Render preview line
  useEffect(() => {
    if (!sceneRef.current || !isEditing) return;

    // Manage start point marker
    if (startPoint) {
        if (!startPointMarkerRef.current) {
            const geo = new THREE.SphereGeometry(0.08, 16, 16);
            const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
            const mesh = new THREE.Mesh(geo, mat);
            sceneRef.current.add(mesh);
            startPointMarkerRef.current = mesh;
        }
        startPointMarkerRef.current.position.set(startPoint.x, startPoint.y, startPoint.z);
    } else {
        if (startPointMarkerRef.current) {
            sceneRef.current.remove(startPointMarkerRef.current);
            startPointMarkerRef.current.geometry.dispose();
            (startPointMarkerRef.current.material as THREE.Material).dispose();
            startPointMarkerRef.current = null;
        }
    }

    // Manage preview line
    if (startPoint && currentPoint) {
        if (previewLineRef.current) {
            sceneRef.current.remove(previewLineRef.current);
            previewLineRef.current.geometry.dispose();
            (previewLineRef.current.material as THREE.Material).dispose();
        }
        const line = createLine(startPoint, currentPoint, '#00ff00');
        sceneRef.current.add(line);
        previewLineRef.current = line;
    } else {
         if (previewLineRef.current) {
            sceneRef.current.remove(previewLineRef.current);
            previewLineRef.current.geometry.dispose();
            (previewLineRef.current.material as THREE.Material).dispose();
            previewLineRef.current = null;
        }
    }
    
    // Cleanup on effect re-run or unmount
    return () => {
        // We don't dispose here strictly because we want persistence during state updates, 
        // but standard React cleanup usually implies removing side effects.
        // We'll rely on the next render to update/re-create or the final cleanup.
    };
  }, [isEditing, startPoint, currentPoint]);

  // Handle click on canvas
  const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isEditing || !modelRef.current || !cameraRef.current || !sceneRef.current) return;
    
    // Only process if it's a primary click and we are not dragging (OrbitControls handles dragging)
    // We can use a simple check: if mouse moved significantly between down and up, it's a drag.
    // But onClick only fires after mouseup.
    
    // Raycasting
    const rect = mountRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    mouseRef.current.set(x, y);
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);

    const intersects = raycasterRef.current.intersectObject(modelRef.current, true);

    if (intersects.length > 0) {
        const point = intersects[0].point;
        const clickedPoint: ThreeDPoint = { x: point.x, y: point.y, z: point.z };

        if (!startPoint) {
            setStartPoint(clickedPoint);
            setCurrentPoint(clickedPoint); // Init preview
        } else {
            // Finish line
            const newAnnotation: Partial<ThreeDAnnotation> = {
                id: Math.random().toString(36).substring(2, 10),
                start: startPoint,
                end: clickedPoint,
                color: '#ff0000' // Default color
            };
            setTempAnnotation(newAnnotation);
            setShowInsightModal(true);
            setStartPoint(null);
            setCurrentPoint(null);
        }
    }
  };

  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
      if (!isEditing || !startPoint || !modelRef.current || !cameraRef.current) return;

      const rect = mountRef.current?.getBoundingClientRect();
      if (!rect) return;

      const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      mouseRef.current.set(x, y);
      raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
      
      // Intersect with model for precise endpoint
      const intersects = raycasterRef.current.intersectObject(modelRef.current, true);
      if (intersects.length > 0) {
           const point = intersects[0].point;
           setCurrentPoint({ x: point.x, y: point.y, z: point.z });
      } else {
          // Optional: Project onto a plane if off-model? For now, stick to model.
      }
  };

  const handleInsightSelect = (insightId: string) => {
      if (tempAnnotation && onAnnotationAdd) {
          onAnnotationAdd({
              id: tempAnnotation.id!,
              start: tempAnnotation.start!,
              end: tempAnnotation.end!,
              color: tempAnnotation.color || '#ff0000',
              linkedInsightId: insightId
          });
      }
      setShowInsightModal(false);
      setTempAnnotation(null);
  };

  useEffect(() => {
    if (!mountRef.current) return;
    // ... (existing setup)

    const currentMount = mountRef.current;
    let animationFrameId: number;
    
    // Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x111827); // bg-gray-900

    // Camera setup
    const camera = new THREE.PerspectiveCamera(75, currentMount.clientWidth / currentMount.clientHeight, 0.1, 1000);
    cameraRef.current = camera;
    camera.position.z = 5;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    rendererRef.current = renderer;
    renderer.setSize(currentMount.clientWidth, currentMount.clientHeight);
    currentMount.appendChild(renderer.domElement);
    
    // Controls setup
    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = true;

    // Annotation Group
    const annGroup = new THREE.Group();
    scene.add(annGroup);
    annotationsGroupRef.current = annGroup;

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
        modelRef.current = null;
      }
    };

    loaderRef.current = (url: string) => {
      modelRemoverRef.current?.();
      
      setIsLoading(true);
      setError(null);
      setModelLoaded(false);

      loader.load(url, (gltf) => {
        model = gltf.scene;
        modelRef.current = model;
        
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
      
      // Dispose refs
      sceneRef.current = null;
      cameraRef.current = null;
      rendererRef.current = null;
      controlsRef.current = null;
      modelRef.current = null;
      annotationsGroupRef.current = null;
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
      <div 
        ref={mountRef} 
        className={`w-full h-full rounded-lg ${isEditing ? 'cursor-crosshair' : 'cursor-default'}`}
        onClick={handleCanvasClick}
        onMouseMove={handleCanvasMouseMove}
      />
      
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
        <>
            <div className="absolute top-4 left-4 flex flex-col gap-2">
                <button
                onClick={handleUploadClick}
                className="px-4 py-2 bg-gray-800/80 backdrop-blur-sm border border-gray-700/50 text-white text-sm font-semibold rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors pointer-events-auto"
                aria-label="Change 3D model"
                >
                Change Model
                </button>
            </div>
            
             {/* Edit Mode Toggle */}
            <div className="absolute top-4 right-4 flex gap-2">
                 <button
                    onClick={() => {
                        setIsEditing(!isEditing);
                        setStartPoint(null);
                        setCurrentPoint(null);
                    }}
                    className={`px-4 py-2 backdrop-blur-sm border border-gray-700/50 text-white text-sm font-semibold rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors pointer-events-auto flex items-center gap-2 ${
                        isEditing ? 'bg-cyan-600 hover:bg-cyan-700' : 'bg-gray-800/80 hover:bg-gray-700'
                    }`}
                    aria-label={isEditing ? "Exit Edit Mode" : "Enter Edit Mode"}
                 >
                    {isEditing ? <CloseIcon className="h-4 w-4" /> : <PencilIcon className="h-4 w-4" />}
                    {isEditing ? 'Cancel Drawing' : 'Annotate'}
                 </button>
            </div>
        </>
      )}

      {/* Insight Selection Modal */}
      {showInsightModal && (
          <div className="absolute inset-0 bg-gray-900/90 flex items-center justify-center z-50 p-4">
              <div className="bg-gray-800 rounded-lg border border-gray-700 shadow-xl w-full max-w-md flex flex-col max-h-[80vh]">
                  <div className="p-4 border-b border-gray-700 flex justify-between items-center">
                      <h3 className="text-lg font-semibold text-white">Link to Insight</h3>
                      <button onClick={() => { setShowInsightModal(false); setTempAnnotation(null); }} className="text-gray-400 hover:text-white">
                          <CloseIcon className="h-5 w-5" />
                      </button>
                  </div>
                  <div className="p-4 overflow-y-auto flex-1 space-y-2">
                      <p className="text-sm text-gray-400 mb-4">Select an insight to attach this annotation to:</p>
                      {insights.length > 0 ? insights.map(insight => (
                          <button
                            key={insight.id}
                            onClick={() => handleInsightSelect(insight.id)}
                            className="w-full text-left p-3 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors border border-transparent hover:border-cyan-500"
                          >
                              <div className="text-sm font-medium text-white">{insight.title}</div>
                              <div className="text-xs text-gray-400 truncate">{insight.summary}</div>
                          </button>
                      )) : (
                          <div className="text-center text-gray-500 py-4">No insights available.</div>
                      )}
                  </div>
              </div>
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