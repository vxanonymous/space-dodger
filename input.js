// Pointer, touch and keyboard wiring.
//
// Holds no game state. It reports a target x in canvas coordinates, which
// steering keys held down, and fires a callback for pause, which keeps every
// addEventListener call out of the game loop and lets the steering maths be
// read in one place.

const LEFT_KEYS = new Set(['a', 'A', 'ArrowLeft']);
const RIGHT_KEYS = new Set(['d', 'D', 'ArrowRight']);

export class InputManager {
    constructor(canvas, { onPauseToggle, isPlaying, initialX = 0 } = {}) {
        this.canvas = canvas;
        this.pointerX = initialX;
        this.onPauseToggle = onPauseToggle || (() => {});
        this.isPlaying = isPlaying || (() => true);
        this.leftHeld = false;
        this.rightHeld = false;

        this.bind();
    }

    // -1 for left, 1 for right, 0 for neither or both
    keyDirection() {
        return (this.rightHeld ? 1 : 0) - (this.leftHeld ? 1 : 0);
    }

    // Typing a name into the leaderboard form must not steer the ship
    static isTyping(e) {
        const tag = e.target && e.target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA';
    }

    // The canvas is CSS-scaled down on small screens, so a client coordinate
    // has to be mapped back into the canvas's own 800x700 space
    toCanvasX(clientX) {
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width) return this.pointerX;
        return (clientX - rect.left) * (this.canvas.width / rect.width);
    }

    bind() {
        this.canvas.addEventListener('mousemove', (e) => {
            this.pointerX = this.toCanvasX(e.clientX);
        });

        const onTouch = (e) => {
            if (e.touches.length > 0) {
                this.pointerX = this.toCanvasX(e.touches[0].clientX);
                e.preventDefault(); // steering must not scroll the page
            }
        };
        this.canvas.addEventListener('touchstart', onTouch, { passive: false });
        this.canvas.addEventListener('touchmove', onTouch, { passive: false });

        document.addEventListener('keydown', (e) => {
            if (InputManager.isTyping(e)) return;

            if (LEFT_KEYS.has(e.key) || RIGHT_KEYS.has(e.key)) {
                if (LEFT_KEYS.has(e.key)) this.leftHeld = true;
                else this.rightHeld = true;
                if (this.isPlaying()) e.preventDefault();
                return;
            }

            if (e.repeat || (e.key !== 'p' && e.key !== 'P')) return;
            this.onPauseToggle();
        });

        document.addEventListener('keyup', (e) => {
            if (LEFT_KEYS.has(e.key)) this.leftHeld = false;
            if (RIGHT_KEYS.has(e.key)) this.rightHeld = false;
        });

        // A key released while the window is unfocused never sends keyup,
        // which would leave the ship sliding on its own
        window.addEventListener('blur', () => {
            this.leftHeld = false;
            this.rightHeld = false;
        });

        const pauseBtn = document.getElementById('pauseBtn');
        if (pauseBtn) {
            pauseBtn.addEventListener('click', (e) => {
                e.currentTarget.blur(); // keep Enter/Space from re-triggering it
                this.onPauseToggle();
            });
        }

        const resumeBtn = document.getElementById('resumeBtn');
        if (resumeBtn) {
            resumeBtn.addEventListener('click', () => this.onPauseToggle());
        }
    }
}
