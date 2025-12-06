/**
 * Floor Plan Generator
 * 
 * Generates 2D floor plans from 3D point cloud data.
 * Extracts points from THREE.Scene, slices using SliceBoxConfig,
 * and projects to 2D for wall detection.
 */

import * as THREE from 'three';
import { SliceBoxConfig } from '../types';

// ============================================================================
// Types
// ============================================================================

/**
 * 2D point representation
 */
export interface Point2D {
  x: number;
  y: number;
}

/**
 * 3D point representation
 */
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

/**
 * Wall segment detected in floor plan
 */
export interface WallSegment {
  start: Point2D;
  end: Point2D;
  lengthFeet: number;
  thickness: number;
}

/**
 * Bounding box for floor plan data
 */
export interface FloorPlanBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Metadata about generated floor plan
 */
export interface FloorPlanMetadata {
  pointCount: number;
  wallCount: number;
  generatedAt: string;
  sliceHeight?: number;
  sliceThickness?: number;
}

/**
 * Complete floor plan data structure
 */
export interface FloorPlanData {
  walls: WallSegment[];
  bounds: FloorPlanBounds;
  points2D: Point2D[];
  metadata: FloorPlanMetadata;
}

/**
 * Slice mode for extracting 2D data from 3D
 */
export type SliceMode = 'horizontal' | 'vertical';

/**
 * Configuration for floor plan generation
 */
export interface FloorPlanConfig {
  sliceHeight?: number;
  sliceThickness?: number;
  wallMinLength?: number;
  wallMaxGap?: number;
  sliceMode?: SliceMode;
}

// ============================================================================
// Point Extraction
// ============================================================================

/**
 * Extract 3D points from a THREE.Scene
 * Traverses all meshes and extracts vertex positions from their geometries.
 * 
 * @param scene - THREE.Scene containing model geometry
 * @returns Array of 3D points extracted from the scene
 */
export function extractPointsFromGLB(scene: THREE.Scene): Point3D[] {
  const points: Point3D[] = [];
  
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.geometry) {
      const geometry = object.geometry;
      const positionAttribute = geometry.getAttribute('position');
      
      if (positionAttribute) {
        // Get the world matrix to transform local vertices to world coordinates
        object.updateMatrixWorld(true);
        const worldMatrix = object.matrixWorld;
        const vertex = new THREE.Vector3();
        
        for (let i = 0; i < positionAttribute.count; i++) {
          vertex.fromBufferAttribute(positionAttribute, i);
          vertex.applyMatrix4(worldMatrix);
          
          points.push({
            x: vertex.x,
            y: vertex.y,
            z: vertex.z
          });
        }
      }
    }
    
    // Also handle Points objects (point clouds)
    if (object instanceof THREE.Points && object.geometry) {
      const geometry = object.geometry;
      const positionAttribute = geometry.getAttribute('position');
      
      if (positionAttribute) {
        object.updateMatrixWorld(true);
        const worldMatrix = object.matrixWorld;
        const vertex = new THREE.Vector3();
        
        for (let i = 0; i < positionAttribute.count; i++) {
          vertex.fromBufferAttribute(positionAttribute, i);
          vertex.applyMatrix4(worldMatrix);
          
          points.push({
            x: vertex.x,
            y: vertex.y,
            z: vertex.z
          });
        }
      }
    }
  });
  
  return points;
}

// ============================================================================
// Slice and Project
// ============================================================================

/**
 * Slice 3D points using a SliceBoxConfig and project to 2D
 * 
 * @param points3D - Array of 3D points
 * @param sliceBoxConfig - Configuration defining the slice box position, size, and rotation
 * @param scaleFactor - Scale factor for converting model units
 * @param mode - Slice mode (horizontal or vertical)
 * @returns Array of 2D points from the slice
 */
