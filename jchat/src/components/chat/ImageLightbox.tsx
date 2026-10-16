import { useState, useCallback } from 'react';
import { X, Download } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';

interface ImageLightboxProps {
  src: string | null;
  onClose: () => void;
}

export function ImageLightbox({ src, onClose }: ImageLightboxProps) {
  return (
    <Dialog.Root open={!!src} onOpenChange={open => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
        <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <Dialog.Close className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10">
            <X className="w-5 h-5" />
          </Dialog.Close>
          {src && (
            <a
              href={src}
              download
              target="_blank"
              rel="noopener noreferrer"
              className="absolute top-4 right-16 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
            >
              <Download className="w-4 h-4" />
            </a>
          )}
          {src && (
            <img src={src} alt="Preview" className="max-w-full max-h-[90vh] object-contain rounded-lg" />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function useImagePreview() {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      e.preventDefault();
      setPreviewSrc((target as HTMLImageElement).src);
    }
  }, []);

  const close = useCallback(() => setPreviewSrc(null), []);
  return { previewSrc, handleClick, close };
}
