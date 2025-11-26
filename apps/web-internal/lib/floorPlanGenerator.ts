/**
 * Floor Plan Generator - Core Algorithm
 * 
 * Extracts wall geometry from a GLB point cloud within a slice box,
 * using DBSCAN clustering and PCA line fitting.
 */

import * as THREE from 'three';
import { SliceBoxConfig } from '../types';

// ============================================================================
// Types
// ============================================================================

export interface Point2D {
  x: number;
  y: number;
}

export interface WallSegment {
  start: Point2D;
  end: Point2D;
  thickness: number;
  lengthFeet: number;
}

export interface FloorPlanData {
  walls: WallSegment[];
  points2D: Point2D[];
  bounds: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    width: number;
    height: number;
  };
  metadata: {
    pointCount: number;
    wallCount: number;
    generatedAt: string;
    sliceThicknessInches: number;
  };
}

export interface WallDetectionConfig {
  /** RANSAC inlier distance threshold (in scaled view units) */
  distanceThreshold: number;
  /** Minimum wall length to keep (in feet) */
  minWallLengthFeet: number;
  /** Maximum number of walls to detect */
  maxWalls: number;
  /** Number of RANSAC iterations per wall */
  ransacIterations: number;
  /** Minimum points required to form a wall */
  minPoints: number;
  /** Whether to use RANSAC (true) or adaptive DBSCAN (false) */
  useRANSAC: boolean;
  /** DBSCAN epsilon (clustering radius) - only used when useRANSAC is false */
  dbscanEps?: number;
  /** DBSCAN minimum points - only used when useRANSAC is false */
  dbscanMinPoints?: number;
  /** Corner snap threshold in feet */
  snapThresholdFeet?: number;
  /** Wall merge angle tolerance in radians */
  mergeAngleTolerance?: number;
  /** Wall merge distance tolerance in feet */
  mergeDistanceTolerance?: number;
}

/** Default wall detection configuration */
export const DEFAULT_WALL_DETECTION_CONFIG: WallDetectionConfig = {
  distanceThreshold: 0.005,
  minWallLengthFeet: 2.0,
  maxWalls: 50,
  ransacIterations: 200,
  minPoints: 30,
  useRANSAC: true,
  dbscanEps: 0.008,
  dbscanMinPoints: 20,
  snapThresholdFeet: 1.0,
  mergeAngleTolerance: 0.1,
  mergeDistanceTolerance: 0.5,
};

// ============================================================================
// Point Extraction
// ============================================================================

/**
 * Extract all vertices from a THREE.Scene
 * Works with Points (point clouds) and Mesh geometries
 */
export function extractPointsFromGLB(scene: THREE.Scene): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  
  scene.traverse((object) => {
    // Handle Points (point cloud)
    if (object instanceof THREE.Points) {
      const geometry = object.geometry;
      const positionAttr = geometry.getAttribute('position');
      
      if (positionAttr) {
        for (let i = 0; i < positionAttr.count; i++) {
          const vertex = new THREE.Vector3(
            positionAttr.getX(i),
            positionAttr.getY(i),
            positionAttr.getZ(i)
          );
          // Apply object's world transform
          vertex.applyMatrix4(object.matrixWorld);
          points.push(vertex);
        }
      }
    }
    
    // Handle Mesh (triangulated geometry)
    if (object instanceof THREE.Mesh) {
      const geometry = object.geometry;
      const positionAttr = geometry.getAttribute('position');
      
      if (positionAttr) {
        for (let i = 0; i < positionAttr.count; i++) {
          const vertex = new THREE.Vector3(
            positionAttr.getX(i),
            positionAttr.getY(i),
            positionAttr.getZ(i)
          );
          // Apply object's world transform
          vertex.applyMatrix4(object.matrixWorld);
          points.push(vertex);
        }
      }
    }
  });
  
  console.log(`[Floor Plan] Extracted ${points.length} vertices from scene`);
  return points;
}

// ============================================================================
// Slice and Project
// ============================================================================

/**
 * Filter points within slice box bounds and project to 2D (X,Z plane)
 * Y is vertical (height), X and Z are the floor plane
 */
export function sliceAndProject(
  points: THREE.Vector3[],
  sliceConfig: SliceBoxConfig,
  scaleFactor: number
): Point2D[] {
  const result: Point2D[] = [];
  
  // Calculate slice bounds
  const thicknessFeet = sliceConfig.thicknessInches / 12;
  const scaledThickness = thicknessFeet * scaleFactor;
  const halfThickness = scaledThickness / 2;
  
  // Slice box center and extents
  const center = sliceConfig.center;
  const halfExtents = sliceConfig.halfExtents;
  
  // Create rotation matrix for the slice box
  const rotationMatrix = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(sliceConfig.rotation.x, sliceConfig.rotation.y, sliceConfig.rotation.z)
  );
  const inverseRotation = rotationMatrix.clone().invert();
  
  for (const point of points) {
    // Transform point to slice box local space
    const localPoint = point.clone().sub(new THREE.Vector3(center.x, center.y, center.z));
    localPoint.applyMatrix4(inverseRotation);
    
    // Check if point is within slice box bounds
    // X and Z extents define the horizontal bounds
    // Y (height) is determined by slice thickness
    const inX = Math.abs(localPoint.x) <= halfExtents.x;
    const inZ = Math.abs(localPoint.z) <= halfExtents.z;
    const inY = Math.abs(localPoint.y) <= halfThickness;
    
    if (inX && inZ && inY) {
      // Project to 2D: use X and Z as the floor plane
      // Rotate back to world space for consistent output
      const worldPoint = localPoint.clone();
      worldPoint.applyMatrix4(rotationMatrix);
      
      result.push({
        x: worldPoint.x,
        y: worldPoint.z  // Z becomes Y in 2D floor plan
      });
    }
  }
  
  console.log(`[Floor Plan] Sliced ${result.length} points from ${points.length} total (${((result.length / points.length) * 100).toFixed(1)}%)`);
  return result;
}

