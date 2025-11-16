// Geometry utility functions for safe zone checking

/**
 * Point-in-polygon test using ray casting algorithm
 * @param {Object} point - Point with x and y coordinates (normalized 0-1)
 * @param {Array} polygon - Array of points [{x, y}, ...] (normalized 0-1)
 * @returns {boolean} - True if point is inside polygon
 */
export function isPointInPolygon(point, polygon) {
  // No polygon or invalid polygon = always inside (safe)
  if (!polygon || polygon.length < 3) return true;

  let x = point.x;
  let y = point.y;
  let inside = false;

  // Ray casting algorithm
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    let xi = polygon[i].x;
    let yi = polygon[i].y;
    let xj = polygon[j].x;
    let yj = polygon[j].y;

    let intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Check if a detection bounding box is inside the safe zone
 * Uses the CENTER POINT of the bounding box for checking
 * @param {Object} detection - Detection object with bbox [x1, y1, x2, y2]
 * @param {number} frameWidth - Frame width in pixels
 * @param {number} frameHeight - Frame height in pixels
 * @param {Array} safeZone - Safe zone polygon [{x, y}, ...] (normalized 0-1)
 * @returns {boolean} - True if detection center is inside safe zone
 */
export function isDetectionInSafeZone(
  detection,
  frameWidth,
  frameHeight,
  safeZone
) {
  // No safe zone = always inside (safe by default)
  if (!safeZone || safeZone.length === 0) return true;

  // Get bounding box coordinates
  const [x1, y1, x2, y2] = detection.bbox;

  // Calculate center point of bounding box
  const centerX = (x1 + x2) / 2 / frameWidth; // Normalize to 0-1
  const centerY = (y1 + y2) / 2 / frameHeight; // Normalize to 0-1

  // Check if center point is inside safe zone polygon
  return isPointInPolygon({ x: centerX, y: centerY }, safeZone);
}
