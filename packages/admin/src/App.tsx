import { useCallback, useEffect, useState } from "react";
import { api, load, save, type Conn } from "./api.js";
import { templates } from "./templates.js";

type Campaign = { id: string; name: string; type: string; requirements: { key: string; module: string; required?: boolean }[]; merkle: { enabled: boolean } };

export function App() {
  const [conn, setConn] = useState<Conn | null>(load);
  if (!conn) return <Login onConnect={(c) => { save(c); setConn(c); }} />;
  return <Dashboard conn={conn} onDisconnect={() => { localStorage.removeItem("sal-admin"); setConn(null); }} />;
}

function Login({ onConnect }: { onConnect(c: Conn): void }) {
  const [baseUrl, setBaseUrl] = useState("http://localhost:8787");
  const [apiKey, setApiKey] = useState("");
  const [err, setErr] = useState("");
  return (
    <div className="login">
      <h1>Allowlist admin</h1>
      <p className="muted">Connect to your self-hosted allowlist API.</p>
      <div className="field"><label>API URL</label><input className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} /></div>
      <div className="field"><label>Admin API key</label><input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></div>
      {err && <div className="err">{err}</div>}
      <button className="btn primary" onClick={() => api({ baseUrl, apiKey }, "/admin/campaigns").then(() => onConnect({ baseUrl, apiKey })).catch((e) => setErr(e.message))}>Connect</button>
    </div>
  );
}

function Dashboard({ conn, onDisconnect }: { conn: Conn; onDisconnect(): void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selected, setSelected] = useState<string | "new" | "settings" | null>(null);
  const reload = useCallback(() => api<Campaign[]>(conn, "/admin/campaigns").then(setCampaigns), [conn]);
  useEffect(() => { reload(); }, [reload]);
  const current = campaigns.find((c) => c.id === selected);
  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">Allowlist admin</div>
        <nav>
          {campaigns.map((c) => <button key={c.id} aria-current={selected === c.id} onClick={() => setSelected(c.id)}>{c.name}</button>)}
          <button aria-current={selected === "new"} onClick={() => setSelected("new")}>+ New campaign</button>
        </nav>
        <div className="spacer" />
        <nav>
          <button aria-current={selected === "settings"} onClick={() => setSelected("settings")}>Webhooks & API keys</button>
          <button onClick={onDisconnect}>Disconnect</button>
        </nav>
      </aside>
      <main className="main">
        {selected === "new" && <Editor conn={conn} onSaved={(c) => { reload(); setSelected(c.id); }} />}
        {selected === "settings" && <Settings conn={conn} campaigns={campaigns} />}
        {current && <CampaignView key={current.id} conn={conn} campaign={current} onChanged={reload} onDeleted={() => { reload(); setSelected(null); }} />}
        {!selected && <div className="empty">{campaigns.length ? "Pick a campaign" : "No campaigns yet. Create one to get started."}</div>}
      </main>
    </div>
  );
}

