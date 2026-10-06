import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { intersects, sweptBounds, circleContainsPoint, centerOf } from '../collision.js';

const box = (x, y, width = 10, height = 10) => ({ x, y, width, height });

describe('intersects', () => {
    test('overlapping boxes collide', () => {
        assert.equal(intersects(box(0, 0), box(5, 5)), true);
    });

    test('separated boxes do not', () => {
        assert.equal(intersects(box(0, 0), box(20, 0)), false);
        assert.equal(intersects(box(0, 0), box(0, 20)), false);
    });

    test('exactly touching edges do not count as a hit', () => {
        // a spans 0..10, b starts at 10. Grazing the edge should be survivable.
        assert.equal(intersects(box(0, 0), box(10, 0)), false);
        assert.equal(intersects(box(0, 0), box(0, 10)), false);
    });

    test('one box fully inside another collides', () => {
        assert.equal(intersects(box(2, 2, 2, 2), box(0, 0, 10, 10)), true);
    });

    test('is symmetric', () => {
        const a = box(0, 0, 30, 30);
        const b = box(10, 10, 5, 5);
        assert.equal(intersects(a, b), intersects(b, a));
    });
});

describe('sweptBounds', () => {
    test('covers the whole path travelled downward', () => {
        const swept = sweptBounds({ x: 0, y: 100, prevY: 0, width: 30, height: 30 });
        assert.equal(swept.y, 0, 'starts at the previous position');
        assert.equal(swept.height, 130, 'reaches the bottom of the current position');
    });

    test('a stationary obstacle keeps its own bounds', () => {
        const swept = sweptBounds({ x: 5, y: 50, prevY: 50, width: 30, height: 30 });
        assert.deepEqual(swept, { x: 5, y: 50, width: 30, height: 30 });
    });

    test('catches an obstacle that would otherwise tunnel past the player', () => {
        // The gravity attack runs obstacles at 5x. Here one jumps from above the
        // player to below it within a single frame, never overlapping at either
        // endpoint. Without the swept box this is a free pass through the ship.
        const player = { x: 100, y: 680, width: 20, height: 20 };
        const obstacle = { x: 100, y: 720, prevY: 640, width: 30, height: 30 };

        const atPrev = { x: obstacle.x, y: obstacle.prevY, width: 30, height: 30 };
        const atNow = { x: obstacle.x, y: obstacle.y, width: 30, height: 30 };
        assert.equal(intersects(player, atPrev), false, 'no overlap before the step');
        assert.equal(intersects(player, atNow), false, 'no overlap after the step');

        assert.equal(intersects(player, sweptBounds(obstacle)), true, 'swept box catches it');
    });

    test('spans the sideways path of a drifter', () => {
        const swept = sweptBounds({ x: 100, prevX: 90, y: 50, prevY: 50, width: 30, height: 30 });
        assert.deepEqual(swept, { x: 90, y: 50, width: 40, height: 30 });
    });

    test('spans a drifter moving left as well as right', () => {
        const swept = sweptBounds({ x: 90, prevX: 100, y: 50, prevY: 50, width: 30, height: 30 });
        assert.deepEqual(swept, { x: 90, y: 50, width: 40, height: 30 });
    });

    test('catches a drifter that slides across the ship within one frame', () => {
        const player = { x: 100, y: 680, width: 10, height: 10 };
        const obstacle = { x: 115, prevX: 70, y: 670, prevY: 670, width: 30, height: 30 };

        assert.equal(intersects(player, { x: 70, y: 670, width: 30, height: 30 }), false);
        assert.equal(intersects(player, { x: 115, y: 670, width: 30, height: 30 }), false);
        assert.equal(intersects(player, sweptBounds(obstacle)), true, 'swept box catches it');
    });
});

describe('circleContainsPoint', () => {
    test('the centre is inside', () => {
        assert.equal(circleContainsPoint(0, 0, 10, 0, 0), true);
    });

    test('a point beyond the radius is outside', () => {
        assert.equal(circleContainsPoint(0, 0, 10, 11, 0), false);
    });

    test('exactly on the edge is outside', () => {
        assert.equal(circleContainsPoint(0, 0, 10, 10, 0), false);
    });

    test('respects both axes', () => {
        // 3-4-5 triangle: distance is exactly 5
        assert.equal(circleContainsPoint(0, 0, 5.1, 3, 4), true);
        assert.equal(circleContainsPoint(0, 0, 4.9, 3, 4), false);
    });
});

describe('centerOf', () => {
    test('returns the midpoint', () => {
        assert.deepEqual(centerOf({ x: 10, y: 20, width: 20, height: 40 }), { x: 20, y: 40 });
    });
});
