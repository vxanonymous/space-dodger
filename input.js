// Pointer, touch and keyboard wiring.
//
// Holds no game state. It reports a target x in canvas coordinates and fires a
// callback for pause, which keeps every addEventListener call out of the game
// loop and lets the steering maths be read in one place.

export class InputManager {
    constructor(canvas, { onPauseToggle, initialX = 0 } = {}) {
        this.canvas = canvas;
        this.pointerX = initialX;
        this.onPauseToggle = onPauseToggle || (() => {});

        this.bind();
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
            if (e.repeat || (e.key !== 'p' && e.key !== 'P')) return;
            this.onPauseToggle();
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
