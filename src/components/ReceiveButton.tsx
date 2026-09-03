import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/**
 * "Receive" overlay: full address + a QR code generated locally in the browser
 * (no external service). The QR encodes the plain vault address.
 */
export function ReceiveButton({ address, vaultIndex }: { address: string; vaultIndex: number }) {
  const [open, setOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    QRCode.toDataURL(address, {
      margin: 2,
      width: 240,
      color: { dark: '#d9f6fb', light: '#071114' },
    })
      .then((url) => {
        if (!cancelled) setQrUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, address]);

  const copy = () => {
    navigator.clipboard
      .writeText(address)
      .then(() => toast.success('Address copied'))
      .catch(() => toast.error('Copy failed'));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          title={`Receive to V${vaultIndex}`}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-primary/15 bg-black/30 text-primary/70 transition-colors hover:border-primary/40 hover:text-primary"
        >
          <QrCode className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display tracking-tight">
            Receive to V{vaultIndex}
          </DialogTitle>
          <DialogDescription>
            Scan or copy this vault address. Only send assets on Solana.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-4 py-2">
          {qrUrl ? (
            <img
              src={qrUrl}
              alt={`QR code for vault V${vaultIndex} address`}
              className="rounded-lg border border-primary/20"
            />
          ) : (
            <div className="h-[240px] w-[240px] animate-pulse rounded-lg bg-primary/5" />
          )}
          <button
            type="button"
            onClick={copy}
            className="group flex w-full items-center justify-center gap-2 rounded-md border border-primary/20 bg-black/30 px-3 py-2 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            title={address}
          >
            <span className="break-all text-center">{address}</span>
            <Copy className="h-3.5 w-3.5 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
