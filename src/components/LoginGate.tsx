// vim: set ts=2 sts=2 sw=2 et:
//
// GR Cup fork: the login gate. Nothing of OpenLifter (navbar, Meet Setup, Registration, Lifting, any route) renders
// until a GR Cup account signs in or the saved session is renewed; a session that dies mid-use brings the gate
// back while the meet and its pending changes stay in this browser.

import React, { useEffect, useState } from "react";

import Alert from "react-bootstrap/Alert";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";

import { useGrcup } from "../containers/GrcupContainer";
import { entrarConCuenta, iniciar } from "../grcup/sesion";

const pantalla: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 2000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  background: "#121212",
  color: "#f2f2f2",
  overflowY: "auto",
};

const tarjeta: React.CSSProperties = {
  width: "100%",
  maxWidth: 380,
  padding: 28,
  borderRadius: 12,
  background: "#1e1e1e",
  border: "1px solid #333",
};

const Marca = () => (
  <div style={{ textAlign: "center", marginBottom: 24 }}>
    <img
      alt="GR Cup"
      src="https://jaimedigitalstudio.b-cdn.net/grcup/logos/grcuplogo.png"
      height={56}
      style={{ marginBottom: 12 }}
    />
    <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Mesa de competición</h1>
    <p style={{ fontSize: 14, color: "#a8a8a8", margin: "4px 0 0" }}>OpenLifter · GR Cup</p>
  </div>
);

const LoginGate = ({ children }: { children: React.ReactNode }) => {
  const g = useGrcup();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    iniciar();
  }, []);

  if (g.usuario && !g.abriendo) return <>{children}</>;

  if (g.comprobando || g.abriendo) {
    return (
      <div style={pantalla} role="status" aria-live="polite">
        <div style={{ ...tarjeta, textAlign: "center" }}>
          <Marca />
          <p style={{ margin: 0 }}>
            {g.abriendo && g.abriendo !== "GR Cup" ? `Abriendo «${g.abriendo}»…` : "Comprobando la sesión…"}
          </p>
        </div>
      </div>
    );
  }

  const entrar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setOcupado(true);
    setError("");
    try {
      await entrarConCuenta(email.trim(), password);
      setPassword("");
    } catch (e) {
      setError((e as Error).message || "No se pudo iniciar sesión.");
    } finally {
      setOcupado(false);
    }
  };

  const aviso = error || g.errorSesion || (g.estado === "error" && g.error.includes("sesión") ? g.error : "");

  return (
    <div style={pantalla}>
      <Form style={tarjeta} onSubmit={entrar} aria-labelledby="gate-titulo">
        <Marca />
        <p id="gate-titulo" style={{ fontSize: 14, color: "#c8c8c8" }}>
          Entra con tu cuenta del backoffice de GR Cup para abrir la competición.
        </p>
        {aviso && (
          <Alert variant="danger" role="alert">
            {aviso}
          </Alert>
        )}
        <Form.Group controlId="gate-email">
          <Form.Label>Email</Form.Label>
          <Form.Control
            type="email"
            value={email}
            onChange={(e: any) => setEmail(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </Form.Group>
        <Form.Group controlId="gate-password">
          <Form.Label>Contraseña</Form.Label>
          <Form.Control
            type="password"
            value={password}
            onChange={(e: any) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </Form.Group>
        <Button type="submit" variant="primary" block disabled={ocupado}>
          {ocupado ? "Entrando…" : "Entrar"}
        </Button>
      </Form>
    </div>
  );
};

export default LoginGate;
