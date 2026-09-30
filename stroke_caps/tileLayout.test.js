const { test, describe } = require('node:test');
const assert = require('node:assert');

const { buildTile } = require('./generateStl.js');
const { MARK, makePath } = require('./tileLayout.js');

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe('Tile marking layout', () => {
  // Dense characters where badges used to collide
  for (const [char, roman] of [['高', 'gou1'], ['樹', 'syu6'], ['家', 'gaa1'], ['很', 'han2']]) {
    test(`${char}: one marking per stroke and no overlapping number badges`, () => {
      const { layout } = buildTile(char, { romanization: roman });
      const badges = layout.strokes.map((s) => s.badge);
      assert.deepStrictEqual(layout.strokes.map((s) => s.number), badges.map((_, i) => i + 1));
      for (let i = 0; i < badges.length; i++) {
        for (let j = i + 1; j < badges.length; j++) {
          assert.ok(dist(badges[i].center, badges[j].center) >= badges[i].r + badges[j].r,
            `badges ${i + 1} and ${j + 1} overlap`);
        }
      }
    });
  }

  test('dashes end exactly at the arrowhead base', () => {
    const { layout } = buildTile('一', { romanization: 'jat1' });
    const [stroke] = layout.strokes;
    assert.strictEqual(stroke.style, 'dashed');
    const lastDash = stroke.lines[stroke.lines.length - 1];
    const end = lastDash[lastDash.length - 1];
    const [, w1, w2] = stroke.head;
    const base = [(w1[0] + w2[0]) / 2, (w1[1] + w2[1]) / 2];
    assert.ok(dist(end, base) < 0.2, `gap to arrowhead is ${dist(end, base).toFixed(2)} mm`);
  });

  test('marking sizes are printable with a 0.4 mm nozzle', () => {
    assert.ok(MARK.dashWidth >= 0.8);
    assert.ok(MARK.badgeRadiusMin * 2 >= 5);
    assert.ok(MARK.digitSize2 * (MARK.badgeRadiusMin / MARK.badgeRadius) >= 2.7);
  });

  test('path extrapolates before its start', () => {
    const path = makePath([[0, 0], [10, 0]]);
    assert.deepStrictEqual(path.at(-2), [-2, 0]);
    assert.strictEqual(path.length, 10);
  });
});
