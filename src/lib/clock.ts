// 現在時刻の取得。テストでは fixedClock に差し替える（憲章の原則 IV）。

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** 常に同じ時刻を返す時計。advance() で進められる */
export function fixedClock(
  instant: Date | string,
): Clock & { advance(ms: number): void; set(instant: Date | string): void } {
  let current = new Date(instant);
  return {
    now: () => new Date(current.getTime()),
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
    set(next: Date | string) {
      current = new Date(next);
    },
  };
}
