// Collision geometry.
//
// Everything here is a function of its arguments: no DOM, no game state, no
// randomness. That is deliberate, because these are the rules that decide
// whether a run ends, and they are the part most worth testing directly.

// Axis-aligned bounding box overlap. Touching edges do not count as a hit.
export function intersects(a, b) {
    return a.x < b.x + b.width &&
           a.x + a.width > b.x &&
           a.y < b.y + b.height &&
           a.y + a.height > b.y;
}

// The box covering the whole path an obstacle travelled this frame.
//
// Testing only the obstacle's current position lets fast ones step clean over
// the player between frames. The gravity attack runs obstacles at five times
// speed, which is well past the player's 20px height at any normal frame rate,
// so the swept box is what keeps those hits registering. Drifters also move
// sideways, so the box spans prevX too; an obstacle without one only falls.
export function sweptBounds(obstacle) {
    const top = Math.min(obstacle.prevY, obstacle.y);
    const prevX = obstacle.prevX ?? obstacle.x;
    const left = Math.min(prevX, obstacle.x);
    return {
        x: left,
        y: top,
        width: Math.max(prevX, obstacle.x) + obstacle.width - left,
        height: obstacle.y + obstacle.height - top
    };
}

// Whether a point falls inside a circle. The giant obstacle tests the player's
// centre rather than its box, which is why this takes a point and not a rect.
export function circleContainsPoint(cx, cy, radius, px, py) {
    const dx = px - cx;
    const dy = py - cy;
    return Math.sqrt(dx * dx + dy * dy) < radius;
}

// Centre of a rectangle. Explosions spawn here and the circle test reads it.
export function centerOf(rect) {
    return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2
    };
}
