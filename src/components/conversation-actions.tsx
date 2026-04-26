import { ContextMenu } from "@base-ui-components/react/context-menu";
import { Dialog } from "@base-ui-components/react/dialog";
import { useState } from "react";
import { Archive, ArchiveRestore, Check, Palette, Pencil, Trash2 } from "lucide-react";
import { cn } from "../lib/cn";
import {
  ApiRequestError,
  deleteConversation,
  updateConversation,
  type Conversation,
  type Project,
} from "../lib/api";
import { CONVERSATION_COLORS, COLOR_SWATCHES, type ConversationColor } from "../lib/slash-commands";

const POPUP_BASE =
  "min-w-44 rounded-xl border border-border/60 bg-popover p-1 text-sm text-popover-foreground shadow-lg outline-none";
const ITEM_BASE =
  "flex cursor-pointer select-none items-center gap-2 rounded-lg px-2 py-1.5 outline-none transition data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground";
const ITEM_DESTRUCTIVE =
  "data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive text-destructive";

export function ConversationContextMenu({
  conversation,
  project,
  children,
  onUpdated,
  onDeleted,
}: {
  conversation: Conversation;
  project: Project;
  children: React.ReactNode;
  onUpdated: (next: Conversation) => void;
  onDeleted: (id: string) => void;
}) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const isArchived = conversation.status === "archived";

  const setColor = async (color: ConversationColor | null) => {
    try {
      const next = await updateConversation(conversation.id, { color });
      onUpdated(next);
    } catch {
      // swallow — UI surface is the next refetch; keeping silent for simplicity
    }
  };

  const toggleArchive = async () => {
    try {
      const next = await updateConversation(conversation.id, { archived: !isArchived });
      onUpdated(next);
    } catch {
      // ignore
    }
  };

  return (
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger className="block">{children}</ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner sideOffset={4} className="z-50 outline-none">
            <ContextMenu.Popup className={POPUP_BASE}>
              <ContextMenu.Item className={ITEM_BASE} onClick={() => setRenameOpen(true)}>
                <Pencil className="size-4" aria-hidden />
                <span>Rename</span>
              </ContextMenu.Item>

              <ContextMenu.SubmenuRoot>
                <ContextMenu.SubmenuTrigger className={ITEM_BASE}>
                  <Palette className="size-4" aria-hidden />
                  <span>Set color</span>
                </ContextMenu.SubmenuTrigger>
                <ContextMenu.Portal>
                  <ContextMenu.Positioner sideOffset={4} alignOffset={-4} className="z-50">
                    <ContextMenu.Popup className={POPUP_BASE}>
                      <ContextMenu.Item className={ITEM_BASE} onClick={() => void setColor(null)}>
                        <span className="size-3 rounded-full border border-border" aria-hidden />
                        <span className="flex-1">No color</span>
                        {conversation.color === null && <Check className="size-3.5" aria-hidden />}
                      </ContextMenu.Item>
                      {CONVERSATION_COLORS.map((color) => (
                        <ContextMenu.Item
                          key={color}
                          className={ITEM_BASE}
                          onClick={() => void setColor(color)}
                        >
                          <span
                            className={cn("size-3 rounded-full", COLOR_SWATCHES[color])}
                            aria-hidden
                          />
                          <span className="flex-1 capitalize">{color}</span>
                          {conversation.color === color && (
                            <Check className="size-3.5" aria-hidden />
                          )}
                        </ContextMenu.Item>
                      ))}
                    </ContextMenu.Popup>
                  </ContextMenu.Positioner>
                </ContextMenu.Portal>
              </ContextMenu.SubmenuRoot>

              <ContextMenu.Item className={ITEM_BASE} onClick={() => void toggleArchive()}>
                {isArchived ? (
                  <ArchiveRestore className="size-4" aria-hidden />
                ) : (
                  <Archive className="size-4" aria-hidden />
                )}
                <span>{isArchived ? "Unarchive" : "Archive"}</span>
              </ContextMenu.Item>

              <ContextMenu.Item
                className={cn(ITEM_BASE, ITEM_DESTRUCTIVE)}
                onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="size-4" aria-hidden />
                <span>Delete</span>
              </ContextMenu.Item>
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        conversation={conversation}
        onUpdated={onUpdated}
      />
      <DeleteDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        conversation={conversation}
        project={project}
        onDeleted={onDeleted}
      />
    </>
  );
}

function RenameDialog({
  open,
  onOpenChange,
  conversation,
  onUpdated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: Conversation;
  onUpdated: (next: Conversation) => void;
}) {
  const [value, setValue] = useState(conversation.title);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // re-seed the input when the dialog opens
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setValue(conversation.title);
      setError(null);
    }
    onOpenChange(next);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await updateConversation(conversation.id, { title: value });
      onUpdated(next);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.body.message : "Rename failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/60 bg-card p-5 shadow-xl outline-none">
          <Dialog.Title className="text-base font-semibold">Rename conversation</Dialog.Title>
          <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/30"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Dialog.Close className="inline-flex h-9 items-center rounded-lg px-3 text-sm hover:bg-accent">
                Cancel
              </Dialog.Close>
              <button
                type="submit"
                disabled={submitting || value.trim().length === 0}
                className="inline-flex h-9 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function DeleteDialog({
  open,
  onOpenChange,
  conversation,
  project,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversation: Conversation;
  project: Project;
  onDeleted: (id: string) => void;
}) {
  const hasOwnWorktree =
    !conversation.is_default && conversation.worktree_path !== project.repo_path;
  const [removeWorktree, setRemoveWorktree] = useState(hasOwnWorktree);
  const [force, setForce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setRemoveWorktree(hasOwnWorktree);
      setForce(false);
      setError(null);
    }
    onOpenChange(next);
  };

  const handleDelete = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await deleteConversation(conversation.id, {
        removeWorktree: hasOwnWorktree && removeWorktree,
        force,
      });
      onDeleted(conversation.id);
      onOpenChange(false);
    } catch (err) {
      if (err instanceof ApiRequestError && err.body.code === "dirty_worktree") {
        setError("This worktree has uncommitted changes. Check 'Force' to discard them.");
      } else {
        setError(err instanceof Error ? err.message : "Delete failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" />
        <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border/60 bg-card p-5 shadow-xl outline-none">
          <Dialog.Title className="text-base font-semibold">Delete conversation?</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted-foreground">
            This removes the conversation row. Transcripts on disk are not touched.
          </Dialog.Description>

          {hasOwnWorktree && (
            <div className="mt-4 rounded-lg border border-border/60 bg-muted/40 p-3 text-sm">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={removeWorktree}
                  onChange={(e) => setRemoveWorktree(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">Remove worktree</span>
                  <span className="mt-0.5 block break-all text-xs text-muted-foreground">
                    {conversation.worktree_path}
                  </span>
                </span>
              </label>
              {removeWorktree && (
                <label className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={force}
                    onChange={(e) => setForce(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>Force (discards uncommitted changes)</span>
                </label>
              )}
            </div>
          )}

          {error && (
            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close className="inline-flex h-9 items-center rounded-lg px-3 text-sm hover:bg-accent">
              Cancel
            </Dialog.Close>
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={submitting}
              className="inline-flex h-9 items-center rounded-lg bg-destructive px-3 text-sm font-medium text-destructive-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