// ============================================================================
// DBSCAN Clustering
// ============================================================================

/**
 * Spatial grid for efficient neighbor queries
 */
class SpatialGrid {
  private grid: Map<string, Point2D[]> = new Map();
  private cellSize: number;
  
  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }
  
  private getKey(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    return `${cx},${cy}`;
  }
  
  insert(point: Point2D): void {
    const key = this.getKey(point.x, point.y);
    if (!this.grid.has(key)) {
      this.grid.set(key, []);
    }
    this.grid.get(key)!.push(point);
  }
  
  getNeighbors(point: Point2D, eps: number): Point2D[] {
    const neighbors: Point2D[] = [];
    const cx = Math.floor(point.x / this.cellSize);
    const cy = Math.floor(point.y / this.cellSize);
    const cellRadius = Math.ceil(eps / this.cellSize);
    
    // Check neighboring cells
    for (let dx = -cellRadius; dx <= cellRadius; dx++) {
      for (let dy = -cellRadius; dy <= cellRadius; dy++) {
        const key = `${cx + dx},${cy + dy}`;
        const cell = this.grid.get(key);
        if (cell) {
          for (const p of cell) {
            const dist = Math.sqrt((p.x - point.x) ** 2 + (p.y - point.y) ** 2);
            if (dist <= eps) {
              neighbors.push(p);
            }
          }
        }
      }
    }
    
    return neighbors;
  }
}

/**
 * DBSCAN clustering algorithm with spatial grid index
 * Groups nearby points into clusters representing walls
 */
export function dbscanCluster(
  points: Point2D[],
  eps: number = 0.008,
  minPoints: number = 20
): Point2D[][] {
  if (points.length === 0) return [];
  
  // Build spatial index
  const grid = new SpatialGrid(eps);
  for (const point of points) {
    grid.insert(point);
  }
  
  const clusters: Point2D[][] = [];
  const visited = new Set<number>();
  const clustered = new Set<number>();
  
  // Create point index for fast lookup
  const pointIndex = new Map<string, number>();
  points.forEach((p, i) => {
    pointIndex.set(`${p.x},${p.y}`, i);
  });
  
  for (let i = 0; i < points.length; i++) {
    if (visited.has(i)) continue;
    visited.add(i);
    
    const point = points[i];
    const neighbors = grid.getNeighbors(point, eps);
    
    if (neighbors.length < minPoints) {
      // Mark as noise (not enough neighbors)
      continue;
    }
    
    // Start new cluster
    const cluster: Point2D[] = [point];
    clustered.add(i);
    
    // Expand cluster
    const queue = [...neighbors];
    const queued = new Set(neighbors.map(n => pointIndex.get(`${n.x},${n.y}`)!));
    
    while (queue.length > 0) {
      const neighbor = queue.shift()!;
      const neighborIdx = pointIndex.get(`${neighbor.x},${neighbor.y}`)!;
      
      if (!visited.has(neighborIdx)) {
        visited.add(neighborIdx);
        
        const neighborNeighbors = grid.getNeighbors(neighbor, eps);
        if (neighborNeighbors.length >= minPoints) {
          // Add new neighbors to queue
          for (const nn of neighborNeighbors) {
            const nnIdx = pointIndex.get(`${nn.x},${nn.y}`)!;
            if (!queued.has(nnIdx)) {
              queue.push(nn);
              queued.add(nnIdx);
            }
          }
        }
      }
      
      if (!clustered.has(neighborIdx)) {
        cluster.push(neighbor);
        clustered.add(neighborIdx);
      }
    }
    
    clusters.push(cluster);
  }
  
  console.log(`[Floor Plan] DBSCAN found ${clusters.length} clusters from ${points.length} points`);
  return clusters;
}

// ============================================================================
// PCA Line Fitting
// ============================================================================

/**
 * Fit a line to a cluster of points using PCA
 * Returns the wall segment with length in feet
 */
export function fitLineToCluster(
  cluster: Point2D[],
  scaleFactor: number
): WallSegment | null {
  if (cluster.length < 2) return null;
  
  // Calculate centroid
  let meanX = 0, meanY = 0;
  for (const p of cluster) {
    meanX += p.x;
    meanY += p.y;
  }
  meanX /= cluster.length;
  meanY /= cluster.length;
  
  // Build covariance matrix
  let cxx = 0, cyy = 0, cxy = 0;
  for (const p of cluster) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  cxx /= cluster.length;
  cyy /= cluster.length;
  cxy /= cluster.length;
  
  // Find eigenvector of largest eigenvalue (principal direction)
  // For 2x2 matrix: eigenvalues = (trace ± sqrt(trace² - 4*det)) / 2
  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const discriminant = trace * trace - 4 * det;
  
  if (discriminant < 0) return null;
  
  const lambda1 = (trace + Math.sqrt(discriminant)) / 2;
  
  // Eigenvector for lambda1
  let dirX: number, dirY: number;
  if (Math.abs(cxy) > 1e-10) {
    dirX = lambda1 - cyy;
    dirY = cxy;
  } else if (cxx >= cyy) {
    dirX = 1;
    dirY = 0;
  } else {
    dirX = 0;
    dirY = 1;
  }
  
  // Normalize direction
  const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
  if (dirLen < 1e-10) return null;
  dirX /= dirLen;
  dirY /= dirLen;
  
  // Project all points onto the line to find start and end
  let minProj = Infinity, maxProj = -Infinity;
  for (const p of cluster) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    const proj = dx * dirX + dy * dirY;
    minProj = Math.min(minProj, proj);
    maxProj = Math.max(maxProj, proj);
  }
  
  // Calculate wall endpoints
  const start: Point2D = {
    x: meanX + dirX * minProj,
    y: meanY + dirY * minProj
  };
  const end: Point2D = {
    x: meanX + dirX * maxProj,
    y: meanY + dirY * maxProj
  };
  
  // Calculate length in view units, then convert to feet
  const lengthViewUnits = Math.sqrt(
    (end.x - start.x) ** 2 + (end.y - start.y) ** 2
  );
  const lengthFeet = lengthViewUnits / scaleFactor;
  
  // Filter out walls shorter than 1 foot (noise)
  if (lengthFeet < 1.0) {
    return null;
  }
  
  // Estimate wall thickness from point spread perpendicular to line
  let maxPerpDist = 0;
  for (const p of cluster) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    const perpDist = Math.abs(-dirY * dx + dirX * dy);
    maxPerpDist = Math.max(maxPerpDist, perpDist);
  }
  const thicknessFeet = (maxPerpDist * 2) / scaleFactor;
  
  return {
    start,
    end,
    thickness: thicknessFeet,
    lengthFeet
  };
}

