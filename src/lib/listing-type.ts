export type ListingType = 'House' | 'Villa' | 'Townhouse';
export type RoomsBucket = '1–2' | '3' | '4' | '5+';

export function deriveType(title: string): ListingType {
  if (/vil[ăa]/i.test(title)) return 'Villa';
  if (/townhouse/i.test(title)) return 'Townhouse';
  return 'House';
}

export function roomsBucket(rooms: number | null): RoomsBucket {
  if (rooms == null) return '1–2';
  if (rooms <= 2) return '1–2';
  if (rooms === 3) return '3';
  if (rooms === 4) return '4';
  return '5+';
}
