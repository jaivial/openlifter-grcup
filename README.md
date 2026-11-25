# OpenLifter · GR Cup fork

Fork of [OpenLifter](https://gitlab.com/openpowerlifting/openlifter) (AGPLv3+) used as the competition desk of the
GR Strength Cup. The screens and the scoring are OpenLifter's; the fork adds one page, **GR Cup**, and a background
synchronisation with the GR Cup platform (Go microservices, `platform/` of github.com/jaivial/grweb):

- a login gate in front of everything: nothing of OpenLifter renders (any screen, any route) until a GR Cup backoffice
  account (permission «directo.operar») signs in; the session lasts 30 days with silent renewal, and «Cerrar sesión»
  is on the right of the navbar;
- right after signing in, the desk opens the predetermined meet of its competition by itself (no file, no card to
  choose; a different meet with changes not sent yet is replaced only if the desk says so);
- every change of an entry (weigh-in, racks, attempt weights, good / no lift) and of the lifting group on screen is
  sent to `POST /api/admin/competiciones/{cid}/openlifter/sync` (service `openlifter`), which links each entry with
  an athlete of the competition and applies it to `athletes` (weigh-in) and `live` (attempts, results, live flight);
  the public pages (/en-directo, /horarios, arena screen) follow it by SSE;
- pending changes survive a reload and are retried while there is no network: once signed in, OpenLifter keeps
  working offline (a lost network never closes the session; only an expired or revoked one brings the gate back);
- «Añadir atletas que faltan» creates the registration from the platform, already linked;
- the page lists the entries to review (suggested athlete or none) and lets the desk confirm, change or ignore them.

Code: `src/grcup/` (API client, session, sync middleware, import), `src/components/LoginGate.tsx` (gate),
`src/containers/GrcupContainer.tsx` (synchronisation panel), small hooks in
`src/store.ts`, `src/App.tsx`, `src/components/Navigation.tsx` and the source link in `AboutContainer.tsx`.

Deploy (host nginx on kraken, `/api` → platform gateway on the same origin):

```bash
deploy/desplegar.sh qa                          # https://grcup-qa-openlifter.menustudioai.com (tailnet, QA)
deploy/desplegar.sh prod --confirmo-produccion  # https://grcup-openlifter.menustudioai.com (public, production)
```

---

# OpenLifter

> Simple software for running a local powerlifting competition.

## Development Chat

Project development is discussed in the [OpenPowerlifting Zulip Chat](https://openpl.zulipchat.com/), in the channel `#coding/openlifter`. Everyone is welcome to join.

## Software Stack

OpenLifter is a single-page webapp built with TypeScript, React, Redux, and Bootstrap. Help is welcome!

## Development Setup

### Fedora 31

Install Yarn from the Yarn RPM package repository:

```bash
curl --silent --location https://dl.yarnpkg.com/rpm/yarn.repo | sudo tee /etc/yum.repos.d/yarn.repo
sudo dnf install yarn make
```

Build and launch the development server in-browser:

```bash
make
```

### General

This project was initialized through `create-react-app`. There is a bunch of implicit project-wide build magic that `create-react-app` manages through dependent scripts. The magic behavior is described in the [Create React App Documentation](https://facebook.github.io/create-react-app/docs/getting-started).

First, you need to install yarn. You can find the installation steps here https://yarnpkg.com/en/.

Second, navigate to your local project's root directory and run the `yarn install` command. The command installs all packages specified in the package.json file.

Once the command finishes then you can run the make commands below: 

```bash
# Opens a development browser with hot reload at localhost:3000.
make

# Opens a development Electron app with hot reload.
make electron

# Runs unit tests.
make check
```

## Translations

Translations are handled using `react-intl`. They work by using `FormattedMessage`:

```
<FormattedMessage id="uniqueId" defaultMessage="English Text" />
```

Running `yarn manage:translations` will read through the codebase for uses of `FormattedMessage` and extract translatable entries into JSON in `src/translations/`.

## Release instructions

Preparing an official release involves a few temporary modifications.

Official builds are permanently stored at https://www.openlifter.com/releases/ in a subdirectory with the same name as the version number. In the examples below, the version being released is `x.y`.

1. Edit `package.json` to set the `version`, `homepage`, and `router_basename` variables. These are used by the `.env` file to create JS environment variables. In our example, set `"version": "x.y"`, `"homepage": "https://www.openlifter.com/releases/x.y/"`, and `"router_basename": "/releases/x.y/"`.
2. Edit `src/versions.js` to fix the `releaseDate` using ISO-8601 notation (YYYY-MM-DD). Hopefully in the future we can just automate this, but I couldn't think of a platform-independent way at this hour.
3. Run `make release-web`. This will build into `public/`, but mess up the state of the repo.
4. Move the `public/` folder into `releases/` for permanent archival, using the version. For example, `mv public releases/x.y`.
5. Fully reset the repo: `make clean && rm -rf public && git reset --hard HEAD`
6. `git add releases/x.y && git commit`
7. Done! Now you can build `website/` and it should include that release. You'll probably have to update the website text and include the changelog on the releases/ page.
