"use client";
import { useEffect, useState } from "react";
import { commentBodySchema } from "@/lib/validation/comment";
import { formatDistanceToNow } from "date-fns";
import Image from "next/image";

type CommentItem = { 
	id:string; 
	body:string; 
	createdAt:string; 
	user:{ 
		id:string; 
		name:string|null; 
		username:string|null; 
		displayName:string|null; 
		avatarKey:string|null; 
	} 
};

export default function Comments({ recipeId, initial, canPost, currentUserId, recipeAuthorId }:{ recipeId:string; initial: CommentItem[]; canPost: boolean; currentUserId?: string|null; recipeAuthorId?: string }) {
	const [items, setItems] = useState<CommentItem[]>(initial);
	const [body, setBody] = useState("");
	const [err, setErr] = useState("");
	const [editingId, setEditingId] = useState<string|null>(null);
	const [editBody, setEditBody] = useState("");

	// Safety: if somehow in edit mode for a comment you don't own, exit edit
	useEffect(() => {
		if (!editingId) return;
		const target = items.find((c) => c.id === editingId);
		if (target && currentUserId !== target.user?.id) {
			setEditingId(null);
			setEditBody("");
		}
	}, [editingId, items, currentUserId]);

	async function submit() {
		const v = commentBodySchema.safeParse({ body });
		if (!v.success) { setErr(v.error.errors[0]?.message ?? "Invalid"); return; }
		setErr("");
		const optimistic: CommentItem = { 
			id: `tmp_${Date.now()}`, 
			body, 
			createdAt: new Date().toISOString(), 
			user: { 
				id: "me", 
				name: "You", 
				username: null, 
				displayName: null, 
				avatarKey: null 
			} 
		};
		setItems((prev)=>[optimistic, ...prev]);
		setBody("");
		const res = await fetch(`/api/recipes/${recipeId}/comments`, { method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ body }) });
		if (!res.ok) {
			setItems((prev)=>prev.filter((c)=>c.id !== optimistic.id));
			setErr("Failed to post");
		} else {
			const real: CommentItem = await res.json();
			setItems((prev)=>[real, ...prev.filter((c)=>c.id !== optimistic.id)]);
		}
	}

	async function remove(id:string) {
		const keep = items.find((c)=>c.id===id) as CommentItem | undefined;
		setItems((prev)=>prev.filter((c)=>c.id!==id));
		const res = await fetch(`/api/comments/${id}`, { method:"DELETE" });
		if (!res.ok && keep) setItems((prev)=>[keep, ...prev]);
	}

	function beginEdit(c: CommentItem) {
		setEditingId(c.id);
		setEditBody(c.body);
	}

	async function saveEdit(id: string) {
		const v = commentBodySchema.safeParse({ body: editBody });
		if (!v.success) { setErr(v.error.errors[0]?.message ?? "Invalid"); return; }
		setErr("");
		const prev = items;
		setItems((list)=>list.map((c)=>c.id===id ? { ...c, body: editBody } : c));
		setEditingId(null);
		const res = await fetch(`/api/comments/${id}`, { method:"PATCH", headers:{ "Content-Type":"application/json" }, body: JSON.stringify({ body: editBody }) });
		if (!res.ok) setItems(prev);
	}

	return (
		<div className="space-y-4">
			<div className="relative">
				{canPost ? (
					<div className="space-y-2">
						<textarea 
							value={body} 
							onChange={(e)=>setBody(e.target.value)}
							placeholder="Add a comment…" 
							className="w-full resize-y min-h-[96px] rounded-md border border-border p-3"
						/>
						{err && <p className="text-sm text-red-600">{err}</p>}
						<button 
							onClick={submit} 
							className="rounded-md bg-primary text-primary-foreground px-3 py-1.5"
						>
							Post
						</button>
					</div>
				) : (
					<div className="space-y-2">
						<button 
							onClick={() => window.location.href = '/signin'} 
							className="rounded-md bg-primary text-primary-foreground px-3 py-1.5"
						>
							Sign in to comment
						</button>
					</div>
				)}
				
			</div>
			{items.length === 0 ? (
				<div className="text-center py-8 text-muted-foreground">
					No comments yet
				</div>
			) : (
				<ul className="space-y-3">
					{items.map((c)=>{
						const displayName = c.user?.displayName || c.user?.name || "User";
						const avatarSize = 40;
						return (
							<li key={c.id} className="rounded-md border border-border p-3 space-y-2">
								{/* Header with avatar, name, and timestamp */}
								<div className="flex items-start gap-3">
									{/* Avatar */}
									<div 
										className="relative rounded-full overflow-hidden bg-muted flex-shrink-0" 
										style={{ width: avatarSize, height: avatarSize }}
									>
										{c.user?.avatarKey ? (
											<Image
												src={`/api/image/${c.user.avatarKey}`}
												alt={`${displayName} avatar`}
												width={avatarSize}
												height={avatarSize}
												className="object-cover w-full h-full"
											/>
										) : (
											<div className="w-full h-full bg-primary/10 flex items-center justify-center text-primary font-bold">
												{displayName.charAt(0).toUpperCase()}
											</div>
										)}
									</div>

									{/* Name and username */}
									<div className="flex-1 min-w-0">
										<div className="text-sm font-medium">{displayName}</div>
										{c.user?.username && (
											<div className="text-xs text-muted-foreground">@{c.user.username}</div>
										)}
									</div>

									{/* Timestamp at top right */}
									<div className="text-xs text-muted-foreground flex-shrink-0">
										{formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
									</div>
								</div>

								{/* Comment body or edit textarea */}
								{(editingId === c.id && currentUserId === c.user?.id) ? (
									<textarea 
										value={editBody} 
										onChange={(e)=>setEditBody(e.target.value)} 
										className="w-full resize-y min-h-[72px] rounded-md border border-border p-2" 
									/>
								) : (
									<p className="whitespace-pre-wrap ml-[52px]">{c.body}</p>
								)}

								{/* Action buttons: Edit only for comment author; Delete for comment author or recipe author */}
								{(currentUserId === c.user?.id || currentUserId === recipeAuthorId) && (
									<div className="flex gap-2 ml-[52px]">
										{currentUserId === c.user?.id && editingId === c.id && (
											<>
												<button onClick={()=>saveEdit(c.id)} className="text-xs px-2 py-1 rounded-md border">Save</button>
												<button onClick={()=>{ setEditingId(null); setEditBody(""); }} className="text-xs px-2 py-1 rounded-md border">Cancel</button>
											</>
										)}
										{editingId !== c.id && (
											<>
												{currentUserId === c.user?.id && (
													<button onClick={()=>beginEdit(c)} className="text-xs px-2 py-1 rounded-md border">Edit</button>
												)}
												{(currentUserId === c.user?.id || currentUserId === recipeAuthorId) && (
													<button onClick={()=>remove(c.id)} className="text-xs px-2 py-1 rounded-md border text-red-600">Delete</button>
												)}
											</>
										)}
									</div>
								)}
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
}


