const tileImgWidth = 80;
const tileImgHeight = 129;
const resourceFileWidth = tileImgWidth * 10;
const resourceFileHeight = tileImgHeight * 4;

const tiltedTileImgWidth = 116;
const tiltedTileImgHeight = 91;
const tiltedTileTopMargin = 13;
const tiltedResourceFileWidth = tiltedTileImgWidth * 10;
const tiltedResourceFileHeight = tiltedTileImgHeight * 4;

const shrinkFactor = 1;
const gapWeight = 0.5;
const offsetWeight = 0.5;

const inputFileName = "tiles.png";
const inputCalledFileName = "tilesCalled.png";

const resourcesInputDirName = fs.existsSync("./app/bot/resources/tiles/base/")
  ? "./app/bot/resources/tiles/base/"
  : "./resources/tiles/base/";
const resourcesCacheDirName = "/tmp/tiles-generated/";
import { loadImage, createCanvas, DOMMatrix } from "canvas";
import { type HandToDisplay, MeldSource, MeldType } from "./handTypes";
import * as fs from "fs";
import { splitTiles } from "./handParser";

async function getAllTiles() {
  return await loadImage(resourcesInputDirName + inputFileName);
}

async function getAllTiltedTiles() {
  return await loadImage(resourcesInputDirName + inputCalledFileName);
}

export function handToFileName(hand: HandToDisplay) {
  return `${hand.closedTiles}${hand.melds.length > 0 ? "_" : ""}${hand.melds.map((meld) => `${meld.source}${meld.type}${meld.tiles}`).join("_")}${hand.lastTileSeparated ? "_x" : ""}.png`;
}
export function handStrToFileName(hand: string, lastTileSeparated: boolean) {
  return `${hand}${lastTileSeparated ? "_x" : ""}.png`;
}

