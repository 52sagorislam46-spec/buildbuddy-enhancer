/**
 * Ensures only one <video> plays at a time across the whole app.
 * When any video starts playing, every other playing video is paused.
 */
export function initSingleVideoPlayback(): () => void {
  if (typeof document === "undefined") return () => {};

  // Live call videos (MediaStream sources) must never be paused: the local
  // preview and the remote feed have to play at the same time.
  const isLive = (v: HTMLVideoElement) =>
    !!v.srcObject || v.dataset["keepPlaying"] === "true";

  const onPlay = (event: Event) => {
    const target = event.target as HTMLElement | null;
    if (!target || target.tagName !== "VIDEO") return;
    const playing = target as HTMLVideoElement;
    if (isLive(playing)) return;
    document.querySelectorAll("video").forEach((other) => {
      if (other !== playing && !other.paused && !isLive(other as HTMLVideoElement)) {
        other.pause();
      }
    });
  };


  document.addEventListener("play", onPlay, true);
  return () => document.removeEventListener("play", onPlay, true);
}
