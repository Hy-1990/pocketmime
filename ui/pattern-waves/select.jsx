// Preserve the form's value/change contract while React Bits owns the interaction.
import { createRoot } from "react-dom/client";
import GlideSelect from "./components/GlideSelect";

class PocketSelect extends HTMLElement {
  connectedCallback() {
    if (this.root) return;
    this.mount = document.createElement("span");
    this.append(this.mount);
    this.root = createRoot(this.mount);
    this.observer = new MutationObserver((records) => {
      if (records.some((record) => !this.mount.contains(record.target)))
        this.render();
    });
    this.observer.observe(this, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["disabled", "selected", "value"],
    });
    this.render();
  }
  disconnectedCallback() {
    queueMicrotask(() => {
      if (!this.isConnected && this.root) {
        this.observer.disconnect();
        this.root.unmount();
        this.mount.remove();
        this.root = null;
      }
    });
  }
  get options() {
    return Array.from(this.children).filter(
      (node) => node.tagName === "OPTION",
    );
  }
  get value() {
    return (
      this.chosen ??
      (this.options.find((o) => o.hasAttribute("selected")) ?? this.options[0])
        ?.value ??
      ""
    );
  }
  set value(v) {
    this.chosen = String(v);
    this.render();
  }
  get selectedOptions() {
    return this.options.filter((o) => o.value === this.value);
  }
  get disabled() {
    return this.hasAttribute("disabled");
  }
  set disabled(v) {
    this.toggleAttribute("disabled", v);
  }
  render() {
    if (!this.root) return;
    this.root.render(
      <GlideSelect
        options={this.options.map((o) => ({
          value: o.value,
          label: o.textContent,
        }))}
        value={this.value}
        disabled={this.disabled}
        ariaLabel={
          this.getAttribute("aria-label") ||
          this.closest("label")?.querySelector("span")?.textContent ||
          this.id
        }
        accentColor="var(--fg)"
        textColor="var(--fg)"
        surfaceColor="var(--menu-surface)"
        highlightColor="var(--inset)"
        onChange={(v) => {
          this.value = v;
          this.dispatchEvent(new Event("change", { bubbles: true }));
        }}
      />,
    );
  }
}
customElements.define("pm-select", PocketSelect);
