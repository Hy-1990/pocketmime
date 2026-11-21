// Upstream components: React Bits by David Haz. See web/licenses/react-bits.txt.
import { useRef, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import PillNav from "./components/PillNav";
import { HugeiconsIcon } from "@hugeicons/react";
import { Home01Icon, Folder01Icon, PencilEdit01Icon } from "@hugeicons/core-free-icons";
import GooeyNav from "./components/GooeyNav";
import Folder from "./components/Folder";
import Stepper, { Step } from "./components/Stepper";

const theme = () => document.documentElement.dataset.theme;
const zh = () => document.documentElement.lang.startsWith("zh");

const menus = new WeakMap();
export function menu(host, items, active, onChange) {
  if (!menus.has(host)) menus.set(host, createRoot(host));
  menus
    .get(host)
    .render(
      <GooeyNav
        items={items.map((label) => ({ label }))}
        activeIndex={active}
        onChange={onChange}
        size="sm"
        theme={theme()}
        frame
        hoverEffect
        color={theme() === "dark" ? "#dbe9d7" : "#24364c"}
      />,
    );
}

const destinations = [
  ["homeLink", "#/", "Home", "首页", Home01Icon],
  ["projectsLink", "#/projects", "Projects", "我的项目", Folder01Icon],
  ["createLink", "#/new", "Create", "创作", PencilEdit01Icon],
];

export function renderDestinations(host, path, lang, appearance) {
  if (!menus.has(host)) menus.set(host, createRoot(host));
  const href = path === "/" || path === "/new" ? "#" + path : "#/projects";
  const items = destinations.map(([id, href, en, zh, glyph]) => ({
    id, href, label: lang === "zh" ? zh : en,
    icon: <HugeiconsIcon icon={glyph} size={16} strokeWidth={1.7} aria-hidden="true" />,
  }));
  menus.get(host).render(
    <PillNav items={items} activeHref={href} theme={appearance} collapse="never"
      size="sm" intro={false} surface="glass" itemStyle="plain" hoverEffect="fill" indicator="dot"
      style={{
        "--pn-surface": "var(--glass-fill)",
        "--pn-edge": "var(--glass-soft)",
        "--pn-rim": "var(--glass-edge)",
        "--pn-shadow": "none",
        "--pn-text": "var(--mute)",
        "--pn-strong": "var(--fg)",
        "--pn-pill": "color-mix(in srgb, var(--inset) 88%, var(--fg))",
        "--pn-pill-ink": "var(--fg)",
        "--pn-dot": "var(--accent)",
        "--pn-ring": "var(--fg)",
      }}
      ariaLabel={lang === "zh" ? "页面导航" : "Page navigation"} />
  );
}

// Persist the hue across routes and sorting by deriving it from the project ID.
const folderPalette = [
  { light: "#ff9942", dark: "#ffad58" },
  { light: "#fb537e", dark: "#ff7198" },
  { light: "#37bbad", dark: "#52d4ba" },
  { light: "#9b79f1", dark: "#b69aff" },
  { light: "#eebe32", dark: "#ffd457" },
  { light: "#538be8", dark: "#78a9ff" },
  { light: "#a1c941", dark: "#bcdf60" },
  { light: "#e96742", dark: "#ff845d" },
];

class ProjectFolder extends HTMLElement {
  connectedCallback() {
    this.compact = matchMedia("(max-width: 680px)");
    this.resize = () => this.draw();
    this.compact.addEventListener("change",this.resize);
    this.root = createRoot(this);
    this.items = [
      {
        image: "/api/projects/" + this.dataset.id + "/actor.png",
        alt: this.dataset.name,
      },
    ];
    this.draw();
    this.observer = new MutationObserver(() => this.draw());
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    this.visible = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        this.visible.disconnect();
        this.load();
      }
    });
    this.visible.observe(this);
  }
  async load() {
    try {
      const res = await fetch("/api/projects/" + this.dataset.id);
      if (!res.ok) return;
      const pack = await res.json();
      if (!this.isConnected) return;
      const ready = pack.items.filter((item) => item.confirmed).slice(0, 1);
      if (ready.length) {
        this.items = ready.map((item) => ({
          image: "/api/items/" + item.id + "/sticker.gif?v=" + item.confirmed,
          alt: item.caption,
        }));
        this.draw();
      }
    } catch {
      /* Keep the cover when preview images are unavailable. */
    }
  }
  draw() {
    this.root.render(
      <Folder
        items={this.items}
        variant="glass"
        color={folderPalette[(Number(this.dataset.id) - 1) % folderPalette.length][theme() === "dark" ? "dark" : "light"]}
        size={this.compact.matches ? 0.52 : 0.82}
        layout="stack"
        tilt={0}
        intro={false}
        theme={theme()}
        label={zh() ? "表情包" : "Stickers"}
        draggable={false}
        zoomOnClick={true}
      />,
    );
  }
  disconnectedCallback() {
    this.compact.removeEventListener("change",this.resize);
    this.visible?.disconnect();
    this.observer?.disconnect();
    this.root.unmount();
  }
}
customElements.define("pm-folder", ProjectFolder);

function FormPane({ element }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (element) ref.current.replaceChildren(element);
  }, [element]);
  return <div ref={ref} />;
}
class StepPanel extends HTMLElement {
  connectedCallback() {
    if (this.root) return;
    this.root = createRoot(this);
    this.forms = [];
    this.observer = new MutationObserver(() => {
      if (this.config) this.paint();
    });
    this.observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
  disconnectedCallback() {
    queueMicrotask(() => {
      if (!this.isConnected) {
        this.observer.disconnect();
        this.root.unmount();
        this.root = null;
      }
    });
  }
  paint() {
    const { labels, step, back } = this.config;
    this.root.render(
      <Stepper
        step={step + 1}
        width="100%"
        radius={18}
        frame={false}
        theme={theme()}
        linear
        showFooter={false}
        disableStepIndicators={!back}
        onStepChange={(n) => {
          if (n - 1 < step) back?.(n - 1);
        }}
      >
        {labels.map((label, i) => (
          <Step key={i} title={label}>
            <FormPane element={this.forms[i]} />
          </Step>
        ))}
      </Stepper>,
    );
  }
}
customElements.define("pm-stepper", StepPanel);
export function renderSteps(host, element, config) {
  if (host.config?.step !== config.step) {
    const old = host.forms[host.config?.step];
    if (old) {
      old.inert = true;
      old.querySelectorAll("[id]").forEach((x) => x.removeAttribute("id"));
    }
  }
  host.forms[config.step] = element;
  host.config = config;
  flushSync(() => host.paint());
}
