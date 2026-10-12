import { SignInGate, UserButton } from "@/lib/auth/gates";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { formatAmount } from "@/game/economy";
import { postScore, publicBoard, standings } from "@/lib/mine.functions";
import { useEffect, useState } from "react";
import { MineSignIn } from "./mine-sign-in";
import { GameModal } from "./game-modal";

type Row = {
  rank: number;
  name: string;
  total: number;
  level: number;
  supporter: boolean;
  you: boolean;
};

export function BoardModal({
  name,
  total,
  level,
  ranked,
  onClose,
}: {
  name: string;
  total: number;
  level: number;
  ranked: boolean;
  onClose: () => void;
}) {
  const user = useCurrentUser();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let stop = false;
    const load = user ? standings() : publicBoard();
    void load
      .then((board) => {
        if (!stop) setRows(board.rows);
      })
      .catch(() => {
        if (!stop) setRows([]);
      });
    return () => {
      stop = true;
    };
  }, [user?.id]);

  async function post() {
    setPosting(true);
    setNote(null);
    try {
      const result = await postScore({ data: { name, total, level } });
      if (!result.ok) {
        setNote(result.error);
        return;
      }
      const board = await standings();
      setRows(board.rows);
      setNote("Score posted.");
    } catch {
      setNote("Sign in to post a score.");
    } finally {
      setPosting(false);
    }
  }

  const top = (rows ?? []).filter((row) => row.rank <= 20);
  const extra = (rows ?? []).find((row) => row.you && row.rank > 20);

  return (
    <GameModal title="Top miners" subtitle="Ranked digs only. Buying $ANT does not raise your score." onClose={onClose}>
      {rows === null ? <p className="fine">Loading the board…</p> : null}
      {rows && top.length === 0 ? <p className="fine">No scores yet. Dig the ranked mine and post yours.</p> : null}
      {top.length > 0 ? (
        <ol className="ranks">
          {top.map((row) => (
            <RankLine key={`${row.rank}-${row.name}`} row={row} />
          ))}
          {extra ? <RankLine row={extra} /> : null}
        </ol>
      ) : null}
      <div className="settings-actions board-actions">
        {ranked ? (
          <SignInGate
            fallback={
              <>
                <p className="fine">Sign in to post this dig.</p>
                <MineSignIn />
              </>
            }
          >
            <button type="button" className="gold-btn" disabled={posting || total < 1} onClick={() => void post()}>
              {posting ? "Posting…" : "Post my ranked score"}
            </button>
            <UserButton />
          </SignInGate>
        ) : (
          <p className="fine">Practice stays off the board. Switch to the ranked mine to post.</p>
        )}
        {note ? <p className="fine">{note}</p> : null}
      </div>
    </GameModal>
  );
}

function RankLine({ row }: { row: Row }) {
  return (
    <li className={row.you ? "rank you" : "rank"}>
      <span className="rank-num">{String(row.rank).padStart(2, "0")}</span>
      <span>
        <strong>
          {row.you ? `${row.name} · you` : row.name}
          {row.supporter ? <em className="supporter"> Supporter</em> : null}
        </strong>
        <small>Level {row.level}</small>
      </span>
      <strong className="rank-score">
        {formatAmount(row.total)} <em>$ANT</em>
      </strong>
    </li>
  );
}
