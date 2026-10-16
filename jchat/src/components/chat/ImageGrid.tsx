import { useMemo, useState, useCallback } from 'react';
import { useSignedUrls } from '../../hooks/useSignedUrl';
import { Loader2, ChevronLeft, ChevronRight, X, Download } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';

export interface ImageItem {
  url: string;
  alt: string;
}

interface ImageGridProps {
  images: ImageItem[];
}

const MAX_DISPLAY = 9;

function getImageClass(count: number): string {
  if (count === 1) return 'w-full max-w-md max-h-96 object-cover rounded-lg';
  if (count === 2) return 'w-full h-32 object-cover rounded-md';
  if (count === 3) return 'w-full h-28 object-cover rounded-md';
  if (count === 4) return 'w-full h-32 object-cover rounded-md';
  return 'w-full h-24 object-cover rounded-md';
}

function getGridCols(count: number): string {
  if (count === 1) return '';
  if (count === 2) return 'grid-cols-2';
  if (count === 3) return 'grid-cols-3';
  if (count === 4) return 'grid-cols-2';
  return 'grid-cols-3';
}

/** Single image cell with skeleton placeholder while the browser loads the image. */
function ImageCell({
  img,
  isLast,
  moreCount,
  count,
  onClick,
}: {
  img: ImageItem;
  isLast: boolean;
  moreCount: number;
  count: number;
  onClick: () => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => setErrored(true), []);

  const single = count === 1;
  const hasMoreOverlay = isLast && moreCount > 0;
  const imgClass = getImageClass(count);

  return (
    <div
      className={`relative cursor-pointer overflow-hidden bg-gray-100 dark:bg-gray-700 group ${single ? '' : 'aspect-square'}`}
      onClick={onClick}
    >
      {/* Skeleton placeholder — shown until the image loads or errors. */}
      {!loaded && !errored && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-200 dark:bg-gray-600 animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin text-gray-300 dark:text-gray-500" />
        </div>
      )}

      {errored ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-gray-400 dark:text-gray-500">
          加载失败
        </div>
      ) : (
        <img
          src={img.url}
          alt={img.alt || 'Image'}
          loading="lazy"
          onLoad={handleLoad}
          onError={handleError}
          className={`${imgClass} transition-opacity duration-200 group-hover:opacity-95 ${
            loaded ? 'opacity-100' : 'opacity-0 absolute inset-0'
          }`}
        />
      )}

      {/* "+N" overlay on the last visible image when there are more. */}
      {loaded && hasMoreOverlay && (
        <div className="absolute inset-0 bg-black/60 rounded-md flex items-center justify-center">
          <span className="text-white text-xl font-semibold">+{moreCount}</span>
        </div>
      )}
    </div>
  );
}

export function ImageGrid({ images }: ImageGridProps) {
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  const rawUrls = useMemo(() => images.map(img => img.url), [images]);
  const { urls: resolvedUrls, error } = useSignedUrls(rawUrls);

  const resolved = useMemo(() => {
    if (resolvedUrls.length === 0) return images;
    return images.map((img, i) => ({ ...img, url: resolvedUrls[i] }));
  }, [images, resolvedUrls]);

  if (error) {
    return (
      <div className="flex items-center gap-2 text-xs text-red-400 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg">
        <span>图片加载失败</span>
      </div>
    );
  }

  const displayImages = resolved.slice(0, MAX_DISPLAY);
  const hasMore = resolved.length > MAX_DISPLAY;
  const gridCols = getGridCols(displayImages.length);
  const currentImage = lightboxIndex >= 0 ? resolved[lightboxIndex] : null;

  return (
    <>
      <div className={`${displayImages.length === 1 ? 'inline-block' : `grid ${gridCols} gap-1`} max-w-md`}>
        {displayImages.map((img, i) => (
          <ImageCell
            key={`${img.url}-${i}`}
            img={img}
            isLast={i === displayImages.length - 1}
            moreCount={hasMore ? resolved.length - MAX_DISPLAY : 0}
            count={displayImages.length}
            onClick={() => setLightboxIndex(i)}
          />
        ))}
      </div>

      <Dialog.Root open={lightboxIndex >= 0} onOpenChange={open => !open && setLightboxIndex(-1)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
          <Dialog.Content className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {resolved.length > 1 && (
              <div className="absolute top-4 left-4 px-3 py-1.5 rounded-full bg-black/60 text-white text-sm z-10">
                {lightboxIndex + 1} / {resolved.length}
              </div>
            )}
            <Dialog.Close className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10">
              <X className="w-5 h-5" />
            </Dialog.Close>
            {currentImage && (
              <a
                href={currentImage.url}
                download
                target="_blank"
                rel="noopener noreferrer"
                className="absolute top-4 right-16 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
              >
                <Download className="w-4 h-4" />
              </a>
            )}
            {resolved.length > 1 && (
              <button
                className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
                onClick={() => setLightboxIndex((lightboxIndex - 1 + resolved.length) % resolved.length)}
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
            )}
            {currentImage && (
              <img
                src={currentImage.url}
                alt={currentImage.alt || 'Image'}
                className="max-w-full max-h-[90vh] object-contain rounded-lg"
              />
            )}
            {resolved.length > 1 && (
              <button
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors z-10"
                onClick={() => setLightboxIndex((lightboxIndex + 1) % resolved.length)}
              >
                <ChevronRight className="w-6 h-6" />
              </button>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
