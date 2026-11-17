import { useState } from "react";
import { X } from "lucide-react";
import channels from "../../channels.json";
import { useSession } from "./session";

/**
 * 「你是从哪知道准点的？」——只问注册时链接没认出来源的人，只问一次。点一下就行，也可以叉掉（记为跳过）。
 * 只用于统计哪个渠道有用。
 */
export function SourceQuestion() {
  const { session } = useSession();
  const [done, setDone] = useState(false);
  if (!session.askSource || done) return null;
  const answer = (id: string) => {
    setDone(true);
    void fetch("/api/account/source", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: id }),
    }).catch(() => undefined);
  };
  return (
    <div role="group" aria-label="你是从哪知道准点的" data-source-question className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-hairline bg-surface px-4 py-2.5 text-sm text-ink-soft">
      <span className="text-ink">你是从哪知道准点的？</span>
      <span className="flex flex-wrap gap-1.5">
        {channels.answers.map((a) => (
          <button key={a.id} type="button" onClick={() => answer(a.id)} data-source-answer={a.id} className="rounded-full border border-hairline px-2.5 py-0.5 text-xs text-ink-soft hover:bg-raised hover:text-ink">
            {a.label}
          </button>
        ))}
      </span>
      <button type="button" onClick={() => answer("skip")} aria-label="不回答" data-source-answer="skip" className="ml-auto text-ink-faint hover:text-ink-soft">
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
