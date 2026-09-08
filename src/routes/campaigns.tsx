import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Timestamp,
} from "firebase/firestore";
import { Bird, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { db } from "../lib/firebase";

export const Route = createFileRoute("/campaigns")({
  head: () => ({
    meta: [
      { title: "Fly — Campaigns" },
      {
        name: "description",
        content: "Create and manage campaigns with a name, link and status.",
      },
      { property: "og:title", content: "Fly — Campaigns" },
      {
        property: "og:description",
        content: "Create and manage campaigns with a name, link and status.",
      },
      { property: "og:type", content: "website" },
    ],
  }),
  component: CampaignsPage,
});

type CampaignStatus = "active" | "paused" | "ended";

interface Campaign {
  id: string;
  name: string;
  link: string;
  status: CampaignStatus;
  createdAt?: Timestamp;
}

const STATUS_OPTIONS: { value: CampaignStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Ended" },
];

const STATUS_STYLES: Record<CampaignStatus, string> = {
  active: "bg-emerald-50 text-emerald-600 border-emerald-200",
  paused: "bg-amber-50 text-amber-600 border-amber-200",
  ended: "bg-gray-100 text-gray-500 border-gray-200",
};

function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [status, setStatus] = useState<CampaignStatus>("active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const q = query(collection(db, "campaigns"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setCampaigns(
          snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Campaign, "id">) })),
        );
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !link.trim()) {
      setError("নাম এবং লিংক দুটোই দিতে হবে।");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await addDoc(collection(db, "campaigns"), {
        name: name.trim(),
        link: link.trim(),
        status,
        createdAt: serverTimestamp(),
      });
      setName("");
      setLink("");
      setStatus("active");
    } catch {
      setError("ক্যাম্পেন যোগ করা যায়নি। আবার চেষ্টা করুন।");
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (id: string, next: CampaignStatus) => {
    await updateDoc(doc(db, "campaigns", id), { status: next });
  };

  const remove = async (id: string) => {
    await deleteDoc(doc(db, "campaigns", id));
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="sticky top-0 bg-white/90 backdrop-blur-xl border-b border-gray-100 px-5 h-14 flex items-center gap-2 z-10">
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-sky-400 to-cyan-500 flex items-center justify-center">
          <Bird size={18} className="text-white" />
        </div>
        <h1 className="text-xl font-bold text-gray-900">Campaigns</h1>
      </header>

      <main className="max-w-xl mx-auto px-4 py-6 space-y-6">
        <form
          onSubmit={submit}
          className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4 shadow-sm"
        >
          <h2 className="text-base font-semibold text-gray-900">নতুন ক্যাম্পেন</h2>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500" htmlFor="campaign-name">
              নাম
            </label>
            <input
              id="campaign-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="ক্যাম্পেনের নাম"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500" htmlFor="campaign-link">
              লিংক
            </label>
            <input
              id="campaign-link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…"
              inputMode="url"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500" htmlFor="campaign-status">
              স্টেটাস
            </label>
            <select
              id="campaign-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as CampaignStatus)}
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none bg-white focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
            >
              {STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-400 to-cyan-500 text-white text-sm font-semibold py-2.5 active:scale-[0.98] transition-transform disabled:opacity-60"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            ক্যাম্পেন যোগ করুন
          </button>
        </form>

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-gray-900">সব ক্যাম্পেন</h2>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="animate-spin text-sky-500" />
            </div>
          ) : campaigns.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-10">
              এখনও কোনো ক্যাম্পেন নেই। উপরে থেকে যোগ করুন।
            </p>
          ) : (
            campaigns.map((c) => (
              <article
                key={c.id}
                className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex items-start gap-3"
              >
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-gray-900 truncate">{c.name}</h3>
                  <a
                    href={c.link}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-xs text-sky-500 hover:underline break-all"
                  >
                    <ExternalLink size={12} className="shrink-0" />
                    {c.link}
                  </a>
                  <div className="mt-2">
                    <select
                      value={c.status}
                      onChange={(e) => changeStatus(c.id, e.target.value as CampaignStatus)}
                      aria-label="স্টেটাস বদলান"
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold outline-none ${STATUS_STYLES[c.status] ?? STATUS_STYLES.active}`}
                    >
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button
                  onClick={() => remove(c.id)}
                  aria-label="ক্যাম্পেন মুছুন"
                  className="w-8 h-8 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-400 hover:text-red-500 active:scale-90 transition"
                >
                  <Trash2 size={14} />
                </button>
              </article>
            ))
          )}
        </section>
      </main>
    </div>
  );
}
