// vim: set ts=2 sts=2 sw=2 et:
//
// This file is part of OpenLifter, simple Powerlifting meet software.
// Copyright (C) 2019 The OpenPowerlifting Project.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

// Defines the Navigation component for navigating between pages using react-router.

import React, { useEffect } from "react";
import { FormattedMessage } from "react-intl";

import Badge from "react-bootstrap/Badge";

import Nav from "react-bootstrap/Nav";
import Navbar from "react-bootstrap/Navbar";

// The LinkContainer is used to wrap Components that change the URL,
// hooking them up with the Router.
import { LinkContainer } from "react-router-bootstrap";

// GR Cup fork: link to the synchronisation page, with its state.
import { useGrcup } from "../containers/GrcupContainer";
import { iniciar } from "../grcup/sync";

const colores = {
  desconectado: "secondary",
  sincronizado: "success",
  pendiente: "warning",
  enviando: "info",
  error: "danger",
};

const Navigation = () => {
  const g = useGrcup();
  useEffect(() => {
    // GR Cup fork: automatic connection (server key) or the saved platform session.
    iniciar();
  }, []);
  return (
    <Navbar sticky="top" bg="dark" variant="dark" expand="lg">
      <Navbar.Brand>
        <img alt="OpenLifter" src="openlifter-white.svg" height="20" />
      </Navbar.Brand>

      {/* Navbar uses Toggle and Collapse to automatically create a hamburger menu
          in case of overflow on small screens.*/}
      <Navbar.Toggle aria-controls="basic-navbar-nav" />
      <Navbar.Collapse>
        <Nav>
          <LinkContainer to="/">
            <Nav.Link>
              <FormattedMessage id="nav.home" defaultMessage="Home" />
            </Nav.Link>
          </LinkContainer>
          <LinkContainer to="/meet-setup">
            <Nav.Link>
              <FormattedMessage id="nav.meet-setup" defaultMessage="Meet Setup" />
            </Nav.Link>
          </LinkContainer>
          <LinkContainer to="/registration">
            <Nav.Link>
              <FormattedMessage id="nav.registration" defaultMessage="Registration" />
            </Nav.Link>
          </LinkContainer>
          <LinkContainer to="/weigh-ins">
            <Nav.Link>
              <FormattedMessage id="nav.weigh-ins" defaultMessage="Weigh-ins" />
            </Nav.Link>
          </LinkContainer>
          <LinkContainer to="/flight-order">
            <Nav.Link>
              <FormattedMessage id="nav.flight-order" defaultMessage="Flight Order" />
            </Nav.Link>
          </LinkContainer>
          <LinkContainer to="/lifting">
            <Nav.Link>
              <FormattedMessage id="nav.lifting" defaultMessage="Lifting" />
            </Nav.Link>
          </LinkContainer>
          <LinkContainer to="/results">
            <Nav.Link>
              <FormattedMessage id="nav.results" defaultMessage="Results" />
            </Nav.Link>
          </LinkContainer>
          <LinkContainer to="/grcup">
            <Nav.Link>
              GR Cup{" "}
              <Badge variant={(g.activo && g.usuario ? colores[g.estado] : "secondary") as any}>
                {!g.activo || !g.usuario
                  ? "off"
                  : g.estado === "sincronizado"
                    ? "✓"
                    : g.estado === "error"
                      ? "!"
                      : g.pendientes || "…"}
              </Badge>
            </Nav.Link>
          </LinkContainer>
          <LinkContainer to="/debug">
            <Nav.Link>
              <FormattedMessage id="nav.debug" defaultMessage="Debug" />
            </Nav.Link>
          </LinkContainer>
        </Nav>
      </Navbar.Collapse>
    </Navbar>
  );
};

export default Navigation;
