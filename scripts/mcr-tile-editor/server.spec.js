import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MCR_TILE_ATLAS_CONFIG,
  MCR_TILE_SHEETS,
  normalizeMcrTileAtlasConfig,
  renderMcrTileSheet,
} from "../generate-mcr-tile-atlases.mjs";
import { createMcrTileEditorServer } from "./server.mjs";

const temporaryRoots = [];
const servers = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        })
    )
  );
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true })
    )
  );
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mcr-tile-editor-"));
  temporaryRoots.push(root);
  const configPath = path.join(root, "config.json");
  const outputRoot = path.join(root, "output");
  await fs.writeFile(
    configPath,
    `${JSON.stringify(DEFAULT_MCR_TILE_ATLAS_CONFIG, null, 2)}\n`
  );
  const server = createMcrTileEditorServer({ configPath, outputRoot });
  servers.push(server);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected a TCP editor address");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    configPath,
    outputRoot,
  };
}

async function coloredBounds(buffer, left, top, width, height) {
  const { data, info } = await sharp(buffer)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * info.channels;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      if (Math.max(red, green, blue) - Math.min(red, green, blue) > 35) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < minX || maxY < minY) {
    throw new Error("Expected colored decal pixels");
  }
  return { width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function blueCarvingLuminance(buffer, left, top, width, height) {
  const { data, info } = await sharp(buffer)
    .extract({ left, top, width, height })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = [];
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * info.channels;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      if (blue - red > 45 && blue - green > 20) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        pixels.push({
          x,
          y,
          luminance: 0.2126 * red + 0.7152 * green + 0.0722 * blue,
        });
      }
    }
  }
  if (pixels.length === 0) {
    throw new Error("Expected blue decal pixels");
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const threshold = Math.min(maxX - minX, maxY - minY) * 0.25;
  let topLeftLuminance = 0;
  let topLeftPixels = 0;
  let bottomRightLuminance = 0;
  let bottomRightPixels = 0;
  for (const pixel of pixels) {
    const direction = pixel.x - centerX + pixel.y - centerY;
    if (direction < -threshold) {
      topLeftLuminance += pixel.luminance;
      topLeftPixels += 1;
    } else if (direction > threshold) {
      bottomRightLuminance += pixel.luminance;
      bottomRightPixels += 1;
    }
  }
  if (topLeftPixels === 0 || bottomRightPixels === 0) {
    throw new Error("Expected directional blue decal pixels");
  }
  return {
    topLeft: topLeftLuminance / topLeftPixels,
    bottomRight: bottomRightLuminance / bottomRightPixels,
  };
}