// ============================================================================
// Wall Merging
// ============================================================================

/**
 * Merge collinear walls that are close together
 */
export function mergeCollinearWalls(
  walls: WallSegment[],
  angleTolerance: number = 0.1,  // radians (~5.7 degrees)
  distanceTolerance: number = 0.5  // feet
): WallSegment[] {
  if (walls.length <= 1) return walls;
  
  const result: WallSegment[] = [];
  const merged = new Set<number>();
  
  for (let i = 0; i < walls.length; i++) {
    if (merged.has(i)) continue;
    
    let current = walls[i];
    let didMerge = true;
    
    while (didMerge) {
      didMerge = false;
      
      for (let j = 0; j < walls.length; j++) {
        if (i === j || merged.has(j)) continue;
        
        const other = walls[j];
        
        // Check if walls are collinear
        const angle1 = Math.atan2(current.end.y - current.start.y, current.end.x - current.start.x);
        const angle2 = Math.atan2(other.end.y - other.start.y, other.end.x - other.start.x);
        
        let angleDiff = Math.abs(angle1 - angle2);
        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
        // Also check for opposite directions (180 degrees apart)
        if (angleDiff > Math.PI / 2) angleDiff = Math.PI - angleDiff;
        
        if (angleDiff > angleTolerance) continue;
        
        // Check if endpoints are close
        const distances = [
          Math.sqrt((current.end.x - other.start.x) ** 2 + (current.end.y - other.start.y) ** 2),
          Math.sqrt((current.end.x - other.end.x) ** 2 + (current.end.y - other.end.y) ** 2),
          Math.sqrt((current.start.x - other.start.x) ** 2 + (current.start.y - other.start.y) ** 2),
          Math.sqrt((current.start.x - other.end.x) ** 2 + (current.start.y - other.end.y) ** 2)
        ];
        
        const minDist = Math.min(...distances);
        if (minDist > distanceTolerance) continue;
        
        // Merge walls - find the two most distant endpoints
        const allPoints = [current.start, current.end, other.start, other.end];
        let maxDist = 0;
        let newStart = current.start;
        let newEnd = current.end;
        
        for (let a = 0; a < allPoints.length; a++) {
          for (let b = a + 1; b < allPoints.length; b++) {
            const dist = Math.sqrt(
              (allPoints[a].x - allPoints[b].x) ** 2 +
              (allPoints[a].y - allPoints[b].y) ** 2
            );
            if (dist > maxDist) {
              maxDist = dist;
              newStart = allPoints[a];
              newEnd = allPoints[b];
            }
          }
        }
        
        current = {
          start: newStart,
          end: newEnd,
          thickness: Math.max(current.thickness, other.thickness),
          lengthFeet: maxDist // Will be recalculated
        };
        
        merged.add(j);
        didMerge = true;
      }
    }
    
    result.push(current);
  }
  
  console.log(`[Floor Plan] Merged ${walls.length} walls into ${result.length}`);
  return result;
}

// ============================================================================
// Corner Detection and Wall Snapping
// ============================================================================

/**
 * Represents a wall endpoint with reference to which wall and which end
 */
interface EndpointRef {
  wallIndex: number;
  isStart: boolean;
  point: Point2D;
}

/**
 * Find groups of wall endpoints that are close together (potential corners)
 * 
 * @param walls - Array of wall segments
 * @param threshold - Maximum distance for endpoints to be considered "close"
 * @returns Array of endpoint clusters, each cluster contains endpoints that should meet
 */
function findNearbyEndpoints(
  walls: WallSegment[],
  threshold: number
): EndpointRef[][] {
  // Collect all endpoints with their references
  const endpoints: EndpointRef[] = [];
  
  for (let i = 0; i < walls.length; i++) {
    endpoints.push({
      wallIndex: i,
      isStart: true,
      point: walls[i].start
    });
    endpoints.push({
      wallIndex: i,
      isStart: false,
      point: walls[i].end
    });
  }
  
  // Group endpoints that are close together using union-find approach
  const parent = endpoints.map((_, i) => i);
  
  function find(x: number): number {
    if (parent[x] !== x) {
      parent[x] = find(parent[x]);
    }
    return parent[x];
  }
  
  function union(x: number, y: number): void {
    const px = find(x);
    const py = find(y);
    if (px !== py) {
      parent[px] = py;
    }
  }
  
  // Find all pairs of close endpoints
  for (let i = 0; i < endpoints.length; i++) {
    for (let j = i + 1; j < endpoints.length; j++) {
      // Skip endpoints from the same wall
      if (endpoints[i].wallIndex === endpoints[j].wallIndex) continue;
      
      const dist = Math.sqrt(
        (endpoints[i].point.x - endpoints[j].point.x) ** 2 +
        (endpoints[i].point.y - endpoints[j].point.y) ** 2
      );
      
      if (dist <= threshold) {
        union(i, j);
      }
    }
  }
  
  // Group endpoints by their root parent
  const groups = new Map<number, EndpointRef[]>();
  
  for (let i = 0; i < endpoints.length; i++) {
    const root = find(i);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root)!.push(endpoints[i]);
  }
  
  // Filter to only return groups with 2+ endpoints from different walls
  const result: EndpointRef[][] = [];
  
  for (const group of groups.values()) {
    // Check if group has endpoints from at least 2 different walls
    const uniqueWalls = new Set(group.map(e => e.wallIndex));
    if (uniqueWalls.size >= 2) {
      result.push(group);
    }
  }
  
  return result;
}

