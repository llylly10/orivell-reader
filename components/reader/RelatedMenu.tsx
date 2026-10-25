"use client";

import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { Popover, barBtn } from "@/components/ui/Popover";
import { useT } from "@/lib/lang-context";

type Related = { id: string; title?: string; url?: string; source?: string; reason?: string };

function RelatedPanel({ articleId, close }: { articleId: string; close: () => void }) {
  const t = useT();
  const [items, setItems] = useState<Related[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`/api/related/${encodeURIComponent(articleId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => setItems(j.related ?? []))
      .catch(() => setFailed(true));
  }, [articleId]);

  return (
    <div className="space-y-1.5">
      <p className="text-[13px] font-medium text-ink">{t("rel.title")}</p>
      {items === null && !failed && <p className="text-[12px] text-ink-3">{t("common.loading")}</p>}
      {(failed || (items !== null && !items.length)) && <p className="text-[12px] text-ink-3">{t("rel.empty")}</p>}
      {items?.map((r) => (
        <a
          key={r.id}
          href={`/read/${encodeURIComponent(r.id)}`}
          onClick={close}
          className="block rounded-[10px] px-2.5 py-2 transition-colors hover:bg-sunk"
        >
          <span className="block truncate text-[13px] leading-snug text-ink">{r.title || r.url}</span>
          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-3">
            {r.reason && <span className="rounded-full bg-sunk px-1.5 py-0.5">{r.reason}</span>}
            {r.source && <span className="truncate">{r.source}</span>}
          </span>
        </a>
      ))}
    </div>
  );
}

/** 阅读页顶栏的「相关」入口：同一内容的其他帖子、引用链、同作者同来源。 */
export function RelatedMenu({ articleId }: { articleId: string }) {
  const t = useT();
  return (
    <Popover label={t("rel.title")} tip={t("rel.title")} width={320} triggerClass={barBtn} trigger={<Link2 size={16} strokeWidth={1.8} aria-hidden />}>
      {(close) => <RelatedPanel articleId={articleId} close={close} />}
    </Popover>
  );
}
