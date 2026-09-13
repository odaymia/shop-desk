import { useMemo } from "react";
import qrcode from "qrcode-generator";
import { Modal } from "./ui.jsx";

/* A scalable QR code as inline SVG — no network, prints fine. */
export function QR({ value, size = 220 }) {
  const html = useMemo(() => {
    if (!value) return "";
    try {
      const qr = qrcode(0, "M");
      qr.addData(String(value));
      qr.make();
      return qr.createSvgTag({ scalable: true, margin: 2 });
    } catch {
      return "";
    }
  }, [value]);
  return <div className="qr" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: html }} />;
}

/* The customer portal lives next to the desk build at /portal/. Derive it
   from wherever the desk is being served so it works on any host. */
export function portalUrl() {
  const { origin, pathname } = window.location;
  return origin + pathname.replace(/[^/]*$/, "") + "portal/";
}

/* Show the customer a QR to their portal so they can pull up every receipt
   themselves. The email stays on the screen, never in the QR/URL. */
export function PortalQR({ customer, onClose }) {
  const url = portalUrl();
  const email = customer && customer.email ? String(customer.email).trim() : "";
  return (
    <Modal title="Customer receipts" onClose={onClose}>
      <div style={{ textAlign: "center" }}>
        <QR value={url} size={260} />
        <p style={{ fontWeight: 600, margin: "12px 0 4px" }}>Scan to see all your receipts &amp; service history</p>
        {email ? (
          <p className="muted" style={{ margin: 0 }}>
            Sign in with your email: <strong>{email}</strong>.<br />
            First time? Tap <strong>“Email me a sign-in link.”</strong>
          </p>
        ) : (
          <p className="warn" style={{ margin: 0 }}>
            Add this customer’s email (Edit customer) so they can sign in and see their receipts.
          </p>
        )}
        <p className="muted" style={{ fontSize: 12, marginTop: 12, wordBreak: "break-all" }}>{url}</p>
      </div>
    </Modal>
  );
}
