import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** A QR code of `text`, drawn on this device (the text, with its key, never leaves it). */
export function QrCode(props: { text: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(props.text, { errorCorrectionLevel: "M", margin: 2, width: 480 }).then(
      (url) => !cancelled && setSrc(url),
      (err: unknown) => console.warn("[outbrief] QR code", err),
    );
    return () => {
      cancelled = true;
    };
  }, [props.text]);
  return src ? (
    <img className="qr-image" src={src} alt={props.label} />
  ) : (
    <div className="qr-image" />
  );
}
