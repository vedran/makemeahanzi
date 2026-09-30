#!/usr/bin/env node

/**
 * Generate two-colour print files for the Snapmaker U1 (or any Orca-based
 * multi-material printer): one .3mf per character, each holding one object
 * with parts assigned to two filaments
 *   filament 1: plate, number badges, dashed lines, arrowheads
 *   filament 2: character strokes, digits, badge outlines, romanization
 *
 * Open the .3mf in Snapmaker Orca with the U1 printer selected, pick the two
 * filaments, and slice.
 *
 * Requires OpenSCAD on the PATH (only 2D operations + linear_extrude are used,
 * so each body exports in well under a second).
 *
 * Usage: node generateU1.js <characters.json> [outputDir]
 *   JSON format: [{"character": "我", "roman": "ngo5"}, ...]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { buildTile } = require('./generateStl.js');

const BED_CENTER_MM = 135; // Snapmaker U1: 270 x 270 mm bed
const TILE_CENTER_MM = 101.6 / 2;

/** Parse an ASCII STL (as written by OpenSCAD) into an indexed mesh */
function readAsciiStl(file) {
  const mesh = { vertices: [], triangles: [], index: new Map() };
  const text = fs.readFileSync(file, 'utf8');
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g;
  let m;
  let tri = [];
  while ((m = re.exec(text))) {
    const key = `${m[1]} ${m[2]} ${m[3]}`;
    let id = mesh.index.get(key);
    if (id === undefined) {
      id = mesh.vertices.length;
      mesh.vertices.push([m[1], m[2], m[3]]);
      mesh.index.set(key, id);
    }
    tri.push(id);
    if (tri.length === 3) {
      // Drop triangles that collapse after vertex merging
      if (tri[0] !== tri[1] && tri[1] !== tri[2] && tri[0] !== tri[2]) mesh.triangles.push(tri);
      tri = [];
    }
  }
  return mesh;
}

function meshXml(id, mesh) {
  const v = mesh.vertices.map(([x, y, z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('');
  const t = mesh.triangles.map(([a, b, c]) => `<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('');
  return `<object id="${id}" type="model"><mesh><vertices>${v}</vertices><triangles>${t}</triangles></mesh></object>`;
}

const xmlEscape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Fixed timestamp (2026-01-01) keeps output reproducible
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/** Minimal ZIP writer (deflate), enough for a 3MF package */
function writeZip(file, entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.from(content);
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, packed);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(DOS_DATE, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(packed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...chunks, ...central, end]));
}

/**
 * Build the 3MF package: one object made of several parts, each assigned a
 * filament in model_settings.config (Orca-based slicers read that file for
 * any 3MF, not only their own).
 * @param {Array<{name: string, mesh: object, extruder: number}>} parts
 */
function write3mf(file, title, parts) {
  // Rotate 180 degrees so the tile reads upright from the front of the bed
  const t = BED_CENTER_MM + TILE_CENTER_MM;
  const objectId = parts.length + 1;
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">${xmlEscape(title)}</metadata>
<resources>
${parts.map((p, i) => meshXml(i + 1, p.mesh)).join('\n')}
<object id="${objectId}" type="model"><components>${parts.map((p, i) => `<component objectid="${i + 1}"/>`).join('')}</components></object>
</resources>
<build><item objectid="${objectId}" transform="-1 0 0 0 -1 0 0 0 1 ${t} ${t} 0"/></build>
</model>
`;
  const partXml = parts.map((p, i) => `    <part id="${i + 1}" subtype="normal_part">
      <metadata key="name" value="${xmlEscape(p.name)}"/>
      <metadata key="extruder" value="${p.extruder}"/>
    </part>`).join('\n');
  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="${objectId}">
    <metadata key="name" value="${xmlEscape(title)}"/>
    <metadata key="extruder" value="1"/>
${partXml}
  </object>
</config>
`;
  writeZip(file, [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>
`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>
`],
    ['3D/3dmodel.model', model],
    ['Metadata/model_settings.config', settings],
  ]);
}

// Print bodies: [OpenSCAD part, part name in the slicer, filament]
const BODIES = [
  ['plate_base', 'Plate base (filament 1)', 1],
  ['plate_top', 'Plate and markings (filament 1)', 1],
  ['inlay', 'Strokes and text (filament 2)', 2],
];

function exportBody(scadFile, part, stlFile) {
  execFileSync('openscad', ['-D', `part="${part}"`, '-o', stlFile, scadFile], { stdio: 'pipe' });
}

/**
 * Generate the .scad and .3mf for one character.
 * @returns {{file: string, warnings: string[]}|null}
 */
function generateU1File(character, roman, outputDir) {
  const tile = buildTile(character, { romanization: roman });
  if (!tile) return null;

  const base = `${character.codePointAt(0)}-${character}`;
  const scadDir = path.join(outputDir, 'scad');
  const u1Dir = path.join(outputDir, 'u1');
  fs.mkdirSync(scadDir, { recursive: true });
  fs.mkdirSync(u1Dir, { recursive: true });

  const scadFile = path.join(scadDir, `${base}.scad`);
  fs.writeFileSync(scadFile, tile.scad);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tile-'));
  try {
    const parts = BODIES.map(([part, name, extruder]) => {
      const stl = path.join(tmp, `${part}.stl`);
      exportBody(scadFile, part, stl);
      return { name, extruder, mesh: readAsciiStl(stl) };
    });

    const file = path.join(u1Dir, `${base}.3mf`);
    write3mf(file, roman ? `${character} ${roman}` : character, parts);
    return { file, warnings: tile.layout.warnings };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  const [jsonPath, outArg] = process.argv.slice(2);
  if (!jsonPath) {
    console.log('Usage: node generateU1.js <characters.json> [outputDir]');
    process.exit(1);
  }
  const outputDir = outArg || path.join(__dirname, '..', 'output');
  const entries = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  let ok = 0;
  const missing = [];
  for (const { character, roman } of entries) {
    const res = generateU1File(character, roman, outputDir);
    if (!res) {
      missing.push(character);
      continue;
    }
    ok++;
    console.log(`  ${character} (${roman})${res.warnings.length ? '  ! ' + res.warnings.join('; ') : ''}`);
  }
  console.log(`\n${ok} print files written to ${path.join(outputDir, 'u1')}`);
  if (missing.length) console.log(`No stroke data for: ${missing.join(' ')}`);
}

module.exports = { generateU1File, write3mf, readAsciiStl };
