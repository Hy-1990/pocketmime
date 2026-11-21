import { menu, renderSteps, renderDestinations } from "./pattern-waves.js";
import { pixelStage } from "./pixel-transition.js";
const $ = (s) => document.querySelector(s);
const main = $("#main"),
  dialog = $("#dialog"),
  panel = $("#panel");
let lang =
  localStorage.pmLang || (navigator.language.startsWith("zh") ? "zh" : "en");
let theme =
  localStorage.pmTheme ||
  (matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light");
const t = (en, zh) => (lang === "zh" ? zh : en);
const esc = (x) =>
  String(x).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const motions = ["peek", "nod", "shake", "jump", "sway", "sink"];
const motionName = (m) =>
  t(
    {
      peek: "Peek",
      nod: "Nod",
      shake: "Shiver",
      jump: "Jump",
      sway: "Sway",
      sink: "Sink",
    }[m],
    {
      peek: "探头",
      nod: "点头",
      shake: "发抖",
      jump: "跳起",
      sway: "摇摆",
      sink: "缩回",
    }[m],
  );
const samples = [
      "On it",
      "Still running",
      "Noted",
      "Don’t touch it",
      "Never mind",
      "Clocking out",
      "One moment",
      "Wow",
      "Yes please",
      "All good",
      "Again?",
      "Good luck",
      "Almost there",
      "Why me?",
      "Bye",
    ];
const isEnglishCaption = (s) => /^[ -~’‘“”…–—]+$/.test(s) && /[a-z]/i.test(s);
const presets = (n, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({
    caption: samples[(i + offset) % 15],
    motion: motions[(i + offset) % 6],
    speed: 1,
  }));
const errors = {
  caption_language: ["Use an English caption for the sticker.", "请为表情填写英文配字。"],
  nokey: [
    "Set your DeepSeek key in Settings first.",
    "请先在设置中填写 DeepSeek 密钥。",
  ],
  auth: ["DeepSeek rejected the key.", "DeepSeek 拒绝了此密钥。"],
  ai_unavailable: [
    "DeepSeek is unavailable. Retry or use presets.",
    "DeepSeek 暂时不可用，可重试或使用预设。",
  ],
  ai_format: [
    "DeepSeek returned incomplete ideas. Please retry.",
    "DeepSeek 返回的数据不完整，请重试。",
  ],
  model: [
    "Check the optional model dependencies, files, and sampler connection in the README.",
    "请按 README 核对模型依赖、文件和采样器下载连接。",
  ],
  minimum: [
    "Keep at least one sticker in the project.",
    "项目至少保留一个表情。",
  ],
  limit: ["A pack holds 1–15 stickers.", "每个项目支持 1～15 个表情。"],
  input: ["Check the text length and options.", "请检查文字长度和选项。"],
  image: [
    "Choose a valid PNG or JPEG under 5 MB.",
    "请选择 5 MB 以内有效的 PNG 或 JPG。",
  ],
  static: [
    "No visible movement. Try another image or motion.",
    "没有可见的动作，请更换图片或动作。",
  ],
  409: [
    "This project changed in another tab. Reload before editing.",
    "项目已在其他标签页更新，请刷新后再编辑。",
  ],
};
function message(err) {
  const v = errors[err.message];
  return v
    ? t(...v)
    : t(
        "Could not complete the request. Please retry.",
        "操作未完成，请重试。",
      );
}
let timer;
function notice(text) {
  $("#notice").textContent = text;
  clearTimeout(timer);
  timer = setTimeout(() => ($("#notice").textContent = ""), 5000);
}
async function api(url, method = "GET", data, blob = false) {
  const opts = { method, headers: { "X-PocketMime": "local" } };
  if (data !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(data);
  }
  const r = await fetch("/api/" + url, opts);
  if (!r.ok) {
    let e = await r.json().catch(() => ({}));
    throw Error(e.error || String(r.status));
  }
  return blob ? r.blob() : r.json();
}
function action(id, fn, pendingLabel) {
  const el = $(id);
  if (!el) return;
  const label = el.firstChild;
  el.onclick = async (event) => {
    event.preventDefault();
    if (el.disabled) return;
    el.disabled = true;
    const idleLabel = label?.textContent;
    if (pendingLabel) {
      label.textContent = pendingLabel;
      el.setAttribute("aria-busy", "true");
    }
    try {
      await fn();
    } catch (err) {
      const msg = message(err);
      const target = dialog.open
        ? dialog.querySelector(".status")
        : main.querySelector(".status");
      if (target) target.textContent = msg;
      notice(msg);
    } finally {
      if (pendingLabel) {
        label.textContent = idleLabel;
        el.removeAttribute("aria-busy");
      }
      el.disabled = false;
    }
  };
}
function markDestination(path) {
  renderDestinations($(".destinations"), path, lang, theme);
}
function nav() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.documentElement.dataset.theme = theme;
  if (!$("#languageMenu"))
    $("#nav").innerHTML =
      `<a class="brand" href="#/" aria-label="PocketMime"><img class="brand-frog" src="/frog.png" alt=""><span>PocketMime</span></a><div class="destinations"></div><div class="nav-options"><div id="languageMenu" role="group"></div><div id="appearanceMenu" role="group"></div><button data-specular id="settings"></button></div>`;
  $("#nav").setAttribute("aria-label", t("Main navigation", "主导航"));
  markDestination(location.hash.slice(1) || "/");
  $("#languageMenu").setAttribute("aria-label", t("Language", "语言"));
  $("#appearanceMenu").setAttribute("aria-label", t("Appearance", "外观"));
  $("#settings").textContent = t("Settings", "设置");
  menu(
    $("#languageMenu"),
    ["中文", "EN"],
    lang === "zh" ? 0 : 1,
    async (index) => {
      lang = localStorage.pmLang = index === 0 ? "zh" : "en";
      nav();
      await route();
    },
  );
  menu(
    $("#appearanceMenu"),
    [t("Light", "日间"), t("Dark", "夜间")],
    theme === "light" ? 0 : 1,
    (index) => {
      theme = localStorage.pmTheme = index === 0 ? "light" : "dark";
      nav();
    },
  );
  action("#settings", settings);
}
function modal(html) {
  panel.innerHTML = html;
  if (!dialog.open) dialog.showModal();
}
async function settings() {
  const state = await api("settings");
  modal(`<div class="bar"><h2>${t("Settings", "设置")}</h2><button data-specular id="close">${t("Close", "关闭")}</button></div>
 <label class="field"><span>${t("Language", "界面语言")}</span><pm-select id="language"><option value="en">English</option><option value="zh">简体中文</option></pm-select></label>
 <label class="field"><span>${t("Appearance", "外观")}</span><pm-select id="theme"><option value="light">${t("Light", "日间")}</option><option value="dark">${t("Dark", "夜间")}</option></pm-select></label>
 <label class="field"><span>DeepSeek API Key · ${state.configured ? t("configured", "已配置") : t("optional", "可选")}</span><input id="key" type="password" autocomplete="off" placeholder="${state.configured ? "••••••••" : "sk-…"}"></label>
 <small>${t("The key stays in server memory until restart. DeepSeek receives text for character prompts, reactions and animation storyboards.", "密钥仅保存在服务内存中，重启后清除。DeepSeek 接收文字，用于角色提示词、表情方案及动画分镜。")}</small>
 <p class="status"></p><div class="actions"><button data-specular class="primary" id="save">${t("Save settings", "保存设置")}</button>${state.configured ? `<button data-specular id="forget">${t("Clear key", "清除密钥")}</button>` : ""}</div>`);
  $("#language").value = lang;
  $("#theme").value = theme;
  action("#close", () => dialog.close());
  action("#forget", async () => {
    await api("settings", "POST", { key: "" });
    await settings();
  });
  action("#save", async () => {
    if ($("#key").value.trim())
      await api("settings", "POST", { key: $("#key").value.trim() });
    const changed = lang !== $("#language").value;
    lang = localStorage.pmLang = $("#language").value;
    theme = localStorage.pmTheme = $("#theme").value;
    dialog.close();
    nav();
    if (changed) await route();
  });
}
let scene = "on-it",
  epoch = 0,
  active = 0,
  project = null,
  newState = null,
  pendingSave = Promise.resolve();