function CampaignView({ conn, campaign, onChanged, onDeleted }: { conn: Conn; campaign: Campaign; onChanged(): void; onDeleted(): void }) {
  const [tab, setTab] = useState<"overview" | "entries" | "config" | "export">("overview");
  return (
    <>
      <div className="topbar">
        <div><h1>{campaign.name}</h1><span className="muted">{campaign.type} · <code className="k">{campaign.id}</code></span></div>
        <EmbedSnippet conn={conn} id={campaign.id} />
      </div>
      <div className="tabs">
        {(["overview", "entries", "config", "export"] as const).map((t) => <button key={t} aria-current={tab === t} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {tab === "overview" && <Overview conn={conn} campaign={campaign} />}
      {tab === "entries" && <Entries conn={conn} campaign={campaign} />}
      {tab === "config" && <Editor conn={conn} existing={campaign} onSaved={onChanged} onDeleted={onDeleted} />}
      {tab === "export" && <Export conn={conn} campaign={campaign} />}
    </>
  );
}

function EmbedSnippet({ conn, id }: { conn: Conn; id: string }) {
  const [open, setOpen] = useState(false);
  const snippet = `<div data-allowlist data-base-url="${conn.baseUrl}" data-campaign="${id}"></div>\n<script src="https://unpkg.com/@solana-allowlist/embed/dist/embed.global.js" defer></script>\n<link rel="stylesheet" href="https://unpkg.com/@solana-allowlist/embed/dist/styles.css">`;
  return (
    <div>
      <button className="btn" onClick={() => setOpen(!open)}>Embed code</button>
      {open && <pre className="panel" style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap" }}>{snippet}{"\n\n// React:\n<AllowlistWidget baseUrl=\"" + conn.baseUrl + "\" campaignId=\"" + id + "\" />"}</pre>}
    </div>
  );
}

function Overview({ conn, campaign }: { conn: Conn; campaign: Campaign }) {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState("");
  useEffect(() => { api(conn, `/admin/campaigns/${campaign.id}/stats`).then(setS); }, [conn, campaign.id]);
  if (!s) return <div className="muted">Loading…</div>;
  return (
    <>
      <div className="stats">
        <div className="stat"><b>{s.total}</b><span>Wallets registered</span></div>
        <div className="stat"><b>{s.eligible}</b><span>Eligible</span></div>
        <div className="stat"><b>{s.totalAllocation}</b><span>Total allocation</span></div>
        <div className="stat"><b>{s.last24h}</b><span>New in 24h</span></div>
        <div className="stat"><b>{s.pendingReview}</b><span>Awaiting review</span></div>
      </div>
      <div className="grid2">
        <div className="panel">
          <h2>Completion by requirement</h2>
          <table style={{ marginTop: 10, border: 0 }}>
            <tbody>{Object.entries(s.byRequirement).map(([k, n]) => <tr key={k}><td>{k}</td><td style={{ textAlign: "right" }}>{n as number}</td></tr>)}</tbody>
          </table>
        </div>
        <div className="panel">
          <h2>Snapshot</h2>
          <p className="muted">Re-run every on-chain requirement (token balances, NFT holdings) for all entries. Do this right before you export for mint.</p>
          <button className="btn" onClick={() => api(conn, `/admin/campaigns/${campaign.id}/recheck`, { method: "POST" }).then((r) => setMsg(`Checked ${r.checked}, ${r.changed} changed eligibility`))}>Re-check on-chain requirements</button>
          {msg && <p className="muted">{msg}</p>}
        </div>
      </div>
    </>
  );
}

function Entries({ conn, campaign }: { conn: Conn; campaign: Campaign }) {
  const [data, setData] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const fetchPage = useCallback(() => api(conn, `/admin/campaigns/${campaign.id}/entries?page=${page}&limit=50${filter ? `&eligible=${filter}` : ""}${search ? `&search=${encodeURIComponent(search)}` : ""}`).then(setData), [conn, campaign.id, page, filter, search]);
  useEffect(() => { fetchPage(); }, [fetchPage]);
  const override = (wallet: string, key: string, passed: boolean) =>
    api(conn, `/admin/campaigns/${campaign.id}/entries/${wallet}/requirements/${key}`, { method: "PATCH", body: JSON.stringify({ passed }) }).then(fetchPage);
  const reqs = campaign.requirements.filter((r) => r.module !== "wallet-signature");
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search wallet or referral code" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select className="input" style={{ maxWidth: 160 }} value={filter} onChange={(e) => { setFilter(e.target.value); setPage(1); }}>
          <option value="">All</option><option value="true">Eligible</option><option value="false">Not eligible</option>
        </select>
        <span className="muted">{data?.total ?? 0} entries</span>
      </div>
      <table>
        <thead><tr><th>#</th><th>Wallet</th><th>Status</th><th>Pts</th><th>Alloc</th>{reqs.map((r) => <th key={r.key}>{r.key}</th>)}<th /></tr></thead>
        <tbody>
          {data?.entries.map((e: any) => (
            <>
              <tr key={e.wallet}>
                <td className="muted">{e.rank ?? "—"}</td>
                <td className="addr">{e.wallet}</td>
                <td><span className={`pill ${e.eligible ? "ok" : ""}`}>{e.eligible ? "eligible" : "incomplete"}</span></td>
                <td>{e.points}</td><td>{e.allocation}</td>
                {reqs.map((r) => {
                  const res = e.results[r.key];
                  return <td key={r.key}>{res?.passed ? <span className="pill ok">✓</span> : res?.evidence?.pendingApproval ? <span className="pill pending">review</span> : <span className="muted">—</span>}</td>;
                })}
                <td><button className="btn" onClick={() => setOpen(open === e.wallet ? null : e.wallet)}>{open === e.wallet ? "Close" : "Detail"}</button></td>
              </tr>
              {open === e.wallet && (
                <tr key={e.wallet + "-d"}><td colSpan={6 + reqs.length}>
                  <div className="row" style={{ marginBottom: 8 }}><span className="muted">Referral code</span> <code className="k">{e.referralCode}</code>{e.referredBy && <><span className="muted">referred by</span> <span className="addr">{e.referredBy}</span></>}</div>
                  {reqs.map((r) => {
                    const res = e.results[r.key];
                    return (
                      <div key={r.key} className="row" style={{ padding: "6px 0", borderTop: "1px solid var(--line)" }}>
                        <b style={{ width: 120 }}>{r.key}</b>
                        <span className="muted" style={{ flex: 1 }}>{res ? (res.passed ? "passed" : res.reason) : "not attempted"}{res?.evidence ? ` · ${JSON.stringify(res.evidence).slice(0, 160)}` : ""}</span>
                        <button className="btn" onClick={() => override(e.wallet, r.key, true)}>Approve</button>
                        <button className="btn danger" onClick={() => override(e.wallet, r.key, false)}>Reject</button>
                      </div>
                    );
                  })}
                </td></tr>
              )}
            </>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 12 }}>
        <button className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="muted">Page {page}</span>
        <button className="btn" disabled={!data || page * 50 >= data.total} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </>
  );
}

function Editor({ conn, existing, onSaved, onDeleted }: { conn: Conn; existing?: Campaign; onSaved(c: Campaign): void; onDeleted?(): void }) {
  const [text, setText] = useState(() => JSON.stringify(existing ?? templates["nft-mint"](), null, 2));
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [modules, setModules] = useState<any[]>([]);
  useEffect(() => { api(conn, "/modules").then(setModules).catch(() => {}); }, [conn]);
  const submit = async () => {
    setErr(""); setOk("");
    try {
      const body = JSON.parse(text);
      const c = await api<Campaign>(conn, existing ? `/admin/campaigns/${existing.id}` : "/admin/campaigns", { method: existing ? "PUT" : "POST", body: JSON.stringify(body) });
      setOk("Saved"); onSaved(c);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div className="grid2">
      <div>
        {!existing && (
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="muted">Start from:</span>
            {Object.keys(templates).map((t) => <button key={t} className="btn" onClick={() => setText(JSON.stringify(templates[t](), null, 2))}>{t}</button>)}
          </div>
        )}
        <textarea className="input" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        {err && <div className="err">{err}</div>}
        {ok && <div className="muted" style={{ color: "var(--ok)" }}>{ok}</div>}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn primary" onClick={submit}>{existing ? "Save changes" : "Create campaign"}</button>
          {existing && onDeleted && <button className="btn danger" onClick={() => confirm(`Delete "${existing.name}" and all its entries?`) && api(conn, `/admin/campaigns/${existing.id}`, { method: "DELETE" }).then(onDeleted)}>Delete campaign</button>}
        </div>
      </div>
      <div className="panel">
        <h2>Available modules</h2>
        <p className="muted">Add a requirement as <code className="k">{"{ key, module, config, required?, points? }"}</code>. Config is validated against each module's schema on save.</p>
        {modules.map((m) => <div key={m.id} style={{ padding: "8px 0", borderTop: "1px solid var(--line)" }}><b>{m.label}</b> <code className="k">{m.id}</code><div className="muted">{m.description}</div></div>)}
      </div>
    </div>
  );
}

function Export({ conn, campaign }: { conn: Conn; campaign: Campaign }) {
  const [merkle, setMerkle] = useState<any>(null);
  const dl = (format: string) => window.open(`${conn.baseUrl}/admin/campaigns/${campaign.id}/export?format=${format}`); // opens with key? no — fetch + blob
  const download = async (format: string, all = false) => {
    const r = await fetch(`${conn.baseUrl}/admin/campaigns/${campaign.id}/export?format=${format}&all=${all}&evidence=true`, { headers: { "x-api-key": conn.apiKey } });
    const blob = await r.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${campaign.id}-allowlist.${format === "merkle" ? "json" : format}`;
    a.click();
  };
  void dl;
  return (
    <div className="grid2">
      <div className="panel">
        <h2>Download</h2>
        <p className="muted">Eligible wallets after caps (max entries, total supply) are applied.</p>
        <div className="row">
          <button className="btn" onClick={() => download("csv")}>CSV</button>
          <button className="btn" onClick={() => download("json")}>JSON</button>
          <button className="btn" onClick={() => download("txt")}>Wallet list (.txt)</button>
          <button className="btn" onClick={() => download("csv", true)}>CSV — all entries</button>
        </div>
      </div>
      <div className="panel">
        <h2>Merkle tree</h2>
        <p className="muted">{campaign.merkle?.enabled ? "Root for Candy Guard `allowList`; proofs are also served per wallet from the public eligibility endpoint." : "Enable `merkle` in the campaign config to generate a root."}</p>
        <div className="row">
          <button className="btn" onClick={() => api(conn, `/admin/campaigns/${campaign.id}/export?format=merkle`).then(setMerkle).catch((e) => setMerkle({ error: e.message }))}>Compute root</button>
          <button className="btn" onClick={() => download("merkle")}>Download proofs</button>
        </div>
        {merkle && <pre className="panel" style={{ marginTop: 10, fontSize: 12, overflow: "auto" }}>{merkle.error ?? `root: ${merkle.root}\nwallets: ${merkle.count}`}</pre>}
        <p className="muted" style={{ marginTop: 10 }}>Mint sites can also call <code className="k">GET /campaigns/{campaign.id}/eligibility/:wallet</code> to fetch allocation and proof at mint time.</p>
      </div>
    </div>
  );
}

function Settings({ conn, campaigns }: { conn: Conn; campaigns: Campaign[] }) {
  const [hooks, setHooks] = useState<any[]>([]);
  const [keys, setKeys] = useState<any[]>([]);
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState("");
  const [reveal, setReveal] = useState<string>("");
  const [label, setLabel] = useState("");
  const load = useCallback(() => Promise.all([api(conn, "/admin/webhooks").then(setHooks), api(conn, "/admin/api-keys").then(setKeys)]), [conn]);
  useEffect(() => { load(); }, [load]);
  return (
    <>
      <h1 style={{ marginBottom: 18 }}>Webhooks & API keys</h1>
      {reveal && <div className="panel" style={{ marginBottom: 18, borderColor: "var(--ok)" }}>Copy this now — it won't be shown again:<br /><code className="k">{reveal}</code></div>}
      <div className="grid2">
        <div className="panel">
          <h2>Webhooks</h2>
          <p className="muted">Signed POSTs (HMAC-SHA256, header <code className="k">x-allowlist-signature</code>) on entry and campaign events.</p>
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="input" placeholder="https://yourapp.com/hooks/allowlist" value={url} onChange={(e) => setUrl(e.target.value)} />
            <select className="input" style={{ maxWidth: 200 }} value={scope} onChange={(e) => setScope(e.target.value)}><option value="">All campaigns</option>{campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <button className="btn primary" onClick={() => api(conn, "/admin/webhooks", { method: "POST", body: JSON.stringify({ url, campaignId: scope || undefined }) }).then((w) => { setReveal(`Webhook secret: ${w.secret}`); setUrl(""); load(); })}>Add</button>
          </div>
          <table><tbody>{hooks.map((h) => <tr key={h.id}><td className="addr">{h.url}</td><td className="muted">{h.campaignId ?? "all"}</td><td><button className="btn" onClick={() => api(conn, `/admin/webhooks/${h.id}/test`, { method: "POST" })}>Test</button> <button className="btn danger" onClick={() => api(conn, `/admin/webhooks/${h.id}`, { method: "DELETE" }).then(load)}>Remove</button></td></tr>)}</tbody></table>
        </div>
        <div className="panel">
          <h2>API keys</h2>
          <p className="muted">Read keys can query eligibility from your mint site's backend. Admin keys can do everything.</p>
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="input" placeholder="Label (e.g. mint-site)" value={label} onChange={(e) => setLabel(e.target.value)} />
            <button className="btn" onClick={() => api(conn, "/admin/api-keys", { method: "POST", body: JSON.stringify({ label, scopes: ["read"] }) }).then((k) => { setReveal(`Read key: ${k.key}`); setLabel(""); load(); })}>Create read key</button>
            <button className="btn" onClick={() => api(conn, "/admin/api-keys", { method: "POST", body: JSON.stringify({ label, scopes: ["admin", "read"] }) }).then((k) => { setReveal(`Admin key: ${k.key}`); setLabel(""); load(); })}>Create admin key</button>
          </div>
          <table><tbody>{keys.map((k) => <tr key={k.id}><td>{k.label}</td><td className="muted">{k.scopes.join(", ")}</td><td><button className="btn danger" onClick={() => api(conn, `/admin/api-keys/${k.id}`, { method: "DELETE" }).then(load)}>Revoke</button></td></tr>)}</tbody></table>
        </div>
      </div>
    </>
  );
}
