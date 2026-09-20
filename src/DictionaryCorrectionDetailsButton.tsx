import { useState } from 'react';
import {
  DictionaryCorrectionDetailsDialog,
  type DictionaryCorrectionDetailsDialogProps,
} from './DictionaryCorrectionDetailsDialog';

type DictionaryCorrectionDetailsButtonProps = Omit<
  DictionaryCorrectionDetailsDialogProps,
  'open' | 'onClose'
> & { readonly label?: string };

export function DictionaryCorrectionDetailsButton({
  label = '已纠错',
  ...props
}: DictionaryCorrectionDetailsButtonProps) {
  const [open, setOpen] = useState(false);
  if (props.changes.length === 0) return null;
  return (
    <>
      <button
        aria-haspopup="dialog"
        className="dictionary-correction-details__summary"
        onClick={() => {
          setOpen(true);
        }}
        type="button"
      >
        {label}
      </button>
      <DictionaryCorrectionDetailsDialog
        {...props}
        onClose={() => {
          setOpen(false);
        }}
        open={open}
      />
    </>
  );
}
