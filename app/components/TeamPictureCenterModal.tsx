import { useRef, useState, type PointerEvent } from "react";
import { Alert, Button, Modal, Slider, Spin, Typography } from "antd";
import { useLocale } from "~/contexts/LocaleContext";
import {
  DEFAULT_TEAM_PICTURE_CENTER_Y,
  type TeamPicturePair,
} from "~/types/pictures";
import { SummaryIdentityBanner } from "./game-summary/SummaryPresentation";
import "./game-summary/gameSummary.css";
import "./TeamPictureCenterModal.css";

interface TeamPictureCenterModalProps {
  pictures: TeamPicturePair;
  teamName: string;
  teamColor: string;
  saving: boolean;
  onConfirm: (centerY: number) => void;
  onCancel: () => void;
}

export function TeamPictureCenterModal({
  pictures,
  teamName,
  teamColor,
  saving,
  onConfirm,
  onCancel,
}: TeamPictureCenterModalProps) {
  const { t, locale } = useLocale();
  const labels = t.onlineTournaments.admin;
  const [centerY, setCenterY] = useState(
    pictures.summaryCenterY ?? DEFAULT_TEAM_PICTURE_CENTER_Y
  );
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const dragging = useRef(false);

  const selectLine = (event: PointerEvent<HTMLDivElement>) => {
    if (!loaded || saving) {
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.height > 0) {
      const selected = Math.max(
        0,
        Math.min(1, (event.clientY - bounds.top) / bounds.height)
      );
      setCenterY(Math.round(selected * 1000) / 1000);
    }
  };
  const previewIdentity = {
    id: "team-picture-preview",
    name: teamName,
    teamName: null,
    imageUrl: pictures.croppedPicture,
    teamLogoUrl: pictures.fullPicture,
    teamLogoCenterY: centerY,
    color: teamColor,
  };
  const previews = [
    {
      label: t.gameSummary.stats,
      width: 600,
      zoom: 0.42,
      compact: false,
      className: "",
    },
    {
      label: t.gameSummary.points,
      width: 470,
      zoom: 0.53,
      compact: false,
      className: "gs-legend-player",
    },
    {
      label: t.gameSummary.standings,
      width: 740,
      zoom: 0.34,
      compact: true,
      className: "",
    },
  ];
  return (
    <Modal
      open
      title={`${labels.teamPicturesCenter}: ${teamName}`}
      width={900}
      centered
      okText={labels.teamPicturesCenterSave}
      cancelText={t.common.cancel}
      confirmLoading={saving}
      okButtonProps={{
        disabled: !loaded || failed,
        "aria-label": labels.teamPicturesCenterSave,
      }}
      cancelButtonProps={{ disabled: saving }}
      closable={!saving}
      maskClosable={!saving}
      keyboard={!saving}
      onOk={() => onConfirm(centerY)}
      onCancel={onCancel}
      styles={{ body: { maxHeight: "70vh", overflowY: "auto" } }}
    >
      <Typography.Paragraph type="secondary">
        {labels.teamPicturesCenterHelp}
      </Typography.Paragraph>
      {failed && (
        <Alert
          type="error"
          showIcon
          title={labels.teamPicturesCenterLoadError}
        />
      )}
      <div
        className="team-picture-center-source"
        style={{ minHeight: loaded || failed ? undefined : 160 }}
        onPointerDown={(event) => {
          if (!loaded || saving || event.button !== 0) {
            return;
          }
          event.preventDefault();
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          selectLine(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) {
            selectLine(event);
          }
        }}
        onPointerUp={(event) => {
          dragging.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onLostPointerCapture={() => {
          dragging.current = false;
        }}
      >
        {!loaded && !failed && <Spin className="team-picture-center-loading" />}
        <img
          src={pictures.fullPicture}
          alt={teamName}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => {
            console.error(
              "[team pictures] Centering image could not be loaded",
              pictures.fullPicture
            );
            setFailed(true);
            setLoaded(false);
          }}
        />
        {loaded && (
          <div
            className="team-picture-center-line"
            data-center-line={centerY}
            style={{ top: `${centerY * 100}%` }}
          />
        )}
      </div>
      <div className="team-picture-center-controls">
        <Typography.Text>{labels.teamPicturesCenterPosition}</Typography.Text>
        <Typography.Text>
          {new Intl.NumberFormat(locale, {
            style: "percent",
            maximumFractionDigits: 1,
          }).format(centerY)}
        </Typography.Text>
      </div>
      <Slider
        ariaLabelForHandle={labels.teamPicturesCenterPosition}
        style={{ marginInline: 28 }}
        min={0}
        max={100}
        step={0.1}
        value={centerY * 100}
        marks={{
          0: labels.teamPicturesCenterTop,
          100: labels.teamPicturesCenterBottom,
        }}
        disabled={!loaded || saving}
        onChange={(value) => setCenterY(value / 100)}
      />
      <Button
        size="small"
        disabled={!loaded || saving}
        onClick={() => setCenterY(DEFAULT_TEAM_PICTURE_CENTER_Y)}
      >
        {labels.teamPicturesCenterReset}
      </Button>
      <Typography.Title level={5}>
        {labels.teamPicturesCenterPreviews}
      </Typography.Title>
      <div className="team-picture-center-previews">
        {previews.map((preview) => (
          <div className="team-picture-center-preview" key={preview.label}>
            <Typography.Text type="secondary">{preview.label}</Typography.Text>
            <div className="team-picture-center-preview-canvas">
              <div
                className={preview.className}
                style={{ width: preview.width, zoom: preview.zoom }}
              >
                <SummaryIdentityBanner
                  identity={previewIdentity}
                  compact={preview.compact}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
