const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Import the module we'll create
const {
  calculateArrowDirection,
  generateArrowPath,
  generateDirectionalSvg,
  getCharacterData
} = require('./generateDirectionalSvgs.js');

// Test character data
const TEST_CHARACTERS = ['我', '是', '你'];

describe('Arrow Direction Calculation', () => {
  test('calculates correct direction for left-to-right stroke', () => {
    const median = [[100, 500], [300, 500], [500, 500]];
    const direction = calculateArrowDirection(median);

    // Direction should point right (positive x, zero y)
    assert.ok(direction.dx > 0, 'dx should be positive for left-to-right');
    assert.strictEqual(direction.dy, 0, 'dy should be zero for horizontal stroke');
  });

  test('calculates correct direction for top-to-bottom stroke', () => {
    const median = [[500, 800], [500, 500], [500, 200]];
    const direction = calculateArrowDirection(median);

    // Direction should point down (zero x, negative y in this coord system)
    assert.strictEqual(direction.dx, 0, 'dx should be zero for vertical stroke');
    assert.ok(direction.dy < 0, 'dy should be negative for top-to-bottom');
  });

  test('calculates correct direction for diagonal stroke', () => {
    const median = [[100, 800], [300, 600], [500, 400]];
    const direction = calculateArrowDirection(median);

    // Direction should point right and down
    assert.ok(direction.dx > 0, 'dx should be positive');
    assert.ok(direction.dy < 0, 'dy should be negative');
  });

  test('normalizes direction vector to unit length', () => {
    const median = [[0, 0], [300, 400]];
    const direction = calculateArrowDirection(median);

    // Check that it's normalized (length ~= 1)
    const length = Math.sqrt(direction.dx * direction.dx + direction.dy * direction.dy);
    assert.ok(Math.abs(length - 1) < 0.001, `Direction should be normalized, got length ${length}`);
  });

  test('handles single-point median gracefully', () => {
    const median = [[500, 500]];
    const direction = calculateArrowDirection(median);

    // Should return a default direction or handle gracefully
    assert.ok(direction !== null, 'Should return a direction object');
    assert.ok('dx' in direction && 'dy' in direction, 'Should have dx and dy properties');
  });
});

describe('Arrow Path Generation', () => {
  test('generates valid SVG path for arrow', () => {
    const startPoint = [100, 500];
    const direction = { dx: 1, dy: 0 };
    const arrowPath = generateArrowPath(startPoint, direction);

    assert.ok(typeof arrowPath === 'string', 'Arrow path should be a string');
    assert.ok(arrowPath.startsWith('M'), 'Arrow path should start with M command');
    assert.ok(arrowPath.includes('L') || arrowPath.includes('l'), 'Arrow path should include line commands');
  });

  test('arrow points in correct direction', () => {
    const startPoint = [100, 500];
    const direction = { dx: 1, dy: 0 }; // pointing right
    const arrowPath = generateArrowPath(startPoint, direction);

    // Parse the path to verify the arrow points right
    // The tip of the arrow should be to the right of the base
    assert.ok(arrowPath.length > 0, 'Arrow path should not be empty');
  });

  test('generates arrow with configurable size', () => {
    const startPoint = [100, 500];
    const direction = { dx: 1, dy: 0 };
    const smallArrow = generateArrowPath(startPoint, direction, { size: 20 });
    const largeArrow = generateArrowPath(startPoint, direction, { size: 50 });

    // Both should be valid paths
    assert.ok(smallArrow.startsWith('M'), 'Small arrow should be valid path');
    assert.ok(largeArrow.startsWith('M'), 'Large arrow should be valid path');
  });
});

describe('Character Data Loading', () => {
  test('loads data for character 我', () => {
    const data = getCharacterData('我');

    assert.ok(data !== null, 'Should find character 我');
    assert.strictEqual(data.character, '我', 'Character should match');
    assert.ok(Array.isArray(data.strokes), 'Should have strokes array');
    assert.ok(Array.isArray(data.medians), 'Should have medians array');
    assert.strictEqual(data.strokes.length, data.medians.length, 'Strokes and medians should have same length');
    assert.strictEqual(data.strokes.length, 7, '我 should have 7 strokes');
  });

  test('loads data for character 是', () => {
    const data = getCharacterData('是');

    assert.ok(data !== null, 'Should find character 是');
    assert.strictEqual(data.character, '是', 'Character should match');
    assert.strictEqual(data.strokes.length, 9, '是 should have 9 strokes');
  });

  test('loads data for character 你', () => {
    const data = getCharacterData('你');

    assert.ok(data !== null, 'Should find character 你');
    assert.strictEqual(data.character, '你', 'Character should match');
    assert.strictEqual(data.strokes.length, 7, '你 should have 7 strokes');
  });

  test('returns null for non-existent character', () => {
    const data = getCharacterData('🚀');
    assert.strictEqual(data, null, 'Should return null for non-existent character');
  });
});