/**
 * Calculate the intersection point of two infinite lines defined by wall segments
 * 
 * @param wall1 - First wall segment
 * @param wall2 - Second wall segment
 * @returns Intersection point, or null if lines are parallel
 */
function calculateLineIntersection(
  wall1: WallSegment,
  wall2: WallSegment
): Point2D | null {
  // Line 1: from wall1.start to wall1.end
  // Parametric form: P1 + t * D1 where D1 = (end1 - start1)
  const d1x = wall1.end.x - wall1.start.x;
  const d1y = wall1.end.y - wall1.start.y;
  
  // Line 2: from wall2.start to wall2.end
  // Parametric form: P2 + s * D2 where D2 = (end2 - start2)
  const d2x = wall2.end.x - wall2.start.x;
  const d2y = wall2.end.y - wall2.start.y;
  
  // Calculate cross product of directions (determinant)
  // If this is ~0, lines are parallel
  const cross = d1x * d2y - d1y * d2x;
  
  if (Math.abs(cross) < 1e-10) {
    // Lines are parallel, no intersection
    return null;
  }
  
  // Solve for intersection using Cramer's rule
  // wall1.start + t * d1 = wall2.start + s * d2
  // Rearranging: t * d1 - s * d2 = wall2.start - wall1.start
  
  const dx = wall2.start.x - wall1.start.x;
  const dy = wall2.start.y - wall1.start.y;
  
  // Solve for t: t = (dx * d2y - dy * d2x) / cross
  const t = (dx * d2y - dy * d2x) / cross;
  
  // Calculate intersection point
  const intersection: Point2D = {
    x: wall1.start.x + t * d1x,
    y: wall1.start.y + t * d1y
  };
  
  return intersection;
}

/**
 * Get the angle of a wall segment in radians
 */
function getWallAngle(wall: WallSegment): number {
  return Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
}

/**
 * Calculate the angle difference between two walls (0 to PI/2 range)
 * Handles opposite directions and wraparound
 */
function getAngleDifference(wall1: WallSegment, wall2: WallSegment): number {
  const angle1 = getWallAngle(wall1);
  const angle2 = getWallAngle(wall2);
  
  let diff = Math.abs(angle1 - angle2);
  
  // Normalize to 0 to PI range
  if (diff > Math.PI) {
    diff = 2 * Math.PI - diff;
  }
  
  // Normalize to 0 to PI/2 range (walls are undirected)
  if (diff > Math.PI / 2) {
    diff = Math.PI - diff;
  }
  
  return diff;
}

/**
 * Project a point onto a line segment and return the closest point on the segment
 * 
 * @param point - The point to project
 * @param wall - The wall segment (line) to project onto
 * @returns The closest point on the wall segment to the given point
 */
function projectPointOntoWall(point: Point2D, wall: WallSegment): Point2D {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lengthSq = dx * dx + dy * dy;
  
  if (lengthSq < 1e-10) {
    // Wall has zero length, return start point
    return { ...wall.start };
  }
  
  // Calculate projection parameter t
  const t = ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / lengthSq;
  
  // Clamp t to [0, 1] to stay on segment
  const tClamped = Math.max(0, Math.min(1, t));
  
  return {
    x: wall.start.x + tClamped * dx,
    y: wall.start.y + tClamped * dy
  };
}

/**
 * Snap wall endpoints to corners where multiple walls meet
 * 
 * This function identifies wall endpoints that are close together (potential corners)
 * and snaps them to common points:
 * - For L-corners (perpendicular walls): calculates the intersection point
 * - For close endpoints: averages positions to a common point
 * - For T-junctions: snaps endpoint to nearest point on intersecting wall
 * 
 * @param walls - Array of wall segments to process
 * @param scaleFactor - Scale factor for converting view units to feet
 * @param snapThresholdFeet - Maximum distance (in feet) for endpoints to be snapped together
 * @returns New array of wall segments with snapped endpoints
 */
