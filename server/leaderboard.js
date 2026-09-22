/**
 * The leaderboard, kept in a JSON file.
 *
 * Only finished games are written, and only by the server, which is the one
 * that decided the result. Abandoned games leave no trace.
 *
 * What is never written here, or anywhere else: the API key. The file holds a
 * display name, a variant, a result and a few counters.
 */

import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

const MAX_NAME_LENGTH = 24;
const MAX_GAMES_KEPT = 5000;

/** Control characters would corrupt the rendering and serve no purpose here. */
const isPrintable = (character) => {
  const code = character.codePointAt(0);
  return code >= 32 && code !== 127;
};

export class Leaderboard {
  constructor(file) {
    this.file = file;
    this.games = [];
    this.loaded = false;
    this.writing = Promise.resolve();
  }

  /** Trims a display name down to something safe to store and to show. */
  static cleanName(raw) {
    const name = [...String(raw ?? '')]
      .map((character) => (isPrintable(character) ? character : ' '))
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, MAX_NAME_LENGTH);
    return name || 'Anonimo';
  }

  async load() {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.file, 'utf8'));
      this.games = Array.isArray(parsed?.games) ? parsed.games : [];
    } catch {
      // A missing or unreadable file just means an empty leaderboard: a game
      // that cannot be recorded must never stop anyone from playing.
      this.games = [];
    }
    this.loaded = true;
  }

  /** Writes through a temporary file, so a crash cannot leave half a JSON behind. */
  async persist() {
    const temporary = `${this.file}.tmp`;
    this.writing = this.writing.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      await writeFile(temporary, JSON.stringify({ games: this.games }, null, 2), 'utf8');
      await rename(temporary, this.file);
    }).catch(() => {});
    return this.writing;
  }

  async record(game) {
    await this.load();

    this.games.push({
      name: Leaderboard.cleanName(game.name),
      variant: game.variant,
      result: game.result,          // 'win' | 'loss' | 'draw', from the human's side
      moves: game.moves,
      jevRequests: game.jevRequests ?? 0,
      jevTokens: game.jevTokens ?? 0,
      endedAt: new Date().toISOString(),
    });

    if (this.games.length > MAX_GAMES_KEPT) this.games = this.games.slice(-MAX_GAMES_KEPT);
    await this.persist();
  }

  /**
   * One row per player for that variant, best first: wins, then win rate, then
   * the fewest moves needed to win.
   */
  async standings(variant, limit = 20) {
    await this.load();

    const rows = new Map();
    for (const game of this.games) {
      if (variant && game.variant !== variant) continue;

      const row = rows.get(game.name) ?? {
        name: game.name, played: 0, wins: 0, draws: 0, losses: 0, bestWinMoves: null,
      };
      row.played++;
      if (game.result === 'win') {
        row.wins++;
        if (row.bestWinMoves === null || game.moves < row.bestWinMoves) row.bestWinMoves = game.moves;
      } else if (game.result === 'draw') {
        row.draws++;
      } else {
        row.losses++;
      }

      rows.set(game.name, row);
    }

    return [...rows.values()]
      .map((row) => ({ ...row, winRate: row.played ? row.wins / row.played : 0 }))
      .sort((a, b) =>
        b.wins - a.wins
        || b.winRate - a.winRate
        || (a.bestWinMoves ?? Infinity) - (b.bestWinMoves ?? Infinity)
        || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  async totals(variant) {
    await this.load();
    const played = this.games.filter((game) => !variant || game.variant === variant);
    return {
      games: played.length,
      humanWins: played.filter((game) => game.result === 'win').length,
      jevWins: played.filter((game) => game.result === 'loss').length,
      draws: played.filter((game) => game.result === 'draw').length,
    };
  }
}
