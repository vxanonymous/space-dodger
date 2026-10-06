// Contracts between the JavaScript, the markup, the stylesheet and the deploy
// workflow. None of these are enforced by the language, and all of them break
// silently in the browser, which makes them worth asserting in CI.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');

const html = read('index.html');
const css = read('style.css');
const workflow = read('.github/workflows/deploy-frontend.yml');

const frontendFiles = readdirSync(ROOT).filter(f => f.endsWith('.js'));
const sources = Object.fromEntries(frontendFiles.map(f => [f, read(f)]));

// Prose in a comment should never satisfy or break a check about real code
const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const code = Object.fromEntries(Object.entries(sources).map(([f, s]) => [f, stripComments(s)]));
const allCode = Object.values(code).join('\n');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));

describe('element ids referenced by JavaScript exist in the markup', () => {
    // hud.js and leaderboard-ui.js reach the DOM through a local byId alias,
    // so matching only getElementById would skip the two modules that do most
    // of the looking up.
    const LOOKUP = /(?:getElementById|byId)\(['"]([^'"]+)['"]\)/g;

    for (const [file, src] of Object.entries(code)) {
        const ids = [...src.matchAll(LOOKUP)].map(m => m[1]);
        if (ids.length === 0) continue;

        test(`${file} references only real ids`, () => {
            const missing = [...new Set(ids)].filter(id => !htmlIds.has(id));
            assert.deepEqual(missing, [], `missing from index.html: ${missing.join(', ')}`);
        });
    }

    test('ids the game writes to every frame are present', () => {
        // These are the HUD's hot path; losing one silently freezes the display
        for (const id of ['score', 'lives', 'level', 'highScore', 'powerUpStatus']) {
            assert.ok(htmlIds.has(id), `#${id} is missing from index.html`);
        }
    });
});

describe('css classes applied from JavaScript are defined', () => {
    // Any kebab-case string literal in the frontend is a class name: module
    // specifiers contain dots and slashes, and the game's own identifiers use
    // underscores, so neither matches this shape. The exception is data-*,
    // which names an HTML attribute rather than a class.
    const kebab = new Set(
        [...allCode.matchAll(/'([a-z][a-z0-9]*(?:-[a-z0-9]+)+)'/g)]
            .map(m => m[1])
            .filter(name => !name.startsWith('data-'))
    );

    for (const className of [...kebab].sort()) {
        test(`.${className} exists in style.css`, () => {
            assert.ok(css.includes(`.${className}`), `.${className} is applied but never styled`);
        });
    }

    test('the classes that replaced inline styles are all styled', () => {
        for (const c of ['toast', 'toast-out', 'pu-shield', 'pu-slow', 'board-list', 'board-row', 'board-date', 'board-note']) {
            assert.ok(css.includes(`.${c}`), `.${c} is missing from style.css`);
        }
    });

    test('the hidden helper still exists, since every overlay depends on it', () => {
        assert.match(css, /\.hidden\s*\{[^}]*display:\s*none/);
    });
});

describe('deploy workflow ships every module', () => {
    // Mirrors the staging step: cp index.html style.css *.js stage/
    const cpLine = workflow.split('\n').find(l => l.trim().startsWith('cp '));
    const staged = new Set(
        cpLine.trim().replace(/^cp /, '').replace(/ stage\/$/, '').split(/\s+/)
            .flatMap(pattern => pattern === '*.js' ? frontendFiles : [pattern])
    );

    test('the entry point named in index.html is staged', () => {
        const entry = html.match(/<script type="module" src="([^"]+)"><\/script>/);
        assert.ok(entry, 'index.html has no module entry point');
        assert.ok(staged.has(entry[1]), `${entry[1]} would not be deployed`);
    });

    test('every module reachable from the entry point is staged', () => {
        // Walk the import graph so a new module can never be left behind
        const seen = new Set();
        const queue = ['menu.js'];
        while (queue.length) {
            const file = queue.pop();
            if (seen.has(file) || !code[file]) continue;
            seen.add(file);
            for (const m of code[file].matchAll(/from\s+'\.\/([^']+)'/g)) {
                queue.push(m[1]);
            }
        }

        assert.ok(seen.size >= 10, `only found ${seen.size} modules, the graph walk is probably broken`);
        const unstaged = [...seen].filter(f => !staged.has(f));
        assert.deepEqual(unstaged, [], `reachable but not deployed: ${unstaged.join(', ')}`);
    });

    test('no backend or config file is staged', () => {
        for (const f of staged) {
            assert.doesNotMatch(f, /server\.js|package\.json|render\.yaml|\.env/, `${f} must not be published`);
        }
    });

    test('test files are not deployed', () => {
        // They live in test/, and the glob only matches the repository root
        assert.equal([...staged].some(f => f.includes('test')), false);
    });
});

describe('module boundaries', () => {
    test('game.js looks up nothing but its own canvas', () => {
        // The point of the split: DOM writes belong to hud.js and
        // leaderboard-ui.js, and listeners to input.js. The canvas is the one
        // element the simulation genuinely owns, since it holds the context.
        const lookups = [...code['game.js'].matchAll(/(?:getElementById|byId)\(['"]([^'"]+)['"]\)/g)]
            .map(m => m[1]);
        assert.deepEqual(lookups, ['gameCanvas'],
            `game.js should delegate DOM access, but also looks up: ${lookups.join(', ')}`);
    });

    test('game.js does not build markup from strings', () => {
        assert.equal(/\.innerHTML/.test(code['game.js']), false);
    });

    test('no module renders server data through innerHTML', () => {
        // Player names come from the API and are rendered as text nodes only
        for (const file of ['leaderboard-ui.js', 'hud.js']) {
            assert.equal(/\.innerHTML/.test(code[file]), false, `${file} uses innerHTML`);
        }
    });

    test('the pure modules stay free of the DOM, so they can be unit tested', () => {
        for (const file of ['collision.js', 'metrics.js', 'config.js']) {
            assert.equal(/\bdocument\./.test(code[file]), false, `${file} touches document`);
        }
    });
});
