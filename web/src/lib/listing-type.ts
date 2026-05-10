export type ListingType = 'House' | 'Villa' | 'Townhouse';
export type RoomsBucket = '1–2' | '3' | '4' | '5+';

export function roomsBucket(rooms: number | null): RoomsBucket {
  if (rooms == null) return '1–2';
  if (rooms <= 2) return '1–2';
  if (rooms === 3) return '3';
  if (rooms === 4) return '4';
  return '5+';
}

export function bucketToRoomsValues(bucket: RoomsBucket): number[] {
  if (bucket === '1–2') return [1, 2];
  if (bucket === '3') return [3];
  if (bucket === '4') return [4];
  return [5, 6, 7, 8, 9, 10];
}