function projectCards(list) {
  if (!list.length) return `<p class="empty">${t("Your first pack will appear here.", "创建后，你的表情包会出现在这里。")}</p>`;
  const cards = list.map(p => {
    const count = t(`${p.count} sticker${p.count === 1 ? "" : "s"}`, `${p.count} 个表情`);
    const status = p.ready === p.count && p.count > 0
      ? t("Ready", "已完成")
      : t(`${p.ready} ready`, `${p.ready} 个已完成`);
    return `<article class="card project-card">
      <pm-folder data-id="${p.id}" data-name="${esc(p.name)}"></pm-folder>
      <div class="project-info">
        <h3 title="${esc(p.name)}">${esc(p.name)}</h3>
        <small>${count} · ${status}</small>
        <a data-specular class="button project-open" href="#/p/${p.id}" aria-label="${esc(t("Open ", "打开") + p.name)}">${t("Open", "打开")}</a>
      </div>
    </article>`;
  });
  return `<div class="project-shelf">${cards.join("")}</div>`;
}
async function downloadCurrentPack(pid) {
  await pendingSave;
  const pack = await api("projects/" + pid);
  for (const item of pack.items) {
    if (item.confirmed !== item.version) {
      await api("items/" + item.id + "/confirm", "POST", {version: item.version});
    }
  }
  const versions = pack.items.map(item => item.id + "-" + item.version).join(",");
  const blob = await api("projects/" + pid + "/stickers.zip?versions=" + versions, "GET", undefined, true);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "pocketmime-" + pid + ".zip";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 60000);
}

