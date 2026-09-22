"use client";

import "./windowsDesktop.css";
import "./macosDesktop.css";
import "./mobileDesktop.css";
import { useEffect, useReducer, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Search24Regular } from "@fluentui/react-icons/svg/search";
import { WindowMultiple24Regular } from "@fluentui/react-icons/svg/window-multiple";
import { Wifi120Regular } from "@fluentui/react-icons/svg/wifi";
import { Dismiss16Regular } from "@fluentui/react-icons/svg/dismiss";
import DesktopTerminal, { type TerminalHandle } from "./DesktopTerminal";
import DesktopWindow from "./DesktopWindow";
import DesktopIcon, { DESKTOP_APPS, DESKTOP_APP_ORDER, type DesktopApp } from "./DesktopIcon";
import DesktopCalendar from "./DesktopCalendar";
import MacDock from "./MacDock";
import SpotifyWidget from "./SpotifyWidget";
import DesktopNotes from "./DesktopNotes";
import GitHubPulse from "./GitHubPulse";
import DesktopF1 from "./DesktopF1";
import driverLeader from "../data/f1-driver-leader.json";
import { BOARD_NOTES, findBoardNote } from "./notesData";
import { APP_COMMANDS, resolveTerminalCommand } from "./terminalContent";
import { pacificClock } from "./desktopState";
import { isInDockRevealRegion } from "./macDesktopState";
import { desktopWindowReducer, INITIAL_DESKTOP_SESSION, managedWindowTitle, preferredTerminal, type DesktopWindowId } from "./desktopWindowManager";
import { SPOTIFY_PROFILE_URL } from "./spotifyData";

type Flyout = "apple" | "app" | "shell" | "edit" | "window" | "search" | "tasks" | "calendar" | "context" | null;
const appName = (id: DesktopApp) => DESKTOP_APPS.find((app) => app.id === id)!.name;
const COMMANDS = [...Object.values(APP_COMMANDS), "clear", "exit"];
const APP_LAUNCH_DELAY = 333;

