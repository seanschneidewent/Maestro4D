/**
 * Floor Plan SVG Generator
 * 
 * Renders floor plan data as SVG with walls, dimension lines,
 * and architectural formatting (feet/inches).
 */

import { FloorPlanData, WallSegment, Point2D } from './floorPlanGenerator';

// ============================================================================
// Types
// ============================================================================

export interface SvgOptions {
  width: number;
  height: number;
  showWalls: boolean;
  showDimensions: boolean;
  showWallThickness: boolean;
  showPoints?: boolean;
  padding?: number;
  wallColor?: string;
  dimensionColor?: string;
  backgroundColor?: string;
}

// ============================================================================
// Architectural Formatting
// ============================================================================

/**
 * Convert decimal feet to architectural format
 * Examples:
 *   12.5 → "12' 6""
 *   12.515625 → "12' 6 3/16""
 *   0.25 → "0' 3""
 */
export function feetToFeetInches(feet: number): string {
  const isNegative = feet < 0;
  const absFeet = Math.abs(feet);
  
  const wholeFeet = Math.floor(absFeet);
  const remainingInches = (absFeet - wholeFeet) * 12;
  const wholeInches = Math.floor(remainingInches);
  const fractionalInches = remainingInches - wholeInches;
  
  // Convert fractional inches to 16ths
  const sixteenths = Math.round(fractionalInches * 16);
  
  let result = `${isNegative ? '-' : ''}${wholeFeet}'`;
  
  if (sixteenths === 0) {
    result += ` ${wholeInches}"`;
  } else if (sixteenths === 16) {
    // Round up to next inch
    result += ` ${wholeInches + 1}"`;
  } else {
    // Reduce fraction
    let num = sixteenths;
    let den = 16;
    
    while (num % 2 === 0 && den > 1) {
      num /= 2;
      den /= 2;
    }
    
    if (wholeInches === 0) {
      result += ` ${num}/${den}"`;
    } else {
      result += ` ${wholeInches} ${num}/${den}"`;
    }
  }
  
  return result;
}

// ============================================================================
// SVG Helpers
// ============================================================================

/**
 * Transform data coordinates to SVG coordinates
 */
function createTransform(
  bounds: FloorPlanData['bounds'],
  width: number,
  height: number,
  padding: number
): (p: Point2D) => Point2D {
  const availableWidth = width - padding * 2;
  const availableHeight = height - padding * 2;
  
  // Handle zero-size bounds
  const dataWidth = bounds.width || 1;
  const dataHeight = bounds.height || 1;
  
  const scale = Math.min(
    availableWidth / dataWidth,
    availableHeight / dataHeight
  );
  
  // Center the content
  const scaledWidth = dataWidth * scale;
  const scaledHeight = dataHeight * scale;
  const offsetX = padding + (availableWidth - scaledWidth) / 2;
  const offsetY = padding + (availableHeight - scaledHeight) / 2;
  
  return (p: Point2D): Point2D => ({
    x: offsetX + (p.x - bounds.minX) * scale,
    y: offsetY + (p.y - bounds.minY) * scale
  });
}

/**
 * Calculate the angle of a wall segment
 */
function getWallAngle(wall: WallSegment): number {
  return Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
}

/**
 * Generate dimension line SVG elements
 */
