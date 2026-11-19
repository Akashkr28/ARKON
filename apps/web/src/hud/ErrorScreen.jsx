export default function ErrorScreen({ title, detail, children }) {
  return (
    <div className="hud-error" role="alert">
      <div className="hud-error-title">⚠ {title}</div>
      <div className="hud-error-detail">{detail}</div>
      {children}
    </div>
  );
}
