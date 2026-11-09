// vim: set ts=2 sts=2 sw=2 et:
//
// GR Cup fork: the «GR Cup» page. Sign in with a GR Cup backoffice account, choose the competition, start the
// synchronisation, import the athletes, and review how each OpenLifter entry is linked to an athlete.

import React, { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";

import Alert from "react-bootstrap/Alert";
import Badge from "react-bootstrap/Badge";
import Button from "react-bootstrap/Button";
import Card from "react-bootstrap/Card";
import Col from "react-bootstrap/Col";
import Container from "react-bootstrap/Container";
import Form from "react-bootstrap/Form";
import Row from "react-bootstrap/Row";
import Table from "react-bootstrap/Table";

import styles from "../components/common/ContentArea.module.scss";

import { api, competiciones, login, logout, Competicion } from "../grcup/api";
import {
  aplicarEstado,
  conectar,
  EstadoMesa,
  getGrcup,
  mesaPorDefecto,
  pausar,
  setUsuario,
  sincronizarTodo,
  subscribeGrcup,
  Vinculo,
} from "../grcup/sync";
import { importables, AtletaGR } from "../grcup/importar";
import { newRegistration } from "../actions/registrationActions";
import { GlobalState } from "../types/stateTypes";

const etiquetas: Record<Vinculo["vinculo"], [string, string]> = {
  auto: ["success", "Automático"],
  confirmado: ["primary", "Confirmado"],
  sugerido: ["warning", "Revisar"],
  sin_coincidencia: ["danger", "Sin atleta"],
  ignorado: ["secondary", "No se sincroniza"],
};

const pct = (x: number) => `${Math.round(x * 100)} %`;

export function useGrcup() {
  const [g, setG] = useState(getGrcup());
  useEffect(() => subscribeGrcup(() => setG(getGrcup())), []);
  return g;
}

const GrcupContainer = () => {
  const g = useGrcup();
  const meet = useSelector((s: GlobalState) => s);
  const dispatch = useDispatch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [comps, setComps] = useState<Array<Competicion>>([]);
  const [cid, setCid] = useState(g.competicion ? g.competicion.id : "");
  const [mesa, setMesa] = useState(g.mesa || mesaPorDefecto(meet));
  const [atletas, setAtletas] = useState<Array<AtletaGR>>([]);
  const [cargando, setCargando] = useState(false);
  const [elegidos, setElegidos] = useState<Record<number, string>>({});
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [filtro, setFiltro] = useState<"revisar" | "todos">("revisar");
  const [editando, setEditando] = useState<Record<number, boolean>>({});

  useEffect(() => {
    if (g.auto && g.competicion) {
      setComps([g.competicion]);
      setCid(g.competicion.id);
      return;
    }
    if (!g.usuario) return;
    competiciones()
      .then((cs) => {
        setComps(cs);
        if (!cid && cs.length > 0) setCid(cs[0].id);
      })
      .catch((e) => setError(e.message));
  }, [g.usuario, g.auto, g.competicion]);

  const compId = g.competicion ? g.competicion.id : "";
  useEffect(() => {
    if (!g.usuario || !compId) return;
    setCargando(true);
    api<{ atletas: Array<AtletaGR> }>("GET", `/api/admin/competiciones/${compId}/openlifter/atletas`)
      .then((r) => setAtletas(r.atletas))
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  }, [g.usuario, compId]);

  const run = async (fn: () => Promise<void>) => {
    setOcupado(true);
    setError("");
    setMsg("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setOcupado(false);
    }
  };

  const entrar = (ev: React.FormEvent) => {
    ev.preventDefault();
    run(async () => {
      setUsuario(await login(email.trim(), password));
      setPassword("");
    });
  };

  const salir = () =>
    run(async () => {
      pausar();
      await logout();
      setUsuario(null);
    });

  const iniciar = () => {
    const c = comps.find((x) => x.id === cid);
    if (c) conectar(c, mesa || mesaPorDefecto(meet));
  };

  const vincular = (cambios: Array<{ entryId: number; atletaId?: string; ignorar?: boolean }>) =>
    run(async () => {
      if (!g.competicion) return;
      const r = await api<EstadoMesa>("PUT", `/api/admin/competiciones/${g.competicion.id}/openlifter/vinculos`, {
        mesa: g.mesa,
        cambios,
      });
      aplicarEstado(r);
      setEditando({});
    });

  // athletes linked to an entry of this browser's registration (the platform may keep entries of another laptop)
  const vinculadosIds = useMemo(() => {
    const locales = new Set(meet.registration.entries.map((e) => e.id));
    return new Set(
      (g.mesaEstado ? g.mesaEstado.vinculos : []).filter((v) => locales.has(v.entryId)).map((v) => v.atletaId || ""),
    );
  }, [g.mesaEstado, meet.registration.entries]);

  const nuevos = useMemo(() => importables(atletas, meet, vinculadosIds), [atletas, meet, vinculadosIds]);

  const importar = () =>
    run(async () => {
      if (!g.competicion || nuevos.length === 0) return;
      if (!window.confirm(`Se añadirán ${nuevos.length} atletas de GR Cup a la inscripción de OpenLifter. ¿Continuar?`))
        return;
      let id = meet.registration.nextEntryId;
      const cambios: Array<{ entryId: number; atletaId: string }> = [];
      for (const x of nuevos) {
        dispatch(newRegistration(x.entrada));
        cambios.push({ entryId: id, atletaId: x.atleta.id });
        id += 1;
      }
      const r = await api<EstadoMesa>("PUT", `/api/admin/competiciones/${g.competicion.id}/openlifter/vinculos`, {
        mesa: g.mesa,
        cambios,
      });
      aplicarEstado(r);
      setMsg(`${cambios.length} atletas añadidos y vinculados. Revisa flights y lotes en «Registration».`);
    });

  const locales = new Set(meet.registration.entries.map((e) => e.id));
  const vinculos = (g.mesaEstado ? g.mesaEstado.vinculos : []).filter((v) => locales.has(v.entryId));
  const revisar = vinculos.filter((v) => v.vinculo === "sugerido" || v.vinculo === "sin_coincidencia");
  const lista = filtro === "revisar" ? revisar : vinculos;
  const vinculados = vinculos.filter((v) => v.vinculo === "auto" || v.vinculo === "confirmado").length;

  const estadoTxt = {
    desconectado: ["secondary", "Sin sincronizar"],
    sincronizado: ["success", "Sincronizado"],
    pendiente: ["warning", `${g.pendientes} cambios pendientes`],
    enviando: ["info", "Enviando…"],
    error: ["danger", "Error"],
  }[g.estado];

  return (
    <Container className={styles.contentArea}>
      <Row>
        <Col md={5}>
          <Card>
            <Card.Header>GR Cup · conexión</Card.Header>
            <Card.Body>
              {!g.usuario ? (
                <Form onSubmit={entrar}>
                  <p>Entra con tu cuenta del backoffice de GR Cup (necesita el permiso «Operar el directo»).</p>
                  <Form.Group>
                    <Form.Label>Email</Form.Label>
                    <Form.Control
                      type="email"
                      value={email}
                      onChange={(e: any) => setEmail(e.target.value)}
                      autoComplete="username"
                      required
                    />
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>Contraseña</Form.Label>
                    <Form.Control
                      type="password"
                      value={password}
                      onChange={(e: any) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                  </Form.Group>
                  <Button type="submit" disabled={ocupado}>
                    Entrar
                  </Button>
                </Form>
              ) : (
                <div>
                  {g.auto ? (
                    <p>
                      Conectada automáticamente a GR Cup como <b>{g.usuario.nombre}</b>. No hace falta iniciar sesión.
                    </p>
                  ) : (
                    <p>
                      Sesión: <b>{g.usuario.nombre || g.usuario.email}</b>{" "}
                      <Button variant="link" size="sm" onClick={salir}>
                        Cerrar sesión
                      </Button>
                    </p>
                  )}
                  <Form.Group>
                    <Form.Label>Competición</Form.Label>
                    <Form.Control
                      as="select"
                      value={cid}
                      disabled={g.activo}
                      onChange={(e: any) => setCid(e.target.value)}
                    >
                      {comps.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}
                        </option>
                      ))}
                    </Form.Control>
                  </Form.Group>
                  <Form.Group>
                    <Form.Label>Mesa</Form.Label>
                    <Form.Control
                      value={mesa}
                      disabled={g.activo}
                      maxLength={120}
                      onChange={(e: any) => setMesa(e.target.value)}
                    />
                    <Form.Text className="text-muted">
                      Identifica esta competición de OpenLifter en GR Cup. Usa la misma en todos los portátiles de la
                      mesa.
                    </Form.Text>
                  </Form.Group>
                  {!g.activo ? (
                    <Button onClick={iniciar} disabled={!cid || ocupado}>
                      Empezar a sincronizar
                    </Button>
                  ) : (
                    <div>
                      <p>
                        <Badge variant={estadoTxt[0] as any}>{estadoTxt[1]}</Badge>{" "}
                        {g.ultimaSync > 0 && <small>Última: {new Date(g.ultimaSync).toLocaleTimeString()}</small>}
                      </p>
                      {g.error && <Alert variant="danger">{g.error}</Alert>}
                      <Button variant="outline-primary" size="sm" onClick={sincronizarTodo}>
                        Enviar todo de nuevo
                      </Button>{" "}
                      <Button variant="outline-secondary" size="sm" onClick={pausar}>
                        Pausar
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card.Body>
          </Card>

          {g.usuario && g.activo && (
            <Card style={{ marginTop: 16 }}>
              <Card.Header>Atletas de GR Cup</Card.Header>
              <Card.Body>
                <p>
                  {cargando ? "Cargando atletas de GR Cup…" : `${atletas.length} atletas confirmados en GR Cup`} ·{" "}
                  {vinculados} entradas vinculadas.
                </p>
                <p>
                  Crea la inscripción desde GR Cup para que cada entrada quede vinculada sin revisar nada: nombre, sexo,
                  fecha de nacimiento, categoría, club, licencia (MemberID), flight, peso corporal y primeros intentos.
                </p>
                <Button onClick={importar} disabled={ocupado || cargando || nuevos.length === 0}>
                  {nuevos.length > 0 ? `Añadir ${nuevos.length} atletas que faltan` : "No falta ningún atleta"}
                </Button>
              </Card.Body>
            </Card>
          )}
        </Col>

        <Col md={7}>
          {msg && <Alert variant="success">{msg}</Alert>}
          {error && <Alert variant="danger">{error}</Alert>}
          {g.mesaEstado && g.mesaEstado.avisos.length > 0 && (
            <Alert variant="warning">
              {g.mesaEstado.avisos.slice(0, 8).map((a, i) => (
                <div key={i}>
                  {a.entryId !== undefined && a.entryId > 0 ? `#${a.entryId}: ` : ""}
                  {a.mensaje}
                </div>
              ))}
            </Alert>
          )}
          {g.activo && g.usuario && (
            <Card>
              <Card.Header>
                Vínculos con los atletas{" "}
                <Form.Check
                  inline
                  type="radio"
                  label={`Por revisar (${revisar.length})`}
                  checked={filtro === "revisar"}
                  onChange={() => setFiltro("revisar")}
                  style={{ marginLeft: 16 }}
                />
                <Form.Check
                  inline
                  type="radio"
                  label={`Todos (${vinculos.length})`}
                  checked={filtro === "todos"}
                  onChange={() => setFiltro("todos")}
                />
              </Card.Header>
              <Card.Body style={{ padding: 0 }}>
                {lista.length === 0 ? (
                  <p style={{ padding: 16, margin: 0 }}>
                    {filtro === "revisar"
                      ? "Nada que revisar: todas las entradas están vinculadas."
                      : "Aún no hay entradas."}
                  </p>
                ) : (
                  <Table size="sm" striped style={{ margin: 0 }}>
                    <thead>
                      <tr>
                        <th>OpenLifter</th>
                        <th>Estado</th>
                        <th>Atleta de GR Cup</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((v) => {
                        const opciones = v.candidatos || [];
                        const elegido = elegidos[v.entryId] || (opciones[0] ? opciones[0].atletaId : "");
                        const e = etiquetas[v.vinculo];
                        const elegir = (!v.atletaId && v.vinculo !== "ignorado") || editando[v.entryId];
                        return (
                          <tr key={v.entryId}>
                            <td>{v.nombreOL || <i>(sin nombre)</i>}</td>
                            <td>
                              <Badge variant={e[0] as any}>{e[1]}</Badge>{" "}
                              {v.puntuacion > 0 && <small>{pct(v.puntuacion)}</small>}
                            </td>
                            <td>
                              {!elegir && v.atletaId ? (
                                <span title={v.motivo}>{v.nombre}</span>
                              ) : !elegir ? (
                                "—"
                              ) : (
                                <Form.Control
                                  as="select"
                                  size="sm"
                                  value={elegido}
                                  onChange={(ev: any) => setElegidos({ ...elegidos, [v.entryId]: ev.target.value })}
                                >
                                  <option value="">Elige un atleta…</option>
                                  {opciones.map((c) => (
                                    <option key={c.atletaId} value={c.atletaId}>
                                      {c.nombre} · {c.categoria} · {pct(c.puntuacion)} ({c.motivos.join(", ")})
                                    </option>
                                  ))}
                                  <option disabled>──────────</option>
                                  {atletas
                                    .filter((a) => !opciones.some((c) => c.atletaId === a.id))
                                    .map((a) => (
                                      <option key={a.id} value={a.id}>
                                        {a.nombre} · {a.categoria}
                                      </option>
                                    ))}
                                </Form.Control>
                              )}
                            </td>
                            <td style={{ whiteSpace: "nowrap" }}>
                              {elegir && (
                                <Button
                                  size="sm"
                                  disabled={!elegido || ocupado}
                                  onClick={() => vincular([{ entryId: v.entryId, atletaId: elegido }])}
                                >
                                  Confirmar
                                </Button>
                              )}
                              {!elegir && v.vinculo === "auto" && (
                                <Button
                                  size="sm"
                                  variant="outline-primary"
                                  disabled={ocupado}
                                  onClick={() => vincular([{ entryId: v.entryId, atletaId: v.atletaId }])}
                                >
                                  Confirmar
                                </Button>
                              )}{" "}
                              {v.atletaId && !elegir && (
                                <Button
                                  size="sm"
                                  variant="outline-secondary"
                                  disabled={ocupado}
                                  onClick={() => setEditando({ ...editando, [v.entryId]: true })}
                                >
                                  Cambiar
                                </Button>
                              )}
                              {!v.atletaId && v.vinculo !== "ignorado" && (
                                <Button
                                  size="sm"
                                  variant="link"
                                  disabled={ocupado}
                                  onClick={() => vincular([{ entryId: v.entryId, ignorar: true }])}
                                >
                                  No sincronizar
                                </Button>
                              )}
                              {v.vinculo === "ignorado" && (
                                <Button
                                  size="sm"
                                  variant="link"
                                  disabled={ocupado}
                                  onClick={() => vincular([{ entryId: v.entryId }])}
                                >
                                  Sincronizar
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </Table>
                )}
              </Card.Body>
            </Card>
          )}
        </Col>
      </Row>
    </Container>
  );
};

export default GrcupContainer;
