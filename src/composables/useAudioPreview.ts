import { convertFileSrc } from "@tauri-apps/api/tauri";
import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from "vue";
import { formatDuration, type PreviewTrack } from "../lib/loudness";

type AudioPreviewOptions = {
  selectedFile: Readonly<Ref<PreviewTrack>>;
  duration: Readonly<Ref<number>>;
  gain: Readonly<Ref<number>>;
  onError: (message: string) => void;
};

export function useAudioPreview(options: AudioPreviewOptions) {
  const playerA = ref<HTMLAudioElement>();
  const playerB = ref<HTMLAudioElement>();
  const isPreviewing = ref(false);
  const previewTime = ref(0);
  const waveform = ref<number[]>([]);
  const waveformLoading = ref(false);
  const playbackPositions = new Map<string, number>();
  let audioContext: AudioContext | undefined;
  let gainNodes: GainNode[] = [];
  let activeDeck = 0;

  const durationText = computed(() => formatDuration(options.duration.value));
  const previewTimeText = computed(() => formatDuration(previewTime.value));
  const waveBars = computed(() =>
    waveform.value.length
      ? waveform.value
      : Array.from({ length: 80 }, (_, index) => 18 + ((index * 19) % 55)),
  );
  const players = () =>
    [playerA.value, playerB.value].filter((player): player is HTMLAudioElement => Boolean(player));
  const currentPlayer = () => [playerA.value, playerB.value][activeDeck];

  function setPlayerA(element: unknown) {
    playerA.value = element instanceof HTMLAudioElement ? element : undefined;
  }

  function setPlayerB(element: unknown) {
    playerB.value = element instanceof HTMLAudioElement ? element : undefined;
  }

  function applyGain(gain: number) {
    const value = Math.pow(10, gain / 20);
    if (gainNodes.length && audioContext) {
      gainNodes[activeDeck]?.gain.setValueAtTime(value, audioContext.currentTime);
    } else {
      const player = currentPlayer();
      if (player) player.volume = Math.min(1, value);
    }
  }

  function setupGain() {
    if (gainNodes.length) {
      applyGain(options.gain.value);
      return;
    }
    const decks = players();
    if (decks.length !== 2) return;
    audioContext = new AudioContext();
    gainNodes = decks.map((deck) => {
      const gain = audioContext!.createGain();
      audioContext!.createMediaElementSource(deck).connect(gain).connect(audioContext!.destination);
      return gain;
    });
    applyGain(options.gain.value);
  }

  function savedPosition(recording: PreviewTrack) {
    const position = playbackPositions.get(recording.path) ?? 0;
    return position >= (recording.durationSeconds ?? options.duration.value) - 0.05 ? 0 : position;
  }

  function savePlaybackPosition() {
    const player = currentPlayer();
    if (player?.dataset.path && Number.isFinite(player.currentTime)) {
      playbackPositions.set(player.dataset.path, player.currentTime);
    }
  }

  function loadDeck(player: HTMLAudioElement, recording: PreviewTrack, position: number) {
    return new Promise<void>((resolve) => {
      const ready = () => {
        player.currentTime = Math.min(position, Math.max(0, player.duration || position));
        resolve();
      };
      player.dataset.path = recording.path;
      player.src = convertFileSrc(recording.path);
      player.addEventListener("loadedmetadata", ready, { once: true });
      player.load();
    });
  }

  async function switchPreview(recording: PreviewTrack, crossfade: boolean) {
    await nextTick();
    setupGain();
    const outgoing = currentPlayer();
    const nextDeck = activeDeck === 0 ? 1 : 0;
    const incoming = [playerA.value, playerB.value][nextDeck];
    if (!incoming) return;
    const resumeAt = savedPosition(recording);
    await loadDeck(incoming, recording, resumeAt);
    activeDeck = nextDeck;
    previewTime.value = resumeAt;
    if (!crossfade || !outgoing || !audioContext || !gainNodes.length) {
      if (gainNodes[nextDeck] && audioContext) {
        gainNodes[nextDeck].gain.setValueAtTime(
          Math.pow(10, options.gain.value / 20),
          audioContext.currentTime,
        );
      }
      return;
    }
    const now = audioContext.currentTime;
    const outgoingDeck = activeDeck === 0 ? 1 : 0;
    const targetGain = Math.pow(10, options.gain.value / 20);
    gainNodes[nextDeck].gain.setValueAtTime(0.0001, now);
    await audioContext.resume();
    await incoming.play();
    gainNodes[nextDeck].gain.exponentialRampToValueAtTime(targetGain, now + 0.18);
    gainNodes[outgoingDeck].gain.cancelScheduledValues(now);
    gainNodes[outgoingDeck].gain.setValueAtTime(gainNodes[outgoingDeck].gain.value, now);
    gainNodes[outgoingDeck].gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    window.setTimeout(() => outgoing.pause(), 190);
  }

  async function toggle() {
    const player = currentPlayer();
    if (isPreviewing.value && player) {
      player.pause();
      return;
    }
    setupGain();
    if (player?.dataset.path !== options.selectedFile.value.path) {
      await switchPreview(options.selectedFile.value, false);
    }
    await audioContext?.resume();
    currentPlayer()
      ?.play()
      .catch(() => options.onError("Playback could not start for this file."));
  }

  function seek(event: MouseEvent) {
    const player = currentPlayer();
    if (!player || !options.duration.value) return;
    const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const position = ratio * options.duration.value;
    player.currentTime = position;
    previewTime.value = position;
    playbackPositions.set(options.selectedFile.value.path, position);
  }

  function onPlay(deck: number) {
    if (deck === activeDeck) isPreviewing.value = true;
  }

  function onPause(deck: number) {
    if (deck === activeDeck) isPreviewing.value = false;
  }

  function onTimeUpdate(deck: number) {
    if (deck !== activeDeck) return;
    const player = currentPlayer();
    if (!player) return;
    previewTime.value = player.currentTime;
    playbackPositions.set(options.selectedFile.value.path, player.currentTime);
  }

  function onEnd(deck: number) {
    if (deck !== activeDeck) return;
    isPreviewing.value = false;
    playbackPositions.set(options.selectedFile.value.path, options.duration.value);
  }

  async function buildWaveform(recording: PreviewTrack) {
    waveformLoading.value = true;
    waveform.value = [];
    try {
      const context = audioContext ?? new AudioContext();
      const data = await fetch(convertFileSrc(recording.path)).then((response) =>
        response.arrayBuffer(),
      );
      const decoded = await context.decodeAudioData(data);
      const bars = 88;
      const block = Math.max(1, Math.floor(decoded.length / bars));
      const values = Array.from({ length: bars }, (_, bar) => {
        let peakValue = 0;
        for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
          const samples = decoded.getChannelData(channel);
          for (
            let index = bar * block;
            index < Math.min(samples.length, (bar + 1) * block);
            index += 1
          ) {
            peakValue = Math.max(peakValue, Math.abs(samples[index]));
          }
        }
        return peakValue;
      });
      const maximum = Math.max(...values, 0.0001);
      if (options.selectedFile.value.path === recording.path) {
        waveform.value = values.map((value) =>
          Math.max(8, Math.round(100 * Math.sqrt(value / maximum))),
        );
      }
      if (!audioContext) await context.close();
    } catch {
      if (options.selectedFile.value.path === recording.path) waveform.value = [];
    } finally {
      if (options.selectedFile.value.path === recording.path) waveformLoading.value = false;
    }
  }

  watch(options.gain, applyGain);
  watch(
    () => options.selectedFile.value.path,
    async () => {
      const shouldKeepPlaying = isPreviewing.value;
      savePlaybackPosition();
      previewTime.value = savedPosition(options.selectedFile.value);
      void buildWaveform(options.selectedFile.value);
      if (shouldKeepPlaying) await switchPreview(options.selectedFile.value, true);
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    players().forEach((player) => player.pause());
    audioContext?.close();
  });

  return {
    playerA,
    playerB,
    setPlayerA,
    setPlayerB,
    isPreviewing,
    previewTime,
    waveformLoading,
    waveBars,
    durationText,
    previewTimeText,
    toggle,
    seek,
    onPlay,
    onPause,
    onTimeUpdate,
    onEnd,
  };
}
