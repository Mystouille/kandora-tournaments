import { flagDataUri } from "../utils/countryOptions";

const FLAG_STYLE: React.CSSProperties = {
  width: 20,
  height: 14,
  borderRadius: 2,
  verticalAlign: "middle",
  flexShrink: 0,
};

export function FlagIcon({
  code,
  style,
}: {
  code: string;
  style?: React.CSSProperties;
}) {
  const src = flagDataUri(code);
  if (!src) {
    return <span>{code}</span>;
  }
  return <img src={src} alt={code} style={{ ...FLAG_STYLE, ...style }} />;
}
