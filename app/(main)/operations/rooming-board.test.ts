import { describe, expect, it } from "vitest";

import type { CrossGroupRoomRow } from "@/lib/data/hotels-repository";

import {
  clusterRoomsByHotelStay,
  filterRoomingClusters,
  summariseRoomingBoard,
} from "./rooming-board";

function room(overrides: Partial<CrossGroupRoomRow> = {}): CrossGroupRoomRow {
  return {
    id: "room-1",
    accommodationId: "stay-1",
    departureGroupId: "group-1",
    hotelName: "Swissotel Makkah",
    city: "MAKKAH",
    checkInDate: "2026-10-01",
    checkOutDate: "2026-10-06",
    roomNumber: "101",
    roomType: "QUAD",
    occupancyCapacity: 4,
    assignedPilgrimCount: 2,
    status: "PARTIAL",
    notes: null,
    groupName: "Ramadan Umrah",
    groupCode: "RU-01",
    ...overrides,
  };
}

describe("clusterRoomsByHotelStay", () => {
  it("puts rooms of different groups at the same hotel and dates in one cluster", () => {
    const clusters = clusterRoomsByHotelStay([
      room({ id: "a", departureGroupId: "group-1" }),
      room({ id: "b", departureGroupId: "group-2" }),
    ]);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].rooms.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("splits clusters by hotel, city and dates, ordered by hotel then check-in", () => {
    const clusters = clusterRoomsByHotelStay([
      room({ id: "late", checkInDate: "2026-10-10", checkOutDate: "2026-10-12" }),
      room({ id: "other-hotel", hotelName: "Anwar Madinah", city: "MADINAH" }),
      room({ id: "early" }),
    ]);
    expect(clusters.map((c) => c.rooms[0].id)).toEqual(["other-hotel", "early", "late"]);
  });
});

describe("filterRoomingClusters", () => {
  const clusters = clusterRoomsByHotelStay([
    room({ id: "partial-g1", departureGroupId: "group-1", status: "PARTIAL" }),
    room({ id: "full-g2", departureGroupId: "group-2", status: "COMPLETE" }),
    room({ id: "solo-partial", hotelName: "Anwar Madinah", city: "MADINAH", status: "PARTIAL" }),
    room({ id: "solo-full", hotelName: "Dar Al Iman", city: "MADINAH", status: "COMPLETE" }),
  ]);

  it("keeps only partial rooms by default and drops clusters left empty", () => {
    const result = filterRoomingClusters(clusters, { search: "", mode: "PARTIAL" });
    expect(result.map((c) => c.rooms.map((r) => r.id))).toEqual([["solo-partial"], ["partial-g1"]]);
  });

  it("keeps only hotel stays shared by two or more groups", () => {
    const result = filterRoomingClusters(clusters, { search: "", mode: "MULTI_GROUP" });
    expect(result).toHaveLength(1);
    expect(result[0].groupCount).toBe(2);
    expect(result[0].rooms).toHaveLength(2);
  });

  it("shows every room in ALL mode and searches hotel names without regard to case", () => {
    expect(filterRoomingClusters(clusters, { search: "", mode: "ALL" })).toHaveLength(3);
    const result = filterRoomingClusters(clusters, { search: "ANWAR", mode: "ALL" });
    expect(result.map((c) => c.hotelName)).toEqual(["Anwar Madinah"]);
  });
});

describe("summariseRoomingBoard", () => {
  it("counts rooms, partial rooms, occupancy percentage and clusters", () => {
    const rooms = [
      room({ id: "a", occupancyCapacity: 4, assignedPilgrimCount: 2 }),
      room({ id: "b", occupancyCapacity: 4, assignedPilgrimCount: 4, status: "COMPLETE" }),
    ];
    expect(summariseRoomingBoard(rooms)).toEqual({
      rooms: 2,
      partialRooms: 1,
      occupancyPercent: 75,
      clusters: 1,
    });
  });

  it("reports 0% occupancy when there is no capacity", () => {
    expect(summariseRoomingBoard([]).occupancyPercent).toBe(0);
  });
});
