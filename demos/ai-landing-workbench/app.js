// AI 落地三镜工作台 · 前端逻辑（第一镜）
(function () {
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // 场景模板：选中即预填 Q1-Q3 的合理默认值，用户可改
  const SCENE_TEMPLATES = {
    huangjiu: {
      businessType: "区域黄酒 / 农产品品牌",
      businessDesc: "有产地和老工艺，主要卖给本地和送礼人群，想破圈到年轻人",
      painPoints: ["获客", "复购"],
      resources: ["老客名单", "品牌口碑", "行业 know-how"],
      futureGoals: ["做品牌", "营收翻倍"],
      monthlyBudget: "1000–5000 元",
      avoidAI: ["定价", "内容口径"],
      successMetrics: ["营收", "复购率"],
    },
    bakery: {
      businessType: "社区烘焙 / 连锁餐饮",
      businessDesc: "2-3 家社区店，靠熟客和外卖，高峰期出餐和私域复购是痛点",
      painPoints: ["复购", "获客", "人力"],
      resources: ["私域社群", "老客名单", "内容素材"],
      futureGoals: ["开分店", "少雇人"],
      monthlyBudget: "1000–5000 元",
      avoidAI: ["客户沟通"],
      successMetrics: ["营收", "人力节省"],
    },
    edu: {
      businessType: "少儿教培 / 知识服务",
      businessDesc: "小班课 + 线上社群，获客靠转介绍，续费是生命线",
      painPoints: ["获客", "复购"],
      resources: ["老客名单", "内容素材", "私域社群"],
      futureGoals: ["标准化可复制", "营收翻倍"],
      monthlyBudget: "1000–5000 元",
      avoidAI: ["内容口径", "客户沟通"],
      successMetrics: ["客户数", "复购率"],
    },
    factory: {
      businessType: "小型制造 / 加工厂",
      businessDesc: "接单生产，依赖老板跑业务和大客户，报价和排产靠经验",
      painPoints: ["获客", "供应链", "人力"],
      resources: ["供应链优势", "行业 know-how", "渠道关系"],
      futureGoals: ["少雇人", "标准化可复制"],
      monthlyBudget: "5000–2 万",
      avoidAI: ["定价", "财务"],
      successMetrics: ["利润", "人力节省"],
    },
    travel: {
      businessType: "文旅 / 民宿 / 体验",
      businessDesc: "有内容和场地，淡旺季明显，想做私域复购和周边带货",
      painPoints: ["获客", "复购"],
      resources: ["内容素材", "品牌口碑", "私域社群"],
      futureGoals: ["做品牌", "营收翻倍"],
      monthlyBudget: "1000–5000 元",
      avoidAI: ["内容口径"],
      successMetrics: ["营收", "复购率"],
    },
    service: {
      businessType: "本地生活服务（维修 / 家政 / 美容）",
      businessDesc: "师傅上门服务，靠口碑和微信接单，排期和客户跟进乱",
      painPoints: ["获客", "交付", "人力"],
      resources: ["老客名单", "私域社群", "口碑".replace("口碑", "品牌口碑")],
      futureGoals: ["少雇人", "标准化可复制"],
      monthlyBudget: "<1000 元",
      avoidAI: ["客户沟通"],
      successMetrics: ["人力节省", "客户数"],
    },
  };

  const state = { stage: 1, input: null, draft: null };

  // ---------- 模板预填 ----------
  function applyTemplate(key) {
    const t = SCENE_TEMPLATES[key];
    if (!t) return;
    $("#businessType").value = t.businessType || "";
    $("#businessDesc").value = t.businessDesc || "";
    setChecks("#painPoints", t.painPoints);
    setChecks("#resources", t.resources);
    setChecks("#futureGoals", t.futureGoals);
    setRadio("#monthlyBudget", t.monthlyBudget);
    setChecks("#avoidAI", t.avoidAI);
    setChecks("#successMetrics", t.successMetrics);
  }

  function setChecks(sel, vals) {
    $$(sel + " input[type=checkbox]").forEach((cb) => {
      const base = cb.value === "__other" ? false : vals.includes(cb.value);
      cb.checked = base;
    });
  }
  function setRadio(sel, val) {
    const r = $$(sel + " input[type=radio]").find((x) => x.value === val);
    if (r) r.checked = true;
  }

  // ---------- 收集输入 ----------
  function collectChecks(sel, otherId) {
    const out = [];
    $$(sel + " input[type=checkbox]").forEach((cb) => {
      if (cb.value === "__other") {
        const txt = $("#" + otherId).value.trim();
        if (cb.checked && txt) out.push(txt);
      } else if (cb.checked) out.push(cb.value);
    });
    return out;
  }

  function collectInput() {
    const budget = ($$("#monthlyBudget input[type=radio]").find((r) => r.checked) || {}).value || "";
    return {
      businessType: $("#businessType").value.trim(),
      businessDesc: $("#businessDesc").value.trim(),
      painPoints: collectChecks("#painPoints", "painOther"),
      resources: collectChecks("#resources", "resOther"),
      futureGoals: collectChecks("#futureGoals", "futureOther"),
      futureText: $("#futureText").value.trim(),
      monthlyBudget: budget,
      avoidAI: collectChecks("#avoidAI", "avoidOther"),
      successMetrics: collectChecks("#successMetrics", "metricOther"),
      freeText: $("#freeText").value.trim(),
    };
  }

  // ---------- 调用后端 ----------
  async function callVision(stage, input, history) {
    const resp = await fetch("/api/vision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage, input, history }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "请求失败");
    if (data.parseError) throw new Error("模型未返回标准 JSON，请重试");
    return data.result;
  }

  // ---------- 渲染草稿 ----------
  function renderDraft(r) {
    let html = `<div class="vision-line">${esc(r.visionStatement || "")}</div>`;
    (r.opportunities || []).forEach((o) => {
      html += card(o);
    });
    if (r.nextStepHint) html += `<p class="hint">下一步建议：${esc(r.nextStepHint)}</p>`;
    $("#draftOut").innerHTML = html;

    // 澄清问题 → 输入框
    const cq = $("#clarifyQuestions");
    cq.innerHTML = "";
    (r.clarifyingQuestions || []).forEach((q, i) => {
      const div = document.createElement("div");
      div.innerHTML = `<label>${i + 1}. ${esc(q)}</label><input type="text" data-q="${esc(q)}" placeholder="你的回答…" />`;
      cq.appendChild(div);
    });
  }

  function card(o) {
    const lev = tagClass(o.leverage, "lev");
    const diff = tagClass(o.difficulty, "diff");
    const fly = o.flywheel && /飞轮|能|可/.test(o.flywheel) ? `<span class="tag fly-yes">有飞轮</span>` : `<span class="tag fly-no">弱飞轮</span>`;
    return `<div class="card">
      <h4>${esc(o.title || "")}</h4>
      <div>${lev} ${diff} ${fly}</div>
      <p style="margin:8px 0 0">${esc(o.why || "")}</p>
      ${o.firstMove ? `<p style="margin:6px 0 0;color:var(--accent)">👉 第一步：${esc(o.firstMove)}</p>` : ""}
      ${o.flywheel ? `<p style="margin:6px 0 0;color:var(--muted)">飞轮：${esc(o.flywheel)}</p>` : ""}
    </div>`;
  }

  function tagClass(v, prefix) {
    const map = { 高: "high", 中: "mid", 低: "low" };
    const cls = map[(v || "").trim()] || "mid";
    return `<span class="tag ${prefix}-${cls}">${esc(v || "")}</span>`;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  // ---------- 渲染作战图 ----------
  function renderBattle(r) {
    let html = `<div class="vision-line">${esc(r.visionStatement || "")}</div>`;
    (r.opportunities || []).forEach((o) => { html += card(o); });
    html += `<h3>行动作战图</h3><div class="battle">${esc(r.battleMap || "")}</div>`;
    if (r.metrics) html += `<h3>建议追踪的指标</h3><div class="battle">${esc(r.metrics)}</div>`;
    if (r.nextStepHint) html += `<p class="hint">进入循环镜建议：${esc(r.nextStepHint)}</p>`;
    $("#battleOut").innerHTML = html;
  }

  function battleText(r) {
    let t = "【AI 落地作战图】\n";
    t += "一句话定位：" + (r.visionStatement || "") + "\n\n";
    (r.opportunities || []).forEach((o, i) => {
      t += `${i + 1}. ${o.title}（杠杆 ${o.leverage} / 难度 ${o.difficulty}）\n`;
      t += "   为什么：" + (o.why || "") + "\n";
      if (o.firstMove) t += "   第一步：" + o.firstMove + "\n";
      if (o.flywheel) t += "   飞轮：" + o.flywheel + "\n";
    });
    t += "\n【行动作战图】\n" + (r.battleMap || "");
    if (r.metrics) t += "\n\n【指标】\n" + r.metrics;
    return t;
  }

  // ---------- 步骤切换 ----------
  function showStep(n) {
    state.stage = n;
    ["#step1", "#step2", "#step3"].forEach((s, i) => $(s).classList.toggle("hidden", i + 1 !== n));
    $$(".step-dot").forEach((d) => d.classList.toggle("active", Number(d.dataset.step) === n));
  }

  // ---------- 事件 ----------
  $("#sceneTemplate").addEventListener("change", (e) => applyTemplate(e.target.value));

  $("#btnDraft").addEventListener("click", async () => {
    state.input = collectInput();
    if (!state.input.businessType && !state.input.freeText) {
      alert("至少填一下「你的生意是什么」，或选个场景模板～"); return;
    }
    $("#draftOut").innerHTML = `<div class="loading">⏳ 正在结合 Alexandr Wang 的框架，为你生成机会草稿…</div>`;
    showStep(2);
    try {
      state.draft = await callVision("draft", state.input, null);
      renderDraft(state.draft);
    } catch (err) {
      $("#draftOut").innerHTML = `<div class="err">出错了：${esc(err.message)}</div>`;
    }
  });

  $("#btnRefine").addEventListener("click", async () => {
    const clar = {};
    $$("#clarifyQuestions input[type=text]").forEach((inp) => { if (inp.value.trim()) clar[inp.dataset.q] = inp.value.trim(); });
    state.input.clarifications = clar;
    $("#battleOut").innerHTML = `<div class="loading">⏳ 正在结合你的补充，生成定稿作战图…</div>`;
    showStep(3);
    try {
      const final = await callVision("refine", state.input, state.draft);
      renderBattle(final);
      state.final = final;
    } catch (err) {
      $("#battleOut").innerHTML = `<div class="err">出错了：${esc(err.message)}</div>`;
    }
  });

  $("#btnBack1").addEventListener("click", () => showStep(1));

  $("#btnCopy").addEventListener("click", async () => {
    const text = battleText(state.final);
    try {
      await navigator.clipboard.writeText(text);
      alert("已复制到剪贴板，可直接粘贴到文档 / 微信。");
    } catch {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove(); alert("已复制。");
    }
  });

  $("#btnDownload").addEventListener("click", () => {
    const text = battleText(state.final);
    const blob = new Blob([`<pre style="font-family:inherit;white-space:pre-wrap;padding:20px">${esc(text)}</pre>`], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "AI落地作战图.html"; a.click();
  });

  $("#btnRestart").addEventListener("click", () => { state.input = null; state.draft = null; showStep(1); });

  // 导航
  $$(".tab").forEach((t) => t.addEventListener("click", () => {
    const m = t.dataset.mirror;
    $$(".tab").forEach((x) => x.classList.toggle("active", x === t));
    ["#mirror1", "#mirror2", "#mirror3"].forEach((s, i) => $(s).classList.toggle("hidden", String(i + 1) !== m));
  }));
})();
