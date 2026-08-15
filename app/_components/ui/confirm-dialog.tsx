"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/_components/ui/dialog";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  destructive = false,
  pending = false,
  onConfirm,
  onOpenChange,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] gap-4 border-[var(--c-border)] bg-[var(--c-surface)] p-0 shadow-xl sm:rounded-xl">
        <DialogHeader className="space-y-2 px-5 pt-5 text-left">
          <DialogTitle className="text-[15px] font-semibold tracking-tight text-[var(--c-ink)]">
            {title}
          </DialogTitle>
          {description ? (
            <DialogDescription className="text-[13px] leading-relaxed text-[var(--c-ink-2)]">
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogFooter className="flex-row justify-end gap-2 border-t border-[var(--c-border-soft)] px-5 py-3">
          <button
            type="button"
            className="btn btn--default"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={pending}
            style={destructive ? { background: "#F53F3F", borderColor: "#F53F3F" } : undefined}
            onClick={onConfirm}
          >
            {pending ? "处理中…" : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
