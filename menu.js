// Menu navigation functionality
import { startGame, restartGame, returnToMenu, resetCache } from './game.js';

export function showSection(sectionName) {
    // Hide all content sections
    const sections = document.querySelectorAll('.content-section');
    sections.forEach(section => {
        section.classList.remove('active');
    });
    
    // Remove active class from all nav buttons
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(button => {
        button.classList.remove('active');
    });
    
    // Show selected section
    document.getElementById(`${sectionName}-section`).classList.add('active');
}

// Event listeners
document.addEventListener('DOMContentLoaded', () => {
    // Start game button
    document.getElementById('startGameBtn').addEventListener('click', startGame);
    
    // Restart game button
    document.getElementById('restartGameBtn').addEventListener('click', restartGame);
    
    // Return to menu button
    document.getElementById('returnToMenuBtn').addEventListener('click', returnToMenu);
    
    // Reset cache button
    const resetCacheBtn = document.getElementById('resetCacheBtn');
    if (resetCacheBtn) {
        resetCacheBtn.addEventListener('click', resetCache);
    }
    
    // Navigation buttons
    document.querySelectorAll('.nav-btn').forEach(button => {
        button.addEventListener('click', function() {
            const sectionName = this.getAttribute('data-section');
            showSection(sectionName);
            this.classList.add('active');
        });
    });
});
