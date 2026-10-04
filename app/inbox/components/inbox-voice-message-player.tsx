"use client";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Pause, Play } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  VOICE_PLAYBACK_RATES,
  VOICE_WAVEFORM_BAR_COUNT,
  formatVoiceClock,
  nextVoicePlaybackRate,
  usableVoiceDuration,
  voicePlayedShare,
  voiceSeekTime,
  voiceWaveformBars,
} from "@/lib/inbox/voice-message-player";

/** Only one voice note plays at a time, like in a chat app: starting one stops the one that was playing. */
let voiceNoteNowPlaying: HTMLAudioElement | null = null;

const KEYBOARD_SEEK_SECONDS = 5;

/**
 * A voice note drawn like a chat app's: a round play button, a bar waveform that fills as it plays, the time, and a
 * playback-speed button. It replaces the browser's default audio control, which is a grey bar that looks out of place in a
 * chat. The browser still does the playing (a hidden audio element), and the bar can be clicked or driven with the
 * arrow keys to jump around.
 */
export function InboxVoiceMessagePlayer({
  src,
  waveformSeed,
  onSourceError,
  onStartedPlaying,
}: {
  src: string;
  /** Any stable text for this note (its attachment id), so the same note always draws the same bars. */
  waveformSeed: string;
  onSourceError?: () => void;
  onStartedPlaying?: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState<number | null>(null);
  const [rate, setRate] = useState<number>(VOICE_PLAYBACK_RATES[0]);
  const bars = voiceWaveformBars(waveformSeed);
  const playedShare = voicePlayedShare(currentTime, duration);
  const playedBars = Math.round(playedShare * VOICE_WAVEFORM_BAR_COUNT);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
      if (voiceNoteNowPlaying === audio) voiceNoteNowPlaying = null;
    };
  }, []);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      // A failed start is reported by the element's own error event; nothing more to do here.
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }

  function seekTo(share: number) {
    const audio = audioRef.current;
    const time = voiceSeekTime(share, duration);
    if (!audio || time === null) return;
    audio.currentTime = time;
    setCurrentTime(time);
  }

  function handleTrackPointer(event: PointerEvent<HTMLDivElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width <= 0) return;
    seekTo((event.clientX - box.left) / box.width);
  }

  function handleTrackKey(event: KeyboardEvent<HTMLDivElement>) {
    if (duration === null) return;
    const step = KEYBOARD_SEEK_SECONDS / duration;
    if (event.key === "ArrowRight") seekTo(playedShare + step);
    else if (event.key === "ArrowLeft") seekTo(playedShare - step);
    else if (event.key === "Home") seekTo(0);
    else if (event.key === "End") seekTo(1);
    else return;
    event.preventDefault();
  }

  function changeRate() {
    const next = nextVoicePlaybackRate(rate);
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  // Elapsed time while it plays or is part-way, the total length otherwise (or 0:00 when the length is not known yet).
  const clock =
    playing || currentTime > 0
      ? formatVoiceClock(currentTime)
      : formatVoiceClock(duration ?? 0);

  return (
    <div className="flex w-60 max-w-full items-center gap-3 px-3 py-2">
      <audio
        ref={audioRef}
        preload="metadata"
        src={src}
        className="hidden"
        onLoadedMetadata={(event) =>
          setDuration(usableVoiceDuration(event.currentTarget.duration))
        }
        onDurationChange={(event) =>
          setDuration(usableVoiceDuration(event.currentTarget.duration))
        }
        onTimeUpdate={(event) =>
          setCurrentTime(event.currentTarget.currentTime)
        }
        onPlay={(event) => {
          const audio = event.currentTarget;
          if (voiceNoteNowPlaying && voiceNoteNowPlaying !== audio)
            voiceNoteNowPlaying.pause();
          voiceNoteNowPlaying = audio;
          audio.playbackRate = rate;
          setPlaying(true);
          onStartedPlaying?.();
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
        onError={() => {
          setPlaying(false);
          onSourceError?.();
        }}
      />
      <button
        type="button"
        onClick={togglePlayback}
        aria-label={playing ? "Pause voice message" : "Play voice message"}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline_without_border-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:bg-primary/80"
      >
        {playing ? (
          <Pause className="size-4 fill-current" aria-hidden="true" />
        ) : (
          <Play
            className="size-4 translate-x-px fill-current"
            aria-hidden="true"
          />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <div
          role="slider"
          tabIndex={duration === null ? -1 : 0}
          aria-label="Voice message position"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration ?? 0)}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={
            duration === null
              ? formatVoiceClock(currentTime)
              : `${formatVoiceClock(currentTime)} of ${formatVoiceClock(duration)}`
          }
          aria-disabled={duration === null}
          onPointerDown={handleTrackPointer}
          onKeyDown={handleTrackKey}
          className={cn(
            "flex h-7 touch-none items-center gap-0.5 rounded-sm focus-visible:outline_without_border-none focus-visible:ring-2 focus-visible:ring-ring",
            duration === null ? "cursor-default" : "cursor-pointer",
          )}
        >
          {bars.map((share, index) => (
            <span
              key={index}
              aria-hidden="true"
              style={{ height: `${Math.round(share * 100)}%` }}
              className={cn(
                "w-0.5 flex-1 rounded-full transition-colors duration-150 motion-reduce:transition-none",
                index < playedBars ? "bg-primary" : "bg-muted-foreground/40",
              )}
            />
          ))}
        </div>
        <div className="mt-0.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="tabular-nums">{clock}</span>
          <button
            type="button"
            onClick={changeRate}
            aria-label={`Playback speed ${rate} times. Press to change.`}
            className="rounded-full px-1.5 font-medium tabular-nums hover:bg-muted hover:text-foreground focus-visible:outline_without_border-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {rate}×
          </button>
        </div>
      </div>
    </div>
  );
}
