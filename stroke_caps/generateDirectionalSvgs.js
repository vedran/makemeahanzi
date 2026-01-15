#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Cache for graphics data
let graphicsCache = null;

// Stroke colors (same as generateStillSvgs.js)
const STROKE_COLORS = [
  '#BF0909', '#BFBF09', '#09BF09', '#09BFBF', '#0909BF',
  '#BF09BF', '#42005e', '#ff3333', '#BFBFBF', '#00a53f',
  '#fff000', '#6600a5', '#0053a5', '#62c22b', '#BF09BF',
  '#BF0909', '#BFBF09', '#09BF09', '#09BFBF', '#0909BF'
];

// Arrow color (contrasting)
const ARROW_COLOR = '#000000';
const ARROW_OUTLINE_COLOR = '#FFFFFF';

/**
 * Load and cache graphics data from graphics.txt
 */
function loadGraphicsData() {
  if (graphicsCache !== null) {
    return graphicsCache;
  }

  const graphicsPath = path.join(__dirname, '..', 'graphics.txt');
  const content = fs.readFileSync(graphicsPath, 'utf-8');
  const lines = content.trim().split('\n');

  graphicsCache = new Map();
  for (const line of lines) {
    const data = JSON.parse(line);
    graphicsCache.set(data.character, data);
  }

  return graphicsCache;
}

/**
 * Get character data from graphics.txt
 * @param {string} char - Single character to look up
 * @returns {Object|null} Character data with strokes and medians, or null if not found
 */
function getCharacterData(char) {
  const graphics = loadGraphicsData();
  return graphics.get(char) || null;
}

/**
 * Calculate arrow direction from median points (uses last two points for end direction)
 * @param {Array<Array<number>>} median - Array of [x, y] points
 * @param {boolean} fromEnd - If true, calculate direction at end of stroke (default true)
 * @returns {{dx: number, dy: number}} Normalized direction vector
 */
function calculateArrowDirection(median, fromEnd = true) {
  if (!median || median.length === 0) {
    return { dx: 1, dy: 0 }; // Default to pointing right
  }

  if (median.length === 1) {
    return { dx: 1, dy: 0 }; // Default to pointing right for single point
  }

  let x1, y1, x2, y2;

  if (fromEnd && median.length >= 2) {
    // Use last two points for direction at end of stroke
    [x1, y1] = median[median.length - 2];
    [x2, y2] = median[median.length - 1];
  } else {
    // Use first two points
    [x1, y1] = median[0];
    [x2, y2] = median[1];
  }

  const dx = x2 - x1;
  const dy = y2 - y1;

  // Normalize to unit vector
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) {
    return { dx: 1, dy: 0 };
  }

  return {
    dx: dx / length,
    dy: dy / length
  };
}

/**
 * Generate SVG path for an arrow (simple triangular arrowhead)
 * @param {Array<number>} startPoint - [x, y] position for arrow
 * @param {{dx: number, dy: number}} direction - Normalized direction vector
 * @param {Object} options - Arrow options
 * @param {number} options.size - Arrow size (default 30)
 * @returns {string} SVG path data
 */
function generateArrowPath(startPoint, direction, options = {}) {
  const size = options.size || 30;
  const [x, y] = startPoint;
  const { dx, dy } = direction;

  // Arrow head dimensions
  const headLength = size;
  const headWidth = size * 0.6;

  // Calculate arrow tip position (slightly ahead of start point in direction)
  const tipX = x + dx * headLength;
  const tipY = y + dy * headLength;

  // Calculate perpendicular vector for arrow wings
  const perpX = -dy;
  const perpY = dx;

  // Calculate base points of the arrow head (wings)
  const baseX = x;
  const baseY = y;

  const wing1X = baseX + perpX * (headWidth / 2);
  const wing1Y = baseY + perpY * (headWidth / 2);

  const wing2X = baseX - perpX * (headWidth / 2);
  const wing2Y = baseY - perpY * (headWidth / 2);

  // Create triangular arrow path
  return `M ${tipX} ${tipY} L ${wing1X} ${wing1Y} L ${wing2X} ${wing2Y} Z`;
}

/**
 * Interpolate a point along the median at a given fraction (0 to 1)
 * @param {Array<Array<number>>} median - Array of [x, y] points
 * @param {number} fraction - Position along path (0 = start, 1 = end)
 * @returns {Array<number>} [x, y] interpolated point
 */
function interpolateMedianPoint(median, fraction) {
  if (median.length === 0) return [0, 0];
  if (median.length === 1) return median[0];
  if (fraction <= 0) return median[0];
  if (fraction >= 1) return median[median.length - 1];

  // Calculate total path length
  let totalLength = 0;
  const segmentLengths = [];
  for (let i = 1; i < median.length; i++) {
    const [x1, y1] = median[i - 1];
    const [x2, y2] = median[i];
    const segLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    segmentLengths.push(segLen);
    totalLength += segLen;
  }

  // Find target distance
  const targetDist = fraction * totalLength;
  let accumulatedDist = 0;

  for (let i = 0; i < segmentLengths.length; i++) {
    const segLen = segmentLengths[i];
    if (accumulatedDist + segLen >= targetDist) {
      // Interpolate within this segment
      const segFraction = (targetDist - accumulatedDist) / segLen;
      const [x1, y1] = median[i];
      const [x2, y2] = median[i + 1];
      return [
        x1 + (x2 - x1) * segFraction,
        y1 + (y2 - y1) * segFraction
      ];
    }
    accumulatedDist += segLen;
  }

  return median[median.length - 1];
}