async function WriteImageFromHand(hand: HandToDisplay, outputPath: string) {
  const resImage = await getAllTiles();
  const resImageTilted = await getAllTiltedTiles();
  const closedTileList = splitTiles(hand.closedTiles);

  let normalizedWidth =
    closedTileList.length + (hand.lastTileSeparated ? gapWeight : 0);
  hand.melds.forEach((meld) => {
    //block spacing
    normalizedWidth += gapWeight;
    //block size
    switch (meld.type) {
      case MeldType.Chii:
      case MeldType.Pon:
      case MeldType.Shouminkan:
        normalizedWidth += 3 + gapWeight;
        break;
      case MeldType.Ankan:
        normalizedWidth += 4;
        break;
      case MeldType.Daiminkan:
        normalizedWidth += 4 + gapWeight;
        break;
    }
  });
  normalizedWidth += offsetWeight * 2;

  const verticalTileWidth = Math.floor(tileImgWidth / shrinkFactor);
  const gapSize = Math.floor(tileImgWidth * gapWeight);
  const offsetSize = Math.floor(tileImgWidth * offsetWeight);

  const isKakanInHand = hand.melds.find(
    (meld) => meld.type === MeldType.Shouminkan
  );

  const targetWidth = Math.floor(verticalTileWidth * normalizedWidth);
  const targetHeight = Math.floor(
    (isKakanInHand
      ? tiltedTileImgHeight * 2 - tiltedTileTopMargin
      : tileImgHeight) /
      shrinkFactor +
      1
  );

  const sourceCanvas = createCanvas(resourceFileWidth, resourceFileHeight);
  const sourceContext = sourceCanvas.getContext("2d");
  sourceContext.drawImage(resImage, 0, 0);

  const sourceCanvasTilted = createCanvas(
    tiltedResourceFileWidth,
    tiltedResourceFileHeight
  );
  const sourceContextTilted = sourceCanvasTilted.getContext("2d");
  sourceContextTilted.drawImage(resImageTilted, 0, 0);

  const targetCanvas = createCanvas(targetWidth, targetHeight);
  const targetContext = targetCanvas.getContext("2d");
  const transform = new DOMMatrix();
  transform.scaleSelf(1 / shrinkFactor);
  targetContext.setTransform(transform);

  let targetX = offsetSize;
  //tiles will be drawn lower itf there is a kakan in the hand
  const targetY = Math.floor(
    isKakanInHand
      ? tiltedTileImgHeight * 2 - tiltedTileTopMargin - tileImgHeight
      : 0
  );

  let i = 0;
  for (i = 0; i < closedTileList.length - 1; i++) {
    const tileArea = getTileArea(closedTileList[i]);
    targetContext.drawImage(
      sourceCanvas,
      tileArea.x,
      tileArea.y,
      tileArea.width,
      tileArea.height,
      targetX,
      targetY,
      tileImgWidth,
      tileImgHeight
    );
    targetX += tileArea.width;
  }
  if (hand.lastTileSeparated) {
    targetX += gapSize / 2;
  }
  const tileArea = getTileArea(closedTileList[i]);
  targetContext.drawImage(
    sourceCanvas,
    tileArea.x,
    tileArea.y,
    tileArea.width,
    tileArea.height,
    targetX,
    targetY,
    tileImgWidth,
    tileImgHeight
  );
  targetX += tileArea.width;

  if (hand.lastTileSeparated) {
    targetX += gapSize / 2;
  }

  hand.melds.forEach((meld) => {
    targetX += gapSize;
    const meldedTiles = splitTiles(meld.tiles);
    if (meld.type === MeldType.Shouminkan) {
      meldedTiles.pop();
    }
    for (let i = 0; i < meldedTiles.length; i++) {
      const isTilted =
        (i === 0 && meld.source === MeldSource.Kamicha) ||
        (i === 1 && meld.source === MeldSource.Toimen) ||
        (i === meldedTiles.length - 1 && meld.source === MeldSource.Shimocha);
      if (
        meld.type == MeldType.Ankan &&
        (i === 0 || i === meldedTiles.length - 1)
      ) {
        meldedTiles[i] = "0z";
      }
      const tileArea = getTileArea(meldedTiles[i], isTilted);
      targetContext.drawImage(
        isTilted ? sourceCanvasTilted : sourceCanvas,
        tileArea.x,
        tileArea.y,
        tileArea.width,
        tileArea.height,
        targetX,
        targetY + (isTilted ? tileImgHeight - tiltedTileImgHeight : 0),
        isTilted ? tiltedTileImgWidth : tileImgWidth,
        isTilted ? tiltedTileImgHeight : tileImgHeight
      );
      if (meld.type === MeldType.Shouminkan && isTilted) {
        targetContext.drawImage(
          isTilted ? sourceCanvasTilted : sourceCanvas,
          tileArea.x,
          tileArea.y,
          tileArea.width,
          tileArea.height,
          targetX,
          targetY +
            tileImgHeight -
            tiltedTileImgHeight * 2 +
            tiltedTileTopMargin,
          isTilted ? tiltedTileImgWidth : tileImgWidth,
          isTilted ? tiltedTileImgHeight : tileImgHeight
        );
      }
      targetX += tileArea.width;
    }
  });

  return new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(outputPath);
    const stream = targetCanvas.createPNGStream();
    stream.pipe(out);
    out.on("finish", async () => {
      try {
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

type Rectangle = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function getTileArea(tile: string, isTilted: boolean = false): Rectangle {
  const tileNumber = parseInt(tile[0]);
  let virtualXPos = tileNumber;
  let virtualYPos = 0;
  switch (tile[1]) {
    case "s":
      virtualYPos = 0;
      break;
    case "m":
      virtualYPos = 1;
      break;
    case "p":
      virtualYPos = 2;
      break;
    case "z":
      virtualYPos = 3;
      virtualXPos = (tileNumber - 1) % 8;
  }

  if (isTilted) {
    return {
      x: virtualXPos * tiltedTileImgWidth,
      y: virtualYPos * tiltedTileImgHeight,
      width: tiltedTileImgWidth,
      height: tiltedTileImgHeight,
    };
  }
  return {
    x: virtualXPos * tileImgWidth,
    y: virtualYPos * tileImgHeight,
    width: tileImgWidth,
    height: tileImgHeight,
  };
}

export async function getImageFromTiles(hand: HandToDisplay) {
  const outputFilePath = resourcesCacheDirName + handToFileName(hand);

  if (!fs.existsSync(outputFilePath)) {
    if (!fs.existsSync(resourcesCacheDirName)) {
      fs.mkdirSync(resourcesCacheDirName);
    }
    return await WriteImageFromHand(hand, outputFilePath).then(
      () => outputFilePath
    );
  }

  return outputFilePath;
  //return fs.readFileSync(outputFilePath);
}

export function checkFileExists(hand: string, lastTileSeparated: boolean) {
  const outputFilePath =
    resourcesCacheDirName + handStrToFileName(hand, lastTileSeparated);
  return fs.existsSync(outputFilePath);
}

//=============
//===  UTIL ===
//=============

export async function generateTiltedTiles() {
  const resImageTilted = await loadImage(
    resourcesInputDirName + "tilesCalledOld.png"
  );
  const resImageBlank = await loadImage(
    resourcesInputDirName + "tilesCalledBlank.png"
  );

  const closedTileList = splitTiles(
    "0123456789s0123456789m0123456789p12345670z"
  );

  const sourceCanvasTilted = createCanvas(
    resourceFileHeight,
    resourceFileWidth
  );
  const sourceContextTilted = sourceCanvasTilted.getContext("2d");
  sourceContextTilted.drawImage(resImageTilted, 0, 0);

  const sourceCanvasBlank = createCanvas(
    tiltedResourceFileWidth,
    tiltedResourceFileHeight
  );
  const sourceContextBlank = sourceCanvasBlank.getContext("2d");
  sourceContextBlank.drawImage(resImageBlank, 0, 0);

  const oldMarginLeft = 21;
  const oldMarginRight = 6;
  const oldMarginTop = 4;
  const oldMarginBot = 4;

  const newMarginLeft = 5;
  const newMarginTop = 17;

  closedTileList.forEach((tile) => {
    const tilePos = getTileArea(tile, true);

    const tileSymbol = sourceContextTilted.getImageData(
      tilePos.x + oldMarginLeft,
      tilePos.y + oldMarginTop,
      tilePos.width - oldMarginLeft - oldMarginRight,
      tilePos.height - oldMarginTop - oldMarginBot
    );
    const blankTilePos = getTileArea(tile, true);
    sourceContextBlank.putImageData(
      tileSymbol,
      blankTilePos.x + newMarginLeft,
      blankTilePos.y + newMarginTop
    );
  });

  const out = fs.createWriteStream(resourcesCacheDirName + "out.png");
  const stream = sourceCanvasBlank.createPNGStream();
  stream.pipe(out);
}