export function snapWallsToCorners(
  walls: WallSegment[],
  scaleFactor: number,
  snapThresholdFeet: number = 1.0  // Default 1 foot snap threshold
): WallSegment[] {
  if (walls.length < 2) return walls;
  
  // Convert threshold from feet to view units
  const snapThreshold = snapThresholdFeet * scaleFactor;
  
  // Create mutable copies of walls
  const result: WallSegment[] = walls.map(w => ({
    start: { ...w.start },
    end: { ...w.end },
    thickness: w.thickness,
    lengthFeet: w.lengthFeet
  }));
  
  // Find clusters of nearby endpoints
  const endpointClusters = findNearbyEndpoints(result, snapThreshold);
  
  console.log(`[Floor Plan] Found ${endpointClusters.length} corner clusters to snap`);
  
  // Process each cluster
  for (const cluster of endpointClusters) {
    if (cluster.length < 2) continue;
    
    // Get unique walls in this cluster
    const wallIndices = [...new Set(cluster.map(e => e.wallIndex))];
    
    if (wallIndices.length === 2) {
      // Two walls meeting - check if it's an L-corner or collinear
      const wall1 = result[wallIndices[0]];
      const wall2 = result[wallIndices[1]];
      
      const angleDiff = getAngleDifference(wall1, wall2);
      
      // L-corner: walls are roughly perpendicular (45-90 degrees apart)
      // Use 0.4 radians (~23 degrees) as minimum angle for L-corner
      if (angleDiff > 0.4) {
        // Calculate intersection of the two wall lines
        const intersection = calculateLineIntersection(wall1, wall2);
        
        if (intersection) {
          // Check if intersection is reasonably close to the endpoints
          // (avoid snapping to distant intersections)
          const maxSnapDistance = snapThreshold * 3;
          
          const endpointsToSnap = cluster.map(e => {
            const point = e.isStart ? result[e.wallIndex].start : result[e.wallIndex].end;
            const dist = Math.sqrt(
              (intersection.x - point.x) ** 2 + (intersection.y - point.y) ** 2
            );
            return { ...e, dist };
          });
          
          // Only snap if all endpoints are within reasonable distance
          const allClose = endpointsToSnap.every(e => e.dist <= maxSnapDistance);
          
          if (allClose) {
            // Snap all endpoints in this cluster to the intersection
            for (const ep of cluster) {
              if (ep.isStart) {
                result[ep.wallIndex].start = { ...intersection };
              } else {
                result[ep.wallIndex].end = { ...intersection };
              }
            }
            console.log(`[Floor Plan] Snapped L-corner: walls ${wallIndices[0]}, ${wallIndices[1]} (angle: ${(angleDiff * 180 / Math.PI).toFixed(1)}°)`);
          }
        }
      } else {
        // Nearly collinear walls - average the endpoints
        let sumX = 0, sumY = 0;
        for (const ep of cluster) {
          const point = ep.isStart ? result[ep.wallIndex].start : result[ep.wallIndex].end;
          sumX += point.x;
          sumY += point.y;
        }
        
        const avgPoint: Point2D = {
          x: sumX / cluster.length,
          y: sumY / cluster.length
        };
        
        // Snap all endpoints to average
        for (const ep of cluster) {
          if (ep.isStart) {
            result[ep.wallIndex].start = { ...avgPoint };
          } else {
            result[ep.wallIndex].end = { ...avgPoint };
          }
        }
        console.log(`[Floor Plan] Snapped collinear endpoints: walls ${wallIndices.join(', ')}`);
      }
    } else {
      // More than 2 walls meeting at a corner
      // Find the best common point by averaging or using pairwise intersections
      
      // First, try to find a common intersection point
      let bestIntersection: Point2D | null = null;
      let bestScore = 0;
      
      // Try all pairs of walls and find the intersection closest to all endpoints
      for (let i = 0; i < wallIndices.length; i++) {
        for (let j = i + 1; j < wallIndices.length; j++) {
          const wall1 = result[wallIndices[i]];
          const wall2 = result[wallIndices[j]];
          
          // Only consider non-collinear pairs
          const angleDiff = getAngleDifference(wall1, wall2);
          if (angleDiff < 0.4) continue;
          
          const intersection = calculateLineIntersection(wall1, wall2);
          if (!intersection) continue;
          
          // Score this intersection by how close it is to all endpoints
          let totalDist = 0;
          for (const ep of cluster) {
            const point = ep.isStart ? result[ep.wallIndex].start : result[ep.wallIndex].end;
            totalDist += Math.sqrt(
              (intersection.x - point.x) ** 2 + (intersection.y - point.y) ** 2
            );
          }
          
          const avgDist = totalDist / cluster.length;
          const score = 1 / (avgDist + 0.001);  // Higher score = closer to endpoints
          
          if (score > bestScore && avgDist <= snapThreshold * 3) {
            bestScore = score;
            bestIntersection = intersection;
          }
        }
      }
      
      if (bestIntersection) {
        // Snap all endpoints to the best intersection
        for (const ep of cluster) {
          if (ep.isStart) {
            result[ep.wallIndex].start = { ...bestIntersection };
          } else {
            result[ep.wallIndex].end = { ...bestIntersection };
          }
        }
        console.log(`[Floor Plan] Snapped multi-wall corner: ${wallIndices.length} walls at intersection`);
      } else {
        // Fall back to averaging all endpoints
        let sumX = 0, sumY = 0;
        for (const ep of cluster) {
          const point = ep.isStart ? result[ep.wallIndex].start : result[ep.wallIndex].end;
          sumX += point.x;
          sumY += point.y;
        }
        
        const avgPoint: Point2D = {
          x: sumX / cluster.length,
          y: sumY / cluster.length
        };
        
        for (const ep of cluster) {
          if (ep.isStart) {
            result[ep.wallIndex].start = { ...avgPoint };
          } else {
            result[ep.wallIndex].end = { ...avgPoint };
          }
        }
        console.log(`[Floor Plan] Snapped multi-wall corner: ${wallIndices.length} walls at average point`);
      }
    }
  }
  
  // Recalculate wall lengths after snapping
  for (const wall of result) {
    const lengthViewUnits = Math.sqrt(
      (wall.end.x - wall.start.x) ** 2 + (wall.end.y - wall.start.y) ** 2
    );
    wall.lengthFeet = lengthViewUnits / scaleFactor;
  }
  
  console.log(`[Floor Plan] Corner snapping complete: processed ${endpointClusters.length} corners`);
  
  return result;
}

// ============================================================================
// RANSAC Line Detection
// ============================================================================

interface RansacLineResult {
  /** Line equation coefficients: ax + by + c = 0 (normalized) */
  line: { a: number; b: number; c: number };
  /** Points that lie within the distance threshold of the line */
  inliers: Point2D[];
  /** Points that are outside the distance threshold */
  outliers: Point2D[];
}

/**
 * Find a single best-fit line using RANSAC (Random Sample Consensus)
 * 
 * @param points - Array of 2D points to fit
 * @param threshold - Maximum distance from line for a point to be considered an inlier
 * @param iterations - Number of random samples to try
 * @returns The best line found with its inliers and outliers
 */