/**
 * Generate a full arrow path that follows the median from start to near end
 * @param {Array<Array<number>>} median - Array of [x, y] points
 * @param {Object} options - Arrow options
 * @param {number} options.headSize - Arrowhead size (default 25)
 * @param {number} options.strokeWidth - Arrow line width (default 6)
 * @param {number} options.endFraction - How far along the stroke to go (default 0.9)
 * @returns {{linePath: string, headPath: string}} SVG paths for line and arrowhead
 */
function generateFullArrowPath(median, options = {}) {
  const headSize = options.headSize || 25;
  const endFraction = options.endFraction || 0.9;

  if (!median || median.length < 2) {
    // Fallback for very short strokes
    const point = median && median[0] ? median[0] : [500, 500];
    return {
      linePath: `M ${point[0]} ${point[1]} L ${point[0] + 30} ${point[1]}`,
      headPath: `M ${point[0] + 30} ${point[1]} L ${point[0] + 20} ${point[1] - 10} L ${point[0] + 20} ${point[1] + 10} Z`
    };
  }

  // Get the endpoint (at endFraction of the path)
  const endPoint = interpolateMedianPoint(median, endFraction);

  // Calculate direction at the end for the arrowhead
  // Use a point slightly before the end to get direction
  const directionPoint = interpolateMedianPoint(median, Math.max(0, endFraction - 0.1));
  const dx = endPoint[0] - directionPoint[0];
  const dy = endPoint[1] - directionPoint[1];
  const length = Math.sqrt(dx * dx + dy * dy);
  const dirX = length > 0 ? dx / length : 1;
  const dirY = length > 0 ? dy / length : 0;

  // Build the line path following the median
  let linePath = `M ${median[0][0]} ${median[0][1]}`;

  // Add points up to but not including the arrowhead area
  for (let i = 1; i < median.length; i++) {
    const [x, y] = median[i];
    // Check if this point is past our end fraction
    const pointFraction = i / (median.length - 1);
    if (pointFraction > endFraction - 0.05) {
      break;
    }
    linePath += ` L ${x} ${y}`;
  }

  // Add the final interpolated point (where arrowhead base will be)
  const arrowBasePoint = interpolateMedianPoint(median, endFraction - 0.05);
  linePath += ` L ${arrowBasePoint[0]} ${arrowBasePoint[1]}`;

  // Generate arrowhead at the end
  const headWidth = headSize * 0.7;
  const perpX = -dirY;
  const perpY = dirX;

  // Arrow tip is at endPoint
  const tipX = endPoint[0];
  const tipY = endPoint[1];

  // Wings are at the base, perpendicular to direction
  const baseX = endPoint[0] - dirX * headSize;
  const baseY = endPoint[1] - dirY * headSize;

  const wing1X = baseX + perpX * (headWidth / 2);
  const wing1Y = baseY + perpY * (headWidth / 2);
  const wing2X = baseX - perpX * (headWidth / 2);
  const wing2Y = baseY - perpY * (headWidth / 2);

  const headPath = `M ${tipX} ${tipY} L ${wing1X} ${wing1Y} L ${wing2X} ${wing2Y} Z`;

  return { linePath, headPath };
}

/**
 * Generate CSS styles for the SVG
 * @param {number} strokeCount - Number of strokes
 * @returns {string} CSS style block
 */
function generateStyles(strokeCount) {
  let strokeStyles = '';
  for (let i = 1; i <= strokeCount; i++) {
    const colorIndex = (i - 1) % STROKE_COLORS.length;
    strokeStyles += `
        .stroke-${i} { fill: ${STROKE_COLORS[colorIndex]}; }`;
  }

  return `<style type="text/css">
        ${strokeStyles}
        .arrow-line {
            fill: none;
            stroke: ${ARROW_COLOR};
            stroke-width: 6px;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .arrow-line-outline {
            fill: none;
            stroke: ${ARROW_OUTLINE_COLOR};
            stroke-width: 10px;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .arrow-head {
            fill: ${ARROW_COLOR};
            stroke: ${ARROW_OUTLINE_COLOR};
            stroke-width: 2px;
        }
        .arrow {
            fill: ${ARROW_COLOR};
            stroke: ${ARROW_OUTLINE_COLOR};
            stroke-width: 2px;
        }
        text {
            font-family: Helvetica, Arial, sans-serif;
            font-size: 50px;
            fill: #FFFFFF;
            paint-order: stroke;
            stroke: #000000;
            stroke-width: 4px;
            stroke-linecap: butt;
            stroke-linejoin: miter;
            font-weight: 800;
        }
    </style>`;
}