function generateDimensionLine(
  wall: WallSegment,
  transform: (p: Point2D) => Point2D,
  color: string
): string {
  const start = transform(wall.start);
  const end = transform(wall.end);
  
  const angle = getWallAngle(wall);
  const perpAngle = angle + Math.PI / 2;
  
  // Offset dimension line from wall
  const offset = 20;
  const extensionLength = 10;
  const arrowSize = 6;
  
  const offsetX = Math.cos(perpAngle) * offset;
  const offsetY = Math.sin(perpAngle) * offset;
  
  // Dimension line endpoints
  const dimStart: Point2D = {
    x: start.x + offsetX,
    y: start.y + offsetY
  };
  const dimEnd: Point2D = {
    x: end.x + offsetX,
    y: end.y + offsetY
  };
  
  // Extension lines
  const extStartTop: Point2D = {
    x: start.x + Math.cos(perpAngle) * (offset - extensionLength),
    y: start.y + Math.sin(perpAngle) * (offset - extensionLength)
  };
  const extStartBottom: Point2D = {
    x: start.x + Math.cos(perpAngle) * (offset + extensionLength),
    y: start.y + Math.sin(perpAngle) * (offset + extensionLength)
  };
  const extEndTop: Point2D = {
    x: end.x + Math.cos(perpAngle) * (offset - extensionLength),
    y: end.y + Math.sin(perpAngle) * (offset - extensionLength)
  };
  const extEndBottom: Point2D = {
    x: end.x + Math.cos(perpAngle) * (offset + extensionLength),
    y: end.y + Math.sin(perpAngle) * (offset + extensionLength)
  };
  
  // Arrow heads
  const arrowAngle = 0.5; // radians
  const arrow1: Point2D = {
    x: dimStart.x + Math.cos(angle + arrowAngle) * arrowSize,
    y: dimStart.y + Math.sin(angle + arrowAngle) * arrowSize
  };
  const arrow2: Point2D = {
    x: dimStart.x + Math.cos(angle - arrowAngle) * arrowSize,
    y: dimStart.y + Math.sin(angle - arrowAngle) * arrowSize
  };
  const arrow3: Point2D = {
    x: dimEnd.x + Math.cos(angle + Math.PI + arrowAngle) * arrowSize,
    y: dimEnd.y + Math.sin(angle + Math.PI + arrowAngle) * arrowSize
  };
  const arrow4: Point2D = {
    x: dimEnd.x + Math.cos(angle + Math.PI - arrowAngle) * arrowSize,
    y: dimEnd.y + Math.sin(angle + Math.PI - arrowAngle) * arrowSize
  };
  
  // Text position and rotation
  const textX = (dimStart.x + dimEnd.x) / 2;
  const textY = (dimStart.y + dimEnd.y) / 2;
  let textAngle = angle * (180 / Math.PI);
  
  // Keep text readable (not upside down)
  if (textAngle > 90) textAngle -= 180;
  if (textAngle < -90) textAngle += 180;
  
  const dimensionText = feetToFeetInches(wall.lengthFeet);
  
  return `
    <!-- Dimension for wall ${wall.lengthFeet.toFixed(2)}' -->
    <g class="dimension-line">
      <!-- Extension lines -->
      <line x1="${extStartTop.x}" y1="${extStartTop.y}" x2="${extStartBottom.x}" y2="${extStartBottom.y}" 
            stroke="${color}" stroke-width="0.5" />
      <line x1="${extEndTop.x}" y1="${extEndTop.y}" x2="${extEndBottom.x}" y2="${extEndBottom.y}" 
            stroke="${color}" stroke-width="0.5" />
      
      <!-- Dimension line -->
      <line x1="${dimStart.x}" y1="${dimStart.y}" x2="${dimEnd.x}" y2="${dimEnd.y}" 
            stroke="${color}" stroke-width="0.75" />
      
      <!-- Arrows -->
      <polygon points="${dimStart.x},${dimStart.y} ${arrow1.x},${arrow1.y} ${arrow2.x},${arrow2.y}" 
               fill="${color}" />
      <polygon points="${dimEnd.x},${dimEnd.y} ${arrow3.x},${arrow3.y} ${arrow4.x},${arrow4.y}" 
               fill="${color}" />
      
      <!-- Text -->
      <text x="${textX}" y="${textY - 4}" 
            transform="rotate(${textAngle}, ${textX}, ${textY})"
            text-anchor="middle" 
            font-family="Arial, sans-serif" 
            font-size="10" 
            fill="${color}">
        ${dimensionText}
      </text>
    </g>
  `;
}

/**
 * Generate wall thickness visualization
 */