function ransacLine(
  points: Point2D[],
  threshold: number,
  iterations: number
): RansacLineResult {
  if (points.length < 2) {
    return {
      line: { a: 0, b: 0, c: 0 },
      inliers: [],
      outliers: [...points]
    };
  }
  
  let bestInliers: Point2D[] = [];
  let bestOutliers: Point2D[] = [...points];
  let bestLine = { a: 0, b: 0, c: 0 };
  
  for (let iter = 0; iter < iterations; iter++) {
    // Pick 2 random distinct points
    const idx1 = Math.floor(Math.random() * points.length);
    let idx2 = Math.floor(Math.random() * points.length);
    
    // Ensure we pick different points
    let attempts = 0;
    while (idx2 === idx1 && attempts < 10) {
      idx2 = Math.floor(Math.random() * points.length);
      attempts++;
    }
    if (idx2 === idx1) continue;
    
    const p1 = points[idx1];
    const p2 = points[idx2];
    
    // Calculate line equation: ax + by + c = 0
    // From two points: (y2-y1)x + (x1-x2)y + (x2*y1 - x1*y2) = 0
    const a = p2.y - p1.y;
    const b = p1.x - p2.x;
    const c = p2.x * p1.y - p1.x * p2.y;
    
    // Normalize the line equation
    const norm = Math.sqrt(a * a + b * b);
    if (norm < 1e-10) continue;
    
    const normA = a / norm;
    const normB = b / norm;
    const normC = c / norm;
    
    // Count inliers - points within threshold distance from the line
    const inliers: Point2D[] = [];
    const outliers: Point2D[] = [];
    
    for (const p of points) {
      // Distance from point to line: |ax + by + c| / sqrt(a² + b²)
      // Since we normalized, sqrt(a² + b²) = 1
      const dist = Math.abs(normA * p.x + normB * p.y + normC);
      
      if (dist <= threshold) {
        inliers.push(p);
      } else {
        outliers.push(p);
      }
    }
    
    // Keep the line with the most inliers
    if (inliers.length > bestInliers.length) {
      bestInliers = inliers;
      bestOutliers = outliers;
      bestLine = { a: normA, b: normB, c: normC };
    }
  }
  
  return {
    line: bestLine,
    inliers: bestInliers,
    outliers: bestOutliers
  };
}

/**
 * Detect multiple walls using iterative RANSAC
 * 
 * Repeatedly finds the best-fit line, extracts inliers as a wall,
 * and continues with remaining points until stopping criteria are met.
 * 
 * @param points - Array of 2D points from the slice
 * @param scaleFactor - Scale factor to convert view units to feet
 * @param config - Wall detection configuration
 * @returns Array of detected wall segments
 */
export function detectWallsRANSAC(
  points: Point2D[],
  scaleFactor: number,
  config: WallDetectionConfig = DEFAULT_WALL_DETECTION_CONFIG
): WallSegment[] {
  const walls: WallSegment[] = [];
  let remainingPoints = [...points];
  
  console.log(`[Floor Plan] Starting RANSAC wall detection with ${points.length} points`);
  console.log(`[Floor Plan] Config: threshold=${config.distanceThreshold}, minPoints=${config.minPoints}, maxWalls=${config.maxWalls}`);
  
  while (remainingPoints.length >= config.minPoints && walls.length < config.maxWalls) {
    // Find the best line in remaining points
    const { inliers, outliers } = ransacLine(
      remainingPoints,
      config.distanceThreshold,
      config.ransacIterations
    );
    
    // Check if we found enough inliers to form a wall
    if (inliers.length < config.minPoints) {
      console.log(`[Floor Plan] RANSAC stopped: only ${inliers.length} inliers (need ${config.minPoints})`);
      break;
    }
    
    // Fit a wall segment to the inliers using PCA (more accurate endpoints)
    const wall = fitLineToCluster(inliers, scaleFactor);
    
    if (wall) {
      // Check minimum wall length
      if (wall.lengthFeet >= config.minWallLengthFeet) {
        walls.push(wall);
        console.log(`[Floor Plan] RANSAC found wall #${walls.length}: ${wall.lengthFeet.toFixed(2)}' (${inliers.length} points)`);
      } else {
        console.log(`[Floor Plan] RANSAC skipped short wall: ${wall.lengthFeet.toFixed(2)}' < ${config.minWallLengthFeet}'`);
      }
    }
    
    // Continue with outliers
    remainingPoints = outliers;
  }
  
  console.log(`[Floor Plan] RANSAC detected ${walls.length} walls, ${remainingPoints.length} points remaining`);
  return walls;
}

// ============================================================================
// Cluster Splitting for Corners
// ============================================================================

/**
 * Calculate the dominant angle of a set of points using PCA
 * Returns angle in radians [-PI/2, PI/2]
 */
function getSegmentAngle(points: Point2D[]): number {
  if (points.length < 2) return 0;
  
  // Calculate centroid
  let meanX = 0, meanY = 0;
  for (const p of points) {
    meanX += p.x;
    meanY += p.y;
  }
  meanX /= points.length;
  meanY /= points.length;
  
  // Build covariance matrix
  let cxx = 0, cyy = 0, cxy = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  
  // Principal angle from covariance matrix
  // theta = 0.5 * atan2(2*cxy, cxx - cyy)
  return Math.atan2(2 * cxy, cxx - cyy) / 2;
}

/**
 * Split clusters that contain multiple walls (L-shapes, corners, etc.)
 * Uses angular discontinuity detection along the principal axis
 * 
 * @param clusters - Array of point clusters from DBSCAN
 * @param angleTolerance - Maximum angle difference before splitting (radians, ~20 degrees = 0.35)
 * @returns Array of split clusters, where each cluster represents a single wall direction
 */
