import { useState } from 'react';
import { Check, Pencil, X } from 'lucide-react';
import { toast } from 'sonner';
import { useMemberNames, memberNameOf } from '@/hooks/useMemberNames';
import { truncateAddress } from './tokenMeta';
import { cn } from '@/lib/utils';

/**
 * Renders a member as "Name (abcd…wxyz)" when a local label exists, else the
 * truncated key. Use anywhere a member pubkey is shown.
 */
export function MemberLabel({ memberKey, className }: { memberKey: string; className?: string }) {
  const { names } = useMemberNames();
  const name = memberNameOf(names, memberKey);
  if (!name) {
    return <span className={cn('font-mono', className)}>{truncateAddress(memberKey)}</span>;
  }
  return (
    <span className={className}>
      <span className="font-display font-medium text-foreground">{name}</span>{' '}
      <span className="font-mono text-muted-foreground/70">{truncateAddress(memberKey)}</span>
    </span>
  );
}

/**
 * Inline name editor for the Members table: pencil → input with save/cancel.
 * Empty input clears the label.
 */
export function MemberNameEditor({ memberKey }: { memberKey: string }) {
  const { names, setMemberName } = useMemberNames();
  const current = memberNameOf(names, memberKey);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const start = () => {
    setDraft(current ?? '');
    setEditing(true);
  };

  const save = async () => {
    try {
      await setMemberName.mutateAsync({ memberKey, name: draft });
      setEditing(false);
      if (draft.trim()) toast.success('Member named');
    } catch {
      toast.error('Failed to save name');
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={start}
        title={current ? `Rename "${current}"` : 'Assign a local name'}
        className="text-muted-foreground/60 transition-colors hover:text-primary"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        placeholder="Name (empty clears)"
        maxLength={32}
        className="h-7 w-36 rounded-md border border-primary/25 bg-black/30 px-2 font-display text-xs text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-primary/50"
      />
      <button
        type="button"
        onClick={save}
        title="Save name"
        className="text-success transition-colors hover:text-success/80"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setEditing(false)}
        title="Cancel"
        className="text-muted-foreground/60 transition-colors hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </span>
  );
}
