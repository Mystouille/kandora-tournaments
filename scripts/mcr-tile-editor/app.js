const elements = {
  atlasPreview: document.querySelector("#atlas-preview"),
  atlasSize: document.querySelector("#atlas-size"),
  atlasStage: document.querySelector("#atlas-stage"),
  bake: document.querySelector("#bake"),
  cellPreview: document.querySelector("#cell-preview"),
  cellSelection: document.querySelector("#cell-selection"),
  cellSize: document.querySelector("#cell-size"),
  dirtyBadge: document.querySelector("#dirty-badge"),
  download: document.querySelector("#download"),
  offsetXNumber: document.querySelector("#offset-x-number"),
  offsetXRange: document.querySelector("#offset-x-range"),
  offsetYNumber: document.querySelector("#offset-y-number"),
  offsetYRange: document.querySelector("#offset-y-range"),
  previewSpinner: document.querySelector("#preview-spinner"),
  resetAll: document.querySelector("#reset-all"),
  resetSheet: document.querySelector("#reset-sheet"),
  rotation: document.querySelector("#rotation"),
  scaleNumber: document.querySelector("#scale-number"),
  scaleRange: document.querySelector("#scale-range"),
  scaleXNumber: document.querySelector("#scale-x-number"),
  scaleXRange: document.querySelector("#scale-x-range"),
  scaleYNumber: document.querySelector("#scale-y-number"),
  scaleYRange: document.querySelector("#scale-y-range"),
  selectedCellLabel: document.querySelector("#selected-cell-label"),
  sheetKicker: document.querySelector("#sheet-kicker"),
  sheetList: document.querySelector("#sheet-list"),
  sheetMeta: document.querySelector("#sheet-meta"),
  sheetTitle: document.querySelector("#sheet-title"),
  status: document.querySelector("#status"),
  squeezeControls: document.querySelectorAll("[data-squeeze-control]"),
};

let config;
let defaults;
let sheets = [];
let selectedSheetId;
let selectedCell = { col: 1, row: 0 };
let previewUrl;
let previewTimer;
let previewGeneration = 0;
let dirty = false;

