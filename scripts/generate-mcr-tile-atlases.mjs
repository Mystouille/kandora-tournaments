import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const sourceRoot = path.join(
  scriptDir,
  "assets",
  "samoheen-mahjong-tiles",
  "hongkong",
  "svg"
);
const tenhouRoot = path.join(root, "app", "game", "tenhouSprites");
const mcrRoot = path.join(root, "app", "game", "mcrSprites");
export const MCR_TILE_ATLAS_CONFIG_PATH = path.join(
  scriptDir,
  "mcr-tile-atlases.json"
);
export const MCR_TILE_ATLAS_OUTPUT_ROOT = mcrRoot;

const suitFaces = {
  m: [
    "08-characters-1.svg",
    "09-characters-2.svg",
    "10-characters-3.svg",
    "11-characters-4.svg",
    "12-characters-5.svg",
    "13-characters-6.svg",
    "14-characters-7.svg",
    "15-characters-8.svg",
    "16-characters-9.svg",
  ],
  p: [
    "17-circles-1.svg",
    "18-circles-2.svg",
    "19-circles-3.svg",
    "20-circles-4.svg",
    "21-circles-5.svg",
    "22-circles-6.svg",
    "23-circles-7.svg",
    "24-circles-8.svg",
    "25-circles-9.svg",
  ],
  s: [
    "26-bamboos-1.svg",
    "27-bamboos-2.svg",
    "28-bamboos-3.svg",
    "29-bamboos-4.svg",
    "30-bamboos-5.svg",
    "31-bamboos-6.svg",
    "32-bamboos-7.svg",
    "33-bamboos-8.svg",
    "34-bamboos-9.svg",
  ],
};
const honorFaces = [
  "04-east-wind.svg",
  "05-south-wind.svg",
  "06-west-wind.svg",
  "07-north-wind.svg",
  "01-white-dragon.svg",
  "02-green-dragon.svg",
  "03-red-dragon.svg",
];
const flowerFaces = [
  "35-spring.svg",
  "36-summer.svg",
  "37-autumn.svg",
  "38-winter.svg",
  "39-plum.svg",
  "40-orchid.svg",
  "42-bamboo.svg",
  "41-chrysanthemum.svg",
];

export const MCR_TILE_SHEETS = [
  {
    id: "ownHand",
    label: "Focused hand",
    source: "ownHand.png",
    output: "mcrEngravedOwnHand.png",
    rotation: 0,
    cols: 10,
    rows: 5,
  },
  {
    id: "bottomSmall",
    label: "Bottom small",
    source: "bottomSmall.png",
    output: "mcrEngravedBottomSmall.png",
    rotation: 0,
    cols: 10,
    rows: 5,
  },
  {
    id: "topSmall",
    label: "Top small",
    source: "topSmall.png",
    output: "mcrEngravedTopSmall.png",
    rotation: 180,
    cols: 10,
    rows: 5,
  },
  {
    id: "leftSmall",
    label: "Left small",
    source: "leftSmall.png",
    output: "mcrEngravedLeftSmall.png",
    rotation: 90,
    cols: 10,
    rows: 5,
    allowsSqueeze: true,
  },
  {
    id: "rightSmall",
    label: "Right small",
    source: "rightSmall.png",
    output: "mcrEngravedRightSmall.png",
    rotation: -90,
    cols: 10,
    rows: 5,
    allowsSqueeze: true,
  },
];

const DEFAULT_TUNING = Object.freeze({
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
});

export const DEFAULT_MCR_TILE_ATLAS_CONFIG = Object.freeze({
  version: 1,
  sheets: Object.freeze(
    Object.fromEntries(
      MCR_TILE_SHEETS.map((sheet) => [
        sheet.id,
        Object.freeze({
          offsetX: DEFAULT_TUNING.offsetX,
          offsetY: DEFAULT_TUNING.offsetY,
          scale: DEFAULT_TUNING.scale,
          rotation: DEFAULT_TUNING.rotation,
          ...(sheet.allowsSqueeze
            ? {
                scaleX: DEFAULT_TUNING.scaleX,
                scaleY: DEFAULT_TUNING.scaleY,
              }
            : {}),
        }),
      ])
    )
  ),
});

const sourceFaces = new Map();

function finiteNumber(value, fallback, name) {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== "number" || !Number.isFinite(resolved)) {
    throw new TypeError(`${name} must be a finite number`);
  }
  return resolved;
}

