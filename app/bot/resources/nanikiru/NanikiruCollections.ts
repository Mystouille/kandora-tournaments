import { JWT } from "google-auth-library";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { googleSheetsConfig } from "config";
import {
  markReady,
  markSkipped,
  markFailed,
} from "~/services/readiness.server";
import {
  isNanikiruProblemPublic,
  KIN_PUBLIC_PROBLEM_LIMIT,
} from "./NanikiruAvailability";

export { isNanikiruProblemPublic, KIN_PUBLIC_PROBLEM_LIMIT };

const sheetsCfg = googleSheetsConfig();
const token = sheetsCfg
  ? JSON.parse(sheetsCfg.GOOGLE_SERVICE_ACCOUNT_JSON)
  : { client_email: "", private_key: "" };

export type NanikiruProblem = {
  id: number;
  round: string;
  seat: string;
  turn: string;
  dora: string;
  hand: string;
  answer: string;
  explanation: string;
  explanationFr: string | undefined;
  ukeire: string;
  source: string;
  context: string | undefined;
  options: string | undefined;
  hint: string | undefined;
};

export enum NanikiruType {
  Uzaku300 = "300",
  Uzaku301 = "301",
  UzakuKin = "KIN",
  Undefined = "Undefined",
}

const pageSizes = {
  [NanikiruType.Uzaku300]: 3,
  [NanikiruType.Uzaku301]: 3,
  [NanikiruType.UzakuKin]: 2,
  [NanikiruType.Undefined]: 1,
};

type Collection = {
  remainingProblems: NanikiruProblem[];
  problems: NanikiruProblem[];
};

type Collections = {
  uzaku300Collection: Collection;
  uzaku301Collection: Collection;
  uzakuKinCollection: Collection;
  customCollection: Collection;
};

export class NanikiruCollections {
  private static readonly GLOBAL_KEY = "__NanikiruCollections__";

