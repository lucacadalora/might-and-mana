/**
 * Game 05 content barrel: every data table in one import.
 *   import { MAPS, PROPS, MONSTERS, QUESTS, DIALOG } from "@/lib/game-05/content";
 * Maps belong to the map lane (./maps), the prop catalog to the owner (./props); everything
 * else here is the content lane's. Validate with: node --import tsx tests/game-05/content-check.mjs
 */
export { MAPS } from "./maps";
export { PROPS, SOLID_GROUND, SLOW_GROUND, type PropDef } from "./props";
export * from "./levels";
export * from "./items";
export * from "./spells";
export * from "./skills";
export * from "./monsters";
export * from "./quests";
export * from "./shops";
export * from "./dialog";
export * from "./npcs";
