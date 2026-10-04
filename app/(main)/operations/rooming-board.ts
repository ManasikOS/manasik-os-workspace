import type { AccommodationCity, CrossGroupRoomRow } from "@/lib/data/hotels-repository";

/**
 * Cross-group rooming board rules: rooms of different groups that share a
 * hotel, city and dates are clustered so a PARTIAL room in one group sits
 * next to a PARTIAL room in another — the consolidation opportunity. Pure so
 * the clustering and filters can be tested without a database.
 */

export interface RoomingCluster {
  key: string;
  hotelName: string;
  city: AccommodationCity;
  checkInDate: string;
  checkOutDate: string;
  rooms: CrossGroupRoomRow[];
}

export interface RoomingClusterWithGroupCount extends RoomingCluster {
  groupCount: number;
}

export type RoomingBoardMode = "PARTIAL" | "MULTI_GROUP" | "ALL";

export interface RoomingBoardFilters {
  search: string;
  mode: RoomingBoardMode;
}

export function clusterRoomsByHotelStay(rooms: CrossGroupRoomRow[]): RoomingCluster[] {
  const byKey = new Map<string, RoomingCluster>();
  for (const room of rooms) {
    const key = `${room.hotelName}__${room.city}__${room.checkInDate}__${room.checkOutDate}`;
    const cluster = byKey.get(key);
    if (cluster) {
      cluster.rooms.push(room);
    } else {
      byKey.set(key, {
        key,
        hotelName: room.hotelName,
        city: room.city,
        checkInDate: room.checkInDate,
        checkOutDate: room.checkOutDate,
        rooms: [room],
      });
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.hotelName.localeCompare(b.hotelName) || a.checkInDate.localeCompare(b.checkInDate),
  );
}

export function filterRoomingClusters(
  clusters: RoomingCluster[],
  { search, mode }: RoomingBoardFilters,
): RoomingClusterWithGroupCount[] {
  const needle = search.trim().toLowerCase();
  const kept: RoomingClusterWithGroupCount[] = [];
  for (const cluster of clusters) {
    const groupCount = new Set(cluster.rooms.map((room) => room.departureGroupId)).size;
    if (mode === "MULTI_GROUP" && groupCount < 2) continue;
    if (needle && !cluster.hotelName.toLowerCase().includes(needle)) continue;
    const rooms =
      mode === "PARTIAL" ? cluster.rooms.filter((room) => room.status === "PARTIAL") : cluster.rooms;
    if (rooms.length === 0) continue;
    kept.push({ ...cluster, rooms, groupCount });
  }
  return kept;
}

export function summariseRoomingBoard(rooms: CrossGroupRoomRow[]) {
  const capacity = rooms.reduce((sum, room) => sum + room.occupancyCapacity, 0);
  const assigned = rooms.reduce((sum, room) => sum + room.assignedPilgrimCount, 0);
  return {
    rooms: rooms.length,
    partialRooms: rooms.filter((room) => room.status === "PARTIAL").length,
    occupancyPercent: capacity > 0 ? Math.round((assigned / capacity) * 100) : 0,
    clusters: clusterRoomsByHotelStay(rooms).length,
  };
}
