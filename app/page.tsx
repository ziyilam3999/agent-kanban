import { loadBoard } from "@/lib/load-board";
import { BoardView } from "@/components/BoardView";

// Always render on demand — the board is a live, polled dashboard, never static.
export const dynamic = "force-dynamic";

// Server shell: render the first paint already populated from the board snapshot,
// then the client component takes over and polls for live transitions.
export default async function Page() {
  const initial = await loadBoard();
  return <BoardView initial={initial} />;
}