async function route() {
  await pendingSave.catch(() => {});
  const id = ++epoch;
  const path = location.hash.slice(1) || "/";
  markDestination(path);
  try {
    if (path.startsWith("/pack/")) {
      const pack = await api("projects/" + Number(path.split("/")[2]));
      if (id !== epoch) return;
      const files = pack.items.filter((i) => i.confirmed === i.version);
      if (files.length !== pack.items.length || !files.length) {
        location.replace("#/p/" + pack.id);
        return;
      }
      main.innerHTML = `<section class="wizard pack-result"><div class="wizard-top"></div><div class="wizard-body"><h1>${t("Pack ready", "整套动图已生成")} · ${files.length} GIF</h1><p class="pack-title">${esc(pack.name)}</p><img class="preview" id="resultGif" src="/api/items/${files[0].id}/sticker.gif" alt="${t("Animated sticker", "表情动图")}"><figure class="pose-strip" hidden><figcaption></figcaption><img alt="${t("Rendered poses in playback order", "按播放顺序排列的实际画面")}"></figure><pm-select aria-label="${t("Preview sticker", "预览表情")}" id="resultSelect">${files.map((v, i) => `<option value="${v.id}">${i + 1}. ${esc(v.caption)}</option>`).join("")}</pm-select></div><div class="wizard-foot"><a data-specular class="button" href="#/p/${pack.id}">${t("Edit stickers", "编辑表情")}</a><button data-specular class="primary" id="exportZip">${t("Download pack ZIP", "下载整套 ZIP")}</button></div></section>`;
      mountStepPanel(null, 3, null);
      action("#exportZip", () => downloadCurrentPack(pack.id), t("Packing…", "打包中…"));
      function showFrames(item) {
        const strip = main.querySelector(".pose-strip");
        strip.hidden = !item.director;
        if (!item.director) return;
        strip.querySelector("figcaption").textContent = item.director === "deepseek"
          ? t("DeepSeek storyboard · Tessera keyframes", "DeepSeek 分镜 · Tessera 关键帧")
          : item.director === "preset" ? t("Preset storyboard · Tessera keyframes", "预设分镜 · Tessera 关键帧")
          : t("Local puppet poses", "本地基础姿态");
        strip.querySelector("img").src = `/api/items/${item.id}/frames.png?v=${item.confirmed}`;
      }
      showFrames(files[0]);
      $("#resultSelect").onchange = (e) => {
        const selected = files.find(item => String(item.id) === e.target.value);
        $("#resultGif").src = "/api/items/" + selected.id + "/sticker.gif";
        showFrames(selected);
      };
      return;
    }
    if (path.startsWith("/p/")) {
      const p = await api("projects/" + Number(path.split("/")[2]));
      if (id !== epoch) return;
      project = p;
      active = p.items.find((i) => i.id === active)?.id || p.items[0].id;
      workspace();
      return;
    }
    if (path === "/new") {
      const model = await api("model-status");
      if (id === epoch) newProject(model.available);
      return;
    }
    const list = await api("projects");
    if (id !== epoch) return;
    if (path === "/projects") {
      main.innerHTML = `<section class="page"><div class="bar"><h1>${t("My projects", "我的项目")}</h1><a data-specular href="#/new" class="button primary">${t("New project", "新建项目")}</a></div>${projectCards(list)}</section>`;
      return;
    }
    const demos = [["on-it", "On it"], ["noted", "Noted"], ["clocking-out", "Clocking out"]];
    main.innerHTML = `<section class="hero"><div class="hero-copy"><h1>${t("Animated<br>sticker studio", "动态表情<br>工作室")}</h1><p>${t("Start with an idea or a reference image. Direct your character’s reactions and export a pack of looping GIFs.", "从文字创意或参考图开始，让同一个角色演出不同反应，最后导出一整套循环 GIF。")}</p><div class="actions"><a data-specular class="button primary" href="#/new">${t("New project", "新建项目")}</a><a data-specular class="button" href="#/projects">${t("My projects", "我的项目")}</a></div></div>
    <section class="conversation demo-pack" aria-label="${t("Fox sticker pack preview", "狐狸表情包预览")}">
      <div class="demo-source"><img src="/demo/fox.png" alt=""><div><small>${t("Reference character", "参考角色")}</small><strong>${t("Little fox", "小狐狸")}</strong></div></div>
      <div class="demo-playback"><img id="heroGif" src="/demo/${scene}.gif" alt=""></div>
      <div class="demo-frames"><small>${t("Four keyframes", "四帧分镜")}</small><img id="heroFrames" src="/demo/${scene}-frames.png" alt="${t("The four poses in playback order", "按播放顺序排列的四个姿态")}"></div>
      <div class="reactions" role="group" aria-label="${t("Choose a reaction", "选择表情")}">${demos.map(([key, label]) => `<button data-scene="${key}">${label}</button>`).join("")}</div>
    </section></section><section class="section"><div class="bar"><h2>${t("Recent projects", "最近项目")}</h2><a data-specular class="button" href="#/projects">${t("View all", "查看全部")}</a></div>${projectCards(list.slice(0, 3))}</section>`;
    const swap = pixelStage($("#heroGif"));
    function show(m, animate = true) {
      scene = m;
      swap(`/demo/${m}.gif`, animate);
      $("#heroGif").alt = t("Animated fox sticker", "狐狸动图") + " · " + demos.find(([key]) => key === m)[1];
      $("#heroFrames").src = `/demo/${m}-frames.png`;
      main
        .querySelectorAll("[data-scene]")
        .forEach((el) =>
          el.setAttribute("aria-pressed", el.dataset.scene === m),
        );
    }
    main
      .querySelectorAll("[data-scene]")
      .forEach((el) => (el.onclick = () => show(el.dataset.scene)));
    show(scene, false);
  } catch (e) {
    notice(message(e));
  }
}
const localScenes = () =>
  t(
    [
      "Someone asks for help. Peek out slowly.",
      "A teammate asks for progress. Nod twice.",
      "A message catches you by surprise. Shiver quickly.",
      "The fix worked. Jump with delight.",
      "Someone suggests another meeting. Sway reluctantly.",
      "Time to leave. Sink out of sight.",
    ],
    [
      "有人求助时，慢慢探头看看。",
      "被问到进度时，点头回应。",
      "看到意外消息时，快速发抖。",
      "修复成功时，高兴地跳起来。",
      "听说又要开会时，左右摇摆。",
      "下班道别时，慢慢缩回画面。",
    ],
  );
