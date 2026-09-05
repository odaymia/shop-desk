export function Toast({ text, tone }) {
  if (!text) return null;
  return <div className={`toast ${tone || ""}`}>{text}</div>;
}