function generateWallThickness(
  wall: WallSegment,
  transform: (p: Point2D) => Point2D,
  scaleFactor: number,
  color: string
): string {
  const start = transform(wall.start);
  const end = transform(wall.end);
  
  const angle = getWallAngle(wall);
  const perpAngle = angle + Math.PI / 2;
  
  // Calculate pixel thickness (rough approximation)
  const thicknessPixels = wall.thickness * scaleFactor * 10; // Scale appropriately
  const halfThickness = Math.max(thicknessPixels / 2, 2);
  
  // Create rectangle corners
  const corners = [
    { x: start.x + Math.cos(perpAngle) * halfThickness, y: start.y + Math.sin(perpAngle) * halfThickness },
    { x: end.x + Math.cos(perpAngle) * halfThickness, y: end.y + Math.sin(perpAngle) * halfThickness },
    { x: end.x - Math.cos(perpAngle) * halfThickness, y: end.y - Math.sin(perpAngle) * halfThickness },
    { x: start.x - Math.cos(perpAngle) * halfThickness, y: start.y - Math.sin(perpAngle) * halfThickness }
  ];
  
  const points = corners.map(c => `${c.x},${c.y}`).join(' ');
  
  return `<polygon points="${points}" fill="${color}" fill-opacity="0.3" stroke="${color}" stroke-width="0.5" />`;
}

// ============================================================================
// Main SVG Generator
// ============================================================================

/**
 * Generate SVG string from floor plan data
 */
export function generateFloorPlanSVG(data: FloorPlanData, options: SvgOptions): string {
  const {
    width,
    height,
    showWalls,
    showDimensions,
    showWallThickness,
    showPoints = false,
    padding = 40,
    wallColor = '#1e3a5f',
    dimensionColor = '#666666',
    backgroundColor = '#ffffff'
  } = options;
  
  // Create coordinate transform
  const transform = createTransform(data.bounds, width, height, padding);
  
  // Calculate scale factor for thickness visualization
  const availableWidth = width - padding * 2;
  const dataWidth = data.bounds.width || 1;
  const scaleFactor = availableWidth / dataWidth;
  
  // Build SVG content
  let svgContent = '';
  
  // Points layer (optional, for debugging)
  if (showPoints && data.points2D.length > 0) {
    svgContent += '<g class="points-layer">';
    for (const point of data.points2D) {
      const p = transform(point);
      svgContent += `<circle cx="${p.x}" cy="${p.y}" r="1" fill="#cccccc" />`;
    }
    svgContent += '</g>';
  }
  
  // Wall thickness layer
  if (showWallThickness && showWalls) {
    svgContent += '<g class="wall-thickness-layer">';
    for (const wall of data.walls) {
      svgContent += generateWallThickness(wall, transform, scaleFactor, wallColor);
    }
    svgContent += '</g>';
  }
  
  // Walls layer
  if (showWalls) {
    svgContent += '<g class="walls-layer">';
    for (const wall of data.walls) {
      const start = transform(wall.start);
      const end = transform(wall.end);
      svgContent += `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" 
                          stroke="${wallColor}" stroke-width="3" stroke-linecap="round" />`;
    }
    svgContent += '</g>';
  }
  
  // Dimensions layer
  if (showDimensions && showWalls) {
    svgContent += '<g class="dimensions-layer">';
    for (const wall of data.walls) {
      svgContent += generateDimensionLine(wall, transform, dimensionColor);
    }
    svgContent += '</g>';
  }
  
  // Metadata text
  const metaY = height - 10;
  svgContent += `
    <g class="metadata-layer">
      <text x="10" y="${metaY}" font-family="Arial, sans-serif" font-size="8" fill="#999999">
        Walls: ${data.metadata.wallCount} | Points: ${data.metadata.pointCount} | 
        Generated: ${new Date(data.metadata.generatedAt).toLocaleDateString()}
      </text>
    </g>
  `;
  
  // Build complete SVG
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     width="${width}" height="${height}" 
     viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      .walls-layer line { vector-effect: non-scaling-stroke; }
      .dimension-line text { user-select: none; }
    </style>
  </defs>
  
  <!-- Background -->
  <rect width="100%" height="100%" fill="${backgroundColor}" />
  
  ${svgContent}
</svg>`;
  
  return svg;
}

// ============================================================================
// Download Helper
// ============================================================================

/**
 * Trigger download of SVG file
 */
export function downloadSvg(svgString: string, filename: string): void {
  const blob = new Blob([svgString], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  URL.revokeObjectURL(url);
  
  console.log(`[Floor Plan] Downloaded SVG: ${filename}`);
}

