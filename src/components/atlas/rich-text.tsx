import { Fragment, type ReactNode } from "react";

/**
 * Renders the small subset of Markdown that chat replies use (paragraphs, bullet and numbered
 * lists, bold, and http(s) links for citations). Everything is rendered as React nodes, so model
 * output can never inject HTML, and links only ever point at http or https URLs.
 */
export function RichText({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: string }) {
  const lines = block.split("\n").filter((line) => line.trim() !== "");
  const bullet = /^\s*[-*•]\s+/;
  const numbered = /^\s*\d+[.)]\s+/;
  if (lines.length > 0 && lines.every((line) => bullet.test(line))) {
    return (
      <ul className="list-disc space-y-1 pl-5">
        {lines.map((line, index) => (
          <li key={index}>
            <Inline text={line.replace(bullet, "")} />
          </li>
        ))}
      </ul>
    );
  }
  if (lines.length > 0 && lines.every((line) => numbered.test(line))) {
    return (
      <ol className="list-decimal space-y-1 pl-5">
        {lines.map((line, index) => (
          <li key={index}>
            <Inline text={line.replace(numbered, "")} />
          </li>
        ))}
      </ol>
    );
  }
  return (
    <p>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 ? <br /> : null}
          <Inline text={line.replace(/^#{1,6}\s+/, "")} />
        </Fragment>
      ))}
    </p>
  );
}

const LINK_PATTERN = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;

function Inline({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    const index = match.index ?? 0;
    if (index > last)
      nodes.push(<Bold key={last} text={text.slice(last, index)} />);
    nodes.push(
      <a
        key={index}
        href={match[2]}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="text-primary underline underline-offset-2 hover:no-underline"
      >
        {match[1]}
      </a>,
    );
    last = index + match[0].length;
  }
  if (last < text.length)
    nodes.push(<Bold key={last} text={text.slice(last)} />);
  return <>{nodes}</>;
}

function Bold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={index} className="font-semibold">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