/**
 * Generate directional SVG for a character
 * @param {string} char - Character to generate SVG for
 * @param {Object} options - Generation options
 * @param {boolean} options.showNumbers - Whether to show stroke order numbers (default true)
 * @param {number} options.arrowSize - Size of arrows (default 30)
 * @param {boolean} options.showGrid - Whether to show reference grid (default false)
 * @returns {string|null} SVG string or null if character not found
 */
function generateDirectionalSvg(char, options = {}) {
  const data = getCharacterData(char);
  if (!data) {
    return null;
  }

  const showNumbers = options?.showNumbers !== false; // default true
  const arrowSize = options?.arrowSize || 30;
  const showGrid = options?.showGrid || false;

  const { strokes, medians } = data;
  const strokeCount = strokes.length;

  // Build SVG components
  let strokePaths = '';
  let arrows = '';
  let numbers = '';

  for (let i = 0; i < strokeCount; i++) {
    const strokePath = strokes[i];
    const median = medians[i];
    const strokeNum = i + 1;

    // Add stroke path
    strokePaths += `
        <path d="${strokePath}" class="stroke-${strokeNum}"/>`;

    // Generate full arrow following the median
    const { linePath, headPath } = generateFullArrowPath(median, {
      headSize: arrowSize,
      endFraction: 0.92
    });

    // Add arrow with outline for visibility (outline first, then line on top)
    arrows += `
        <path d="${linePath}" class="arrow-line-outline arrow-${strokeNum}"/>
        <path d="${linePath}" class="arrow-line arrow-${strokeNum}"/>
        <path d="${headPath}" class="arrow-head arrow-${strokeNum}"/>`;

    // Add stroke number at start of stroke
    if (showNumbers) {
      const [numX, numY] = median[0];
      // Position number slightly offset from start point
      const offsetX = numX - 25;
      const offsetY = numY + 15;
      numbers += `
        <text x="${offsetX}" y="${offsetY}" style="transform-origin:${offsetX}px ${offsetY}px; transform:scale(1,-1);">${strokeNum}</text>`;
    }
  }

  // Generate grid if requested
  let grid = '';
  if (showGrid) {
    grid = `
    <g stroke="lightgray" stroke-dasharray="1,1" stroke-width="1" transform="scale(4, 4)">
        <line x1="0" y1="0" x2="256" y2="256"/>
        <line x1="256" y1="0" x2="0" y2="256"/>
        <line x1="128" y1="0" x2="128" y2="256"/>
        <line x1="0" y1="128" x2="256" y2="128"/>
    </g>`;
  }

  // Assemble full SVG
  const styles = generateStyles(strokeCount);
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    ${styles}
    ${grid}
    <g transform="scale(1, -1) translate(0, -900)">
        ${strokePaths}
        ${arrows}
        ${numbers}
    </g>
</svg>`;

  return svg;
}

/**
 * Generate SVG file for a character
 * @param {string} char - Character to generate
 * @param {string} outputDir - Output directory
 * @param {Object} options - Generation options
 */
function generateSvgFile(char, outputDir, options = {}) {
  const svg = generateDirectionalSvg(char, options);
  if (!svg) {
    console.error(`Character not found: ${char}`);
    return null;
  }

  const charCode = char.charCodeAt(0);
  const filename = `${charCode}-directional.svg`;
  const outputPath = path.join(outputDir, filename);

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, svg);
  console.log(`Generated: ${outputPath}`);
  return outputPath;
}

/**
 * Batch generate SVGs for multiple characters
 * @param {string[]} chars - Array of characters
 * @param {string} outputDir - Output directory
 * @param {Object} options - Generation options
 */
function batchGenerate(chars, outputDir, options = {}) {
  const results = [];
  for (const char of chars) {
    const result = generateSvgFile(char, outputDir, options);
    if (result) {
      results.push(result);
    }
  }
  return results;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node generateDirectionalSvgs.js <character> [outputDir]');
    console.log('       node generateDirectionalSvgs.js --batch <char1,char2,...> [outputDir]');
    console.log('');
    console.log('Examples:');
    console.log('  node generateDirectionalSvgs.js 我');
    console.log('  node generateDirectionalSvgs.js --batch 我,是,你 ./output');
    process.exit(1);
  }

  let outputDir = path.join(__dirname, '..', 'svgs-directional');

  if (args[0] === '--batch') {
    const chars = args[1].split(',');
    if (args[2]) outputDir = args[2];
    batchGenerate(chars, outputDir);
  } else {
    const char = args[0];
    if (args[1]) outputDir = args[1];
    generateSvgFile(char, outputDir);
  }
}

// Export functions for testing
module.exports = {
  calculateArrowDirection,
  generateArrowPath,
  generateFullArrowPath,
  interpolateMedianPoint,
  generateDirectionalSvg,
  getCharacterData,
  generateSvgFile,
  batchGenerate
};
