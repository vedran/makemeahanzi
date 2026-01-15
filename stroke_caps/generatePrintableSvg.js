#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Import shared functions from the directional SVG generator
const {
  getCharacterData,
  generateFullArrowPath,
  interpolateMedianPoint
} = require('./generateDirectionalSvgs.js');

/**
 * Calculate total length of a median path
 */
function getMedianLength(median) {
  let totalLength = 0;
  for (let i = 1; i < median.length; i++) {
    const [x1, y1] = median[i - 1];
    const [x2, y2] = median[i];
    totalLength += Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
  }
  return totalLength;
}

/**
 * Generate a printable SVG for a character (black strokes, white arrows/numbers)
 * Designed for 3D printing with two colors
 * @param {string} char - Character to generate SVG for
 * @param {Object} options - Generation options
 * @returns {string|null} SVG string or null if character not found
 */
function generatePrintableSvg(char, options = {}) {
  const data = getCharacterData(char);
  if (!data) {
    return null;
  }

  const arrowSize = options?.arrowSize || 20;
  const { strokes, medians } = data;
  const strokeCount = strokes.length;

  // Build SVG components
  let strokePaths = '';
  let arrows = '';

  for (let i = 0; i < strokeCount; i++) {
    const strokePath = strokes[i];
    const median = medians[i];
    const strokeNum = i + 1;

    // Add stroke path (black)
    strokePaths += `
        <path d="${strokePath}" class="stroke"/>`;

    // Calculate stroke length to determine adaptive positioning
    const strokeLength = getMedianLength(median);

    // Adaptive positioning based on stroke length
    // Short strokes (< 150): number at 30%, arrow starts at 45%
    // Medium strokes (150-400): number at 15%, arrow starts at 25%
    // Long strokes (> 400): number at 8%, arrow starts at 15%
    let numberPercent, arrowStartPercent;
    if (strokeLength < 150) {
      numberPercent = 0.30;
      arrowStartPercent = 0.45;
    } else if (strokeLength < 400) {
      numberPercent = 0.15;
      arrowStartPercent = 0.25;
    } else {
      numberPercent = 0.08;
      arrowStartPercent = 0.15;
    }

    // Position number along the stroke path
    const numberPosition = interpolateMedianPoint(median, numberPercent);
    const [numX, numY] = numberPosition;

    // Arrow tip position (where arrowhead points to)
    const arrowTipPercent = 0.90;
    const arrowTipPoint = interpolateMedianPoint(median, arrowTipPercent);

    // Calculate arrowhead direction from points just before the tip
    const directionPoint = interpolateMedianPoint(median, arrowTipPercent - 0.08);
    const dx = arrowTipPoint[0] - directionPoint[0];
    const dy = arrowTipPoint[1] - directionPoint[1];
    const length = Math.sqrt(dx * dx + dy * dy);
    const dirX = length > 0 ? dx / length : 1;
    const dirY = length > 0 ? dy / length : 0;

    // Calculate arrowhead base position (where line should end)
    const headWidth = arrowSize * 0.7;
    const perpX = -dirY;
    const perpY = dirX;
    const tipX = arrowTipPoint[0];
    const tipY = arrowTipPoint[1];
    const baseX = tipX - dirX * arrowSize;
    const baseY = tipY - dirY * arrowSize;

    // Build arrow line path - end exactly at arrowhead base
    const arrowStartPoint = interpolateMedianPoint(median, arrowStartPercent);
    let linePath = `M ${arrowStartPoint[0]} ${arrowStartPoint[1]}`;

    // Add intermediate points along the path up to near the arrowhead
    for (let t = arrowStartPercent + 0.05; t <= arrowTipPercent - 0.10; t += 0.05) {
      const pt = interpolateMedianPoint(median, t);
      linePath += ` L ${pt[0]} ${pt[1]}`;
    }

    // End the line exactly at the arrowhead base
    linePath += ` L ${baseX} ${baseY}`;

    // Generate arrowhead
    const wing1X = baseX + perpX * (headWidth / 2);
    const wing1Y = baseY + perpY * (headWidth / 2);
    const wing2X = baseX - perpX * (headWidth / 2);
    const wing2Y = baseY - perpY * (headWidth / 2);
    const headPath = `M ${tipX} ${tipY} L ${wing1X} ${wing1Y} L ${wing2X} ${wing2Y} Z`;

    // Add white arrow
    arrows += `
        <path d="${linePath}" class="arrow-line"/>
        <path d="${headPath}" class="arrow-head"/>`;

    // Add stroke number centered inside the stroke
    arrows += `
        <text x="${numX}" y="${numY}" class="stroke-number" style="transform-origin:${numX}px ${numY}px; transform:scale(1,-1);">${strokeNum}</text>`;
  }

  // Assemble full SVG with white background
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <style type="text/css">
        .background { fill: #FFFFFF; }
        .stroke { fill: #000000; }
        .arrow-line {
            fill: none;
            stroke: #FFFFFF;
            stroke-width: 8px;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        .arrow-head {
            fill: #FFFFFF;
            stroke: none;
        }
        .stroke-number {
            font-family: Helvetica, Arial, sans-serif;
            font-size: 45px;
            fill: #FFFFFF;
            font-weight: 800;
            text-anchor: middle;
            dominant-baseline: middle;
        }
    </style>
    <rect class="background" x="0" y="0" width="1024" height="1024"/>
    <g transform="scale(1, -1) translate(0, -900)">
        ${strokePaths}
        ${arrows}
    </g>
</svg>`;

  return svg;
}

/**
 * Generate printable SVG file for a character
 */
function generatePrintableSvgFile(char, outputDir, options = {}) {
  const svg = generatePrintableSvg(char, options);
  if (!svg) {
    console.error(`Character not found: ${char}`);
    return null;
  }

  const charCode = char.charCodeAt(0);
  const filename = `${charCode}-printable.svg`;
  const outputPath = path.join(outputDir, filename);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(outputPath, svg);
  console.log(`Generated printable SVG: ${outputPath}`);
  return outputPath;
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node generatePrintableSvg.js <character> [outputDir]');
    console.log('       node generatePrintableSvg.js --batch <char1,char2,...> [outputDir]');
    process.exit(1);
  }

  let outputDir = path.join(__dirname, '..', 'output');

  if (args[0] === '--batch') {
    const chars = args[1].split(',');
    if (args[2]) outputDir = args[2];
    for (const char of chars) {
      generatePrintableSvgFile(char, outputDir);
    }
  } else {
    const char = args[0];
    if (args[1]) outputDir = args[1];
    generatePrintableSvgFile(char, outputDir);
  }
}

module.exports = {
  generatePrintableSvg,
  generatePrintableSvgFile
};
