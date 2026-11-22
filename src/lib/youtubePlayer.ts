/**
 * YouTube player for MoodTide, built on the official YouTube IFrame Player API.
 *
 * Put this file in:  src/lib/youtubePlayer.ts
 *
 * It creates one small video box (bottom-right, above the player bar) and plays the
 * song's YouTube video in it. Playing a new song replaces the old one, so two songs
 * can never play at the same time.
 *
 * YouTube's rules ask that the player stays visible. The "Video" button in the player
 * bar can hide it while you work, but keep it visible for your final demo.
 */
declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

type Handlers = {
  onState?: (state: number) => void; // 1 = playing, 2 = paused, 0 = ended
  onEnded?: () => void;
  onError?: (code: number) => void;  // 101 / 150 = owner blocks embedding, 100 = video removed
};

const BOX_W = 356;
const BOX_H = 200;
const BOX_BOTTOM = 96; // px, sits above the player bar

class YouTubePlayer {
  private player: any = null;
  private ready: Promise<void> | null = null;
  private volume = 0.65;
  private visible = true;
  private box: HTMLDivElement | null = null;
  private handlers: Handlers = {};

  public setHandlers(h: Handlers) {
    this.handlers = h;
  }

  private loadApi(): Promise<void> {
    if (window.YT && window.YT.Player) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        resolve();
      };
      if (!document.getElementById('moodtide-yt-api')) {
        const s = document.createElement('script');
        s.id = 'moodtide-yt-api';
        s.src = 'https://www.youtube.com/iframe_api';
        s.onerror = () => reject(new Error('Could not load the YouTube player script'));
        document.head.appendChild(s);
      }
    });
  }

  private async init(): Promise<void> {
    await this.loadApi();

    const box = document.createElement('div');
    box.style.cssText =
      `position:fixed;right:16px;width:${BOX_W}px;height:${BOX_H}px;z-index:30;` +
      'border-radius:12px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,.5);background:#000;transition:bottom .2s';
    box.style.bottom = this.visible ? `${BOX_BOTTOM}px` : '-400px';
    const host = document.createElement('div');
    box.appendChild(host);
    document.body.appendChild(box);
    this.box = box;

    await new Promise<void>((resolve) => {
      this.player = new window.YT.Player(host, {
        width: String(BOX_W),
        height: String(BOX_H),
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
        events: {
          onReady: () => {
            this.player.setVolume(Math.round(this.volume * 100));
            resolve();
          },
          onStateChange: (e: { data: number }) => {
            this.handlers.onState?.(e.data);
            if (e.data === 0) this.handlers.onEnded?.();
          },
          onError: (e: { data: number }) => this.handlers.onError?.(e.data),
        },
      });
    });
  }

  private ensure(): Promise<void> {
    if (!this.ready) {
      this.ready = this.init().catch((e) => {
        this.ready = null; // allow a retry on the next play
        throw e;
      });
    }
    return this.ready;
  }

  public async play(videoId: string) {
    await this.ensure();
    this.player.loadVideoById(videoId);
    this.player.setVolume(Math.round(this.volume * 100));
  }

  public pause() { this.player?.pauseVideo?.(); }
  public resume() { this.player?.playVideo?.(); }
  public stop() { this.player?.stopVideo?.(); }
  public seek(sec: number) { this.player?.seekTo?.(sec, true); }

  public getTime(): number {
    return Number(this.player?.getCurrentTime?.() ?? 0) || 0;
  }

  public setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    this.player?.setVolume?.(Math.round(this.volume * 100));
  }

  public setVisible(v: boolean) {
    this.visible = v;
    if (this.box) this.box.style.bottom = v ? `${BOX_BOTTOM}px` : '-400px';
  }

  public isVisible() { return this.visible; }
}

export const ytPlayer = new YouTubePlayer();