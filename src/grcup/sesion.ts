// vim: set ts=2 sts=2 sw=2 et:
//
// GR Cup fork: the session of the desk. The app is behind a login gate (components/LoginGate.tsx): nothing of
// OpenLifter is shown until a GR Cup account signs in or the saved session (30-day refresh cookie) is renewed.
// Right after signing in, the desk opens the predetermined meet of its competition by itself.

import { competiciones, login, logout, onSesionCaducada, renovar, Competicion, Usuario } from "./api";
import { descargarMeet, estadoDe, listarMeets, MeetCompleto, MeetResumen } from "./preparadas";
import {
  abrirMesa,
  conectar,
  estadoMeet,
  getGrcup,
  hayCambiosSinEnviar,
  pausar,
  reanudarEnvio,
  setGrcup,
  setUsuario,
} from "./sync";

export const textoApertura = (nombre: string, r: MeetCompleto) => ({
  texto:
    `«${nombre}» abierta: ${r.entradas.length} atletas, sincronizando con GR Cup.` +
    (r.horario.asignadas > 0
      ? ` Día, plataforma, flight y lote de ${r.horario.asignadas} atletas según el horario publicado (v${r.horario.version}).`
      : ""),
  aviso: r.horario.aviso || "",
});

// abrirPredeterminada loads the meet into this browser. The same meet with changes GR Cup has not received yet is
// kept and resumed (they are sent now); another meet with such changes is replaced only if the desk says so.
async function abrirPredeterminada(c: Competicion, m: MeetResumen): Promise<void> {
  const s = estadoMeet();
  if (!s) return;
  const mismo = s.meet.name === m.nombre && s.meet.date === m.fecha;
  const vacio = s.registration.entries.length === 0 && s.meet.name === "";
  if (mismo && hayCambiosSinEnviar()) {
    conectar(c, m.mesa);
    setGrcup({
      apertura: {
        texto: `«${m.nombre}» retomada: se envían a GR Cup los cambios de este navegador que faltaban.`,
        aviso: "",
      },
    });
    return;
  }
  if (
    !mismo &&
    !vacio &&
    hayCambiosSinEnviar() &&
    !window.confirm(
      `Este navegador tiene cambios de «${s.meet.name || "la competición abierta"}» que aún no han llegado a GR Cup. ` +
        `Si abres «${m.nombre}» se perderán. ¿Abrir «${m.nombre}» igualmente?`,
    )
  )
    return;
  const r = await descargarMeet(c.id, m.mesa);
  abrirMesa(c, r.mesa, estadoDe(r, s.language));
  setGrcup({ apertura: textoApertura(m.nombre, r) });
}

// autoabrir finds the predetermined meet (the desk's competition first) and opens it.
async function autoabrir(): Promise<void> {
  const actual = getGrcup().competicion;
  const cs = await competiciones();
  const orden = actual ? [...cs.filter((c) => c.id === actual.id), ...cs.filter((c) => c.id !== actual.id)] : cs;
  for (const c of orden) {
    const m = (await listarMeets(c.id)).find((x) => x.predeterminada);
    if (m) {
      setGrcup({ abriendo: m.nombre });
      await abrirPredeterminada(c, m);
      return;
    }
  }
}

// entrar: a signed-in user (login or renewed session). The sync waits until the meet is open.
export async function entrar(u: Usuario): Promise<void> {
  setGrcup({ abriendo: "GR Cup", comprobando: false, errorSesion: "" });
  setUsuario(u);
  try {
    await autoabrir();
  } catch (e) {
    setGrcup({ apertura: { texto: "", aviso: `No se pudo abrir la competición de GR Cup: ${(e as Error).message}` } });
  } finally {
    setGrcup({ abriendo: "" });
    reanudarEnvio();
  }
}

export async function entrarConCuenta(email: string, password: string): Promise<void> {
  await entrar(await login(email, password));
}

// salir closes the session; the meet and anything not sent yet stay in this browser for the next sign-in.
export async function salir(): Promise<void> {
  pausar();
  try {
    await logout();
  } finally {
    setUsuario(null);
  }
}

// iniciar runs once when the app opens: renews the saved session, if any.
export async function iniciar(): Promise<void> {
  // the session died mid-use (expired or revoked): back to the gate, keeping the meet and its pending changes
  onSesionCaducada(() => setUsuario(null));
  try {
    const u = await renovar();
    if (u) await entrar(u);
    else setGrcup({ comprobando: false });
  } catch (e) {
    setGrcup({ comprobando: false, errorSesion: (e as Error).message });
  }
}
