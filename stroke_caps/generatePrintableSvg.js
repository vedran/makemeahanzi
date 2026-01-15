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

    // Position number at 12% along the stroke path (inside the stroke, not at edge)
    const numberPosition = interpolateMedianPoint(median, 0.12);
    const [numX, numY] = numberPosition;

    // Generate arrow starting AFTER the number (from 20% to 92%)
    const arrowStartPoint = interpolateMedianPoint(median, 0.20);
    const arrowEndPoint = interpolateMedianPoint(median, 0.92);

    // Build arrow line path from 20% to ~87% (leaving room for arrowhead)
    let linePath = `M ${arrowStartPoint[0]} ${arrowStartPoint[1]}`;
    for (let t = 0.25; t <= 0.87; t += 0.05) {
      const pt = interpolateMedianPoint(median, t);
      linePath += ` L ${pt[0]} ${pt[1]}`;
    }
    const arrowBasePoint = interpolateMedianPoint(median, 0.87);
    linePath += ` L ${arrowBasePoint[0]} ${arrowBasePoint[1]}`;

    // Calculate arrowhead direction and position
    const directionPoint = interpolateMedianPoint(median, 0.82);
    const dx = arrowEndPoint[0] - directionPoint[0];
    const dy = arrowEndPoint[1] - directionPoint[1];
    const length = Math.sqrt(dx * dx + dy * dy);
    const dirX = length > 0 ? dx / length : 1;
    const dirY = length > 0 ? dy / length : 0;

    // Generate arrowhead
    const headWidth = arrowSize * 0.7;
    const perpX = -dirY;
    const perpY = dirX;
    const tipX = arrowEndPoint[0];
    const tipY = arrowEndPoint[1];
    const baseX = arrowEndPoint[0] - dirX * arrowSize;
    const baseY = arrowEndPoint[1] - dirY * arrowSize;
    const wing1X = baseX + perpX * (headWidth / 2);
    const wing1Y = baseY + perpY * (headWidth / 2);
    const wing2X = baseX - perpX * (headWidth / 2);
    const wing2Y = baseY - perpY * (headWidth / 2);
    const headPath = `M ${tipX} ${tipY} L ${wing1X} ${wing1Y} L ${wing2X} ${wing2Y} Z`;

    // Add white arrow (no outline needed since it's inside black stroke)
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
