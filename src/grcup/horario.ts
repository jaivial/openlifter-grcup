// vim: set ts=2 sts=2 sw=2 et:
//
// GR Cup fork: the published schedule of the meet, live. Opening a meet already brings the day, platform, flight and
// lot that the published schedule gives to each linked entry; this keeps a meet that is already open in step: every
// few seconds it asks the platform for the schedule of the meet and, when a new version is published, moves each
// entry to its session (an OpenLifter session is the day + platform + flight of its entries). The desk's own sync
// then sends the moved entries back, so the platform and the desk end up agreeing.

import { api } from "./api";
import { updateRegistration } from "../actions/registrationActions";
import { Entry, Flight } from "../types/dataTypes";
import { GlobalState } from "../types/stateTypes";

type Store = { getState: () => GlobalState; dispatch: (a: any) => any };

export type AsignacionHorario = {
  entryId: number;
  day: number;
  platform: number;
  flight: string;
  lot: number;
};

export type HorarioMesa = {
  publicado: boolean;
  version: number;
  asignaciones: Array<AsignacionHorario>;
  aviso?: string;
};

// Published version already applied on this browser, per competition and meet (localStorage survives a reload).
const LS = "grcup:horario:v1";

function leer(): { [clave: string]: number } {
  try {
    return JSON.parse(localStorage.getItem(LS) || "{}") || {};
  } catch (e) {
    return {};
  }
}

const aplicadas = leer();

const clave = (cid: string, mesa: string) => `${cid}|${mesa}`;

export const versionAplicada = (cid: string, mesa: string) => aplicadas[clave(cid, mesa)] || 0;

export function marcarAplicada(cid: string, mesa: string, version: number) {
  aplicadas[clave(cid, mesa)] = version;
  try {
    localStorage.setItem(LS, JSON.stringify(aplicadas));
  } catch (e) {
    // localStorage lleno o deshabilitado: se vuelve a aplicar en el siguiente arranque (no hace daño)
  }
}

// aplicarHorario moves the entries of the meet to the sessions of the published schedule, once per version.
export async function aplicarHorario(store: Store, cid: string, mesa: string) {
  if (!cid || !mesa) return;
  let r: HorarioMesa;
  try {
    r = await api<HorarioMesa>("GET", `/api/admin/competiciones/${cid}/openlifter/horario?mesa=${encodeURIComponent(mesa)}`);
  } catch (e) {
    return; // sin red o sin permiso: se reintenta en la siguiente vuelta
  }
  if (!r || !r.publicado || !r.version || r.version <= versionAplicada(cid, mesa)) return;
  const entries = (store.getState() as GlobalState).registration.entries;
  for (const a of r.asignaciones || []) {
    const e = entries.find((x) => x.id === a.entryId);
    if (!e) continue;
    const cambios: Partial<Entry> = {};
    if (e.day !== a.day) cambios.day = a.day;
    if (e.platform !== a.platform) cambios.platform = a.platform;
    if (e.flight !== (a.flight as Flight)) cambios.flight = a.flight as Flight;
    if (e.lot !== a.lot) cambios.lot = a.lot;
    if (Object.keys(cambios).length > 0) store.dispatch(updateRegistration(e.id, cambios));
  }
  marcarAplicada(cid, mesa, r.version);
}