export function normalizeMcrTileAtlasConfig(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("MCR tile atlas config must be an object");
  }
  if (input.version !== undefined && input.version !== 1) {
    throw new RangeError("Unsupported MCR tile atlas config version");
  }
  if (
    input.sheets !== undefined &&
    (input.sheets === null ||
      typeof input.sheets !== "object" ||
      Array.isArray(input.sheets))
  ) {
    throw new TypeError("MCR tile atlas config sheets must be an object");
  }
  const sheets = {};
  for (const sheet of MCR_TILE_SHEETS) {
    const raw = input.sheets?.[sheet.id] ?? {};
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new TypeError(`Sheet tuning "${sheet.id}" must be an object`);
    }
    const offsetX = finiteNumber(
      raw.offsetX,
      DEFAULT_TUNING.offsetX,
      `${sheet.id}.offsetX`
    );
    const offsetY = finiteNumber(
      raw.offsetY,
      DEFAULT_TUNING.offsetY,
      `${sheet.id}.offsetY`
    );
    const scale = finiteNumber(
      raw.scale,
      DEFAULT_TUNING.scale,
      `${sheet.id}.scale`
    );
    const rotation = finiteNumber(
      raw.rotation,
      DEFAULT_TUNING.rotation,
      `${sheet.id}.rotation`
    );
    const scaleX = finiteNumber(
      raw.scaleX,
      DEFAULT_TUNING.scaleX,
      `${sheet.id}.scaleX`
    );
    const scaleY = finiteNumber(
      raw.scaleY,
      DEFAULT_TUNING.scaleY,
      `${sheet.id}.scaleY`
    );
    if (Math.abs(offsetX) > 100 || Math.abs(offsetY) > 100) {
      throw new RangeError(
        `Sheet tuning "${sheet.id}" offsets must be within -100 and 100`
      );
    }
    if (scale < 0.5 || scale > 1.5) {
      throw new RangeError(
        `Sheet tuning "${sheet.id}" scale must be within 0.5 and 1.5`
      );
    }
    if (![0, 90, 180, 270].includes(rotation)) {
      throw new RangeError(
        `Sheet tuning "${sheet.id}" rotation must be 0, 90, 180, or 270`
      );
    }
    if (
      scaleX < 0.5 ||
      scaleX > 1.5 ||
      scaleY < 0.5 ||
      scaleY > 1.5
    ) {
      throw new RangeError(
        `Sheet tuning "${sheet.id}" axis scales must be within 0.5 and 1.5`
      );
    }
    if (
      !sheet.allowsSqueeze &&
      (raw.scaleX !== undefined || raw.scaleY !== undefined)
    ) {
      throw new RangeError(
        `Sheet tuning "${sheet.id}" does not support axis squeezing`
      );
    }
    sheets[sheet.id] = {
      offsetX,
      offsetY,
      scale,
      rotation,
      ...(sheet.allowsSqueeze ? { scaleX, scaleY } : {}),
    };
  }
  return { version: 1, sheets };
}

export async function readMcrTileAtlasConfig(
  configPath = MCR_TILE_ATLAS_CONFIG_PATH
) {
  let parsed;
  try {
    parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read MCR tile atlas config: ${configPath}`, {
      cause: error,
    });
  }
  return normalizeMcrTileAtlasConfig(parsed);
}

export async function writeMcrTileAtlasConfig(
  input,
  configPath = MCR_TILE_ATLAS_CONFIG_PATH
) {
  const config = normalizeMcrTileAtlasConfig(input);
  const temporaryPath = `${configPath}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`);
  await fs.rename(temporaryPath, configPath);
  return config;
}

async function faceSource(fileName) {
  const cached = sourceFaces.get(fileName);
  if (cached !== undefined) {
    return cached;
  }
  const source = await fs.readFile(path.join(sourceRoot, fileName), "utf8");
  sourceFaces.set(fileName, source);
  return source;
}

function engravedFaceSvg(source, width, height, heightFactor, topFactor) {
  const encoded = Buffer.from(source).toString("base64");
  const edge = Math.max(0.65, width / 109);
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <filter id="engrave" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB">
          <feComponentTransfer in="SourceGraphic" result="ink">
            <feFuncA type="linear" slope="0.78"/>
          </feComponentTransfer>
          <feOffset in="SourceAlpha" dx="${edge}" dy="${edge}" result="down"/>
          <feComposite in="SourceAlpha" in2="down" operator="out" result="topLeftEdge"/>
          <feFlood flood-color="#382f25" flood-opacity="0.68" result="shadowColor"/>
          <feComposite in="shadowColor" in2="topLeftEdge" operator="in" result="shadow"/>
          <feOffset in="SourceAlpha" dx="${-edge}" dy="${-edge}" result="up"/>
          <feComposite in="SourceAlpha" in2="up" operator="out" result="bottomRightEdge"/>
          <feGaussianBlur in="bottomRightEdge" stdDeviation="${edge * 0.16}" result="softHighlightEdge"/>
          <feFlood flood-color="#fffce8" flood-opacity="0.86" result="highlightColor"/>
          <feComposite in="highlightColor" in2="softHighlightEdge" operator="in" result="highlight"/>
          <feMerge>
            <feMergeNode in="shadow"/>
            <feMergeNode in="ink"/>
            <feMergeNode in="highlight"/>
          </feMerge>
        </filter>
      </defs>
      <image
        href="data:image/svg+xml;base64,${encoded}"
        x="${width * 0.05}"
        y="${height * topFactor}"
        width="${width * 0.9}"
        height="${height * heightFactor}"
        preserveAspectRatio="xMidYMid meet"
        filter="url(#engrave)"
      />
    </svg>
  `);
}

