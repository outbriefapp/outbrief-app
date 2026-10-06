import { isTauri } from "@tauri-apps/api/core";
import QrScannerLib from "qr-scanner";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";

// Android's system WebView answers BarcodeDetector through Google Play services and kills the app
// when the embedding app's manifest does not declare them (OUTB-54); many phones have no Play
// services at all. The Android app decodes with qr-scanner's own worker instead, through the
// switch the library itself flips when the native detector reports "not implemented".
if (isTauri() && /Android/.test(navigator.userAgent)) {
  (QrScannerLib as unknown as { _disableBarcodeDetector: boolean })._disableBarcodeDetector = true;
}

/**
 * Scans a pairing QR code with the camera (`qr-scanner`: the browser's BarcodeDetector where there
 * is one, except in the Android app; its own decoder in a worker elsewhere). Calls `onResult` with
 * the first code it reads.
 */
export function QrScanner(props: { onResult: (text: string) => void; onClose: () => void }) {
  const msg = useT();
  const video = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { onResult } = props;

  useEffect(() => {
    const el = video.current;
    if (!el) return;
    let done = false;
    const scanner = new QrScannerLib(
      el,
      (result) => {
        if (done) return;
        done = true;
        scanner.stop();
        onResult(result.data);
      },
      { returnDetailedScanResult: true, highlightScanRegion: true, preferredCamera: "environment" },
    );
    // Ask for the camera before the scanner starts: on Android the permission dialog pauses the
    // app while qr-scanner is starting the video, and that start fails although access is granted.
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        for (const track of stream.getTracks()) track.stop();
        if (!done) return scanner.start();
      })
      .catch((err: unknown) => {
        console.warn("[outbrief] camera", err);
        setError(msg.account.scanUnavailable);
      });
    return () => {
      done = true;
      scanner.destroy();
    };
  }, [onResult, msg]);

  return (
    <div className="qr-scanner">
      <video ref={video} playsInline muted />
      <p className={error ? "warn" : "muted"}>{error ?? msg.account.scanning}</p>
      <button type="button" className="secondary" onClick={props.onClose}>
        {msg.account.stopScan}
      </button>
    </div>
  );
}

/**
 * Whether this device has a camera to scan with. Not in the desktop app: a computer pastes the
 * pairing link instead (and its bundle declares no camera use).
 */
export async function canScan(): Promise<boolean> {
  if (!navigator.mediaDevices?.getUserMedia) return false;
  if (isTauri() && !/iPhone|iPad|Android/.test(navigator.userAgent)) return false;
  return QrScannerLib.hasCamera().catch(() => false);
}
