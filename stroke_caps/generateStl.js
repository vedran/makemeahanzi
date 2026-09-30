#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { parseSVG, makeAbsolute } = require('svg-path-parser');

const { getCharacterData } = require('./generateDirectionalSvgs.js');
const { MARK, layoutMarkings } = require('./tileLayout.js');

// Dimensions (in mm)
const PLATE_SIZE_MM = 101.6; // 4 inches
const PLATE_HEIGHT_MM = 4;
const RECESS_START_MM = 0.5;
const RECESS_DEPTH_MM = 3.5; // Goes from 0.5mm to 4mm (full depth)
const CORNER_RADIUS_MM = 8;
const ROMAN_AREA_MM = 15; // band at the bottom of the tile for the romanization
const ROMAN_TEXT_MM = 6;
const SVG_SIZE = 1024; // SVG viewBox size

// Scale factor from SVG units to mm
const SCALE = PLATE_SIZE_MM / SVG_SIZE;

/**
 * Convert SVG path commands to polygon points
 * Approximates curves with line segments
 */
function pathToPolygon(pathData, samplesPerCurve = 10) {
  const commands = makeAbsolute(parseSVG(pathData));
  const points = [];
  let currentX = 0, currentY = 0;
  let startX = 0, startY = 0;

  for (const cmd of commands) {
    switch (cmd.code) {
      case 'M':
        currentX = cmd.x;
        currentY = cmd.y;
        startX = currentX;
        startY = currentY;
        points.push([currentX, currentY]);
        break;

      case 'L':
        currentX = cmd.x;
        currentY = cmd.y;
        points.push([currentX, currentY]);
        break;

      case 'Q': // Quadratic Bezier
        for (let t = 1; t <= samplesPerCurve; t++) {
          const tt = t / samplesPerCurve;
          const x = (1 - tt) * (1 - tt) * currentX + 2 * (1 - tt) * tt * cmd.x1 + tt * tt * cmd.x;
          const y = (1 - tt) * (1 - tt) * currentY + 2 * (1 - tt) * tt * cmd.y1 + tt * tt * cmd.y;
          points.push([x, y]);
        }
        currentX = cmd.x;
        currentY = cmd.y;
        break;

      case 'C': // Cubic Bezier
        for (let t = 1; t <= samplesPerCurve; t++) {
          const tt = t / samplesPerCurve;
          const mt = 1 - tt;
          const x = mt * mt * mt * currentX + 3 * mt * mt * tt * cmd.x1 + 3 * mt * tt * tt * cmd.x2 + tt * tt * tt * cmd.x;
          const y = mt * mt * mt * currentY + 3 * mt * mt * tt * cmd.y1 + 3 * mt * tt * tt * cmd.y2 + tt * tt * tt * cmd.y;
          points.push([x, y]);
        }
        currentX = cmd.x;
        currentY = cmd.y;
        break;

      case 'Z':
        if (points.length > 0 && (points[points.length - 1][0] !== startX || points[points.length - 1][1] !== startY)) {
          points.push([startX, startY]);
        }
        break;
    }
  }

  return points;
}

/**
 * Convert SVG coordinates to 3D model coordinates
 * SVG uses transform="scale(1, -1) translate(0, -900)" which flips Y
 * We mirror X to get correct orientation in OpenSCAD
 */
function svgToModelCoords(x, y) {
  // Mirror X to fix orientation, transform Y to account for SVG flip
  const modelX = (SVG_SIZE - x) * SCALE;  // Mirror horizontally
  const modelY = (900 - y) * SCALE;       // Account for SVG Y transform
  return [modelX, modelY];
}

/**
 * Tile layout in final millimetres. The character is scaled down to leave a
 * band for the romanization; the whole tile stays 4" x 4".
 */
function tileTransform(romanization) {
  const charScale = romanization ? (PLATE_SIZE_MM - ROMAN_AREA_MM) / PLATE_SIZE_MM : 1.0;
  const offsetX = romanization ? (PLATE_SIZE_MM * (1 - charScale)) / 2 : 0;
  const offsetY = romanization ? ((PLATE_SIZE_MM - ROMAN_AREA_MM) * (1 - charScale)) / 2 : 0;
  return (x, y) => {
    const [mx, my] = svgToModelCoords(x, y);
    return [offsetX + mx * charScale, offsetY + my * charScale];
  };
}

