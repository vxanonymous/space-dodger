// Rendering for everything that comes back from the API: the global board,
// the player's own best, the rank line and the name form.
//
// Server data is written with textContent only. A stored player name must
// never reach innerHTML, so this module has no innerHTML in it at all.

const byId = (id) => document.getElementById(id);

export class LeaderboardUI {
    constructor({ onSubmitName } = {}) {
        this.board = byId('leaderboard');
        this.personalBest = byId('personalBest');
        this.rankLine = byId('finalRank');
        this.nameForm = byId('nameForm');
        this.nameInput = byId('playerNameInput');

        const submitBtn = byId('nameSubmitBtn');
        if (submitBtn && onSubmitName) {
            submitBtn.addEventListener('click', () => onSubmitName(this.readName()));
        }
        if (this.nameInput && onSubmitName) {
            this.nameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') onSubmitName(this.readName());
            });
        }
    }

    readName() {
        const raw = (this.nameInput?.value || '').trim().substring(0, 20);
        return raw || 'Anonymous';
    }

    setRankLine(text) {
        if (this.rankLine) this.rankLine.textContent = text;
    }

    showNameForm(visible) {
        this.nameForm?.classList.toggle('hidden', !visible);
    }

    // Replaces the board with a single message row
    showBoardMessage(heading, message) {
        if (!this.board) return;
        const title = document.createElement('h3');
        title.textContent = heading;
        const note = document.createElement('p');
        note.className = 'board-note';
        note.textContent = message;
        this.board.replaceChildren(title, note);
    }

    // ownBest is this player's own best run, resolved server-side by player
    // id. Matching on score and timestamp pins the exact row, where matching
    // on the display name would light up every player who picked that name.
    renderBoard(entries, ownBest) {
        if (!this.board) return;

        if (!entries || entries.length === 0) {
            this.showBoardMessage('Global Leaderboard', 'No scores yet. Be the first!');
            return;
        }

        const ownAt = ownBest ? new Date(ownBest.timestamp).getTime() : null;

        const title = document.createElement('h3');
        title.textContent = 'Global Leaderboard (Top 100)';

        const list = document.createElement('div');
        list.className = 'board-list';

        entries.forEach((entry, index) => {
            const item = document.createElement('div');
            const isOwn = ownAt !== null &&
                entry.score === ownBest.score &&
                new Date(entry.timestamp).getTime() === ownAt;
            item.className = isOwn ? 'board-row board-row-own' : 'board-row';

            const name = document.createElement('strong');
            name.textContent = entry.playerName;

            const date = document.createElement('span');
            date.className = 'board-date';
            date.textContent = new Date(entry.timestamp).toLocaleDateString();

            item.append(
                `${index + 1}. `,
                name,
                isOwn ? ' (you)' : '',
                ` - ${Number(entry.score).toLocaleString()} pts (Level ${entry.level}) `,
                date
            );
            list.appendChild(item);
        });

        this.board.replaceChildren(title, list);
    }

    hidePersonalBest() {
        this.personalBest?.classList.add('hidden');
    }

    renderPersonalBest({ playerName, score, level, timestamp, rank }) {
        if (!this.personalBest) return;

        const heading = document.createElement('h3');
        heading.textContent = `Your Best as ${playerName}`;

        const detail = document.createElement('p');
        detail.textContent = `${Number(score).toLocaleString()} pts ` +
            `(Level ${level}) on ${new Date(timestamp).toLocaleDateString()}`;

        this.personalBest.replaceChildren(heading, detail);

        if (typeof rank === 'number') {
            const rankLine = document.createElement('p');
            rankLine.className = 'personal-best-rank';
            rankLine.textContent = `Global Rank: #${rank.toLocaleString()}`;
            this.personalBest.appendChild(rankLine);
        }

        this.personalBest.classList.remove('hidden');
    }
}
