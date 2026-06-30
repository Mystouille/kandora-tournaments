interface GlossaryTermLinkProps {
  text: string;
  onClick: () => void;
}

export function GlossaryTermLink({ text, onClick }: GlossaryTermLinkProps) {
  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className="glossary-term-link"
    >
      {text}
    </span>
  );
}