  private collections: Collections;
  private currentProblems: NanikiruProblem[];
  private currentType: NanikiruType | undefined;
  private readonly initialization: Promise<void>;
  private initializationError: unknown = null;
  private serviceAccountAuth = new JWT({
    email: token.client_email,
    key: token.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  private doc: GoogleSpreadsheet;

  private constructor() {
    this.serviceAccountAuth = new JWT({
      email: token.client_email,
      key: token.private_key,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.doc = new GoogleSpreadsheet(
      sheetsCfg?.NANIKIRU_SHEET_ID ?? "",
      this.serviceAccountAuth
    );
    this.collections = {
      uzaku300Collection: { problems: [], remainingProblems: [] },
      uzaku301Collection: { problems: [], remainingProblems: [] },
      uzakuKinCollection: { problems: [], remainingProblems: [] },
      customCollection: { problems: [], remainingProblems: [] },
    };
    this.currentProblems = [];
    if (!sheetsCfg) {
      console.log("NANIKIRU_SHEET_ID not configured — nanikiru data disabled.");
      markSkipped("nanikiru");
      this.initialization = Promise.resolve();
      return;
    }
    this.initialization = this.fetchAllProblems()
      .then((problems) => {
        this.setCollections(problems);
        markReady("nanikiru", `${problems.length} problems loaded`);
      })
      .catch((err) => {
        this.initializationError = err;
        markFailed("nanikiru", String(err));
        console.error("Failed to fetch nanikiru problems:", err);
      });
  }

  public async waitUntilReady(): Promise<void> {
    await this.initialization;
    if (this.initializationError) {
      throw this.initializationError;
    }
  }

  private resetCollections() {
    this.collections = {
      uzaku300Collection: { problems: [], remainingProblems: [] },
      uzaku301Collection: { problems: [], remainingProblems: [] },
      uzakuKinCollection: { problems: [], remainingProblems: [] },
      customCollection: { problems: [], remainingProblems: [] },
    };
  }

  private getCollectionFromSource(type: NanikiruType) {
    switch (type) {
      case NanikiruType.Uzaku300:
        return this.collections.uzaku300Collection;
      case NanikiruType.Uzaku301:
        return this.collections.uzaku301Collection;
      case NanikiruType.UzakuKin:
        return this.collections.uzakuKinCollection;
      default:
        return this.collections.customCollection;
    }
  }

  public static get instance(): NanikiruCollections {
    if (
      !(
        (globalThis as any)[NanikiruCollections.GLOBAL_KEY] instanceof
        NanikiruCollections
      )
    ) {
      (globalThis as any)[NanikiruCollections.GLOBAL_KEY] =
        new NanikiruCollections();
    }
    return (globalThis as any)[NanikiruCollections.GLOBAL_KEY];
  }

  private setCollections(collection: NanikiruProblem[]) {
    this.resetCollections();
    collection.forEach((prob) => {
      if (prob.source === undefined || !isNanikiruProblemPublic(prob.source)) {
        return;
      }
      const type = prob.source.split("-")[0] as NanikiruType;
      const collection = this.getCollectionFromSource(type);
      collection.problems.push(prob);
      collection.remainingProblems.push(prob);
    });
  }

  private getNextProblems(type: NanikiruType): NanikiruProblem[] {
    const pageSize = pageSizes[type];
    const collection = this.getCollectionFromSource(type);
    if (collection.remainingProblems.length === 0) {
      collection.remainingProblems = collection.problems.slice(0);
    }
    const remainingProb = collection.remainingProblems;
    if (remainingProb.length === 0) {
      return [];
    }
    let startIdx = Math.floor(Math.random() * remainingProb.length);
    startIdx -= startIdx % pageSize;
    return remainingProb.splice(
      startIdx,
      Math.min(pageSize, remainingProb.length - startIdx)
    );
  }

  public getNextProblem(type: NanikiruType): NanikiruProblem | null {
    let problem = this.currentProblems.pop();
    if (problem === undefined || this.currentType !== type) {
      this.currentType = type;
      this.currentProblems = this.getNextProblems(type);
      this.currentProblems.reverse();
      problem = this.currentProblems.pop();
    }
    return problem ?? null;
  }

  /** Look up a problem by its source string from in-memory data. */
  public getProblemBySource(source: string): NanikiruProblem | null {
    if (!isNanikiruProblemPublic(source)) {
      return null;
    }
    const type = source.split("-")[0] as NanikiruType;
    const collection = this.getCollectionFromSource(type);
    return collection.problems.find((p) => p.source === source) ?? null;
  }

  /**
   * Find a problem by its number within a collection, then offset by `offset`.
   * The number is matched against the last segment of the source (e.g. "012" in "300-Q-012").
   * Returns the problem at position (foundIndex + offset) in the collection.
   */
  public getSequentialProblem(
    type: NanikiruType,
    problemNumber: number,
    offset: number
  ): NanikiruProblem | null {
    const collection = this.getCollectionFromSource(type);
    const padded = String(problemNumber).padStart(3, "0");
    const foundIndex = collection.problems.findIndex((p) => {
      const lastSegment = p.source.split("-").pop();
      return lastSegment === padded || lastSegment === String(problemNumber);
    });
    if (foundIndex === -1) {
      return null;
    }
    const targetIndex = foundIndex + offset;
    if (targetIndex < 0 || targetIndex >= collection.problems.length) {
      return null;
    }
    return collection.problems[targetIndex];
  }

  /** Get the total number of problems for a given type. */
  public getProblemCount(type: NanikiruType): number {
    return this.getCollectionFromSource(type).problems.length;
  }

  public async getProblemFromRowId(
    id: number
  ): Promise<NanikiruProblem | null> {
    if (id <= 1) {
      return null;
    }
    await this.doc.loadInfo();
    for (const sheet of Object.values(this.doc.sheetsByTitle)) {
      const rows = await sheet.getRows();
      const row = rows[id - 2];
      if (
        row &&
        row.get("hand") &&
        row.get("answer") &&
        isNanikiruProblemPublic(row.get("source"))
      ) {
        return {
          id: row.rowNumber,
          round: row.get("round"),
          seat: row.get("seat"),
          turn: row.get("turn"),
          dora: row.get("dora"),
          hand: row.get("hand"),
          context: row.get("context"),
          options: row.get("options"),
          hint: row.get("hint"),
          answer: row.get("answer"),
          explanation: row.get("explanation"),
          explanationFr:
            row.get("explanationFr") || row.get("explanationfr") || undefined,
          ukeire: row.get("ukeire"),
          source: row.get("source"),
        };
      }
    }
    return null;
  }

  public async getProblemFromSource(
    source: string
  ): Promise<NanikiruProblem | null> {
    if (!isNanikiruProblemPublic(source)) {
      return null;
    }
    await this.doc.loadInfo();
    for (const sheet of Object.values(this.doc.sheetsByTitle)) {
      const rows = await sheet.getRows();
      for (const row of rows) {
        if (
          row.get("source") === source &&
          row.get("hand") &&
          row.get("answer")
        ) {
          return {
            id: row.rowNumber,
            round: row.get("round"),
            seat: row.get("seat"),
            turn: row.get("turn"),
            dora: row.get("dora"),
            hand: row.get("hand"),
            context: row.get("context"),
            options: row.get("options"),
            hint: row.get("hint"),
            answer: row.get("answer"),
            explanation: row.get("explanation"),
            explanationFr:
              row.get("explanationFr") || row.get("explanationfr") || undefined,
            ukeire: row.get("ukeire"),
            source: row.get("source"),
          };
        }
      }
    }
    return null;
  }

  private async fetchAllProblems() {
    const nanikiruProblems: NanikiruProblem[] = [];
    await this.doc.loadInfo();
    for (const sheet of Object.values(this.doc.sheetsByTitle)) {
      const rows = await sheet.getRows();
      rows.forEach((row) => {
        const problem: NanikiruProblem = {
          id: row.rowNumber,
          round: row.get("round"),
          seat: row.get("seat"),
          turn: row.get("turn"),
          dora: row.get("dora"),
          hand: row.get("hand"),
          answer: row.get("answer"),
          explanation: row.get("explanation"),
          explanationFr:
            row.get("explanationFr") || row.get("explanationfr") || undefined,
          ukeire: row.get("ukeire"),
          source: row.get("source"),
          context: row.get("context"),
          options: row.get("options"),
          hint: row.get("hint"),
        };
        nanikiruProblems.push(problem);
      });
    }
    return nanikiruProblems.filter(
      (p) =>
        p.hand !== undefined &&
        p.answer !== undefined &&
        isNanikiruProblemPublic(p.source)
    );
  }
}