function setStatus(message, kind = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${kind}`.trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function selectedSheet() {
  const sheet = sheets.find((candidate) => candidate.id === selectedSheetId);
  if (sheet === undefined) {
    throw new Error("No sprite sheet is selected");
  }
  return sheet;
}

function selectedTuning() {
  return config.sheets[selectedSheetId];
}

function markDirty(next = true) {
  dirty = next;
  elements.dirtyBadge.classList.toggle("hidden", !dirty);
}

function renderSheetList() {
  elements.sheetList.replaceChildren(
    ...sheets.map((sheet) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `sheet-button ${
        sheet.id === selectedSheetId ? "active" : ""
      }`;
      const title = document.createElement("strong");
      title.textContent = sheet.label;
      const details = document.createElement("span");
      details.textContent = `${sheet.cols}×${sheet.rows} · ${sheet.output}`;
      button.append(title, details);
      button.addEventListener("click", () => {
        selectedSheetId = sheet.id;
        selectedCell = {
          col: Math.min(sheet.cols - 1, 1),
          row: 0,
        };
        renderSelection();
        schedulePreview(0);
      });
      return button;
    })
  );
}

function assignControl(range, number, value) {
  range.value = String(value);
  number.value = String(value);
}

function renderControls() {
  const tuning = selectedTuning();
  assignControl(
    elements.offsetXRange,
    elements.offsetXNumber,
    tuning.offsetX
  );
  assignControl(
    elements.offsetYRange,
    elements.offsetYNumber,
    tuning.offsetY
  );
  assignControl(
    elements.scaleRange,
    elements.scaleNumber,
    Math.round(tuning.scale * 100)
  );
  elements.rotation.value = String(tuning.rotation);
  for (const control of elements.squeezeControls) {
    control.classList.toggle("hidden", !selectedSheet().allowsSqueeze);
  }
  if (selectedSheet().allowsSqueeze) {
    assignControl(
      elements.scaleXRange,
      elements.scaleXNumber,
      Math.round(tuning.scaleX * 100)
    );
    assignControl(
      elements.scaleYRange,
      elements.scaleYNumber,
      Math.round(tuning.scaleY * 100)
    );
  }
}

function renderSelection() {
  const sheet = selectedSheet();
  renderSheetList();
  renderControls();
  elements.sheetKicker.textContent = sheet.output;
  elements.sheetTitle.textContent = sheet.label;
  elements.sheetMeta.textContent =
    `${sheet.cols} columns × ${sheet.rows} rows · ` +
    `${sheet.cellWidth}×${sheet.cellHeight}px cells`;
  elements.cellSize.textContent = `${sheet.cellWidth} × ${sheet.cellHeight}px`;
  elements.atlasSize.textContent = `${sheet.width} × ${sheet.height}px`;
  elements.selectedCellLabel.textContent =
    `Column ${selectedCell.col + 1}, row ${selectedCell.row + 1}`;
  updateSelectionBox();
  drawSelectedCell();
}

function updateSelectionBox() {
  const sheet = selectedSheet();
  Object.assign(elements.cellSelection.style, {
    left: `${(selectedCell.col / sheet.cols) * 100}%`,
    top: `${(selectedCell.row / sheet.rows) * 100}%`,
    width: `${100 / sheet.cols}%`,
    height: `${100 / sheet.rows}%`,
  });
}

function drawSelectedCell() {
  const image = elements.atlasPreview;
  if (!image.complete || image.naturalWidth === 0) {
    return;
  }
  const sheet = selectedSheet();
  const canvas = elements.cellPreview;
  const scale = Math.min(
    4,
    240 / sheet.cellWidth,
    280 / sheet.cellHeight
  );
  canvas.width = Math.round(sheet.cellWidth * scale);
  canvas.height = Math.round(sheet.cellHeight * scale);
  canvas.style.width = `${canvas.width}px`;
  canvas.style.height = `${canvas.height}px`;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("Canvas 2D context is unavailable");
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    selectedCell.col * sheet.cellWidth,
    selectedCell.row * sheet.cellHeight,
    sheet.cellWidth,
    sheet.cellHeight,
    0,
    0,
    canvas.width,
    canvas.height
  );
}

async function requestPreview() {
  const generation = ++previewGeneration;
  elements.previewSpinner.classList.remove("hidden");
  elements.download.classList.add("disabled");
  try {
    const response = await fetch("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sheetId: selectedSheetId, config }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error ?? `Preview failed (${response.status})`);
    }
    const blob = await response.blob();
    if (generation !== previewGeneration) {
      return;
    }
    if (previewUrl !== undefined) {
      URL.revokeObjectURL(previewUrl);
    }
    previewUrl = URL.createObjectURL(blob);
    elements.atlasPreview.src = previewUrl;
    elements.download.href = previewUrl;
    elements.download.download = selectedSheet().output;
    elements.download.classList.remove("disabled");
    setStatus("Preview rendered. Save & bake to update production assets.");
  } catch (error) {
    if (generation === previewGeneration) {
      setStatus(
        error instanceof Error ? error.message : "Could not render preview",
        "error"
      );
    }
  } finally {
    if (generation === previewGeneration) {
      elements.previewSpinner.classList.add("hidden");
    }
  }
}

function schedulePreview(delay = 180) {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    void requestPreview();
  }, delay);
}

function updateTuning(key, value) {
  if (!Number.isFinite(value)) {
    return;
  }
  config.sheets[selectedSheetId][key] = value;
  markDirty();
  renderControls();
  schedulePreview();
}

function bindPair(range, number, key, transform = (value) => value) {
  range.addEventListener("input", () => {
    const value = Number(range.value);
    number.value = range.value;
    updateTuning(key, transform(value));
  });
  number.addEventListener("input", () => {
    const value = Number(number.value);
    if (!Number.isFinite(value)) {
      return;
    }
    range.value = number.value;
    updateTuning(key, transform(value));
  });
}

async function bake() {
  elements.bake.disabled = true;
  setStatus(`Baking all ${sheets.length} production atlases…`);
  try {
    const response = await fetch("/api/bake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? `Bake failed (${response.status})`);
    }
    config = body.config;
    markDirty(false);
    setStatus(
      `Saved settings and baked ${body.outputs.length} production PNGs.`,
      "success"
    );
    schedulePreview(0);
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Could not bake atlases",
      "error"
    );
  } finally {
    elements.bake.disabled = false;
  }
}

elements.atlasPreview.addEventListener("load", () => {
  updateSelectionBox();
  drawSelectedCell();
});

elements.atlasStage.addEventListener("click", (event) => {
  const sheet = selectedSheet();
  const bounds = elements.atlasPreview.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) {
    return;
  }
  selectedCell = {
    col: Math.max(
      0,
      Math.min(
        sheet.cols - 1,
        Math.floor(((event.clientX - bounds.left) / bounds.width) * sheet.cols)
      )
    ),
    row: Math.max(
      0,
      Math.min(
        sheet.rows - 1,
        Math.floor(((event.clientY - bounds.top) / bounds.height) * sheet.rows)
      )
    ),
  };
  renderSelection();
});

bindPair(
  elements.offsetXRange,
  elements.offsetXNumber,
  "offsetX"
);
bindPair(
  elements.offsetYRange,
  elements.offsetYNumber,
  "offsetY"
);
bindPair(
  elements.scaleRange,
  elements.scaleNumber,
  "scale",
  (value) => value / 100
);

elements.rotation.addEventListener("change", () => {
  updateTuning("rotation", Number(elements.rotation.value));
});

bindPair(
  elements.scaleXRange,
  elements.scaleXNumber,
  "scaleX",
  (value) => value / 100
);
bindPair(
  elements.scaleYRange,
  elements.scaleYNumber,
  "scaleY",
  (value) => value / 100
);

elements.resetSheet.addEventListener("click", () => {
  config.sheets[selectedSheetId] = clone(defaults.sheets[selectedSheetId]);
  markDirty();
  renderControls();
  schedulePreview(0);
});

elements.resetAll.addEventListener("click", () => {
  config = clone(defaults);
  markDirty();
  renderControls();
  schedulePreview(0);
});

elements.bake.addEventListener("click", () => {
  void bake();
});

window.addEventListener("beforeunload", (event) => {
  if (dirty) {
    event.preventDefault();
  }
});

async function start() {
  try {
    const response = await fetch("/api/state");
    if (!response.ok) {
      throw new Error(`Could not load editor state (${response.status})`);
    }
    const state = await response.json();
    config = state.config;
    defaults = state.defaults;
    sheets = state.sheets;
    selectedSheetId = sheets[0]?.id;
    if (selectedSheetId === undefined) {
      throw new Error("No MCR tile sheets were configured");
    }
    renderSelection();
    schedulePreview(0);
  } catch (error) {
    setStatus(
      error instanceof Error ? error.message : "Could not start editor",
      "error"
    );
  }
}

void start();
