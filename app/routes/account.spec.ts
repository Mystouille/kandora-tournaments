import { describe, expect, it } from "vitest";
import { loader } from "./account";

describe("account route loader", () => {
  it("preserves a safe first-time setup destination", () => {
    const request = new Request(
      "http://app.test/account?setup=true&returnTo=%2Fsign-in%3FreturnTo%3D%252Fgame%252Froom-1"
    );

    expect(loader({ request })).toEqual({
      setupReturnTo: "/sign-in?returnTo=%2Fgame%2Froom-1",
    });
  });

  it("rejects an external first-time setup destination", () => {
    const request = new Request(
      "http://app.test/account?setup=true&returnTo=https%3A%2F%2Fevil.test"
    );

    expect(loader({ request })).toEqual({ setupReturnTo: "/" });
  });
});