export function splitClustersAtCorners(
  clusters: Point2D[][],
  angleTolerance: number = 0.35 // ~20 degrees
): Point2D[][] {
  const result: Point2D[][] = [];
  
  for (const cluster of clusters) {
    // Small clusters don't need splitting
    if (cluster.length < 20) {
      result.push(cluster);
      continue;
    }
    
    // Calculate centroid and principal direction for sorting
    let meanX = 0, meanY = 0;
    for (const p of cluster) {
      meanX += p.x;
      meanY += p.y;
    }
    meanX /= cluster.length;
    meanY /= cluster.length;
    
    // Get principal direction using PCA
    let cxx = 0, cyy = 0, cxy = 0;
    for (const p of cluster) {
      const dx = p.x - meanX;
      const dy = p.y - meanY;
      cxx += dx * dx;
      cyy += dy * dy;
      cxy += dx * dy;
    }
    
    const trace = cxx + cyy;
    const det = cxx * cyy - cxy * cxy;
    const discriminant = trace * trace - 4 * det;
    
    if (discriminant < 0) {
      result.push(cluster);
      continue;
    }
    
    const lambda1 = (trace + Math.sqrt(discriminant)) / 2;
    let dirX = Math.abs(cxy) > 1e-10 ? lambda1 - cyy : (cxx >= cyy ? 1 : 0);
    let dirY = Math.abs(cxy) > 1e-10 ? cxy : (cxx >= cyy ? 0 : 1);
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
    
    if (dirLen > 1e-10) {
      dirX /= dirLen;
      dirY /= dirLen;
    } else {
      result.push(cluster);
      continue;
    }
    
    // Project all points onto principal axis and sort
    const projected = cluster.map((point, idx) => ({
      point,
      idx,
      proj: (point.x - meanX) * dirX + (point.y - meanY) * dirY
    })).sort((a, b) => a.proj - b.proj);
    
    // Analyze direction changes using a sliding window
    const windowSize = Math.max(10, Math.floor(cluster.length / 10));
    const segments: Point2D[][] = [];
    let currentSegment: Point2D[] = [];
    
    for (let i = 0; i < projected.length; i++) {
      currentSegment.push(projected[i].point);
      
      // Check if we should split here (only check when we have enough points in current segment)
      if (currentSegment.length >= windowSize && i < projected.length - windowSize) {
        // Get recent points and upcoming points
        const recentPoints = currentSegment.slice(-windowSize);
        const upcomingPoints = projected.slice(i + 1, i + 1 + windowSize).map(p => p.point);
        
        if (upcomingPoints.length >= Math.floor(windowSize / 2)) {
          const recentAngle = getSegmentAngle(recentPoints);
          const upcomingAngle = getSegmentAngle(upcomingPoints);
          
          // Calculate angle difference, handling wraparound
          let angleDiff = Math.abs(recentAngle - upcomingAngle);
          if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
          if (angleDiff > Math.PI / 2) angleDiff = Math.PI - angleDiff;
          
          // Split if angle changes significantly
          if (angleDiff > angleTolerance && currentSegment.length >= 15) {
            segments.push([...currentSegment]);
            currentSegment = [];
          }
        }
      }
    }
    
    // Don't forget the last segment
    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }
    
    // Only keep segments with enough points
    for (const seg of segments) {
      if (seg.length >= 10) {
        result.push(seg);
      }
    }
  }
  
  console.log(`[Floor Plan] Split ${clusters.length} clusters into ${result.length} segments`);
  return result;
}

// ============================================================================
// Adaptive DBSCAN Parameters
// ============================================================================

/**
 * Calculate adaptive DBSCAN parameters based on point cloud characteristics
 * 
 * @param points - Array of 2D points
 * @returns Tuple of [eps, minPoints] values
 */
export function calculateAdaptiveDBSCANParams(points: Point2D[]): { eps: number; minPoints: number } {
  if (points.length === 0) {
    return { eps: 0.008, minPoints: 20 };
  }
  
  // Calculate bounds
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const diagonalLength = Math.sqrt(width * width + height * height);
  const area = width * height;
  
  // Adaptive eps: ~0.5-1% of the diagonal
  // This ensures we cluster points that are close relative to the floor plan size
  const adaptiveEps = Math.max(0.002, Math.min(0.05, diagonalLength * 0.007));
  
  // Adaptive minPoints: based on point density
  // More dense point clouds can require more points per cluster
  const pointDensity = points.length / area;
  const densityBasedMinPoints = Math.floor(pointDensity * adaptiveEps * adaptiveEps * Math.PI);
  const adaptiveMinPoints = Math.max(5, Math.min(50, densityBasedMinPoints));
  
  console.log(`[Floor Plan] Adaptive DBSCAN params: eps=${adaptiveEps.toFixed(4)}, minPoints=${adaptiveMinPoints} (density=${pointDensity.toFixed(1)}/unit²)`);
  
  return { eps: adaptiveEps, minPoints: adaptiveMinPoints };
}

// ============================================================================
// Main Orchestrator
// ============================================================================

/**
 * Generate floor plan from a THREE.Scene using the slice box configuration
 * 
 * Uses RANSAC as the primary wall detection method (handles connected walls well),
 * with adaptive DBSCAN + cluster splitting as a fallback.
 * 
 * @param scene - THREE.Scene containing the point cloud or mesh
 * @param sliceConfig - Configuration for the slice box
 * @param scaleFactor - Scale factor to convert view units to feet
 * @param config - Optional wall detection configuration
 */