async function applyTuning(input, width, height, tuning) {
  if (
    tuning.offsetX === 0 &&
    tuning.offsetY === 0 &&
    tuning.scale === 1 &&
    (tuning.scaleX ?? 1) === 1 &&
    (tuning.scaleY ?? 1) === 1
  ) {
    return input;
  }
  const tunedWidth = width * tuning.scale * (tuning.scaleX ?? 1);
  const tunedHeight = height * tuning.scale * (tuning.scaleY ?? 1);
  const left = (width - tunedWidth) / 2 + tuning.offsetX;
  const top = (height - tunedHeight) / 2 + tuning.offsetY;
  const encoded = input.toString("base64");
  return sharp(
    Buffer.from(`
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <image
          href="data:image/png;base64,${encoded}"
          x="${left}"
          y="${top}"
          width="${tunedWidth}"
          height="${tunedHeight}"
          preserveAspectRatio="none"
        />
      </svg>
    `)
  )
    .png()
    .toBuffer();
}

async function renderFace(
  fileName,
  cellWidth,
  cellHeight,
  rotation,
  heightFactor = 0.73,
  topFactor = 0.2,
  tuning = DEFAULT_TUNING
) {
  const tunedRotation = (rotation + tuning.rotation) % 360;
  const sideways = tunedRotation === 90 || tunedRotation === 270;
  const logicalWidth = sideways ? cellHeight : cellWidth;
  const logicalHeight = sideways ? cellWidth : cellHeight;
  const source = await faceSource(fileName);
  let image = sharp(
    engravedFaceSvg(
      source,
      logicalWidth,
      logicalHeight,
      heightFactor,
      topFactor
    )
  );
  if (tunedRotation !== 0) {
    image = image.rotate(tunedRotation, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  return applyTuning(
    await image.png().toBuffer(),
    cellWidth,
    cellHeight,
    tuning
  );
}

async function cropCell(sourcePath, cellWidth, cellHeight, row, col) {
  return sharp(sourcePath)
    .extract({
      left: col * cellWidth,
      top: row * cellHeight,
      width: cellWidth,
      height: cellHeight,
    })
    .png()
    .toBuffer();
}

async function gridCellSize(sourcePath) {
  const metadata = await sharp(sourcePath).metadata();
  if (
    metadata.width === undefined ||
    metadata.height === undefined ||
    metadata.width % 10 !== 0 ||
    metadata.height % 4 !== 0
  ) {
    throw new Error(`Unexpected Tenhou atlas dimensions: ${sourcePath}`);
  }
  return {
    width: metadata.width / 10,
    height: metadata.height / 4,
    atlasWidth: metadata.width,
    atlasHeight: metadata.height,
  };
}

async function generateDirectionalAtlas(spec, tuning) {
  const sourcePath = path.join(tenhouRoot, spec.source);
  const size = await gridCellSize(sourcePath);
  const blank = await cropCell(sourcePath, size.width, size.height, 3, 5);
  const back = await cropCell(sourcePath, size.width, size.height, 3, 0);
  const composites = [
    {
      input: back,
      left: 0,
      top: size.height * 3,
    },
  ];

  for (const [row, suit] of ["m", "p", "s"].entries()) {
    for (let col = 0; col < 10; col += 1) {
      const rank = col === 0 ? 5 : col;
      const face = suitFaces[suit][rank - 1];
      composites.push(
        {
          input: blank,
          left: col * size.width,
          top: row * size.height,
        },
        {
          input: await renderFace(
            face,
            size.width,
            size.height,
            spec.rotation,
            0.73,
            0.2,
            tuning
          ),
          left: col * size.width,
          top: row * size.height,
        }
      );
    }
  }

  for (const [index, face] of honorFaces.entries()) {
    const col = index + 1;
    composites.push(
      {
        input: blank,
        left: col * size.width,
        top: size.height * 3,
      },
      {
        input: await renderFace(
          face,
          size.width,
          size.height,
          spec.rotation,
          0.73,
          0.2,
          tuning
        ),
        left: col * size.width,
        top: size.height * 3,
      }
    );
  }

  for (const col of [0, 9]) {
    composites.push({
      input: blank,
      left: col * size.width,
      top: size.height * 4,
    });
  }
  for (const [index, face] of flowerFaces.entries()) {
    const col = index + 1;
    composites.push(
      {
        input: blank,
        left: col * size.width,
        top: size.height * 4,
      },
      {
        input: await renderFace(
          face,
          size.width,
          size.height,
          spec.rotation,
          0.77,
          0.18,
          tuning
        ),
        left: col * size.width,
        top: size.height * 4,
      }
    );
  }

  const buffer = await sharp({
    create: {
      width: size.atlasWidth,
      height: size.height * spec.rows,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
  return {
    buffer,
    width: size.atlasWidth,
    height: size.height * spec.rows,
    cellWidth: size.width,
    cellHeight: size.height,
  };
}

export async function renderMcrTileSheet(sheetId, inputConfig) {
  const config = normalizeMcrTileAtlasConfig(inputConfig);
  const spec = MCR_TILE_SHEETS.find((candidate) => candidate.id === sheetId);
  if (spec === undefined) {
    throw new RangeError(`Unknown MCR tile sheet: ${sheetId}`);
  }
  const rendered = await generateDirectionalAtlas(
    spec,
    config.sheets[spec.id]
  );
  return {
    ...rendered,
    id: spec.id,
    label: spec.label,
    output: spec.output,
    cols: spec.cols,
    rows: spec.rows,
  };
}

export async function describeMcrTileSheets() {
  return Promise.all(
    MCR_TILE_SHEETS.map(async (spec) => {
      const sourcePath = path.join(tenhouRoot, spec.source);
      const size = await gridCellSize(sourcePath);
      return {
        id: spec.id,
        label: spec.label,
        output: spec.output,
        cols: spec.cols,
        rows: spec.rows,
        allowsSqueeze: spec.allowsSqueeze === true,
        width: size.width * spec.cols,
        height: size.height * spec.rows,
        cellWidth: size.width,
        cellHeight: size.height,
      };
    })
  );
}

export async function bakeMcrTileAtlases(
  inputConfig,
  outputRoot = MCR_TILE_ATLAS_OUTPUT_ROOT
) {
  const config = normalizeMcrTileAtlasConfig(inputConfig);
  await fs.mkdir(outputRoot, { recursive: true });
  const renderedOutputs = await Promise.all(
    MCR_TILE_SHEETS.map(async (spec) => {
      const rendered = await renderMcrTileSheet(spec.id, config);
      const outputPath = path.join(outputRoot, spec.output);
      return {
        buffer: rendered.buffer,
        temporaryPath: `${outputPath}.${randomUUID()}.tmp`,
        outputPath,
        id: spec.id,
        output: spec.output,
        width: rendered.width,
        height: rendered.height,
      };
    })
  );
  try {
    await Promise.all(
      renderedOutputs.map(({ buffer, temporaryPath }) =>
        fs.writeFile(temporaryPath, buffer)
      )
    );
    for (const { temporaryPath, outputPath } of renderedOutputs) {
      await fs.rename(temporaryPath, outputPath);
    }
  } catch (error) {
    await Promise.allSettled(
      renderedOutputs.map(({ temporaryPath }) =>
        fs.rm(temporaryPath, { force: true })
      )
    );
    throw error;
  }
  return renderedOutputs.map(
    ({ id, output, outputPath, width, height }) => ({
      id,
      output,
      outputPath,
      width,
      height,
    })
  );
}

const invokedPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const config = await readMcrTileAtlasConfig();
  const outputs = await bakeMcrTileAtlases(config);
  for (const output of outputs) {
    console.log(
      `${output.output} ${output.width}x${output.height}`
    );
  }
}
