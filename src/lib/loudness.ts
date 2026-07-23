export type Analysis = {
  integratedLufs: number;
  loudnessRange: number;
  truePeakDbtp: number;
  durationSeconds: number;
  sampleRate: number;
  channels: number;
};

export type Recording = Analysis & { name: string; path: string };

export type StreamingService = {
  service: string;
  target: number;
  note: string;
  color: string;
  canBoost: boolean;
};

export const audioExtensions = ["wav", "aiff", "mp3", "m4a", "aac", "flac", "ogg"];

export const streamingServices: StreamingService[] = [
  { service: "Spotify", target: -14, note: "Normal", color: "#8de36a", canBoost: true },
  { service: "Apple Music", target: -16, note: "Sound Check", color: "#ff9d85", canBoost: true },
  { service: "YouTube", target: -14, note: "Music", color: "#fa6b7e", canBoost: false },
  { service: "TIDAL", target: -14, note: "Normal", color: "#c4b5fd", canBoost: false },
  { service: "Amazon Music", target: -14, note: "Normalization", color: "#65c8ff", canBoost: false },
  { service: "Deezer", target: -15, note: "Normalization", color: "#f6ba65", canBoost: true },
];

export function gainAdjustment(target: number, canBoost: boolean, loudness: number | null) {
  if (loudness === null) return 0;
  const adjustment = target - loudness;
  return canBoost ? adjustment : Math.min(0, adjustment);
}

export function formatDb(value: number | null, suffix = "") {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}${suffix}`;
}

export function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

export function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
}
