import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CubeIcon, PencilIcon, CloseIcon, TrashIcon, PointCloudIcon, SettingsIcon } from './Icons';
import { ThreeDAnnotation, ThreeDPoint, SliceBoxConfig, FloorPlanLine, FloorPlanTextLabel } from '../types';
import PointCloudSettingsPanel from './PointCloudSettingsPanel';
import AnalysisToolsPanel from './AnalysisToolsPanel';
import FloorPlanResultsPanel from './FloorPlanResultsPanel';
import { generateFloorPlan, FloorPlanData, extractPointsFromGLB, sliceAndProject, Point2D, SliceMode } from '../lib/floorPlanGenerator';
import { generateFloorPlanSVG, downloadSvg } from '../lib/floorPlanSvg';
import { exportToJSON, exportToDXF, exportToPDF, exportFloorPlanToPDF, calculateFloorPlanStats } from '../lib/floorPlanExport';
import { Rnd } from 'react-rnd';

const EMPTY_ARRAY: string[] = [];

interface ViewerProps {
  modelUrl?: string;
  onModelUpload?: (url: string) => void;
  annotations?: ThreeDAnnotation[];
  onAnnotationAdd?: (annotation: ThreeDAnnotation) => void;
  onAnnotationUpdate?: (annotation: ThreeDAnnotation) => void;
  onPointCreated?: (pointId: string) => void;
  highlightedPointIds?: string[];
  onAnnotationSelect?: (annotationId: string | null) => void;
  onAnnotationDelete?: (annotationId: string) => void;
}

// Type for tracking which measurement point is being edited
interface EditingPointState {
  annotationId: string;
  isStart: boolean; // true = start point, false = end point
}

