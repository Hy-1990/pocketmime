// Use the upstream rim shader on the actual button/link, preserving focus,
// native downloads and user-initiated file picker behavior.
import {createRoot} from "react-dom/client";
import SpecularButton from "./components/SpecularButton";

let active,root,layer;
function detach(){
  if(!active)return;
  root.unmount();
  layer.remove();
  active=null;
}
function attach(target){
  if(target===active)return;
  detach();
  if(!target?.isConnected||target.matches(":disabled"))return;
  active=target;
  layer=document.createElement("span");
  layer.className="action-rim";layer.setAttribute("aria-hidden","true");
  target.append(layer);
  root=createRoot(layer);
  const dark=document.documentElement.dataset.theme==="dark";
  root.render(<SpecularButton host={target} radius={10} lineColor={dark?"#e3f4ff":"#6392a4"} baseColor={dark?"#73899c":"#859cab"} />);
}
function reconcile(){attach(document.querySelector("[data-specular]:hover")||document.activeElement?.closest("[data-specular]"));}
document.addEventListener("pointerover",event=>attach(event.target.closest?.("[data-specular]")||document.activeElement?.closest("[data-specular]")));
document.addEventListener("focusin",event=>attach(event.target.closest?.("[data-specular]")));
document.addEventListener("focusout",()=>queueMicrotask(reconcile));
document.documentElement.addEventListener("pointerleave",()=>attach(document.activeElement?.closest("[data-specular]")));
new MutationObserver(()=>{if(active&&!active.isConnected)detach()}).observe(document.body,{childList:true,subtree:true});
