const { test, describe } = require('node:test');
const assert = require('node:assert');

const {
  generatePrintableSvg
} = require('./generatePrintableSvg.js');

const { getCharacterData, interpolateMedianPoint } = require('./generateDirectionalSvgs.js');

describe('Printable SVG Generation', () => {
  test('generates valid SVG for character 我', () => {
    const svg = generatePrintableSvg('我');

    assert.ok(typeof svg === 'string', 'SVG should be a string');
    assert.ok(svg.includes('<svg'), 'Should contain svg tag');
    assert.ok(svg.includes('</svg>'), 'Should have closing svg tag');
  });

  test('has black strokes and white arrows', () => {
    const svg = generatePrintableSvg('我');

    assert.ok(svg.includes('fill: #000000') || svg.includes('.stroke { fill: #000000'), 'Strokes should be black');
    assert.ok(svg.includes('stroke: #FFFFFF') || svg.includes('fill: #FFFFFF'), 'Arrows should be white');
  });

  test('has correct number of strokes for 我', () => {
    const svg = generatePrintableSvg('我');

    const strokeMatches = svg.match(/class="stroke"/g);
    assert.ok(strokeMatches, 'Should have stroke elements');
    assert.strictEqual(strokeMatches.length, 7, '我 should have 7 strokes');
  });

  test('has correct number of arrow lines and heads', () => {
    const svg = generatePrintableSvg('我');

    const arrowLineMatches = svg.match(/class="arrow-line"/g);
    const arrowHeadMatches = svg.match(/class="arrow-head"/g);

    assert.ok(arrowLineMatches, 'Should have arrow line elements');
    assert.ok(arrowHeadMatches, 'Should have arrow head elements');
    assert.strictEqual(arrowLineMatches.length, 7, '我 should have 7 arrow lines');
    assert.strictEqual(arrowHeadMatches.length, 7, '我 should have 7 arrow heads');
  });

  test('has stroke numbers', () => {
    const svg = generatePrintableSvg('我');

    for (let i = 1; i <= 7; i++) {
      assert.ok(svg.includes(`>${i}<`), `Should contain stroke number ${i}`);
    }
  });
});

describe('Arrow-Arrowhead Connection', () => {
  test('arrow line ends at arrowhead base for long stroke', () => {
    const svg = generatePrintableSvg('我');
    const data = getCharacterData('我');

    // Stroke 5 is the long vertical stroke (index 4)
    // Get the SVG content for analysis
    const arrowLineMatches = svg.match(/<path d="M [^"]+?" class="arrow-line"\/>/g);
    const arrowHeadMatches = svg.match(/<path d="M [^"]+?" class="arrow-head"\/>/g);

    assert.ok(arrowLineMatches && arrowLineMatches.length >= 5, 'Should have at least 5 arrow lines');
    assert.ok(arrowHeadMatches && arrowHeadMatches.length >= 5, 'Should have at least 5 arrow heads');

    // Extract the 5th arrow line end point
    const stroke5ArrowLine = arrowLineMatches[4];
    const lineCoords = stroke5ArrowLine.match(/[\d.]+/g);
    const lineEndX = parseFloat(lineCoords[lineCoords.length - 2]);
    const lineEndY = parseFloat(lineCoords[lineCoords.length - 1]);

    // Extract the 5th arrowhead base (second and third points of the triangle)
    const stroke5ArrowHead = arrowHeadMatches[4];
    const headCoords = stroke5ArrowHead.match(/[\d.]+/g);
    // Arrowhead is "M tipX tipY L wing1X wing1Y L wing2X wing2Y Z"
    // The base is between wing1 and wing2, so midpoint should be near line end
    const wing1X = parseFloat(headCoords[2]);
    const wing1Y = parseFloat(headCoords[3]);
    const wing2X = parseFloat(headCoords[4]);
    const wing2Y = parseFloat(headCoords[5]);
    const baseMidX = (wing1X + wing2X) / 2;
    const baseMidY = (wing1Y + wing2Y) / 2;

    // Check that line end is close to arrowhead base midpoint (within 5 pixels)
    const distance = Math.sqrt((lineEndX - baseMidX) ** 2 + (lineEndY - baseMidY) ** 2);
    assert.ok(distance < 5, `Arrow line should end near arrowhead base. Distance: ${distance.toFixed(2)}`);
  });

  test('arrow line ends at arrowhead base for short stroke', () => {
    const svg = generatePrintableSvg('我');

    // Stroke 7 is a short stroke (index 6)
    const arrowLineMatches = svg.match(/<path d="M [^"]+?" class="arrow-line"\/>/g);
    const arrowHeadMatches = svg.match(/<path d="M [^"]+?" class="arrow-head"\/>/g);

    const stroke7ArrowLine = arrowLineMatches[6];
    const lineCoords = stroke7ArrowLine.match(/[\d.]+/g);
    const lineEndX = parseFloat(lineCoords[lineCoords.length - 2]);
    const lineEndY = parseFloat(lineCoords[lineCoords.length - 1]);

    const stroke7ArrowHead = arrowHeadMatches[6];
    const headCoords = stroke7ArrowHead.match(/[\d.]+/g);
    const wing1X = parseFloat(headCoords[2]);
    const wing1Y = parseFloat(headCoords[3]);
    const wing2X = parseFloat(headCoords[4]);
    const wing2Y = parseFloat(headCoords[5]);
    const baseMidX = (wing1X + wing2X) / 2;
    const baseMidY = (wing1Y + wing2Y) / 2;

    const distance = Math.sqrt((lineEndX - baseMidX) ** 2 + (lineEndY - baseMidY) ** 2);
    assert.ok(distance < 5, `Arrow line should end near arrowhead base. Distance: ${distance.toFixed(2)}`);
  });
});

describe('Adaptive Positioning', () => {
  test('short strokes have number further along path', () => {
    // Stroke 7 of 我 is short, number should be at ~30%
    const data = getCharacterData('我');
    const shortMedian = data.medians[6]; // Stroke 7 (index 6)

    // Calculate stroke length
    let strokeLength = 0;
    for (let i = 1; i < shortMedian.length; i++) {
      const [x1, y1] = shortMedian[i - 1];
      const [x2, y2] = shortMedian[i];
      strokeLength += Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }

    // Short stroke should have length < 150
    assert.ok(strokeLength < 150, `Stroke 7 should be short (length: ${strokeLength.toFixed(0)})`);
  });

  test('long strokes have number closer to start', () => {
    // Stroke 5 of 我 is long
    const data = getCharacterData('我');
    const longMedian = data.medians[4]; // Stroke 5 (index 4)

    let strokeLength = 0;
    for (let i = 1; i < longMedian.length; i++) {
      const [x1, y1] = longMedian[i - 1];
      const [x2, y2] = longMedian[i];
      strokeLength += Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
    }

    // Long stroke should have length > 400
    assert.ok(strokeLength > 400, `Stroke 5 should be long (length: ${strokeLength.toFixed(0)})`);
  });
});
