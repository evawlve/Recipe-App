"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Comments;
const react_1 = require("react");
const comment_1 = require("@/lib/validation/comment");
function Comments({ recipeId, initial, canPost, currentUserId, recipeAuthorId }) {
    const [items, setItems] = (0, react_1.useState)(initial);
    const [body, setBody] = (0, react_1.useState)("");
    const [err, setErr] = (0, react_1.useState)("");
    const [editingId, setEditingId] = (0, react_1.useState)(null);
    const [editBody, setEditBody] = (0, react_1.useState)("");
    // Safety: if somehow in edit mode for a comment you don't own, exit edit
    (0, react_1.useEffect)(() => {
        if (!editingId)
            return;
        const target = items.find((c) => c.id === editingId);
        if (target && currentUserId !== target.user?.id) {
            setEditingId(null);
            setEditBody("");
        }
    }, [editingId, items, currentUserId]);
    async function submit() {
        const v = comment_1.commentBodySchema.safeParse({ body });
        if (!v.success) {
            setErr(v.error.errors[0]?.message ?? "Invalid");
            return;
        }
        setErr("");
        const optimistic = { id: `tmp_${Date.now()}`, body, createdAt: new Date().toISOString(), user: { id: "me", name: "You" } };
        setItems((prev) => [optimistic, ...prev]);
        setBody("");
        const res = await fetch(`/api/recipes/${recipeId}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) });
        if (!res.ok) {
            setItems((prev) => prev.filter((c) => c.id !== optimistic.id));
            setErr("Failed to post");
        }
        else {
            const real = await res.json();
            setItems((prev) => [real, ...prev.filter((c) => c.id !== optimistic.id)]);
        }
    }
    async function remove(id) {
        const keep = items.find((c) => c.id === id);
        setItems((prev) => prev.filter((c) => c.id !== id));
        const res = await fetch(`/api/comments/${id}`, { method: "DELETE" });
        if (!res.ok && keep)
            setItems((prev) => [keep, ...prev]);
    }
    function beginEdit(c) {
        setEditingId(c.id);
        setEditBody(c.body);
    }
    async function saveEdit(id) {
        const v = comment_1.commentBodySchema.safeParse({ body: editBody });
        if (!v.success) {
            setErr(v.error.errors[0]?.message ?? "Invalid");
            return;
        }
        setErr("");
        const prev = items;
        setItems((list) => list.map((c) => c.id === id ? { ...c, body: editBody } : c));
        setEditingId(null);
        const res = await fetch(`/api/comments/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: editBody }) });
        if (!res.ok)
            setItems(prev);
    }
    return (<div className="space-y-4">
			<div className="relative">
				{canPost ? (<div className="space-y-2">
						<textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a comment…" className="w-full resize-y min-h-[96px] rounded-md border border-border p-3"/>
						{err && <p className="text-sm text-red-600">{err}</p>}
						<button onClick={submit} className="rounded-md bg-primary text-primary-foreground px-3 py-1.5">
							Post
						</button>
					</div>) : (<div className="space-y-2">
						<button onClick={() => window.location.href = '/signin'} className="rounded-md bg-primary text-primary-foreground px-3 py-1.5">
							Sign in to comment
						</button>
					</div>)}
				
			</div>
			{items.length === 0 ? (<div className="text-center py-8 text-muted-foreground">
					No comments yet
				</div>) : (<ul className="space-y-3">
					{items.map((c) => (<li key={c.id} className="rounded-md border border-border p-3 space-y-2">
							<div className="flex items-center justify-between">
								<div>
									<div className="text-sm font-medium">{c.user?.name ?? "User"}</div>
									<div className="text-sm text-muted">{new Date(c.createdAt).toLocaleString()}</div>
								</div>
							{/* Action buttons: Edit only for comment author; Delete for comment author or recipe author */}
							<div className="flex gap-2">
								{currentUserId === c.user?.id && editingId === c.id && (<>
										<button onClick={() => saveEdit(c.id)} className="text-xs px-2 py-1 rounded-md border">Save</button>
										<button onClick={() => { setEditingId(null); setEditBody(""); }} className="text-xs px-2 py-1 rounded-md border">Cancel</button>
									</>)}
								{editingId !== c.id && (<>
										{currentUserId === c.user?.id && (<button onClick={() => beginEdit(c)} className="text-xs px-2 py-1 rounded-md border">Edit</button>)}
										{(currentUserId === c.user?.id || currentUserId === recipeAuthorId) && (<button onClick={() => remove(c.id)} className="text-xs px-2 py-1 rounded-md border text-red-600">Delete</button>)}
									</>)}
							</div>
							</div>

							{(editingId === c.id && currentUserId === c.user?.id) ? (<textarea value={editBody} onChange={(e) => setEditBody(e.target.value)} className="w-full resize-y min-h-[72px] rounded-md border border-border p-2"/>) : (<p className="mt-1 whitespace-pre-wrap">{c.body}</p>)}
						</li>))}
				</ul>)}
		</div>);
}
