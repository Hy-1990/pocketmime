import "./select";
// React Bits Pattern Waves by David Haz; see web/licenses/react-bits.txt.
import { createRoot } from "react-dom/client";
import PatternWaves from "./PatternWaves";
const root = createRoot(document.getElementById("pattern-field"));
const motion = matchMedia("(prefers-reduced-motion: reduce)");
function render() {
  const dark = document.documentElement.dataset.theme === "dark";
  root.render(
    <PatternWaves
      key={String(motion.matches)}
      preset="silk"
      paused={motion.matches}
      color={dark ? "#758396" : "#9aaabd"}
      backgroundColor={dark ? "#0d111c" : "#edf0f5"}
    />,
  );
}
new MutationObserver(render).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ["data-theme"],
});
motion.addEventListener("change", render);
render();
export {menu,renderSteps,renderDestinations} from "./controls";
import "./specular";