const fmt = (v) => v.toFixed(3);
const pt = ([x, y]) => `[${fmt(x)}, ${fmt(y)}]`;
const scadString = (s) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * Generate OpenSCAD code for a character tile.
 *
 * The tile is two print bodies for a multi-material printer:
 *   plate (filament 1): the plate, plus number badges, dashed lines and
 *                       arrowheads showing through the stroke inlay
 *   inlay (filament 2): the character strokes, the digits inside the badges,
 *                       an outline ring around each badge, and the romanization
 * Both are flush on top, so the markings can be seen but not felt.
 *
 * Select a body with -D 'part="plate_base"' / "plate_top" / "inlay";
 * the default "all" shows the coloured tile in the OpenSCAD preview.
 *
 * @returns {{scad: string, layout: object}|null} OpenSCAD source and the
 *   marking layout (with placement warnings) used to build it
 */
function buildTile(char, options = {}) {
  const data = getCharacterData(char);
  if (!data) {
    return null;
  }

  const { strokes, medians } = data;
  const romanization = options.romanization || null;
  const toTile = tileTransform(romanization);

  const strokePolys = strokes.map((s) => pathToPolygon(s).map(([x, y]) => toTile(x, y)));
  const tileMedians = medians.map((m) => m.map(([x, y]) => toTile(x, y)));
  const layout = layoutMarkings(strokePolys, tileMedians);

  let scad = `// OpenSCAD file for character: ${char}
// Generated by generateStl.js
// Preview: open in OpenSCAD (F5). Export bodies with
//   openscad -D 'part="plate_base"' -o base.stl this.scad
//   openscad -D 'part="plate_top"'  -o top.stl  this.scad
//   openscad -D 'part="inlay"'      -o inlay.stl this.scad

part = "all";
$fn = 32;

plate_size = ${PLATE_SIZE_MM.toFixed(2)};
plate_height_z = ${PLATE_HEIGHT_MM};
recess_start = ${RECESS_START_MM};
corner_radius = ${CORNER_RADIUS_MM};
ring_width = ${MARK.ringWidth};
font = "Liberation Sans:style=Bold";

module plate_2d() {
    offset(r = corner_radius) offset(r = -corner_radius) square([plate_size, plate_size]);
}

// Stroke-colour areas seen on the top surface
module inlay_2d() {
    difference() {
        character_strokes();
        badge_disks();
        difference() { lines_and_heads(); offset(r = 0.5) badge_disks(); }
    }
    badge_digits();
    difference() { offset(r = ring_width) badge_disks(); badge_disks(); }
    ${romanization ? 'romanization_text();' : ''}
}

if (part == "plate_base" || part == "all")
    color("tan") linear_extrude(height = recess_start) plate_2d();
if (part == "plate_top" || part == "all")
    color("tan") translate([0, 0, recess_start])
        linear_extrude(height = plate_height_z - recess_start) difference() { plate_2d(); inlay_2d(); }
if (part == "inlay" || part == "all")
    color("seagreen") translate([0, 0, recess_start])
        linear_extrude(height = plate_height_z - recess_start) intersection() { plate_2d(); inlay_2d(); }
`;

  if (romanization) {
    // Model +Y is the bottom of the tile when it is read upright, so text is
    // rotated 180 degrees like the stroke numbers
    scad += `
module romanization_text() {
    translate([plate_size / 2, plate_size - ${(ROMAN_AREA_MM / 2).toFixed(2)}])
        rotate([0, 0, 180])
            text("${scadString(romanization)}", size = ${ROMAN_TEXT_MM}, halign = "center", valign = "center", font = font);
}
`;
  }

  scad += `\nmodule character_strokes() {\n`;
  strokePolys.forEach((poly, i) => {
    scad += `    // Stroke ${i + 1}\n    polygon([${poly.map(pt).join(', ')}]);\n`;
  });
  scad += `}\n\nmodule badge_disks() {\n`;
  for (const s of layout.strokes) {
    scad += `    translate(${pt(s.badge.center)}) circle(r = ${fmt(s.badge.r)}, $fn = 48); // ${s.number}\n`;
  }
  scad += `}\n\nmodule badge_digits() {\n`;
  for (const s of layout.strokes) {
    const size = (s.number >= 10 ? MARK.digitSize2 : MARK.digitSize) * (s.badge.r / MARK.badgeRadius);
    scad += `    translate(${pt(s.badge.center)}) rotate([0, 0, 180]) offset(delta = ${MARK.digitThicken}) text("${s.number}", size = ${fmt(size)}, halign = "center", valign = "center", font = font);\n`;
  }
  scad += `}\n\nmodule lines_and_heads() {\n`;
  const r = fmt(MARK.dashWidth / 2);
  for (const s of layout.strokes) {
    scad += `    // Stroke ${s.number}: ${s.style} line\n`;
    for (const line of s.lines) {
      for (let k = 0; k < line.length - 1; k++) {
        scad += `    hull() { translate(${pt(line[k])}) circle(r = ${r}, $fn = 16); translate(${pt(line[k + 1])}) circle(r = ${r}, $fn = 16); }\n`;
      }
    }
    scad += `    polygon([${s.head.map(pt).join(', ')}]);\n`;
  }
  scad += `}\n`;

  return { scad, layout };
}

