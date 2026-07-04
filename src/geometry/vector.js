export function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

export function magnitude(v) {
  return Math.hypot(v.x, v.y);
}

export function angleBetweenDegrees(a, b) {
  const mag = magnitude(a) * magnitude(b);
  if (mag === 0) {
    return 0;
  }

  const value = Math.max(-1, Math.min(1, dot(a, b) / mag));
  return (Math.acos(value) * 180) / Math.PI;
}

export function polylineLength(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    if (points[index].moveTo) {
      continue;
    }
    total += distance(points[index - 1], points[index]);
  }
  return total;
}
