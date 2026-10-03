import { useState } from "react";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useLocale } from "~/contexts/LocaleContext";
import type {
  SummaryIdentity,
  SummaryUnavailableReason,
} from "~/types/leagueGameSummary";

export function summaryNumber(
  value: number,
  locale: string,
  decimals = 0,
  signed = false
) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(Object.is(value, -0) ? 0 : value);
}

export function SummaryIdentityBanner({
  identity,
  compact = false,
}: {
  identity: SummaryIdentity;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const imageUrl = identity.imageUrl === failedImage ? null : identity.imageUrl;
  const teamLogoUrl =
    identity.teamLogoUrl === failedLogo ? null : identity.teamLogoUrl;
  const initials = identity.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toLocaleUpperCase();
  return (
    <div
      className={`gs-identity${compact ? " gs-identity-compact" : ""}`}
      style={{
        backgroundImage: `linear-gradient(105deg, ${identity.color}b3, ${identity.color}26 70%, transparent)`,
        borderLeftColor: identity.color,
      }}
    >
      {teamLogoUrl && (
        <div className="gs-team-watermark" aria-hidden="true">
          <img
            src={teamLogoUrl}
            alt=""
            crossOrigin="anonymous"
            draggable={false}
            onError={() => {
              console.warn(
                "[game summary] Team watermark could not be loaded",
                teamLogoUrl
              );
              setFailedLogo(teamLogoUrl);
            }}
          />
        </div>
      )}
      <div className="gs-identity-copy">
        <strong>{identity.name}</strong>
        {identity.teamName && <span>{identity.teamName}</span>}
      </div>
      <div className="gs-portrait">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            crossOrigin="anonymous"
            onError={() => {
              console.warn(
                "[game summary] Portrait could not be loaded",
                imageUrl
              );
              setFailedImage(imageUrl);
            }}
          />
        ) : (
          <span
            className="gs-initials"
            aria-label={t.gameSummary.portraitUnavailable}
          >
            {initials}
          </span>
        )}
      </div>
    </div>
  );
}

export function SummaryUnavailable({
  reason,
}: {
  reason: SummaryUnavailableReason;
}) {
  const { t } = useLocale();
  return (
    <div className="gs-unavailable" role="status">
      <InfoCircleOutlined aria-hidden />
      <p>{t.gameSummary[reason]}</p>
    </div>
  );
}
