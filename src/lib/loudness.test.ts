import { describe, expect, it } from "vitest";
import { fileName, formatDb, formatDuration, gainAdjustment } from "./loudness";

describe("gainAdjustment", () => {
  it("matches the target when a service can boost quiet audio", () => {
    expect(gainAdjustment(-14, true, -18)).toBe(4);
  });

  it("does not boost quiet audio when a service only turns audio down", () => {
    expect(gainAdjustment(-14, false, -18)).toBe(0);
  });

  it("returns no adjustment before analysis completes", () => {
    expect(gainAdjustment(-14, true, null)).toBe(0);
  });
});

describe("formatters", () => {
  it("formats decibels and missing measurements", () => {
    expect(formatDb(1.25, " dB")).toBe("+1.3 dB");
    expect(formatDb(null, " dB")).toBe("—");
  });

  it("formats duration and cross-platform file names", () => {
    expect(formatDuration(125.4)).toBe("2:05");
    expect(fileName("C:\\Music\\master.wav")).toBe("master.wav");
    expect(fileName("/music/master.wav")).toBe("master.wav");
  });
});
