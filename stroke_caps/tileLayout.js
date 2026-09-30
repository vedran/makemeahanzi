/**
 * Layout of stroke-order markings (number badges, dashed lines, arrowheads)
 * for the 3D printed character tiles.
 *
 * Everything here works in final tile millimetres, so every size constant is
 * the physical size that gets printed.
 */

// Marking sizes (mm). Chosen for a 0.4 mm nozzle: nothing thinner than two
// extrusion widths, digits tall enough to read and trace.
const MARK = {
  dashWidth: 0.8,
  dashLength: 2.2,
  dashGap: 1.6,
  badgeRadius: 3.0,
  badgeRadiusMin: 2.7,
  badgeGap: 0.6,        // clearance between neighbouring badges
  ringWidth: 0.6,       // stroke-colour outline around each badge
  digitSize: 3.6,       // OpenSCAD text size for 1-digit numbers
  digitSize2: 3.0,      // ... and for 2-digit numbers
  digitThicken: 0.1,    // grow glyph outlines so thin parts survive a 0.4 mm nozzle
  headLength: 3.4,
  headWidth: 3.0,
  tipInset: 1.0,        // keep the arrow tip this far back from the stroke end
  lineGapAfterBadge: 0.7,
};

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Polygon with a cached bounding box so most point tests are rejected cheaply */
function indexPolygon(pts) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return { pts, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function inPoly(p, P) {
  if (p[0] < P.minX || p[0] > P.maxX || p[1] < P.minY || p[1] > P.maxY) return false;
  return pointInPolygon(p, P.pts);
}

function pointInPolygon([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInTriangle(p, [a, b, c]) {
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

// Sample points covering a disk, used for area-fraction estimates
function diskSamples([cx, cy], r) {
  const pts = [[cx, cy]];
  for (let ring = 1; ring <= 3; ring++) {
    const rr = (r * ring) / 3;
    const n = ring * 8;
    for (let k = 0; k < n; k++) {
      const a = (2 * Math.PI * k) / n;
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  return pts;
}

function triangleSamples([a, b, c]) {
  const pts = [];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      pts.push([a[0] * u + b[0] * v + c[0] * w, a[1] * u + b[1] * v + c[1] * w]);
    }
  }
  return pts;
}

/** Chaikin corner cutting, keeping the end points */
function chaikin(points, iterations = 3) {
  let pts = points;
  for (let it = 0; it < iterations && pts.length > 2; it++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [p, q] = [pts[i], pts[i + 1]];
      if (i > 0) out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
      if (i < pts.length - 2) out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

/**
 * Arc-length parameterised path. at(s) extrapolates linearly past either end,
 * so badges for very short strokes can sit just before the stroke start.
 */
function makePath(points) {
  const pts = points.filter((p, i) => i === 0 || dist(p, points[i - 1]) > 1e-6);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  const length = cum[cum.length - 1];

  function locate(s) {
    if (pts.length === 1) return { p: pts[0], dir: [1, 0] };
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i++;
    const a = pts[i - 1], b = pts[i];
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (s - cum[i - 1]) / seg; // may be <0 or >1 at the ends (extrapolation)
    const dir = [(b[0] - a[0]) / seg, (b[1] - a[1]) / seg];
    return { p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], dir };
  }

  return {
    length,
    at: (s) => locate(s).p,
    dirAt: (s) => locate(s).dir,
    /** Polyline between two arc positions, sampled every `step` mm */
    slice(s0, s1, step = 0.4) {
      const out = [];
      const n = Math.max(1, Math.ceil((s1 - s0) / step));
      for (let k = 0; k <= n; k++) out.push(locate(s0 + ((s1 - s0) * k) / n).p);
      return out;
    },
  };
}

function arrowheadAt(path, sTip) {
  const tip = path.at(sTip);
  const back = path.at(Math.max(0, sTip - MARK.headLength));
  let dx = tip[0] - back[0], dy = tip[1] - back[1];
  const len = Math.hypot(dx, dy) || 1;
  dx /= len; dy /= len;
  const base = [tip[0] - dx * MARK.headLength, tip[1] - dy * MARK.headLength];
  const px = -dy * (MARK.headWidth / 2), py = dx * (MARK.headWidth / 2);
  return [tip, [base[0] + px, base[1] + py], [base[0] - px, base[1] - py]];
}

function fractionInside(samples, P) {
  return samples.filter((p) => inPoly(p, P)).length / samples.length;
}

/**
 * Lay out markings for one character.
 * @param {Array<Array<[number,number]>>} strokes - stroke outlines in tile mm
 * @param {Array<Array<[number,number]>>} medians - stroke medians in tile mm
 * @returns {{strokes: Array, warnings: string[]}}
 */
function layoutMarkings(strokeOutlines, medians) {
  const strokes = strokeOutlines.map(indexPolygon);
  const paths = medians.map((m) => makePath(chaikin(m)));
  const warnings = [];

  // 1. Arrowheads: as close to the stroke end as possible while staying inside it
  const heads = paths.map((path, i) => {
    let best = null;
    for (let back = 0; back <= 4.0; back += 0.4) {
      const sTip = Math.max(Math.min(path.length, MARK.headLength), path.length - MARK.tipInset - back);
      const tri = arrowheadAt(path, sTip);
      const inside = fractionInside(triangleSamples(tri), strokes[i]);
      if (!best || inside > best.inside + 0.05) best = { sTip, tri, inside };
      if (inside >= 0.9) break;
    }
    return best;
  });

  // 2. Number badges, in stroke order so earlier strokes get the best spots.
  // Candidates run along the start of the stroke and around its start point;
  // a badge may leave its stroke (its outline ring keeps it visible) when that
  // avoids a collision or frees room for the line.
  const minLine = 2 * MARK.dashLength + MARK.dashGap;
  const badges = [];
  paths.forEach((path, i) => {
    const sLineEnd = heads[i].sTip - MARK.headLength + 0.1;
    const lineStart = (c, r) => {
      // first point on the path clear of the badge
      let s = 0;
      while (s < path.length && dist(path.at(s), c) < r + MARK.lineGapAfterBadge) s += 0.2;
      return s;
    };
    const candidates = (r) => {
      const out = [];
      const sMax = Math.max(0, Math.min(0.45 * path.length, sLineEnd - r));
      for (let s = -(r + 0.6); s <= sMax + 1e-9; s += 0.5) {
        const d = path.dirAt(Math.max(0, Math.min(path.length, s)));
        const on = path.at(s);
        for (const n of [0, 0.8, -0.8, 1.6, -1.6]) {
          out.push({ c: [on[0] - d[1] * n, on[1] + d[0] * n], along: Math.max(0, s), side: Math.abs(n) });
        }
      }
      const start = path.at(0);
      for (const rad of [r + 0.8, r + 2.0, r + 3.5]) {
        for (let k = 0; k < 16; k++) {
          const a = (2 * Math.PI * k) / 16;
          out.push({ c: [start[0] + rad * Math.cos(a), start[1] + rad * Math.sin(a)], along: 0, side: rad });
        }
      }
      return out;
    };

    let best = null;
    for (const r of [MARK.badgeRadius, MARK.badgeRadiusMin]) {
      for (const { c, along, side } of candidates(r)) {
        const clash = badges.some((b) => dist(b.center, c) < b.r + r + MARK.badgeGap);
        const samples = diskSamples(c, r);
        const onHead = heads.some((h) => samples.some((p) => pointInTriangle(p, h.tri)));
        const own = fractionInside(samples, strokes[i]);
        const other = samples.filter((p) => strokes.some((P, j) => j !== i && inPoly(p, P))).length / samples.length;
        const s0 = lineStart(c, r);
        const lineShort = Math.max(0, minLine - (sLineEnd - s0));
        const cost = 2.5 * (1 - own) + 3 * other + (clash ? 20 : 0) + (onHead ? 10 : 0)
          + 0.35 * lineShort + along / Math.max(path.length, 1) + 0.12 * side
          + (r < MARK.badgeRadius ? 0.6 : 0);
        if (!best || cost < best.cost) best = { center: c, r, s0, own, other, clash, onHead, cost };
      }
      if (best && !best.clash && !best.onHead) break;
    }
    badges.push(best);
  });

  // 3. Line from badge to arrowhead: dashed when there is room, solid otherwise
  const result = paths.map((path, i) => {
    const badge = badges[i];
    const head = heads[i];
    const s0 = badge.s0;
    const s1 = head.sTip - MARK.headLength + 0.1; // touch the arrowhead base
    const avail = s1 - s0;
    let lines = [];
    let style = 'none';
    const cycle = MARK.dashLength + MARK.dashGap;
    if (avail >= 2 * MARK.dashLength + MARK.dashGap) {
      style = 'dashed';
      const n = Math.max(2, Math.round((avail + MARK.dashGap) / cycle));
      const dash = (avail - (n - 1) * MARK.dashGap) / n; // stretch dashes so they end exactly at the arrowhead
      for (let k = 0; k < n; k++) {
        const a = s0 + k * (dash + MARK.dashGap);
        lines.push(path.slice(a, a + dash));
      }
    } else if (avail > MARK.dashWidth) {
      style = 'solid';
      lines = [path.slice(s0, s1)];
    }

    const num = i + 1;
    if (badge.other > 0.3) warnings.push(`stroke ${num}: number badge ${Math.round(badge.other * 100)}% on another stroke`);
    if (style === 'none') warnings.push(`stroke ${num}: too short for a line, arrowhead only`);
    if (badge.clash) warnings.push(`stroke ${num}: number badge touches another badge`);
    if (badge.onHead) warnings.push(`stroke ${num}: number badge touches an arrowhead`);
    if (head.inside < 0.7) warnings.push(`stroke ${num}: arrowhead only ${Math.round(head.inside * 100)}% inside its stroke`);
    return { number: num, badge, head: head.tri, headInside: head.inside, lines, style };
  });

  return { strokes: result, warnings };
}

module.exports = { MARK, layoutMarkings, pointInPolygon, makePath, chaikin };
