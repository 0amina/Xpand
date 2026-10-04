import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/Button';
import { frameToJpegFile } from '@/lib/image';
import { haptics } from '@/lib/telegram';

import './invoices.css';

type Phase = 'starting' | 'live' | 'review' | 'error';

interface CameraSheetProps {
  open: boolean;
  onClose: () => void;
  /** Called with the captured frame once the user accepts the shot. */
  onCapture: (file: File) => void;
  /** Lets the error state hand the user over to the system picker instead of a dead end. */
  onFallback?: () => void;
}

/**
 * A full-screen camera for photographing an invoice, with a confirm step before upload.
 *
 * Why this exists rather than `<input type="file" capture="environment">`, which is what the
 * scanner used to rely on: `capture` is a *hint*, and Telegram's Android webview routinely
 * ignores it and opens the document picker instead, which is exactly the "it only lets me pick
 * from the gallery" complaint. A `getUserMedia` stream is not a hint — it either opens the
 * camera or raises an error we can explain. The file inputs stay as the fallback.
 *
 * The review step matters more here than it would elsewhere: OCR on a blurred or half-cropped
 * photo fails silently-ish (it returns a draft with missing fields), so it is much cheaper to
 * let the user judge the shot while the invoice is still in front of them than after the upload.
 */
export function CameraSheet({ open, onClose, onCapture, onFallback }: CameraSheetProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [phase, setPhase] = useState<Phase>('starting');
  const [message, setMessage] = useState('');
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);

  /** Release the camera. Without this the indicator light — and the hold on the device — stays. */
  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setPhase('starting');
    setMessage('');

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // `ideal`, not `exact`: a laptop with only a front camera should still work rather
          // than throwing OverconstrainedError.
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // Some webviews ignore the `autoplay` attribute on a stream-backed element.
          await video.play().catch(() => undefined);
        }
        setPhase('live');
      } catch (error) {
        if (cancelled) return;
        setMessage(describeCameraError(error));
        setPhase('error');
      }
    })();

    return () => {
      cancelled = true;
      stopStream();
    };
  }, [open, stopStream]);

  // Drop the preview's object URL whenever it is replaced or the sheet closes.
  useEffect(() => {
    if (!shot) return;
    return () => URL.revokeObjectURL(shot.url);
  }, [shot]);

  useEffect(() => {
    if (!open) setShot(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const capture = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;

    haptics.impact('medium');
    try {
      const file = await frameToJpegFile(
        video,
        `invoice-${video.videoWidth}x${video.videoHeight}.jpg`,
      );
      setShot({ file, url: URL.createObjectURL(file) });
      setPhase('review');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The photo could not be saved.');
      setPhase('error');
    }
  };

  // The stream is left running through the review step, so Retake is instant.
  const retake = () => {
    setShot(null);
    setPhase('live');
  };

  const use = () => {
    if (!shot) return;
    stopStream();
    onCapture(shot.file);
  };

  const close = () => {
    stopStream();
    onClose();
  };

  return createPortal(
    <div className="camera" role="dialog" aria-modal="true" aria-label="Camera">
      <div className="camera__stage">
        <video
          ref={videoRef}
          className="camera__video"
          autoPlay
          muted
          playsInline
          // Decorative: the controls below carry the accessible labels.
          aria-hidden="true"
        />

        {shot && <img className="camera__still" src={shot.url} alt="The invoice you just shot" />}

        {phase === 'starting' && (
          <div className="camera__overlay">
            <span className="invoice-spinner" aria-hidden="true" />
            <span>Opening the camera…</span>
          </div>
        )}

        {phase === 'error' && (
          <div className="camera__overlay camera__overlay--error">
            <span style={{ fontSize: 36, lineHeight: 1 }} aria-hidden="true">
              📷
            </span>
            <p className="camera__message">{message}</p>
            {onFallback && (
              <Button
                variant="secondary"
                onClick={() => {
                  stopStream();
                  onFallback();
                }}
              >
                Choose a photo instead
              </Button>
            )}
          </div>
        )}

        {/* A frame to aim with. Invoices get cropped far less often when there is an edge to
            line the paper up against. */}
        {phase === 'live' && <div className="camera__guide" aria-hidden="true" />}
      </div>

      <div className="camera__controls">
        {phase === 'review' ? (
          <>
            <button type="button" className="camera__text-action" onClick={retake}>
              Retake
            </button>
            <Button onClick={use}>Use this photo</Button>
            <button type="button" className="camera__text-action" onClick={close}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="camera__text-action" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="camera__shutter"
              aria-label="Take a photo"
              disabled={phase !== 'live'}
              onClick={() => void capture()}
            />
            {/* Empty third cell: the grid keeps the shutter centred. */}
            <span aria-hidden="true" />
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** Turn a `getUserMedia` rejection into something a user can act on. */
function describeCameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';

  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access was refused. Allow the camera for Telegram in your phone settings, then try again — or pick a photo from the gallery instead.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found on this device.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is busy — close any other app using it and try again.';
    default:
      return 'The camera could not be opened here. Pick a photo from the gallery instead.';
  }
}