function generateOpenScad(char, options = {}) {
  const tile = buildTile(char, options);
  return tile ? tile.scad : null;
}

/**
 * Generate a simple binary STL file
 * Creates a flat representation suitable for laser cutting or simple 3D printing
 */
function generateBinaryStl(char, options = {}) {
  const data = getCharacterData(char);
  if (!data) {
    return null;
  }

  const { strokes, medians } = data;
  const triangles = [];

  // Helper to add a triangle
  function addTriangle(v1, v2, v3, normal = [0, 0, 1]) {
    triangles.push({ normal, vertices: [v1, v2, v3] });
  }

  // Create base plate triangles (simplified - just a rectangle)
  const baseZ = 0;
  const topZ = RECESS_START_MM;
  const recessZ = PLATE_HEIGHT_MM;

  // Base bottom face
  addTriangle(
    [0, 0, baseZ],
    [PLATE_SIZE_MM, 0, baseZ],
    [PLATE_SIZE_MM, PLATE_SIZE_MM, baseZ],
    [0, 0, -1]
  );
  addTriangle(
    [0, 0, baseZ],
    [PLATE_SIZE_MM, PLATE_SIZE_MM, baseZ],
    [0, PLATE_SIZE_MM, baseZ],
    [0, 0, -1]
  );

  // Base top face (where recess isn't)
  addTriangle(
    [0, 0, topZ],
    [PLATE_SIZE_MM, PLATE_SIZE_MM, topZ],
    [PLATE_SIZE_MM, 0, topZ],
    [0, 0, 1]
  );
  addTriangle(
    [0, 0, topZ],
    [0, PLATE_SIZE_MM, topZ],
    [PLATE_SIZE_MM, PLATE_SIZE_MM, topZ],
    [0, 0, 1]
  );

  // Side faces
  // Front
  addTriangle([0, 0, baseZ], [PLATE_SIZE_MM, 0, baseZ], [PLATE_SIZE_MM, 0, recessZ], [0, -1, 0]);
  addTriangle([0, 0, baseZ], [PLATE_SIZE_MM, 0, recessZ], [0, 0, recessZ], [0, -1, 0]);
  // Back
  addTriangle([0, PLATE_SIZE_MM, baseZ], [PLATE_SIZE_MM, PLATE_SIZE_MM, recessZ], [PLATE_SIZE_MM, PLATE_SIZE_MM, baseZ], [0, 1, 0]);
  addTriangle([0, PLATE_SIZE_MM, baseZ], [0, PLATE_SIZE_MM, recessZ], [PLATE_SIZE_MM, PLATE_SIZE_MM, recessZ], [0, 1, 0]);
  // Left
  addTriangle([0, 0, baseZ], [0, 0, recessZ], [0, PLATE_SIZE_MM, recessZ], [-1, 0, 0]);
  addTriangle([0, 0, baseZ], [0, PLATE_SIZE_MM, recessZ], [0, PLATE_SIZE_MM, baseZ], [-1, 0, 0]);
  // Right
  addTriangle([PLATE_SIZE_MM, 0, baseZ], [PLATE_SIZE_MM, PLATE_SIZE_MM, recessZ], [PLATE_SIZE_MM, 0, recessZ], [1, 0, 0]);
  addTriangle([PLATE_SIZE_MM, 0, baseZ], [PLATE_SIZE_MM, PLATE_SIZE_MM, baseZ], [PLATE_SIZE_MM, PLATE_SIZE_MM, recessZ], [1, 0, 0]);

  // Create binary STL buffer
  const headerSize = 80;
  const triangleCount = triangles.length;
  const triangleSize = 50; // 12 floats * 4 bytes + 2 bytes attribute
  const bufferSize = headerSize + 4 + triangleCount * triangleSize;

  const buffer = Buffer.alloc(bufferSize);
  let offset = 0;

  // Header (80 bytes)
  buffer.write(`STL for character ${char}`, 0);
  offset = 80;

  // Triangle count (4 bytes)
  buffer.writeUInt32LE(triangleCount, offset);
  offset += 4;

  // Write each triangle
  for (const tri of triangles) {
    // Normal vector (3 floats)
    buffer.writeFloatLE(tri.normal[0], offset); offset += 4;
    buffer.writeFloatLE(tri.normal[1], offset); offset += 4;
    buffer.writeFloatLE(tri.normal[2], offset); offset += 4;

    // Vertices (9 floats)
    for (const v of tri.vertices) {
      buffer.writeFloatLE(v[0], offset); offset += 4;
      buffer.writeFloatLE(v[1], offset); offset += 4;
      buffer.writeFloatLE(v[2], offset); offset += 4;
    }

    // Attribute byte count (2 bytes)
    buffer.writeUInt16LE(0, offset); offset += 2;
  }

  return buffer;
}

