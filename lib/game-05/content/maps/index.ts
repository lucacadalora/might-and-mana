import type { MapDef, MapId } from "../../contract";
import { HOME } from "./home";
import { LARKMOOR } from "./larkmoor";
import { INN } from "./inn";
import { SHOP } from "./shop";
import { SMITHY } from "./smithy";
import { TAVERN } from "./tavern";
import { HALL } from "./hall";
import { SOUTHFOLD } from "./southfold";
import { MOSSGLOAM } from "./mossgloam";
import { BARROW1 } from "./barrow1";
import { BARROW2 } from "./barrow2";

export const MAPS: Record<MapId, MapDef> = {
  home: HOME, larkmoor: LARKMOOR, inn: INN, shop: SHOP, smithy: SMITHY, tavern: TAVERN, hall: HALL, southfold: SOUTHFOLD, mossgloam: MOSSGLOAM, barrow1: BARROW1, barrow2: BARROW2,
};