function interpret(item) {
  const text = item.prompt.toLowerCase();
  const patterns = [
    /探头|探出|peek/,
    /点头|nod/,
    /发抖|抖动|颤|shiver|shake/,
    /跳|蹦|jump|bounce/,
    /摇摆|摇晃|sway|rock side/,
    /缩回|沉下|下沉|sink|retreat/,
  ];
  const motion = patterns.findIndex((rx) => rx.test(text));
  if (motion >= 0) item.motion = motions[motion];
  if (/慢|slow/.test(text)) item.speed = 0.75;
  else if (/快|quick|fast/.test(text)) item.speed = 1.5;
}
function mountStepPanel(previous, step, back) {
  const host = previous || document.createElement("pm-stepper");
  const body = main.querySelector(".wizard-body");
  main.querySelector(".wizard-top").replaceWith(host);
  renderSteps(host, body, {
    step,
    back,
    labels: [
      t("Idea", "创意"),
      t("Character", "角色"),
      t("Reactions", "表情方案"),
      t("GIF pack", "整包输出"),
    ],
  });
}
function newProject(hasModel) {
  const d = (newState ||= {
    step: 0,
    brief: "",
    ref: "",
    actors: [],
    selected: 0,
    shots: [],
    index: 0,
    name: "",
    busy: false,
  });
  function draw() {
    if (location.hash !== "#/new") return;
    const actor = d.actors[d.selected]?.url || "/frog.png";
    const shot = d.shots[d.index];
    const chooser =
      d.step === 1
        ? `<div class="actor-options">${d.actors.map((v, i) => `<button data-actor="${i}" aria-pressed="${d.selected === i}" aria-label="${esc(v.label)}"><img src="${esc(v.url)}" alt=""><span>${esc(v.label)}</span></button>`).join("")}</div>`
        : "";
    const fields =
      d.step === 0
        ? `<label class="field"><span>${t("What would you like to make?", "想做一套什么表情？")}</span><textarea id="idea" maxlength="500" placeholder="${t("A sleepy capybara on customer support", "一只在开发群值班、说话很淡定的水豚")}">${esc(d.brief)}</textarea></label><div class="field"><span>${t("Reference image (optional)", "参考图（可选）")}</span><div class="upload-row"><input id="reference" type="file" accept="image/png,image/jpeg" hidden><button data-specular type="button" id="chooseRef">${d.ref?t("Replace image","更换图片"):t("Choose image","选择图片")}</button>${d.ref?`<img src="${esc(d.ref)}" alt=""><span class="upload-name" title="${esc(d.refName)}">${esc(d.refName)}</span><button data-specular id="clearRef">${t("Remove","移除")}</button>`:`<small>PNG / JPG · 5 MB</small>`}</div></div>`
        : d.step === 1
          ? `<div class="chosen-actor"><img src="${esc(actor)}" alt="${t("Selected character", "选中的角色")}"></div>${chooser}`
          : `<div class="reaction-layout"><section class="reaction-picker" aria-label="${t("Stickers", "表情列表")}"><div class="reaction-tools"><span>${t("Stickers", "表情")} · ${d.shots.length}/15</span><button data-specular id="plus" ${d.shots.length === 15 ? "disabled" : ""}>${t("Add", "新增")}</button><button data-specular id="minus" ${d.shots.length === 1 ? "disabled" : ""}>${t("Remove", "删除")}</button></div><div class="reaction-grid">${d.shots.map((item, i) => `<button type="button" data-shot="${i}" aria-pressed="${i === d.index}" title="${esc(item.caption || t("Untitled", "未命名"))}"><small>${i+1}</small><span>${esc(item.caption || t("Untitled", "未命名"))}</span></button>`).join("")}</div></section><div class="reaction-fields">
    <label class="field"><span>${t("Reaction description", "表情描述")}</span><textarea maxlength="160" id="desc">${esc(shot.prompt)}</textarea></label>
    <div class="shot-controls"><label class="field"><span>${t("English caption", "英文配字")}</span><input id="line" maxlength="32" value="${esc(shot.caption)}"></label><label class="field"><span>${t("Motion", "动作")}</span><pm-select id="move">${motions.map((m) => `<option value="${m}" ${m === shot.motion ? "selected" : ""}>${motionName(m)}</option>`).join("")}</pm-select></label><label class="field"><span>${t("Speed", "速度")}</span><pm-select id="pace">${[0.75, 1, 1.5].map((v) => `<option value="${v}" ${v === shot.speed ? "selected" : ""}>${v}×</option>`).join("")}</pm-select></label></div></div></div>`;
    const previous = main.querySelector("pm-stepper");
    main.innerHTML = `<section class="wizard"><div class="wizard-top"></div><div class="wizard-body"><div class="wizard-heading">${d.step === 2 ? `<img src="${esc(actor)}" alt="">` : ""}<h1>${[t("Your idea", "写下创意"), t("Choose your character", "确认角色"), t("Edit reactions", "编辑表情")][d.step]}</h1></div>${fields}</div><div class="wizard-foot"><p class="status" role="status"></p><div class="actions">${d.step ? `<button data-specular id="back">${t("Previous step", "上一步")}</button>` : ""}<button data-specular class="primary" id="next">${[t("Prepare characters", "准备角色"), t("Confirm and plan 6 stickers", "确认角色，拟定 6 条方案"), t("Generate GIF pack", "生成整套动图")][d.step]}</button></div></div></section>`;
    mountStepPanel(previous, d.step, (n) => {
      if (!d.busy) {
        d.step = n;
        draw();
      }
    });
    if (d.step === 0) {
      $("#idea").oninput = (e) => (d.brief = e.target.value);
      $("#chooseRef").onclick=()=>$("#reference").click();
      $("#reference").onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (
          !["image/jpeg", "image/png"].includes(file.type) ||
          file.size > 5 * 1024 * 1024
        ) {
          notice(message(Error("image")));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => {
          d.refName=file.name;
          d.ref = reader.result;
          draw();
        };
        reader.onerror = () => notice(message(Error("image")));
        reader.readAsDataURL(file);
      };
      action("#clearRef", () => {
        d.refName="";
        d.ref = "";
        draw();
      });
    } else if (d.step === 1) {
      main.querySelectorAll("[data-actor]").forEach(
        (el) =>
          (el.onclick = () => {
            d.selected = +el.dataset.actor;
            draw();
          }),
      );
    } else {
      const grid = main.querySelector(".wizard-body:not([inert]) .reaction-grid");
      grid.onclick = (event) => {
        const button = event.target.closest("[data-shot]");
        if (!button || button.disabled) return;
        d.index = Number(button.dataset.shot);
        draw();
        main.querySelector('.wizard-body:not([inert]) [data-shot][aria-pressed="true"]').focus({preventScroll:true});
      };
      $("#desc").oninput = (e) => {
        shot.prompt = e.target.value;
        interpret(shot);
        $("#move").value = shot.motion;
        $("#pace").value = shot.speed;
      };
      $("#line").oninput = (e) => {
        shot.caption = e.target.value;
        const selected = grid.querySelector('[aria-pressed="true"]');
        selected.title = shot.caption || t("Untitled", "未命名");
        selected.querySelector("span").textContent = selected.title;
      };
      $("#move").onchange = (e) => (shot.motion = e.target.value);
      $("#pace").onchange = (e) => (shot.speed = Number(e.target.value));
      action("#plus", () => {
        if (d.shots.length >= 15) return;
        d.shots.push({ caption: "", prompt: "", motion: "peek", speed: 1 });
        d.index = d.shots.length - 1;
        draw();
        $("#desc").focus();
      });
      action("#minus", () => {
        if (d.shots.length <= 1) return;
        d.shots.splice(d.index, 1);
        d.index = Math.min(d.index, d.shots.length - 1);
        draw();
      });
    }
    action("#back", () => {
      d.step--;
      draw();
    });
    const lock = (on) => {
      main.querySelector(".wizard")?.toggleAttribute("data-working", on);
      main
        .querySelectorAll(
          ".wizard input,.wizard textarea,.wizard pm-select,.wizard button",
        )
        .forEach((el) => {
          if (on && !el.disabled) {
            el.dataset.lock = "true";
            el.disabled = true;
          } else if (!on && el.dataset.lock) {
            el.disabled = false;
            delete el.dataset.lock;
          }
        });
    };
    const pendingLabel = [
      t("Preparing…", "准备角色中…"),
      t("Planning…", "拟定方案中…"),
      t("Rendering GIFs…", "合成动图中…"),
    ][d.step];
    action("#next", async () => {
      if (d.busy) return;
      d.busy = true;
      lock(true);
      try {
        if (d.step === 0) {
          if (!d.brief.trim()) throw Error("input");
          if (d.source !== d.brief || d.reference !== d.ref) {
            $(".status").textContent = t(
              "Preparing characters…",
              "正在准备角色…",
            );
            const candidates = d.ref
              ? [
                  {
                    url: d.ref,
                    label: t("Use reference image", "直接使用参考图"),
                  },
                ]
              : [];
            if (hasModel) {
              const r = await api("characters", "POST", {
                prompt: d.brief.trim(),
                fromBrief: true,
              });
              r.images.forEach((url, i) =>
                candidates.push({
                  url,
                  label: t("Candidate ", "候选 ") + (i + 1),
                }),
              );
            }
            if (!candidates.length)
              candidates.push({
                url: "/frog.png",
                label: t("Built-in frog", "内置青蛙"),
              });
            d.actors = candidates;
            d.selected = 0;
            d.source = d.brief;
            d.reference = d.ref;
            d.shots = [];
          }
          d.step = 1;
        } else if (d.step === 1) {
          if (!d.shots.length) {
            $(".status").textContent = t(
              "Writing six reactions…",
              "正在拟定六条表情方案…",
            );
            const configured = (await api("settings")).configured;
            d.withDirector = configured;
            d.shots = configured
              ? (await api("ideas", "POST", { count: 6, lang, brief: d.brief }))
                  .items
              : presets(6).map((v, i) => ({ ...v, prompt: localScenes()[i] }));
            d.shots.forEach((item) => {
              item.speed ||= 1;
              interpret(item);
            });
            d.index = 0;
          }
          d.step = 2;
        } else {
          const invalid = d.shots.findIndex(
            (item) => !item.prompt.trim() || !isEnglishCaption(item.caption),
          );
          if (invalid !== -1) {
            d.index = invalid;
            draw();
            const badCaption = !isEnglishCaption(d.shots[invalid].caption);
            $(badCaption ? "#line" : "#desc").focus();
            throw Error(badCaption ? "caption_language" : "input");
          }
          $(".status").textContent = t(
            d.withDirector && hasModel ? "DeepSeek is planning poses for local rendering…" : "Rendering keyframes…",
            d.withDirector && hasModel ? "DeepSeek 正在编排分镜，随后在本地逐帧绘制…" : "正在本地绘制关键帧…",
          );
          const selected = d.actors[d.selected].url;
          const pack = await api("projects", "POST", {
            name: d.brief.trim().slice(0, 64),
            actor: selected === "/frog.png" ? "" : selected,
            items: d.shots,
            renderPack: true,
          });
          newState = null;
          active = 0;
          if (location.hash === "#/new") location.hash = "/pack/" + pack.id;
          else notice(t("Your pack is ready in Projects.", "动图已生成，可在「我的项目」查看。"));
          return;
        }
        draw();
      } finally {
        d.busy = false;
        lock(false);
      }
    }, pendingLabel);
    if (d.busy) lock(true);
  }
  draw();
}
function workspace() {
  const p = project,
    item = p.items.find((i) => i.id === active) || p.items[0];
  active = item.id;
  const zipLabel = t("Download latest ZIP", "下载最新版 ZIP");
  main.innerHTML = `<section class="page"><div class="bar"><h1>${esc(p.name)}</h1><div class="actions"><span id="counter">${p.items.length}/15</span><button data-specular id="add" ${p.items.length >= 15 ? "disabled" : ""}>${t("Add stickers", "添加表情")}</button><button data-specular class="primary" id="exportZip">${zipLabel}</button></div></div>
 <div class="work"><div class="grid">${p.items.map((i) => `<article class="card ${i.id === active ? "selected" : ""}"><button class="pick" data-id="${i.id}"><img loading="lazy" src="/api/items/${i.id}/draft.gif?v=${i.version}" alt=""><h3>${esc(i.caption)}</h3><small>${i.confirmed === i.version ? t("Confirmed", "已确认") : t("Draft", "草稿")}</small></button>${i.confirmed === i.version ? `<a class="link" href="/api/items/${i.id}/sticker.gif">${t("Download GIF", "下载 GIF")}</a>` : ""}</article>`).join("")}</div>
 <section class="editor"><div class="editor-stage"><h2>${t("Edit sticker", "编辑表情")}</h2><img class="preview" id="preview" src="/api/items/${item.id}/draft.gif?v=${item.version}" alt="${t("Animated preview", "动图预览")}"></div>
 <label class="field"><span>${t("Reaction description", "表情描述")}</span><textarea id="shotPrompt" maxlength="160">${esc(item.prompt)}</textarea></label>
 <label class="field"><span>${t("English caption", "英文配字")}</span><input id="caption" value="${esc(item.caption)}" maxlength="32"></label><div class="row"><label class="field"><span>${t("Motion", "动作")}</span><pm-select id="motion">${motions.map((m) => `<option value="${m}">${motionName(m)}</option>`).join("")}</pm-select></label>
 <label class="field"><span>${t("Speed", "速度")}</span><pm-select id="speed"><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.5">1.5×</option></pm-select></label></div>
 <details><summary>${t("Revise with DeepSeek", "用 DeepSeek 修改")}</summary><label class="field"><span>${t("Describe your change", "描述修改要求")}</span><input id="revision" maxlength="240"></label><button data-specular id="revise">${t("Apply suggestion", "应用建议")}</button></details>
 <p class="status"></p><div class="actions"><button data-specular class="primary" id="confirm">${t("Confirm & next", "确认并看下一个")}</button><button data-specular id="remove" ${p.items.length === 1 ? "disabled" : ""}>${t("Remove", "移除")}</button></div></section></div></section>`;
  $("#motion").value = item.motion;
  $("#speed").value = String(item.speed);
  const caption = $("#caption"),
    motion = $("#motion"),
    speed = $("#speed"),
    status = $(".status");
  const current = () => ({
    prompt: $("#shotPrompt").value.trim(),
    caption: caption.value.trim(),
    motion: motion.value,
    speed: Number(speed.value),
  });
  let revision = item.version,
    serial = 0;
  function save() {
    const values = current(),
      seq = ++serial;
    if (!values.caption) {
      status.textContent = t("Enter a caption.", "请输入配字。");
      return;
    }
    status.textContent = t("Saving…", "正在保存…");
    pendingSave = pendingSave
      .catch(() => {})
      .then(async () => {
        if (seq !== serial) return;
        const next = await api("items/" + item.id, "PATCH", {
          ...values,
          version: revision,
        });
        const saved = next.items.find((i) => i.id === item.id);
        revision = saved.version;
        if (!caption.isConnected) return;
        project = next;
        if (seq === serial) {
          const url = `/api/items/${item.id}/draft.gif?v=${revision}`;
          $("#preview").src = url;
          const card = main.querySelector(".card.selected");
          card.querySelector("img").src = url;
          card.querySelector("a.link")?.remove();
          card.querySelector("h3").textContent = values.caption;
          card.querySelector("small").textContent = t("Draft", "草稿");
          status.textContent = t("Draft saved", "草稿已保存");
        }
      });
    pendingSave.catch((e) => {
      status.textContent = message(e);
    });
  }
  $("#shotPrompt").onchange =
    caption.onchange =
    motion.onchange =
    speed.onchange =
      save;
  main.querySelectorAll("[data-id]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await pendingSave;
          active = +b.dataset.id;
          workspace();
        } catch (e) {
          notice(message(e));
        }
      }),
  );
  action("#exportZip", async () => {
    if (!current().prompt || !isEnglishCaption(current().caption)) {
      throw Error(!current().prompt ? "input" : "caption_language");
    }
    const page = main.querySelector(".page");
    page.inert = true;
    try {
      await downloadCurrentPack(p.id);
      const fresh = await api("projects/" + p.id);
      if (page.isConnected) {
        project = fresh;
        workspace();
      }
    } finally {
      page.inert = false;
    }
  }, t("Preparing latest ZIP…", "合成并打包中…"));
  action("#revise", async () => {
    await pendingSave;
    const request = $("#revision").value.trim();
    if (!request) return $("#revision").focus();
    const original = revision;
    status.textContent = t("Thinking…", "正在构思…");
    const { items } = await api("ideas", "POST", {
      count: 1,
      lang,
      brief: JSON.stringify({
        prompt: $("#shotPrompt").value,
        caption: caption.value,
        motion: motion.value,
        request,
      }),
    });
    if (!caption.isConnected) return;
    project = await api("items/" + item.id, "PATCH", {
      ...items[0],
      speed: Number(speed.value),
      version: original,
    });
    workspace();
  }, t("Revising…", "修改中…"));
  action("#confirm", async () => {
    await pendingSave;
    if (!current().caption) return caption.focus();
    project = await api("items/" + item.id + "/confirm", "POST", {
      version: revision,
    });
    const next = project.items.find((i) => i.confirmed !== i.version);
    active = next?.id || item.id;
    workspace();
    notice(t("Looping GIF saved", "循环 GIF 已保存"));
  }, t("Rendering…", "渲染中…"));
  action("#remove", async () => {
    await pendingSave;
    if (
      !window.confirm(
        t(
          "Remove this sticker and its saved GIF?",
          "移除此表情及已保存的 GIF？",
        ),
      )
    )
      return;
    project = await api("items/" + item.id, "DELETE", { version: revision });
    active = project.items[0].id;
    workspace();
  });
  action("#add", async () => {
    await pendingSave;
    addDialog();
  });
}
function addDialog() {
  const room = 15 - project.items.length;
  modal(
    `<div class="bar"><h2>${t("Add stickers", "添加表情")}</h2><button data-specular id="close">${t("Close", "关闭")}</button></div><label class="field"><span>${t("English caption or AI brief", "英文配字或 AI 创意")}</span><textarea maxlength="500" id="extra"></textarea></label><label class="field"><span>${t("AI suggestion count", "AI 建议数量")} · ${t("up to", "最多")} ${room}</span><input id="extraCount" type="number" min="1" max="${room}" value="1"></label><p class="status"></p><div class="actions"><button data-specular id="manual" class="primary">${t("Add one", "添加一个")}</button><button data-specular id="ai">${t("Suggest with DeepSeek", "DeepSeek 建议")}</button></div>`,
  );
  action("#close", () => dialog.close());
  async function append(ai) {
    const brief = $("#extra").value.trim();
    if (!brief) return $("#extra").focus();
    const count = Number($("#extraCount").value);
    if (ai && (!Number.isInteger(count) || count < 1 || count > room))
      throw Error("limit");
    if (!ai && brief.length > 32) throw Error("input");
    const other = $(ai ? "#manual" : "#ai");
    other.disabled = true;
    try {
      const items = ai
        ? (await api("ideas", "POST", { brief, count, lang })).items
        : [{ caption: brief, motion: "peek", speed: 1 }];
      project = await api("projects/" + project.id + "/items", "POST", {
        items,
      });
      active = project.items.at(-items.length).id;
      dialog.close();
      workspace();
    } finally {
      other.disabled = false;
    }
  }
  action("#manual", () => append(false));
  action("#ai", () => append(true), t("Thinking…", "构思中…"));
}
nav();
window.addEventListener("hashchange", route);
route();