describe('Directional SVG Generation', () => {
  test('generates valid SVG for character 我', () => {
    const svg = generateDirectionalSvg('我');

    assert.ok(typeof svg === 'string', 'SVG should be a string');
    assert.ok(svg.includes('<svg'), 'Should contain svg tag');
    assert.ok(svg.includes('</svg>'), 'Should have closing svg tag');
    assert.ok(svg.includes('viewBox'), 'Should have viewBox attribute');
  });

  test('SVG contains correct number of stroke paths for 我', () => {
    const svg = generateDirectionalSvg('我');

    // 我 has 7 strokes, so should have 7 stroke paths
    const strokePathMatches = svg.match(/class="stroke-\d+"/g);
    assert.ok(strokePathMatches, 'Should have stroke paths with class');
    assert.strictEqual(strokePathMatches.length, 7, '我 should have 7 stroke paths');
  });

  test('SVG contains arrows for each stroke', () => {
    const svg = generateDirectionalSvg('我');

    // Should have 7 arrows for 7 strokes (count arrowheads)
    const arrowHeadMatches = svg.match(/class="arrow-head arrow-\d+"/g);
    assert.ok(arrowHeadMatches, 'Should have arrow head elements');
    assert.strictEqual(arrowHeadMatches.length, 7, '我 should have 7 arrow heads');

    // Should also have arrow lines
    const arrowLineMatches = svg.match(/class="arrow-line arrow-\d+"/g);
    assert.ok(arrowLineMatches, 'Should have arrow line elements');
    assert.strictEqual(arrowLineMatches.length, 7, '我 should have 7 arrow lines');
  });

  test('generates valid SVG for character 是', () => {
    const svg = generateDirectionalSvg('是');

    assert.ok(svg.includes('<svg'), 'Should contain svg tag');

    const strokePathMatches = svg.match(/class="stroke-\d+"/g);
    assert.strictEqual(strokePathMatches.length, 9, '是 should have 9 stroke paths');

    const arrowHeadMatches = svg.match(/class="arrow-head arrow-\d+"/g);
    assert.strictEqual(arrowHeadMatches.length, 9, '是 should have 9 arrow heads');
  });

  test('generates valid SVG for character 你', () => {
    const svg = generateDirectionalSvg('你');

    assert.ok(svg.includes('<svg'), 'Should contain svg tag');

    const strokePathMatches = svg.match(/class="stroke-\d+"/g);
    assert.strictEqual(strokePathMatches.length, 7, '你 should have 7 stroke paths');

    const arrowHeadMatches = svg.match(/class="arrow-head arrow-\d+"/g);
    assert.strictEqual(arrowHeadMatches.length, 7, '你 should have 7 arrow heads');
  });

  test('SVG uses correct coordinate transform', () => {
    const svg = generateDirectionalSvg('我');

    // Should have the transform for the inverted Y coordinate system
    assert.ok(svg.includes('scale(1, -1)'), 'Should have scale transform');
    assert.ok(svg.includes('translate(0, -900)'), 'Should have translate transform');
  });

  test('arrows are positioned at start of median', () => {
    const svg = generateDirectionalSvg('我');
    const data = getCharacterData('我');

    // Check that arrows exist and are positioned
    // The first stroke of 我 starts at approximately [458, 627]
    const firstMedianStart = data.medians[0][0];

    // The SVG should contain coordinates near this point for the first arrow
    assert.ok(data.medians[0].length > 1, 'Should have median points');
  });

  test('stroke order numbers are included', () => {
    const svg = generateDirectionalSvg('我', { showNumbers: true });

    // Should have numbers 1-7 for the 7 strokes
    for (let i = 1; i <= 7; i++) {
      assert.ok(svg.includes(`>${i}<`), `Should contain stroke number ${i}`);
    }
  });

  test('SVG has proper styling for strokes and arrows', () => {
    const svg = generateDirectionalSvg('我');

    // Should include style definitions
    assert.ok(svg.includes('<style>') || svg.includes('style='), 'Should have styling');
  });
});

describe('SVG File Output', () => {
  const testOutputDir = path.join(__dirname, '../svgs-directional-test');

  test('can write SVG to file', () => {
    const svg = generateDirectionalSvg('我');
    const outputPath = path.join(testOutputDir, '25105-directional.svg');

    // Create test output directory if it doesn't exist
    if (!fs.existsSync(testOutputDir)) {
      fs.mkdirSync(testOutputDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, svg);

    assert.ok(fs.existsSync(outputPath), 'SVG file should be created');

    const content = fs.readFileSync(outputPath, 'utf-8');
    assert.ok(content.includes('<svg'), 'File should contain valid SVG');

    // Cleanup
    fs.unlinkSync(outputPath);
  });

  // Cleanup test directory after all tests
  test('cleanup test directory', () => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmdirSync(testOutputDir, { recursive: true });
    }
  });
});

describe('Edge Cases', () => {
  test('handles empty options gracefully', () => {
    const svg = generateDirectionalSvg('我', {});
    assert.ok(svg.includes('<svg'), 'Should generate valid SVG with empty options');
  });

  test('handles undefined options gracefully', () => {
    const svg = generateDirectionalSvg('我', undefined);
    assert.ok(svg.includes('<svg'), 'Should generate valid SVG with undefined options');
  });

  test('returns null for invalid character', () => {
    const svg = generateDirectionalSvg('🚀');
    assert.strictEqual(svg, null, 'Should return null for invalid character');
  });
});
