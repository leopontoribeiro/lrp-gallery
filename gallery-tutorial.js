// ========== TUTORIAL SCREEN 2 ==========
// Mostra tutorial na primeira vez que galeria é acessada

const TUTORIAL_STORAGE_KEY = 'gallery_tutorial_seen';

class TutorialManager {
    constructor() {
        this.hasSeenTutorial = this.checkTutorialStatus();
    }

    checkTutorialStatus() {
        return localStorage.getItem(TUTORIAL_STORAGE_KEY) === 'true';
    }

    markAsSeen() {
        localStorage.setItem(TUTORIAL_STORAGE_KEY, 'true');
        this.hasSeenTutorial = true;
    }

    showTutorial() {
        if (!this.hasSeenTutorial) {
            const modal = document.getElementById('tutorial-modal');
            if (modal) {
                modal.style.display = 'flex';
                document.body.style.overflow = 'hidden';
            }
        }
    }

    hideTutorial() {
        const modal = document.getElementById('tutorial-modal');
        if (modal) {
            modal.style.display = 'none';
            document.body.style.overflow = 'auto';
        }
        this.markAsSeen();
    }

    skipTutorial() {
        this.hideTutorial();
    }

    getReopendTutorial() {
        const modal = document.getElementById('tutorial-modal');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    }
}

const tutorialManager = new TutorialManager();

// Auto-show tutorial on page load if first time
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        tutorialManager.showTutorial();
    }, 800);
});

// Export global
window.TutorialManager = TutorialManager;
window.tutorialManager = tutorialManager;