export function generateFloorPlan(
  scene: THREE.Scene,
  sliceConfig: SliceBoxConfig,
  scaleFactor: number,
  config: WallDetectionConfig = DEFAULT_WALL_DETECTION_CONFIG
): FloorPlanData {
  console.log('[Floor Plan] Starting floor plan generation...');
  console.log('[Floor Plan] Slice config:', sliceConfig);
  console.log('[Floor Plan] Scale factor:', scaleFactor);
  console.log('[Floor Plan] Using RANSAC:', config.useRANSAC);
  
  // Step 1: Extract points from GLB
  const points3D = extractPointsFromGLB(scene);
  
  // Step 2: Slice and project to 2D
  const points2D = sliceAndProject(points3D, sliceConfig, scaleFactor);
  
  if (points2D.length === 0) {
    console.warn('[Floor Plan] No points found in slice region');
    return {
      walls: [],
      points2D: [],
      bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 },
      metadata: {
        pointCount: 0,
        wallCount: 0,
        generatedAt: new Date().toISOString(),
        sliceThicknessInches: sliceConfig.thicknessInches
      }
    };
  }
  
  // Calculate bounds early for adaptive parameters
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const p of points2D) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  
  const boundsWidth = maxX - minX || 1;
  const boundsHeight = maxY - minY || 1;
  const diagonalLength = Math.sqrt(boundsWidth * boundsWidth + boundsHeight * boundsHeight);
  
  // Calculate adaptive distance threshold based on floor plan size
  const adaptiveDistanceThreshold = Math.max(0.002, Math.min(0.02, diagonalLength * 0.003));
  const adaptiveConfig: WallDetectionConfig = {
    ...config,
    distanceThreshold: adaptiveDistanceThreshold
  };
  
  console.log(`[Floor Plan] Bounds: ${boundsWidth.toFixed(3)} x ${boundsHeight.toFixed(3)}, diagonal: ${diagonalLength.toFixed(3)}`);
  console.log(`[Floor Plan] Adaptive distance threshold: ${adaptiveDistanceThreshold.toFixed(4)}`);
  
  let walls: WallSegment[] = [];
  
  // Step 3: Wall detection - try RANSAC first if enabled
  if (config.useRANSAC) {
    console.log('[Floor Plan] Attempting RANSAC wall detection...');
    walls = detectWallsRANSAC(points2D, scaleFactor, adaptiveConfig);
    
    // If RANSAC found very few walls, try DBSCAN as fallback
    if (walls.length < 2 && points2D.length > 100) {
      console.log('[Floor Plan] RANSAC found few walls, trying DBSCAN fallback...');
      
      // Use adaptive DBSCAN parameters
      const { eps, minPoints } = calculateAdaptiveDBSCANParams(points2D);
      const clusters = dbscanCluster(points2D, eps, minPoints);
      
      // Split clusters at corners to handle L-shapes
      const splitClusters = splitClustersAtCorners(clusters);
      
      // Fit lines to split clusters
      const dbscanWalls: WallSegment[] = [];
      for (const cluster of splitClusters) {
        const wall = fitLineToCluster(cluster, scaleFactor);
        if (wall && wall.lengthFeet >= config.minWallLengthFeet) {
          dbscanWalls.push(wall);
        }
      }
      
      console.log(`[Floor Plan] DBSCAN fallback found ${dbscanWalls.length} walls`);
      
      // Use DBSCAN results if they found more walls
      if (dbscanWalls.length > walls.length) {
        walls = dbscanWalls;
      }
    }
  } else {
    // Use DBSCAN with config or adaptive parameters
    console.log('[Floor Plan] Using DBSCAN wall detection...');
    const eps = config.dbscanEps ?? calculateAdaptiveDBSCANParams(points2D).eps;
    const minPoints = config.dbscanMinPoints ?? calculateAdaptiveDBSCANParams(points2D).minPoints;
    console.log(`[Floor Plan] DBSCAN params: eps=${eps.toFixed(4)}, minPoints=${minPoints}`);
    const clusters = dbscanCluster(points2D, eps, minPoints);
    
    // Split clusters at corners
    const splitClusters = splitClustersAtCorners(clusters);
    
    // Fit lines to clusters
    for (const cluster of splitClusters) {
      const wall = fitLineToCluster(cluster, scaleFactor);
      if (wall && wall.lengthFeet >= config.minWallLengthFeet) {
        walls.push(wall);
      }
    }
    
    console.log(`[Floor Plan] DBSCAN detected ${walls.length} walls from ${splitClusters.length} clusters`);
  }
  
  // Step 4: Merge collinear walls
  walls = mergeCollinearWalls(
    walls, 
    config.mergeAngleTolerance ?? 0.1, 
    config.mergeDistanceTolerance ?? 0.5
  );
  
  // Step 5: Snap walls to corners
  walls = snapWallsToCorners(walls, scaleFactor, config.snapThresholdFeet ?? 1.0);
  
  // Recalculate bounds from walls (more accurate)
  if (walls.length > 0) {
    minX = Infinity;
    maxX = -Infinity;
    minY = Infinity;
    maxY = -Infinity;
    
    for (const wall of walls) {
      minX = Math.min(minX, wall.start.x, wall.end.x);
      maxX = Math.max(maxX, wall.start.x, wall.end.x);
      minY = Math.min(minY, wall.start.y, wall.end.y);
      maxY = Math.max(maxY, wall.start.y, wall.end.y);
    }
  }
  
  // Handle edge case of no data
  if (!isFinite(minX)) {
    minX = maxX = minY = maxY = 0;
  }
  
  const result: FloorPlanData = {
    walls,
    points2D,
    bounds: {
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX,
      height: maxY - minY
    },
    metadata: {
      pointCount: points2D.length,
      wallCount: walls.length,
      generatedAt: new Date().toISOString(),
      sliceThicknessInches: sliceConfig.thicknessInches
    }
  };
  
  console.log('[Floor Plan] Generation complete:', {
    pointCount: result.metadata.pointCount,
    wallCount: result.metadata.wallCount,
    bounds: result.bounds
  });
  
  return result;
}