/**
 * Generate STL files for a character
 * Creates both OpenSCAD source and a simplified STL
 */
function generateStlFiles(char, outputDir, options = {}) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const charCode = char.charCodeAt(0);

  // Generate OpenSCAD file (can be compiled to proper STL)
  const scadCode = generateOpenScad(char, options);
  if (scadCode) {
    const scadPath = path.join(outputDir, `${charCode}-tile.scad`);
    fs.writeFileSync(scadPath, scadCode);
    console.log(`Generated OpenSCAD: ${scadPath}`);
  }

  // Generate simplified binary STL (base plate only for now)
  const stlBuffer = generateBinaryStl(char, options);
  if (stlBuffer) {
    const stlPath = path.join(outputDir, `${charCode}-base.stl`);
    fs.writeFileSync(stlPath, stlBuffer);
    console.log(`Generated STL base: ${stlPath}`);
  }

  return { scadCode, stlBuffer };
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: node generateStl.js <character> [outputDir]');
    console.log('       node generateStl.js --batch <char1,char2,...> [outputDir]');
    console.log('');
    console.log('Generates OpenSCAD (.scad) files that can be compiled to STL');
    console.log('using: openscad -o output.stl input.scad');
    process.exit(1);
  }

  let outputDir = path.join(__dirname, '..', 'output');

  if (args[0] === '--batch') {
    const chars = args[1].split(',');
    if (args[2]) outputDir = args[2];
    for (const char of chars) {
      generateStlFiles(char, outputDir);
    }
  } else {
    const char = args[0];
    if (args[1]) outputDir = args[1];
    generateStlFiles(char, outputDir);
  }
}

module.exports = {
  buildTile,
  generateOpenScad,
  generateBinaryStl,
  generateStlFiles,
  pathToPolygon,
  svgToModelCoords
};
