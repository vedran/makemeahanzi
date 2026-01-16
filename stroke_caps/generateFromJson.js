#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { generatePrintableSvg } = require('./generatePrintableSvg.js');
const { generateOpenScad, generateBinaryStl } = require('./generateStl.js');

/**
 * Generate SVG and STL files for all characters in a JSON file
 * @param {string} jsonPath - Path to JSON file with character data
 * @param {string} outputDir - Output directory for generated files
 */
function generateFromJson(jsonPath, outputDir) {
  // Read and parse JSON
  const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
  const characters = JSON.parse(jsonContent);

  // Create output directories
  const svgDir = path.join(outputDir, 'svg');
  const scadDir = path.join(outputDir, 'scad');

  if (!fs.existsSync(svgDir)) {
    fs.mkdirSync(svgDir, { recursive: true });
  }
  if (!fs.existsSync(scadDir)) {
    fs.mkdirSync(scadDir, { recursive: true });
  }

  console.log(`Processing ${characters.length} characters from ${jsonPath}`);

  let successCount = 0;
  let failCount = 0;

  for (const entry of characters) {
    const { character, roman } = entry;
    const charCode = character.charCodeAt(0);

    // Generate SVG
    const svg = generatePrintableSvg(character, { romanization: roman });
    if (svg) {
      const svgPath = path.join(svgDir, `${charCode}-${character}.svg`);
      fs.writeFileSync(svgPath, svg);
    } else {
      console.error(`  Failed to generate SVG for: ${character}`);
      failCount++;
      continue;
    }

    // Generate OpenSCAD
    const scad = generateOpenScad(character, { romanization: roman });
    if (scad) {
      const scadPath = path.join(scadDir, `${charCode}-${character}.scad`);
      fs.writeFileSync(scadPath, scad);
    } else {
      console.error(`  Failed to generate SCAD for: ${character}`);
      failCount++;
      continue;
    }

    successCount++;
    console.log(`  Generated: ${character} (${roman})`);
  }

  console.log(`\nCompleted: ${successCount} successful, ${failCount} failed`);
  console.log(`SVG files: ${svgDir}`);
  console.log(`SCAD files: ${scadDir}`);
}

// CLI entry point
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log('Usage: node generateFromJson.js <json-file> [output-dir]');
    console.log('');
    console.log('Generates SVG and OpenSCAD files for all characters in the JSON file.');
    console.log('JSON format: [{"character": "我", "roman": "ngo5"}, ...]');
    process.exit(1);
  }

  const jsonPath = args[0];
  const outputDir = args[1] || path.join(__dirname, '..', 'output');

  if (!fs.existsSync(jsonPath)) {
    console.error(`JSON file not found: ${jsonPath}`);
    process.exit(1);
  }

  generateFromJson(jsonPath, outputDir);
}

module.exports = { generateFromJson };
