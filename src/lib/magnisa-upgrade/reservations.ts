export interface ReservationWindow {
  startsAt: Date;
  endsAt: Date;
}

export function windowsOverlap(a: ReservationWindow, b: ReservationWindow): boolean {
  if (a.endsAt <= a.startsAt || b.endsAt <= b.startsAt) {
    throw new Error("Reservation windows must have positive duration");
  }
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}