describe("MCR tile atlas editor", () => {
  it("validates bounded per-sheet tuning", () => {
    const configured = normalizeMcrTileAtlasConfig({
      version: 1,
      color: {
        contrast: 1.2,
        brightness: 0.9,
        saturation: 1.4,
        gamma: 1.1,
      },
      sheets: {
        ownHand: {
          offsetX: 2.5,
          offsetY: 7,
          scale: 1.08,
          rotation: 90,
        },
      },
    });
    expect(configured.color).toEqual({
      contrast: 1.2,
      brightness: 0.9,
      saturation: 1.4,
      gamma: 1.1,
    });
    expect(configured.sheets.ownHand).toEqual({
      offsetX: 2.5,
      offsetY: 7,
      scale: 1.08,
      rotation: 90,
    });
    expect(configured.sheets.bottomSmall).toEqual({
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotation: 0,
    });
    expect(configured.sheets.leftSmall).toMatchObject({
      scaleX: 1,
      scaleY: 1,
    });
    expect(normalizeMcrTileAtlasConfig({}).color).toEqual(
      DEFAULT_MCR_TILE_ATLAS_CONFIG.color
    );
    expect(() =>
      normalizeMcrTileAtlasConfig({
        sheets: { ownHand: { offsetY: 101 } },
      })
    ).toThrow(/offset/i);
    expect(() =>
      normalizeMcrTileAtlasConfig({
        sheets: { ownHand: { scale: 2 } },
      })
    ).toThrow(/scale/i);
    expect(() =>
      normalizeMcrTileAtlasConfig({
        sheets: { ownHand: { rotation: 45 } },
      })
    ).toThrow(/rotation/i);
    expect(() =>
      normalizeMcrTileAtlasConfig({
        sheets: { ownHand: { scaleX: 0.8 } },
      })
    ).toThrow(/squeez/i);
    expect(() =>
      normalizeMcrTileAtlasConfig({
        sheets: { leftSmall: { scaleY: 0.4 } },
      })
    ).toThrow(/axis scales/i);
    for (const [property, value] of Object.entries({
      contrast: 2.1,
      brightness: 0.4,
      saturation: -0.1,
      gamma: 2.1,
    })) {
      expect(() =>
        normalizeMcrTileAtlasConfig({
          color: { [property]: value },
        })
      ).toThrow(new RegExp(property, "i"));
    }
  });

  it("serves state and a same-sized PNG preview", async () => {
    const { baseUrl } = await fixture();
    const stateResponse = await fetch(`${baseUrl}/api/state`);
    expect(stateResponse.status).toBe(200);
    const state = await stateResponse.json();
    expect(state.sheets.map(({ id }) => id)).toEqual(
      MCR_TILE_SHEETS.map(({ id }) => id)
    );

    state.config.sheets.ownHand.offsetY = 4;
    const previewResponse = await fetch(`${baseUrl}/api/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sheetId: "ownHand",
        config: state.config,
      }),
    });
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.headers.get("content-type")).toBe("image/png");
    expect(previewResponse.headers.get("x-atlas-width")).toBe("1310");
    expect(previewResponse.headers.get("x-atlas-height")).toBe("990");
    expect((await previewResponse.arrayBuffer()).byteLength).toBeGreaterThan(
      100_000
    );
  });

  it("squeezes each side-sheet axis independently", async () => {
    const baseConfig = normalizeMcrTileAtlasConfig({});
    const horizontalConfig = normalizeMcrTileAtlasConfig({
      sheets: { leftSmall: { scaleX: 0.75 } },
    });
    const verticalConfig = normalizeMcrTileAtlasConfig({
      sheets: { leftSmall: { scaleY: 0.75 } },
    });
    const [base, horizontal, vertical] = await Promise.all([
      renderMcrTileSheet("leftSmall", baseConfig),
      renderMcrTileSheet("leftSmall", horizontalConfig),
      renderMcrTileSheet("leftSmall", verticalConfig),
    ]);
    const cell = { left: 116, top: 0, width: 116, height: 107 };
    const [baseBounds, horizontalBounds, verticalBounds] = await Promise.all([
      coloredBounds(base.buffer, cell.left, cell.top, cell.width, cell.height),
      coloredBounds(
        horizontal.buffer,
        cell.left,
        cell.top,
        cell.width,
        cell.height
      ),
      coloredBounds(
        vertical.buffer,
        cell.left,
        cell.top,
        cell.width,
        cell.height
      ),
    ]);
    expect(horizontalBounds.width).toBeLessThan(baseBounds.width);
    expect(
      Math.abs(horizontalBounds.height - baseBounds.height)
    ).toBeLessThanOrEqual(1);
    expect(verticalBounds.height).toBeLessThan(baseBounds.height);
    expect(
      Math.abs(verticalBounds.width - baseBounds.width)
    ).toBeLessThanOrEqual(1);
  });

  it("keeps carving lighting fixed after decal rotation", async () => {
    const config = normalizeMcrTileAtlasConfig({});
    const [bottom, top] = await Promise.all([
      renderMcrTileSheet("bottomSmall", config),
      renderMcrTileSheet("topSmall", config),
    ]);
    const cell = { left: 86, top: 130, width: 86, height: 130 };
    const lighting = await Promise.all(
      [bottom, top].map(({ buffer }) =>
        blueCarvingLuminance(
          buffer,
          cell.left,
          cell.top,
          cell.width,
          cell.height
        )
      )
    );
    for (const { topLeft, bottomRight } of lighting) {
      expect(bottomRight - topLeft).toBeGreaterThan(2);
    }
  });

  it("applies every global color control to rendered decals", async () => {
    const neutralConfig = normalizeMcrTileAtlasConfig({});
    const variants = Object.entries({
      contrast: 0.7,
      brightness: 0.75,
      saturation: 0,
      gamma: 1.8,
    });
    const [neutral, ...renderedVariants] = await Promise.all([
      renderMcrTileSheet("bottomSmall", neutralConfig),
      ...variants.map(([property, value]) =>
        renderMcrTileSheet(
          "bottomSmall",
          normalizeMcrTileAtlasConfig({
            color: { [property]: value },
          })
        )
      ),
    ]);
    for (const rendered of renderedVariants) {
      expect(rendered.buffer.equals(neutral.buffer)).toBe(false);
      expect(rendered).toMatchObject({
        width: neutral.width,
        height: neutral.height,
      });
    }
  });

  it("persists settings and bakes all production-shaped atlases", async () => {
    const { baseUrl, configPath, outputRoot } = await fixture();
    const config = normalizeMcrTileAtlasConfig({
      color: {
        contrast: 1.1,
        brightness: 0.95,
        saturation: 1.2,
        gamma: 1.05,
      },
      sheets: {
        ownHand: {
          offsetX: 1.5,
          offsetY: 6,
          scale: 0.96,
          rotation: 180,
        },
        bottomSmall: {
          offsetX: -1,
          offsetY: 3,
          scale: 1.04,
          rotation: 270,
        },
        leftSmall: {
          scaleX: 0.82,
          scaleY: 0.91,
        },
      },
    });
    const response = await fetch(`${baseUrl}/api/bake`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ config }),
    });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.outputs).toHaveLength(MCR_TILE_SHEETS.length);
    expect(
      JSON.parse(await fs.readFile(configPath, "utf8")).sheets.ownHand
    ).toEqual(config.sheets.ownHand);
    expect(
      JSON.parse(await fs.readFile(configPath, "utf8")).color
    ).toEqual(config.color);
    await expect(
      Promise.all(
        MCR_TILE_SHEETS.map(async ({ output }) => {
          const stat = await fs.stat(path.join(outputRoot, output));
          return stat.size;
        })
      )
    ).resolves.toEqual(
      expect.arrayContaining(
        MCR_TILE_SHEETS.map(() => expect.any(Number))
      )
    );
  });
});
