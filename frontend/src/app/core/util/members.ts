import { Member } from '../api/models';

/** Takes part in the game: an approved player, or a Game Master who joined a team (same rule as the server). */
export function playsIn(m: Pick<Member, 'role' | 'status' | 'teamId'> | null | undefined): boolean {
  return !!m && m.status === 'approved' && (m.role === 'player' || !!m.teamId);
}
