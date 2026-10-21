// The wordmark: a black tile with a blue bolt, then MED + FLASH with FLASH on a highlighter
// block. `as` lets it render as a router <Link> on public pages and a plain <span> in the app.
export default function Brand({ as: Tag = 'span', ...props }) {
  return (
    <Tag className="brand" {...props}>
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 64 64">
          <path d="M37 5 13 36h15l-4 23 27-33H36z" fill="currentColor" />
        </svg>
      </span>
      <span className="brand-name">
        Med<b>Flash</b>
      </span>
    </Tag>
  );
}