const Viewer: React.FC<ViewerProps> = ({ 
    modelUrl, 
    onModelUpload, 
    annotations = [], 
    onAnnotationAdd, 
    onAnnotationUpdate,
    onPointCreated,
    highlightedPointIds = EMPTY_ARRAY,
    onAnnotationSelect,
    onAnnotationDelete
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [modelLoaded, setModelLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(!!modelUrl);
  const [error, setError] = useState<string | null>(null);
  const [contentType, setContentType] = useState<'glb' | 'pointcloud' | 'none'>('none');
  
  // Point cloud and analysis panels state
  const [showPointCloudSettings, setShowPointCloudSettings] = useState(false);
  const [showAnalysisTools, setShowAnalysisTools] = useState(false);
  const [showFloorPlanResults, setShowFloorPlanResults] = useState(false);
  
  // 3D model visibility state (for performance when working in Top-Down Preview)
  const [is3DVisible, setIs3DVisible] = useState(true);
  const is3DVisibleRef = useRef(true); // Ref for animation loop access
  
  // Point cloud settings state (placeholder values)
  const [pointSize, setPointSize] = useState(1.0);
  const [pointBudget, setPointBudget] = useState(2000000);
  const [colorMode, setColorMode] = useState<'rgb' | 'elevation' | 'intensity' | 'classification'>('rgb');
  const [visiblePointCount] = useState(1850000);
  
  
  // Floor plan results state (placeholder values)
  const [floorPlanLayers, setFloorPlanLayers] = useState({
    dimensions: true,
    roomLabels: true,
    openings: true,
    wallThickness: false,
  });
  
  // Floor plan generation results
  const [floorPlanData, setFloorPlanData] = useState<FloorPlanData | null>(null);
  const [floorPlanSVG, setFloorPlanSVG] = useState<string>('');
  
  // Analysis state
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeFeature, setActiveFeature] = useState<string | null>(null);
  
  // Slice box state for floor plan generation
  const [isSliceBoxActive, setIsSliceBoxActive] = useState(false);
  const [isSliceBoxHidden, setIsSliceBoxHidden] = useState(false);
  const [sliceBoxConfig, setSliceBoxConfig] = useState<SliceBoxConfig | null>(null);
  const sliceBoxGroupRef = useRef<THREE.Group | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<{ type: 'corner' | 'edge'; index: number } | null>(null);
  const sliceDragPlaneRef = useRef<THREE.Plane | null>(null);
  const isSliceBoxEditingRef = useRef(false);
  
  // Slice box XZ movement state (WASD keys when selected)
  const [isSliceSelectedForMove, setIsSliceSelectedForMove] = useState(false);
  
  // Slice mode: horizontal (floor plan) or vertical (elevation)
  const [sliceMode, setSliceMode] = useState<'horizontal' | 'vertical'>('horizontal');
  
  // Editing state
  const [isEditing, setIsEditing] = useState(false);
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
  
  // Measurement refs and state
  const originalScaleFactorRef = useRef<number>(1);
  const tempMarkerRef = useRef<THREE.Mesh | null>(null);
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measureStartPoint, setMeasureStartPoint] = useState<ThreeDPoint | null>(null);

  // Measurement point editing state
  const [editingPoint, setEditingPoint] = useState<EditingPointState | null>(null);
  const [isDraggingPoint, setIsDraggingPoint] = useState(false);
  const isDraggingRef = useRef(false); // Ref mirror for use in animation loop
  const dragStartRef = useRef<{ mousePos: THREE.Vector2; pointPos: THREE.Vector3 } | null>(null);

  // Slice preview state
  const [previewPoints, setPreviewPoints] = useState<Point2D[]>([]);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
  const [previewPanelPos, setPreviewPanelPos] = useState({ x: 0, y: 0 });
  const [previewPanelSize, setPreviewPanelSize] = useState({ width: 192, height: 192 });
  const [previewPanelInitialized, setPreviewPanelInitialized] = useState(false);
  const [previewPointSize, setPreviewPointSize] = useState(2);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const previewDragRef = useRef<{ isDragging: boolean; lastPos: { x: number; y: number } }>({ isDragging: false, lastPos: { x: 0, y: 0 } });

  // Floor plan line drawing state
  const [floorPlanLines, setFloorPlanLines] = useState<FloorPlanLine[]>([]);
  const [isDrawingLines, setIsDrawingLines] = useState(false);
  const [lineStartPoint, setLineStartPoint] = useState<Point2D | null>(null);
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [hoveredSnapPoint, setHoveredSnapPoint] = useState<Point2D | null>(null);
  const [currentMousePos, setCurrentMousePos] = useState<{ x: number; y: number } | null>(null);

  // Floor plan text label state
  const [floorPlanTextLabels, setFloorPlanTextLabels] = useState<FloorPlanTextLabel[]>([]);
  const [isAddingText, setIsAddingText] = useState(false);
  const [selectedTextLabelId, setSelectedTextLabelId] = useState<string | null>(null);
  const [editingTextLabelId, setEditingTextLabelId] = useState<string | null>(null);

  // Delete mode state for batch deletion
  const [isFloorPlanDeleteMode, setIsFloorPlanDeleteMode] = useState(false);
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const [selectedTextLabelIds, setSelectedTextLabelIds] = useState<string[]>([]);

  // Drawing rotation state (degrees, 0-360)
  const [drawingRotation, setDrawingRotation] = useState(0);

  // Measurement text size for PDF export (pixels)
  const [measurementTextSize, setMeasurementTextSize] = useState(10);

  // Line thickness for PDF export (pixels, min 1)
  const [lineThickness, setLineThickness] = useState(2);

  // Dimension line scale for PDF export (multiplier)
  const [dimensionLineScale, setDimensionLineScale] = useState(1);

  // Sheet title for PDF export
  const [sheetTitle, setSheetTitle] = useState('');

  // Sync 3D visibility state to ref for animation loop access
  useEffect(() => {
    is3DVisibleRef.current = is3DVisible;
  }, [is3DVisible]);

  // Helper to calculate distance between two 3D points
  const calculateDistance = (start: ThreeDPoint, end: ThreeDPoint): number => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  };

  // Helper to format distance as feet and inches (e.g., "10' 6\"")
  const formatFeetInches = (feet: number): string => {
    const isNegative = feet < 0;
    const absFeet = Math.abs(feet);
    const wholeFeet = Math.floor(absFeet);
    const inches = Math.round((absFeet - wholeFeet) * 12);
    // Handle edge case where rounding gives 12 inches
    if (inches === 12) {
      return `${isNegative ? '-' : ''}${wholeFeet + 1}' 0"`;
    }
    return `${isNegative ? '-' : ''}${wholeFeet}' ${inches}"`;
  };

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
    
    // Clear existing annotations (except temp marker)
    const childrenToRemove = annotationsGroupRef.current.children.filter(
        child => child.userData?.type !== 'temp-marker'
    );
    childrenToRemove.forEach(child => {
        annotationsGroupRef.current?.remove(child);
        if (child instanceof THREE.Line) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
        } else if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            (child.material as THREE.Material).dispose();
        } else if (child instanceof THREE.Sprite) {
            (child.material as THREE.SpriteMaterial).map?.dispose();
            (child.material as THREE.Material).dispose();
        }
    });

    // Add annotations
    annotations.forEach(ann => {
        const isSelected = ann.id === selectedAnnotationId;
        const isHighlighted = highlightedPointIds.includes(ann.id);
        const isMarkedForDeletion = annotationsToDelete.includes(ann.id);
        const baseColor = ann.isMeasurement ? '#00ff00' : ann.color; // Green for measurements
        const color = isMarkedForDeletion ? '#ef4444' : ((isSelected || isHighlighted) ? '#ffff00' : baseColor);

        // Check if it's a point annotation (start === end)
        const isPointAnnotation = ann.start.x === ann.end.x && ann.start.y === ann.end.y && ann.start.z === ann.end.z;

        if (isPointAnnotation && !ann.isMeasurement) {
            // Render single larger marker for point annotation
            const markerGeo = new THREE.SphereGeometry(0.0033, 32, 32);
            const markerMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.6 });
            
            const marker = new THREE.Mesh(markerGeo, markerMat);
            marker.position.set(ann.start.x, ann.start.y, ann.start.z);
            marker.userData = { id: ann.id, type: 'annotation' };
            
            annotationsGroupRef.current?.add(marker);
        } else {
            // Render line annotation with line and two markers
            const line = createLine(ann.start, ann.end, color);
            line.userData = { id: ann.id, type: 'annotation' };
            annotationsGroupRef.current?.add(line);
            
            // Check if this annotation has an editing point
            const isEditingStart = editingPoint?.annotationId === ann.id && editingPoint.isStart;
            const isEditingEnd = editingPoint?.annotationId === ann.id && !editingPoint.isStart;
            
            // Add markers at ends - larger and orange for editing point
            const normalMarkerGeo = new THREE.SphereGeometry(0.0003, 16, 16);
            const editingMarkerGeo = new THREE.SphereGeometry(0.0005, 16, 16); // 1.5x larger
            
            const startMarkerGeo = isEditingStart ? editingMarkerGeo : normalMarkerGeo;
            const startMarkerColor = isEditingStart ? '#ff9800' : color; // Orange for editing
            const startMarkerMat = new THREE.MeshBasicMaterial({ 
                color: startMarkerColor, 
                transparent: isEditingStart, 
                opacity: isEditingStart ? 0.9 : 1.0 
            });
            
            const startMarker = new THREE.Mesh(startMarkerGeo, startMarkerMat);
            startMarker.position.set(ann.start.x, ann.start.y, ann.start.z);
            startMarker.userData = { id: ann.id, type: 'annotation', isStartMarker: true, isMeasurement: ann.isMeasurement };
            
            const endMarkerGeo = isEditingEnd ? editingMarkerGeo : normalMarkerGeo;
            const endMarkerColor = isEditingEnd ? '#ff9800' : color; // Orange for editing
            const endMarkerMat = new THREE.MeshBasicMaterial({ 
                color: endMarkerColor, 
                transparent: isEditingEnd, 
                opacity: isEditingEnd ? 0.9 : 1.0 
            });
            
            const endMarker = new THREE.Mesh(endMarkerGeo, endMarkerMat);
            endMarker.position.set(ann.end.x, ann.end.y, ann.end.z);
            endMarker.userData = { id: ann.id, type: 'annotation', isStartMarker: false, isMeasurement: ann.isMeasurement };

            annotationsGroupRef.current?.add(startMarker);
            annotationsGroupRef.current?.add(endMarker);
            
            // Add distance label for measurements
            if (ann.isMeasurement && ann.distanceFeet !== undefined) {
                const midpoint = new THREE.Vector3(
                    (ann.start.x + ann.end.x) / 2,
                    (ann.start.y + ann.end.y) / 2,
                    (ann.start.z + ann.end.z) / 2
                );
                
                // Create text sprite for the distance label
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                if (context) {
                    canvas.width = 256;
                    canvas.height = 64;
                    
                    // Background
                    context.fillStyle = 'rgba(0, 0, 0, 0.85)';
                    context.roundRect(0, 0, canvas.width, canvas.height, 8);
                    context.fill();
                    
                    // Border
                    context.strokeStyle = color;
                    context.lineWidth = 3;
                    context.roundRect(2, 2, canvas.width - 4, canvas.height - 4, 6);
                    context.stroke();
                    
                    // Text
                    context.font = 'bold 28px Arial';
                    context.fillStyle = color;
                    context.textAlign = 'center';
                    context.textBaseline = 'middle';
                    context.fillText(formatFeetInches(ann.distanceFeet), canvas.width / 2, canvas.height / 2);
                    
                    const texture = new THREE.CanvasTexture(canvas);
                    const spriteMat = new THREE.SpriteMaterial({ 
                        map: texture, 
                        transparent: true,
                        depthTest: false,
                        depthWrite: false
                    });
                    const sprite = new THREE.Sprite(spriteMat);
                    sprite.position.copy(midpoint);
                    sprite.scale.set(0.0375, 0.009375, 1); // Adjust size as needed
                    sprite.userData = { id: ann.id, type: 'annotation' };
                    
                    annotationsGroupRef.current?.add(sprite);
                }
            }
        }
    });
  }, [annotations, modelLoaded, selectedAnnotationId, highlightedPointIds, annotationsToDelete, editingPoint]);

  // Preview line logic removed - no longer needed for single-point annotations

  // Helper to create slice box with handles
  const createSliceBox = useCallback((config: SliceBoxConfig, isSelectedForMove: boolean = false): THREE.Group => {
    const group = new THREE.Group();
    group.userData = { type: 'slice-box' };
    
    // Scale thickness from inches to model units (assuming model is in feet, 6 inches = 0.5 feet)
    const thicknessFeet = config.thicknessInches / 12;
    const scaledThickness = thicknessFeet * originalScaleFactorRef.current;
    
    // Use different colors/opacity when selected for XZ movement
    const boxColor = isSelectedForMove ? 0xff9800 : 0x00bcd4; // Orange when selected, cyan otherwise
    const boxOpacity = isSelectedForMove ? 0.4 : 0.25;
    const wireframeColor = isSelectedForMove ? 0xffb74d : 0x00bcd4;
    
    // Create semi-transparent box mesh
    const boxGeometry = new THREE.BoxGeometry(
      config.halfExtents.x * 2,
      scaledThickness,
      config.halfExtents.z * 2
    );
    const boxMaterial = new THREE.MeshBasicMaterial({
      color: boxColor,
      transparent: true,
      opacity: boxOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
    boxMesh.userData = { type: 'slice-box-mesh' };
    group.add(boxMesh);
    
    // Create wireframe outline
    const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
    const edgesMaterial = new THREE.LineBasicMaterial({ color: wireframeColor, linewidth: 2 });
    const wireframe = new THREE.LineSegments(edgesGeometry, edgesMaterial);
    wireframe.userData = { type: 'slice-box-wireframe' };
    group.add(wireframe);
    
    // Create corner handles (8 corners of the box)
    const cornerPositions = [
      [-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1],  // Bottom corners
      [-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1],      // Top corners
    ];
    
    const handleGeometry = new THREE.SphereGeometry(0.015, 16, 16);
    const handleMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const hoverMaterial = new THREE.MeshBasicMaterial({ color: 0xff9800 });
    
    cornerPositions.forEach((pos, index) => {
      const handle = new THREE.Mesh(handleGeometry, handleMaterial.clone());
      handle.position.set(
        pos[0] * config.halfExtents.x,
        pos[1] * scaledThickness / 2,
        pos[2] * config.halfExtents.z
      );
      handle.userData = { type: 'slice-handle', handleType: 'corner', handleIndex: index };
      group.add(handle);
    });
    
    // Create edge handles (4 edges on the horizontal plane - for adjusting width/depth)
    const edgePositions = [
      [0, 0, -1],  // Front edge center
      [1, 0, 0],   // Right edge center
      [0, 0, 1],   // Back edge center
      [-1, 0, 0],  // Left edge center
    ];
    
    const edgeHandleGeometry = new THREE.SphereGeometry(0.012, 16, 16);
    const edgeHandleMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
    
    edgePositions.forEach((pos, index) => {
      const handle = new THREE.Mesh(edgeHandleGeometry, edgeHandleMaterial.clone());
      handle.position.set(
        pos[0] * config.halfExtents.x,
        0,
        pos[2] * config.halfExtents.z
      );
      handle.userData = { type: 'slice-handle', handleType: 'edge', handleIndex: index };
      group.add(handle);
    });
    
    // Apply rotation and position
    group.rotation.set(config.rotation.x, config.rotation.y, config.rotation.z);
    group.position.set(config.center.x, config.center.y, config.center.z);
    
    return group;
  }, []);

  // Update slice box when config changes or selection state changes
  useEffect(() => {
    if (!sceneRef.current) return;
    
    // Remove existing slice box
    if (sliceBoxGroupRef.current) {
      sceneRef.current.remove(sliceBoxGroupRef.current);
      sliceBoxGroupRef.current.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m) => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      sliceBoxGroupRef.current = null;
    }
    
    // Create new slice box if active and not hidden
    if (isSliceBoxActive && sliceBoxConfig && !isSliceBoxHidden) {
      const sliceBoxGroup = createSliceBox(sliceBoxConfig, isSliceSelectedForMove);
      sceneRef.current.add(sliceBoxGroup);
      sliceBoxGroupRef.current = sliceBoxGroup;
    }
  }, [isSliceBoxActive, isSliceBoxHidden, sliceBoxConfig, createSliceBox, isSliceSelectedForMove]);

  // Update slice preview when slice config or mode changes
  useEffect(() => {
    if (!isSliceBoxActive || !sliceBoxConfig || !sceneRef.current) {
      setPreviewPoints([]);
      return;
    }
    
    // Debounce for performance
    const timeoutId = setTimeout(() => {
      if (!sceneRef.current) return;
      
      const points3D = extractPointsFromGLB(sceneRef.current);
      const points2D = sliceAndProject(points3D, sliceBoxConfig, originalScaleFactorRef.current, sliceMode);
      
      // Sample if too many points (for performance)
      const maxPoints = 10000;
      if (points2D.length > maxPoints) {
        const step = Math.ceil(points2D.length / maxPoints);
        setPreviewPoints(points2D.filter((_, i) => i % step === 0));
      } else {
        setPreviewPoints(points2D);
      }
    }, 50); // 50ms debounce
    
    return () => clearTimeout(timeoutId);
  }, [isSliceBoxActive, sliceBoxConfig, sliceMode]);

  // Render slice preview canvas with points
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (previewPoints.length === 0) return;
    
    // Calculate bounds from points
    const bounds = previewPoints.reduce((acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      maxX: Math.max(acc.maxX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxY: Math.max(acc.maxY, p.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    
    const padding = 20;
    const scaleX = (canvas.width - padding * 2) / (bounds.maxX - bounds.minX || 1);
    const scaleY = (canvas.height - padding * 2) / (bounds.maxY - bounds.minY || 1);
    const baseScale = Math.min(scaleX, scaleY);
    
    // Apply zoom to the scale
    const scale = baseScale * previewZoom;
    
    // Center the drawing (at zoom=1, pan=0)
    const contentWidth = (bounds.maxX - bounds.minX) * baseScale;
    const contentHeight = (bounds.maxY - bounds.minY) * baseScale;
    const baseOffsetX = (canvas.width - contentWidth) / 2;
    const baseOffsetY = (canvas.height - contentHeight) / 2;
    
    // Apply pan offset
    const offsetX = baseOffsetX + previewPan.x;
    const offsetY = baseOffsetY + previewPan.y;
    
    // Rotation angle in radians
    const rotationRad = (drawingRotation * Math.PI) / 180;
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;
    
    // Transform function for coordinates with zoom, pan, and rotation
    const transform = (p: Point2D) => {
      // First apply scale and offset
      let x = offsetX + (p.x - bounds.minX) * scale;
      // For vertical mode, invert Y so higher elevations appear at top of canvas
      let y = sliceMode === 'vertical'
        ? offsetY + (bounds.maxY - p.y) * scale  // Inverted: high elevation at top
        : offsetY + (p.y - bounds.minY) * scale; // Normal: floor plan view
      
      // Then apply rotation around canvas center
      if (drawingRotation !== 0) {
        const dx = x - canvasCenterX;
        const dy = y - canvasCenterY;
        x = canvasCenterX + dx * Math.cos(rotationRad) - dy * Math.sin(rotationRad);
        y = canvasCenterY + dx * Math.sin(rotationRad) + dy * Math.cos(rotationRad);
      }
      
      return { x, y };
    };
    
    // Draw points with adjustable size and uniform high-contrast color
    ctx.fillStyle = '#00bcd4';
    for (const p of previewPoints) {
      const { x, y } = transform(p);
      // Only draw points that are within the visible canvas area (with some margin)
      if (x >= -10 && x <= canvas.width + 10 && y >= -10 && y <= canvas.height + 10) {
        ctx.beginPath();
        ctx.arc(x, y, previewPointSize, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw existing floor plan lines
    for (const line of floorPlanLines) {
      const startScreen = transform(line.start);
      const endScreen = transform(line.end);
      
      // Line stroke - check for delete mode selection
      const isSelected = line.id === selectedLineId;
      const isMarkedForDeletion = selectedLineIds.includes(line.id);
      const lineColor = isMarkedForDeletion ? '#ef4444' : (isSelected ? '#fbbf24' : '#00ff88');  // Red for deletion, yellow if selected, green otherwise
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = (isSelected || isMarkedForDeletion) ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(startScreen.x, startScreen.y);
      ctx.lineTo(endScreen.x, endScreen.y);
      ctx.stroke();
      
      // Endpoint circles
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.arc(startScreen.x, startScreen.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(endScreen.x, endScreen.y, 4, 0, Math.PI * 2);
      ctx.fill();
      
      // Distance label at midpoint
      const midX = (startScreen.x + endScreen.x) / 2;
      const midY = (startScreen.y + endScreen.y) / 2;
      
      // Format distance as feet and inches
      const absFeet = Math.abs(line.distanceFeet);
      const wholeFeet = Math.floor(absFeet);
      const inches = Math.round((absFeet - wholeFeet) * 12);
      const distLabel = inches === 12 
        ? `${wholeFeet + 1}' 0"` 
        : `${wholeFeet}' ${inches}"`;
      
      // Background for label
      ctx.font = 'bold 11px Arial';
      const textMetrics = ctx.measureText(distLabel);
      const labelPadding = 4;
      const labelWidth = textMetrics.width + labelPadding * 2;
      const labelHeight = 16;
      
      ctx.fillStyle = isMarkedForDeletion ? 'rgba(127, 29, 29, 0.9)' : 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(
        midX - labelWidth / 2, 
        midY - labelHeight / 2, 
        labelWidth, 
        labelHeight
      );
      
      // Label text
      ctx.fillStyle = lineColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(distLabel, midX, midY);
    }

    // Draw in-progress line (from start point to mouse position)
    if (lineStartPoint && currentMousePos) {
      const startScreen = transform(lineStartPoint);
      
      // Use snap point if available, otherwise use mouse position
      let endScreen: { x: number; y: number };
      if (hoveredSnapPoint) {
        endScreen = transform(hoveredSnapPoint);
      } else {
        endScreen = { x: currentMousePos.x, y: currentMousePos.y };
      }
      
      // Dashed line for in-progress
      ctx.strokeStyle = '#ff9800';  // Orange for in-progress
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(startScreen.x, startScreen.y);
      ctx.lineTo(endScreen.x, endScreen.y);
      ctx.stroke();
      ctx.setLineDash([]);  // Reset dash
      
      // Start point marker
      ctx.fillStyle = '#ff9800';
      ctx.beginPath();
      ctx.arc(startScreen.x, startScreen.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw snap point indicator
    if (hoveredSnapPoint && isDrawingLines) {
      const snapScreen = transform(hoveredSnapPoint);
      
      // Outer ring
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(snapScreen.x, snapScreen.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      
      // Inner filled circle
      ctx.fillStyle = 'rgba(255, 152, 0, 0.5)';
      ctx.beginPath();
      ctx.arc(snapScreen.x, snapScreen.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Draw text labels
    for (const label of floorPlanTextLabels) {
      // Skip rendering if this label is being edited (we show HTML input instead)
      if (label.id === editingTextLabelId) continue;
      
      const labelScreen = transform(label.position);
      const isSelected = label.id === selectedTextLabelId;
      const isMarkedForDeletion = selectedTextLabelIds.includes(label.id);
      
      // Set font
      ctx.font = 'bold 12px Arial';
      const textMetrics = ctx.measureText(label.text);
      const labelPadding = 4;
      const labelWidth = textMetrics.width + labelPadding * 2;
      const labelHeight = 16;
      
      // Background for label - red for deletion, yellow for selected, amber otherwise
      ctx.fillStyle = isMarkedForDeletion 
        ? 'rgba(239, 68, 68, 0.9)' 
        : (isSelected ? 'rgba(251, 191, 36, 0.9)' : 'rgba(245, 158, 11, 0.85)');
      ctx.fillRect(
        labelScreen.x - labelWidth / 2, 
        labelScreen.y - labelHeight / 2, 
        labelWidth, 
        labelHeight
      );
      
      // Border for selected or marked for deletion
      if (isSelected || isMarkedForDeletion) {
        ctx.strokeStyle = isMarkedForDeletion ? '#ef4444' : '#fbbf24';
        ctx.lineWidth = 2;
        ctx.strokeRect(
          labelScreen.x - labelWidth / 2, 
          labelScreen.y - labelHeight / 2, 
          labelWidth, 
          labelHeight
        );
      }
      
      // Label text
      ctx.fillStyle = isMarkedForDeletion ? '#ffffff' : '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label.text, labelScreen.x, labelScreen.y);
    }
  }, [previewPoints, previewPointSize, previewPanelSize, previewZoom, previewPan, floorPlanLines, selectedLineId, selectedLineIds, lineStartPoint, currentMousePos, hoveredSnapPoint, isDrawingLines, drawingRotation, sliceMode, floorPlanTextLabels, selectedTextLabelId, selectedTextLabelIds, editingTextLabelId]);

  // Initialize preview panel position when it first becomes visible
  useEffect(() => {
    if (isSliceBoxActive && sliceBoxConfig && !previewPanelInitialized && mountRef.current) {
      const rect = mountRef.current.getBoundingClientRect();
      // Position at bottom-right with some padding
      setPreviewPanelPos({
        x: rect.width - 192 - 16,
        y: rect.height - 192 - 96
      });
      setPreviewPanelInitialized(true);
    }
    // Reset when slice box is deactivated
    if (!isSliceBoxActive) {
      setPreviewPanelInitialized(false);
      setPreviewPanelSize({ width: 192, height: 192 });
      setIsPreviewExpanded(false);
      // Reset zoom and pan when slice box is deactivated
      setPreviewZoom(1);
      setPreviewPan({ x: 0, y: 0 });
      // Reset hidden state when fully deactivated
      setIsSliceBoxHidden(false);
    }
  }, [isSliceBoxActive, sliceBoxConfig, previewPanelInitialized]);

  // Helper to create/update temporary start marker for measurements
  const updateTempMarker = (point: ThreeDPoint | null) => {
    // Remove existing temp marker
    if (tempMarkerRef.current && annotationsGroupRef.current) {
      annotationsGroupRef.current.remove(tempMarkerRef.current);
      tempMarkerRef.current.geometry.dispose();
      (tempMarkerRef.current.material as THREE.Material).dispose();
      tempMarkerRef.current = null;
    }
    
    // Create new temp marker if point provided
    if (point && annotationsGroupRef.current) {
      const markerGeo = new THREE.SphereGeometry(0.0015, 16, 16);
      const markerMat = new THREE.MeshBasicMaterial({ color: '#00ff00', transparent: true, opacity: 0.8 });
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.position.set(point.x, point.y, point.z);
      marker.userData = { type: 'temp-marker' };
      annotationsGroupRef.current.add(marker);
      tempMarkerRef.current = marker;
    }
  };

  // Handle wheel zoom on preview canvas (cursor-centered)
  const handlePreviewWheel = useCallback((event: React.WheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.stopPropagation();
    
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    
    const rect = canvas.getBoundingClientRect();
    // Cursor position relative to canvas
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    
    // Zoom factor (scroll up = zoom in, scroll down = zoom out)
    const zoomFactor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
    const newZoom = Math.max(0.1, Math.min(50, previewZoom * zoomFactor));
    
    // Calculate the position under cursor in "data space" before zoom
    // Then adjust pan so that same data position stays under cursor after zoom
    const zoomRatio = newZoom / previewZoom;
    
    // New pan offset to keep cursor position fixed
    const newPanX = cursorX - (cursorX - previewPan.x) * zoomRatio;
    const newPanY = cursorY - (cursorY - previewPan.y) * zoomRatio;
    
    setPreviewZoom(newZoom);
    setPreviewPan({ x: newPanX, y: newPanY });
  }, [previewZoom, previewPan]);

  // Get all line endpoints for snap detection
  const getAllLineEndpoints = useCallback((): Point2D[] => {
    const endpoints: Point2D[] = [];
    for (const line of floorPlanLines) {
      endpoints.push(line.start);
      endpoints.push(line.end);
    }
    return endpoints;
  }, [floorPlanLines]);

  // Find nearest snap point within radius (in screen pixels)
  const findNearestSnapPoint = useCallback((
    canvasX: number, 
    canvasY: number, 
    snapRadius: number = 10
  ): Point2D | null => {
    const canvas = previewCanvasRef.current;
    if (!canvas || previewPoints.length === 0) return null;

    // Calculate bounds from points (same as in render effect)
    const bounds = previewPoints.reduce((acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      maxX: Math.max(acc.maxX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxY: Math.max(acc.maxY, p.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

    const padding = 20;
    const scaleX = (canvas.width - padding * 2) / (bounds.maxX - bounds.minX || 1);
    const scaleY = (canvas.height - padding * 2) / (bounds.maxY - bounds.minY || 1);
    const baseScale = Math.min(scaleX, scaleY);
    const scale = baseScale * previewZoom;

    const contentWidth = (bounds.maxX - bounds.minX) * baseScale;
    const contentHeight = (bounds.maxY - bounds.minY) * baseScale;
    const baseOffsetX = (canvas.width - contentWidth) / 2;
    const baseOffsetY = (canvas.height - contentHeight) / 2;
    const offsetX = baseOffsetX + previewPan.x;
    const offsetY = baseOffsetY + previewPan.y;

    // Rotation parameters
    const rotationRad = (drawingRotation * Math.PI) / 180;
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;

    // Transform function from data to screen coordinates (with rotation)
    // For vertical mode, Y is inverted (high elevation at top of canvas)
    const transform = (p: Point2D) => {
      let x = offsetX + (p.x - bounds.minX) * scale;
      let y = sliceMode === 'vertical'
        ? offsetY + (bounds.maxY - p.y) * scale  // Inverted for vertical mode
        : offsetY + (p.y - bounds.minY) * scale; // Normal for horizontal mode
      
      // Apply rotation around canvas center
      if (drawingRotation !== 0) {
        const dx = x - canvasCenterX;
        const dy = y - canvasCenterY;
        x = canvasCenterX + dx * Math.cos(rotationRad) - dy * Math.sin(rotationRad);
        y = canvasCenterY + dx * Math.sin(rotationRad) + dy * Math.cos(rotationRad);
      }
      
      return { x, y };
    };

    // Check all existing line endpoints
    const endpoints = getAllLineEndpoints();
    let nearest: Point2D | null = null;
    let nearestDist = snapRadius;

    for (const endpoint of endpoints) {
      const screenPos = transform(endpoint);
      const dist = Math.sqrt(
        (screenPos.x - canvasX) ** 2 + (screenPos.y - canvasY) ** 2
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = endpoint;
      }
    }

    return nearest;
  }, [previewPoints, previewZoom, previewPan, getAllLineEndpoints, sliceMode, drawingRotation]);

  // Convert screen coordinates to data coordinates
  const screenToData = useCallback((canvasX: number, canvasY: number): Point2D | null => {
    const canvas = previewCanvasRef.current;
    if (!canvas || previewPoints.length === 0) return null;

    // Calculate bounds from points (same as in render effect)
    const bounds = previewPoints.reduce((acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      maxX: Math.max(acc.maxX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxY: Math.max(acc.maxY, p.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

    const padding = 20;
    const scaleX = (canvas.width - padding * 2) / (bounds.maxX - bounds.minX || 1);
    const scaleY = (canvas.height - padding * 2) / (bounds.maxY - bounds.minY || 1);
    const baseScale = Math.min(scaleX, scaleY);
    const scale = baseScale * previewZoom;

    const contentWidth = (bounds.maxX - bounds.minX) * baseScale;
    const contentHeight = (bounds.maxY - bounds.minY) * baseScale;
    const baseOffsetX = (canvas.width - contentWidth) / 2;
    const baseOffsetY = (canvas.height - contentHeight) / 2;
    const offsetX = baseOffsetX + previewPan.x;
    const offsetY = baseOffsetY + previewPan.y;

    // Apply inverse rotation first (if rotated)
    let unrotatedX = canvasX;
    let unrotatedY = canvasY;
    if (drawingRotation !== 0) {
      const canvasCenterX = canvas.width / 2;
      const canvasCenterY = canvas.height / 2;
      const rotationRad = (-drawingRotation * Math.PI) / 180; // Negative for inverse
      const dx = canvasX - canvasCenterX;
      const dy = canvasY - canvasCenterY;
      unrotatedX = canvasCenterX + dx * Math.cos(rotationRad) - dy * Math.sin(rotationRad);
      unrotatedY = canvasCenterY + dx * Math.sin(rotationRad) + dy * Math.cos(rotationRad);
    }

    // Inverse transform: screen to data coordinates
    // For vertical mode, Y is inverted (high elevation at top of canvas)
    return {
      x: bounds.minX + (unrotatedX - offsetX) / scale,
      y: sliceMode === 'vertical'
        ? bounds.maxY - (unrotatedY - offsetY) / scale  // Inverted for vertical mode
        : bounds.minY + (unrotatedY - offsetY) / scale, // Normal for horizontal mode
    };
  }, [previewPoints, previewZoom, previewPan, sliceMode, drawingRotation]);

  // Find the nearest line within a selection radius (in screen pixels)
  const findNearestLine = useCallback((
    canvasX: number, 
    canvasY: number, 
    selectionRadius: number = 5
  ): string | null => {
    const canvas = previewCanvasRef.current;
    if (!canvas || previewPoints.length === 0 || floorPlanLines.length === 0) return null;

    // Calculate bounds from points (same as in render effect)
    const bounds = previewPoints.reduce((acc, p) => ({
      minX: Math.min(acc.minX, p.x),
      maxX: Math.max(acc.maxX, p.x),
      minY: Math.min(acc.minY, p.y),
      maxY: Math.max(acc.maxY, p.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

    const padding = 20;
    const scaleX = (canvas.width - padding * 2) / (bounds.maxX - bounds.minX || 1);
    const scaleY = (canvas.height - padding * 2) / (bounds.maxY - bounds.minY || 1);
    const baseScale = Math.min(scaleX, scaleY);
    const scale = baseScale * previewZoom;

    const contentWidth = (bounds.maxX - bounds.minX) * baseScale;
    const contentHeight = (bounds.maxY - bounds.minY) * baseScale;
    const baseOffsetX = (canvas.width - contentWidth) / 2;
    const baseOffsetY = (canvas.height - contentHeight) / 2;
    const offsetX = baseOffsetX + previewPan.x;
    const offsetY = baseOffsetY + previewPan.y;

    // Rotation parameters
    const rotationRad = (drawingRotation * Math.PI) / 180;
    const canvasCenterX = canvas.width / 2;
    const canvasCenterY = canvas.height / 2;

    // Transform function from data to screen coordinates (with rotation)
    // For vertical mode, Y is inverted (high elevation at top of canvas)
    const transform = (p: Point2D) => {
      let x = offsetX + (p.x - bounds.minX) * scale;
      let y = sliceMode === 'vertical'
        ? offsetY + (bounds.maxY - p.y) * scale  // Inverted for vertical mode
        : offsetY + (p.y - bounds.minY) * scale; // Normal for horizontal mode
      
      // Apply rotation around canvas center
      if (drawingRotation !== 0) {
        const dx = x - canvasCenterX;
        const dy = y - canvasCenterY;
        x = canvasCenterX + dx * Math.cos(rotationRad) - dy * Math.sin(rotationRad);
        y = canvasCenterY + dx * Math.sin(rotationRad) + dy * Math.cos(rotationRad);
      }
      
      return { x, y };
    };

    // Calculate distance from point to line segment
    const distToLineSegment = (
      px: number, py: number,
      x1: number, y1: number,
      x2: number, y2: number
    ): number => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const lengthSq = dx * dx + dy * dy;
      
      if (lengthSq === 0) {
        // Line segment is a point
        return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
      }
      
      // Project point onto line, clamped to segment
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSq));
      const projX = x1 + t * dx;
      const projY = y1 + t * dy;
      
      return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2);
    };

    let nearestId: string | null = null;
    let nearestDist = selectionRadius;

    for (const line of floorPlanLines) {
      const startScreen = transform(line.start);
      const endScreen = transform(line.end);
      
      const dist = distToLineSegment(
        canvasX, canvasY,
        startScreen.x, startScreen.y,
        endScreen.x, endScreen.y
      );
      
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = line.id;
      }
    }

    return nearestId;
  }, [previewPoints, previewZoom, previewPan, floorPlanLines, sliceMode, drawingRotation]);

  // Find nearest text label to screen point (for selection)
  const findNearestTextLabel = useCallback((
    screenX: number,
    screenY: number,
    selectionRadius: number = 20
  ): string | null => {
    const canvas = previewCanvasRef.current;
    if (!canvas || previewPoints.length === 0 || floorPlanTextLabels.length === 0) return null;

    // Calculate bounds from points (same as in render effect)
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    for (const p of previewPoints) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    
    const dataWidth = maxX - minX || 1;
    const dataHeight = maxY - minY || 1;
    const dataCenterX = (minX + maxX) / 2;
    const dataCenterY = (minY + maxY) / 2;
    
    const padFraction = 0.05;
    const scale = Math.min(
      (canvas.width * (1 - 2 * padFraction)) / dataWidth,
      (canvas.height * (1 - 2 * padFraction)) / dataHeight
    ) * previewZoom;
    
    const canvasCenterX = canvas.width / 2 + previewPan.x;
    const canvasCenterY = canvas.height / 2 + previewPan.y;
    
    // Rotation for coordinate transform
    const rotRad = (drawingRotation * Math.PI) / 180;
    const cos = Math.cos(rotRad);
    const sin = Math.sin(rotRad);
    const flipY = sliceMode === 'horizontal' ? -1 : 1;

    // Transform function (same as in render)
    const transform = (p: Point2D) => {
      const dx = p.x - dataCenterX;
      const dy = p.y - dataCenterY;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      return {
        x: canvasCenterX + rx * scale,
        y: canvasCenterY + ry * scale * flipY
      };
    };

    let nearestId: string | null = null;
    let nearestDist = selectionRadius;

    for (const label of floorPlanTextLabels) {
      const labelScreen = transform(label.position);
      const dist = Math.sqrt(
        Math.pow(screenX - labelScreen.x, 2) + Math.pow(screenY - labelScreen.y, 2)
      );
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestId = label.id;
      }
    }

    return nearestId;
  }, [previewPoints, previewZoom, previewPan, floorPlanTextLabels, sliceMode, drawingRotation]);

  // Handle click on preview canvas for line drawing and text labels
  const handlePreviewCanvasClick = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // Scale mouse coordinates to match canvas internal resolution
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;

    if (isAddingText) {
      // Text label mode
      // First check if clicking on existing text label to select/edit it
      const nearestTextId = findNearestTextLabel(canvasX, canvasY);
      if (nearestTextId) {
        setSelectedTextLabelId(nearestTextId);
        setEditingTextLabelId(nearestTextId);
        setSelectedLineId(null);
      } else {
        // Click on empty space - create new text label
        const dataPoint = screenToData(canvasX, canvasY);
        if (dataPoint) {
          const newLabel: FloorPlanTextLabel = {
            id: Math.random().toString(36).substring(2, 10),
            position: dataPoint,
            text: 'Label',
          };
          setFloorPlanTextLabels(prev => [...prev, newLabel]);
          setSelectedTextLabelId(newLabel.id);
          setEditingTextLabelId(newLabel.id);
          setSelectedLineId(null);
        }
      }
    } else if (isDrawingLines) {
      // Line drawing mode
      // Check for snap point first
      const snapPoint = findNearestSnapPoint(canvasX, canvasY);
      const clickPoint = snapPoint || screenToData(canvasX, canvasY);
      
      if (!clickPoint) return;

      if (!lineStartPoint) {
        // First click - set start point
        setLineStartPoint(clickPoint);
      } else {
        // Second click - complete line
        const dx = clickPoint.x - lineStartPoint.x;
        const dy = clickPoint.y - lineStartPoint.y;
        const distanceViewUnits = Math.sqrt(dx * dx + dy * dy);
        const distanceFeet = distanceViewUnits / originalScaleFactorRef.current;

        const newLine: FloorPlanLine = {
          id: Math.random().toString(36).substring(2, 10),
          start: lineStartPoint,
          end: clickPoint,
          distanceFeet,
        };

        setFloorPlanLines(prev => [...prev, newLine]);
        setLineStartPoint(null);
        setHoveredSnapPoint(null);
      }
    } else if (isFloorPlanDeleteMode) {
      // Delete mode - toggle multi-selection for batch deletion
      const nearestTextId = findNearestTextLabel(canvasX, canvasY);
      if (nearestTextId) {
        setSelectedTextLabelIds(prev => 
          prev.includes(nearestTextId) 
            ? prev.filter(id => id !== nearestTextId)
            : [...prev, nearestTextId]
        );
        return;
      }
      
      const nearestLineId = findNearestLine(canvasX, canvasY);
      if (nearestLineId) {
        setSelectedLineIds(prev => 
          prev.includes(nearestLineId)
            ? prev.filter(id => id !== nearestLineId)
            : [...prev, nearestLineId]
        );
      }
      // In delete mode, clicking empty space does nothing (keep selections)
    } else {
      // Selection mode - check if clicking near a text label first
      const nearestTextId = findNearestTextLabel(canvasX, canvasY);
      if (nearestTextId) {
        setSelectedTextLabelId(nearestTextId);
        setSelectedLineId(null);
        return;
      }
      
      // Then check if clicking near a line
      const nearestLineId = findNearestLine(canvasX, canvasY);
      if (nearestLineId) {
        setSelectedLineId(nearestLineId);
        setSelectedTextLabelId(null);
      } else {
        // Clicked empty space - deselect
        setSelectedLineId(null);
        setSelectedTextLabelId(null);
        setEditingTextLabelId(null);
      }
    }
  }, [isDrawingLines, isAddingText, isFloorPlanDeleteMode, lineStartPoint, findNearestSnapPoint, screenToData, findNearestLine, findNearestTextLabel]);

  // Handle drag-to-pan on preview canvas (right/middle click only)
  const handlePreviewMouseDown = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    // Right click (button 2) or middle click (button 1) to pan - works in all modes
    // Left click is reserved for selection (handled by onClick)
    if (event.button === 2 || event.button === 1) {
      event.preventDefault();
      previewDragRef.current = {
        isDragging: true,
        lastPos: { x: event.clientX, y: event.clientY }
      };
    }
  }, []);

  const handlePreviewMouseMove = useCallback((event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // Scale mouse coordinates to match canvas internal resolution
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;

    // Update current mouse position for in-progress line preview
    if (isDrawingLines) {
      setCurrentMousePos({ x: canvasX, y: canvasY });
      
      // Check for snap points
      const snapPoint = findNearestSnapPoint(canvasX, canvasY);
      setHoveredSnapPoint(snapPoint);
    }

    // Handle panning
    if (!previewDragRef.current.isDragging) return;
    
    const deltaX = event.clientX - previewDragRef.current.lastPos.x;
    const deltaY = event.clientY - previewDragRef.current.lastPos.y;
    
    previewDragRef.current.lastPos = { x: event.clientX, y: event.clientY };
    
    // Apply inverse rotation to the delta so panning feels natural relative to rotated content
    const rotationRad = (-drawingRotation * Math.PI) / 180;
    const cos = Math.cos(rotationRad);
    const sin = Math.sin(rotationRad);
    const rotatedDeltaX = deltaX * cos - deltaY * sin;
    const rotatedDeltaY = deltaX * sin + deltaY * cos;
    
    setPreviewPan(prev => ({
      x: prev.x + rotatedDeltaX,
      y: prev.y + rotatedDeltaY
    }));
  }, [isDrawingLines, findNearestSnapPoint, drawingRotation]);

  const handlePreviewMouseUp = useCallback(() => {
    previewDragRef.current.isDragging = false;
  }, []);

  const handlePreviewMouseLeave = useCallback(() => {
    previewDragRef.current.isDragging = false;
    // Clear snap point and mouse position when leaving canvas
    if (isDrawingLines) {
      setHoveredSnapPoint(null);
      setCurrentMousePos(null);
    }
  }, [isDrawingLines]);

  // Reset preview zoom and pan
  const resetPreviewZoom = useCallback(() => {
    setPreviewZoom(1);
    setPreviewPan({ x: 0, y: 0 });
  }, []);

  // Handle slice box handle dragging
  const handleSliceBoxMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!isSliceBoxActive || !sliceBoxGroupRef.current || !cameraRef.current) return false;
    
    const rect = mountRef.current?.getBoundingClientRect();
    if (!rect) return false;
    
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    mouseRef.current.set(x, y);
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    
    // Check for handle hits
    const handleIntersects = raycasterRef.current.intersectObject(sliceBoxGroupRef.current, true);
    const handleHit = handleIntersects.find(i => i.object.userData?.type === 'slice-handle');
    
    if (handleHit && event.ctrlKey) {
      const { handleType, handleIndex } = handleHit.object.userData;
      setDraggingHandle({ type: handleType, index: handleIndex });
      
      // Create a plane perpendicular to the camera for dragging
      const cameraDirection = new THREE.Vector3();
      cameraRef.current.getWorldDirection(cameraDirection);
      sliceDragPlaneRef.current = new THREE.Plane().setFromNormalAndCoplanarPoint(
        cameraDirection.negate(),
        handleHit.point
      );
      
      // Disable orbit controls during handle drag
      if (controlsRef.current) {
        controlsRef.current.enabled = false;
      }
      
      event.preventDefault();
      event.stopPropagation();
      return true;
    }
    
    return false;
  }, [isSliceBoxActive]);

  const handleSliceBoxMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (!sliceBoxConfig || !cameraRef.current) return;
    
    // Handle handle dragging
    if (!draggingHandle || !sliceDragPlaneRef.current) return;
    
    const rect = mountRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    mouseRef.current.set(x, y);
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    
    // Find intersection with the drag plane
    const intersection = new THREE.Vector3();
    raycasterRef.current.ray.intersectPlane(sliceDragPlaneRef.current, intersection);
    
    if (!intersection) return;
    
    // Transform intersection to local slice box space
    const localPoint = intersection.clone();
    const sliceBoxGroup = sliceBoxGroupRef.current;
    if (sliceBoxGroup) {
      sliceBoxGroup.worldToLocal(localPoint);
    }
    
    // Update config based on which handle is being dragged
    const newConfig = { ...sliceBoxConfig };
    
    if (draggingHandle.type === 'corner') {
      // Corner handles adjust the half-extents
      const cornerIndex = draggingHandle.index;
      // Map corner index to which extents to adjust
      const xSign = (cornerIndex % 4 < 2) ? (cornerIndex % 2 === 0 ? -1 : 1) : (cornerIndex % 2 === 0 ? 1 : -1);
      const zSign = cornerIndex % 4 < 2 ? -1 : 1;
      
      // Clamp to minimum size
      const minExtent = 0.05;
      newConfig.halfExtents = {
        x: Math.max(minExtent, Math.abs(localPoint.x)),
        y: newConfig.halfExtents.y,
        z: Math.max(minExtent, Math.abs(localPoint.z)),
      };
    } else if (draggingHandle.type === 'edge') {
      // Edge handles adjust one dimension at a time
      const edgeIndex = draggingHandle.index;
      const minExtent = 0.05;
      
      if (edgeIndex === 0 || edgeIndex === 2) {
        // Front/back edges adjust Z extent
        newConfig.halfExtents = {
          ...newConfig.halfExtents,
          z: Math.max(minExtent, Math.abs(localPoint.z)),
        };
      } else {
        // Left/right edges adjust X extent
        newConfig.halfExtents = {
          ...newConfig.halfExtents,
          x: Math.max(minExtent, Math.abs(localPoint.x)),
        };
      }
    }
    
    setSliceBoxConfig(newConfig);
  }, [draggingHandle, sliceBoxConfig]);

  const handleSliceBoxMouseUp = useCallback(() => {
    // Clear handle dragging state
    if (draggingHandle) {
      setDraggingHandle(null);
      sliceDragPlaneRef.current = null;
      
      // Re-enable orbit controls only if Ctrl is not still held
      if (controlsRef.current && !isSliceBoxEditingRef.current) {
        controlsRef.current.enabled = true;
      }
    }
  }, [draggingHandle]);

  // Handle left-click on canvas (selection, delete mode, measurement, and Ctrl+Click annotation placement)
  const handleCanvasClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!modelRef.current || !cameraRef.current || !sceneRef.current || !annotationsGroupRef.current) return;
    
    // Raycasting setup
    const rect = mountRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    mouseRef.current.set(x, y);
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    
    // Measurement mode - two-click workflow (Ctrl+Click to preserve navigation)
    if (isMeasuring && event.ctrlKey && !isDeleteMode) {
        const intersects = raycasterRef.current.intersectObject(modelRef.current, true);
        if (intersects.length > 0) {
            const point = intersects[0].point;
            const clickedPoint: ThreeDPoint = { x: point.x, y: point.y, z: point.z };
            
            if (!measureStartPoint) {
                // First click - set start point and show temp marker
                setMeasureStartPoint(clickedPoint);
                updateTempMarker(clickedPoint);
            } else {
                // Second click - complete measurement
                const distanceInViewUnits = calculateDistance(measureStartPoint, clickedPoint);
                // Convert back to original model units (feet) by dividing by scale factor
                const distanceFeet = distanceInViewUnits / originalScaleFactorRef.current;
                
                const newMeasurement: ThreeDAnnotation = {
                    id: Math.random().toString(36).substring(2, 10),
                    start: measureStartPoint,
                    end: clickedPoint,
                    color: '#00ff00',  // Green for measurements
                    isMeasurement: true,
                    distanceFeet,
                };
                
                onAnnotationAdd?.(newMeasurement);
                
                // Reset for next measurement
                setMeasureStartPoint(null);
                updateTempMarker(null);
            }
        }
        return;
    }
    
    // Ctrl+Click in edit mode = place annotation
    if (isEditing && event.ctrlKey && !isDeleteMode) {
        const intersects = raycasterRef.current.intersectObject(modelRef.current, true);
        if (intersects.length > 0) {
            const point = intersects[0].point;
            const clickedPoint: ThreeDPoint = { x: point.x, y: point.y, z: point.z };
            
            const newAnnotation: ThreeDAnnotation = {
                id: Math.random().toString(36).substring(2, 10),
                start: clickedPoint,
                end: clickedPoint,
                color: '#00bcd4'
            };
            
            onAnnotationAdd?.(newAnnotation);
            onPointCreated?.(newAnnotation.id);
            setSelectedAnnotationId(null);
            onAnnotationSelect?.(null);
        }
        return;
    }
    
    // Exit slice XZ move mode if clicking outside the slice box
    if (isSliceSelectedForMove && isSliceBoxActive && sliceBoxGroupRef.current) {
        const sliceIntersects = raycasterRef.current.intersectObject(sliceBoxGroupRef.current, true);
        const sliceMeshHit = sliceIntersects.find(i => 
            i.object.userData?.type === 'slice-box-mesh' || 
            i.object.userData?.type === 'slice-handle'
        );
        
        if (!sliceMeshHit) {
            setIsSliceSelectedForMove(false);
        }
    }
    
    // Check for annotation clicks (selection or delete mode toggle)
    const annotationIntersects = raycasterRef.current.intersectObject(annotationsGroupRef.current, true);
    if (annotationIntersects.length > 0) {
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
            return;
        }
    }

    // Deselect if clicking empty space (not in delete mode)
    if (!isDeleteMode && selectedAnnotationId) {
        setSelectedAnnotationId(null);
        onAnnotationSelect?.(null);
    }
    
    // Exit edit mode if clicking elsewhere (not on the editing marker)
    if (editingPoint) {
        // Check if we clicked on the editing marker - if so, don't exit
        const editMarkerHit = annotationIntersects.find(i => 
            i.object.userData?.id === editingPoint.annotationId &&
            i.object.userData?.isStartMarker === editingPoint.isStart
        );
        
        if (!editMarkerHit) {
            setEditingPoint(null);
        }
    }
  };

  // Prevent default context menu when in edit or measure mode
  const handleContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isEditing || isMeasuring) {
        event.preventDefault();
    }
  };

  // Handle double-click to enter/exit measurement point edit mode or slice XZ move mode
  const handleCanvasDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!cameraRef.current || !annotationsGroupRef.current) return;
    
    // Don't handle double-click in delete mode or while creating measurements
    if (isDeleteMode || isMeasuring || isEditing) return;
    
    const rect = mountRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    mouseRef.current.set(x, y);
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    
    // Check for slice box mesh hits when slice box is active
    if (isSliceBoxActive && sliceBoxGroupRef.current) {
        const sliceIntersects = raycasterRef.current.intersectObject(sliceBoxGroupRef.current, true);
        const sliceMeshHit = sliceIntersects.find(i => i.object.userData?.type === 'slice-box-mesh');
        
        if (sliceMeshHit) {
            // Toggle slice XZ move mode
            setIsSliceSelectedForMove(prev => !prev);
            return;
        }
        
        // Double-clicked elsewhere while slice was selected - deselect it
        if (isSliceSelectedForMove) {
            setIsSliceSelectedForMove(false);
            return;
        }
    }
    
    // Check for measurement marker hits
    const annotationIntersects = raycasterRef.current.intersectObject(annotationsGroupRef.current, true);
    if (annotationIntersects.length > 0) {
        // Find a measurement marker hit
        const hit = annotationIntersects.find(i => 
            i.object.userData?.type === 'annotation' && 
            i.object.userData?.isMeasurement === true
        );
        
        if (hit) {
            const annId = hit.object.userData.id;
            const isStartMarker = hit.object.userData.isStartMarker;
            
            // Toggle edit mode: if already editing this point, exit; otherwise enter edit mode
            if (editingPoint?.annotationId === annId && editingPoint.isStart === isStartMarker) {
                // Double-clicking the same marker - exit edit mode
                setEditingPoint(null);
            } else {
                // Enter edit mode for this marker
                // Keep orbit controls enabled - only disable during actual drag on marker
                setEditingPoint({ annotationId: annId, isStart: isStartMarker });
            }
            return;
        }
    }
    
    // Double-clicked elsewhere - exit edit mode if active
    if (editingPoint) {
        setEditingPoint(null);
    }
  };

  // Handle mouse down for starting drag on editing point
  const handleCanvasMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    // Check for slice box handle dragging first
    if (handleSliceBoxMouseDown(event)) {
      return;
    }
    
    if (!editingPoint || !cameraRef.current || !annotationsGroupRef.current) return;
    
    const rect = mountRef.current?.getBoundingClientRect();
    if (!rect) return;

    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    mouseRef.current.set(x, y);
    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    
    // Check if clicking on the editing marker
    const annotationIntersects = raycasterRef.current.intersectObject(annotationsGroupRef.current, true);
    const hit = annotationIntersects.find(i => 
        i.object.userData?.id === editingPoint.annotationId &&
        i.object.userData?.isStartMarker === editingPoint.isStart
    );
    
    if (hit) {
        setIsDraggingPoint(true);
        isDraggingRef.current = true;
        dragStartRef.current = {
            mousePos: new THREE.Vector2(event.clientX, event.clientY),
            pointPos: hit.object.position.clone()
        };
        // Disable orbit controls during drag
        if (controlsRef.current) {
            controlsRef.current.enabled = false;
        }
        event.preventDefault();
    }
  };

  // Handle mouse move for dragging editing point along measurement line
  const handleCanvasMouseMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // Handle slice box dragging first
    if (draggingHandle) {
      handleSliceBoxMouseMove(event);
      return;
    }
    
    if (!isDraggingPoint || !editingPoint || !dragStartRef.current || !cameraRef.current) return;
    
    const annotation = annotations.find(a => a.id === editingPoint.annotationId);
    if (!annotation || !onAnnotationUpdate) return;
    
    // Calculate direction vector of the measurement line
    const direction = new THREE.Vector3(
        annotation.end.x - annotation.start.x,
        annotation.end.y - annotation.start.y,
        annotation.end.z - annotation.start.z
    ).normalize();
    
    const rect = mountRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const camera = cameraRef.current;
    const startPoint3D = dragStartRef.current.pointPos.clone();
    
    // Convert current mouse position to NDC
    const currentMouseNDC = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    
    // Convert start mouse position to NDC
    const startMouseNDC = new THREE.Vector2(
        ((dragStartRef.current.mousePos.x - rect.left) / rect.width) * 2 - 1,
        -((dragStartRef.current.mousePos.y - rect.top) / rect.height) * 2 + 1
    );
    
    // Get the depth of the editing point in NDC space
    const startPointNDC = startPoint3D.clone().project(camera);
    const depth = startPointNDC.z;
    
    // Unproject both mouse positions to world space at the same depth
    const currentWorld = new THREE.Vector3(currentMouseNDC.x, currentMouseNDC.y, depth).unproject(camera);
    const startWorld = new THREE.Vector3(startMouseNDC.x, startMouseNDC.y, depth).unproject(camera);
    
    // Get the world-space movement delta
    const worldDelta = currentWorld.sub(startWorld);
    
    // Project onto the measurement line direction to get movement along the line
    const worldMovement = worldDelta.dot(direction);
    
    // Apply movement along the line direction
    const movement = direction.clone().multiplyScalar(worldMovement);
    
    let newStart = { ...annotation.start };
    let newEnd = { ...annotation.end };
    
    if (editingPoint.isStart) {
        newStart = {
            x: dragStartRef.current.pointPos.x + movement.x,
            y: dragStartRef.current.pointPos.y + movement.y,
            z: dragStartRef.current.pointPos.z + movement.z
        };
    } else {
        newEnd = {
            x: dragStartRef.current.pointPos.x + movement.x,
            y: dragStartRef.current.pointPos.y + movement.y,
            z: dragStartRef.current.pointPos.z + movement.z
        };
    }
    
    // Recalculate distance
    const distanceInViewUnits = calculateDistance(newStart, newEnd);
    const distanceFeet = distanceInViewUnits / originalScaleFactorRef.current;
    
    onAnnotationUpdate({
        ...annotation,
        start: newStart,
        end: newEnd,
        distanceFeet
    });
  }, [isDraggingPoint, editingPoint, annotations, onAnnotationUpdate]);

  // Handle mouse up to finish dragging
  const handleCanvasMouseUp = useCallback(() => {
    // Handle slice box dragging
    handleSliceBoxMouseUp();
    
    if (isDraggingRef.current) {
        setIsDraggingPoint(false);
        isDraggingRef.current = false;
        dragStartRef.current = null;
        // Re-enable orbit controls after drag
        if (controlsRef.current) {
            controlsRef.current.enabled = true;
        }
    }
  }, [handleSliceBoxMouseUp]);

  // Add global mouse up listener for drag end detection
  useEffect(() => {
    const handleGlobalMouseUp = (e: MouseEvent) => {
        // Handle slice box handle dragging
        if (draggingHandle) {
            setDraggingHandle(null);
            sliceDragPlaneRef.current = null;
        }
        
        if (isDraggingRef.current) {
            setIsDraggingPoint(false);
            isDraggingRef.current = false;
            dragStartRef.current = null;
        }
        
        // Re-enable orbit controls after any drag ends, but only if Ctrl is not held
        // (if Ctrl is still held, keep controls disabled for slice box editing)
        if (controlsRef.current && !controlsRef.current.enabled && !e.ctrlKey) {
            controlsRef.current.enabled = true;
        }
    };
    
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [draggingHandle]);

  // Ctrl key listener for slice box editing - disables navigation while Ctrl is held
  // Attaches to renderer.domElement to intercept events before OrbitControls processes them
  useEffect(() => {
    if (!isSliceBoxActive) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' && controlsRef.current) {
        controlsRef.current.enabled = false;
        isSliceBoxEditingRef.current = true;
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Control' && controlsRef.current && !draggingHandle) {
        controlsRef.current.enabled = true;
        isSliceBoxEditingRef.current = false;
      }
    };
    
    // Block OrbitControls by intercepting events on the renderer's canvas element
    // OrbitControls attaches to renderer.domElement, so we attach with capture: true
    // to intercept before it processes them
    const rendererElement = rendererRef.current?.domElement;
    
    const blockOrbitControls = (e: Event) => {
      // OrbitControls is already disabled via controlsRef.current.enabled = false
      // when Ctrl is pressed. No need to stopPropagation as it blocks React handlers.
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    if (rendererElement) {
      rendererElement.addEventListener('mousedown', blockOrbitControls, { capture: true });
      rendererElement.addEventListener('mousemove', blockOrbitControls, { capture: true });
      rendererElement.addEventListener('wheel', blockOrbitControls, { capture: true });
      rendererElement.addEventListener('contextmenu', blockOrbitControls, { capture: true });
    }
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      
      if (rendererElement) {
        rendererElement.removeEventListener('mousedown', blockOrbitControls, { capture: true });
        rendererElement.removeEventListener('mousemove', blockOrbitControls, { capture: true });
        rendererElement.removeEventListener('wheel', blockOrbitControls, { capture: true });
        rendererElement.removeEventListener('contextmenu', blockOrbitControls, { capture: true });
      }
      
      // Re-enable controls when slice box is deactivated
      if (controlsRef.current) {
        controlsRef.current.enabled = true;
      }
      isSliceBoxEditingRef.current = false;
    };
  }, [isSliceBoxActive, draggingHandle]);

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
          setEditingPoint(null); // Clear point editing
          setSelectedAnnotationId(null); // Clear single selection
          onAnnotationSelect?.(null);
      }
  };

  // Helper to compute perpendicular basis vectors for arrow key movement
  const computePerpendicularBasis = useCallback((start: ThreeDPoint, end: ThreeDPoint) => {
    const direction = new THREE.Vector3(
        end.x - start.x,
        end.y - start.y,
        end.z - start.z
    ).normalize();
    
    // Use world up (Y-axis) to compute first perpendicular vector
    const worldUp = new THREE.Vector3(0, 1, 0);
    
    // If direction is nearly parallel to world up, use X-axis instead
    let perpendicular1: THREE.Vector3;
    if (Math.abs(direction.dot(worldUp)) > 0.99) {
        const worldX = new THREE.Vector3(1, 0, 0);
        perpendicular1 = new THREE.Vector3().crossVectors(direction, worldX).normalize();
    } else {
        perpendicular1 = new THREE.Vector3().crossVectors(direction, worldUp).normalize();
    }
    
    // Second perpendicular vector is cross product of direction and first perpendicular
    const perpendicular2 = new THREE.Vector3().crossVectors(direction, perpendicular1).normalize();
    
    return { perpendicular1, perpendicular2, direction };
  }, []);

  // Handle Delete/Backspace key, Escape, and Arrow keys for point editing
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        // Escape key - exit editing mode, delete mode, or slice XZ move mode
        if (e.key === 'Escape') {
            if (isFloorPlanDeleteMode) {
                setIsFloorPlanDeleteMode(false);
                setSelectedLineIds([]);
                setSelectedTextLabelIds([]);
                return;
            }
            if (isSliceSelectedForMove) {
                setIsSliceSelectedForMove(false);
                return;
            }
            if (editingPoint) {
                setEditingPoint(null);
                return;
            }
        }
        
        // WASD keys - move slice in XZ plane when selected for move
        if (isSliceSelectedForMove && sliceBoxConfig && ['w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(e.key)) {
            e.preventDefault();
            
            const xzStep = 0.005; // Same step size as vertical movement
            
            setSliceBoxConfig(prev => {
                if (!prev) return null;
                const key = e.key.toLowerCase();
                switch (key) {
                    case 'w': // Forward (-Z)
                        return { ...prev, center: { ...prev.center, z: prev.center.z - xzStep } };
                    case 's': // Backward (+Z)
                        return { ...prev, center: { ...prev.center, z: prev.center.z + xzStep } };
                    case 'a': // Left (-X)
                        return { ...prev, center: { ...prev.center, x: prev.center.x - xzStep } };
                    case 'd': // Right (+X)
                        return { ...prev, center: { ...prev.center, x: prev.center.x + xzStep } };
                    default:
                        return prev;
                }
            });
            return;
        }
        
        // Arrow keys - move/rotate slice box when active
        if (isSliceBoxActive && sliceBoxConfig && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            
            const verticalStep = 0.005; // ~0.6 inches in scaled units
            const rotationStep = Math.PI / 100; // 1 degree
            
            setSliceBoxConfig(prev => {
                if (!prev) return null;
                switch (e.key) {
                    case 'ArrowUp':
                        return { ...prev, center: { ...prev.center, y: prev.center.y + verticalStep } };
                    case 'ArrowDown':
                        return { ...prev, center: { ...prev.center, y: prev.center.y - verticalStep } };
                    case 'ArrowLeft':
                        return { ...prev, rotation: { ...prev.rotation, y: prev.rotation.y + rotationStep } };
                    case 'ArrowRight':
                        return { ...prev, rotation: { ...prev.rotation, y: prev.rotation.y - rotationStep } };
                    default:
                        return prev;
                }
            });
            return;
        }
        
        // Arrow keys - move editing point on perpendicular plane
        if (editingPoint && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            
            const annotation = annotations.find(a => a.id === editingPoint.annotationId);
            if (!annotation || !onAnnotationUpdate) return;
            
            // Step size: ~1 inch in feet (1/12), scaled to view units
            const stepSize = (1 / 12) * originalScaleFactorRef.current;
            
            const { perpendicular1, perpendicular2 } = computePerpendicularBasis(annotation.start, annotation.end);
            
            // Map arrow keys to perpendicular directions
            let movement = new THREE.Vector3();
            switch (e.key) {
                case 'ArrowUp':
                    movement = perpendicular2.clone().multiplyScalar(-stepSize);
                    break;
                case 'ArrowDown':
                    movement = perpendicular2.clone().multiplyScalar(stepSize);
                    break;
                case 'ArrowLeft':
                    movement = perpendicular1.clone().multiplyScalar(stepSize);
                    break;
                case 'ArrowRight':
                    movement = perpendicular1.clone().multiplyScalar(-stepSize);
                    break;
            }
            
            // Apply movement to the appropriate point
            let newStart = { ...annotation.start };
            let newEnd = { ...annotation.end };
            
            if (editingPoint.isStart) {
                newStart = {
                    x: annotation.start.x + movement.x,
                    y: annotation.start.y + movement.y,
                    z: annotation.start.z + movement.z
                };
            } else {
                newEnd = {
                    x: annotation.end.x + movement.x,
                    y: annotation.end.y + movement.y,
                    z: annotation.end.z + movement.z
                };
            }
            
            // Recalculate distance
            const distanceInViewUnits = calculateDistance(newStart, newEnd);
            const distanceFeet = distanceInViewUnits / originalScaleFactorRef.current;
            
            onAnnotationUpdate({
                ...annotation,
                start: newStart,
                end: newEnd,
                distanceFeet
            });
            
            return;
        }
        
        // Delete/Backspace keys
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
  }, [selectedAnnotationId, onAnnotationDelete, isDeleteMode, annotationsToDelete, editingPoint, annotations, onAnnotationUpdate, computePerpendicularBasis, isSliceBoxActive, sliceBoxConfig, isSliceSelectedForMove, isFloorPlanDeleteMode]);


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
    const camera = new THREE.PerspectiveCamera(75, currentMount.clientWidth / currentMount.clientHeight, 0.001, 1000);
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
        
        // === DEBUG: Log dimensional data from GLB ===
        console.log('=== GLB MODEL DIMENSIONAL DATA ===');
        console.log('Asset Metadata:', gltf.asset);
        console.log('Original dimensions (glTF spec = meters):');
        console.log('  Width (X):', size.x.toFixed(4), 'm =', (size.x * 3.28084).toFixed(2), 'ft =', (size.x * 3.28084 * 12).toFixed(2), 'in');
        console.log('  Height (Y):', size.y.toFixed(4), 'm =', (size.y * 3.28084).toFixed(2), 'ft =', (size.y * 3.28084 * 12).toFixed(2), 'in');
        console.log('  Depth (Z):', size.z.toFixed(4), 'm =', (size.z * 3.28084).toFixed(2), 'ft =', (size.z * 3.28084 * 12).toFixed(2), 'in');
        console.log('Bounding Box Min:', box.min);
        console.log('Bounding Box Max:', box.max);
        console.log('=================================');
        // === END DEBUG ===
        
        const maxDim = Math.max(size.x, size.y, size.z);
        const cameraDistance = 5; // Adjust this value to control zoom
        const scale = cameraDistance / maxDim;
        model.scale.set(scale, scale, scale);
        
        // Store the scale factor for measurement calculations
        originalScaleFactorRef.current = scale;
        
        // Log the scale factor being applied
        console.log('Scale factor applied to fit view:', scale);
        console.log('To get real measurements, divide by this scale factor');
        
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
      // Skip rendering when 3D view is hidden (for performance)
      if (!is3DVisibleRef.current) return;
      // Safety check: ensure controls are enabled unless we're actively dragging a point or editing slice box
      if (!isDraggingRef.current && !isSliceBoxEditingRef.current && !controls.enabled) {
        controls.enabled = true;
      }
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
      setContentType('glb');
    }
    // Reset the input value to allow re-uploading the same file
    if (event.target) {
      event.target.value = '';
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };


  // Analysis tool handlers
  const handleGenerateFloorPlan = () => {
    console.log('[Floor Plan] Activating slice box tool');
    
    // If hidden, just re-show
    if (isSliceBoxActive && isSliceBoxHidden) {
      setIsSliceBoxHidden(false);
      return;
    }
    
    // If already active and visible, toggle off
    if (isSliceBoxActive) {
      setIsSliceBoxActive(false);
      setSliceBoxConfig(null);
      setIsSliceSelectedForMove(false);
      setIsSliceBoxHidden(false);
      setSliceMode('horizontal'); // Reset to horizontal mode
      return;
    }
    
    // Initialize slice box centered on model bounds
    if (modelRef.current) {
      const box = new THREE.Box3().setFromObject(modelRef.current);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      
      // Create initial slice box config
      const initialConfig: SliceBoxConfig = {
        center: { x: center.x, y: center.y, z: center.z },
        halfExtents: { 
          x: size.x * 0.4,  // Start with 80% of model width
          y: 0,            // Ignored, thickness is used instead
          z: size.z * 0.4, // Start with 80% of model depth
        },
        rotation: { x: 0, y: 0, z: 0 },
        thicknessInches: 6, // Default 6 inches
      };
      
      setSliceBoxConfig(initialConfig);
      setIsSliceBoxActive(true);
    }
  };

  const handleDetectStructure = () => {
    console.log('[Analysis Tools] Detect Structure initiated');
    setIsProcessing(true);
    setActiveFeature('structure');
    // TODO: Agent 5 will implement actual structure detection
    setTimeout(() => {
      console.log('[Analysis Tools] Structure detection complete (placeholder)');
      setIsProcessing(false);
      setActiveFeature(null);
    }, 2000);
  };

  const handleAnalyzeLoadBearing = () => {
    console.log('[Analysis Tools] Load-Bearing Analysis initiated');
    setIsProcessing(true);
    setActiveFeature('load-bearing');
    // TODO: Agent 5 will implement actual load-bearing analysis
    setTimeout(() => {
      console.log('[Analysis Tools] Load-bearing analysis complete (placeholder)');
      setIsProcessing(false);
      setActiveFeature(null);
    }, 2000);
  };

  const handleLayerToggle = (layer: string, enabled: boolean) => {
    console.log(`[Floor Plan] Layer "${layer}" toggled:`, enabled);
    const newLayers = { ...floorPlanLayers, [layer]: enabled };
    setFloorPlanLayers(newLayers);
    
    // Regenerate SVG with updated layers
    if (floorPlanData) {
      const svg = generateFloorPlanSVG(floorPlanData, {
        width: 1000,
        height: 800,
        showWalls: true,
        showDimensions: newLayers.dimensions,
        showWallThickness: newLayers.wallThickness
      });
      setFloorPlanSVG(svg);
    }
  };

  const handleExport = (format: 'svg' | 'dxf' | 'pdf' | 'json') => {
    console.log(`[Floor Plan] Exporting as ${format.toUpperCase()}`);
    
    if (!floorPlanData || !floorPlanSVG) {
      console.warn('[Floor Plan] No floor plan data to export');
      return;
    }
    
    const filename = `floor_plan_${new Date().toISOString().split('T')[0]}`;
    
    switch (format) {
      case 'svg':
        downloadSvg(floorPlanSVG, `${filename}.svg`);
        break;
      case 'dxf':
        exportToDXF(floorPlanData, originalScaleFactorRef.current, `${filename}.dxf`);
        break;
      case 'pdf':
        exportToPDF(floorPlanSVG, `${filename}.pdf`);
        break;
      case 'json':
        exportToJSON(floorPlanData, `${filename}.json`);
        break;
    }
  };

  return (
    <div className="w-full h-full flex flex-col relative">
      <div 
        ref={mountRef} 
        className={`w-full h-full rounded-lg ${(isEditing || isMeasuring) ? 'cursor-crosshair' : (editingPoint || draggingHandle) ? 'cursor-move' : isSliceSelectedForMove ? 'cursor-grab' : isSliceBoxActive ? 'cursor-pointer' : 'cursor-default'}`}
        style={{ display: is3DVisible ? 'block' : 'none' }}
        onClick={handleCanvasClick}
        onDoubleClick={handleCanvasDoubleClick}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleCanvasMouseMove}
        onMouseUp={handleCanvasMouseUp}
        onContextMenu={handleContextMenu}
      />
      
      {/* Hidden file inputs for upload triggers */}
      <input
        type="file"
        accept=".glb,.gltf"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        aria-label="Upload GLB model"
      />


      {modelLoaded && !isLoading && (
        <>
            
             {/* Edit Mode Toggle, Measure & Delete Buttons */}
            <div className="absolute top-4 right-4 flex gap-2">
                 <button
                   onClick={() => setIs3DVisible(!is3DVisible)}
                   className={`px-4 py-2 backdrop-blur-sm border border-gray-700/50 text-white text-sm font-semibold rounded-md transition-colors pointer-events-auto flex items-center gap-2 ${
                     is3DVisible ? 'bg-gray-800/80 hover:bg-gray-700' : 'bg-amber-600 hover:bg-amber-700'
                   }`}
                   title={is3DVisible ? 'Hide 3D Model' : 'Show 3D Model'}
                 >
                   <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                     {is3DVisible ? (
                       <>
                         <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                         <circle cx="12" cy="12" r="3" />
                       </>
                     ) : (
                       <>
                         <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                         <line x1="1" y1="1" x2="23" y2="23" />
                       </>
                     )}
                   </svg>
                   {is3DVisible ? 'Hide 3D' : 'Show 3D'}
                 </button>
                 <button
                   onClick={() => {
                     console.log('[GLB Viewer] Settings button clicked');
                     setShowPointCloudSettings(!showPointCloudSettings);
                   }}
                   className={`px-4 py-2 backdrop-blur-sm border border-gray-700/50 text-white text-sm font-semibold rounded-md transition-colors pointer-events-auto flex items-center gap-2 ${
                     showPointCloudSettings ? 'bg-cyan-600 hover:bg-cyan-700' : 'bg-gray-800/80 hover:bg-gray-700'
                   }`}
                 >
                   <SettingsIcon className="h-4 w-4" />
                   Settings
                 </button>
                 <button
                   onClick={() => {
                     console.log('[GLB Viewer] Analysis button clicked');
                     setShowAnalysisTools(!showAnalysisTools);
                   }}
                   className={`px-4 py-2 backdrop-blur-sm border border-gray-700/50 text-white text-sm font-semibold rounded-md transition-colors pointer-events-auto flex items-center gap-2 ${
                     showAnalysisTools ? 'bg-cyan-600 hover:bg-cyan-700' : 'bg-gray-800/80 hover:bg-gray-700'
                   }`}
                 >
                   Analysis
                 </button>
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

                 {/* Measure Button */}
                 <button
                     onClick={() => {
                         if (isDeleteMode) {
                             setIsDeleteMode(false);
                             setAnnotationsToDelete([]);
                         }
                         if (isEditing) {
                             setIsEditing(false);
                         }
                         // Clear point editing when entering measure mode
                         if (editingPoint) {
                             setEditingPoint(null);
                         }
                         const newMeasuringState = !isMeasuring;
                         setIsMeasuring(newMeasuringState);
                         if (!newMeasuringState) {
                             // Exiting measure mode - clear temp marker
                             setMeasureStartPoint(null);
                             updateTempMarker(null);
                         }
                         setSelectedAnnotationId(null);
                         onAnnotationSelect?.(null);
                     }}
                     className={`px-4 py-2 backdrop-blur-sm border text-white text-sm font-semibold rounded-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 transition-colors pointer-events-auto flex items-center gap-2 ${
                         isMeasuring 
                             ? 'bg-green-600 hover:bg-green-700 border-green-500/50 focus:ring-green-500 ring-2 ring-green-500' 
                             : 'bg-gray-800/80 border-gray-700/50 hover:bg-gray-700 focus:ring-green-500'
                     }`}
                     aria-label={isMeasuring ? "Exit Measure Mode" : "Enter Measure Mode"}
                 >
                     <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                         <path d="M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z"/>
                         <path d="m14.5 12.5 2-2"/>
                         <path d="m11.5 9.5 2-2"/>
                         <path d="m8.5 6.5 2-2"/>
                         <path d="m17.5 15.5 2-2"/>
                     </svg>
                     {isMeasuring ? (measureStartPoint ? 'Ctrl+Click end' : 'Ctrl+Click start') : 'Measure'}
                 </button>

                 <button
                   onClick={() => {
                       if (isDeleteMode) {
                           setIsDeleteMode(false);
                           setAnnotationsToDelete([]);
                       }
                       if (isMeasuring) {
                           setIsMeasuring(false);
                           setMeasureStartPoint(null);
                           updateTempMarker(null);
                       }
                       // Clear point editing when entering annotate mode
                       if (editingPoint) {
                           setEditingPoint(null);
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

            {/* Settings Panel for GLB Viewer */}
            {showPointCloudSettings && (
              <PointCloudSettingsPanel
                pointSize={pointSize}
                onPointSizeChange={setPointSize}
                pointBudget={pointBudget}
                onPointBudgetChange={setPointBudget}
                colorMode={colorMode}
                onColorModeChange={(mode) => setColorMode(mode as typeof colorMode)}
                visiblePointCount={visiblePointCount}
                onClose={() => setShowPointCloudSettings(false)}
              />
            )}

            {/* Analysis Tools Panel for GLB Viewer */}
            {showAnalysisTools && (
              <AnalysisToolsPanel
                onGenerateFloorPlan={handleGenerateFloorPlan}
                onDetectStructure={handleDetectStructure}
                onAnalyzeLoadBearing={handleAnalyzeLoadBearing}
                isProcessing={isProcessing}
                activeFeature={activeFeature}
              />
            )}

            {/* Floor Plan Results Panel for GLB Viewer */}
            {showFloorPlanResults && (
              <FloorPlanResultsPanel
                svgContent={floorPlanSVG}
                wallCount={floorPlanData?.metadata.wallCount ?? 0}
                totalArea={floorPlanData ? calculateFloorPlanStats(floorPlanData).boundingAreaSqFt : 0}
                layers={floorPlanLayers}
                onLayerToggle={handleLayerToggle}
                onExport={handleExport}
                onClose={() => setShowFloorPlanResults(false)}
              />
            )}

            {/* Slice Preview Panel - Draggable & Resizable */}
            {isSliceBoxActive && sliceBoxConfig && !isSliceBoxHidden && (
              <Rnd
                className="bg-gray-900/95 backdrop-blur-sm border border-gray-700/50 rounded-lg overflow-hidden pointer-events-auto shadow-xl"
                position={previewPanelPos}
                size={previewPanelSize}
                minWidth={192}
                minHeight={192}
                bounds="parent"
                dragHandleClassName="preview-drag-handle"
                enableResizing={{
                  top: true,
                  right: true,
                  bottom: true,
                  left: true,
                  topRight: true,
                  bottomRight: true,
                  bottomLeft: true,
                  topLeft: true,
                }}
                onDragStop={(e, d) => {
                  setPreviewPanelPos({ x: d.x, y: d.y });
                }}
                onResizeStop={(e, direction, ref, delta, position) => {
                  setPreviewPanelSize({
                    width: ref.offsetWidth,
                    height: ref.offsetHeight,
                  });
                  setPreviewPanelPos(position);
                }}
              >
                {/* Header - Drag Handle */}
                <div className="preview-drag-handle absolute top-0 left-0 right-0 flex items-center justify-between px-3 py-2 bg-gray-800/80 border-b border-gray-700/50 z-20 cursor-move select-none">
                  <span className="text-xs text-gray-400 font-medium">
                    {sliceMode === 'vertical' ? 'Elevation Preview' : 'Top-Down Preview'}
                  </span>

                  <div className="flex items-center gap-1">
                    {/* Slice Mode Toggle Button */}
                    <button
                      onClick={() => {
                        const newMode = sliceMode === 'horizontal' ? 'vertical' : 'horizontal';
                        setSliceMode(newMode);
                        // Clear drawn lines and text labels when switching modes
                        setFloorPlanLines([]);
                        setLineStartPoint(null);
                        setSelectedLineId(null);
                        setFloorPlanTextLabels([]);
                        setSelectedTextLabelId(null);
                        setEditingTextLabelId(null);
                        setIsAddingText(false);
                        // Reset zoom/pan
                        setPreviewZoom(1);
                        setPreviewPan({ x: 0, y: 0 });
                        // Rotate slice box for vertical mode
                        if (sliceBoxConfig) {
                          setSliceBoxConfig({
                            ...sliceBoxConfig,
                            rotation: {
                              ...sliceBoxConfig.rotation,
                              x: newMode === 'vertical' ? Math.PI / 2 : 0
                            }
                          });
                        }
                      }}
                      className={`p-1 rounded transition-colors ${
                        sliceMode === 'vertical'
                          ? 'bg-purple-600 hover:bg-purple-700'
                          : 'hover:bg-gray-700'
                      }`}
                      title={sliceMode === 'vertical' ? 'Switch to Floor Plan View' : 'Switch to Elevation View'}
                    >
                      <svg 
                        className={`h-4 w-4 ${sliceMode === 'vertical' ? 'text-white' : 'text-gray-400'}`}
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="currentColor" 
                        strokeWidth="2"
                      >
                        {sliceMode === 'vertical' ? (
                          // Vertical slice icon (rectangle on edge)
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 3h6v18H9V3z" />
                        ) : (
                          // Horizontal slice icon (rectangle flat)
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9h18v6H3V9z" />
                        )}
                      </svg>
                    </button>
                    {/* Draw Lines Toggle Button */}
                    <button
                      onClick={() => {
                        setIsDrawingLines(!isDrawingLines);
                        if (isDrawingLines) {
                          // Exiting draw mode - clear in-progress line
                          setLineStartPoint(null);
                          setHoveredSnapPoint(null);
                          setCurrentMousePos(null);
                        }
                        // Disable text mode when entering draw mode
                        if (!isDrawingLines) {
                          setIsAddingText(false);
                          setSelectedTextLabelId(null);
                          setEditingTextLabelId(null);
                          // Exit delete mode when entering draw mode
                          setIsFloorPlanDeleteMode(false);
                          setSelectedLineIds([]);
                          setSelectedTextLabelIds([]);
                        }
                        // Clear selection when toggling draw mode
                        setSelectedLineId(null);
                      }}
                      className={`p-1 rounded transition-colors ${
                        isDrawingLines 
                          ? 'bg-cyan-600 hover:bg-cyan-700' 
                          : 'hover:bg-gray-700'
                      }`}
                      title={isDrawingLines ? 'Exit Draw Mode' : 'Draw Lines'}
                    >
                      <svg 
                        className={`h-4 w-4 ${isDrawingLines ? 'text-white' : 'text-gray-400'}`}
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="currentColor" 
                        strokeWidth="2"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    {/* Add Text Label Toggle Button */}
                    <button
                      onClick={() => {
                        setIsAddingText(!isAddingText);
                        if (isAddingText) {
                          // Exiting text mode
                          setSelectedTextLabelId(null);
                          setEditingTextLabelId(null);
                        }
                        // Disable line drawing mode when entering text mode
                        if (!isAddingText) {
                          setIsDrawingLines(false);
                          setLineStartPoint(null);
                          setHoveredSnapPoint(null);
                          setCurrentMousePos(null);
                          setSelectedLineId(null);
                          // Exit delete mode when entering text mode
                          setIsFloorPlanDeleteMode(false);
                          setSelectedLineIds([]);
                          setSelectedTextLabelIds([]);
                        }
                      }}
                      className={`p-1 rounded transition-colors ${
                        isAddingText 
                          ? 'bg-amber-600 hover:bg-amber-700' 
                          : 'hover:bg-gray-700'
                      }`}
                      title={isAddingText ? 'Exit Text Mode' : 'Add Text Labels'}
                    >
                      <svg 
                        className={`h-4 w-4 ${isAddingText ? 'text-white' : 'text-gray-400'}`}
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="currentColor" 
                        strokeWidth="2"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h8m-8 6h16M9 6v12" />
                      </svg>
                    </button>
                    {/* Delete Mode Button - always visible */}
                    <button
                      onClick={() => {
                        if (isFloorPlanDeleteMode) {
                          // In delete mode - if items selected, delete them
                          if (selectedLineIds.length > 0 || selectedTextLabelIds.length > 0) {
                            setFloorPlanLines(prev => prev.filter(l => !selectedLineIds.includes(l.id)));
                            setFloorPlanTextLabels(prev => prev.filter(l => !selectedTextLabelIds.includes(l.id)));
                            setSelectedLineIds([]);
                            setSelectedTextLabelIds([]);
                          }
                          // Exit delete mode
                          setIsFloorPlanDeleteMode(false);
                        } else {
                          // Enter delete mode
                          setIsFloorPlanDeleteMode(true);
                          // Clear single selections
                          setSelectedLineId(null);
                          setSelectedTextLabelId(null);
                          setEditingTextLabelId(null);
                          // Exit other modes
                          setIsDrawingLines(false);
                          setIsAddingText(false);
                          setLineStartPoint(null);
                        }
                      }}
                      className={`p-1 rounded transition-colors relative ${
                        isFloorPlanDeleteMode 
                          ? 'bg-red-600 hover:bg-red-700' 
                          : 'hover:bg-gray-700'
                      }`}
                      title={isFloorPlanDeleteMode 
                        ? (selectedLineIds.length + selectedTextLabelIds.length > 0 
                          ? `Delete ${selectedLineIds.length + selectedTextLabelIds.length} selected item(s)` 
                          : 'Exit Delete Mode')
                        : 'Delete Mode'
                      }
                    >
                      <svg 
                        className={`h-4 w-4 ${isFloorPlanDeleteMode ? 'text-white' : 'text-red-400 hover:text-white'}`}
                        viewBox="0 0 24 24" 
                        fill="none" 
                        stroke="currentColor" 
                        strokeWidth="2"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                      {/* Selection count badge */}
                      {isFloorPlanDeleteMode && (selectedLineIds.length + selectedTextLabelIds.length) > 0 && (
                        <span className="absolute -top-1 -right-1 bg-white text-red-600 text-xs font-bold rounded-full w-4 h-4 flex items-center justify-center">
                          {selectedLineIds.length + selectedTextLabelIds.length}
                        </span>
                      )}
                    </button>
                    {/* Export PDF Button - only show when there are lines or text labels */}
                    {(floorPlanLines.length > 0 || floorPlanTextLabels.length > 0) && (
                      <button
                        onClick={() => {
                          const prefix = sliceMode === 'vertical' ? 'elevation' : 'floor_plan';
                          const filename = `${prefix}_${new Date().toISOString().split('T')[0]}.pdf`;
                          exportFloorPlanToPDF(
                            floorPlanLines,
                            floorPlanTextLabels,
                            drawingRotation,
                            originalScaleFactorRef.current,
                            filename,
                            measurementTextSize,
                            sheetTitle,
                            lineThickness,
                            dimensionLineScale
                          );
                        }}
                        className="p-1 hover:bg-green-600 rounded transition-colors"
                        title="Export as PDF"
                      >
                        <svg 
                          className="h-4 w-4 text-green-400 hover:text-white"
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="2"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </button>
                    )}
                    {/* Reset Zoom Button - only show when zoomed */}
                    {(previewZoom !== 1 || previewPan.x !== 0 || previewPan.y !== 0) && (
                      <button
                        onClick={resetPreviewZoom}
                        className="p-1 hover:bg-gray-700 rounded transition-colors"
                        title="Reset zoom (1x)"
                      >
                        <svg 
                          className="h-4 w-4 text-cyan-400" 
                          viewBox="0 0 24 24" 
                          fill="none" 
                          stroke="currentColor" 
                          strokeWidth="2"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
                        </svg>
                      </button>
                    )}
                    <button
                      onClick={() => {
                      const newExpanded = !isPreviewExpanded;
                      setIsPreviewExpanded(newExpanded);
                      if (newExpanded) {
                        // Expand to larger size
                        const newWidth = 520;
                        const newHeight = 480;
                        // Adjust position if it would go off-screen
                        const rect = mountRef.current?.getBoundingClientRect();
                        if (rect) {
                          const maxX = rect.width - newWidth;
                          const maxY = rect.height - newHeight;
                          setPreviewPanelPos(prev => ({
                            x: Math.min(prev.x, Math.max(0, maxX)),
                            y: Math.min(prev.y, Math.max(0, maxY)),
                          }));
                        }
                        setPreviewPanelSize({ width: newWidth, height: newHeight });
                      } else {
                        // Collapse to smaller size
                        setPreviewPanelSize({ width: 192, height: 192 });
                      }
                    }}
                    className="p-1 hover:bg-gray-700 rounded transition-colors"
                    title={isPreviewExpanded ? 'Collapse' : 'Expand'}
                  >
                    <svg 
                      className={`h-4 w-4 text-gray-400 transition-transform duration-300 ${isPreviewExpanded ? 'rotate-180' : ''}`} 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor" 
                      strokeWidth="2"
                    >
                      {isPreviewExpanded ? (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 9L4 4m0 0v5m0-5h5m6 11l5 5m0 0v-5m0 5h-5" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                      )}
                    </svg>
                  </button>
                  <button
                    onClick={() => setIsSliceBoxHidden(true)}
                    className="p-1 hover:bg-red-600 rounded transition-colors"
                    title="Close Preview"
                  >
                    <svg className="h-4 w-4 text-gray-400 hover:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  </div>
                </div>
                
                {/* Canvas Container */}
                <div className="pt-9 h-full flex">
                  {/* Preview Canvas */}
                  <div className="w-full h-full flex flex-col">
                    <div className="relative flex-1 min-h-0">
                      <canvas 
                        ref={previewCanvasRef} 
                        width={Math.max(100, previewPanelSize.width - 16)} 
                        height={Math.max(100, previewPanelSize.height - 80)} 
                        className={`w-full h-full ${isDrawingLines || isAddingText ? 'cursor-crosshair' : 'cursor-default'}`}
                        onWheel={handlePreviewWheel}
                        onClick={handlePreviewCanvasClick}
                        onMouseDown={handlePreviewMouseDown}
                        onMouseMove={handlePreviewMouseMove}
                        onMouseUp={handlePreviewMouseUp}
                        onMouseLeave={handlePreviewMouseLeave}
                        onContextMenu={(e) => e.preventDefault()}
                      />
                      {/* Inline text label editor overlay */}
                      {editingTextLabelId && (() => {
                        const label = floorPlanTextLabels.find(l => l.id === editingTextLabelId);
                        if (!label || previewPoints.length === 0) return null;
                        
                        const canvas = previewCanvasRef.current;
                        if (!canvas) return null;
                        
                        // Calculate screen position using same transform as canvas render
                        let minX = Infinity, maxX = -Infinity;
                        let minY = Infinity, maxY = -Infinity;
                        for (const p of previewPoints) {
                          if (p.x < minX) minX = p.x;
                          if (p.x > maxX) maxX = p.x;
                          if (p.y < minY) minY = p.y;
                          if (p.y > maxY) maxY = p.y;
                        }
                        const dataWidth = maxX - minX || 1;
                        const dataHeight = maxY - minY || 1;
                        const dataCenterX = (minX + maxX) / 2;
                        const dataCenterY = (minY + maxY) / 2;
                        const padFraction = 0.05;
                        const scale = Math.min(
                          (canvas.width * (1 - 2 * padFraction)) / dataWidth,
                          (canvas.height * (1 - 2 * padFraction)) / dataHeight
                        ) * previewZoom;
                        const canvasCenterX = canvas.width / 2 + previewPan.x;
                        const canvasCenterY = canvas.height / 2 + previewPan.y;
                        const rotRad = (drawingRotation * Math.PI) / 180;
                        const cos = Math.cos(rotRad);
                        const sin = Math.sin(rotRad);
                        const flipY = sliceMode === 'horizontal' ? -1 : 1;
                        
                        const dx = label.position.x - dataCenterX;
                        const dy = label.position.y - dataCenterY;
                        const rx = dx * cos - dy * sin;
                        const ry = dx * sin + dy * cos;
                        const screenX = canvasCenterX + rx * scale;
                        const screenY = canvasCenterY + ry * scale * flipY;
                        
                        // Convert canvas coords to CSS coords (canvas may be scaled)
                        const rect = canvas.getBoundingClientRect();
                        const cssX = (screenX / canvas.width) * rect.width;
                        const cssY = (screenY / canvas.height) * rect.height;
                        
                        return (
                          <input
                            type="text"
                            autoFocus
                            value={label.text}
                            onChange={(e) => {
                              setFloorPlanTextLabels(prev => 
                                prev.map(l => l.id === editingTextLabelId 
                                  ? { ...l, text: e.target.value }
                                  : l
                                )
                              );
                            }}
                            onKeyDown={(e) => {
                              // Prevent Enter from submitting forms or causing issues
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            onBlur={() => setEditingTextLabelId(null)}
                            className="absolute px-1 py-0.5 text-xs font-bold bg-amber-500 text-black border-2 border-amber-400 rounded outline-none text-center min-w-[60px]"
                            style={{
                              left: cssX,
                              top: cssY,
                              transform: 'translate(-50%, -50%)',
                            }}
                          />
                        );
                      })()}
                      {/* Zoom level, point count, line count, and text label count overlay */}
                      <div className="absolute bottom-2 left-2 text-xs text-gray-500 font-mono pointer-events-none">
                        {previewZoom !== 1 && <span className="text-cyan-400">{previewZoom.toFixed(1)}x · </span>}
                        {previewPoints.length.toLocaleString()} pts
                        {floorPlanLines.length > 0 && <span className="text-green-400"> · {floorPlanLines.length} lines</span>}
                        {floorPlanTextLabels.length > 0 && <span className="text-amber-400"> · {floorPlanTextLabels.length} labels</span>}
                      </div>
                    </div>
                    
                    {/* Bottom controls - Thickness, Point Size, and Rotation */}
                    <div className="flex flex-col gap-2 p-2 bg-gray-800/50 border-t border-gray-700/50">
                      <div className="flex items-center gap-4">
                        {/* Thickness control */}
                        <div className="flex items-center gap-2 flex-1">
                          <label className="text-gray-400 text-xs whitespace-nowrap">Thickness:</label>
                          <input
                            type="range"
                            min="2"
                            max="24"
                            step="1"
                            value={sliceBoxConfig.thicknessInches}
                            onChange={(e) => {
                              const thickness = parseInt(e.target.value);
                              setSliceBoxConfig(prev => prev ? { ...prev, thicknessInches: thickness } : null);
                            }}
                            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                          />
                          <span className="text-cyan-400 text-xs font-mono w-6 text-right">{sliceBoxConfig.thicknessInches}"</span>
                        </div>
                        {/* Point Size control */}
                        <div className="flex items-center gap-2 flex-1">
                          <label className="text-gray-400 text-xs whitespace-nowrap">Point Size:</label>
                          <input
                            type="range"
                            min="0.5"
                            max="5"
                            step="0.5"
                            value={previewPointSize}
                            onChange={(e) => setPreviewPointSize(parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                          />
                          <span className="text-cyan-400 text-xs font-mono w-10 text-right">{previewPointSize.toFixed(1)} px</span>
                        </div>
                      </div>
                      {/* Rotation control */}
                      <div className="flex items-center gap-2">
                        <label className="text-gray-400 text-xs whitespace-nowrap">Rotation:</label>
                        <input
                          type="range"
                          min="0"
                          max="360"
                          step="1"
                          value={drawingRotation}
                          onChange={(e) => setDrawingRotation(parseInt(e.target.value))}
                          className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                        <span className="text-cyan-400 text-xs font-mono w-8 text-right">{drawingRotation}°</span>
                        <button
                          onClick={() => setDrawingRotation(0)}
                          className="px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                          title="Reset rotation"
                        >
                          Reset
                        </button>
                      </div>
                      {/* Text Size control */}
                      <div className="flex items-center gap-2">
                        <label className="text-gray-400 text-xs whitespace-nowrap">Text Size:</label>
                        <input
                          type="range"
                          min="1"
                          max="24"
                          step="1"
                          value={measurementTextSize}
                          onChange={(e) => setMeasurementTextSize(parseInt(e.target.value))}
                          className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                        <span className="text-cyan-400 text-xs font-mono w-8 text-right">{measurementTextSize}px</span>
                      </div>
                      {/* Line Thickness control */}
                      <div className="flex items-center gap-2">
                        <label className="text-gray-400 text-xs whitespace-nowrap">Line Thickness:</label>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="1"
                          value={lineThickness}
                          onChange={(e) => setLineThickness(parseInt(e.target.value))}
                          className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                        <span className="text-cyan-400 text-xs font-mono w-8 text-right">{lineThickness}px</span>
                      </div>
                      {/* Dimension Lines control */}
                      <div className="flex items-center gap-2">
                        <label className="text-gray-400 text-xs whitespace-nowrap">Dimension Lines:</label>
                        <input
                          type="range"
                          min="0.5"
                          max="3"
                          step="0.1"
                          value={dimensionLineScale}
                          onChange={(e) => setDimensionLineScale(parseFloat(e.target.value))}
                          className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                        />
                        <span className="text-cyan-400 text-xs font-mono w-8 text-right">{dimensionLineScale}x</span>
                      </div>
                      {/* Sheet Title control */}
                      <div className="flex items-center gap-2">
                        <label className="text-gray-400 text-xs whitespace-nowrap">Sheet Title:</label>
                        <input
                          type="text"
                          value={sheetTitle}
                          onChange={(e) => setSheetTitle(e.target.value)}
                          placeholder="Enter title for PDF"
                          className="flex-1 px-2 py-0.5 text-xs bg-gray-700 text-white rounded border border-gray-600 focus:border-cyan-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </Rnd>
            )}

        </>
      )}

      {/* Point cloud specific toolbar and panels */}
      {contentType === 'pointcloud' && (
        <>
          {/* Point Cloud Toolbar */}
          <div className="absolute top-4 right-4 flex gap-2">
            <button
              onClick={() => {
                console.log('[Point Cloud] Settings button clicked');
                setShowPointCloudSettings(!showPointCloudSettings);
              }}
              className={`px-4 py-2 backdrop-blur-sm border border-gray-700/50 text-white text-sm font-semibold rounded-md transition-colors pointer-events-auto flex items-center gap-2 ${
                showPointCloudSettings ? 'bg-cyan-600 hover:bg-cyan-700' : 'bg-gray-800/80 hover:bg-gray-700'
              }`}
            >
              <SettingsIcon className="h-4 w-4" />
              Settings
            </button>
            <button
              onClick={() => {
                console.log('[Analysis Tools] Analysis button clicked');
                setShowAnalysisTools(!showAnalysisTools);
              }}
              className={`px-4 py-2 backdrop-blur-sm border border-gray-700/50 text-white text-sm font-semibold rounded-md transition-colors pointer-events-auto flex items-center gap-2 ${
                showAnalysisTools ? 'bg-cyan-600 hover:bg-cyan-700' : 'bg-gray-800/80 hover:bg-gray-700'
              }`}
            >
              Analysis
            </button>
          </div>

          {/* Point Cloud Settings Panel */}
          {showPointCloudSettings && (
            <PointCloudSettingsPanel
              pointSize={pointSize}
              onPointSizeChange={setPointSize}
              pointBudget={pointBudget}
              onPointBudgetChange={setPointBudget}
              colorMode={colorMode}
              onColorModeChange={(mode) => setColorMode(mode as typeof colorMode)}
              visiblePointCount={visiblePointCount}
              onClose={() => setShowPointCloudSettings(false)}
            />
          )}

          {/* Analysis Tools Panel */}
          {showAnalysisTools && (
            <AnalysisToolsPanel
              onGenerateFloorPlan={handleGenerateFloorPlan}
              onDetectStructure={handleDetectStructure}
              onAnalyzeLoadBearing={handleAnalyzeLoadBearing}
              isProcessing={isProcessing}
              activeFeature={activeFeature}
            />
          )}

          {/* Floor Plan Results Panel */}
          {showFloorPlanResults && (
            <FloorPlanResultsPanel
              svgContent={floorPlanSVG}
              wallCount={floorPlanData?.metadata.wallCount ?? 0}
              totalArea={floorPlanData ? calculateFloorPlanStats(floorPlanData).boundingAreaSqFt : 0}
              layers={floorPlanLayers}
              onLayerToggle={handleLayerToggle}
              onExport={handleExport}
              onClose={() => setShowFloorPlanResults(false)}
            />
          )}
        </>
      )}

      {(!modelLoaded && !isLoading && contentType === 'none') && (
        <div className="absolute inset-0 bg-gray-900 border-2 border-dashed border-gray-700 rounded-lg flex flex-col justify-center items-center pointer-events-none">
          <div className="text-center p-8">
            <CubeIcon />
            <h2 className="mt-4 text-xl font-semibold text-gray-400">3D Viewer</h2>
            <p className="mt-1 text-sm text-gray-500">Upload a GLB model to get started</p>
            <div className="mt-6 flex gap-3 justify-center">
              <button
                onClick={handleUploadClick}
                className="px-4 py-2 bg-cyan-600 text-white font-semibold rounded-md hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 transition-colors pointer-events-auto"
              >
                Upload GLB
              </button>
            </div>
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