export default function MonitorDesktop({ mobileLayout = false, responsiveLayout = false }: { mobileLayout?: boolean; responsiveLayout?: boolean } = {}) {
  const [session, dispatch] = useReducer(desktopWindowReducer, INITIAL_DESKTOP_SESSION);
  const { windows, active } = session;
  const [flyout, setFlyout] = useState<Flyout>(null);
  const [restoringMenuFocus, setRestoringMenuFocus] = useState(false);
  const [commandMenu, setCommandMenu] = useState(false);
  const [commandSide, setCommandSide] = useState<"left" | "right">("right");
  const [search, setSearch] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [now, setNow] = useState<Date | null>(null);
  const [online, setOnline] = useState(true);
  const [nearDock, setNearDock] = useState(false);
  const [pendingApps, setPendingApps] = useState(0);
  const launchTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const launchNumber = useRef(0);
  const busyCursor = useRef<HTMLDivElement>(null);
  const [selectedNoteId, setSelectedNoteId] = useState(BOARD_NOTES[0]?.id ?? "");
  const [noteOpenRequest, setNoteOpenRequest] = useState<{ id: string } | null>(null);
  const [contextAt, setContextAt] = useState({ x: 0, y: 0, maxHeight: 350 });
  const [contextApp, setContextApp] = useState<DesktopApp | null>(null);
  const terminalRefs = useRef(new Map<DesktopWindowId, TerminalHandle>());
  const contextSource = useRef<HTMLElement | null>(null);
  const commandTrigger = useRef<HTMLButtonElement>(null);
  const commandPanel = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const desktopRef = useRef<HTMLElement>(null);
  const menuButtons = useRef(new Map<Flyout, HTMLButtonElement>());
  const clock = now ? pacificClock(now) : null;
  const dateLabel = now ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric" }).format(now) : "";
  const results = DESKTOP_APPS.filter((app) => (app.name + " " + app.description).toLowerCase().includes(search.toLowerCase().trim()));
  const activeWindow = windows.find((item) => item.id === active);
  const activeApp = activeWindow ? appName(activeWindow.app) : "Desktop";
  const terminals = windows.filter((item) => item.app === "terminal");
  const trash = windows.find((item) => item.id === "recycle");
  const notesWindow = windows.find((item) => item.id === "notes");
  const f1Window = windows.find((item) => item.id === "f1");
  const helpWindow = windows.find((item) => item.id === "help");
  const desktopToggleLabel = windows.some((item) => !item.minimized) ? "Show Desktop" : "Restore Windows";
  const canToggleDesktop = windows.some((item) => !item.minimized || session.restoreIds.includes(item.id));
  useEffect(() => () => { for (const timer of launchTimers.current.values()) clearTimeout(timer); }, []);

  function launchAfterPause(key: string, action: () => void) {
    if (launchTimers.current.has(key)) return;
    dismissFlyout();
    launchTimers.current.set(key, setTimeout(() => {
      launchTimers.current.delete(key);
      setPendingApps(launchTimers.current.size);
      action();
    }, APP_LAUNCH_DELAY));
    setPendingApps(launchTimers.current.size);
  }
  function exitToRoom() {
    for (const timer of launchTimers.current.values()) clearTimeout(timer);
    launchTimers.current.clear(); setPendingApps(0);
    if (window.parent !== window) window.parent.postMessage({ type: "bz-desktop-exit" }, window.location.origin);
    else window.location.assign("/");
  }

  useEffect(() => {
    const openLinkedNote = () => {
      const note = findBoardNote(new URLSearchParams(window.location.search).get("note"));
      if (note) { setSelectedNoteId(note.id); setNoteOpenRequest({ id: note.id }); dispatch({ type: "open-notes" }); }
    };
    openLinkedNote();
    window.addEventListener("popstate", openLinkedNote);
    return () => window.removeEventListener("popstate", openLinkedNote);
  }, []);

  useEffect(() => {
    const tick = () => setNow(new Date());
    const connection = () => setOnline(navigator.onLine);
    tick(); connection();
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", connection); window.addEventListener("offline", connection);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); window.removeEventListener("online", connection); window.removeEventListener("offline", connection); };
  }, []);
  useEffect(() => {
    if (flyout === "search") searchInput.current?.focus();
    else if (flyout) desktopRef.current?.querySelector<HTMLElement>('.win-flyout [role="menuitem"]:not(:disabled), .win-flyout button:not(:disabled)')?.focus();
  }, [flyout]);
  useEffect(() => {
    if (flyout || restoringMenuFocus) return;
    if (active === "recycle" || active === "notes" || active === "f1" || active === "help") {
      const title = active === "notes" ? "Notes" : active === "f1" ? "F1 Forecast" : active === "help" ? "Help" : "Trash";
      const target = desktopRef.current?.querySelector<HTMLElement>(`.win-window[aria-label="${title}"]`);
      if (target && !target.contains(document.activeElement)) target.focus({ preventScroll: true });
    }
  }, [active, flyout, restoringMenuFocus]);

  function focusWindow(id: DesktopWindowId) { dispatch({ type: "focus", id }); dismissFlyout(); }
  function activate(id: DesktopWindowId) { setRestoringMenuFocus(false); if (active !== id) dispatch({ type: "focus", id }); }
  function cancelPendingLaunch(id: DesktopWindowId) {
    const timer = launchTimers.current.get(id);
    if (timer) { clearTimeout(timer); launchTimers.current.delete(id); setPendingApps(launchTimers.current.size); }
  }
  function minimize(id: DesktopWindowId) { cancelPendingLaunch(id); dispatch({ type: "minimize", id }); dismissFlyout(); }
  function closeWindow(id: DesktopWindowId) { cancelPendingLaunch(id); dispatch({ type: "close", id }); dismissFlyout(); }
  function newTerminal(command?: string) {
    launchAfterPause(`new-terminal-${++launchNumber.current}`, () => dispatch({ type: "new-terminal", command }));
  }
  function openNotes(id?: string) {
    if (id && findBoardNote(id)) { setSelectedNoteId(id); setNoteOpenRequest({ id }); }
    launchAfterPause("notes", () => dispatch({ type: "open-notes" }));
  }
  function runCommand(command: string) {
    const target = preferredTerminal(session);
    if (!target) { newTerminal(command); return; }
    focusWindow(target.id);
    terminalRefs.current.get(target.id)?.run(command);
  }
  function launch(app: DesktopApp, overrideCommand?: string) {
    if (app === "spotify") { window.open(SPOTIFY_PROFILE_URL, "_blank", "noopener,noreferrer"); launchAfterPause("spotify", () => {}); return; }
    if (app === "recycle") { launchAfterPause(app, () => dispatch({ type: "open-trash" })); return; }
    if (app === "notes") { openNotes(); return; }
    if (app === "f1") { launchAfterPause(app, () => dispatch({ type: "open-f1" })); return; }
    if (app === "help") { launchAfterPause(app, () => dispatch({ type: "open-help" })); return; }
    if (overrideCommand) { runCommand(overrideCommand); return; }
    if (app === "terminal") { newTerminal(); return; }
  }
  function toggleFlyout(next: Flyout) {
    setCommandMenu(false);
    setFlyout((current) => current === next ? null : next);
    if (next === "search") { setSearch(""); setSearchIndex(0); }
  }
  function dismissFlyout(restoreFocus = false) {
    setRestoringMenuFocus(restoreFocus);
    if (restoreFocus) {
      const target = flyout === "context" ? contextSource.current : menuButtons.current.get(flyout);
      window.requestAnimationFrame(() => target?.focus({ preventScroll: true }));
    }
    setCommandMenu(false);
    setFlyout(null);
  }
  function showDesktop() {
    dispatch({ type: "show-desktop" }); dismissFlyout();
  }
  function openContext(event: ReactMouseEvent<HTMLElement>, app: DesktopApp | null) {
    event.preventDefault(); event.stopPropagation();
    const rect = desktopRef.current!.getBoundingClientRect();
    const target = event.currentTarget.getBoundingClientRect();
    const x = event.clientX || target.left + target.width / 2;
    const y = event.clientY || target.top + target.height / 2;
    const menuHeight = Math.min(rect.height - 44, app === "terminal" ? 152 + terminals.length * 34 : 180);
    setContextAt({ x: Math.max(8, Math.min(x - rect.left, rect.width - 252)), y: Math.max(32, Math.min(y - rect.top, rect.height - menuHeight - 8)), maxHeight: rect.height - 44 });
    contextSource.current = event.currentTarget;
    setContextApp(app); setCommandMenu(false); setFlyout("context");
    window.requestAnimationFrame(() => desktopRef.current?.querySelector<HTMLElement>('.win-context-menu [role="menuitem"]')?.focus());
  }
  function openCommands(focusFirst = false) {
    const rect = commandTrigger.current?.getBoundingClientRect(), area = desktopRef.current?.getBoundingClientRect();
    setCommandSide(rect && area && area.right - rect.right < 245 && rect.left - area.left >= 245 ? "left" : "right");
    setCommandMenu(true);
    if (focusFirst) window.requestAnimationFrame(() => commandPanel.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }
  function menuButton(id: Flyout, label: string) {
    return <button type="button" className={flyout === id ? "is-selected" : ""} aria-label={label} aria-expanded={flyout === id} aria-haspopup="menu"
      ref={(button) => { if (button) menuButtons.current.set(id, button); else menuButtons.current.delete(id); }}
      onClick={() => toggleFlyout(id)}>{label}</button>;
  }
  const isMenu = flyout && ["apple", "app", "shell", "edit", "window"].includes(flyout);

  return <main className="windows-desktop-page" data-mobile-layout={mobileLayout ? "review" : undefined} data-responsive={responsiveLayout ? "true" : undefined}>
    <section ref={desktopRef} tabIndex={-1} className={`windows-desktop-canvas win-desktop mac-desktop${pendingApps ? " is-launching" : ""}`} aria-busy={pendingApps > 0} aria-label="Brian Zeng macOS Tahoe workstation" data-capture-width="1920" data-capture-height="1080"
      onDragStart={(event) => event.preventDefault()}
      onPointerMoveCapture={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        event.currentTarget.dataset.pointer = event.pointerType === "touch" ? "false" : "true";
        if (busyCursor.current) busyCursor.current.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
        setNearDock(isInDockRevealRegion(event.clientY, rect.top, rect.height));
      }}
      onPointerLeave={() => { setNearDock(false); if (desktopRef.current) desktopRef.current.dataset.pointer = "false"; }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && commandMenu) { event.preventDefault(); event.stopPropagation(); setCommandMenu(false); commandTrigger.current?.focus(); return; }
        if (event.key === "Escape" && flyout) { event.preventDefault(); dismissFlyout(true); return; }
        if ((event.metaKey || event.ctrlKey) && event.code === "Space") { event.preventDefault(); toggleFlyout("search"); }
        if (event.ctrlKey && event.key === "ArrowUp") { event.preventDefault(); toggleFlyout("tasks"); }
        const focusedMenu = (event.target as HTMLElement).closest<HTMLElement>('[role="menu"]');
        if (focusedMenu && event.key === "Tab") dismissFlyout();
        if (focusedMenu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const items = Array.from(focusedMenu.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter((item) => item.closest('[role="menu"]') === focusedMenu && !item.hasAttribute("disabled"));
          const index = items.indexOf(document.activeElement as HTMLElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}>
      <div className="win-workarea" onPointerDown={(event) => { if (event.target === event.currentTarget) dispatch({ type: "blur" }); }}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest(".win-window, .mac-desktop-widgets")) return;
          openContext(event, null);
        }}>
        <div className="mac-desktop-widgets"><SpotifyWidget /><GitHubPulse variant="widget" />
          <section className="f1-driver-widget" aria-label="F1 drivers’ championship leader">
            <span className="f1-driver-widget-label">F1 · Championship leader</span>
            <strong>{driverLeader.name}</strong>
            <span>{driverLeader.team}</span>
            <b>{driverLeader.points} <small>PTS</small></b>
            <a href={driverLeader.source} target="_blank" rel="noopener noreferrer" title={`Standings through the ${driverLeader.through}`}>Driver standings ↗</a>
          </section>
        </div>
        <div className="mac-desktop-icons" aria-label="Desktop applications">
          {DESKTOP_APP_ORDER.map((id) => <button key={id} type="button" className="mac-desktop-app" aria-label={`Open ${appName(id)}`}
            onClick={() => launch(id)} onContextMenu={(event) => openContext(event, id)}>
            <DesktopIcon name={id} /><span>{appName(id)}</span>
          </button>)}
        </div>
        {terminals.map((item) => <DesktopTerminal key={item.id} instance={item.number} mobileLayout={mobileLayout}
          ref={(handle) => { if (handle) terminalRefs.current.set(item.id, handle); else terminalRefs.current.delete(item.id); }}
          foreground={active === item.id} active={active === item.id && !flyout} focusSession={active === item.id && !flyout && !restoringMenuFocus} minimized={item.minimized} zIndex={item.z}
          initialCommand={item.initialCommand} onExit={exitToRoom} onActivate={() => activate(item.id)} onMinimize={() => minimize(item.id)} onClose={() => closeWindow(item.id)} />)}
        {notesWindow && <DesktopNotes selectedId={selectedNoteId} openRequest={noteOpenRequest} onSelect={setSelectedNoteId}
          foreground={active === "notes"} active={active === "notes" && !flyout} minimized={notesWindow.minimized} zIndex={notesWindow.z}
          onActivate={() => activate("notes")} onMinimize={() => minimize("notes")} onClose={() => closeWindow("notes")} />}
        {f1Window && <DesktopF1 foreground={active === "f1"} active={active === "f1" && !flyout} minimized={f1Window.minimized} zIndex={f1Window.z}
          onActivate={() => activate("f1")} onMinimize={() => minimize("f1")} onClose={() => closeWindow("f1")} />}
        {trash && <DesktopWindow title="Trash" foreground={active === "recycle"} active={active === "recycle" && !flyout} minimized={trash.minimized} zIndex={trash.z}
          onActivate={() => activate("recycle")} onMinimize={() => minimize("recycle")} onClose={() => closeWindow("recycle")}
          titlebar={<div className="mac-window-heading">Trash</div>}>
          <div className="mac-trash-body"><DesktopIcon name="recycle" /><p>Trash is empty.</p></div>
          <footer className="win-recycle-status">0 items</footer>
        </DesktopWindow>}
        {helpWindow && <DesktopWindow title="Help" className="mac-help-window" foreground={active === "help"} active={active === "help" && !flyout} minimized={helpWindow.minimized} zIndex={helpWindow.z}
          initialFrame={{ x: .22, y: .16, width: .42, height: .6 }} minimumSize={{ width: 360, height: 320 }}
          onActivate={() => activate("help")} onMinimize={() => minimize("help")} onClose={() => closeWindow("help")}
          titlebar={<div className="mac-window-heading"><DesktopIcon name="help" /><span>Help</span></div>}>
          <div className="mac-help-body">
            <h1>Terminal commands</h1>
            <p>Type a command in Terminal and press Enter.</p>
            <button type="button" className="mac-help-open-terminal" onClick={() => {
              const target = preferredTerminal(session);
              if (target) focusWindow(target.id); else newTerminal();
            }}>Open Terminal <span aria-hidden="true">↗</span></button>
            <dl>{resolveTerminalCommand("help")!.lines.slice(1).map((line) => {
              const [command, description] = line.trim().split(/\s+-\s+/);
              return <div key={command}><dt><code>{command}</code></dt><dd>{description}</dd></div>;
            })}</dl>
          </div>
        </DesktopWindow>}
      </div>

      {flyout && <div className="win-flyout-dismiss" onPointerDown={() => dismissFlyout()} aria-hidden="true" />}
      {isMenu && <section className={"win-flyout mac-app-menu mac-menu-" + flyout} role="menu" aria-label={flyout + " menu"}>
        {flyout === "apple" && <>
          <button role="menuitem" type="button" onClick={() => toggleFlyout("search")}>Spotlight…</button>
          <button role="menuitem" type="button" disabled={!canToggleDesktop} onClick={showDesktop}>{desktopToggleLabel}</button>
        </>}
        {flyout === "app" && <>
          {activeApp === "Desktop" ? <>
            <button role="menuitem" type="button" onClick={() => newTerminal()}>New Terminal Window</button>
            <button role="menuitem" type="button" onClick={() => toggleFlyout("search")}>Find an App…</button>
            <button role="menuitem" type="button" disabled={!canToggleDesktop} onClick={showDesktop}>{desktopToggleLabel}</button>
          </> : <>
            {active && <button role="menuitem" type="button" onClick={() => minimize(active)}>Hide {activeApp}</button>}
            {active && <button role="menuitem" type="button" onClick={() => closeWindow(active)}>Close {activeWindow ? managedWindowTitle(activeWindow) : activeApp}</button>}
          </>}
        </>}
        {flyout === "shell" && <>
          <button role="menuitem" type="button" onClick={() => newTerminal()}>New Terminal Window</button><hr />
          {activeApp === "Terminal" ? <button role="menuitem" type="button" onClick={() => runCommand(APP_COMMANDS.github)}>Run pulse.py</button>
            : DESKTOP_APP_ORDER.filter((id) => id !== "terminal").map((id) => <button role="menuitem" type="button" key={id} onClick={() => launch(id)}>{appName(id)}</button>)}
        </>}
        {flyout === "edit" && <>
          <div className="mac-command-menu-anchor" onPointerEnter={() => openCommands()} onPointerLeave={() => {
            if (!commandPanel.current?.contains(document.activeElement)) setCommandMenu(false);
          }}>
            <button ref={commandTrigger} role="menuitem" type="button" aria-haspopup="menu" aria-expanded={commandMenu} aria-controls="terminal-command-menu"
              onClick={() => openCommands(true)} onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); openCommands(true); } }}>Select Command <span aria-hidden="true">›</span></button>
            {commandMenu && <div ref={commandPanel} id="terminal-command-menu" className="mac-command-submenu" data-side={commandSide} role="menu" aria-label="Terminal commands"
              onKeyDown={(event) => { if (event.key === "ArrowLeft") { event.preventDefault(); event.stopPropagation(); setCommandMenu(false); commandTrigger.current?.focus(); } }}>
              {COMMANDS.map((command) => <button key={command} role="menuitem" type="button" onClick={() => runCommand(command)}>{command}</button>)}
            </div>}
          </div>
          <button role="menuitem" type="button" onFocus={() => setCommandMenu(false)} onClick={() => runCommand("clear")}>Clear Terminal <kbd>⌃L</kbd></button>
        </>}
        {flyout === "window" && <>
          {active && <button role="menuitem" type="button" onClick={() => minimize(active)}>Minimize</button>}
          <button role="menuitem" type="button" disabled={!canToggleDesktop} onClick={showDesktop}>{desktopToggleLabel}</button>
          <button role="menuitem" type="button" onClick={() => setFlyout("tasks")}>Mission Control</button><hr />
          {windows.map((item) => <button role="menuitem" type="button" key={item.id} onClick={() => focusWindow(item.id)}>{active === item.id ? "✓ " : ""}{managedWindowTitle(item)}{item.minimized ? " — Minimized" : ""}</button>)}
        </>}
      </section>}
      {flyout === "search" && <section className="win-flyout win-launcher is-search mac-spotlight" aria-label="Spotlight">
        <div className="win-launcher-search"><Search24Regular /><input ref={searchInput} aria-label="Spotlight search" placeholder="Spotlight Search" value={search}
          onChange={(event) => { setSearch(event.target.value); setSearchIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSearchIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + Math.max(1, results.length)) % Math.max(1, results.length)); }
            if (event.key === "Enter" && results[searchIndex]) { event.preventDefault(); launch(results[searchIndex].id); }
          }} /><span className="mac-keycap">esc</span></div>
        <div className="mac-spotlight-heading">Applications</div>
        <div className="win-search-results">{results.map((app, index) => <button className={searchIndex === index ? "is-highlighted" : ""} type="button" key={app.id} onMouseEnter={() => setSearchIndex(index)} onClick={() => launch(app.id)}><DesktopIcon name={app.id} /><span>{app.name}<small>{app.description}</small></span><span className="win-open-hint">↵</span></button>)}
          {!results.length && <p>No results for “{search}”.</p>}</div>
      </section>}
      {flyout === "calendar" && now && <DesktopCalendar now={now} />}
      {flyout === "tasks" && <section className="win-flyout win-task-view" aria-label="Mission Control"><h2>Open windows</h2><div>
        {windows.map((item) => <article key={item.id}><header><DesktopIcon name={item.app} /><span>{managedWindowTitle(item)}</span><button type="button" aria-label={"Close " + managedWindowTitle(item) + " from Mission Control"} onClick={() => closeWindow(item.id)}><Dismiss16Regular /></button></header>
          <button className="win-window-preview" type="button" onClick={() => focusWindow(item.id)}><DesktopIcon name={item.app} /><span>{item.minimized ? "Minimized" : "Open"} · Click to switch</span></button></article>)}
        {!windows.length && <p>No open windows.</p>}</div></section>}
      {flyout === "context" && <section className="win-flyout win-context-menu" role="menu" style={{ left: contextAt.x, top: contextAt.y, maxHeight: contextAt.maxHeight }} aria-label={contextApp ? `${appName(contextApp)} options` : "Desktop menu"} onContextMenu={(event) => event.preventDefault()}>
        {contextApp === "terminal" ? <>
          <button role="menuitem" type="button" onClick={() => newTerminal()}>New Terminal Window</button>
          {terminals.length > 0 && <><hr />{terminals.map((item) => <button role="menuitem" key={item.id} type="button" onClick={() => focusWindow(item.id)}>{managedWindowTitle(item)}{item.minimized ? " — Minimized" : ""}</button>)}<hr />
            <button role="menuitem" type="button" onClick={() => { dispatch({ type: "hide-terminals" }); dismissFlyout(); }}>Hide All Terminals</button>
            <button role="menuitem" type="button" onClick={() => { dispatch({ type: "close-terminals" }); dismissFlyout(); }}>Close All Terminals</button>
          </>}
        </> : contextApp ? <>
          <button role="menuitem" type="button" onClick={() => launch(contextApp)}>{contextApp === "spotify" ? "Open Spotify Profile ↗" : `Open ${appName(contextApp)}`}</button>
          {contextApp === "help" && helpWindow && <><button role="menuitem" type="button" onClick={() => minimize("help")}>Hide Help</button><button role="menuitem" type="button" onClick={() => closeWindow("help")}>Close Help</button></>}
          {contextApp === "notes" && notesWindow && <><button role="menuitem" type="button" onClick={() => minimize("notes")}>Hide Notes</button><button role="menuitem" type="button" onClick={() => closeWindow("notes")}>Close Notes</button></>}
          {contextApp === "f1" && f1Window && <><button role="menuitem" type="button" onClick={() => minimize("f1")}>Hide F1 Forecast</button><button role="menuitem" type="button" onClick={() => closeWindow("f1")}>Close F1 Forecast</button></>}
          {contextApp === "recycle" && trash && <button role="menuitem" type="button" onClick={() => closeWindow("recycle")}>Close Trash</button>}
        </> : <>
          <button role="menuitem" type="button" onClick={() => newTerminal()}>New Terminal Window</button>
          <button role="menuitem" type="button" onClick={() => toggleFlyout("search")}>Spotlight…</button><hr />
        </>}
        <button role="menuitem" type="button" disabled={!canToggleDesktop} onClick={showDesktop}>{desktopToggleLabel}</button>
      </section>}

      <div className="mac-menubar-reveal" aria-hidden="true" />
      <header className="mac-menu-bar">
        <nav className="mac-app-menus" aria-label="Application menus">
          <button type="button" className={"mac-apple-menu " + (flyout === "apple" ? "is-selected" : "")} aria-label="Apple menu" aria-haspopup="menu" aria-expanded={flyout === "apple"}
            ref={(button) => { if (button) menuButtons.current.set("apple", button); }} onClick={() => toggleFlyout("apple")}><img src="/macos-icons/apple.png" alt="" draggable={false} /></button>
          {menuButton("app", activeApp)}
          {menuButton("shell", activeApp === "Terminal" ? "Shell" : "Apps")}
          {activeApp === "Terminal" && menuButton("edit", "Edit")}
          {menuButton("window", "Window")}
          <button type="button" onClick={() => launch("help")}>Help</button>
        </nav>
        <nav className="mac-status-menus" aria-label="Menu bar status">
          <button type="button" className="mac-mission-control" aria-label="Mission Control" title="Mission Control" ref={(button) => { if (button) menuButtons.current.set("tasks", button); }} onClick={() => toggleFlyout("tasks")}><WindowMultiple24Regular /></button>
          <span className="mac-network" role="img" title={online ? "Internet access" : "No internet access"} aria-label={online ? "Internet access" : "No internet access"}><Wifi120Regular />{!online && <b>×</b>}</span>
          <button type="button" aria-label="Spotlight" title="Spotlight (Ctrl+Space)" ref={(button) => { if (button) menuButtons.current.set("search", button); }} onClick={() => toggleFlyout("search")}><Search24Regular /></button>
          <button type="button" className="mac-clock" aria-label="Date and time" aria-expanded={flyout === "calendar"} title={clock ? clock.fullDate + " · " + clock.zone : "Pacific time"}
            ref={(button) => { if (button) menuButtons.current.set("calendar", button); }} onClick={() => toggleFlyout("calendar")}><span>{dateLabel}</span><span>{clock?.time ?? "--:--"}</span></button>
        </nav>
      </header>
      <MacDock nearBottom={nearDock} onLaunch={launch} onExternalLaunch={() => launchAfterPause("spotify", () => {})} onAppContextMenu={openContext} running={[...new Set(windows.map((item) => item.app))]} />
      <div ref={busyCursor} className="mac-loading-cursor" aria-hidden="true"><i /></div>
      <span className="mac-launch-status" role="status">{pendingApps ? "Opening application…" : ""}</span>
    </section>
  </main>;
}
