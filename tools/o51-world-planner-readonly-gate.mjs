// O51: explicit deny-before-auth for the dual-use initial spawn planner.
// Newbieland's existing spawn:auto path is left unchanged.
export const WORLD_PLANNER_PLACE_HOLD =
  'O51_WORLD_PLANNER_PLACEMENT_HOLD_NO_APPROVED_EXECUTOR';

export function assertWorldPlannerReadOnly(args) {
  if (!args || typeof args!=='object' || Array.isArray(args))
    throw new Error(WORLD_PLANNER_PLACE_HOLD);
  if (args.server==='world' && args.place===true)
    throw new Error(WORLD_PLANNER_PLACE_HOLD);
}
export function assertWorldScoutRoomArguments(roomNames) {
  if (!Array.isArray(roomNames)||roomNames.length<1||roomNames.length>96||
      !roomNames.every(room=>typeof room==='string' &&
        /^[WE](?:0|[1-9][0-9]{0,3})[NS](?:0|[1-9][0-9]{0,3})$/.test(room)))
    throw new Error('O51_WORLD_SCOUT_ROOM_ARG_HOLD');
  return roomNames;
}
