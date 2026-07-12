import { describe, expect, it } from "vitest";
import { RATE_LIMIT_POLICIES } from "./policies.js";

describe("RATE_LIMIT_POLICIES", () => {
  it("本番設計で確定したpolicyを一元管理する", () => {
    expect(RATE_LIMIT_POLICIES).toEqual({
      GENERAL_API_IP: {
        id: "GENERAL_API_IP",
        limit: 60,
        windowMs: 60_000,
        failureMode: "fail-open",
      },
      AUTH_IP: {
        id: "AUTH_IP",
        limit: 10,
        windowMs: 600_000,
        failureMode: "fail-closed",
      },
      AUTH_EMAIL: {
        id: "AUTH_EMAIL",
        limit: 10,
        windowMs: 600_000,
        failureMode: "fail-closed",
      },
      ACCOUNT_IP: {
        id: "ACCOUNT_IP",
        limit: 10,
        windowMs: 600_000,
        failureMode: "fail-closed",
      },
      ACCOUNT_USER: {
        id: "ACCOUNT_USER",
        limit: 10,
        windowMs: 600_000,
        failureMode: "fail-closed",
      },
      GAME_QUESTIONS_IP: {
        id: "GAME_QUESTIONS_IP",
        limit: 30,
        windowMs: 60_000,
        failureMode: "fail-open",
      },
      GAME_SUBMIT_IP: {
        id: "GAME_SUBMIT_IP",
        limit: 20,
        windowMs: 60_000,
        failureMode: "fail-closed",
      },
      GAME_SUBMIT_USER: {
        id: "GAME_SUBMIT_USER",
        limit: 20,
        windowMs: 60_000,
        failureMode: "fail-closed",
      },
    });
  });
});
