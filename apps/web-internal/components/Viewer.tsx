import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CubeIcon, PencilIcon, CloseIcon, TrashIcon } from './Icons';
import { ThreeDAnnotation, ThreeDPoint, Insight } from '../types';

interface ViewerProps {
  modelUrl?: string;
  onModelUpload?: (url: string) => void;
  annotations?: ThreeDAnnotation[];
  onAnnotationAdd?: (annotation: ThreeDAnnotation) => void;
  insights?: Insight[];
  onAnnotationSelect?: (annotationId: string | null) => void;
  onAnnotationDelete?: (annotationId: string) => void;
}

const Viewer: React.FC<ViewerProps> = ({ 
    modelUrl, 
    onModelUpload, 
    annotations = [], 
    onAnnotationAdd, 
    insights = [],
    onAnnotationSelect,
    onAnnotationDelete
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(!!modelUrl);
  const [error, setError] = useState<string | null>(null);
  
  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [showInsightModal, setShowInsightModal] = useState(false);
  const [tempAnnotation, setTempAnnotation] = useState<Partial<ThreeDAnnotation> | null>(null);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [annotationsToDelete, setAnnotationsToDelete] = useState<string[]>([]);

  const loaderRef = useRef<((url: string) => void) | null>(null);
  const modelRemoverRef = useRef<(() => void) | null>(null);
  
  // Three.js refs
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const annotationsGroupRef = useRef<THREE.Group | null>(null);
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
        } else if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
        }
    }

    // Add annotations
    annotations.forEach(ann => {
        const isSelected = ann.id === selectedAnnotationId;
        const isMarkedForDeletion = annotationsToDelete.includes(ann.id);
        const color = isMarkedForDeletion ? '#ef4444' : (isSelected ? '#ffff00' : ann.color); // Red if deleting, Yellow if selected

        // Check if it's a point annotation (start === end)
        const isPointAnnotation = ann.start.x === ann.end.x && ann.start.y === ann.end.y && ann.start.z === ann.end.z;

        if (isPointAnnotation) {
            // Render single larger marker for point annotation
            const markerGeo = new THREE.SphereGeometry(0.05, 32, 32); // Larger, smoother sphere
            const markerMat = new THREE.MeshBasicMaterial({ color: color });
            
            const marker = new THREE.Mesh(markerGeo, markerMat);
            marker.position.set(ann.start.x, ann.start.y, ann.start.z);
            marker.userData = { id: ann.id, type: 'annotation' };
            
            annotationsGroupRef.current?.add(marker);
        } else {
            // Render line annotation with line and two markers (legacy support)
            const line = createLine(ann.start, ann.end, color);
            line.userData = { id: ann.id, type: 'annotation' };
            annotationsGroupRef.current?.add(line);
            
            // Add markers at ends
            const markerGeo = new THREE.SphereGeometry(0.025, 16, 16);
            const markerMat = new THREE.MeshBasicMaterial({ color: color });
            
            const startMarker = new THREE.Mesh(markerGeo, markerMat);
            startMarker.position.set(ann.start.x, ann.start.y, ann.start.z);
            startMarker.userData = { id: ann.id, type: 'annotation' };
            
            const endMarker = new THREE.Mesh(markerGeo, markerMat);
            endMarker.position.set(ann.end.x, ann.end.y, ann.end.z);
            endMarker.userData = { id: ann.id, type: 'annotation' };

            annotationsGroupRef.current?.add(startMarker);
            annotationsGroupRef.current?.add(endMarker);
        }
    });
  }, [annotations, modelLoaded, selectedAnnotationId, annotationsToDelete]);

  // Preview line logic removed - no longer needed for single-point annotations

  // Handle click on canvas
  const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!modelRef.current || !cameraRef.current || !sceneRef.current || !annotationsGroupRef.current) return;
    
    // Raycasting setup
    const rect = mountRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    mouseRef.current.set(x, y);
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    
    // 1. Check for annotation clicks first
    const annotationIntersects = raycasterRef.current.intersectObject(annotationsGroupRef.current, true);
    if (annotationIntersects.length > 0) {
        // Find the first object with userData.type === 'annotation'
        const hit = annotationIntersects.find(i => i.object.userData?.type === 'annotation');
        if (hit) {
            const annId = hit.object.userData.id;
            
            if (isDeleteMode) {
                setAnnotationsToDelete(prev => {
                    if (prev.includes(annId)) {
                        return prev.filter(id => id !== annId);
                    } else {
                        return [...prev, annId];
                    }
                });
                return;
            }

            setSelectedAnnotationId(annId);
            onAnnotationSelect?.(annId);
            return; // Stop processing to avoid creating new points under existing ones
        }
    }

    // If we didn't hit an annotation, and we are NOT editing, deselect
    if (!isEditing && !isDeleteMode) {
        if (selectedAnnotationId) {
            setSelectedAnnotationId(null);
            onAnnotationSelect?.(null);
        }
        return;
    }

    // 2. If editing, check for model clicks
    const intersects = raycasterRef.current.intersectObject(modelRef.current, true);

    if (intersects.length > 0 && !isDeleteMode && isEditing) {
        const point = intersects[0].point;
        const clickedPoint: ThreeDPoint = { x: point.x, y: point.y, z: point.z };

        // Create point annotation immediately (start === end)
        const newAnnotation: Partial<ThreeDAnnotation> = {
            id: Math.random().toString(36).substring(2, 10),
            start: clickedPoint,
            end: clickedPoint, // Same point for point annotation
            color: '#ff0000' // Default color
        };
        setTempAnnotation(newAnnotation);
        setShowInsightModal(true);
        
        // Deselect any annotation when creating new one
        setSelectedAnnotationId(null);
        onAnnotationSelect?.(null);
    }
  };

  // Mouse move handler removed - no longer needed for single-point annotations

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

  const handleDeleteSelected = () => {
      if (selectedAnnotationId && onAnnotationDelete) {
          onAnnotationDelete(selectedAnnotationId);
          setSelectedAnnotationId(null);
          onAnnotationSelect?.(null);
      }
  };

  const handleToggleDeleteMode = () => {
      if (isDeleteMode) {
          // Confirm deletion if items are selected
          if (annotationsToDelete.length > 0 && onAnnotationDelete) {
              annotationsToDelete.forEach(id => onAnnotationDelete(id));
          }
          // Exit mode
          setIsDeleteMode(false);
          setAnnotationsToDelete([]);
      } else {
          // Enter mode
          setIsDeleteMode(true);
          setIsEditing(false); // Ensure not editing
          setSelectedAnnotationId(null); // Clear single selection
          onAnnotationSelect?.(null);
      }
  };

  // Handle Delete/Backspace key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if ((e.key === 'Delete' || e.key === 'Backspace')) {
            if (isDeleteMode && annotationsToDelete.length > 0) {
                 annotationsToDelete.forEach(id => onAnnotationDelete?.(id));
                 setAnnotationsToDelete([]);
            } else if (selectedAnnotationId) {
                handleDeleteSelected();
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAnnotationId, onAnnotationDelete, isDeleteMode, annotationsToDelete]);


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
            
             {/* Edit Mode Toggle & Delete Button */}
            <div className="absolute top-4 right-4 flex gap-2">
                 <button
                     onClick={handleToggleDeleteMode}
                     className={`px-4 py-2 backdrop-blur-sm border text-white text-sm font-semibold rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 transition-colors pointer-events-auto flex items-center gap-2 ${
                         isDeleteMode 
                             ? 'bg-red-900/60 border-red-700/50 hover:bg-red-800 focus:ring-red-500 ring-2 ring-red-500' 
                             : 'bg-gray-800/80 border-gray-700/50 hover:bg-gray-700 focus:ring-cyan-500'
                     }`}
                     aria-label={isDeleteMode ? "Confirm Deletion" : "Enter Delete Mode"}
                 >
                     <TrashIcon className="h-4 w-4" />
                     {isDeleteMode ? (annotationsToDelete.length > 0 ? `Delete (${annotationsToDelete.length})` : 'Done') : 'Delete'}
                 </button>

                 <button
                   onClick={() => {
                       if (isDeleteMode) {
                           setIsDeleteMode(false);
                           setAnnotationsToDelete([]);
                       }
                       setIsEditing(!isEditing);
                       // Deselect when toggling edit mode
                       setSelectedAnnotationId(null);
                       onAnnotationSelect?.(null);
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