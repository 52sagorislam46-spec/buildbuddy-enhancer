/**
 * Renders message text with clickable links so shared links open on tap.
 */
const URL_RE = /((?:https?:\/\/|www\.)[^\s]+)/gi;

export function LinkText({ text, mine }: { text: string; mine?: boolean }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (!part) return null;
        if (/^(?:https?:\/\/|www\.)/i.test(part)) {
          const href = part.startsWith("http") ? part : `https://${part}`;
          return (
            <a
              key={i}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={`underline break-all ${mine ? "text-white" : "text-sky-600"}`}
            >
              {part}
            </a>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}
