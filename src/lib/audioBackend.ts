import { open } from "@tauri-apps/api/dialog";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/tauri";
import { appWindow } from "@tauri-apps/api/window";
import { audioExtensions, type Analysis } from "./loudness";

export async function chooseAudioFiles(): Promise<string[]> {
  const paths = await open({
    multiple: true,
    filters: [{ name: "Audio", extensions: audioExtensions }],
  });
  if (typeof paths === "string") return [paths];
  return Array.isArray(paths) ? paths : [];
}

export async function analyzeAudio(path: string, onProgress: (percentage: number) => void) {
  const unlisten = await listen<number>("analysis-progress", ({ payload }) => onProgress(payload));
  try {
    return await invoke<Analysis>("analyze_audio", { path });
  } finally {
    unlisten();
  }
}

export function listenToAudioFileDrops(
  onDrop: (paths: string[]) => void,
  onDraggingChange: (isDragging: boolean) => void,
) {
  return appWindow.onFileDropEvent(({ payload }) => {
    if (payload.type === "hover") onDraggingChange(true);
    if (payload.type === "cancel") onDraggingChange(false);
    if (payload.type === "drop") {
      onDraggingChange(false);
      onDrop(payload.paths);
    }
  });
}
