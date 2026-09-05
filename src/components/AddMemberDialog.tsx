import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import AddMemberInput from '@/components/AddMemberInput';

type AddMemberDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  multisigPda: string;
  transactionIndex: number;
  programId: string;
};

/**
 * Add-member overlay for the Members page. Wraps the existing proposal flow
 * (AddMemberInput) — creating a member is a squad-voted config transaction,
 * not a direct config-authority action.
 */
const AddMemberDialog = ({
  open,
  onOpenChange,
  multisigPda,
  transactionIndex,
  programId,
}: AddMemberDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Add member</DialogTitle>
        <DialogDescription>
          Creates a squad proposal to add the member with the chosen permissions — it takes effect
          once the squad approves and executes it.
        </DialogDescription>
      </DialogHeader>
      <AddMemberInput
        multisigPda={multisigPda}
        transactionIndex={transactionIndex}
        programId={programId}
      />
    </DialogContent>
  </Dialog>
);

export default AddMemberDialog;
