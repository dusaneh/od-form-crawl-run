export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        padding: "clamp(2rem, 7vw, 6rem)",
        background:
          "radial-gradient(circle at top right, #e4f8ef 0, #f7faf7 42%, #eef4ef 100%)",
        color: "#10372d",
      }}
    >
      <section style={{ maxWidth: "760px" }}>
        <p
          style={{
            margin: "0 0 1rem",
            fontSize: "0.78rem",
            fontWeight: 800,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
          }}
        >
          FormWeave API service
        </p>
        <h1
          style={{
            margin: "0 0 1rem",
            fontSize: "clamp(2.7rem, 8vw, 5.8rem)",
            lineHeight: 0.95,
            letterSpacing: "-0.06em",
          }}
        >
          Crawl, certify, and run public forms.
        </h1>
        <p
          style={{
            maxWidth: "650px",
            margin: "0 0 2.25rem",
            fontSize: "1.08rem",
            lineHeight: 1.7,
            color: "#45675d",
          }}
        >
          This deployment is API-first. Human operational tools are available
          at protected, non-home routes.
        </p>
        <nav style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <a href="/control-plane" style={linkStyle}>
            Open control plane
          </a>
          <a href="/api-console" style={linkStyle}>
            Open API console
          </a>
          <a href="/healthz" style={secondaryLinkStyle}>
            Service health
          </a>
        </nav>
      </section>
    </main>
  );
}

const linkStyle = {
  display: "inline-flex",
  padding: "0.85rem 1.1rem",
  borderRadius: "0.7rem",
  background: "#103f33",
  color: "white",
  fontWeight: 750,
  textDecoration: "none",
};

const secondaryLinkStyle = {
  ...linkStyle,
  border: "1px solid #b9cfc6",
  background: "rgba(255,255,255,0.74)",
  color: "#103f33",
};