export function sliceAndProject(
  points3D: Point3D[],
  sliceBoxConfig: SliceBoxConfig,
  scaleFactor: number,
  mode: SliceMode = 'horizontal'
): Point2D[] {
  const points2D: Point2D[] = [];
  
  const { center, halfExtents, rotation, thicknessInches } = sliceBoxConfig;
  
  // Convert thickness from inches to view/scene units
  // thicknessInches -> feet -> scaled view units (same as model coordinates)
  const thicknessFeet = thicknessInches / 12;
  const thicknessScaled = thicknessFeet * scaleFactor;
  const halfThickness = thicknessScaled / 2;
  
  // Create rotation matrix from Euler angles
  const euler = new THREE.Euler(rotation.x, rotation.y, rotation.z);
  const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(euler);
  const inverseRotation = rotationMatrix.clone().invert();
  
  // Center point as Vector3
  const centerVec = new THREE.Vector3(center.x, center.y, center.z);
  
  for (const point of points3D) {
    // Transform point to slice box local coordinates
    const localPoint = new THREE.Vector3(point.x, point.y, point.z)
      .sub(centerVec)
      .applyMatrix4(inverseRotation);
    
    // Check if point is within slice box bounds
    const inXBounds = Math.abs(localPoint.x) <= halfExtents.x;
    const inZBounds = Math.abs(localPoint.z) <= halfExtents.z;
    
    // Check height based on mode
    let inYBounds = false;
    if (mode === 'horizontal') {
      // For horizontal slice, check Y (vertical) within thickness
      inYBounds = Math.abs(localPoint.y) <= halfThickness;
    } else {
      // For vertical slice, use full height extent (halfExtents.y may be 0, use halfThickness as fallback)
      const yExtent = halfExtents.y > 0 ? halfExtents.y : halfThickness;
      inYBounds = Math.abs(localPoint.y) <= yExtent;
    }
    
    if (inXBounds && inYBounds && inZBounds) {
      // Project to 2D based on mode
      if (mode === 'horizontal') {
        // Project to XZ plane (top-down view)
        points2D.push({ x: localPoint.x, y: localPoint.z });
      } else {
        // Project to XY plane (front view)
        points2D.push({ x: localPoint.x, y: localPoint.y });
      }
    }
  }
  
  return points2D;
}

// ============================================================================
// Wall Detection
// ============================================================================

/**
 * Calculate distance between two 2D points
 */
function distance2D(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate bounds from an array of 2D points
 */
function calculateBounds(points: Point2D[]): FloorPlanBounds {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY
  };
}

/**
 * Detect wall segments from 2D points
 * Uses a simplified line detection approach
 * 
 * @param points2D - Array of 2D points
 * @param minLength - Minimum wall length to detect (in model units)
 * @param maxGap - Maximum gap between points to consider continuous
 * @returns Array of detected wall segments
 */
function detectWalls(
  points2D: Point2D[],
  minLength: number = 1.0,
  maxGap: number = 0.5
): WallSegment[] {
  if (points2D.length < 2) {
    return [];
  }

  const walls: WallSegment[] = [];
  
  // TODO: Implement proper wall detection algorithm
  // This is a simplified placeholder that creates walls from point clusters
  // A real implementation would use:
  // - RANSAC for line fitting
  // - Hough transform for line detection
  // - Alpha shapes for boundary detection
  
  console.warn('[FloorPlanGenerator] detectWalls is using simplified stub implementation');
  
  // Simple placeholder: create walls from consecutive point pairs
  // In reality, this needs proper clustering and line fitting
  const sortedPoints = [...points2D].sort((a, b) => a.x - b.x || a.y - b.y);
  
  for (let i = 0; i < sortedPoints.length - 1; i++) {
    const start = sortedPoints[i];
    const end = sortedPoints[i + 1];
    const dist = distance2D(start, end);
    
    // Only create wall if points are within maxGap and form a reasonable segment
    if (dist <= maxGap && dist >= minLength / 10) {
      const lengthFeet = dist * 3.28084; // Convert meters to feet (assuming model units are meters)
      
      walls.push({
        start,
        end,
        lengthFeet,
        thickness: 0.5 // Default wall thickness in feet
      });
    }
  }

  return walls;
}

// ============================================================================
// Main Generator
// ============================================================================

/**
 * Generate a floor plan from 2D points
 * 
 * @param points2D - Array of 2D points (already sliced and projected)
 * @param config - Configuration options
 * @returns Complete floor plan data
 */
export function generateFloorPlan(
  points2D: Point2D[],
  config: FloorPlanConfig = {}
): FloorPlanData {
  const {
    wallMinLength = 1.0,
    wallMaxGap = 0.5
  } = config;

  // Calculate bounds
  const bounds = calculateBounds(points2D);

  // Detect walls
  const walls = detectWalls(points2D, wallMinLength, wallMaxGap);

  // Build metadata
  const metadata: FloorPlanMetadata = {
    pointCount: points2D.length,
    wallCount: walls.length,
    generatedAt: new Date().toISOString(),
    sliceHeight: config.sliceHeight,
    sliceThickness: config.sliceThickness
  };

  return {
    walls,
    bounds,
    points2D,
    metadata
  };
}

